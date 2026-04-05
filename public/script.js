/* ═══════════════════════════════════════════════
   DEVANG CLASSES — script.js
   Complete frontend application logic
   All API calls go through the Express backend.
═══════════════════════════════════════════════ */

"use strict";

// ─── API CLIENT ───────────────────────────────────────────────────────────────
const API = {
  token: localStorage.getItem("sc_token") || null,

  headers() {
    const h = { "Content-Type": "application/json" };
    if (this.token) h["Authorization"] = "Bearer " + this.token;
    return h;
  },

  async request(method, path, body = null, isFormData = false) {
    const opts = {
      method,
      headers: isFormData
        ? { Authorization: "Bearer " + this.token }
        : this.headers(),
    };
    if (body) opts.body = isFormData ? body : JSON.stringify(body);
    try {
      const res = await fetch("/api" + path, opts);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Server error");
      return data;
    } catch (e) {
      throw e;
    }
  },

  get: (path) => API.request("GET", path),
  post: (path, body) => API.request("POST", path, body),
  patch: (path, body) => API.request("PATCH", path, body),
  delete: (path) => API.request("DELETE", path),
  upload: (path, fd) => API.request("POST", path, fd, true),
};

// ─── STATE ────────────────────────────────────────────────────────────────────
const S = {
  user: null,
  role: null,
  currentRating: 0,
  currentPayFeeId: null,
  currentQuizId: null,
  currentSendQuizId: null,
  quizAnswers: {},
  quizStartTime: null,
  quizTimerRef: null,
  selectedFile: null,
  paymentTimer: null,
  currentPaymentRequestId: null,
  currentParentReportStudentId: null,
  attState: {}, // { studentId: 'present'|'absent' }
};

// ─── MODAL HELPERS ────────────────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add("open");
}
function closeModal(id) {
  document.getElementById(id).classList.remove("open");
}

function overlayClick(e, id) {
  if (e.target === document.getElementById(id)) closeModal(id);
}
// Attach overlay click to close on backdrop click
document.querySelectorAll(".overlay").forEach((el) => {
  el.addEventListener("click", (e) => {
    if (e.target === el) el.classList.remove("open");
  });
});

// ─── TAB SWITCHING (scoped — fixes the global .on bug) ───────────────────────
function switchTab(tabRowId, targetPaneId, btn) {
  const tabRow = document.getElementById(tabRowId);
  if (!tabRow) return;
  tabRow.querySelectorAll(".tab-pill").forEach((b) => b.classList.remove("on"));
  btn.classList.add("on");
  // Find closest modal or parent container to scope pane search
  const container = tabRow.closest(".modal") || tabRow.parentElement;
  container
    .querySelectorAll(".tab-pane")
    .forEach((p) => p.classList.remove("on"));
  const target = document.getElementById(targetPaneId);
  if (target) target.classList.add("on");
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function toast(msg, type = "info") {
  const wrap = document.getElementById("toast-wrap");
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.animation = "toastOut 0.3s ease forwards";
    setTimeout(() => el.remove(), 300);
  }, 3600);
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const val = (id) => ($(id) ? $(id).value : "");
const todayStr = () => new Date().toISOString().split("T")[0];
const calcGrade = (p) =>
  p >= 90 ? "A+" : p >= 80 ? "A" : p >= 70 ? "B" : p >= 55 ? "C" : "F";
const subjectClass = (s) => "c-" + (s || "").toLowerCase().replace(/\s+/g, "");
const emptyState = (icon, msg, sub = "") =>
  `<div class="empty"><div class="empty-icon">${icon}</div><h4>${msg}</h4>${sub ? `<p>${sub}</p>` : ""}</div>`;

// file helpers
function handleFileSelect(e) {
  S.selectedFile = e.target.files[0];
  if (S.selectedFile)
    $("sel-file-name").textContent = "📄 " + S.selectedFile.name;
}
function handleFileDrop(e) {
  e.preventDefault();
  document.getElementById("upload-zone").classList.remove("drag");
  S.selectedFile = e.dataTransfer.files[0];
  if (S.selectedFile)
    $("sel-file-name").textContent = "📄 " + S.selectedFile.name;
}

// ─── CLOCK ────────────────────────────────────────────────────────────────────
function startClock() {
  const update = () => {
    const now = new Date();
    const el = $("topbar-time");
    if (el)
      el.textContent =
        now.toLocaleDateString("en-IN", {
          weekday: "long",
          day: "numeric",
          month: "long",
        }) +
        " • " +
        now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  };
  update();
  setInterval(update, 30000);
}

// ─── PAGE CONFIG ──────────────────────────────────────────────────────────────
const PAGE_META = {
  dashboard: { title: "Dashboard", sub: "Overview of Devang Classes today" },
  students: { title: "Students", sub: "All enrolled students" },
  schedule: { title: "Class Schedule", sub: "Weekly timetable" },
  attendance: {
    title: "Attendance Tracker",
    sub: "Mark & track daily attendance",
  },
  materials: {
    title: "Study Materials",
    sub: "Upload & manage learning resources",
  },
  quizzes: { title: "AI Quiz Generator", sub: "Generate AI-powered quizzes" },
  fees: { title: "Fees Management", sub: "Track payments & dues" },
  feedback: { title: "Reviews & Feedback", sub: "Student reviews & ratings" },
  "parent-reports": {
    title: "Student Reports",
    sub: "View student progress and send student reports",
  },
  "s-dashboard": { title: "My Dashboard", sub: "Your learning overview" },
  "s-schedule": { title: "Class Schedule", sub: "Your personalized timetable" },
  "s-materials": {
    title: "Study Materials",
    sub: "Resources shared by teacher",
  },
  "s-quizzes": { title: "Quizzes & Results", sub: "Take tests & view results" },
  "s-fees": { title: "My Fees", sub: "View & pay fees online" },
  "s-feedback": { title: "Feedback", sub: "Share your experience" },
};

// ─── NAV ──────────────────────────────────────────────────────────────────────
const RENDER_MAP = {}; // populated below in App

// ═══════════════════════════════════════════════
// THE MAIN APP OBJECT
// ═══════════════════════════════════════════════
async function downloadMaterial(filename, originalName) {
  try {
    const res = await fetch(
      `/api/materials/download/${encodeURIComponent(filename)}`,
      {
        method: "GET",
        headers: {
          Authorization: "Bearer " + (localStorage.getItem("sc_token") || ""),
        },
      },
    );

    if (!res.ok) {
      let msg = "Download failed";
      try {
        const data = await res.json();
        msg = data.error || msg;
      } catch {}
      throw new Error(msg);
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = originalName || filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    window.URL.revokeObjectURL(url);
  } catch (err) {
    toast(err.message || "Unable to download file", "error");
  }
}
const App = {
  // ── AUTH ────────────────────────────────────

  async verifyOtp() {
    try {
      const email = val("otp-email");
      const otp = val("otp-code").trim();

      if (!otp) {
        toast("Please enter the OTP", "warn");
        return;
      }

      if (otp.length !== 6) {
        toast("OTP must be 6 digits", "warn");
        return;
      }

      const data = await API.post("/auth/verify-otp", { email, otp });

      closeModal("modal-otp-verify");
      toast(data.message || "Email verified successfully!", "success");
      openModal("modal-student-login");
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async resendOtp() {
    try {
      const email = val("otp-email");
      if (!email) {
        toast("Email not found", "error");
        return;
      }
      const data = await API.post("/auth/resend-otp", { email });
      if (data.devOtp) {
        $("otp-code").value = data.devOtp;
        toast(`Demo OTP: ${data.devOtp}`, "info");
      }
      toast(data.message || "OTP resent successfully!", "success");
    } catch (e) {
      toast(e.message, "error");
    }
  },

  openForgotPassword(role) {
    $("fp-role").value = role || "student";
    $("fp-email").value = role === "teacher" ? "Devangclassesadmin" : "";
    $("fp-otp").value = "";
    $("fp-new-pass").value = "";
    openModal("modal-forgot-password");
  },

  async sendResetOtp() {
    try {
      const email = val("fp-email").trim();
      if (!email) {
        toast("Please enter email or student ID", "warn");
        return;
      }
      const data = await API.post("/auth/forgot-password", { email });
      if (data.devOtp) {
        $("fp-demo-otp").value = data.devOtp;
        $("fp-otp").value = data.devOtp;
        toast(`Demo reset OTP: ${data.devOtp}`, "info");
      }
      toast(data.message || "Reset OTP sent", "success");
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async resetPassword() {
    try {
      const email = val("fp-email").trim();
      const otp = val("fp-otp").trim();
      const newPassword = val("fp-new-pass");
      if (!email || !otp || !newPassword) {
        toast("Please fill email, OTP and new password", "warn");
        return;
      }
      const data = await API.post("/auth/reset-password", {
        email,
        otp,
        newPassword,
      });
      closeModal("modal-forgot-password");
      toast(data.message || "Password reset successful", "success");
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async sendParentOtp() {
    try {
      const parentEmail = val("r-parent-email").trim().toLowerCase();
      if (!parentEmail) {
        toast("Enter parent email", "warn");
        return;
      }
      const data = await API.post("/auth/send-parent-email-otp", {
        parentEmail,
      });
      $("parent-otp-email").value = parentEmail;
      $("parent-otp-code").value = "";
      $("r-parent-verified").value = "0";
      $("r-parent-verify-status").textContent =
        "Parent email OTP sent. Please complete verification.";
      openModal("modal-parent-verify");
      toast(data.message || "Parent email OTP sent", "success");
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async verifyParentOtp() {
    try {
      const parentEmail = val("parent-otp-email").trim().toLowerCase();
      const otp = val("parent-otp-code").trim();
      if (!otp) {
        toast("Enter the parent email OTP", "warn");
        return;
      }
      const data = await API.post("/auth/verify-parent-email-otp", {
        parentEmail,
        otp,
      });
      $("r-parent-verified").value = "1";
      $("r-parent-verify-status").textContent =
        `Parent email verified ✓ ${val("r-parent-email")}`;
      closeModal("modal-parent-verify");
      toast(data.message || "Parent email verified", "success");
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async teacherLogin() {
    try {
      const data = await API.post("/auth/login", {
        email: val("t-email"),
        password: val("t-pass"),
      });
      API.token = data.token;
      localStorage.setItem("sc_token", data.token);
      S.user = data.user;
      S.role = "teacher";
      closeModal("modal-teacher");
      App.launchApp();
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async studentLogin() {
    try {
      const data = await API.post("/auth/login", {
        email: val("s-email"),
        password: val("s-pass"),
      });
      API.token = data.token;
      localStorage.setItem("sc_token", data.token);
      S.user = data.user;
      S.role = "student";
      closeModal("modal-student-login");
      App.launchApp();
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async registerStudent() {
    const fname = val("r-fname"),
      lname = val("r-lname");
    const subjects = Array.from($("r-subjects").selectedOptions).map(
      (o) => o.value,
    );

    if (
      !fname ||
      !val("r-email") ||
      !val("r-pass") ||
      !val("r-class") ||
      subjects.length === 0
    ) {
      toast(
        "Please fill all required fields and select at least one subject.",
        "warn",
      );
      return;
    }
    if (!/^\d{10}$/.test(val("r-phone").trim())) {
      toast("Enter a valid 10-digit student mobile number", "warn");
      return;
    }
    if (!/^\d{10}$/.test(val("r-parent-phone").trim())) {
      toast("Enter a valid 10-digit parent mobile number", "warn");
      return;
    }
    if (!val("r-parent-email").trim()) {
      toast("Enter parent email", "warn");
      return;
    }
    if (val("r-parent-verified") !== "1") {
      toast("Please verify the parent email before registration", "warn");
      return;
    }

    try {
      const data = await API.post("/auth/register", {
        name: (fname + " " + lname).trim(),
        email: val("r-email"),
        phone: val("r-phone"),
        password: val("r-pass"),
        class: val("r-class"),
        subjects,
        parent: val("r-parent"),
        parentPhone: val("r-parent-phone"),
        parentEmail: val("r-parent-email"),
        parentEmailVerified: true,
        address: val("r-addr"),
      });

      closeModal("modal-student-reg");
      $("otp-email").value = data.email;
      $("otp-code").value = data.devOtp || "";
      if (data.devOtp) toast(`Demo email OTP: ${data.devOtp}`, "info");
      openModal("modal-otp-verify");
      toast(`Registration successful! ${data.message}`, "success");
      App.refreshLandingStat();
    } catch (e) {
      toast(e.message, "error");
    }
  },
  logout() {
    API.token = null;
    localStorage.removeItem("sc_token");
    S.user = null;
    S.role = null;
    $("app").style.display = "none";
    $("landing").style.display = "flex";
    toast("Logged out. See you soon! 👋");
  },

  // ── APP LAUNCH ──────────────────────────────

  launchApp() {
    $("landing").style.display = "none";
    $("app").style.display = "block";
    const av = $("sb-av");
    av.textContent = S.user.name.charAt(0).toUpperCase();
    av.className = "sb-av " + (S.role === "teacher" ? "av-t" : "av-s");
    $("sb-uname").textContent = S.user.name;
    $("sb-urole").textContent =
      S.role === "teacher"
        ? "👩‍🏫 Teacher & Administrator"
        : "🎓 Student — " + (S.user.class || "");
    App.buildSidebar();
    startClock();
    App.navTo(S.role === "teacher" ? "dashboard" : "s-dashboard");
  },

  buildSidebar() {
    const isT = S.role === "teacher";
    const defs = isT
      ? [
          {
            sec: "OVERVIEW",
            items: [{ icon: "📊", lbl: "Dashboard", pg: "dashboard" }],
          },
          {
            sec: "ACADEMICS",
            items: [
              { icon: "👨‍🎓", lbl: "Students", pg: "students" },
              { icon: "📅", lbl: "Schedule", pg: "schedule" },
              { icon: "✅", lbl: "Attendance", pg: "attendance" },
              { icon: "📚", lbl: "Study Materials", pg: "materials" },
            ],
          },
          {
            sec: "TOOLS",
            items: [
              { icon: "🤖", lbl: "AI Quiz Generator", pg: "quizzes" },
              { icon: "💰", lbl: "Fees Management", pg: "fees" },
              { icon: "⭐", lbl: "Reviews & Feedback", pg: "feedback" },
              { icon: "📝", lbl: "Student Report", pg: "parent-reports" },
            ],
          },
        ]
      : [
          {
            sec: "MY LEARNING",
            items: [
              { icon: "🏠", lbl: "Dashboard", pg: "s-dashboard" },
              { icon: "📅", lbl: "Class Schedule", pg: "s-schedule" },
              { icon: "📚", lbl: "Study Materials", pg: "s-materials" },
              { icon: "📝", lbl: "Quizzes & Results", pg: "s-quizzes" },
            ],
          },
          {
            sec: "ACCOUNT",
            items: [
              { icon: "💳", lbl: "My Fees", pg: "s-fees" },
              { icon: "💬", lbl: "Feedback", pg: "s-feedback" },
            ],
          },
        ];
    $("sb-nav").innerHTML = defs
      .map(
        (sec) => `
      <div class="sb-sec">
        <div class="sb-sec-label">${sec.sec}</div>
        ${sec.items
          .map(
            (it) => `
          <div class="sb-item" id="sbi-${it.pg}" onclick="App.navTo('${it.pg}')">
            <span class="sb-icon">${it.icon}</span>${it.lbl}
          </div>
        `,
          )
          .join("")}
      </div>
    `,
      )
      .join("");
  },

  async navTo(pg) {
    document.querySelectorAll(".pg").forEach((p) => p.classList.remove("on"));
    document
      .querySelectorAll(".sb-item")
      .forEach((i) => i.classList.remove("active"));
    const pageEl = $("pg-" + pg);
    if (pageEl) pageEl.classList.add("on");
    const sbEl = $("sbi-" + pg);
    if (sbEl) sbEl.classList.add("active");
    const meta = PAGE_META[pg] || {};
    $("topbar-title").textContent = meta.title || pg;
    $("topbar-sub").textContent = meta.sub || "";
    const renders = {
      dashboard: App.renderDashboard,
      students: App.renderStudents,
      schedule: App.renderSchedule,
      attendance: App.renderAttendancePage,
      materials: App.renderMaterials,
      quizzes: App.renderQuizzes,
      fees: App.renderFees,
      feedback: App.renderFeedback,
      "parent-reports": App.renderParentReports,
      "s-dashboard": App.renderStudentDash,
      "s-schedule": App.renderStudentSchedule,
      "s-materials": App.renderStudentMaterials,
      "s-quizzes": App.renderStudentQuizzes,
      "s-fees": App.renderStudentFees,
      "s-feedback": App.renderStudentFeedback,
    };
    if (renders[pg]) await renders[pg]();
  },

  // ── DASHBOARD ───────────────────────────────

  async renderDashboard() {
    try {
      const [stats, fees, quizzes, feedback, schedules, results] =
        await Promise.all([
          API.get("/dashboard/stats"),
          API.get("/fees?status=pending"),
          API.get("/quizzes"),
          API.get("/feedback"),
          API.get("/schedules"),
          API.get("/quiz-results"),
        ]);
      $("dash-stats").innerHTML = `
        <div class="stat-card sc-flame"><div class="stat-icon">👨‍🎓</div><div class="stat-val">${stats.students}</div><div class="stat-label">Total Students</div></div>
        <div class="stat-card sc-success"><div class="stat-icon">💰</div><div class="stat-val">₹${stats.feePaid.toLocaleString()}</div><div class="stat-label">Fees Collected</div></div>
        <div class="stat-card sc-lilac"><div class="stat-icon">⏳</div><div class="stat-val" style="color:var(--danger)">₹${stats.feePending.toLocaleString()}</div><div class="stat-label">Fees Pending</div></div>
        <div class="stat-card sc-gold"><div class="stat-icon">🤖</div><div class="stat-val">${stats.quizCount}</div><div class="stat-label">Quizzes</div></div>
        <div class="stat-card sc-aqua"><div class="stat-icon">⭐</div><div class="stat-val">${stats.fbAvg || "—"}</div><div class="stat-label">Avg Rating</div></div>
      `;
      // Pending fees
      $("dash-fees").innerHTML = fees.length
        ? `
        <table><thead><tr><th>Student</th><th>Month</th><th>Amount</th></tr></thead>
        <tbody>${fees
          .slice(0, 5)
          .map(
            (f) => `<tr>
          <td class="td-main">${f.student_name}</td>
          <td>${f.month}</td>
          <td style="font-weight:800;color:var(--danger)">₹${f.amount.toLocaleString()}</td>
        </tr>`,
          )
          .join("")}</tbody></table>
      `
        : emptyState("✅", "No pending fees!");

      // Today schedule
      const days = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ];
      const today = days[new Date().getDay()];
      $("dash-today-label").textContent = today;
      const todaySched = schedules.filter((s) => s.day === today);
      $("dash-sched").innerHTML = todaySched.length
        ? `
        <table><thead><tr><th>Subject</th><th>Time</th><th>Duration</th><th>Class</th></tr></thead>
        <tbody>${todaySched
          .map(
            (s) => `<tr>
          <td><span class="chip ${subjectClass(s.subject)}">${s.subject}</span></td>
          <td style="font-weight:700">${s.time}</td><td>${s.duration} min</td><td>${s.class}</td>
        </tr>`,
          )
          .join("")}</tbody></table>
      `
        : emptyState("🎉", `No classes today (${today})`);

      // Recent quizzes
      $("dash-quizzes").innerHTML = quizzes.length
        ? quizzes
            .slice(0, 4)
            .map((q) => {
              const subs = results.filter((r) => r.quiz_id === q.id).length;
              return `<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid #F4F2FF;">
          <div><div style="font-weight:700;font-size:14px;">${q.title}</div><div class="text-muted" style="font-size:12px;">${q.subject} • ${q.questions.length} Qs</div></div>
          <div style="text-align:right;"><span class="badge ${q.sent ? "b-success" : "b-warn"}">${q.sent ? "Sent" : "Draft"}</span><div class="text-muted" style="font-size:11px;margin-top:3px;">${subs} submissions</div></div>
        </div>`;
            })
            .join("")
        : emptyState("🤖", "No quizzes yet");

      $("dash-feedback").innerHTML =
        feedback
          .slice(0, 2)
          .map(
            (f) => `
        <div style="padding:12px 0;border-bottom:1px solid #F4F2FF;">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
            <span style="font-weight:700;font-size:13px;">${f.student_name}</span>
            <span style="color:var(--gold)">${"★".repeat(f.rating)}</span>
          </div>
          <p style="font-size:13px;color:var(--muted);line-height:1.5;">${f.message.slice(0, 90)}${f.message.length > 90 ? "..." : ""}</p>
        </div>
      `,
          )
          .join("") || emptyState("⭐", "No feedback yet");
    } catch (e) {
      toast("Dashboard load failed: " + e.message, "error");
    }
  },

  // ── STUDENTS ────────────────────────────────

  async renderStudents(q = "") {
    try {
      const students = await API.get(
        "/students" + (q ? "?q=" + encodeURIComponent(q) : ""),
      );
      $("student-count-label").textContent =
        `${students.length} student${students.length !== 1 ? "s" : ""}`;
      $("students-tbl").innerHTML = students.length
        ? `
        <table>
          <thead><tr><th>ID</th><th>Student</th><th>Class</th><th>Subjects</th><th>Mobile</th><th>Parent</th><th>Parent Mobile</th><th>Joined</th><th>Action</th></tr></thead>
          <tbody>${students
            .map(
              (s) => `<tr>
            <td style="font-weight:800;color:var(--flame);font-size:13px;">${s.id}</td>
            <td><div class="td-main">${s.name}</div><div class="td-sub">${s.email}</div></td>
            <td>${s.class}</td>
            <td>${s.subjects.map((sub) => `<span class="chip ${subjectClass(sub)}">${sub}</span>`).join("")}</td>
            <td>${s.phone}</td><td>${s.parent || "—"}</td><td>${s.parent_phone || "—"} ${s.parent_phone_verified ? "✅" : ""}</td><td>${s.joined}</td>
            <td><button class="btn btn-sm btn-danger" onclick="App.deleteStudent('${s.id}')">Remove</button></td>
          </tr>`,
            )
            .join("")}</tbody>
        </table>
      `
        : emptyState("🔍", "No students match your search");
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async deleteStudent(id) {
    if (!confirm("Remove this student? This cannot be undone.")) return;
    try {
      await API.delete("/students/" + id);
      await App.renderStudents();
      toast("Student removed.", "warn");
    } catch (e) {
      toast(e.message, "error");
    }
  },

  // ── SCHEDULE ────────────────────────────────

  async renderSchedule() {
    try {
      const schedules = await API.get("/schedules");
      const days = [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ];
      const times = [...new Set(schedules.map((s) => s.time))].sort();
      if (!times.length) {
        $("schedule-view").innerHTML = emptyState(
          "📅",
          "No schedules yet",
          'Click "Add Class" to build your timetable',
        );
        return;
      }
      let html = `<div class="sched-grid" style="grid-template-columns:80px repeat(${days.length},1fr);">
        <div class="sg-hdr">Time</div>${days.map((d) => `<div class="sg-hdr">${d}</div>`).join("")}`;
      times.forEach((t) => {
        html += `<div class="sg-time">${t}</div>`;
        days.forEach((d) => {
          const slots = schedules.filter((s) => s.time === t && s.day === d);
          html += `<div class="sg-cell">${slots
            .map(
              (s) => `
            <div class="sg-slot sg-${s.subject.toLowerCase()}">${s.subject}<div class="sg-meta">${s.class} • ${s.duration}m</div></div>
            ${s.notes ? `<div style="font-size:10px;color:var(--muted);margin-top:2px;">📌 ${s.notes}</div>` : ""}
          `,
            )
            .join("")}</div>`;
        });
      });
      html += "</div>";
      $("schedule-view").innerHTML = html;
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async addSchedule() {
    try {
      await API.post("/schedules", {
        subject: val("sched-subj"),
        day: val("sched-day"),
        time: val("sched-time"),
        duration: parseInt(val("sched-dur")),
        class: val("sched-class"),
        notes: val("sched-notes"),
      });
      closeModal("modal-sched");
      await App.renderSchedule();
      toast("Class added to timetable!", "success");
    } catch (e) {
      toast(e.message, "error");
    }
  },

  // ── ATTENDANCE ──────────────────────────────

  async renderAttendancePage() {
    $("att-date").value = todayStr();
    await App.renderAttGrid();
  },

  async renderAttGrid() {
    const subject = val("att-subj");
    const date = val("att-date");
    if (!date) {
      toast("Please select a date", "warn");
      return;
    }
    try {
      const [allStudents, attRecords] = await Promise.all([
        API.get("/students"),
        API.get(`/attendance?subject=${subject}&date=${date}`),
      ]);
      const eligible = allStudents.filter((s) =>
        (s.subjects || []).includes(subject),
      );
      // Build attState from server records + current session changes
      eligible.forEach((s) => {
        if (!(s.id in S.attState)) {
          const rec = attRecords.find((a) => a.student_id === s.id);
          S.attState[s.id] = rec ? rec.status : null;
        }
      });
      const present = eligible.filter(
        (s) => S.attState[s.id] === "present",
      ).length;
      const absent = eligible.filter(
        (s) => S.attState[s.id] === "absent",
      ).length;
      $("att-summary").innerHTML = `
        <div style="display:flex;gap:16px;align-items:center;">
          <span style="font-weight:800;color:var(--success)">✅ ${present} Present</span>
          <span style="font-weight:800;color:var(--danger)">❌ ${absent} Absent</span>
          <span class="text-muted">${eligible.length - present - absent} Unmarked</span>
        </div>`;
      $("att-grid").innerHTML = eligible.length
        ? eligible
            .map((s, i) => {
              const st = S.attState[s.id];
              return `
          <div class="att-card ${st === "present" ? "pres" : st === "absent" ? "abs" : ""}" onclick="App.toggleAtt('${s.id}')">
            <div class="ac-num">SC${String(i + 1).padStart(3, "0")}</div>
            <div class="ac-name">${s.name}</div>
            <div class="ac-class">${s.class}</div>
            <div class="ac-status">${st === "present" ? "✅ PRESENT" : st === "absent" ? "❌ ABSENT" : "⬜ TAP TO MARK"}</div>
          </div>`;
            })
            .join("")
        : emptyState("📋", `No students enrolled in ${subject}`);
    } catch (e) {
      toast(e.message, "error");
    }
  },

  toggleAtt(studentId) {
    const cur = S.attState[studentId];
    if (!cur) S.attState[studentId] = "present";
    else if (cur === "present") S.attState[studentId] = "absent";
    else delete S.attState[studentId];
    App.renderAttGrid();
  },

  async saveAttendance() {
    const subject = val("att-subj");
    const date = val("att-date");
    if (!date) {
      toast("Please select a date first", "warn");
      return;
    }
    const records = Object.entries(S.attState).map(([studentId, status]) => ({
      studentId,
      subject,
      date,
      status,
    }));
    try {
      await API.post("/attendance/bulk", { records });
      S.attState = {}; // reset after save
      await App.renderAttGrid();
      toast(`✅ Attendance saved for ${records.length} students!`, "success");
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async viewAttReport() {
    try {
      const report = await API.get("/attendance/report");
      const subjects = ["Maths", "Biology", "Physics", "English", "Chemistry"];
      $("att-report-inner").innerHTML = `
        <div style="overflow-x:auto;"><table>
          <thead><tr><th>Student</th><th>Class</th>${subjects.map((s) => `<th>${s}</th>`).join("")}<th>Overall</th></tr></thead>
          <tbody>${report
            .map((st) => {
              const cells = subjects.map((sub) => {
                const d = st.subjectStats[sub];
                if (!d || d.total === 0)
                  return `<td><span class="badge b-muted">—</span></td>`;
                return `<td><div style="font-weight:700;color:${d.pct >= 75 ? "var(--success)" : "var(--danger)"}">${d.pct}%</div><div class="text-muted" style="font-size:11px;">${d.present}/${d.total}</div></td>`;
              });
              const ov = st.overallPct;
              return `<tr>
              <td><div class="td-main">${st.name}</div><div class="td-sub">${st.id}</div></td>
              <td>${st.class}</td>${cells.join("")}
              <td><div style="font-weight:800;font-size:16px;color:${ov === null ? "var(--muted)" : ov >= 75 ? "var(--success)" : "var(--danger)"}">${ov !== null ? ov + "%" : "—"}</div>
              ${ov !== null ? `<div class="prog-bar" style="width:80px;margin-top:4px"><div class="prog-fill ${ov >= 75 ? "pf-success" : "pf-danger"}" style="width:${ov}%"></div></div>` : ""}
              </td>
            </tr>`;
            })
            .join("")}</tbody>
        </table></div>
        <div style="margin-top:18px;padding:14px 16px;background:#F8F7FF;border-radius:12px;font-size:13px;">
          <strong>📌 Policy:</strong> Students must maintain <strong style="color:var(--flame)">75% minimum attendance</strong> per subject. Red = below threshold.
        </div>`;
      openModal("modal-att-report");
    } catch (e) {
      toast(e.message, "error");
    }
  },

  // ── MATERIALS ───────────────────────────────

  async renderMaterials() {
    try {
      const filter = val("filter-mat-subj") || "all";
      const mats = await API.get(
        "/materials" + (filter !== "all" ? "?subject=" + filter : ""),
      );
      $("materials-list").innerHTML = mats.length
        ? mats
            .map(
              (m) => `
      <div class="mat-item">
        <div class="mat-ficon">📄</div>
        <div class="mat-info">
          <h4>${m.title}</h4>
          <p>
            <span class="chip ${subjectClass(m.subject)}">${m.subject}</span>
            <span class="badge b-muted">${m.for_class}</span>
            • ${m.file_size}
            • ${m.created_at ? m.created_at.split("T")[0] : ""}
          </p>
          ${m.description ? `<p style="margin-top:4px;">${m.description}</p>` : ""}
        </div>
        <div class="mat-actions">
          ${
            m.filename
              ? `<button class="btn btn-sm btn-info" onclick="downloadMaterial('${m.filename}', '${(m.original_name || m.filename).replace(/'/g, "\\'")}')">📥 Download</button>`
              : '<span class="badge b-muted">No file</span>'
          }
          <button class="btn btn-sm btn-danger" onclick="App.deleteMaterial(${m.id})">🗑️</button>
        </div>
      </div>
    `,
            )
            .join("")
        : emptyState("📂", "No materials uploaded yet");
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async uploadMaterial() {
    const title = val("mat-title");
    if (!title) {
      toast("Please enter a title", "warn");
      return;
    }
    const fd = new FormData();
    fd.append("subject", val("mat-subj"));
    fd.append("title", title);
    fd.append("description", val("mat-desc"));
    fd.append("forClass", val("mat-class"));
    if (S.selectedFile) fd.append("file", S.selectedFile);
    try {
      await API.upload("/materials", fd);
      $("mat-title").value = "";
      $("mat-desc").value = "";
      $("sel-file-name").textContent = "";
      S.selectedFile = null;
      await App.renderMaterials();
      toast("Material uploaded and shared with students!", "success");
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async deleteMaterial(id) {
    try {
      await API.delete("/materials/" + id);
      await App.renderMaterials();
      toast("Material deleted.", "warn");
    } catch (e) {
      toast(e.message, "error");
    }
  },

  // ── FEES ────────────────────────────────────

  async renderFees() {
    try {
      const filter = val("fee-filter") || "all";
      const [fees, allFees, students, payments] = await Promise.all([
        API.get("/fees" + (filter !== "all" ? "?status=" + filter : "")),
        API.get("/fees"),
        API.get("/students"),
        API.get("/payments"),
      ]);
      const paid = allFees
        .filter((f) => f.status === "paid")
        .reduce((a, f) => a + f.amount, 0);
      const pending = allFees
        .filter((f) => f.status === "pending")
        .reduce((a, f) => a + f.amount, 0);
      $("fees-stats").innerHTML = `
        <div class="stat-card sc-success"><div class="stat-icon">💰</div><div class="stat-val" style="color:var(--success)">₹${paid.toLocaleString()}</div><div class="stat-label">Total Collected</div></div>
        <div class="stat-card sc-flame"><div class="stat-icon">⏳</div><div class="stat-val" style="color:var(--danger)">₹${pending.toLocaleString()}</div><div class="stat-label">Total Pending</div></div>
        <div class="stat-card sc-lilac"><div class="stat-icon">📋</div><div class="stat-val">${allFees.length}</div><div class="stat-label">Total Records</div></div>
      `;

      $("fee-payments-panel").innerHTML = `
        <div class="grid-2" style="margin-bottom:18px;">
          <div class="card">
            <div class="card-hdr"><div><h3>💳 Generate Student Payment QR</h3><div class="hdr-sub">Use Student IDs like SC001, SC002</div></div></div>
            <div class="form-row">
              <div class="fg"><label>Student</label>
                <select id="pay-student-id">${students.map((s) => `<option value="${s.id}">${s.id} — ${s.name}</option>`).join("")}</select>
              </div>
              <div class="fg"><label>Amount</label><input id="pay-amount" type="number" value="3000" min="1"></div>
            </div>
            <div class="form-row">
              <div class="fg"><label>Fee Type</label><input id="pay-fee-type" value="Monthly Fees"></div>
              <div class="fg"><label>Valid For</label><select id="pay-minutes"><option value="10">10 minutes</option><option value="15" selected>15 minutes</option></select></div>
            </div>
            <div class="fg"><label>Description</label><input id="pay-description" value="Fee payment via QR"></div>
            <button class="btn btn-flame btn-block" onclick="App.generatePaymentQR()">Generate QR</button>
          </div>
          <div class="card">
            <div class="card-hdr"><div><h3>🧾 All Student Payments</h3><div class="hdr-sub">QR requests, expiry and receipts</div></div></div>
            <div class="tbl-wrap">${
              payments.length
                ? `
              <table>
                <thead><tr><th>Student</th><th>Fee Type</th><th>Amount</th><th>Status</th><th>Created</th><th>Paid At</th><th>Action</th></tr></thead>
                <tbody>${payments
                  .slice(0, 10)
                  .map(
                    (p) => `<tr>
                  <td><div class="td-main">${p.student_name}</div><div class="td-sub">${p.student_id}</div></td>
                  <td>${p.fee_type || p.fee_description || "Fee Payment"}</td>
                  <td>₹${Number(p.amount).toLocaleString()}</td>
                  <td><span class="badge ${p.status === "paid" ? "b-success" : p.status === "active" ? "b-warning" : "b-danger"}">${p.status}</span></td>
                  <td>${new Date(p.created_at).toLocaleString()}</td>
                  <td>${p.paid_at ? new Date(p.paid_at).toLocaleString() : "—"}</td>
                  <td style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">${p.receipt_no ? `<div style="font-size:12px;font-weight:700;color:var(--lilac)">${p.receipt_no}</div><button class="btn btn-sm btn-info" onclick="App.printPaymentBill(${p.id})">🖨️ Print</button>` : "—"}</td>
                </tr>`,
                  )
                  .join("")}</tbody>
              </table>`
                : emptyState("💳", "No payment requests yet")
            }</div>
          </div>
        </div>
      `;

      $("fees-count-label").textContent =
        `${fees.length} record${fees.length !== 1 ? "s" : ""}`;
      $("fees-tbl").innerHTML = fees.length
        ? `
        <table>
          <thead><tr><th>Student</th><th>Description</th><th>Month</th><th>Amount</th><th>Status</th><th>Payment Info</th><th>Actions</th></tr></thead>
          <tbody>${fees
            .map(
              (f) => `<tr>
            <td><div class="td-main">${f.student_name}</div><div class="td-sub">${f.student_id}</div></td>
            <td>${f.description}</td><td>${f.month}</td>
            <td style="font-weight:800;font-size:15px;">₹${f.amount.toLocaleString()}</td>
            <td><span class="badge ${f.status === "paid" ? "b-success" : "b-danger"}">${f.status === "paid" ? "✅ Paid" : "⏳ Pending"}</span></td>
            <td>${f.txn_id ? `<div style="font-size:12px;"><div style="font-weight:700;color:var(--lilac)">${f.txn_id}</div><div class="text-muted">via ${f.paid_via} • ${f.paid_on}</div></div>` : "—"}</td>
            <td style="display:flex;gap:6px;flex-wrap:wrap;">
              ${f.status !== "paid" ? `<button class="btn btn-sm btn-outline-flame" onclick="App.generatePaymentQRForFee(${f.id}, '${f.student_id}', ${f.amount}, '${String(f.description).replace(/'/g, "&#39;")}')">QR</button>` : ""}
              ${f.status !== "paid" ? `<button class="btn btn-sm btn-success" onclick="App.markPaid(${f.id})">✅ Paid</button>` : ""}
              <button class="btn btn-sm btn-info" onclick="App.printFeeBill(${f.id})">🖨️ Bill</button>
              <button class="btn btn-sm btn-danger" onclick="App.deleteFee(${f.id})">🗑️</button>
            </td>
          </tr>`,
            )
            .join("")}</tbody>
        </table>
      `
        : emptyState("💳", "No fee records found");
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async generatePaymentQRForFee(feeId, studentId, amount, description) {
    try {
      await API.post("/payments/generate", {
        feeId,
        studentId,
        amount,
        feeType: "Monthly Fees",
        description,
        minutes: parseInt(val("pay-minutes") || "15", 10),
      });
      toast("QR generated for student login", "success");
      await App.renderFees();
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async generatePaymentQR() {
    try {
      await API.post("/payments/generate", {
        studentId: val("pay-student-id"),
        amount: parseInt(val("pay-amount"), 10),
        feeType: val("pay-fee-type") || "Monthly Fees",
        description: val("pay-description") || "Fee payment via QR",
        minutes: parseInt(val("pay-minutes") || "15", 10),
      });
      toast("QR generated successfully", "success");
      await App.renderFees();
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async openAddFeeModal() {
    try {
      const students = await API.get("/students");
      $("fee-student-sel").innerHTML = students
        .map((s) => `<option value="${s.id}">${s.name} (${s.id})</option>`)
        .join("");
      $("fee-month").value = new Date().toISOString().slice(0, 7);
      openModal("modal-add-fee");
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async saveFeeRecord() {
    try {
      await API.post("/fees", {
        studentId: val("fee-student-sel"),
        amount: parseInt(val("fee-amt")),
        month: val("fee-month"),
        description: val("fee-desc") || "Monthly Tuition",
      });
      closeModal("modal-add-fee");
      await App.renderFees();
      toast("Fee record added!", "success");
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async markPaid(id) {
    try {
      await API.patch("/fees/" + id + "/mark-paid", {});
      await App.renderFees();
      toast("Fee marked as paid!", "success");
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async deleteFee(id) {
    try {
      await API.delete("/fees/" + id);
      await App.renderFees();
    } catch (e) {
      toast(e.message, "error");
    }
  },

  getInstituteBillInfo() {
    return {
      name: "Devang Classes",
      subtitle: "AI-Powered Learning Platform",
      address: "Uran, Maharashtra",
      phone: "+91 XXXXX XXXXX",
      email: "SupportDevangClass@gmail.com",
    };
  },

  openPrintWindow(title, bodyHtml) {
    const institute = App.getInstituteBillInfo();
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) {
      toast("Please allow popups to print the bill.", "warn");
      return;
    }
    win.document.write(`<!doctype html>
      <html>
      <head>
        <title>${title}</title>
        <style>
          body{font-family:Arial,Helvetica,sans-serif;padding:24px;color:#222}
          .wrap{max-width:820px;margin:0 auto}
          .hdr{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #ff6b3d;padding-bottom:14px;margin-bottom:20px}
          .brand h1{margin:0;font-size:28px;color:#ff4d1c}
          .brand p{margin:6px 0 0;color:#666}
          .meta{text-align:right;font-size:13px;color:#555}
          table{width:100%;border-collapse:collapse;margin-top:18px}
          th,td{border:1px solid #ddd;padding:10px;text-align:left;font-size:14px}
          th{background:#fff5f2}
          .sum{margin-top:18px;width:320px;margin-left:auto}
          .sum td:first-child{font-weight:bold;background:#fafafa}
          .paid{color:#0a8f4d;font-weight:700}
          .pending{color:#cc6a00;font-weight:700}
          .foot{margin-top:28px;font-size:12px;color:#666;border-top:1px dashed #ccc;padding-top:12px}
          @media print { .no-print { display:none } body{padding:0} }
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="hdr">
            <div class="brand">
              <h1>${institute.name}</h1>
              <p>${institute.subtitle}</p>
              <p>${institute.address}</p>
            </div>
            <div class="meta">
              <div><strong>Date:</strong> ${new Date().toLocaleDateString()}</div>
              <div><strong>Time:</strong> ${new Date().toLocaleTimeString()}</div>
            </div>
          </div>
          ${bodyHtml}
          <div class="foot">
            This is a computer-generated fee bill / receipt from Devang Classes. Keep it for your records.
          </div>
          <div class="no-print" style="margin-top:20px;text-align:right;"><button onclick="window.print()">Print</button></div>
        </div>
      </body>
      </html>`);
    win.document.close();
    setTimeout(() => {
      win.focus();
      win.print();
    }, 300);
  },

  async printFeeBill(feeId) {
    try {
      const [fees, payments, me] = await Promise.all([
        API.get(
          "/fees" +
            (S.user.role === "student" ? "?studentId=" + S.user.id : ""),
        ),
        API.get("/payments?feeId=" + feeId),
        API.get("/auth/me"),
      ]);
      const fee = fees.find((f) => Number(f.id) === Number(feeId));
      if (!fee) {
        toast("Fee record not found", "error");
        return;
      }
      const payment =
        (payments || []).find((p) => p.status === "paid") ||
        (payments || [])[0] ||
        null;
      const title =
        fee.status === "paid"
          ? `Fee Receipt - ${fee.student_id}`
          : `Fee Bill - ${fee.student_id}`;
      const statusClass = fee.status === "paid" ? "paid" : "pending";
      const billNo =
        payment?.receipt_no || "BILL-" + String(fee.id).padStart(4, "0");
      App.openPrintWindow(
        title,
        `
        <div style="display:flex;justify-content:space-between;gap:20px;align-items:flex-start;">
          <div>
            <h2 style="margin:0 0 8px;">${fee.status === "paid" ? "Fee Receipt" : "Fee Bill"}</h2>
            <div><strong>${fee.student_name}</strong></div>
            <div>Student ID: ${fee.student_id}</div>
            <div>Class: ${fee.class || me.class || "—"}</div>
          </div>
          <div style="text-align:right;">
            <div><strong>${fee.status === "paid" ? "Receipt No" : "Bill No"}:</strong> ${billNo}</div>
            <div><strong>Month:</strong> ${fee.month || "—"}</div>
            <div><strong>Status:</strong> <span class="${statusClass}">${fee.status.toUpperCase()}</span></div>
          </div>
        </div>
        <table>
          <thead><tr><th>Description</th><th>Fee Month</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>
            <tr>
              <td>${fee.description || "Tuition Fees"}</td>
              <td>${fee.month || "—"}</td>
              <td>₹${Number(fee.amount).toLocaleString()}</td>
              <td class="${statusClass}">${fee.status === "paid" ? "Paid" : "Pending"}</td>
            </tr>
          </tbody>
        </table>
        <table class="sum">
          <tr><td>Total Amount</td><td>₹${Number(fee.amount).toLocaleString()}</td></tr>
          <tr><td>Payment Mode</td><td>${payment?.paid_via || fee.paid_via || "Not Paid Yet"}</td></tr>
          <tr><td>Transaction ID</td><td>${payment?.txn_id || fee.txn_id || "—"}</td></tr>
          <tr><td>Paid On</td><td>${payment?.paid_at ? new Date(payment.paid_at).toLocaleString() : fee.paid_on || "—"}</td></tr>
        </table>
      `,
      );
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async printPaymentBill(paymentId) {
    try {
      const payments = await API.get("/payments");
      const payment = payments.find((p) => Number(p.id) === Number(paymentId));
      if (!payment) {
        toast("Payment record not found", "error");
        return;
      }
      App.openPrintWindow(
        `Payment Receipt - ${payment.receipt_no || payment.id}`,
        `
        <div style="display:flex;justify-content:space-between;gap:20px;align-items:flex-start;">
          <div>
            <h2 style="margin:0 0 8px;">Payment Receipt</h2>
            <div><strong>${payment.student_name}</strong></div>
            <div>Student ID: ${payment.student_id}</div>
            <div>Fee Type: ${payment.fee_type || payment.fee_description || "Fee Payment"}</div>
          </div>
          <div style="text-align:right;">
            <div><strong>Receipt No:</strong> ${payment.receipt_no || "RCT-" + payment.id}</div>
            <div><strong>Status:</strong> <span class="${payment.status === "paid" ? "paid" : "pending"}">${payment.status.toUpperCase()}</span></div>
            <div><strong>Date:</strong> ${payment.paid_at ? new Date(payment.paid_at).toLocaleDateString() : new Date(payment.created_at).toLocaleDateString()}</div>
          </div>
        </div>
        <table>
          <thead><tr><th>Description</th><th>Month</th><th>Amount</th><th>Transaction ID</th></tr></thead>
          <tbody>
            <tr>
              <td>${payment.description || payment.fee_description || "Fee Payment"}</td>
              <td>${payment.month || "—"}</td>
              <td>₹${Number(payment.amount).toLocaleString()}</td>
              <td>${payment.txn_id || "—"}</td>
            </tr>
          </tbody>
        </table>
        <table class="sum">
          <tr><td>Total Paid</td><td>₹${Number(payment.amount).toLocaleString()}</td></tr>
          <tr><td>Paid Via</td><td>${payment.paid_via || "UPI QR"}</td></tr>
          <tr><td>Created At</td><td>${new Date(payment.created_at).toLocaleString()}</td></tr>
          <tr><td>Paid At</td><td>${payment.paid_at ? new Date(payment.paid_at).toLocaleString() : "—"}</td></tr>
        </table>
      `,
      );
    } catch (e) {
      toast(e.message, "error");
    }
  },

  // ── AI QUIZ ─────────────────────────────────

  async generateQuizAI() {
    const notes = val("qg-notes").trim();
    if (notes.length < 100) {
      toast("Please paste at least 100 characters of notes", "warn");
      return;
    }
    const subject = val("qg-subject"),
      topic = val("qg-topic"),
      count = val("qg-count"),
      difficulty = val("qg-difficulty"),
      title = val("qg-title");
    $("ai-loading").classList.add("show");
    $("gen-btn").disabled = true;
    try {
      const quiz = await API.post("/quiz/generate", {
        notes,
        subject,
        topic,
        count: parseInt(count),
        difficulty,
        title,
      });
      $("ai-loading").classList.remove("show");
      $("gen-btn").disabled = false;
      S.currentQuizId = quiz.id;
      closeModal("modal-quiz-gen");
      App.showQuizPreview(quiz);
      toast(`✅ AI generated ${quiz.questions.length} questions!`, "success");
    } catch (e) {
      $("ai-loading").classList.remove("show");
      $("gen-btn").disabled = false;
      toast("AI generation failed: " + e.message, "error");
    }
  },

  showQuizPreview(quiz) {
    $("quiz-preview-content").innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:22px;flex-wrap:wrap;gap:12px;">
        <div>
          <div class="text-muted" style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1px;">AI Generated Quiz</div>
          <h2 style="font-family:'Syne',sans-serif;font-size:22px;font-weight:800;margin-top:4px;">${quiz.title}</h2>
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
            <span class="chip ${subjectClass(quiz.subject)}">${quiz.subject}</span>
            <span class="badge b-lilac">${quiz.difficulty}</span>
            <span class="badge b-muted">${quiz.questions.length} Questions</span>
          </div>
        </div>
        <div style="display:flex;gap:10px;">
          <button class="btn btn-success" onclick="App.openSendQuizModal(${quiz.id})">📤 Send to Students</button>
          <button class="btn btn-outline-ink" onclick="closeModal('modal-quiz-preview')">Close</button>
        </div>
      </div>
      ${quiz.questions
        .map(
          (q, i) => `
        <div class="quiz-q-item">
          <div class="qq-num">Question ${i + 1} of ${quiz.questions.length}</div>
          <div class="qq-text">${q.q}</div>
          <div class="qq-opts">
            ${q.opts.map((opt, oi) => `<div class="quiz-opt ${oi === q.ans ? "correct" : ""}">${String.fromCharCode(65 + oi)}. ${opt} ${oi === q.ans ? "✅" : ""}</div>`).join("")}
          </div>
          ${q.exp ? `<div class="quiz-expl">💡 ${q.exp}</div>` : ""}
        </div>
      `,
        )
        .join("")}
    `;
    openModal("modal-quiz-preview");
  },

  openSendQuizModal(quizId) {
    S.currentSendQuizId = quizId;
    API.get("/quizzes/" + quizId).then((q) => {
      $("send-quiz-name").textContent = q.title;
      const due = new Date();
      due.setDate(due.getDate() + 7);
      $("send-due-date").value = due.toISOString().split("T")[0];
      closeModal("modal-quiz-preview");
      openModal("modal-send-quiz");
    });
  },

  async sendQuizToStudents() {
    try {
      await API.patch("/quizzes/" + S.currentSendQuizId + "/send", {
        sentTo: val("send-to-class"),
        timeLimit: parseInt(val("send-time-limit")),
        dueDate: val("send-due-date"),
      });
      closeModal("modal-send-quiz");
      await App.renderQuizzes();
      toast("Quiz sent to students! 📤", "success");
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async renderQuizzes() {
    try {
      const filter = val("quiz-filter-subj") || "all";
      const [quizzes, results] = await Promise.all([
        API.get("/quizzes" + (filter !== "all" ? "?subject=" + filter : "")),
        API.get("/quiz-results"),
      ]);
      $("quiz-count-label").textContent =
        `${quizzes.length} quiz${quizzes.length !== 1 ? "zes" : ""}`;
      $("quizzes-list").innerHTML = quizzes.length
        ? quizzes
            .map((q) => {
              const subs = results.filter((r) => r.quiz_id === q.id);
              const avg = subs.length
                ? Math.round(
                    subs.reduce((a, r) => a + r.percentage, 0) / subs.length,
                  )
                : null;
              return `
          <div class="quiz-card">
            <div class="qc-meta">Created ${q.created_at ? q.created_at.split("T")[0] : ""} ${q.topic ? "• " + q.topic : ""}</div>
            <div class="qc-title">${q.title}</div>
            <div class="qc-badges">
              <span class="chip ${subjectClass(q.subject)}">${q.subject}</span>
              <span class="badge b-lilac">${q.difficulty}</span>
              <span class="badge ${q.sent ? "b-success" : "b-warn"}">${q.sent ? "✅ Sent to " + q.sent_to : "📝 Draft"}</span>
              ${q.time_limit ? `<span class="badge b-info">⏱ ${q.time_limit} min</span>` : ""}
            </div>
            <div class="qc-footer">
              <div class="qc-stats">
                <div class="qcs-item"><div class="qcs-val">${q.questions.length}</div><div class="qcs-label">Questions</div></div>
                <div class="qcs-item"><div class="qcs-val">${subs.length}</div><div class="qcs-label">Submissions</div></div>
                <div class="qcs-item"><div class="qcs-val">${avg !== null ? avg + "%" : "—"}</div><div class="qcs-label">Avg Score</div></div>
              </div>
              <div class="qc-actions">
                <button class="btn btn-sm btn-info" onclick="App.viewQuizResults(${q.id})">📊 Results</button>
                <button class="btn btn-sm btn-outline-ink" onclick="App.previewExistingQuiz(${q.id})">👁 Preview</button>
                ${!q.sent ? `<button class="btn btn-sm btn-success" onclick="App.openSendQuizModal(${q.id})">📤 Send</button>` : ""}
                <button class="btn btn-sm btn-danger" onclick="App.deleteQuiz(${q.id})">🗑️</button>
              </div>
            </div>
          </div>
        `;
            })
            .join("")
        : emptyState(
            "🤖",
            "No quizzes yet",
            'Click "Create New AI Quiz" to get started!',
          );
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async previewExistingQuiz(id) {
    try {
      const quiz = await API.get("/quizzes/" + id);
      App.showQuizPreview(quiz);
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async deleteQuiz(id) {
    if (!confirm("Delete this quiz and all its results?")) return;
    try {
      await API.delete("/quizzes/" + id);
      await App.renderQuizzes();
      toast("Quiz deleted.", "warn");
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async viewQuizResults(quizId) {
    try {
      const [quiz, { results, analytics }] = await Promise.all([
        API.get("/quizzes/" + quizId),
        API.get("/quiz-results/analytics/" + quizId),
      ]);
      if (!analytics) {
        $("quiz-results-dash-inner").innerHTML =
          `<h2>${quiz.title}</h2>${emptyState("📊", "No submissions yet")}`;
        openModal("modal-quiz-results-dash");
        return;
      }
      $("quiz-results-dash-inner").innerHTML = `
        <h2 style="margin-bottom:4px;">${quiz.title}</h2>
        <div style="display:flex;gap:8px;margin-bottom:22px;flex-wrap:wrap;">
          <span class="chip ${subjectClass(quiz.subject)}">${quiz.subject}</span>
          <span class="badge b-lilac">${quiz.difficulty}</span>
          <span class="badge b-muted">${analytics.total} submissions</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:20px;">
          <div style="background:#F8F7FF;border-radius:12px;padding:16px;text-align:center;"><div style="font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:var(--lilac);">${analytics.avg}%</div><div class="text-muted" style="font-size:12px;">Class Average</div></div>
          <div style="background:#F8F7FF;border-radius:12px;padding:16px;text-align:center;"><div style="font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:var(--success);">${analytics.highest}%</div><div class="text-muted" style="font-size:12px;">Highest</div></div>
          <div style="background:#F8F7FF;border-radius:12px;padding:16px;text-align:center;"><div style="font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:var(--danger);">${analytics.lowest}%</div><div class="text-muted" style="font-size:12px;">Lowest</div></div>
          <div style="background:#F8F7FF;border-radius:12px;padding:16px;text-align:center;"><div style="font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:var(--flame);">${analytics.pass}/${analytics.total}</div><div class="text-muted" style="font-size:12px;">Passed</div></div>
        </div>
        <div style="background:#F8F7FF;border-radius:12px;padding:16px;margin-bottom:20px;">
          <div style="font-weight:800;margin-bottom:10px;">Grade Distribution</div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            ${Object.entries(analytics.grades)
              .map(
                ([g, c]) => `
              <div style="flex:1;min-width:55px;text-align:center;background:white;border-radius:10px;padding:10px;">
                <div style="font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:var(--lilac);">${c}</div>
                <span class="badge ${g === "A+" || g === "A" ? "b-success" : g === "B" ? "b-info" : g === "C" ? "b-warn" : "b-danger"}">${g}</span>
              </div>
            `,
              )
              .join("")}
          </div>
        </div>
        <div style="overflow-x:auto;"><table>
          <thead><tr><th>Rank</th><th>Student</th><th>Score</th><th>Percentage</th><th>Grade</th><th>Time</th><th>Date</th></tr></thead>
          <tbody>${results
            .map(
              (r, i) => `<tr>
            <td style="font-weight:800;color:${i === 0 ? "var(--gold)" : i === 1 ? "#888" : i === 2 ? "#cd7f32" : "var(--muted)"};">${i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}</td>
            <td><div class="td-main">${r.student_name}</div><div class="td-sub">${r.student_id}</div></td>
            <td style="font-weight:700;">${r.score}/${r.total}</td>
            <td><div style="display:flex;align-items:center;gap:8px;"><div class="prog-bar" style="width:80px;"><div class="prog-fill ${r.percentage >= 75 ? "pf-success" : r.percentage >= 55 ? "pf-lilac" : "pf-danger"}" style="width:${r.percentage}%"></div></div><span style="font-weight:700;">${r.percentage}%</span></div></td>
            <td><span class="badge ${r.grade === "A+" || r.grade === "A" ? "b-success" : r.grade === "B" ? "b-info" : r.grade === "C" ? "b-warn" : "b-danger"}">${r.grade}</span></td>
            <td>${r.time_taken || "—"}</td>
            <td class="text-muted">${r.submitted_at ? r.submitted_at.split("T")[0] : ""}</td>
          </tr>`,
            )
            .join("")}
          </tbody>
        </table></div>`;
      openModal("modal-quiz-results-dash");
    } catch (e) {
      toast(e.message, "error");
    }
  },

  // ── FEEDBACK ────────────────────────────────

  async renderFeedback() {
    try {
      const [feedback, stats] = await Promise.all([
        API.get("/feedback"),
        API.get("/feedback/stats"),
      ]);
      $("fb-stats").innerHTML = `
        <div class="stat-card sc-gold"><div class="stat-icon">⭐</div><div class="stat-val">${stats.avg}</div><div class="stat-label">Average Rating</div></div>
        <div class="stat-card sc-lilac"><div class="stat-icon">💬</div><div class="stat-val">${stats.total}</div><div class="stat-label">Total Reviews</div></div>
        <div class="stat-card sc-success"><div class="stat-icon">😊</div><div class="stat-val">${stats.positive}</div><div class="stat-label">Positive (4★+)</div></div>
      `;
      $("feedback-list").innerHTML = feedback.length
        ? feedback
            .map(
              (f) => `
        <div class="fb-card">
          <div class="fb-top">
            <div class="fb-auth"><div class="fb-av">${f.student_name.charAt(0)}</div><div><div class="fb-name">${f.student_name}</div><div class="fb-date">${f.created_at ? f.created_at.split("T")[0] : ""}</div></div></div>
            <div style="text-align:right;"><div class="fb-stars">${"★".repeat(f.rating)}${"☆".repeat(5 - f.rating)}</div><span class="chip ${subjectClass(f.subject)}">${f.subject}</span></div>
          </div>
          <p class="fb-text">${f.message}</p>
        </div>
      `,
            )
            .join("")
        : emptyState("⭐", "No feedback received yet");
    } catch (e) {
      toast(e.message, "error");
    }
  },

  setRating(val) {
    S.currentRating = val;
    document
      .querySelectorAll("#star-sel .star")
      .forEach((s, i) => s.classList.toggle("on", i < val));
  },

  async submitFeedback() {
    if (!S.currentRating) {
      toast("Please select a star rating", "warn");
      return;
    }
    const message = val("fb-text");
    if (!message) {
      toast("Please write your feedback", "warn");
      return;
    }
    try {
      await API.post("/feedback", {
        subject: val("fb-subject"),
        rating: S.currentRating,
        message,
      });
      S.currentRating = 0;
      $("fb-text").value = "";
      document
        .querySelectorAll("#star-sel .star")
        .forEach((s) => s.classList.remove("on"));
      closeModal("modal-feedback");
      if (S.role === "student") await App.renderStudentFeedback();
      toast("Thank you for your feedback! 🙏", "success");
    } catch (e) {
      toast(e.message, "error");
    }
  },

  // ── STUDENT REPORTS ──────────────────────────

  async renderParentReports() {
    try {
      const students = await API.get("/parent-reports/students");
      const listEl = $("parent-report-student-list");
      const detailEl = $("parent-report-detail");
      if (!listEl || !detailEl) return;
      if (!students.length) {
        listEl.innerHTML = emptyState("👨‍🎓", "No students found");
        detailEl.innerHTML = emptyState(
          "📊",
          "Select a student to view progress",
        );
        return;
      }
      listEl.innerHTML = students
        .map(
          (s, idx) => `
        <button class="btn btn-outline-ink btn-block" style="text-align:left;margin-bottom:8px;padding:12px;border-radius:12px;" onclick="App.loadParentReport('${s.id}', this)">
          <div style="font-weight:700;">${s.name}</div>
          <div class="text-muted" style="font-size:12px;">${s.id} • ${s.class || "—"}</div>
        </button>
      `,
        )
        .join("");
      detailEl.innerHTML = emptyState(
        "📊",
        "Select a student to view progress",
      );
      // auto-load first
      const firstBtn = listEl.querySelector("button");
      if (firstBtn) await App.loadParentReport(students[0].id, firstBtn);
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async loadParentReport(studentId, btnEl = null) {
    try {
      const data = await API.get(
        "/parent-reports/" + encodeURIComponent(studentId),
      );
      S.currentParentReportStudentId = studentId;
      document
        .querySelectorAll("#parent-report-student-list button")
        .forEach((b) => {
          b.classList.remove("btn-flame");
          b.classList.add("btn-outline-ink");
        });
      if (btnEl) {
        btnEl.classList.remove("btn-outline-ink");
        btnEl.classList.add("btn-flame");
      }
      const report = data.report;
      const attendanceColor =
        report.attendance.percentage >= 75 ? "var(--success)" : "var(--danger)";
      $("parent-report-detail").innerHTML = `
        <div class="grid-2" style="align-items:start;">
          <div class="card">
            <div class="card-hdr"><h3>👨‍🎓 Student Details</h3></div>
            <div style="line-height:1.8;font-size:14px;">
              <div><strong>Name:</strong> ${report.student.name}</div>
              <div><strong>ID:</strong> ${report.student.id}</div>
              <div><strong>Class:</strong> ${report.student.class || "—"}</div>
              <div><strong>Subjects:</strong> ${(report.student.subjects || []).join(", ") || "—"}</div>
            </div>
          </div>
          <div class="card">
            <div class="card-hdr"><h3>👪 Parent Details</h3></div>
            <div style="line-height:1.8;font-size:14px;">
              <div><strong>Name:</strong> ${report.parent.name || "—"}</div>
              <div><strong>Mobile:</strong> ${report.parent.phone || "—"}</div>
              <div><strong>Email:</strong> ${report.parent.email || "—"}</div>
            </div>
          </div>
        </div>

        <div class="stats-row" style="margin-top:16px;">
          <div class="stat-card sc-success"><div class="stat-icon">✅</div><div class="stat-val" style="color:${attendanceColor}">${report.attendance.percentage}%</div><div class="stat-label">Attendance</div></div>
          <div class="stat-card sc-gold"><div class="stat-icon">📝</div><div class="stat-val">${report.quizzes.average}%</div><div class="stat-label">Quiz Average</div></div>
          <div class="stat-card sc-flame"><div class="stat-icon">🏆</div><div class="stat-val">${report.quizzes.highest}%</div><div class="stat-label">Highest Score</div></div>
          <div class="stat-card sc-lilac"><div class="stat-icon">💳</div><div class="stat-val">${report.fees.pendingCount}</div><div class="stat-label">Pending Fees</div></div>
        </div>

        <div class="grid-2" style="margin-top:16px;">
          <div class="card">
            <div class="card-hdr"><h3>📊 Attendance Summary</h3></div>
            <div style="line-height:1.8;font-size:14px;">
              <div><strong>Total Classes:</strong> ${report.attendance.total}</div>
              <div><strong>Present:</strong> ${report.attendance.present}</div>
              <div><strong>Absent:</strong> ${report.attendance.absent}</div>
            </div>
          </div>
          <div class="card">
            <div class="card-hdr"><h3>🧾 Fee Summary</h3></div>
            <div style="line-height:1.8;font-size:14px;">
              <div><strong>Paid Records:</strong> ${report.fees.paidCount}</div>
              <div><strong>Pending Records:</strong> ${report.fees.pendingCount}</div>
              <div><strong>Total Paid:</strong> ₹${Number(report.fees.totalPaid || 0).toLocaleString()}</div>
              <div><strong>Total Pending:</strong> ₹${Number(report.fees.totalPending || 0).toLocaleString()}</div>
            </div>
          </div>
        </div>

        <div class="card" style="margin-top:16px;">
          <div class="card-hdr"><h3>📝 Quiz Performance</h3></div>
          ${
            report.quizzes.results.length
              ? `
            <div class="tbl-wrap"><table>
              <thead><tr><th>Quiz</th><th>Subject</th><th>Score</th><th>Percentage</th><th>Grade</th></tr></thead>
              <tbody>${report.quizzes.results
                .map(
                  (r) => `<tr>
                <td>${r.title}</td>
                <td>${r.subject}</td>
                <td>${r.score}/${r.total}</td>
                <td>${r.percentage}%</td>
                <td>${r.grade}</td>
              </tr>`,
                )
                .join("")}</tbody>
            </table></div>
          `
              : emptyState("📝", "No quiz attempts yet")
          }
        </div>

        <div class="card" style="margin-top:16px;">
          <div class="card-hdr"><h3>💬 Latest Feedback / Remark</h3></div>
          <p style="font-size:14px;line-height:1.7;margin:0;">${report.remark}</p>
        </div>
      `;
      $("send-parent-report-btn").disabled = !report.parent.email;
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async sendParentReport() {
    try {
      if (!S.currentParentReportStudentId) {
        toast("Please select a student first", "warn");
        return;
      }
      const data = await API.post(
        "/parent-reports/" +
          encodeURIComponent(S.currentParentReportStudentId) +
          "/send",
        {},
      );
      toast(data.message || "Report sent successfully", "success");
    } catch (e) {
      toast(e.message, "error");
    }
  },

  // ── STUDENT PAGES ────────────────────────────

  async renderStudentDash() {
    try {
      const [fees, quizzes, myResults, myAtt] = await Promise.all([
        API.get("/fees?studentId=" + S.user.id),
        API.get("/quizzes"),
        API.get("/quiz-results?studentId=" + S.user.id),
        API.get("/attendance?studentId=" + S.user.id),
      ]);
      const myFees = fees.filter((f) => f.student_id === S.user.id);
      const pending = myFees
        .filter((f) => f.status === "pending")
        .reduce((a, f) => a + f.amount, 0);
      const myQ = quizzes.filter(
        (q) => q.sent && (q.sent_to === "all" || q.sent_to === S.user.class),
      );
      const pendingQ = myQ.filter(
        (q) => !myResults.find((r) => r.quiz_id === q.id),
      );
      const attPct = myAtt.length
        ? Math.round(
            (myAtt.filter((a) => a.status === "present").length /
              myAtt.length) *
              100,
          )
        : null;

      $("s-dash-stats").innerHTML = `
        <div class="stat-card sc-flame"><div class="stat-icon">📝</div><div class="stat-val">${pendingQ.length}</div><div class="stat-label">Pending Quizzes</div></div>
        <div class="stat-card sc-success"><div class="stat-icon">✅</div><div class="stat-val">${attPct !== null ? attPct + "%" : "—"}</div><div class="stat-label">Attendance</div></div>
        <div class="stat-card sc-lilac"><div class="stat-icon">🏆</div><div class="stat-val">${myResults.length}</div><div class="stat-label">Quizzes Done</div></div>
        <div class="stat-card sc-gold"><div class="stat-icon">💳</div><div class="stat-val" style="color:${pending > 0 ? "var(--danger)" : "var(--success)"}">₹${pending.toLocaleString()}</div><div class="stat-label">Fees Due</div></div>
      `;
      $("s-pending-q").innerHTML = pendingQ.length
        ? pendingQ
            .map(
              (q) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:14px;border:2px solid var(--border-light);border-radius:12px;margin-bottom:10px;">
          <div>
            <div style="font-weight:700;">${q.title}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:3px;">
              <span class="chip ${subjectClass(q.subject)}">${q.subject}</span>
              ${q.questions.length} Qs • ${q.difficulty}
              ${q.time_limit ? ` • ⏱ ${q.time_limit} min` : ""}
              ${q.due_date ? ` • Due: ${q.due_date}` : ""}
            </div>
          </div>
          <button class="btn btn-flame btn-sm" onclick="App.startQuiz(${q.id})">Start →</button>
        </div>
      `,
            )
            .join("")
        : emptyState("✅", "All caught up!", "No pending quizzes");

      const subjects = S.user.subjects || [];
      const attBySubj = subjects.map((sub) => {
        const subAtt = myAtt.filter((a) => a.subject === sub);
        const p = subAtt.filter((a) => a.status === "present").length;
        const t = subAtt.length;
        const pct = t > 0 ? Math.round((p / t) * 100) : null;
        return `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #F4F2FF;">
          <span class="chip ${subjectClass(sub)}" style="min-width:80px;justify-content:center;">${sub}</span>
          <div class="prog-bar" style="flex:1;"><div class="prog-fill ${pct === null ? "" : pct >= 75 ? "pf-success" : "pf-danger"}" style="width:${pct || 0}%"></div></div>
          <span style="font-weight:800;font-size:13px;color:${pct === null ? "var(--muted)" : pct >= 75 ? "var(--success)" : "var(--danger)"};">${pct !== null ? pct + "%" : "—"}</span>
        </div>`;
      });
      $("s-att-overview").innerHTML =
        attBySubj.join("") ||
        '<p class="text-muted" style="padding:12px;">No attendance records yet</p>';

      $("s-recent-results").innerHTML =
        myResults
          .slice(0, 5)
          .map((r) => {
            const q = myQ.find((x) => x.id === r.quiz_id);
            const g = calcGrade(r.percentage);
            return `<div style="display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid #F4F2FF;">
          <div style="flex:1;"><div style="font-weight:700;">${q ? q.title : "Quiz"}</div><div class="text-muted" style="font-size:12px;">${r.submitted_at ? r.submitted_at.split("T")[0] : ""}</div></div>
          <div style="text-align:right;"><div style="font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:${r.percentage >= 75 ? "var(--success)" : r.percentage >= 55 ? "var(--lilac)" : "var(--danger)"};">${r.percentage}%</div>
          <span class="badge ${g === "A+" || g === "A" ? "b-success" : g === "B" ? "b-info" : g === "C" ? "b-warn" : "b-danger"}">${g}</span></div>
        </div>`;
          })
          .join("") ||
        emptyState("🏆", "No results yet", "Take a quiz to see your results");
    } catch (e) {
      toast(e.message, "error");
    }
  },
  //

  async renderStudentMaterials() {
    try {
      const filter = val("s-mat-filter") || "all";
      let mats = await API.get(
        "/materials" + (filter !== "all" ? "?subject=" + filter : ""),
      );
      if (filter === "all")
        mats = mats.filter(
          (m) =>
            (S.user.subjects || []).includes(m.subject) ||
            m.for_class === "All Classes",
        );
      $("s-materials-list").innerHTML = mats.length
        ? mats
            .map(
              (m) => `
        <div class="mat-item">
          <div class="mat-ficon">📄</div>
          <div class="mat-info">
            <h4>${m.title}</h4>
            <p><span class="chip ${subjectClass(m.subject)}">${m.subject}</span> <span class="badge b-muted">${m.for_class}</span> • ${m.file_size} • ${m.created_at ? m.created_at.split("T")[0] : ""}</p>
            ${m.description ? `<p style="margin-top:4px;">${m.description}</p>` : ""}
          </div>
          <div class="mat-actions">
            ${m.filename ? `<button class="btn btn-sm btn-info" onclick="downloadMaterial('${m.filename}', '${(m.original_name || m.filename).replace(/'/g, "\\'")}')">📥 Download</button>` : '<span class="badge b-muted">No file</span>'}
          </div>
        </div>
      `,
            )
            .join("")
        : emptyState("📚", "No materials available for your subjects yet");
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async renderStudentQuizzes() {
    try {
      const [quizzes, myResults] = await Promise.all([
        API.get("/quizzes"),
        API.get("/quiz-results?studentId=" + S.user.id),
      ]);
      const myQ = quizzes.filter(
        (q) => q.sent && (q.sent_to === "all" || q.sent_to === S.user.class),
      );
      const pending = myQ.filter(
        (q) => !myResults.find((r) => r.quiz_id === q.id),
      );
      const done = myQ.filter((q) => myResults.find((r) => r.quiz_id === q.id));

      $("s-quizzes-avail").innerHTML = pending.length
        ? pending
            .map(
              (q) => `
        <div style="border:2px solid var(--flame);border-radius:14px;padding:16px;margin-bottom:12px;background:#FFF8F5;">
          <div style="font-weight:800;font-size:15px;margin-bottom:6px;">${q.title}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
            <span class="chip ${subjectClass(q.subject)}">${q.subject}</span>
            <span class="badge b-lilac">${q.difficulty}</span>
            <span class="badge b-muted">${q.questions.length} Questions</span>
            ${q.time_limit ? `<span class="badge b-danger">⏱ ${q.time_limit} min</span>` : '<span class="badge b-muted">No time limit</span>'}
          </div>
          <button class="btn btn-flame btn-block" onclick="App.startQuiz(${q.id})">🚀 Start Quiz Now</button>
        </div>
      `,
            )
            .join("")
        : emptyState("✅", "All caught up!", "No pending quizzes");

      $("s-quizzes-done").innerHTML = done.length
        ? done
            .map((q) => {
              const r = myResults.find((x) => x.quiz_id === q.id);
              const g = calcGrade(r.percentage);
              return `<div style="border:1.5px solid var(--border-light);border-radius:14px;padding:16px;margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
            <div><div style="font-weight:700;">${q.title}</div><div class="text-muted" style="font-size:12px;">${r.submitted_at ? r.submitted_at.split("T")[0] : ""}</div></div>
            <div style="text-align:right;"><div style="font-family:'Syne',sans-serif;font-size:26px;font-weight:800;color:${r.percentage >= 75 ? "var(--success)" : r.percentage >= 55 ? "var(--lilac)" : "var(--danger)"};">${r.percentage}%</div>
            <span class="badge ${g === "A+" || g === "A" ? "b-success" : g === "B" ? "b-info" : g === "C" ? "b-warn" : "b-danger"}">${g}</span></div>
          </div>
          <div class="prog-bar"><div class="prog-fill ${r.percentage >= 75 ? "pf-success" : r.percentage >= 55 ? "pf-lilac" : "pf-danger"}" style="width:${r.percentage}%"></div></div>
          <div style="font-size:12px;color:var(--muted);margin-top:6px;">${r.score}/${r.total} correct • ${r.time_taken || ""}</div>
        </div>`;
            })
            .join("")
        : emptyState("📊", "No results yet", "Take a quiz to see your results");
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async startQuiz(quizId) {
    try {
      const quiz = await API.get("/quizzes/" + quizId);
      S.currentTakeQuizId = quizId;
      S.quizAnswers = {};
      S.quizStartTime = Date.now();
      $("take-quiz-inner").innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
          <div>
            <div class="text-muted" style="font-size:11px;font-weight:800;text-transform:uppercase;">📝 QUIZ IN PROGRESS</div>
            <h2 style="font-family:'Syne',sans-serif;font-size:20px;font-weight:800;margin-top:4px;">${quiz.title}</h2>
            <div style="display:flex;gap:8px;margin-top:6px;"><span class="chip ${subjectClass(quiz.subject)}">${quiz.subject}</span><span class="badge b-muted">${quiz.questions.length} Questions</span></div>
          </div>
          <div id="q-progress" style="text-align:right;"><div style="font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:var(--lilac);">0/${quiz.questions.length}</div><div class="text-muted" style="font-size:12px;">answered</div></div>
        </div>
        ${quiz.time_limit > 0 ? `<div id="timer-bar" style="background:#F4F2FF;border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;"><span style="font-weight:700;">⏱ Time Remaining</span><span id="timer-disp" style="font-family:'Syne',sans-serif;font-size:20px;font-weight:800;color:var(--danger);"></span></div>` : ""}
        <div id="q-body">
          ${quiz.questions
            .map(
              (q, i) => `
            <div class="quiz-q-item" id="qq-${i}">
              <div class="qq-num">Question ${i + 1} of ${quiz.questions.length}</div>
              <div class="qq-text">${q.q}</div>
              <div class="qq-opts">
                ${q.opts.map((opt, oi) => `<button class="quiz-opt" id="qo-${i}-${oi}" onclick="App.selectOpt(${i},${oi},${quiz.questions.length})">${String.fromCharCode(65 + oi)}. ${opt}</button>`).join("")}
              </div>
            </div>
          `,
            )
            .join("")}
        </div>
        <button class="btn btn-flame btn-block" style="padding:16px;font-size:16px;margin-top:20px;" onclick="App.submitStudentQuiz(${quiz.id},${quiz.questions.length})">
          ✅ Submit Quiz & See Results
        </button>
      `;
      openModal("modal-take-quiz");
      if (quiz.time_limit > 0) {
        let secs = quiz.time_limit * 60;
        clearInterval(S.quizTimerRef);
        S.quizTimerRef = setInterval(() => {
          secs--;
          const el = $("timer-disp");
          if (el)
            el.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
          if (secs <= 0) {
            clearInterval(S.quizTimerRef);
            App.submitStudentQuiz(quiz.id, quiz.questions.length);
          }
        }, 1000);
      }
    } catch (e) {
      toast(e.message, "error");
    }
  },

  selectOpt(qIdx, optIdx, total) {
    S.quizAnswers[qIdx] = optIdx;
    for (let oi = 0; oi < 4; oi++) {
      const el = $(`qo-${qIdx}-${oi}`);
      if (el) el.classList.toggle("sel", oi === optIdx);
    }
    const prog = $("q-progress");
    if (prog)
      prog.innerHTML = `<div style="font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:var(--lilac);">${Object.keys(S.quizAnswers).length}/${total}</div><div class="text-muted" style="font-size:12px;">answered</div>`;
  },

  async submitStudentQuiz(quizId, total) {
    clearInterval(S.quizTimerRef);
    const elapsed = Math.round((Date.now() - S.quizStartTime) / 1000);
    const timeTaken = `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
    try {
      const result = await API.post("/quiz-results", {
        quizId,
        answers: S.quizAnswers,
        timeTaken,
      });
      closeModal("modal-take-quiz");
      const pct = result.percentage,
        g = result.grade;
      const msg =
        pct >= 90
          ? "🎉 Outstanding!"
          : pct >= 75
            ? "🌟 Excellent!"
            : pct >= 60
              ? "👍 Well Done!"
              : pct >= 40
                ? "💪 Keep Practicing"
                : "📚 Study More";
      $("quiz-result-inner").innerHTML = `
        <div class="result-hero">
          <div class="rh-inner">
            <div class="result-ring" style="background:conic-gradient(${pct >= 75 ? "var(--success)" : pct >= 55 ? "var(--lilac)" : "var(--danger)"} ${pct}%, rgba(255,255,255,0.1) 0);">
              <div class="result-ring-bg"><div class="r-pct">${pct}%</div><div class="r-grade">${g}</div></div>
            </div>
            <div class="result-title">${msg}</div>
            <div class="result-sub">${result.questions ? "Review your answers below" : ""}</div>
            <div class="result-nums">
              <div><div class="rn-val">${result.score}</div><div class="rn-label">Correct</div></div>
              <div><div class="rn-val">${total - result.score}</div><div class="rn-label">Wrong</div></div>
              <div><div class="rn-val">${timeTaken}</div><div class="rn-label">Time</div></div>
            </div>
          </div>
        </div>
        ${
          result.questions
            ? `
          <h3 style="font-family:'Syne',sans-serif;font-weight:800;margin:20px 0 14px;">Answer Review</h3>
          ${result.questions
            .map(
              (q, i) => `
            <div class="quiz-q-item">
              <div class="qq-num">Q${i + 1} — <span style="color:${q.isCorrect ? "var(--success)" : "var(--danger)"}">${q.isCorrect ? "✅ Correct" : "❌ Wrong"}</span></div>
              <div class="qq-text">${q.q}</div>
              <div class="qq-opts">
                ${q.opts.map((opt, oi) => `<div class="quiz-opt ${oi === q.correct ? "correct" : q.studentAnswer === oi && oi !== q.correct ? "wrong" : ""}">${String.fromCharCode(65 + oi)}. ${opt}</div>`).join("")}
              </div>
              ${q.exp ? `<div class="quiz-expl">💡 ${q.exp}</div>` : ""}
            </div>
          `,
            )
            .join("")}
        `
            : ""
        }
      `;
      openModal("modal-quiz-result");
      await App.renderStudentQuizzes();
      toast(`Quiz submitted! You scored ${pct}% — Grade ${g}`, "success");
    } catch (e) {
      closeModal("modal-take-quiz");
      toast(e.message, "error");
    }
  },

  async renderStudentFees() {
    try {
      const [fees, activeResp, history] = await Promise.all([
        API.get("/fees?studentId=" + S.user.id),
        API.get("/payments/active"),
        API.get("/payments"),
      ]);

      $("student-payment-active").innerHTML = activeResp.active
        ? `
        <div class="card" style="margin-bottom:16px;">
          <div class="card-hdr"><div><h3>📱 Active Payment QR</h3><div class="hdr-sub">Visible only for limited time</div></div></div>
          <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;">
            <img src="${activeResp.payment.qr_code}" style="width:180px;height:180px;border-radius:14px;border:1px solid var(--border-light);padding:10px;background:#fff;" />
            <div style="flex:1;min-width:240px;">
              <h4 style="margin-bottom:8px;">${activeResp.payment.description}</h4>
              <p>Amount: <strong>₹${Number(activeResp.payment.amount).toLocaleString()}</strong></p>
              <p>Fee Type: ${activeResp.payment.fee_type || "Fee Payment"}</p>
              <p id="student-payment-timer" style="font-weight:700;color:var(--danger);"></p>
              <button class="btn btn-flame btn-sm" onclick="App.openPayModal(${activeResp.payment.fee_id}, ${activeResp.payment.amount})">Open Payment Window</button>
            </div>
          </div>
        </div>`
        : "";

      $("s-fees-list").innerHTML = fees.length
        ? fees
            .map(
              (f) => `
        <div class="fee-card ${f.status}">
          <div class="fee-icon ${f.status === "paid" ? "fi-paid" : "fi-pending"}">${f.status === "paid" ? "✅" : "⏳"}</div>
          <div class="fee-det">
            <h4>${f.description}</h4>
            <p>Month: ${f.month}${f.paid_on ? ` • Paid: ${f.paid_on}` : ""}</p>
            ${f.txn_id ? `<p style="font-size:12px;color:var(--muted);">Txn: ${f.txn_id} via ${f.paid_via}</p>` : ""}
          </div>
          <div class="fee-amt ${f.status === "paid" ? "fee-paid" : "fee-pending"}">₹${f.amount.toLocaleString()}</div>
          <div class="fee-actions">
            <span class="badge ${f.status === "paid" ? "b-success" : "b-danger"}">${f.status === "paid" ? "Paid" : "Pending"}</span>
            ${f.status !== "paid" ? `<button class="btn btn-flame btn-sm" onclick="App.openPayModal(${f.id},${f.amount})">Pay Now →</button>` : ""}
          </div>
        </div>
      `,
            )
            .join("")
        : emptyState("💳", "No fee records found");

      $("student-payment-history").innerHTML = history.length
        ? `
        <table>
          <thead><tr><th>Fee</th><th>Amount</th><th>Status</th><th>Receipt</th><th>Created</th><th>Paid</th></tr></thead>
          <tbody>${history
            .map(
              (h) => `<tr>
            <td>${h.description}</td>
            <td>₹${Number(h.amount).toLocaleString()}</td>
            <td><span class="badge ${h.status === "paid" ? "b-success" : h.status === "active" ? "b-warning" : "b-danger"}">${h.status}</span></td>
            <td>${h.receipt_no || "—"}</td><td>${h.status === "paid" ? `<button class="btn btn-sm btn-info" onclick="App.printPaymentBill(${h.id})">🖨️ Print</button>` : "—"}</td>
            <td>${new Date(h.created_at).toLocaleString()}</td>
            <td>${h.paid_at ? new Date(h.paid_at).toLocaleString() : "—"}</td>
          </tr>`,
            )
            .join("")}</tbody>
        </table>`
        : emptyState("🧾", "No payment history yet");

      if (activeResp.active)
        App.startPaymentCountdown(
          activeResp.payment.expires_at,
          "student-payment-timer",
        );
    } catch (e) {
      toast(e.message, "error");
    }
  },

  startPaymentCountdown(expiresAt, targetId = "pay-expiry") {
    const el = $(targetId);
    if (!el) return;
    if (S.paymentTimer) clearInterval(S.paymentTimer);
    const tick = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) {
        el.textContent = "QR expired";
        clearInterval(S.paymentTimer);
        return;
      }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      el.textContent = `Expires in ${m}:${String(s).padStart(2, "0")}`;
    };
    tick();
    S.paymentTimer = setInterval(tick, 1000);
  },

  async openPayModal(feeId, amount) {
    S.currentPayFeeId = feeId;
    const fees = await API.get("/fees?studentId=" + S.user.id);
    const fee = fees.find((f) => f.id === feeId);
    if (!fee) {
      toast("Fee record not found", "error");
      return;
    }
    const activeResp = await API.get("/payments/active?feeId=" + feeId);
    if (!activeResp.active) {
      toast("No active QR generated by admin for this fee.", "warn");
      return;
    }
    const payment = activeResp.payment;
    S.currentPaymentRequestId = payment.id;
    $("pay-info-text").textContent = `${fee.description} | Month: ${fee.month}`;
    $("pay-amt-display").textContent = `₹${amount.toLocaleString()}`;
    $("pay-amt-inp").value = `₹${amount.toLocaleString()}`;
    $("pay-send-amt").textContent = amount.toLocaleString();
    $("pay-txn-id").value = "";
    $("pay-upi-id").textContent = "UPI ID: vaishnavinpatil1001@oksbi";
    const qrLoader = $("qr-loader");
    const qrImg = $("qr-img");
    if (qrLoader) qrLoader.style.display = "none";
    if (qrImg) {
      qrImg.src = payment.qr_code;
      qrImg.style.display = "block";
    }
    App.startPaymentCountdown(payment.expires_at, "pay-expiry");
    openModal("modal-pay");
  },

  async confirmPayment() {
    const txn = val("pay-txn-id");
    if (!txn) {
      toast("Please enter the Transaction ID / UTR number", "warn");
      return;
    }
    if (!S.currentPaymentRequestId) {
      toast("No active payment request found", "warn");
      return;
    }
    try {
      await API.patch("/payments/" + S.currentPaymentRequestId + "/confirm", {
        txnId: txn,
        paidVia: "UPI QR",
      });
      closeModal("modal-pay");
      await App.renderStudentFees();
      await App.renderFees().catch(() => {});
      toast(
        "✅ Payment confirmed! Teacher has been notified via email.",
        "success",
      );
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async renderStudentFeedback() {
    try {
      const feedback = await API.get("/feedback?studentId=" + S.user.id);
      $("s-my-feedback").innerHTML = feedback.length
        ? feedback
            .map(
              (f) => `
        <div style="padding:14px;border:1.5px solid var(--border-light);border-radius:12px;margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
            <span class="chip ${subjectClass(f.subject)}">${f.subject}</span>
            <span style="color:var(--gold);">${"★".repeat(f.rating)}${"☆".repeat(5 - f.rating)}</span>
          </div>
          <p style="font-size:14px;color:#555;line-height:1.6;">${f.message}</p>
          <p class="text-muted" style="font-size:12px;margin-top:6px;">${f.created_at ? f.created_at.split("T")[0] : ""}</p>
        </div>
      `,
            )
            .join("")
        : emptyState("💬", "You haven't submitted any feedback yet");
    } catch (e) {
      toast(e.message, "error");
    }
  },

  async renderStudentSchedule() {
    try {
      const schedules = await API.get("/schedules");
      const mySubjects = S.user.subjects || [];
      const myScheds = schedules.filter(
        (s) =>
          mySubjects.includes(s.subject) ||
          s.class === "All Classes" ||
          s.class === S.user.class,
      );
      const days = [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ];
      const times = [...new Set(myScheds.map((s) => s.time))].sort();
      if (!times.length) {
        $("s-schedule-view").innerHTML = emptyState(
          "📅",
          "No schedule available yet",
        );
        return;
      }
      let html = `<div class="sched-grid" style="grid-template-columns:80px repeat(${days.length},1fr);">
        <div class="sg-hdr">Time</div>${days.map((d) => `<div class="sg-hdr">${d}</div>`).join("")}`;
      times.forEach((t) => {
        html += `<div class="sg-time">${t}</div>`;
        days.forEach((d) => {
          const slots = myScheds.filter((s) => s.time === t && s.day === d);
          html += `<div class="sg-cell">${slots.map((s) => `<div class="sg-slot sg-${s.subject.toLowerCase()}">${s.subject}<div class="sg-meta">${s.duration}min</div></div>`).join("")}</div>`;
        });
      });
      html += "</div>";
      $("s-schedule-view").innerHTML = html;
    } catch (e) {
      toast(e.message, "error");
    }
  },

  // ── LANDING ─────────────────────────────────
  async refreshLandingStat() {
    try {
      const r = await fetch("/api/dashboard/stats");
      const d = await r.json();
      const el = $("land-stat-students");
      if (el) el.textContent = d.students || "—";
    } catch {}
  },
};

// ─── LANDING STAT ON LOAD ────────────────────────────────────────────────────
App.refreshLandingStat();

// ─── AUTO LOGIN IF TOKEN EXISTS ──────────────────────────────────────────────
(async function autoLogin() {
  const token = localStorage.getItem("sc_token");
  if (!token) return;
  API.token = token;
  try {
    const user = await API.get("/auth/me");
    S.user = user;
    S.role = user.role;
    App.launchApp();
  } catch (e) {
    localStorage.removeItem("sc_token");
    API.token = null;
  }
})();
