// src/api.js — All API route handlers (PostgreSQL)
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import nodemailer from 'nodemailer';
import QRCode from 'qrcode';
import { put, del } from '@vercel/blob';
import { UPLOADS_DIR } from './paths.js';
import pool from './db.js';
import { q, qOne, qAll, qExec, withTransaction } from './pgQuery.js';
import { requireAuth, requireTeacher } from './authMiddleware.js';

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const memoryStorage = multer.memoryStorage();
const upload = multer({
  storage: memoryStorage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.txt', '.png', '.jpg', '.jpeg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('File type not allowed'));
  }
});

/** Legacy: add payment_requests if DB was created before that table existed (requires fees + users). */
async function ensurePaymentRequestsTable() {
  const { rows } = await pool.query(`
    SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'fees') AS has_fees,
           EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payment_requests') AS has_pr
  `);
  if (!rows[0].has_fees || rows[0].has_pr) return;
  await q(
    pool,
    `CREATE TABLE payment_requests (
      id            SERIAL PRIMARY KEY,
      fee_id        INTEGER NOT NULL,
      student_id    TEXT NOT NULL,
      amount        INTEGER NOT NULL,
      fee_type      TEXT,
      description   TEXT,
      qr_code       TEXT,
      upi_link      TEXT,
      status        TEXT DEFAULT 'active' CHECK(status IN ('active','paid','expired','cancelled')),
      expires_at    TEXT NOT NULL,
      paid_at       TEXT,
      txn_id        TEXT,
      receipt_no    TEXT,
      created_by    TEXT,
      created_at    TEXT DEFAULT (NOW()::TEXT),
      FOREIGN KEY(fee_id) REFERENCES fees(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  );
}

async function ensureUserColumns() {
  const { rows } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') AS u`
  );
  if (!rows[0].u) return;

  const alters = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified INTEGER DEFAULT 1",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_code TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expires TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_phone TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_phone_verified INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_email TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_email_verified INTEGER DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_email_otp TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_email_otp_expires TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_phone_otp TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_phone_otp_expires TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_otp TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_otp_expires TEXT"
  ];
  for (const sql of alters) await pool.query(sql);
}

async function ensureMaterialsFileUrl() {
  const { rows } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'materials') AS m`
  );
  if (!rows[0].m) return;
  await pool.query('ALTER TABLE materials ADD COLUMN IF NOT EXISTS file_url TEXT');
}

export async function ensureSchema() {
  const { rows } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') AS ok`
  );
  if (!rows[0].ok) {
    console.warn('PostgreSQL schema missing. Run: npm run init-db');
    return;
  }
  await ensurePaymentRequestsTable();
  await ensureUserColumns();
  await ensureMaterialsFileUrl();
}

function hasEmailConfig() {
  return Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS && process.env.EMAIL_PASS !== 'your_gmail_app_password_here');
}

async function sendEmail({ to, subject, html }) {
  if (!hasEmailConfig()) {
    throw new Error('Email service is not configured. Please set EMAIL_USER and EMAIL_PASS in .env');
  }
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
  });
  await transporter.sendMail({ from: `"Devang Classes" <${process.env.EMAIL_USER}>`, to, subject, html });
  console.log('📧 Email sent to', to);
  return true;
}

const calcGrade = (pct) => {
  if (pct >= 90) return 'A+';
  if (pct >= 80) return 'A';
  if (pct >= 70) return 'B';
  if (pct >= 55) return 'C';
  return 'F';
};

function makeOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function expireOldPaymentRequests() {
  await q(
    pool,
    `UPDATE payment_requests SET status='expired'
     WHERE status='active' AND expires_at::timestamptz <= NOW()`
  );
}

function makeReceiptNo() {
  return 'RCT' + new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

// ═══════════════════════════════════════════════
//  AUTH ROUTES
// ═══════════════════════════════════════════════

router.post(
  '/auth/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const loginId = String(email || '').trim();
    const user = await qOne(pool, 'SELECT * FROM users WHERE lower(email) = lower(?) OR id = ?', [loginId, loginId.toUpperCase()]);
    if (!user) return res.status(401).json({ error: 'No account found with this email' });
    if (!bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Incorrect password' });
    if (user.status !== 'active') return res.status(403).json({ error: 'Account is deactivated' });
    if (user.role === 'student' && user.email_verified !== 1) {
      return res.status(403).json({ error: 'Please verify your email with OTP before login' });
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role, class: user.class },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    const { password: _, ...safeUser } = user;
    safeUser.subjects = JSON.parse(safeUser.subjects || '[]');
    res.json({ token, user: safeUser });
  })
);

router.post(
  '/auth/register',
  asyncHandler(async (req, res) => {
    const { name, email, phone, password, class: cls, subjects, parent, parentPhone, parentEmail, parentEmailVerified, address } = req.body;

    if (!name || !email || !password || !cls) {
      return res.status(400).json({ error: 'Name, email, password, and class are required' });
    }

    if (!phone || !/^\d{10}$/.test(String(phone).trim())) {
      return res.status(400).json({ error: 'Student mobile number must be 10 digits' });
    }

    if (!parentPhone || !/^\d{10}$/.test(String(parentPhone).trim())) {
      return res.status(400).json({ error: 'Parent mobile number must be 10 digits' });
    }

    if (!parentEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(parentEmail).trim())) {
      return res.status(400).json({ error: 'Parent email is required and must be valid' });
    }

    if (!parentEmailVerified) {
      return res.status(400).json({ error: 'Please verify the parent email before registration' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanParentEmail = String(parentEmail || '').trim().toLowerCase();

    if (!global.parentEmailVerifiedStore?.[cleanParentEmail]) {
      return res.status(400).json({ error: 'Please verify the parent email before registration' });
    }

    const existing = await qOne(pool, 'SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (existing) {
      return res.status(400).json({ error: 'An account with this email already exists' });
    }

    const last = await qOne(pool, "SELECT id FROM users WHERE role='student' ORDER BY id DESC LIMIT 1");
    const lastNum = last ? parseInt(String(last.id).replace('SC', ''), 10) || 0 : 0;
    const id = 'SC' + String(lastNum + 1).padStart(3, '0');

    const hash = bcrypt.hashSync(password, 10);
    const today = new Date().toISOString().split('T')[0];

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await q(
      pool,
      `INSERT INTO users
    (id, name, email, phone, password, role, class, subjects, parent, parent_phone, parent_phone_verified, parent_email, parent_email_verified, address, joined, email_verified, otp_code, otp_expires)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        name.trim(),
        cleanEmail,
        phone || '',
        hash,
        'student',
        cls,
        JSON.stringify(subjects || []),
        parent || '',
        String(parentPhone || '').trim(),
        1,
        cleanParentEmail,
        1,
        address || '',
        today,
        0,
        otp,
        otpExpires
      ]
    );

    await sendEmail({
      to: cleanEmail,
      subject: 'Verify your Devang Classes account',
      html: `
      <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:24px;background:#f9f9f9;border-radius:12px;">
        <h2 style="color:#7C5CFC;">Email Verification</h2>
        <p>Your OTP for Devang Classes registration is:</p>
        <div style="font-size:32px;font-weight:bold;letter-spacing:6px;margin:20px 0;color:#FF4D1C;">${otp}</div>
        <p>This OTP will expire in 10 minutes.</p>
      </div>
    `
    });

    delete global.parentEmailVerifiedStore?.[cleanParentEmail];

    const resp = {
      message: hasEmailConfig() ? 'Registration successful. OTP sent to email.' : 'Registration successful. Email OTP generated in demo mode.',
      studentId: id,
      email: cleanEmail
    };
    if (!hasEmailConfig()) resp.devOtp = otp;
    res.status(201).json(resp);
  })
);

router.post(
  '/auth/verify-otp',
  asyncHandler(async (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    const loginId = String(email || '').trim();
    const user = await qOne(pool, 'SELECT * FROM users WHERE lower(email) = lower(?) OR id = ?', [loginId, loginId.toUpperCase()]);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.email_verified === 1) {
      return res.json({ message: 'Email already verified' });
    }

    if (!user.otp_code || !user.otp_expires) {
      return res.status(400).json({ error: 'OTP not found. Please register again.' });
    }

    if (String(user.otp_code) !== String(otp).trim()) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    if (new Date(user.otp_expires) < new Date()) {
      return res.status(400).json({ error: 'OTP expired' });
    }

    await q(pool, 'UPDATE users SET email_verified = 1, otp_code = NULL, otp_expires = NULL WHERE email = ?', [email.trim().toLowerCase()]);

    res.json({ message: 'Email verified successfully. You can now login.' });
  })
);

router.post(
  '/auth/resend-otp',
  asyncHandler(async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const cleanEmail = String(email).trim().toLowerCase();
    const user = await qOne(pool, 'SELECT * FROM users WHERE lower(email)=lower(?)', [cleanEmail]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const otp = makeOtp();
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await q(pool, 'UPDATE users SET otp_code=?, otp_expires=? WHERE id=?', [otp, otpExpires, user.id]);
    await sendEmail({
      to: cleanEmail,
      subject: 'Your new DevangClasses OTP',
      html: `<div style="font-family:Arial,sans-serif"><h2>Email Verification OTP</h2><p>Your OTP is <strong style="font-size:28px;letter-spacing:4px;">${otp}</strong></p><p>Valid for 10 minutes.</p></div>`
    });
    const resp = { message: hasEmailConfig() ? 'OTP resent to your email.' : 'OTP regenerated in demo mode.' };
    if (!hasEmailConfig()) resp.devOtp = otp;
    res.json(resp);
  })
);

router.post(
  '/auth/send-parent-email-otp',
  asyncHandler(async (req, res) => {
    const { parentEmail } = req.body;
    const cleanEmail = String(parentEmail || '').trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Enter a valid parent email address' });
    }

    if (!hasEmailConfig()) {
      return res.status(500).json({ error: 'Email service is not configured. Please set EMAIL_USER and EMAIL_PASS in .env' });
    }

    const otp = makeOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    global.parentEmailOtpStore = global.parentEmailOtpStore || {};
    global.parentEmailOtpStore[cleanEmail] = { otp, expiresAt };

    await sendEmail({
      to: cleanEmail,
      subject: 'Devang Classes parent email verification code',
      html: `<div style="font-family:Arial,sans-serif"><h2>Parent Email Verification</h2><p>Your verification code is <strong style="font-size:28px;letter-spacing:4px;">${otp}</strong></p><p>Valid for 10 minutes.</p></div>`
    });

    res.json({ message: 'OTP sent to parent email successfully.' });
  })
);

router.post('/auth/verify-parent-email-otp', (req, res) => {
  const { parentEmail, otp } = req.body;
  const cleanEmail = String(parentEmail || '').trim().toLowerCase();

  if (!cleanEmail || !otp) {
    return res.status(400).json({ error: 'Parent email and OTP are required' });
  }

  const entry = global.parentEmailOtpStore?.[cleanEmail];
  if (!entry) {
    return res.status(400).json({ error: 'No parent email OTP found. Please send OTP again.' });
  }

  if (String(entry.otp) !== String(otp).trim()) {
    return res.status(400).json({ error: 'Invalid parent email OTP' });
  }

  if (new Date(entry.expiresAt) < new Date()) {
    delete global.parentEmailOtpStore[cleanEmail];
    return res.status(400).json({ error: 'Parent email OTP expired' });
  }

  global.parentEmailVerifiedStore = global.parentEmailVerifiedStore || {};
  global.parentEmailVerifiedStore[cleanEmail] = true;
  delete global.parentEmailOtpStore[cleanEmail];

  res.json({ message: 'Parent email verified successfully.' });
});

router.post(
  '/auth/forgot-password',
  asyncHandler(async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const loginId = String(email).trim();
    const user = await qOne(pool, 'SELECT * FROM users WHERE lower(email)=lower(?) OR id=?', [loginId, loginId.toUpperCase()]);
    if (!user) return res.status(404).json({ error: 'No account found with this email or ID' });
    const otp = makeOtp();
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await q(pool, 'UPDATE users SET reset_otp=?, reset_otp_expires=? WHERE id=?', [otp, expires, user.id]);
    await sendEmail({
      to: user.email,
      subject: 'Devang Classes password reset code',
      html: `<div style="font-family:Arial,sans-serif"><h2>Password Reset</h2><p>Your reset code is <strong style="font-size:28px;letter-spacing:4px;">${otp}</strong></p><p>Valid for 10 minutes.</p></div>`
    });
    res.json({ message: 'Password reset OTP sent to your registered email.', email: user.email });
  })
);

router.post(
  '/auth/reset-password',
  asyncHandler(async (req, res) => {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) return res.status(400).json({ error: 'Email, OTP and new password are required' });
    if (String(newPassword).length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
    const loginId = String(email).trim();
    const user = await qOne(pool, 'SELECT * FROM users WHERE lower(email)=lower(?) OR id=?', [loginId, loginId.toUpperCase()]);
    if (!user) return res.status(404).json({ error: 'Account not found' });
    if (!user.reset_otp || !user.reset_otp_expires) return res.status(400).json({ error: 'Reset OTP not found. Please request a new one.' });
    if (String(user.reset_otp).trim() !== String(otp).trim()) return res.status(400).json({ error: 'Invalid reset OTP' });
    if (new Date(user.reset_otp_expires) < new Date()) return res.status(400).json({ error: 'Reset OTP expired' });
    const hash = bcrypt.hashSync(newPassword, 10);
    await q(pool, 'UPDATE users SET password=?, reset_otp=NULL, reset_otp_expires=NULL WHERE id=?', [hash, user.id]);
    res.json({ message: 'Password reset successful. You can now login with the new password.' });
  })
);

router.get(
  '/auth/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await qOne(pool, 'SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { password, ...safeUser } = user;
    safeUser.subjects = JSON.parse(safeUser.subjects || '[]');
    res.json(safeUser);
  })
);

// ═══════════════════════════════════════════════
//  STUDENTS
// ═══════════════════════════════════════════════

router.get(
  '/students',
  requireTeacher,
  asyncHandler(async (req, res) => {
    const { q: search } = req.query;
    let students;
    if (search) {
      const p = `%${search}%`;
      students = await qAll(
        pool,
        `SELECT * FROM users WHERE role='student' AND (name LIKE ? OR email LIKE ? OR id LIKE ? OR class LIKE ?) ORDER BY joined DESC`,
        [p, p, p, p]
      );
    } else {
      students = await qAll(pool, `SELECT * FROM users WHERE role='student' ORDER BY joined DESC`);
    }
    students = students.map((s) => {
      const { password, ...r } = s;
      r.subjects = JSON.parse(r.subjects || '[]');
      return r;
    });
    res.json(students);
  })
);

router.delete(
  '/students/:id',
  requireTeacher,
  asyncHandler(async (req, res) => {
    await q(pool, 'DELETE FROM users WHERE id = ? AND role = ?', [req.params.id, 'student']);
    res.json({ message: 'Student removed' });
  })
);

// ═══════════════════════════════════════════════
//  PARENT REPORTS
// ═══════════════════════════════════════════════

async function buildStudentProgressReport(studentId) {
  const student = await qOne(pool, `SELECT * FROM users WHERE id=? AND role='student'`, [studentId]);
  if (!student) return null;

  const attendanceRows = await qAll(pool, `SELECT * FROM attendance WHERE student_id=?`, [studentId]);
  const present = attendanceRows.filter((r) => r.status === 'present').length;
  const absent = attendanceRows.filter((r) => r.status === 'absent').length;
  const totalAttendance = attendanceRows.length;
  const attendancePct = totalAttendance ? Math.round((present / totalAttendance) * 100) : 0;

  const quizRows = await qAll(
    pool,
    `SELECT qr.*, q.title, q.subject
     FROM quiz_results qr
     JOIN quizzes q ON q.id = qr.quiz_id
     WHERE qr.student_id=?
     ORDER BY qr.submitted_at DESC`,
    [studentId]
  );
  const avgQuiz = quizRows.length ? Math.round(quizRows.reduce((a, r) => a + Number(r.percentage || 0), 0) / quizRows.length) : 0;
  const highQuiz = quizRows.length ? Math.max(...quizRows.map((r) => Number(r.percentage || 0))) : 0;

  const feeRows = await qAll(pool, `SELECT * FROM fees WHERE student_id=?`, [studentId]);
  const paidRows = feeRows.filter((f) => f.status === 'paid');
  const pendingRows = feeRows.filter((f) => f.status === 'pending');
  const totalPaid = paidRows.reduce((a, f) => a + Number(f.amount || 0), 0);
  const totalPending = pendingRows.reduce((a, f) => a + Number(f.amount || 0), 0);

  const feedback = await qOne(pool, `SELECT * FROM feedback WHERE student_id=? ORDER BY created_at DESC LIMIT 1`, [studentId]);

  let remark = 'Good progress overall.';
  if (attendancePct < 75 || totalPending > 0) remark = 'Needs improvement in regularity and/or pending fee follow-up.';
  if (avgQuiz >= 85 && attendancePct >= 85 && totalPending === 0) remark = 'Excellent performance and consistency.';

  const { password, ...safeStudent } = student;
  safeStudent.subjects = JSON.parse(safeStudent.subjects || '[]');

  return {
    student: {
      id: safeStudent.id,
      name: safeStudent.name,
      class: safeStudent.class,
      subjects: safeStudent.subjects
    },
    parent: {
      name: safeStudent.parent || '',
      phone: safeStudent.parent_phone || '',
      email: safeStudent.parent_email || ''
    },
    attendance: {
      total: totalAttendance,
      present,
      absent,
      percentage: attendancePct
    },
    quizzes: {
      average: avgQuiz,
      highest: highQuiz,
      results: quizRows.map((r) => ({
        title: r.title,
        subject: r.subject,
        score: r.score,
        total: r.total,
        percentage: r.percentage,
        grade: r.grade
      }))
    },
    fees: {
      paidCount: paidRows.length,
      pendingCount: pendingRows.length,
      totalPaid,
      totalPending
    },
    feedback: feedback
      ? {
          subject: feedback.subject,
          rating: feedback.rating,
          message: feedback.message
        }
      : null,
    remark
  };
}

router.get(
  '/parent-reports/students',
  requireTeacher,
  asyncHandler(async (req, res) => {
    const students = await qAll(
      pool,
      `SELECT id, name, class, parent, parent_email, parent_phone
       FROM users
       WHERE role='student'
       ORDER BY name ASC`
    );
    res.json(students);
  })
);

router.get(
  '/parent-reports/:id',
  requireTeacher,
  asyncHandler(async (req, res) => {
    const report = await buildStudentProgressReport(req.params.id);
    if (!report) return res.status(404).json({ error: 'Student not found' });
    res.json({ report });
  })
);

router.post(
  '/parent-reports/:id/send',
  requireTeacher,
  asyncHandler(async (req, res) => {
    const report = await buildStudentProgressReport(req.params.id);
    if (!report) return res.status(404).json({ error: 'Student not found' });
    if (!report.parent.email) return res.status(400).json({ error: 'Parent email not available for this student' });

    await sendEmail({
      to: report.parent.email,
      subject: `Devang Classes Student Report - ${report.student.name}`,
      html: `
      <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:24px;background:#f9f9f9;color:#222">
        <h2 style="color:#7C5CFC;margin-bottom:8px;">Student Report</h2>
        <p style="margin-top:0;">Dear Parent, please find the latest progress summary for your child.</p>

        <h3 style="color:#FF4D1C;">Student Details</h3>
        <p><strong>Name:</strong> ${report.student.name}<br>
        <strong>ID:</strong> ${report.student.id}<br>
        <strong>Class:</strong> ${report.student.class || '—'}<br>
        <strong>Subjects:</strong> ${(report.student.subjects || []).join(', ') || '—'}</p>

        <h3 style="color:#FF4D1C;">Attendance</h3>
        <p><strong>Total Classes:</strong> ${report.attendance.total}<br>
        <strong>Present:</strong> ${report.attendance.present}<br>
        <strong>Absent:</strong> ${report.attendance.absent}<br>
        <strong>Attendance Percentage:</strong> ${report.attendance.percentage}%</p>

        <h3 style="color:#FF4D1C;">Quiz Performance</h3>
        <p><strong>Average Score:</strong> ${report.quizzes.average}%<br>
        <strong>Highest Score:</strong> ${report.quizzes.highest}%</p>
        ${report.quizzes.results.length
          ? `
          <table style="width:100%;border-collapse:collapse;margin-top:10px;">
            <thead>
              <tr>
                <th style="border:1px solid #ddd;padding:8px;background:#fff;">Quiz</th>
                <th style="border:1px solid #ddd;padding:8px;background:#fff;">Subject</th>
                <th style="border:1px solid #ddd;padding:8px;background:#fff;">Score</th>
                <th style="border:1px solid #ddd;padding:8px;background:#fff;">Percentage</th>
                <th style="border:1px solid #ddd;padding:8px;background:#fff;">Grade</th>
              </tr>
            </thead>
            <tbody>
              ${report.quizzes.results
                .map(
                  (r) => `
                <tr>
                  <td style="border:1px solid #ddd;padding:8px;">${r.title}</td>
                  <td style="border:1px solid #ddd;padding:8px;">${r.subject}</td>
                  <td style="border:1px solid #ddd;padding:8px;">${r.score}/${r.total}</td>
                  <td style="border:1px solid #ddd;padding:8px;">${r.percentage}%</td>
                  <td style="border:1px solid #ddd;padding:8px;">${r.grade}</td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>`
          : '<p>No quiz attempts recorded yet.</p>'}

        <h3 style="color:#FF4D1C;">Fees</h3>
        <p><strong>Paid Records:</strong> ${report.fees.paidCount}<br>
        <strong>Pending Records:</strong> ${report.fees.pendingCount}<br>
        <strong>Total Paid:</strong> ₹${Number(report.fees.totalPaid || 0).toLocaleString()}<br>
        <strong>Total Pending:</strong> ₹${Number(report.fees.totalPending || 0).toLocaleString()}</p>

        <h3 style="color:#FF4D1C;">Teacher Remark</h3>
        <p>${report.remark}</p>

        ${report.feedback ? `<h3 style="color:#FF4D1C;">Latest Feedback</h3><p>${report.feedback.message}</p>` : ''}

        <p style="margin-top:20px;">Regards,<br><strong>Devang Classes</strong></p>
      </div>
    `
    });

    res.json({ message: `Student report sent to ${report.parent.email}` });
  })
);

// ═══════════════════════════════════════════════
//  SCHEDULES
// ═══════════════════════════════════════════════

router.get(
  '/schedules',
  requireAuth,
  asyncHandler(async (req, res) => {
    const schedules = await qAll(pool, 'SELECT * FROM schedules ORDER BY time ASC');
    res.json(schedules);
  })
);

router.post(
  '/schedules',
  requireTeacher,
  asyncHandler(async (req, res) => {
    const { subject, day, time, duration, class: cls, notes } = req.body;
    if (!subject || !day || !time) return res.status(400).json({ error: 'Subject, day and time are required' });
    const r = await qOne(
      pool,
      `INSERT INTO schedules (subject, day, time, duration, class, notes) VALUES (?,?,?,?,?,?) RETURNING id`,
      [subject, day, time, duration || 60, cls || 'All Classes', notes || '']
    );
    res.status(201).json({ id: r.id, subject, day, time, duration, class: cls, notes });
  })
);

router.delete(
  '/schedules/:id',
  requireTeacher,
  asyncHandler(async (req, res) => {
    await q(pool, 'DELETE FROM schedules WHERE id = ?', [req.params.id]);
    res.json({ message: 'Schedule removed' });
  })
);

// ═══════════════════════════════════════════════
//  ATTENDANCE
// ═══════════════════════════════════════════════

router.get(
  '/attendance',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { subject, date, studentId } = req.query;
    let sql = 'SELECT * FROM attendance WHERE 1=1';
    const params = [];
    if (subject) {
      sql += ' AND subject = ?';
      params.push(subject);
    }
    if (date) {
      sql += ' AND date = ?';
      params.push(date);
    }
    if (studentId) {
      sql += ' AND student_id = ?';
      params.push(studentId);
    }
    const records = await qAll(pool, sql, params);
    res.json(records);
  })
);

router.post(
  '/attendance',
  requireTeacher,
  asyncHandler(async (req, res) => {
    const { studentId, subject, date, status } = req.body;
    if (!studentId || !subject || !date || !status) return res.status(400).json({ error: 'All fields required' });
    await q(
      pool,
      `INSERT INTO attendance (student_id, subject, date, status) VALUES (?,?,?,?)
       ON CONFLICT (student_id, subject, date) DO UPDATE SET status = EXCLUDED.status`,
      [studentId, subject, date, status]
    );
    res.json({ message: 'Attendance saved' });
  })
);

router.post(
  '/attendance/bulk',
  requireTeacher,
  asyncHandler(async (req, res) => {
    const { records } = req.body;
    if (!Array.isArray(records)) return res.status(400).json({ error: 'records array required' });
    await withTransaction(pool, async (cq) => {
      for (const r of records) {
        await cq(
          `INSERT INTO attendance (student_id, subject, date, status) VALUES (?,?,?,?)
           ON CONFLICT (student_id, subject, date) DO UPDATE SET status = EXCLUDED.status`,
          [r.studentId, r.subject, r.date, r.status]
        );
      }
    });
    res.json({ message: `${records.length} records saved` });
  })
);

router.delete(
  '/attendance',
  requireTeacher,
  asyncHandler(async (req, res) => {
    const { studentId, subject, date } = req.body;
    await q(pool, 'DELETE FROM attendance WHERE student_id=? AND subject=? AND date=?', [studentId, subject, date]);
    res.json({ message: 'Record removed' });
  })
);

router.get(
  '/attendance/report',
  requireTeacher,
  asyncHandler(async (req, res) => {
    const students = await qAll(pool, "SELECT id, name, class, subjects FROM users WHERE role='student' ORDER BY joined");
    const subjects = ['Maths', 'Biology', 'Physics', 'English', 'Chemistry'];
    const report = [];
    for (const s of students) {
      const subjectStats = {};
      let totalP = 0;
      let totalC = 0;
      for (const sub of subjects) {
        const rows = await qAll(pool, 'SELECT status FROM attendance WHERE student_id=? AND subject=?', [s.id, sub]);
        const p = rows.filter((r) => r.status === 'present').length;
        const t = rows.length;
        subjectStats[sub] = { present: p, total: t, pct: t > 0 ? Math.round((p / t) * 100) : null };
        totalP += p;
        totalC += t;
      }
      report.push({
        ...s,
        subjects: JSON.parse(s.subjects || '[]'),
        subjectStats,
        overallPct: totalC > 0 ? Math.round((totalP / totalC) * 100) : null,
        totalPresent: totalP,
        totalClasses: totalC
      });
    }
    res.json(report);
  })
);

// ═══════════════════════════════════════════════
//  MATERIALS
// ═══════════════════════════════════════════════

async function saveUploadedFile(file) {
  const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
  const filename = unique + path.extname(file.originalname);
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(filename, file.buffer, {
      access: 'public',
      token: process.env.BLOB_READ_WRITE_TOKEN
    });
    return { filename, fileUrl: blob.url };
  }
  const fp = path.join(UPLOADS_DIR, filename);
  fs.writeFileSync(fp, file.buffer);
  return { filename, fileUrl: null };
}

router.get(
  '/materials',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { subject } = req.query;
    let materials;
    if (subject && subject !== 'all') {
      materials = await qAll(pool, 'SELECT * FROM materials WHERE subject=? ORDER BY created_at DESC', [subject]);
    } else {
      materials = await qAll(pool, 'SELECT * FROM materials ORDER BY created_at DESC');
    }
    res.json(materials);
  })
);

router.post(
  '/materials',
  requireTeacher,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const { subject, title, description, forClass } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    let filename = null;
    let fileUrl = null;
    let origName = null;
    let fileSize = '—';
    if (req.file) {
      const saved = await saveUploadedFile(req.file);
      filename = saved.filename;
      fileUrl = saved.fileUrl;
      origName = req.file.originalname;
      fileSize = (req.file.size / 1024 / 1024).toFixed(2) + ' MB';
    }
    const r = await qOne(
      pool,
      `INSERT INTO materials (subject, title, description, filename, original_name, file_size, for_class, uploaded_by, file_url)
       VALUES (?,?,?,?,?,?,?,?,?) RETURNING id`,
      [subject, title, description || '', filename, origName, fileSize, forClass || 'All Classes', req.user.id, fileUrl]
    );
    res.status(201).json({
      id: r.id,
      subject,
      title,
      description,
      filename,
      original_name: origName,
      file_size: fileSize,
      for_class: forClass,
      file_url: fileUrl
    });
  })
);

router.delete(
  '/materials/:id',
  requireTeacher,
  asyncHandler(async (req, res) => {
    const mat = await qOne(pool, 'SELECT * FROM materials WHERE id=?', [req.params.id]);
    if (mat?.file_url && process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        await del(mat.file_url, { token: process.env.BLOB_READ_WRITE_TOKEN });
      } catch (e) {
        console.warn('Blob delete:', e.message);
      }
    } else if (mat?.filename) {
      const fp = path.join(UPLOADS_DIR, mat.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
    await q(pool, 'DELETE FROM materials WHERE id=?', [req.params.id]);
    res.json({ message: 'Material deleted' });
  })
);

router.get(
  '/materials/download/:filename',
  requireAuth,
  asyncHandler(async (req, res) => {
    const mat = await qOne(pool, 'SELECT * FROM materials WHERE filename=?', [req.params.filename]);
    if (!mat) return res.status(404).json({ error: 'File not found' });
    if (mat.file_url) {
      return res.redirect(302, mat.file_url);
    }
    const fp = path.join(UPLOADS_DIR, mat.filename);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File missing from server' });
    res.download(fp, mat.original_name || mat.filename);
  })
);

// ═══════════════════════════════════════════════
//  FEES
// ═══════════════════════════════════════════════

router.get(
  '/fees',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { studentId, status } = req.query;
    let sql = `SELECT f.*, u.name as student_name, u.class as student_class FROM fees f JOIN users u ON f.student_id = u.id WHERE 1=1`;
    const params = [];
    if (studentId) {
      sql += ' AND f.student_id = ?';
      params.push(studentId);
    }
    if (status && status !== 'all') {
      sql += ' AND f.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY f.created_at DESC';
    const rows = await qAll(pool, sql, params);
    res.json(rows);
  })
);

router.post(
  '/fees',
  requireTeacher,
  asyncHandler(async (req, res) => {
    const { studentId, amount, month, description } = req.body;
    if (!studentId || !amount || !month) return res.status(400).json({ error: 'Student, amount and month required' });
    const student = await qOne(pool, `SELECT id, name FROM users WHERE id=? AND role='student'`, [String(studentId).trim()]);
    if (!student) return res.status(404).json({ error: 'Student not found. Use IDs like SC001.' });
    const r = await qOne(
      pool,
      `INSERT INTO fees (student_id, amount, month, description) VALUES (?,?,?,?) RETURNING id`,
      [String(studentId).trim(), amount, month, description || 'Monthly Tuition']
    );
    res.status(201).json({ id: r.id, message: 'Fee record created' });
  })
);

router.patch(
  '/fees/:id/pay',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { txnId, paidVia } = req.body;
    if (!txnId) return res.status(400).json({ error: 'Transaction ID is required' });
    const fee = await qOne(
      pool,
      'SELECT f.*, u.name as student_name, u.email as student_email FROM fees f JOIN users u ON f.student_id=u.id WHERE f.id=?',
      [req.params.id]
    );
    if (!fee) return res.status(404).json({ error: 'Fee record not found' });
    const today = new Date().toISOString().split('T')[0];
    await q(pool, `UPDATE fees SET status='paid', txn_id=?, paid_via=?, paid_on=? WHERE id=?`, [txnId, paidVia || 'UPI', today, req.params.id]);
    await sendEmail({
      to: process.env.EMAIL_TO,
      subject: `💰 Payment Received — ${fee.student_name} | ₹${fee.amount}`,
      html: `
      <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:24px;background:#f9f9f9;border-radius:12px;">
        <h2 style="color:#FF4D1C;margin-bottom:4px;">✅ Payment Confirmed</h2>
        <p style="color:#666;">A fee payment has been received on Devang Classes portal.</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;">
          <tr style="background:#fff;"><td style="padding:10px;border:1px solid #eee;font-weight:bold;">Student</td><td style="padding:10px;border:1px solid #eee;">${fee.student_name}</td></tr>
          <tr style="background:#f9f9f9;"><td style="padding:10px;border:1px solid #eee;font-weight:bold;">Amount</td><td style="padding:10px;border:1px solid #eee;color:#00C97A;font-size:18px;font-weight:bold;">₹${fee.amount.toLocaleString()}</td></tr>
          <tr style="background:#fff;"><td style="padding:10px;border:1px solid #eee;font-weight:bold;">Month</td><td style="padding:10px;border:1px solid #eee;">${fee.month}</td></tr>
          <tr style="background:#f9f9f9;"><td style="padding:10px;border:1px solid #eee;font-weight:bold;">Transaction ID</td><td style="padding:10px;border:1px solid #eee;font-family:monospace;">${txnId}</td></tr>
          <tr style="background:#fff;"><td style="padding:10px;border:1px solid #eee;font-weight:bold;">Paid Via</td><td style="padding:10px;border:1px solid #eee;">${paidVia || 'UPI'}</td></tr>
          <tr style="background:#f9f9f9;"><td style="padding:10px;border:1px solid #eee;font-weight:bold;">Date</td><td style="padding:10px;border:1px solid #eee;">${today}</td></tr>
        </table>
        <p style="color:#999;font-size:12px;">— Devang Classes Management System</p>
      </div>
    `
    });
    res.json({ message: 'Payment confirmed and teacher notified.' });
  })
);

router.patch(
  '/fees/:id/mark-paid',
  requireTeacher,
  asyncHandler(async (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    await q(pool, `UPDATE fees SET status='paid', txn_id=?, paid_via='Manual', paid_on=? WHERE id=?`, [
      'MANUAL-' + Date.now().toString().slice(-6),
      today,
      req.params.id
    ]);
    res.json({ message: 'Marked as paid' });
  })
);

router.delete(
  '/fees/:id',
  requireTeacher,
  asyncHandler(async (req, res) => {
    await q(pool, 'DELETE FROM fees WHERE id=?', [req.params.id]);
    res.json({ message: 'Fee record deleted' });
  })
);

router.post(
  '/payments/generate',
  requireTeacher,
  asyncHandler(async (req, res) => {
    await expireOldPaymentRequests();
    const { studentId, amount, feeType, description, minutes = 15, feeId } = req.body;
    const cleanStudentId = String(studentId || '').trim().toUpperCase();

    if (!cleanStudentId || !amount) {
      return res.status(400).json({ error: 'studentId and amount are required' });
    }

    const student = await qOne(pool, `SELECT id, name FROM users WHERE id=? AND role='student'`, [cleanStudentId]);
    if (!student) return res.status(404).json({ error: 'Student not found. Use IDs like SC001.' });

    let feeRow;
    if (feeId) {
      feeRow = await qOne(pool, `SELECT * FROM fees WHERE id=? AND student_id=?`, [feeId, cleanStudentId]);
      if (!feeRow) return res.status(404).json({ error: 'Fee record not found for this student' });
    } else {
      const currentMonth = new Date().toISOString().slice(0, 7);
      const desc = description || feeType || 'Fee Payment';
      const ins = await qOne(
        pool,
        `INSERT INTO fees (student_id, amount, month, description, status) VALUES (?,?,?,?, 'pending') RETURNING id`,
        [cleanStudentId, amount, currentMonth, desc]
      );
      feeRow = await qOne(pool, `SELECT * FROM fees WHERE id=?`, [ins.id]);
    }

    await q(pool, `UPDATE payment_requests SET status='expired' WHERE fee_id=? AND status='active'`, [feeRow.id]);

    const expiry = new Date(Date.now() + Math.max(1, Math.min(Number(minutes) || 15, 30)) * 60 * 1000).toISOString();
    const upiId = process.env.UPI_ID || 'vaishnavinpatil1001@oksbi';
    const payeeName = encodeURIComponent(process.env.UPI_NAME || 'Vaishnavi Patil');
    const note = encodeURIComponent(description || feeType || feeRow.description || 'Fee Payment');
    const upiLink = `upi://pay?pa=${upiId}&pn=${payeeName}&am=${Number(amount)}&cu=INR&tn=${note}`;
    const qrCode = await QRCode.toDataURL(upiLink, { width: 256, margin: 2 });

    const insReq = await qOne(
      pool,
      `INSERT INTO payment_requests
      (fee_id, student_id, amount, fee_type, description, qr_code, upi_link, expires_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [
        feeRow.id,
        cleanStudentId,
        Number(amount),
        feeType || feeRow.description || 'Fee Payment',
        description || feeRow.description || 'Fee Payment',
        qrCode,
        upiLink,
        expiry,
        req.user.id
      ]
    );

    const payment = await qOne(
      pool,
      `SELECT pr.*, u.name AS student_name, f.month
       FROM payment_requests pr
       JOIN users u ON u.id = pr.student_id
       JOIN fees f ON f.id = pr.fee_id
       WHERE pr.id=?`,
      [insReq.id]
    );

    res.status(201).json({ message: 'Payment QR generated', payment });
  })
);

router.get(
  '/payments',
  requireAuth,
  asyncHandler(async (req, res) => {
    await expireOldPaymentRequests();
    const { status, studentId, feeId } = req.query;
    let sql = `
    SELECT pr.*, u.name AS student_name, f.month, f.description AS fee_description
    FROM payment_requests pr
    JOIN users u ON u.id = pr.student_id
    JOIN fees f ON f.id = pr.fee_id
    WHERE 1=1
  `;
    const params = [];

    if (req.user.role === 'student') {
      sql += ` AND pr.student_id=?`;
      params.push(req.user.id);
    } else if (studentId) {
      sql += ` AND pr.student_id=?`;
      params.push(String(studentId).trim());
    }

    if (status && status !== 'all') {
      sql += ` AND pr.status=?`;
      params.push(status);
    }

    if (feeId) {
      sql += ` AND pr.fee_id=?`;
      params.push(feeId);
    }

    sql += ` ORDER BY pr.created_at DESC`;
    res.json(await qAll(pool, sql, params));
  })
);

router.get(
  '/payments/active',
  requireAuth,
  asyncHandler(async (req, res) => {
    await expireOldPaymentRequests();
    const feeId = req.query.feeId ? Number(req.query.feeId) : null;
    const studentId = req.user.role === 'student' ? req.user.id : String(req.query.studentId || '').trim();
    if (!studentId) return res.status(400).json({ error: 'studentId is required' });

    let sql = `
    SELECT pr.*, u.name AS student_name, f.month, f.description AS fee_description
    FROM payment_requests pr
    JOIN users u ON u.id = pr.student_id
    JOIN fees f ON f.id = pr.fee_id
    WHERE pr.student_id=? AND pr.status='active'
  `;
    const params = [studentId];
    if (feeId) {
      sql += ` AND pr.fee_id=?`;
      params.push(feeId);
    }
    sql += ` ORDER BY pr.created_at DESC LIMIT 1`;
    const payment = await qOne(pool, sql, params);

    if (!payment) return res.json({ active: false, message: 'No active payment QR found' });
    res.json({ active: true, payment });
  })
);

router.patch(
  '/payments/:id/confirm',
  requireAuth,
  asyncHandler(async (req, res) => {
    await expireOldPaymentRequests();
    const { txnId, paidVia } = req.body;
    if (!txnId) return res.status(400).json({ error: 'Transaction ID / UTR number is required' });

    const payment = await qOne(
      pool,
      `SELECT pr.*, u.name AS student_name, u.email AS student_email, f.month
       FROM payment_requests pr
       JOIN users u ON u.id = pr.student_id
       JOIN fees f ON f.id = pr.fee_id
       WHERE pr.id=?`,
      [req.params.id]
    );

    if (!payment) return res.status(404).json({ error: 'Payment request not found' });
    if (req.user.role === 'student' && payment.student_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (payment.status !== 'active') {
      return res.status(400).json({ error: `Payment request is ${payment.status}` });
    }

    const nowIso = new Date().toISOString();
    const paidOn = nowIso.split('T')[0];
    const receiptNo = makeReceiptNo();

    await withTransaction(pool, async (cq) => {
      await cq(`UPDATE payment_requests SET status='paid', txn_id=?, paid_at=?, receipt_no=? WHERE id=?`, [
        txnId.trim(),
        nowIso,
        receiptNo,
        req.params.id
      ]);
      await cq(`UPDATE fees SET status='paid', txn_id=?, paid_via=?, paid_on=? WHERE id=?`, [
        txnId.trim(),
        paidVia || 'UPI QR',
        paidOn,
        payment.fee_id
      ]);
      await cq(`UPDATE payment_requests SET status='expired' WHERE fee_id=? AND status='active' AND id<>?`, [
        payment.fee_id,
        req.params.id
      ]);
    });

    await sendEmail({
      to: process.env.EMAIL_TO,
      subject: `💰 Payment Received — ${payment.student_name} | ₹${payment.amount}`,
      html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#f9f9f9;border-radius:12px;">
        <h2 style="color:#FF4D1C;margin-bottom:4px;">✅ QR Payment Confirmed</h2>
        <p style="color:#666;">A student confirmed a QR-based fee payment on Devang Classes portal.</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;">
          <tr style="background:#fff;"><td style="padding:10px;border:1px solid #eee;font-weight:bold;">Student</td><td style="padding:10px;border:1px solid #eee;">${payment.student_name} (${payment.student_id})</td></tr>
          <tr style="background:#f9f9f9;"><td style="padding:10px;border:1px solid #eee;font-weight:bold;">Amount</td><td style="padding:10px;border:1px solid #eee;color:#00C97A;font-size:18px;font-weight:bold;">₹${Number(payment.amount).toLocaleString()}</td></tr>
          <tr style="background:#fff;"><td style="padding:10px;border:1px solid #eee;font-weight:bold;">Month</td><td style="padding:10px;border:1px solid #eee;">${payment.month}</td></tr>
          <tr style="background:#f9f9f9;"><td style="padding:10px;border:1px solid #eee;font-weight:bold;">Transaction ID</td><td style="padding:10px;border:1px solid #eee;font-family:monospace;">${txnId.trim()}</td></tr>
          <tr style="background:#fff;"><td style="padding:10px;border:1px solid #eee;font-weight:bold;">Receipt No</td><td style="padding:10px;border:1px solid #eee;font-family:monospace;">${receiptNo}</td></tr>
          <tr style="background:#f9f9f9;"><td style="padding:10px;border:1px solid #eee;font-weight:bold;">Paid Via</td><td style="padding:10px;border:1px solid #eee;">${paidVia || 'UPI QR'}</td></tr>
          <tr style="background:#fff;"><td style="padding:10px;border:1px solid #eee;font-weight:bold;">Date</td><td style="padding:10px;border:1px solid #eee;">${paidOn}</td></tr>
        </table>
        <p style="color:#999;font-size:12px;">— Devang Classes Management System</p>
      </div>
    `
    });

    res.json({ message: 'Payment confirmed', receiptNo });
  })
);

// ═══════════════════════════════════════════════
//  AI QUIZ
// ═══════════════════════════════════════════════

router.post(
  '/quiz/generate',
  requireTeacher,
  asyncHandler(async (req, res) => {
    const { notes, subject, topic, count, difficulty, title } = req.body;

    if (!notes || notes.trim().length < 50) {
      return res.status(400).json({ error: 'Please provide at least 50 characters of content' });
    }

    if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === 'YOUR_KEY_HERE') {
      return res.status(503).json({
        error: 'AI service not configured. Please add GROQ_API_KEY to your .env file.'
      });
    }

    const prompt = `You are an expert ${subject} teacher. Based on the following study material, generate exactly ${count || 10} high-quality multiple choice questions (MCQs) for a ${difficulty || 'Medium'} level quiz on the topic "${topic || subject}".

STUDY MATERIAL:
${notes.trim()}

STRICT REQUIREMENTS:
1. Generate EXACTLY ${count || 10} MCQs
2. Each question must have exactly 4 options
3. Only ONE option is correct
4. Questions should be clear, unambiguous, and educationally valuable
5. Vary question types: conceptual, application, factual, analytical
6. Include a brief explanation for the correct answer

Return ONLY a valid JSON array in this exact format:
[
  {
    "q": "Question text?",
    "opts": ["Option A", "Option B", "Option C", "Option D"],
    "ans": 0,
    "exp": "Explanation for why this is correct"
  }
]`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Groq API error: ${errText}`);
    }

    const data = await response.json();
    const raw = (data.choices?.[0]?.message?.content || '').trim();

    let questions;
    try {
      questions = JSON.parse(raw);
    } catch {
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('AI returned unexpected format. Try again.');
      questions = JSON.parse(match[0]);
    }

    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error('No questions in AI response');
    }

    const finalTitle = title || `${subject} — ${topic || subject} Quiz (${new Date().toLocaleDateString('en-IN')})`;

    const result = await qOne(
      pool,
      `INSERT INTO quizzes (title, subject, topic, difficulty, questions, created_by)
       VALUES (?,?,?,?,?,?) RETURNING id`,
      [finalTitle, subject, topic || subject, difficulty || 'Medium', JSON.stringify(questions), req.user.id]
    );

    const newQuiz = await qOne(pool, 'SELECT * FROM quizzes WHERE id=?', [result.id]);
    newQuiz.questions = JSON.parse(newQuiz.questions);

    res.json(newQuiz);
  })
);

router.get(
  '/quizzes',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { subject } = req.query;
    let quizzes;
    if (subject && subject !== 'all') {
      quizzes = await qAll(pool, 'SELECT * FROM quizzes WHERE subject=? ORDER BY created_at DESC', [subject]);
    } else {
      quizzes = await qAll(pool, 'SELECT * FROM quizzes ORDER BY created_at DESC');
    }

    quizzes = quizzes.map((row) => ({
      ...row,
      questions: JSON.parse(row.questions || '[]')
    }));

    if (req.user.role === 'student') {
      quizzes = quizzes.map((row) => ({
        ...row,
        questions: row.questions.map(({ q: qu, opts }) => ({ q: qu, opts }))
      }));
    }

    res.json(quizzes);
  })
);

router.get(
  '/quizzes/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const quiz = await qOne(pool, 'SELECT * FROM quizzes WHERE id=?', [req.params.id]);
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

    quiz.questions = JSON.parse(quiz.questions);

    if (req.user.role === 'student') {
      quiz.questions = quiz.questions.map(({ q, opts }) => ({ q, opts }));
    }

    res.json(quiz);
  })
);

router.patch(
  '/quizzes/:id/send',
  requireTeacher,
  asyncHandler(async (req, res) => {
    const { sentTo, timeLimit, dueDate } = req.body;

    const r = await qExec(
      pool,
      `UPDATE quizzes
       SET sent = 1,
           sent_to = ?,
           time_limit = ?,
           due_date = ?
       WHERE id = ?`,
      [sentTo || 'all', Number(timeLimit) || 0, dueDate || null, req.params.id]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'Quiz not found' });
    }

    const updatedQuiz = await qOne(pool, 'SELECT * FROM quizzes WHERE id=?', [req.params.id]);

    res.json({
      message: 'Quiz sent to students',
      quiz: updatedQuiz
    });
  })
);

router.delete(
  '/quizzes/:id',
  requireTeacher,
  asyncHandler(async (req, res) => {
    await q(pool, 'DELETE FROM quiz_results WHERE quiz_id=?', [req.params.id]);
    await q(pool, 'DELETE FROM quizzes WHERE id=?', [req.params.id]);
    res.json({ message: 'Quiz deleted' });
  })
);

router.post(
  '/quiz-results',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { quizId, answers, timeTaken } = req.body;
    const existing = await qOne(pool, 'SELECT id FROM quiz_results WHERE quiz_id=? AND student_id=?', [quizId, req.user.id]);
    if (existing) return res.status(400).json({ error: 'You have already submitted this quiz' });

    const quiz = await qOne(pool, 'SELECT * FROM quizzes WHERE id=?', [quizId]);
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

    const questions = JSON.parse(quiz.questions);
    let score = 0;
    const answersMap = answers || {};
    questions.forEach((q, i) => {
      if (parseInt(answersMap[i], 10) === q.ans) score++;
    });
    const total = questions.length;
    const pct = Math.round((score / total) * 100);
    const grade = calcGrade(pct);

    const result = await qOne(
      pool,
      `INSERT INTO quiz_results (quiz_id, student_id, score, total, percentage, grade, time_taken, answers) VALUES (?,?,?,?,?,?,?,?) RETURNING id`,
      [quizId, req.user.id, score, total, pct, grade, timeTaken || '', JSON.stringify(answersMap)]
    );

    const fullQuestions = questions.map((q, i) => ({
      q: q.q,
      opts: q.opts,
      correct: q.ans,
      exp: q.exp,
      studentAnswer: parseInt(answersMap[i] ?? -1, 10),
      isCorrect: parseInt(answersMap[i], 10) === q.ans
    }));

    res.json({ id: result.id, score, total, percentage: pct, grade, timeTaken, questions: fullQuestions });
  })
);

router.get(
  '/quiz-results',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { quizId, studentId } = req.query;
    let sql = `SELECT qr.*, u.name as student_name, u.class as student_class FROM quiz_results qr JOIN users u ON qr.student_id = u.id WHERE 1=1`;
    const params = [];
    if (quizId) {
      sql += ' AND qr.quiz_id = ?';
      params.push(quizId);
    }
    if (studentId) {
      sql += ' AND qr.student_id = ?';
      params.push(studentId);
    }
    if (req.user.role === 'student') {
      sql += ' AND qr.student_id = ?';
      params.push(req.user.id);
    }
    sql += ' ORDER BY qr.submitted_at DESC';
    const results = await qAll(pool, sql, params);
    res.json(results);
  })
);

router.get(
  '/quiz-results/analytics/:quizId',
  requireTeacher,
  asyncHandler(async (req, res) => {
    const results = await qAll(
      pool,
      `SELECT qr.*, u.name as student_name FROM quiz_results qr JOIN users u ON qr.student_id=u.id WHERE qr.quiz_id=? ORDER BY qr.percentage DESC`,
      [req.params.quizId]
    );
    if (!results.length) return res.json({ results: [], analytics: null });
    const pcts = results.map((r) => r.percentage);
    const avg = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
    const grades = { 'A+': 0, A: 0, B: 0, C: 0, F: 0 };
    results.forEach((r) => {
      if (grades[r.grade] !== undefined) grades[r.grade]++;
    });
    res.json({
      results,
      analytics: {
        avg,
        highest: Math.max(...pcts),
        lowest: Math.min(...pcts),
        pass: pcts.filter((p) => p >= 40).length,
        total: results.length,
        grades
      }
    });
  })
);

router.get(
  '/feedback',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { studentId } = req.query;
    let rows;
    if (studentId || req.user.role === 'student') {
      rows = await qAll(pool, 'SELECT * FROM feedback WHERE student_id=? ORDER BY created_at DESC', [studentId || req.user.id]);
    } else {
      rows = await qAll(pool, 'SELECT * FROM feedback ORDER BY created_at DESC');
    }
    res.json(rows);
  })
);

router.post(
  '/feedback',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { subject, rating, message } = req.body;
    if (!rating || !message) return res.status(400).json({ error: 'Rating and message are required' });
    if (rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1–5' });
    await q(pool, `INSERT INTO feedback (student_id, student_name, subject, rating, message) VALUES (?,?,?,?,?)`, [
      req.user.id,
      req.user.name,
      subject || 'General',
      rating,
      message.trim()
    ]);
    res.status(201).json({ message: 'Feedback submitted. Thank you!' });
  })
);

router.get(
  '/feedback/stats',
  requireTeacher,
  asyncHandler(async (req, res) => {
    const totalRow = await qOne(pool, 'SELECT COUNT(*)::int AS n FROM feedback');
    const avgRow = await qOne(pool, 'SELECT AVG(rating) as avg FROM feedback');
    const positiveRow = await qOne(pool, 'SELECT COUNT(*)::int AS n FROM feedback WHERE rating >= 4');
    res.json({
      total: totalRow.n,
      avg: parseFloat((avgRow.avg || 0).toFixed(1)),
      positive: positiveRow.n
    });
  })
);

router.get(
  '/dashboard/stats',
  requireTeacher,
  asyncHandler(async (req, res) => {
    const students = (await qOne(pool, "SELECT COUNT(*)::int AS n FROM users WHERE role='student'")).n;
    const feePaid = (await qOne(pool, "SELECT COALESCE(SUM(amount),0)::bigint AS n FROM fees WHERE status='paid'")).n;
    const feePending = (await qOne(pool, "SELECT COALESCE(SUM(amount),0)::bigint AS n FROM fees WHERE status='pending'")).n;
    const quizCount = (await qOne(pool, 'SELECT COUNT(*)::int AS n FROM quizzes')).n;
    const subCount = (await qOne(pool, 'SELECT COUNT(*)::int AS n FROM quiz_results')).n;
    const fbAvg = (await qOne(pool, 'SELECT AVG(rating) as n FROM feedback')).n;
    res.json({
      students,
      feePaid: Number(feePaid),
      feePending: Number(feePending),
      quizCount,
      subCount,
      fbAvg: parseFloat((fbAvg || 0).toFixed(1))
    });
  })
);

router.get(
  '/qr',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { amount } = req.query;
    const upiId = 'vaishnavinpatil1001@oksbi';
    const name = 'Vaishnavi Patil';
    const upiUrl = `upi://pay?pa=${upiId}&pn=${name}&am=${amount || 0}&cu=INR&tn=TuitionFees`;
    try {
      const qrDataURL = await QRCode.toDataURL(upiUrl, { width: 256, margin: 2, color: { dark: '#0D0D1A', light: '#FFFFFF' } });
      res.json({ qr: qrDataURL, upiUrl, upiId });
    } catch (e) {
      res.status(500).json({ error: 'QR generation failed' });
    }
  })
);

export default router;
