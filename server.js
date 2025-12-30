const express = require("express");
const session = require("express-session");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_PATH = path.join(__dirname, "data.json");
const PUBLIC_DIR = path.join(__dirname, "public");

// ====== Admin from ENV (2 admin) ======
const ADMINS = [
  { user: (process.env.ADMIN1_USER || "").trim(), pass: (process.env.ADMIN1_PASS || "").trim(), role: "owner" },
  { user: (process.env.ADMIN2_USER || "").trim(), pass: (process.env.ADMIN2_PASS || "").trim(), role: "staff" }
].filter(a => a.user && a.pass);

// ====== Services VOCALA ======
const SERVICES = [
  { group: "Combo Draco", items: [
    { key:"combo_draco", name:"Combo Draco", price:100000 },
    { key:"dai", name:"Đai", price:10000 },
    { key:"sung", name:"Súng", price:12000 },
    { key:"kiem", name:"Kiếm", price:10000 },
    { key:"trung_rong", name:"Trứng rồng", price:5000 },
    { key:"toc_rong", name:"tộc rồng", price:5000 }
  ]},
  { group: "ITEM", items: [
    { key:"yama", name:"Yama", price:5000 },
    { key:"tushita", name:"Tushita", price:5000 },
    { key:"ghepss", name:"Ghép ss", price:5000 },
    { key:"az_cdk", name:"A-Z CDK (bao all)", price:15000 },
    { key:"az_tt", name:"A-Z TT (bao all)", price:20000 },
    { key:"shark_anchor", name:"Shark Anchor", price:10000 },
    { key:"soul_guitar", name:"Soul Guitar", price:10000 },
    { key:"yoru_v3", name:"Yoru V3", price:20000 },
    { key:"foxlamp", name:"Foxlamp | Yêu cầu cần 4 tộc v3", price:15000 }
  ]},
  { group: "LEVI", items: [
    { key:"tim_hydra", name:"Kéo tim về hydra", price:20000 },
    { key:"tim_tiki", name:"Kéo tim về tiki", price:20000 },
    { key:"mele_mau", name:"Mele máu", price:30000 }
  ]},
  { group: "Ken và mas", items: [
    { key:"haki_qs_v2", name:"Haki quan sát V2", price:20000 },
    { key:"mas_1_600", name:"1-600 mas", price:5000 }
  ]},
  { group: "RAID / MELEE", items: [
    { key:"lv_1_700", name:"1-700", price:3000 },
    { key:"lv_700_1500", name:"700-1500", price:8000 },
    { key:"lv_1500_max", name:"1500-max", price:15000 },
    { key:"lv_1_max", name:"1-max", price:20000 },
    { key:"gear", name:"Gear", price:5000 },
    { key:"fg", name:"FG", price:20000 },
    { key:"v1_v3", name:"V1-v3", price:5000 }
  ]},
  { group: "BELI / FRAG", items: [
    { key:"beli_2m", name:"2m beli", price:1000 },
    { key:"frag_2k", name:"2k f", price:1000 }
  ]}
];

// ====== Helpers DB ======
function ensureDB() {
  if (!fs.existsSync(DATA_PATH)) {
    const init = { users: [], orders: [], topups: [] };
    fs.writeFileSync(DATA_PATH, JSON.stringify(init, null, 2), "utf-8");
  }
}
function loadDB() {
  ensureDB();
  return JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
}
function saveDB(db) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(db, null, 2), "utf-8");
}
function uid(prefix="id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
function findService(key) {
  for (const g of SERVICES) {
    const it = g.items.find(x => x.key === key);
    if (it) return { ...it, group: g.group };
  }
  return null;
}
function cardFeeRate(value) {
  // theo yêu cầu bạn:
  // - chung 15%
  // - dưới 50k: 20%
  // - trên/hoặc >= 100k: 20% hay 15%? (bạn nói: "50000 dưới 20% với trên 100k" => >=100k: 20%)
  // Mình làm đúng câu bạn: <50k =20%, >=100k =20%, còn lại =15%
  if (value < 50000) return 0.20;
  if (value >= 100000) return 0.20;
  return 0.15;
}

// ====== Middlewares ======
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || "shop-gacon-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: (Number(process.env.SESSION_MINUTES || 30) * 60 * 1000)
  }
}));

function requireUser(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ ok:false, message:"Chưa đăng nhập" });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.adminUser) return res.status(401).json({ ok:false, message:"Chưa đăng nhập admin" });
  next();
}

// ====== Static public (chỉ CSS/ảnh/etc) ======
app.use("/public", express.static(PUBLIC_DIR));

// ====== Routes pages (tách trang rõ ràng) ======
app.get("/", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));
app.get("/home", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "home.html")));
app.get("/payment", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "payment.html")));

// Admin pages (không lộ trong user UI)
app.get("/admin", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "admin.html")));
app.get("/admin/dashboard", (req, res) => {
  if (!req.session.adminUser) return res.redirect("/admin");
  res.sendFile(path.join(PUBLIC_DIR, "admin-dashboard.html"));
});

// ====== API: public data ======
app.get("/api/services", (req, res) => res.json({ ok:true, services: SERVICES }));

// ====== API: user auth ======
app.post("/api/register", (req, res) => {
  const { username, password, email } = req.body || {};
  if (!username || !password || !email) return res.status(400).json({ ok:false, message:"Thiếu username/password/email" });

  const db = loadDB();
  const exists = db.users.find(u => u.username.toLowerCase() === String(username).toLowerCase());
  if (exists) return res.status(400).json({ ok:false, message:"Username đã tồn tại" });

  const user = {
    id: uid("u"),
    username: String(username).trim(),
    password: String(password),   // demo đơn giản. Muốn mã hoá mình làm tiếp sau.
    email: String(email).trim(),
    balance: 0,
    createdAt: Date.now()
  };
  db.users.push(user);
  saveDB(db);

  req.session.userId = user.id;
  res.json({ ok:true, user: { id:user.id, username:user.username, email:user.email, balance:user.balance } });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok:false, message:"Thiếu username/password" });

  const db = loadDB();
  const user = db.users.find(u => u.username.toLowerCase() === String(username).toLowerCase());
  if (!user || user.password !== String(password)) return res.status(400).json({ ok:false, message:"Sai tài khoản hoặc mật khẩu" });

  req.session.userId = user.id;
  res.json({ ok:true, user: { id:user.id, username:user.username, email:user.email, balance:user.balance } });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok:true }));
});

app.get("/api/me", requireUser, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ ok:false });
  res.json({ ok:true, user: { id:user.id, username:user.username, email:user.email, balance:user.balance } });
});

// reset password by username + email (demo)
app.post("/api/reset-password", (req, res) => {
  const { username, email, newPassword } = req.body || {};
  if (!username || !email || !newPassword) return res.status(400).json({ ok:false, message:"Thiếu dữ liệu" });

  const db = loadDB();
  const user = db.users.find(
    u => u.username.toLowerCase() === String(username).toLowerCase()
      && u.email.toLowerCase() === String(email).toLowerCase()
  );
  if (!user) return res.status(400).json({ ok:false, message:"Không khớp username + email" });

  user.password = String(newPassword);
  saveDB(db);
  res.json({ ok:true, message:"Đổi mật khẩu thành công" });
});

// ====== API: orders ======
app.post("/api/orders", requireUser, (req, res) => {
  const { serviceKey, note } = req.body || {};
  const sv = findService(serviceKey);
  if (!sv) return res.status(400).json({ ok:false, message:"Dịch vụ không tồn tại" });

  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ ok:false });

  if (user.balance < sv.price) return res.status(400).json({ ok:false, message:"Số dư không đủ" });

  user.balance -= sv.price;

  const order = {
    id: uid("od"),
    uid: user.id,
    username: user.username,
    serviceKey: sv.key,
    serviceName: sv.name,
    group: sv.group,
    price: sv.price,
    note: String(note || "").trim(),
    status: "Đã tạo",
    createdAt: Date.now()
  };
  db.orders.unshift(order);
  saveDB(db);

  res.json({ ok:true, order, balance: user.balance });
});

app.get("/api/history", requireUser, (req, res) => {
  const db = loadDB();
  const orders = db.orders.filter(o => o.uid === req.session.userId);
  const topups = db.topups.filter(t => t.uid === req.session.userId);
  res.json({ ok:true, orders, topups });
});

// ====== API: topup requests (demo - admin duyệt) ======
app.post("/api/topup/mb", requireUser, (req, res) => {
  const amount = Number(req.body?.amount);
  if (!amount || amount < 1000) return res.status(400).json({ ok:false, message:"Số tiền không hợp lệ" });

  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ ok:false });

  const code = "NAP_" + Math.random().toString(16).slice(2, 8).toUpperCase();

  const topup = {
    id: uid("tp"),
    uid: user.id,
    username: user.username,
    method: "MB Bank",
    amount,
    fee: 0,
    total: amount,
    code,
    status: "Chờ duyệt",
    createdAt: Date.now()
  };
  db.topups.unshift(topup);
  saveDB(db);

  res.json({ ok:true, topup });
});

app.post("/api/topup/card", requireUser, (req, res) => {
  const telco = String(req.body?.telco || "");
  const value = Number(req.body?.value);
  const serial = String(req.body?.serial || "").trim();
  const pin = String(req.body?.pin || "").trim();

  const allowedTelco = ["Vinaphone", "Mobiphone", "Viettel", "Garena", "Zing"];
  const allowedValue = [20000, 50000, 100000, 200000, 500000];

  if (!allowedTelco.includes(telco)) return res.status(400).json({ ok:false, message:"Nhà mạng không hợp lệ" });
  if (!allowedValue.includes(value)) return res.status(400).json({ ok:false, message:"Mệnh giá không hợp lệ" });
  if (!serial || !pin) return res.status(400).json({ ok:false, message:"Thiếu serial hoặc mã thẻ" });

  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ ok:false });

  const feeRate = cardFeeRate(value);
  const fee = Math.round(value * feeRate);
  const total = value - fee;

  const topup = {
    id: uid("tp"),
    uid: user.id,
    username: user.username,
    method: "Card " + telco,
    amount: value,
    fee,
    total,
    code: "CARD_" + Math.random().toString(16).slice(2, 8).toUpperCase(),
    card: { telco, value, serial, pin }, // demo: lưu để admin duyệt (thật thì không nên lưu pin)
    status: "Chờ duyệt",
    createdAt: Date.now()
  };
  db.topups.unshift(topup);
  saveDB(db);

  res.json({ ok:true, topup });
});

app.get("/api/topup/:id", requireUser, (req, res) => {
  const db = loadDB();
  const topup = db.topups.find(t => t.id === req.params.id && t.uid === req.session.userId);
  if (!topup) return res.status(404).json({ ok:false, message:"Không tìm thấy" });
  res.json({ ok:true, topup });
});

// ====== ADMIN AUTH ======
app.post("/api/admin/login", (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "").trim();

  const a = ADMINS.find(x => x.user === username && x.pass === password);
  if (!a) return res.status(401).json({ ok:false, message:"Sai admin" });

  req.session.adminUser = a.user;
  req.session.adminRole = a.role;
  res.json({ ok:true, admin: { username: a.user, role: a.role } });
});

app.post("/api/admin/logout", (req, res) => {
  req.session.adminUser = null;
  req.session.adminRole = null;
  res.json({ ok:true });
});

app.get("/api/admin/me", requireAdmin, (req, res) => {
  res.json({ ok:true, admin: { username: req.session.adminUser, role: req.session.adminRole } });
});

// Admin lists
app.get("/api/admin/orders", requireAdmin, (req, res) => {
  const db = loadDB();
  res.json({ ok:true, orders: db.orders });
});
app.post("/api/admin/orders/:id/status", requireAdmin, (req, res) => {
  const status = String(req.body?.status || "");
  const allowed = ["Đã tạo", "Đang làm", "Hoàn thành", "Hủy"];
  if (!allowed.includes(status)) return res.status(400).json({ ok:false, message:"Status không hợp lệ" });

  const db = loadDB();
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ ok:false, message:"Không tìm thấy đơn" });

  order.status = status;
  order.updatedAt = Date.now();
  saveDB(db);

  res.json({ ok:true, order });
});

app.get("/api/admin/topups", requireAdmin, (req, res) => {
  const db = loadDB();
  res.json({ ok:true, topups: db.topups });
});

app.post("/api/admin/topups/:id/approve", requireAdmin, (req, res) => {
  const db = loadDB();
  const topup = db.topups.find(t => t.id === req.params.id);
  if (!topup) return res.status(404).json({ ok:false, message:"Không tìm thấy topup" });
  if (topup.status === "Đã duyệt") return res.json({ ok:true, topup });

  const user = db.users.find(u => u.id === topup.uid);
  if (!user) return res.status(404).json({ ok:false, message:"Không tìm thấy user" });

  user.balance += Number(topup.total || 0);
  topup.status = "Đã duyệt";
  topup.approvedAt = Date.now();
  saveDB(db);

  res.json({ ok:true, topup, userBalance: user.balance });
});

app.post("/api/admin/topups/:id/reject", requireAdmin, (req, res) => {
  const reason = String(req.body?.reason || "").trim();
  const db = loadDB();
  const topup = db.topups.find(t => t.id === req.params.id);
  if (!topup) return res.status(404).json({ ok:false, message:"Không tìm thấy topup" });

  topup.status = "Từ chối";
  topup.reason = reason;
  topup.rejectedAt = Date.now();
  saveDB(db);

  res.json({ ok:true, topup });
});

// ====== Start ======
app.listen(PORT, () => console.log("Shop-Gacon running:", PORT));


