const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ====== Paths ======
const DATA_PATH = path.join(__dirname, "data.json");
const PUBLIC_DIR = path.join(__dirname, "public");

// ====== Helpers ======
function readDB() {
  try {
    if (!fs.existsSync(DATA_PATH)) {
      fs.writeFileSync(
        DATA_PATH,
        JSON.stringify({ users: [], admins: [], orders: [], topups: [] }, null, 2),
        "utf8"
      );
    }
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    return JSON.parse(raw || "{}");
  } catch (e) {
    return { users: [], admins: [], orders: [], topups: [] };
  }
}

function writeDB(db) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(db, null, 2), "utf8");
}

function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowISO() {
  return new Date().toISOString();
}

// Basic token (demo): lưu localStorage phía client, server chỉ check khớp
function makeToken(kind, id) {
  return `${kind}.${id}.${Math.random().toString(36).slice(2)}.${Date.now().toString(36)}`;
}

function feeForCard(amount) {
  // Bạn yêu cầu:
  // - Dưới 50k: chiết khấu 20%
  // - Trên 100k: chiết khấu 15%
  // - Còn lại: lấy 15%
  if (amount < 50000) return 0.2;
  return 0.15;
}

// ====== Services (VOCALA) ======
const SERVICES = [
  {
    group: "Combo Draco",
    items: [
      { key: "combo_draco_100k", name: "Combo Draco", price: 100000, note: "" },
      { key: "dai_10k", name: "Đai", price: 10000, note: "" },
      { key: "sung_12k", name: "Súng", price: 12000, note: "" },
      { key: "kiem_10k", name: "Kiếm", price: 10000, note: "" },
      { key: "trung_rong_5k", name: "Trứng rồng", price: 5000, note: "" },
      { key: "doc_rung_5k", name: "Độc rừng", price: 5000, note: "" }
    ]
  },
  {
    group: "ITEM",
    items: [
      { key: "yama_5k", name: "Yama", price: 5000, note: "" },
      { key: "tushita_5k", name: "Tushita", price: 5000, note: "" },
      { key: "ghep_5k", name: "Ghép", price: 5000, note: "" },
      { key: "az_cdk_15k", name: "A-Z CDK (bao all)", price: 15000, note: "" },
      { key: "az_tt_20k", name: "A-Z TT (bao all)", price: 20000, note: "" },
      { key: "shark_anchor_10k", name: "Shark Anchor", price: 10000, note: "" },
      { key: "soul_guitar_10k", name: "Soul Guitar", price: 10000, note: "" },
      { key: "yoru_v3_20k", name: "Yoru V3", price: 20000, note: "Yêu cầu full 4 tộc v3" },
      { key: "foxlamp_15k", name: "Foxlamp", price: 15000, note: "" }
    ]
  },
  {
    group: "LEVI",
    items: [
      { key: "keo_hydra_20k", name: "Kéo tim về Hydra", price: 20000, note: "" },
      { key: "keo_tiki_20k", name: "Kéo tim về Tiki", price: 20000, note: "" },
      { key: "mele_mau_30k", name: "Mele máu", price: 30000, note: "" }
    ]
  },
  {
    group: "Ken và Mas",
    items: [
      { key: "haki_qs_v2_20k", name: "Haki quan sát V2", price: 20000, note: "" },
      { key: "mas_1_600_5k", name: "1-600 mastery", price: 5000, note: "" }
    ]
  },
  {
    group: "RAID / MELEE",
    items: [
      { key: "lv_1_700_3k", name: "Cày level 1-700", price: 3000, note: "" },
      { key: "lv_700_1500_8k", name: "Cày level 700-1500", price: 8000, note: "" },
      { key: "lv_1500_max_15k", name: "Cày level 1500-max", price: 15000, note: "" },
      { key: "lv_1_max_20k", name: "Cày level 1-max", price: 20000, note: "" },
      { key: "gear_5k", name: "Gear", price: 5000, note: "" },
      { key: "fg_20k", name: "FG", price: 20000, note: "" },
      { key: "v1_v3_5k", name: "V1-v3", price: 5000, note: "" }
    ]
  },
  {
    group: "BELI / FRAG",
    items: [
      { key: "beli_2m_1k", name: "2m beli", price: 1000, note: "" },
      { key: "frag_2k_1k", name: "2k frag", price: 1000, note: "" }
    ]
  }
];

// ====== Static ======
app.use(express.static(PUBLIC_DIR));

// ====== Health ======
app.get("/api/health", (req, res) => res.json({ ok: true, time: nowISO() }));

// ====== Services ======
app.get("/api/services", (req, res) => res.json({ ok: true, services: SERVICES }));

// ====== User Auth ======
app.post("/api/auth/register", (req, res) => {
  const { username, password, email } = req.body || {};
  if (!username || !password || !email) return res.status(400).json({ ok: false, message: "Thiếu username/password/email" });

  const db = readDB();
  const exists = db.users.find(u => u.username.toLowerCase() === String(username).toLowerCase());
  if (exists) return res.status(409).json({ ok: false, message: "Tên tài khoản đã tồn tại" });

  const user = {
    id: uid("u"),
    username: String(username),
    password: String(password),
    email: String(email),
    balance: 0,
    createdAt: nowISO()
  };
  db.users.push(user);
  writeDB(db);

  return res.json({ ok: true, message: "Tạo tài khoản thành công" });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  const db = readDB();
  const user = db.users.find(
    u => u.username.toLowerCase() === String(username || "").toLowerCase() && u.password === String(password || "")
  );
  if (!user) return res.status(401).json({ ok: false, message: "Sai tài khoản hoặc mật khẩu" });

  const token = makeToken("user", user.id);
  return res.json({
    ok: true,
    token,
    user: { id: user.id, username: user.username, email: user.email, balance: user.balance }
  });
});

// reset password (demo) bằng email + username
app.post("/api/auth/reset", (req, res) => {
  const { username, email, newPassword } = req.body || {};
  const db = readDB();
  const user = db.users.find(
    u => u.username.toLowerCase() === String(username || "").toLowerCase() && u.email.toLowerCase() === String(email || "").toLowerCase()
  );
  if (!user) return res.status(404).json({ ok: false, message: "Không tìm thấy tài khoản khớp email" });
  if (!newPassword) return res.status(400).json({ ok: false, message: "Thiếu mật khẩu mới" });

  user.password = String(newPassword);
  writeDB(db);
  return res.json({ ok: true, message: "Đổi mật khẩu thành công" });
});

// ====== Admin Auth ======
app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body || {};
  const db = readDB();
  const admin = db.admins.find(
    a => a.username.toLowerCase() === String(username || "").toLowerCase() && a.password === String(password || "")
  );
  if (!admin) return res.status(401).json({ ok: false, message: "Sai admin hoặc mật khẩu" });

  const token = makeToken("admin", admin.id);
  return res.json({
    ok: true,
    token,
    admin: { id: admin.id, username: admin.username, role: admin.role }
  });
});

// ====== Middleware check tokens (demo) ======
function requireUser(req, res, next) {
  const token = req.headers["x-auth-token"];
  const uidPart = String(token || "").split(".")[1];
  const db = readDB();
  const user = db.users.find(u => u.id === uidPart);
  if (!token || !uidPart || !user) return res.status(401).json({ ok: false, message: "Chưa đăng nhập" });
  req._db = db;
  req.user = user;
  req.token = token;
  next();
}

function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];
  const aidPart = String(token || "").split(".")[1];
  const db = readDB();
  const admin = db.admins.find(a => a.id === aidPart);
  if (!token || !aidPart || !admin) return res.status(401).json({ ok: false, message: "Chưa đăng nhập admin" });
  req._db = db;
  req.admin = admin;
  req.token = token;
  next();
}

// ====== Orders ======
app.post("/api/orders/create", requireUser, (req, res) => {
  const { serviceKey, note } = req.body || {};
  if (!serviceKey) return res.status(400).json({ ok: false, message: "Thiếu serviceKey" });

  let service = null;
  for (const g of SERVICES) {
    const found = g.items.find(i => i.key === serviceKey);
    if (found) { service = { ...found, group: g.group }; break; }
  }
  if (!service) return res.status(404).json({ ok: false, message: "Không tìm thấy dịch vụ" });

  const db = req._db;
  const order = {
    id: uid("od"),
    userId: req.user.id,
    username: req.user.username,
    serviceKey: service.key,
    serviceName: service.name,
    serviceGroup: service.group,
    price: service.price,
    note: String(note || ""),
    status: "PENDING",
    adminNote: "",
    createdAt: nowISO(),
    updatedAt: nowISO()
  };

  db.orders.unshift(order);
  writeDB(db);
  return res.json({ ok: true, order });
});

app.get("/api/history", requireUser, (req, res) => {
  const db = req._db;
  const orders = db.orders.filter(o => o.userId === req.user.id);
  const topups = db.topups.filter(t => t.userId === req.user.id);
  return res.json({ ok: true, user: { balance: req.user.balance }, orders, topups });
});

// ====== Topup (Bank: tạo mã nạp) ======
app.post("/api/topup/bank/create", requireUser, (req, res) => {
  const { method, amount } = req.body || {};
  const amt = Number(amount);
  if (!method) return res.status(400).json({ ok: false, message: "Thiếu method" });
  if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ ok: false, message: "Số tiền không hợp lệ" });

  const db = req._db;
  const code = `NAP_${uid("MB").toUpperCase()}`.replace(/[^A-Z0-9_]/g, "").slice(0, 18);

  const topup = {
    id: uid("tp"),
    userId: req.user.id,
    username: req.user.username,
    type: "BANK",
    method: String(method),
    amount: amt,
    feeRate: 0,
    credit: 0,
    code,
    status: "WAITING",
    note: "Chuyển khoản đúng nội dung để admin duyệt.",
    createdAt: nowISO(),
    updatedAt: nowISO()
  };

  db.topups.unshift(topup);
  writeDB(db);
  return res.json({ ok: true, topup });
});

// ====== Topup (Card) - demo: tạo yêu cầu, admin duyệt ======
app.post("/api/topup/card/create", requireUser, (req, res) => {
  const { telco, amount, serial, pin } = req.body || {};
  const amt = Number(amount);

  const allowedTelco = ["Viettel", "Mobifone", "Vinaphone", "Garena", "Zing"];
  const allowedAmt = [20000, 50000, 100000, 200000, 500000];

  if (!allowedTelco.includes(String(telco))) return res.status(400).json({ ok: false, message: "Nhà mạng không hợp lệ" });
  if (!allowedAmt.includes(amt)) return res.status(400).json({ ok: false, message: "Mệnh giá không hợp lệ" });
  if (!serial || !pin) return res.status(400).json({ ok: false, message: "Thiếu serial/mã thẻ" });

  const db = req._db;
  const feeRate = feeForCard(amt);
  const credit = Math.floor(amt * (1 - feeRate));

  const topup = {
    id: uid("tp"),
    userId: req.user.id,
    username: req.user.username,
    type: "CARD",
    method: String(telco),
    amount: amt,
    feeRate,
    credit,
    serial: String(serial),
    pin: String(pin),
    status: "WAITING",
    note: `Chiết khấu ${(feeRate * 100).toFixed(0)}% => cộng ${credit}đ sau duyệt`,
    createdAt: nowISO(),
    updatedAt: nowISO()
  };

  db.topups.unshift(topup);
  writeDB(db);
  return res.json({ ok: true, topup });
});

// ====== Payment page data ======
app.get("/api/payment/info", requireUser, (req, res) => {
  const { orderId, topupId } = req.query || {};
  const db = req._db;

  let order = null;
  let topup = null;

  if (orderId) order = db.orders.find(o => o.id === String(orderId) && o.userId === req.user.id) || null;
  if (topupId) topup = db.topups.find(t => t.id === String(topupId) && t.userId === req.user.id) || null;

  return res.json({
    ok: true,
    bank: {
      name: "MB Bank",
      accountName: "VAN VIET THANH NHAN",
      // Số tài khoản bạn đã dùng trong ảnh (mình không tự bịa thêm, bạn có thể đổi)
      accountNumber: "7475040109",
      qrImage: "/mb-qr.jpg"
    },
    order,
    topup
  });
});

// ====== Admin APIs ======
app.get("/api/admin/overview", requireAdmin, (req, res) => {
  const db = req._db;
  const orders = db.orders.slice(0, 200);
  const topups = db.topups.slice(0, 200);
  return res.json({ ok: true, orders, topups });
});

app.post("/api/admin/order/update", requireAdmin, (req, res) => {
  const { orderId, status, adminNote } = req.body || {};
  const db = req._db;
  const order = db.orders.find(o => o.id === String(orderId));
  if (!order) return res.status(404).json({ ok: false, message: "Không tìm thấy đơn" });

  const allowed = ["PENDING", "WORKING", "DONE", "CANCELLED"];
  if (status && !allowed.includes(String(status))) return res.status(400).json({ ok: false, message: "Status không hợp lệ" });

  if (status) order.status = String(status);
  if (adminNote !== undefined) order.adminNote = String(adminNote);
  order.updatedAt = nowISO();

  writeDB(db);
  return res.json({ ok: true, order });
});

app.post("/api/admin/topup/approve", requireAdmin, (req, res) => {
  const { topupId } = req.body || {};
  const db = req._db;
  const topup = db.topups.find(t => t.id === String(topupId));
  if (!topup) return res.status(404).json({ ok: false, message: "Không tìm thấy topup" });
  if (topup.status !== "WAITING") return res.status(400).json({ ok: false, message: "Topup không ở trạng thái chờ" });

  const user = db.users.find(u => u.id === topup.userId);
  if (!user) return res.status(404).json({ ok: false, message: "Không tìm thấy user" });

  // Bank topup: bạn muốn cộng tay? => demo: admin duyệt thì cộng đúng amount
  // Card topup: cộng "credit" đã trừ phí
  const addMoney = topup.type === "CARD" ? Number(topup.credit || 0) : Number(topup.amount || 0);

  user.balance = Number(user.balance || 0) + addMoney;
  topup.status = "APPROVED";
  topup.updatedAt = nowISO();
  topup.note = topup.note + ` | Admin duyệt cộng ${addMoney}đ`;

  writeDB(db);
  return res.json({ ok: true, topup, balance: user.balance });
});

app.post("/api/admin/topup/reject", requireAdmin, (req, res) => {
  const { topupId, note } = req.body || {};
  const db = req._db;
  const topup = db.topups.find(t => t.id === String(topupId));
  if (!topup) return res.status(404).json({ ok: false, message: "Không tìm thấy topup" });

  topup.status = "REJECTED";
  topup.updatedAt = nowISO();
  topup.note = String(note || "Từ chối");

  writeDB(db);
  return res.json({ ok: true, topup });
});

// ====== Buy product by balance (đơn được trừ tiền) ======
app.post("/api/orders/pay", requireUser, (req, res) => {
  const { orderId } = req.body || {};
  const db = req._db;
  const order = db.orders.find(o => o.id === String(orderId) && o.userId === req.user.id);
  if (!order) return res.status(404).json({ ok: false, message: "Không tìm thấy đơn" });

  if (order.paid) return res.status(400).json({ ok: false, message: "Đơn đã thanh toán" });

  const price = Number(order.price || 0);
  if ((req.user.balance || 0) < price) {
    return res.status(400).json({ ok: false, message: "Số dư không đủ. Hãy nạp tiền trước." });
  }

  req.user.balance -= price;
  order.paid = true;
  order.status = order.status === "PENDING" ? "WORKING" : order.status;
  order.updatedAt = nowISO();

  writeDB(db);
  return res.json({ ok: true, message: "Thanh toán thành công", balance: req.user.balance, order });
});

// ====== Fallback route ======
app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
