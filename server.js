const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const DB_PATH = path.join(__dirname, "data.json");

function loadDB() {
  if (!fs.existsSync(DB_PATH)) return { users: [], orders: [], topups: [] };
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  } catch {
    return { users: [], orders: [], topups: [] };
  }
}
function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}
function genCode(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}
function nowISO() {
  return new Date().toISOString();
}

// ===== Auth (User) =====
app.post("/api/auth/register", (req, res) => {
  const { username, password, gmail } = req.body || {};
  if (!username || !password || !gmail) {
    return res.status(400).json({ ok: false, msg: "Thiếu username/password/gmail" });
  }
  const db = loadDB();
  if (db.users.find(u => u.username === username)) {
    return res.status(409).json({ ok: false, msg: "Tài khoản đã tồn tại" });
  }
  db.users.push({
    username,
    password, // demo: lưu thẳng. Khi lên thật: phải hash.
    gmail,
    balance: 0,
    createdAt: nowISO()
  });
  saveDB(db);
  res.json({ ok: true });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  const db = loadDB();
  const u = db.users.find(x => x.username === username && x.password === password);
  if (!u) return res.status(401).json({ ok: false, msg: "Sai tài khoản hoặc mật khẩu" });
  res.json({ ok: true, user: { username: u.username, gmail: u.gmail, balance: u.balance } });
});

// ===== Balance =====
app.get("/api/balance", (req, res) => {
  const { username } = req.query;
  const db = loadDB();
  const u = db.users.find(x => x.username === username);
  res.json({ ok: true, balance: u ? Number(u.balance || 0) : 0 });
});

// ===== Services (demo list) =====
const SERVICES = [
  { id: "robux", name: "Mua Robux", price: 50000, desc: "Robux nhanh - demo" },
  { id: "bloxfruit", name: "Dịch vụ Blox Fruit", price: 30000, desc: "Dịch vụ game - demo" },
  { id: "gamepass", name: "Gamepass", price: 20000, desc: "Gamepass - demo" }
];

app.get("/api/services", (req, res) => {
  res.json({ ok: true, services: SERVICES });
});

// ===== Orders (trừ số dư + lưu lịch sử mua) =====
app.post("/api/orders", (req, res) => {
  const { username, serviceId } = req.body || {};
  const db = loadDB();
  const u = db.users.find(x => x.username === username);
  const s = SERVICES.find(x => x.id === serviceId);
  if (!u) return res.status(404).json({ ok: false, msg: "Không tìm thấy user" });
  if (!s) return res.status(404).json({ ok: false, msg: "Không tìm thấy dịch vụ" });

  const bal = Number(u.balance || 0);
  if (bal < s.price) return res.status(400).json({ ok: false, msg: "Số dư không đủ" });

  u.balance = bal - s.price;

  const order = {
    id: Date.now().toString(),
    username,
    serviceId,
    serviceName: s.name,
    amount: s.price,
    status: "PAID",
    createdAt: nowISO()
  };
  db.orders.unshift(order);
  saveDB(db);

  res.json({ ok: true, order, balance: u.balance });
});

app.get("/api/orders", (req, res) => {
  const { username } = req.query;
  const db = loadDB();
  const list = username ? db.orders.filter(o => o.username === username) : db.orders;
  res.json({ ok: true, orders: list });
});

// ===== Topups (MB transfer - manual approve) =====
app.post("/api/topups", (req, res) => {
  const { username, amount } = req.body || {};
  const amt = Number(amount);
  if (!username || !Number.isFinite(amt) || amt < 1000) {
    return res.status(400).json({ ok: false, msg: "Thiếu username hoặc số tiền không hợp lệ" });
  }

  const db = loadDB();
  const code = genCode("NAP"); // nội dung chuyển khoản

  const topup = {
    id: Date.now().toString(),
    username,
    amount: amt,
    code,
    status: "PENDING",
    createdAt: nowISO(),
    approvedAt: null
  };

  db.topups.unshift(topup);
  saveDB(db);
  res.json({ ok: true, topup });
});

app.get("/api/topups", (req, res) => {
  const { username } = req.query;
  const db = loadDB();
  const list = username ? db.topups.filter(t => t.username === username) : db.topups;
  res.json({ ok: true, topups: list });
});

// ===== Admin auth helper =====
function isAdmin(body) {
  return body?.adminUser === process.env.ADMIN_USER && body?.adminPass === process.env.ADMIN_PASS;
}

// Admin: list all (topups + users + orders)
app.post("/api/admin/summary", (req, res) => {
  if (!isAdmin(req.body)) return res.status(401).json({ ok: false, msg: "Sai admin" });
  const db = loadDB();
  res.json({ ok: true, users: db.users, topups: db.topups, orders: db.orders });
});

// Admin: approve topup (cộng tiền)
app.post("/api/admin/topups/approve", (req, res) => {
  if (!isAdmin(req.body)) return res.status(401).json({ ok: false, msg: "Sai admin" });
  const { topupId } = req.body || {};

  const db = loadDB();
  const t = db.topups.find(x => x.id === topupId);
  if (!t) return res.status(404).json({ ok: false, msg: "Không thấy topup" });
  if (t.status === "APPROVED") return res.json({ ok: true });

  const u = db.users.find(x => x.username === t.username);
  if (!u) return res.status(404).json({ ok: false, msg: "User không tồn tại" });

  u.balance = Number(u.balance || 0) + Number(t.amount);
  t.status = "APPROVED";
  t.approvedAt = nowISO();

  saveDB(db);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
