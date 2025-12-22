const express = require("express");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));

const DATA_FILE = "./data.json";

// ===== Helpers =====
function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ users: [], orders: [], topups: [], cardTopups: [] }, null, 2)
    );
  }
}
function readData() {
  ensureDataFile();
  const d = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  d.users = d.users || [];
  d.orders = d.orders || [];
  d.topups = d.topups || [];
  d.cardTopups = d.cardTopups || [];
  return d;
}
function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
function normStr(x) {
  return String(x ?? "").trim();
}
function isEmail(x) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x || "").trim());
}
function newId() {
  return Date.now() + Math.floor(Math.random() * 1000);
}

// ===== Admin session (in-memory) =====
const adminSessions = new Map(); // token -> { createdAt }
function newToken() {
  return crypto.randomBytes(24).toString("hex");
}
function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (!token || !adminSessions.has(token)) {
    return res.status(401).json({ msg: "Unauthorized" });
  }
  next();
}

// ===== HEALTH =====
app.get("/health", (req, res) => res.status(200).send("ok"));

// ===== AUTH - USER =====
app.post("/api/register", (req, res) => {
  const username = normStr(req.body.username);
  const password = normStr(req.body.password);
  const email = normStr(req.body.email).toLowerCase();

  if (!username || !password || !email) return res.status(400).json({ msg: "Thiếu thông tin" });
  if (!isEmail(email)) return res.status(400).json({ msg: "Email không hợp lệ" });

  const data = readData();
  if (data.users.find((u) => u.username === username)) {
    return res.status(400).json({ msg: "Tài khoản đã tồn tại" });
  }

  data.users.push({
    id: newId(),
    username,
    password,
    email,
    balance: 0,
    createdAt: new Date().toLocaleString(),
  });

  writeData(data);
  res.json({ msg: "Đăng ký thành công" });
});

app.post("/api/login", (req, res) => {
  const username = normStr(req.body.username);
  const password = normStr(req.body.password);

  const data = readData();
  const user = data.users.find((u) => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ msg: "Sai tài khoản hoặc mật khẩu" });

  res.json({
    user: { id: user.id, username: user.username, email: user.email, balance: user.balance },
  });
});

// Quên mật khẩu: username + email -> đặt mk mới
app.post("/api/forgot", (req, res) => {
  const username = normStr(req.body.username);
  const email = normStr(req.body.email).toLowerCase();
  const newPassword = normStr(req.body.newPassword);

  if (!username || !email || !newPassword) return res.status(400).json({ msg: "Thiếu thông tin" });
  if (!isEmail(email)) return res.status(400).json({ msg: "Email không hợp lệ" });

  const data = readData();
  const user = data.users.find((u) => u.username === username && u.email === email);
  if (!user) return res.status(404).json({ msg: "Không khớp tài khoản + email" });

  user.password = newPassword;
  writeData(data);
  res.json({ msg: "Đổi mật khẩu thành công. Hãy đăng nhập lại." });
});

app.get("/api/me/:username", (req, res) => {
  const data = readData();
  const user = data.users.find((u) => u.username === req.params.username);
  if (!user) return res.status(404).json({ msg: "Không tìm thấy user" });

  res.json({
    user: { id: user.id, username: user.username, email: user.email, balance: user.balance },
  });
});

// ===== ORDER (có mã DON_...) =====
app.post("/api/order", (req, res) => {
  const username = normStr(req.body.username);
  const service = normStr(req.body.service);
  const price = Number(req.body.price || 0);
  const note = normStr(req.body.note);

  if (!username || !service || !price) return res.status(400).json({ msg: "Thiếu dữ liệu tạo đơn" });

  const data = readData();
  const user = data.users.find((u) => u.username === username);
  if (!user) return res.status(404).json({ msg: "User không tồn tại" });

  const payCode = "DON_" + crypto.randomBytes(3).toString("hex").toUpperCase();

  const order = {
    id: newId(),
    username,
    service,
    price,
    note,
    payCode,
    paidStatus: "Chưa thanh toán",
    status: "Chờ xử lý",
    adminNote: "",
    time: new Date().toLocaleString(),
  };

  data.orders.unshift(order);
  writeData(data);
  res.json(order);
});

app.get("/api/orders/:username", (req, res) => {
  const data = readData();
  res.json(data.orders.filter((o) => o.username === req.params.username));
});

// ===== PAY ORDER BY BALANCE (MUA BẰNG SỐ DƯ) =====
app.post("/api/order/pay-balance", (req, res) => {
  const username = normStr(req.body.username);
  const orderId = Number(req.body.orderId || 0);

  if (!username || !orderId) return res.status(400).json({ msg: "Thiếu dữ liệu thanh toán" });

  const data = readData();
  const user = data.users.find((u) => u.username === username);
  if (!user) return res.status(404).json({ msg: "User không tồn tại" });

  const order = data.orders.find((o) => o.id === orderId && o.username === username);
  if (!order) return res.status(404).json({ msg: "Không tìm thấy đơn" });

  if ((order.paidStatus || "Chưa thanh toán") === "Đã thanh toán") {
    return res.status(400).json({ msg: "Đơn đã thanh toán rồi" });
  }

  const price = Number(order.price || 0);
  const bal = Number(user.balance || 0);
  if (bal < price) return res.status(400).json({ msg: "Số dư không đủ để thanh toán" });

  user.balance = bal - price;
  order.paidStatus = "Đã thanh toán";
  order.paidTime = new Date().toLocaleString();
  order.payMethod = "Số dư";

  writeData(data);
  res.json({ ok: true, balance: user.balance, order });
});

// ===== TOPUP (MB) =====
app.post("/api/topup", (req, res) => {
  const username = normStr(req.body.username);
  const amount = Number(req.body.amount || 0);
  const method = normStr(req.body.method || "MB Bank");

  if (!username || amount <= 0) return res.status(400).json({ msg: "Thiếu dữ liệu nạp" });

  const data = readData();
  const user = data.users.find((u) => u.username === username);
  if (!user) return res.status(404).json({ msg: "User không tồn tại" });

  const code = "NAP_" + crypto.randomBytes(3).toString("hex").toUpperCase();

  const topup = {
    id: newId(),
    username,
    amount,
    method,
    code,
    status: "Chờ duyệt",
    time: new Date().toLocaleString(),
  };

  data.topups.unshift(topup);
  writeData(data);
  res.json({ topup });
});

app.get("/api/topups/:username", (req, res) => {
  const data = readData();
  res.json(data.topups.filter((t) => t.username === req.params.username));
});

// ===== CARD TOPUP (THẺ CÀO) =====
function calcCardFeePercent(amount) {
  amount = Number(amount || 0);
  if (amount >= 100000) return 20;
  return 15;
}

app.post("/api/cardtopup", (req, res) => {
  const username = normStr(req.body.username);
  const provider = normStr(req.body.provider);
  const amount = Number(req.body.amount || 0);
  const serial = normStr(req.body.serial);
  const pin = normStr(req.body.pin);

  if (!username || !provider || !serial || !pin || amount <= 0) {
    return res.status(400).json({ msg: "Thiếu dữ liệu nạp thẻ" });
  }

  const allowedProviders = ["Viettel", "Vinaphone", "Mobifone", "Garena", "Zing"];
  if (!allowedProviders.includes(provider)) {
    return res.status(400).json({ msg: "Nhà mạng không hợp lệ" });
  }

  const allowedAmounts = [20000, 50000, 100000, 200000, 500000];
  if (!allowedAmounts.includes(amount)) {
    return res.status(400).json({ msg: "Mệnh giá không hợp lệ (chỉ 20k/50k/100k/200k/500k)" });
  }

  const data = readData();
  const user = data.users.find((u) => u.username === username);
  if (!user) return res.status(404).json({ msg: "User không tồn tại" });

  const feePercent = calcCardFeePercent(amount);
  const netAmount = Math.floor((amount * (100 - feePercent)) / 100);
  const code = "CARD_" + crypto.randomBytes(3).toString("hex").toUpperCase();

  const card = {
    id: newId(),
    code,
    username,
    provider,
    amount,
    feePercent,
    netAmount,
    serial,
    pin,
    status: "Chờ duyệt",
    adminNote: "",
    time: new Date().toLocaleString(),
  };

  data.cardTopups.unshift(card);
  writeData(data);
  res.json({ card });
});

app.get("/api/cardtopups/:username", (req, res) => {
  const data = readData();
  res.json(data.cardTopups.filter((c) => c.username === req.params.username));
});

// ===== ADMIN =====
app.post("/api/admin/login", (req, res) => {
  const user = normStr(req.body.user);
  const pass = normStr(req.body.pass);

  if (user === process.env.ADMIN_USER && pass === process.env.ADMIN_PASS) {
    const token = newToken();
    adminSessions.set(token, { createdAt: Date.now() });
    return res.json({ ok: true, token });
  }
  res.status(401).json({ msg: "Sai admin" });
});

app.get("/api/admin/data", requireAdmin, (req, res) => {
  const d = readData();
  res.json(d);
});

app.post("/api/admin/order-update", requireAdmin, (req, res) => {
  const id = Number(req.body.id);
  const status = normStr(req.body.status);
  const adminNote = normStr(req.body.adminNote);

  const data = readData();
  const order = data.orders.find((o) => o.id === id);
  if (!order) return res.status(404).json({ msg: "Không tìm thấy đơn" });

  if (status) order.status = status;
  order.adminNote = adminNote;

  writeData(data);
  res.json({ ok: true });
});

app.post("/api/admin/order-paid", requireAdmin, (req, res) => {
  const id = Number(req.body.id);
  const paid = Boolean(req.body.paid);

  const data = readData();
  const order = data.orders.find((o) => o.id === id);
  if (!order) return res.status(404).json({ msg: "Không tìm thấy đơn" });

  order.paidStatus = paid ? "Đã thanh toán" : "Chưa thanh toán";
  writeData(data);
  res.json({ ok: true });
});

app.post("/api/admin/order-delete", requireAdmin, (req, res) => {
  const id = Number(req.body.id);
  const data = readData();
  data.orders = data.orders.filter((o) => o.id !== id);
  writeData(data);
  res.json({ ok: true });
});

app.post("/api/admin/topup-approve", requireAdmin, (req, res) => {
  const id = Number(req.body.id);
  const approve = Boolean(req.body.approve);

  const data = readData();
  const topup = data.topups.find((t) => t.id === id);
  if (!topup) return res.status(404).json({ msg: "Không tìm thấy topup" });

  if (topup.status !== "Chờ duyệt") return res.status(400).json({ msg: "Topup đã xử lý rồi" });

  if (approve) {
    topup.status = "Đã duyệt";
    const user = data.users.find((u) => u.username === topup.username);
    if (user) user.balance = Number(user.balance || 0) + Number(topup.amount || 0);
  } else {
    topup.status = "Từ chối";
  }

  writeData(data);
  res.json({ ok: true });
});

app.post("/api/admin/card-approve", requireAdmin, (req, res) => {
  const id = Number(req.body.id);
  const approve = Boolean(req.body.approve);
  const adminNote = normStr(req.body.adminNote);

  const data = readData();
  const card = data.cardTopups.find((c) => c.id === id);
  if (!card) return res.status(404).json({ msg: "Không tìm thấy thẻ" });
  if (card.status !== "Chờ duyệt") return res.status(400).json({ msg: "Thẻ đã xử lý rồi" });

  card.adminNote = adminNote;

  if (approve) {
    card.status = "Đã duyệt";
    const user = data.users.find((u) => u.username === card.username);
    if (user) user.balance = Number(user.balance || 0) + Number(card.netAmount || 0);
  } else {
    card.status = "Từ chối";
  }

  writeData(data);
  res.json({ ok: true });
});

app.post("/api/admin/user-delete", requireAdmin, (req, res) => {
  const username = normStr(req.body.username);
  const data = readData();
  data.users = data.users.filter((u) => u.username !== username);
  data.orders = data.orders.filter((o) => o.username !== username);
  data.topups = data.topups.filter((t) => t.username !== username);
  data.cardTopups = data.cardTopups.filter((c) => c.username !== username);
  writeData(data);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log("Server running on port " + PORT));
