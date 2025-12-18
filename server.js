const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const cookieParser = require("cookie-parser");

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;

if (!ADMIN_USER || !ADMIN_PASS) {
  console.error("Thiếu ADMIN_USER / ADMIN_PASS. Hãy set ENV trước khi chạy.");
  process.exit(1);
}

const db = new sqlite3.Database(path.join(__dirname, "shop.db"));
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      pass_hash TEXT NOT NULL,
      gmail TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
    )
  `);
});

function requireAdmin(req, res, next) {
  if (req.cookies?.admin_session === "1") return next();
  return res.status(401).json({ error: "Admin chưa đăng nhập" });
}

// USER REGISTER
app.post("/api/register", async (req, res) => {
  const { username, password, gmail } = req.body || {};
  if (!username || !password || !gmail) return res.status(400).json({ error: "Thiếu thông tin" });

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: "Username 3-20 ký tự, chỉ chữ/số/_" });
  }
  if (password.length < 6) return res.status(400).json({ error: "Mật khẩu tối thiểu 6 ký tự" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gmail)) return res.status(400).json({ error: "Email không hợp lệ" });

  const pass_hash = await bcrypt.hash(password, 10);
  const created_at = new Date().toISOString();

  db.run(
    `INSERT INTO users (username, pass_hash, gmail, created_at, status)
     VALUES (?, ?, ?, ?, 'pending')`,
    [username, pass_hash, gmail, created_at],
    function (err) {
      if (err) {
        if (String(err).includes("UNIQUE")) return res.status(409).json({ error: "Username đã tồn tại" });
        return res.status(500).json({ error: "Lỗi DB" });
      }
      return res.json({ ok: true, user_id: this.lastID });
    }
  );
});

// USER LOGIN (demo)
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Thiếu thông tin" });

  db.get(`SELECT id, username, pass_hash, status FROM users WHERE username = ?`, [username], async (err, row) => {
    if (err) return res.status(500).json({ error: "Lỗi DB" });
    if (!row) return res.status(401).json({ error: "Sai tài khoản hoặc mật khẩu" });

    const ok = await bcrypt.compare(password, row.pass_hash);
    if (!ok) return res.status(401).json({ error: "Sai tài khoản hoặc mật khẩu" });

    res.cookie("user_session", String(row.id), { httpOnly: true, sameSite: "lax" });
    return res.json({ ok: true, status: row.status });
  });
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("user_session");
  return res.json({ ok: true });
});

// ADMIN LOGIN (secret in ENV)
app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    res.cookie("admin_session", "1", { httpOnly: true, sameSite: "lax" });
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: "Sai tài khoản admin hoặc mật khẩu admin" });
});

app.post("/api/admin/logout", (req, res) => {
  res.clearCookie("admin_session");
  return res.json({ ok: true });
});

// ADMIN VIEW USERS
app.get("/api/admin/users", requireAdmin, (req, res) => {
  db.all(`SELECT id, username, gmail, created_at, status FROM users ORDER BY id DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: "Lỗi DB" });
    return res.json({ ok: true, users: rows });
  });
});

app.post("/api/admin/users/:id/approve", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.run(`UPDATE users SET status='approved' WHERE id=?`, [id], function (err) {
    if (err) return res.status(500).json({ error: "Lỗi DB" });
    return res.json({ ok: true, changed: this.changes });
  });
});

app.post("/api/admin/users/:id/reject", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.run(`UPDATE users SET status='rejected' WHERE id=?`, [id], function (err) {
    if (err) return res.status(500).json({ error: "Lỗi DB" });
	return res.json({ ok: true, changed: this.changes });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Mở web: http://localhost:" + PORT));