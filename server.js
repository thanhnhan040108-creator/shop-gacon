import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import sqlite3 from "sqlite3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const app = express();
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ====== STATIC ======
app.use(express.static(path.join(__dirname, "public")));

// ====== ENV ======
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "admin";
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

// SQLite on Render Persistent Disk (khuyến nghị mount /var/data)
const DB_PATH = process.env.DB_PATH || "/var/data/app.db";
const db = new sqlite3.Database(DB_PATH);

// ====== DB INIT ======
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      pass_hash TEXT NOT NULL,
      balance INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      service_id INTEGER NOT NULL,
      price INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'paid',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(service_id) REFERENCES services(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS topups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'pending', -- pending/approved/rejected
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  // Seed services if empty
  db.get(`SELECT COUNT(*) as c FROM services`, (err, row) => {
    if (!err && row?.c === 0) {
      const stmt = db.prepare(`INSERT INTO services(name, price, active) VALUES(?,?,1)`);
      stmt.run("Robux 120h", 149000);
      stmt.run("Mua Gamepass", 99000);
      stmt.run("Cày thuê", 199000);
      stmt.finalize();
    }
  });
});

// ====== HELPERS ======
function signUserToken(user) {
  return jwt.sign({ role: "user", uid: user.id }, JWT_SECRET, { expiresIn: "7d" });
}
function signAdminToken() {
  return jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "7d" });
}

function authUser(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== "user") return res.status(401).json({ error: "Unauthorized" });
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

function authAdmin(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== "admin") return res.status(401).json({ error: "Unauthorized" });
    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

// ====== USER AUTH ======
app.post("/api/auth/register", (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !email || !password) return res.status(400).json({ error: "Thiếu thông tin" });
  if (String(password).length < 6) return res.status(400).json({ error: "Mật khẩu >= 6 ký tự" });

  const pass_hash = bcrypt.hashSync(String(password), 10);
  db.run(
    `INSERT INTO users(username, email, pass_hash) VALUES(?,?,?)`,
    [String(username).trim(), String(email).trim(), pass_hash],
    function (err) {
      if (err) return res.status(400).json({ error: "Tên tài khoản đã tồn tại" });
      return res.json({ ok: true });
    }
  );
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Thiếu thông tin" });

  db.get(`SELECT * FROM users WHERE username = ?`, [String(username).trim()], (err, user) => {
    if (err || !user) return res.status(401).json({ error: "Sai tài khoản/mật khẩu" });
    const ok = bcrypt.compareSync(String(password), user.pass_hash);
    if (!ok) return res.status(401).json({ error: "Sai tài khoản/mật khẩu" });
    return res.json({ token: signUserToken(user) });
  });
});

app.get("/api/me", authUser, (req, res) => {
  db.get(
    `SELECT id, username, email, balance, created_at FROM users WHERE id = ?`,
    [req.user.uid],
    (err, row) => {
      if (err || !row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    }
  );
});

// ====== USER FEATURES ======
app.get("/api/services", authUser, (req, res) => {
  db.all(`SELECT id, name, price FROM services WHERE active = 1 ORDER BY id DESC`, (err, rows) => {
    if (err) return res.status(500).json({ error: "DB error" });
    res.json(rows);
  });
});

// Buy service: subtract balance + create order
app.post("/api/orders", authUser, (req, res) => {
  const { serviceId } = req.body || {};
  const sid = Number(serviceId);
  if (!sid) return res.status(400).json({ error: "Thiếu serviceId" });

  db.get(`SELECT * FROM services WHERE id = ? AND active = 1`, [sid], (err, svc) => {
    if (err || !svc) return res.status(404).json({ error: "Dịch vụ không tồn tại" });

    db.get(`SELECT balance FROM users WHERE id = ?`, [req.user.uid], (err2, u) => {
      if (err2 || !u) return res.status(404).json({ error: "User không tồn tại" });
      if (u.balance < svc.price) return res.status(400).json({ error: "Số dư không đủ" });

      db.run(`UPDATE users SET balance = balance - ? WHERE id = ?`, [svc.price, req.user.uid], (err3) => {
        if (err3) return res.status(500).json({ error: "Không trừ được số dư" });

        db.run(
          `INSERT INTO orders(user_id, service_id, price, status) VALUES(?,?,?, 'paid')`,
          [req.user.uid, svc.id, svc.price],
          function (err4) {
            if (err4) return res.status(500).json({ error: "Không tạo được đơn" });
            res.json({ ok: true, orderId: this.lastID });
          }
        );
      });
    });
  });
});

app.get("/api/orders", authUser, (req, res) => {
  db.all(
    `SELECT o.id, o.price, o.status, o.created_at, s.name as service_name
     FROM orders o JOIN services s ON s.id = o.service_id
     WHERE o.user_id = ? ORDER BY o.id DESC`,
    [req.user.uid],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "DB error" });
      res.json(rows);
    }
  );
});

// Create topup request
app.post("/api/topups", authUser, (req, res) => {
  const { amount, note } = req.body || {};
  const a = Number(amount);
  if (!Number.isFinite(a) || a <= 0) return res.status(400).json({ error: "Số tiền không hợp lệ" });

  db.run(
    `INSERT INTO topups(user_id, amount, note, status) VALUES(?,?,?, 'pending')`,
    [req.user.uid, a, String(note || "").slice(0, 200)],
    function (err) {
      if (err) return res.status(500).json({ error: "Không tạo được yêu cầu nạp" });
      res.json({ ok: true, topupId: this.lastID });
    }
  );
});

app.get("/api/topups", authUser, (req, res) => {
  db.all(
    `SELECT id, amount, note, status, created_at
     FROM topups WHERE user_id = ? ORDER BY id DESC`,
    [req.user.uid],
    (err, rows) => {
      if (err) return res.status(500).json({ error: "DB error" });
      res.json(rows);
    }
  );
});

// ====== ADMIN AUTH ======
app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) return res.json({ token: signAdminToken() });
  return res.status(401).json({ error: "Sai admin" });
});

// ====== ADMIN MANAGEMENT ======
app.get("/api/admin/users", authAdmin, (req, res) => {
  db.all(`SELECT id, username, email, balance, created_at FROM users ORDER BY id DESC`, (err, rows) => {
    if (err) return res.status(500).json({ error: "DB error" });
    res.json(rows);
  });
});

app.get("/api/admin/services", authAdmin, (req, res) => {
  db.all(`SELECT id, name, price, active, created_at FROM services ORDER BY id DESC`, (err, rows) => {
    if (err) return res.status(500).json({ error: "DB error" });
    res.json(rows);
  });
});

app.post("/api/admin/services", authAdmin, (req, res) => {
  const { name, price, active } = req.body || {};
  if (!name || !Number.isFinite(Number(price))) return res.status(400).json({ error: "Dữ liệu sai" });
  db.run(
    `INSERT INTO services(name, price, active) VALUES(?,?,?)`,
    [String(name).slice(0, 80), Number(price), active ? 1 : 0],
    function (err) {
      if (err) return res.status(500).json({ error: "DB error" });
      res.json({ ok: true, id: this.lastID });
    }
  );
});

app.put("/api/admin/services/:id", authAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { name, price, active } = req.body || {};
  db.run(
    `UPDATE services SET name=?, price=?, active=? WHERE id=?`,
    [String(name).slice(0, 80), Number(price), active ? 1 : 0, id],
    function (err) {
      if (err) return res.status(500).json({ error: "DB error" });
      res.json({ ok: true, changed: this.changes });
    }
  );
});

app.get("/api/admin/topups", authAdmin, (req, res) => {
  db.all(
    `SELECT t.id, t.amount, t.note, t.status, t.created_at, t.user_id, u.username
     FROM topups t JOIN users u ON u.id = t.user_id
     ORDER BY t.id DESC`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: "DB error" });
      res.json(rows);
    }
  );
});

app.post("/api/admin/topups/:id/approve", authAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.get(`SELECT * FROM topups WHERE id=?`, [id], (err, t) => {
    if (err || !t) return res.status(404).json({ error: "Not found" });
    if (t.status !== "pending") return res.status(400).json({ error: "Đã xử lý rồi" });

    db.run(`UPDATE topups SET status='approved' WHERE id=?`, [id], (err2) => {
      if (err2) return res.status(500).json({ error: "DB error" });
      db.run(`UPDATE users SET balance = balance + ? WHERE id = ?`, [t.amount, t.user_id], (err3) => {
        if (err3) return res.status(500).json({ error: "Không cộng được số dư" });
        res.json({ ok: true });
      });
    });
  });
});

app.post("/api/admin/topups/:id/reject", authAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.run(`UPDATE topups SET status='rejected' WHERE id=? AND status='pending'`, [id], function (err) {
    if (err) return res.status(500).json({ error: "DB error" });
    res.json({ ok: true, changed: this.changes });
  });
});

app.get("/api/admin/orders", authAdmin, (req, res) => {
  db.all(
    `SELECT o.id, o.price, o.status, o.created_at,
            u.username, s.name as service_name
     FROM orders o
     JOIN users u ON u.id = o.user_id
     JOIN services s ON s.id = o.service_id
     ORDER BY o.id DESC`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: "DB error" });
      res.json(rows);
    }
  );
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on", PORT));
