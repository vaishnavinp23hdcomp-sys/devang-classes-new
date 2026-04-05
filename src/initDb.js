// Run once: npm run init-db  — creates PostgreSQL schema and seeds teacher user
// Full wipe + reseed: npm run reset-db
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import pool from "./db.js";
import { q } from "./pgQuery.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT UNIQUE NOT NULL,
  phone      TEXT,
  password   TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'student',
  class      TEXT,
  subjects   TEXT,
  parent     TEXT,
  parent_phone TEXT,
  parent_phone_verified INTEGER DEFAULT 0,
  parent_email TEXT,
  parent_email_verified INTEGER DEFAULT 0,
  parent_email_otp TEXT,
  parent_email_otp_expires TEXT,
  email_verified INTEGER DEFAULT 1,
  otp_code    TEXT,
  otp_expires TEXT,
  reset_otp TEXT,
  reset_otp_expires TEXT,
  parent_phone_otp TEXT,
  parent_phone_otp_expires TEXT,
  address    TEXT,
  status     TEXT DEFAULT 'active',
  joined     TEXT DEFAULT (CURRENT_DATE::TEXT),
  created_at TEXT DEFAULT (NOW()::TEXT)
);

CREATE TABLE IF NOT EXISTS schedules (
  id       SERIAL PRIMARY KEY,
  subject  TEXT NOT NULL,
  day      TEXT NOT NULL,
  time     TEXT NOT NULL,
  duration INTEGER DEFAULT 60,
  class    TEXT,
  notes    TEXT,
  created_at TEXT DEFAULT (NOW()::TEXT)
);

CREATE TABLE IF NOT EXISTS attendance (
  id         SERIAL PRIMARY KEY,
  student_id TEXT NOT NULL,
  subject    TEXT NOT NULL,
  date       TEXT NOT NULL,
  status     TEXT NOT NULL CHECK(status IN ('present','absent')),
  marked_by  TEXT DEFAULT 'teacher',
  created_at TEXT DEFAULT (NOW()::TEXT),
  UNIQUE(student_id, subject, date),
  FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS materials (
  id          SERIAL PRIMARY KEY,
  subject     TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  filename    TEXT,
  original_name TEXT,
  file_size   TEXT,
  file_url    TEXT,
  for_class   TEXT DEFAULT 'All Classes',
  uploaded_by TEXT,
  created_at  TEXT DEFAULT (NOW()::TEXT)
);

CREATE TABLE IF NOT EXISTS fees (
  id         SERIAL PRIMARY KEY,
  student_id TEXT NOT NULL,
  amount     INTEGER NOT NULL,
  month      TEXT NOT NULL,
  description TEXT DEFAULT 'Monthly Tuition',
  status     TEXT DEFAULT 'pending' CHECK(status IN ('pending','paid')),
  txn_id     TEXT,
  paid_via   TEXT,
  paid_on    TEXT,
  created_at TEXT DEFAULT (NOW()::TEXT),
  FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payment_requests (
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
);

CREATE TABLE IF NOT EXISTS quizzes (
  id           SERIAL PRIMARY KEY,
  title        TEXT NOT NULL,
  subject      TEXT NOT NULL,
  topic        TEXT,
  difficulty   TEXT DEFAULT 'Medium',
  questions    TEXT NOT NULL,
  sent         INTEGER DEFAULT 0,
  sent_to      TEXT,
  time_limit   INTEGER DEFAULT 0,
  due_date     TEXT,
  created_by   TEXT,
  created_at   TEXT DEFAULT (NOW()::TEXT)
);

CREATE TABLE IF NOT EXISTS quiz_results (
  id          SERIAL PRIMARY KEY,
  quiz_id     INTEGER NOT NULL,
  student_id  TEXT NOT NULL,
  score       INTEGER NOT NULL,
  total       INTEGER NOT NULL,
  percentage  INTEGER NOT NULL,
  grade       TEXT,
  time_taken  TEXT,
  answers     TEXT,
  submitted_at TEXT DEFAULT (NOW()::TEXT),
  UNIQUE(quiz_id, student_id),
  FOREIGN KEY(quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE,
  FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS feedback (
  id           SERIAL PRIMARY KEY,
  student_id   TEXT NOT NULL,
  student_name TEXT NOT NULL,
  subject      TEXT,
  rating       INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  message      TEXT NOT NULL,
  created_at   TEXT DEFAULT (NOW()::TEXT),
  FOREIGN KEY(student_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id);
CREATE INDEX IF NOT EXISTS idx_fees_student ON fees(student_id);
CREATE INDEX IF NOT EXISTS idx_quiz_results_quiz ON quiz_results(quiz_id);
`;

export async function runInit() {
  console.log("📦 Creating PostgreSQL schema...");
  await pool.query(SCHEMA);

  const teacherPass = bcrypt.hashSync("Devang@123", 10);
  await q(
    pool,
    `INSERT INTO users (id, name, email, phone, password, role, class, subjects, parent, address, joined, email_verified)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (id) DO NOTHING`,
    [
      "TEACHER_01",
      "Narendra Vartak",
      "Devangclassesadmin@gmail.com",
      "8828708098",
      teacherPass,
      "teacher",
      null,
      JSON.stringify(["Maths", "Biology", "Physics", "English", "Chemistry"]),
      null,
      "Govathane, Uran 410206",
      "2026-04-01",
      1,
    ],
  );

  const schedules = [
    ["Maths", "Monday", "09:00", 90, "Class 10", ""],
    ["Physics", "Monday", "11:00", 60, "Class 11 Science", ""],
    [
      "Biology",
      "Tuesday",
      "09:00",
      90,
      "Class 11 Science",
      "Bring lab notebook",
    ],
    ["Chemistry", "Tuesday", "11:30", 60, "Class 10", ""],
    ["English", "Wednesday", "10:00", 60, "Class 10", ""],
    ["Maths", "Thursday", "09:00", 90, "Class 12 Science", "Unit test today"],
    ["Chemistry", "Friday", "09:00", 90, "All Classes", ""],
    ["Biology", "Saturday", "10:00", 60, "Class 12 Science", ""],
  ];
  const { rows: sc } = await pool.query(
    "SELECT COUNT(*)::int AS n FROM schedules",
  );
  if (sc[0].n === 0) {
    for (const s of schedules) {
      await q(
        pool,
        `INSERT INTO schedules (subject, day, time, duration, class, notes) VALUES (?,?,?,?,?,?)`,
        s,
      );
    }
  }

  const mats = [
    [
      "Maths",
      "Quadratic Equations — Complete Notes",
      "Detailed notes with solved examples, formulas, and practice problems",
      "quadratic.pdf",
      "quadratic_equations.pdf",
      "2.3 MB",
      "Class 10",
    ],
    [
      "Physics",
      "Laws of Motion — Chapter 4",
      "Newton's laws, friction, circular motion",
      "motion.pdf",
      "laws_of_motion.pdf",
      "1.8 MB",
      "Class 11 Science",
    ],
    [
      "Biology",
      "Cell Structure & Function",
      "Cell organelles, cell division, osmosis",
      "cell.pdf",
      "cell_biology.pdf",
      "3.4 MB",
      "Class 11 Science",
    ],
    [
      "Chemistry",
      "Periodic Table & Chemical Bonding",
      "Periodic trends, ionic and covalent bonds",
      "periodic.pdf",
      "periodic_chem.pdf",
      "2.1 MB",
      "All Classes",
    ],
    [
      "English",
      "Grammar Workbook — All Tenses",
      "All 12 tenses with examples and exercises",
      "grammar.pdf",
      "grammar_tenses.pdf",
      "1.2 MB",
      "Class 10",
    ],
  ];
  const { rows: mc } = await pool.query(
    "SELECT COUNT(*)::int AS n FROM materials",
  );
  if (mc[0].n === 0) {
    for (const m of mats) {
      await q(
        pool,
        `INSERT INTO materials (subject, title, description, filename, original_name, file_size, for_class) VALUES (?,?,?,?,?,?,?)`,
        m,
      );
    }
  }

  console.log("");
  console.log("✅ Database initialized successfully!");
  console.log("");
  console.log("👩‍🏫 Teacher Login:");
  console.log("   Email   : Devangclassesadmin@gmail.com");
  console.log("   Password: Devangclasses@123");
  console.log("");
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMain) {
  runInit()
    .then(() => pool.end())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
