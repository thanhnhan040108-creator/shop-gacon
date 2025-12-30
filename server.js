// server.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ====== CONFIG ======
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data.json");
const PUBLIC_DIR = path.join(__dirname, "public");

// Admin from Render Env
const ADMIN_USER = (process.env.ADMIN_USER || "gacon").trim();
const ADMIN_PASSWORDS = (process.env.ADMIN_PASSWORD || "1234")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// Token settings
const TOKEN_SECRET = process.env.TOKEN_SECRET || "CHANGE_ME_TOKEN_SECRET";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 6; // 6h
const ADMIN_TTL_MS = 1000 * 60 * 30;     // 30 phút

// ====== Helpers: Data store ======
function readDB() {
  if (!fs.existsSync(DATA_FILE)) {
    const init = { users: [], orders: [], topups: [], adminLogs: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(init, null, 2), "utf-8");
  }
  const raw = fs.readFileSync(DATA_FILE, "utf-8");
  return JSON.parse(raw || "{}");
}
function writeDB(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), "utf-8");
}
function id(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
function hashPassword(pw) {
  // đơn giản (demo). Nếu muốn mạnh hơn -> bcrypt
  return crypto.createHash("sha256").update(String(pw)).digest("hex");
}
function signToken(payload, ttlMs) {
  const exp = Date.now() + ttlMs;
  const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString("base64url");
  const sig = crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const check = crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest("base64url");
  if (check !== sig) return null;
  const data = JSON.parse(Buffer.from(body, "base64url").toString("utf-8"));
  if (!data.exp || Date.now() > data.exp) return null;
  return data;
}
function getBearer(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return "";
  return h.slice(7);
}
function requireUser(req, res, next) {
  const token = getBearer(req);
  const data = verifyToken(token);
  if (!data || data.type !== "user") return res.status(401).json({ ok: false, message: "Chưa đăng nhập" });
  req.userToken = data;
  next();
}
function requireAdmin(req, res, next) {
  const token = getBearer(req);
  const data = verifyToken(token);
  if (!data || data.type !== "admin") return res.status(401).json({ ok: false, message: "Chưa đăng nhập admin" });
  req.adminToken = data;
  next();
}

// ====== Services (VOCALA) ======
const SERVICES = [
  {
    group: "Combo Draco",
    items: [
      { key: "combo_draco", name: "Combo Draco", price: 100000 },
      { key: "dai", name: "Đai", price: 10000 },
      { key: "sung", name: "Súng", price: 12000 },
      { key: "kiem", name: "Kiếm", price: 10000 },
      { key: "trung_rong", name: "Trứng rồng", price: 5000 },
      { key: "doc_rung", name: "Độc rừng", price: 5000 },
    ],
  },
  {
    group: "ITEM",
    items: [
      { key: "yama", name: "Yama", price: 5000 },
      { key: "tushita", name: "Tushita", price: 5000 },
      { key: "ghep", name: "Ghép", price: 5000 },
      { key: "cdk_az", name: "A-Z CDK (bao all)", price: 15000 },
      { key: "tt_az", name: "A-Z TT (bao all)", price: 20000 },
      { key: "shark_anchor", name: "Shark Anchor", price: 10000 },
      { key: "soul_guitar", name: "Soul Guitar", price: 10000 },
      { key: "yoru_v3", name: "Yoru V3", price: 20000 },
      { key: "foxlamp", name: "Foxlamp (Yêu cầu full 4 tộc v3)", price: 15000 },
    ],
  },
  {
    group: "LEVI",
    items: [
      { key: "keo_tim_hydra", name: "Kéo tim về hydra", price: 20000 },
      { key: "keo_tim_tiki", name: "Kéo tim về tiki", price: 20000 },
      { key: "mele_mau", name: "Mele máu", price: 30000 },
    ],
  },
  {
    group: "Ken và mas",
    items: [
      { key: "haki_qs_v2", name: "Haki quan sát V2", price: 20000 },
      { key: "mas_1_600", name: "1-600 mas", price: 5000 },
    ],
  },
  {
    group: "RAID / MELEE",
    items: [
      { key: "lv_1_700", name: "1-700", price: 3000 },
      { key: "lv_700_1500", name: "700-1500", price: 8000 },
      { key: "lv_1500_max", name: "1500-max", price: 15000 },
      { key: "lv_1_max", name: "1-max", price: 20000 },
      { key: "gear", name: "Gear", price: 5000 },
      { key: "fg", name: "FG", price: 20000 },
      { key: "v1_v3", name: "V1-v3", price: 5000 },
    ],
  },
  {
    group: "BELI / FRAG",
    items: [
      { key: "beli_2m", name: "2m beli", price: 1000 },
      { key: "frag_2k", name: "2k frag", price: 1000 },
    ],
  },
];

// ====== Serve static ======
app.use(express.static(PUBLIC_DIR));

// default route
app.get("/", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

// ====== API ======

// Services
app.get("/api/services", (req, res) => {
  res.json({ ok: true, services: SERVICES });
});

// Register / Login user
app.post("/api/register", (req, res) => {
  const { username, password, email } = req.body || {};
  if (!username || !password || !email) {
    return res.status(400).json({ ok: false, message: "Thiếu username/password/email" });
  }
  const db = readDB();
  const exists = db.users.find(u => u.username.toLowerCase() === String(username).toLowerCase());
  if (exists) return res.status(400).json({ ok: false, message: "Username đã tồn tại" });

  const user = {
    id: id("u"),
    username: String(username).trim(),
    email: String(email).trim(),
    passHash: hashPassword(password),
    balance: 0,
    createdAt: Date.now(),
  };
  db.users.push(user);
  writeDB(db);

  const token = signToken({ type: "user", uid: user.id }, TOKEN_TTL_MS);
  res.json({ ok: true, token, user: { id: user.id, username: user.username, email: user.email, balance: user.balance } });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, message: "Thiếu username/password" });

  const db = readDB();
  const user = db.users.find(u => u.username.toLowerCase() === String(username).toLowerCase());
  if (!user) return res.status(400).json({ ok: false, message: "Sai tài khoản hoặc mật khẩu" });

  if (user.passHash !== hashPassword(password)) {
    return res.status(400).json({ ok: false, message: "Sai tài khoản hoặc mật khẩu" });
  }

  const token = signToken({ type: "user", uid: user.id }, TOKEN_TTL_MS);
  res.json({ ok: true, token, user: { id: user.id, username: user.username, email: user.email, balance: user.balance } });
});

app.get("/api/me", requireUser, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.userToken.uid);
  if (!user) return res.status(401).json({ ok: false, message: "User không tồn tại" });
  res.json({ ok: true, user: { id: user.id, username: user.username, email: user.email, balance: user.balance } });
});

// Forgot password (demo): verify by username+email then reset
app.post("/api/reset-password", (req, res) => {
  const { username, email, newPassword } = req.body || {};
  if (!username || !email || !newPassword) {
    return res.status(400).json({ ok: false, message: "Thiếu username/email/newPassword" });
  }
  const db = readDB();
  const user = db.users.find(
    u => u.username.toLowerCase() === String(username).toLowerCase() && u.email.toLowerCase() === String(email).toLowerCase()
  );
  if (!user) return res.status(400).json({ ok: false, message: "Không khớp thông tin" });

  user.passHash = hashPassword(newPassword);
  writeDB(db);
  res.json({ ok: true, message: "Đổi mật khẩu thành công" });
});

// Create order (spend balance)
app.post("/api/orders", requireUser, (req, res) => {
  const { serviceKey, note } = req.body || {};
  if (!serviceKey) return res.status(400).json({ ok: false, message: "Thiếu serviceKey" });

  const db = readDB();
  const user = db.users.find(u => u.id === req.userToken.uid);
  if (!user) return res.status(401).json({ ok: false, message: "User không tồn tại" });

  // find service
  let found = null;
  for (const g of SERVICES) {
    const it = g.items.find(x => x.key === serviceKey);
    if (it) found = { ...it, group: g.group };
  }
  if (!found) return res.status(400).json({ ok: false, message: "Dịch vụ không tồn tại" });

  if (user.balance < found.price) {
    return res.status(400).json({ ok: false, message: "Số dư không đủ. Hãy nạp tiền trước." });
  }

  user.balance -= found.price;

  const order = {
    id: id("od"),
    uid: user.id,
    username: user.username,
    serviceKey: found.key,
    serviceName: found.name,
    group: found.group,
    price: found.price,
    note: String(note || "").trim(),
    status: "Đã tạo",
    createdAt: Date.now(),
  };
  db.orders.unshift(order);
  writeDB(db);

  res.json({ ok: true, order, balance: user.balance });
});

app.get("/api/history", requireUser, (req, res) => {
  const db = readDB();
  const orders = db.orders.filter(o => o.uid === req.userToken.uid);
  const topups = db.topups.filter(t => t.uid === req.userToken.uid);
  res.json({ ok: true, orders, topups });
});

// Create MB topup request: generate code NAP_xxx
app.post("/api/topup/mb", requireUser, (req, res) => {
  const { amount } = req.body || {};
  const n = Number(amount);
  if (!n || n < 1000) return res.status(400).json({ ok: false, message: "Số tiền không hợp lệ" });

  const db = readDB();
  const user = db.users.find(u => u.id === req.userToken.uid);
  if (!user) return res.status(401).json({ ok: false, message: "User không tồn tại" });

  const code = `NAP_${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const topup = {
    id: id("tp"),
    uid: user.id,
    username: user.username,
    method: "MB Bank",
    amount: n,
    fee: 0,
    total: n,
    code,
    status: "Chờ duyệt",
    createdAt: Date.now(),
  };
  db.topups.unshift(topup);
  writeDB(db);

  res.json({ ok: true, topup });
});

// Card topup request (Vinaphone/Mobiphone/Viettel/Garena/Zing)
// Fee rules: < 50k => 20% ; >= 100k => 15% ; else 15% (bạn muốn “chung 15%”, mình áp 20% khi <50k, 15% khi >=100k)
app.post("/api/topup/card", requireUser, (req, res) => {
  const { telco, value, serial, pin } = req.body || {};
  const allowed = ["Vinaphone", "Mobiphone", "Viettel", "Garena", "Zing"];
  if (!allowed.includes(String(telco))) return res.status(400).json({ ok: false, message: "Nhà mạng không hợp lệ" });

  const v = Number(value);
  const valuesAllowed = [20000, 50000, 100000, 200000, 500000];
  if (!valuesAllowed.includes(v)) return res.status(400).json({ ok: false, message: "Mệnh giá không hợp lệ" });

  if (!serial || !pin) return res.status(400).json({ ok: false, message: "Thiếu serial hoặc mã thẻ" });

  const db = readDB();
  const user = db.users.find(u => u.id === req.userToken.uid);
  if (!user) return res.status(401).json({ ok: false, message: "User không tồn tại" });

  let feeRate = 0.15;
  if (v < 50000) feeRate = 0.20;
  if (v >= 100000) feeRate = 0.15;

  const fee = Math.round(v * feeRate);
  const received = v - fee;

  const topup = {
    id: id("tp"),
    uid: user.id,
    username: user.username,
    method: `Card ${telco}`,
    amount: v,
    fee,
    total: received,
    code: `CARD_${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
    card: { telco, value: v, serial: String(serial).trim(), pin: String(pin).trim() },
    status: "Chờ duyệt",
    createdAt: Date.now(),
  };
  db.topups.unshift(topup);
  writeDB(db);

  res.json({ ok: true, topup });
});

// Payment info for a topup id
app.get("/api/topup/:id", requireUser, (req, res) => {
  const db = readDB();
  const topup = db.topups.find(t => t.id === req.params.id && t.uid === req.userToken.uid);
  if (!topup) return res.status(404).json({ ok: false, message: "Không tìm thấy yêu cầu nạp" });
  res.json({ ok: true, topup });
});

// ====== ADMIN ======
app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, message: "Thiếu username/password" });

  const uok = String(username).trim() === ADMIN_USER;
  const pok = ADMIN_PASSWORDS.includes(String(password).trim());
  if (!uok || !pok) return res.status(401).json({ ok: false, message: "Sai admin" });

  const token = signToken({ type: "admin", role: "admin", name: ADMIN_USER }, ADMIN_TTL_MS);
  res.json({ ok: true, token, admin: { username: ADMIN_USER, role: "admin", ttlMinutes: 30 } });
});

app.get("/api/admin/summary", requireAdmin, (req, res) => {
  const db = readDB();
  const pendingTopups = db.topups.filter(t => t.status === "Chờ duyệt").length;
  const pendingOrders = db.orders.filter(o => o.status === "Đã tạo").length;
  res.json({ ok: true, pendingTopups, pendingOrders, totalUsers: db.users.length });
});

app.get("/api/admin/topups", requireAdmin, (req, res) => {
  const db = readDB();
  res.json({ ok: true, topups: db.topups });
});

app.post("/api/admin/topups/:id/approve", requireAdmin, (req, res) => {
  const db = readDB();
  const topup = db.topups.find(t => t.id === req.params.id);
  if (!topup) return res.status(404).json({ ok: false, message: "Không tìm thấy topup" });
  if (topup.status === "Đã duyệt") return res.json({ ok: true, topup });

  const user = db.users.find(u => u.id === topup.uid);
  if (!user) return res.status(404).json({ ok: false, message: "Không tìm thấy user" });

  // cộng số tiền thực nhận (total)
  user.balance += Number(topup.total || 0);
  topup.status = "Đã duyệt";
  topup.approvedAt = Date.now();

  writeDB(db);
  res.json({ ok: true, topup, balance: user.balance });
});

app.post("/api/admin/topups/:id/reject", requireAdmin, (req, res) => {
  const { reason } = req.body || {};
  const db = readDB();
  const topup = db.topups.find(t => t.id === req.params.id);
  if (!topup) return res.status(404).json({ ok: false, message: "Không tìm thấy topup" });

  topup.status = "Từ chối";
  topup.reason = String(reason || "").trim();
  topup.rejectedAt = Date.now();

  writeDB(db);
  res.json({ ok: true, topup });
});

app.get("/api/admin/orders", requireAdmin, (req, res) => {
  const db = readDB();
  res.json({ ok: true, orders: db.orders });
});

app.post("/api/admin/orders/:id/status", requireAdmin, (req, res) => {
  const { status } = req.body || {};
  const allowed = ["Đã tạo", "Đang làm", "Hoàn thành", "Hủy"];
  if (!allowed.includes(String(status))) return res.status(400).json({ ok: false, message: "Status không hợp lệ" });

  const db = readDB();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ ok: false, message: "Không tìm thấy đơn" });

  order.status = String(status);
  order.updatedAt = Date.now();
  writeDB(db);

  res.json({ ok: true, order });
});

// ====== FALLBACK routes ======
app.get("/home", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "home.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "admin.html")));
app.get("/admin-dashboard", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "admin-dashboard.html")));
app.get("/payment", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "payment.html")));

// ====== START ======
app.listen(PORT, () => {
  console.log("Shop server running on port", PORT);
});
