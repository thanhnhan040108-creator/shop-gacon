// server.js
// Shop Gà Con - Node/Express backend
// - Auth user (register/login), email recovery reset token
// - Admin auth via ENV
// - Orders + Topups (manual) + History
// - Persist to data.json
// - Serve Public/* static + HTML routes

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");

const app = express();

// ====== CONFIG ======
const PORT = process.env.PORT || 3000;

// IMPORTANT: nếu file trên GitHub của bạn đang là "Data.json" thì đổi dòng này:
const DATA_FILE = path.join(__dirname, "data.json"); // hoặc: "Data.json"

const PUBLIC_DIR = path.join(__dirname, "Public");

// Admin credentials (Render Environment Variables)
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "admin123"; // bắt buộc đổi khi deploy
const SESSION_SECRET = process.env.SESSION_SECRET || "change_this_secret";

// Bank info (hiển thị hướng dẫn chuyển khoản)
const BANK_NAME = process.env.BANK_NAME || "MB Bank";
const BANK_ACCOUNT_NAME = process.env.BANK_ACCOUNT_NAME || "VAN VIET THANH NHAN";
const BANK_ACCOUNT_NUMBER = process.env.BANK_ACCOUNT_NUMBER || "7475040109";
const BANK_QR_IMAGE = process.env.BANK_QR_IMAGE || "/mb-pr.jpg"; // đặt ảnh QR trong Public/

// ====== MIDDLEWARE ======
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: "sg_session",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // Render dùng https vẫn ok, nhưng nếu set true có thể lỗi khi test http local
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 ngày
    },
  })
);

// Serve static files
app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));

// ====== DATA LAYER ======
const DEFAULT_DATA = {
  users: [],
  orders: [],
  topups: [],
  adminNotes: [], // optional log
};

// Simple write queue (tránh ghi đè file khi 2 request cùng lúc)
let writing = Promise.resolve();

function safeReadJson() {
  try {
    if (!fs.existsSync(DATA_FILE)) return { ...DEFAULT_DATA };
    const raw = fs.readFileSync(DATA_FILE, "utf8").trim();
    if (!raw) return { ...DEFAULT_DATA };
    const parsed = JSON.parse(raw);

    // ensure keys exist
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
      topups: Array.isArray(parsed.topups) ? parsed.topups : [],
      adminNotes: Array.isArray(parsed.adminNotes) ? parsed.adminNotes : [],
    };
  } catch (e) {
    console.error("Read data.json error:", e);
    return { ...DEFAULT_DATA };
  }
}

function safeWriteJson(data) {
  writing = writing.then(
    () =>
      new Promise((resolve, reject) => {
        const tmp = DATA_FILE + ".tmp";
        fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8", (err) => {
          if (err) return reject(err);
          fs.rename(tmp, DATA_FILE, (err2) => {
            if (err2) return reject(err2);
            resolve();
          });
        });
      })
  );
  return writing;
}

function nowISO() {
  return new Date().toISOString();
}
function uid(prefix = "") {
  return prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

// ====== AUTH HELPERS ======
function requireUser(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "NOT_LOGGED_IN" });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) return res.status(401).json({ error: "ADMIN_ONLY" });
  next();
}

function publicUser(u) {
  return { id: u.id, username: u.username, email: u.email, createdAt: u.createdAt };
}

// ====== ROUTES (HTML shortcuts) ======
app.get("/", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));
app.get("/home", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "home.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "admin.html")));
app.get("/admin-dashboard", (req, res) =>
  res.sendFile(path.join(PUBLIC_DIR, "admin-dashboard.html"))
);
// Nếu bạn có payment.html trong Public, route này sẽ tự serve, vẫn thêm cho chắc:
app.get("/payment", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "payment.html")));

// ====== USER API ======

// Register
app.post("/api/register", async (req, res) => {
  try {
    const { username, password, email } = req.body || {};
    if (!username || !password || !email) {
      return res.status(400).json({ error: "MISSING_FIELDS" });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: "PASSWORD_TOO_SHORT" });
    }

    const db = safeReadJson();
    const uName = String(username).trim().toLowerCase();
    const uEmail = String(email).trim().toLowerCase();

    if (db.users.some((u) => u.username.toLowerCase() === uName)) {
      return res.status(409).json({ error: "USERNAME_EXISTS" });
    }
    if (db.users.some((u) => u.email.toLowerCase() === uEmail)) {
      return res.status(409).json({ error: "EMAIL_EXISTS" });
    }

    const hash = await bcrypt.hash(String(password), 10);
    const user = {
      id: uid("u_"),
      username: String(username).trim(),
      email: uEmail,
      passwordHash: hash,
      createdAt: nowISO(),
      balance: 0,
      resetToken: null,
      resetTokenExp: null,
    };

    db.users.push(user);
    await safeWriteJson(db);

    req.session.userId = user.id;
    req.session.isAdmin = false;

    return res.json({ ok: true, user: publicUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});

// Login
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "MISSING_FIELDS" });

    const db = safeReadJson();
    const user = db.users.find((u) => u.username.toLowerCase() === String(username).trim().toLowerCase());
    if (!user) return res.status(401).json({ error: "INVALID_LOGIN" });

    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) return res.status(401).json({ error: "INVALID_LOGIN" });

    req.session.userId = user.id;
    req.session.isAdmin = false;

    res.json({ ok: true, user: publicUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});

// Me
app.get("/api/me", (req, res) => {
  const db = safeReadJson();
  if (req.session.isAdmin) {
    return res.json({ role: "admin", username: ADMIN_USER });
  }
  if (!req.session.userId) return res.status(401).json({ error: "NOT_LOGGED_IN" });
  const user = db.users.find((u) => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: "NOT_LOGGED_IN" });
  res.json({ role: "user", ...publicUser(user), balance: user.balance || 0 });
});

// Logout
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Request password reset (by email)
app.post("/api/request-reset", async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "MISSING_EMAIL" });

    const db = safeReadJson();
    const uEmail = String(email).trim().toLowerCase();
    const user = db.users.find((u) => u.email.toLowerCase() === uEmail);

    // Không leak email có tồn tại hay không: vẫn trả ok
    if (!user) return res.json({ ok: true });

    const token = crypto.randomBytes(3).toString("hex").toUpperCase(); // 6 ký tự
    user.resetToken = token;
    user.resetTokenExp = Date.now() + 1000 * 60 * 15; // 15 phút

    await safeWriteJson(db);

    // Vì bạn chưa có gửi email thật, trả token để test (sau này bạn có thể bỏ)
    res.json({ ok: true, token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});

// Reset password using token
app.post("/api/reset-password", async (req, res) => {
  try {
    const { email, token, newPassword } = req.body || {};
    if (!email || !token || !newPassword) return res.status(400).json({ error: "MISSING_FIELDS" });
    if (String(newPassword).length < 6) return res.status(400).json({ error: "PASSWORD_TOO_SHORT" });

    const db = safeReadJson();
    const user = db.users.find((u) => u.email.toLowerCase() === String(email).trim().toLowerCase());
    if (!user) return res.status(400).json({ error: "INVALID_TOKEN" });

    if (!user.resetToken || !user.resetTokenExp) return res.status(400).json({ error: "INVALID_TOKEN" });
    if (Date.now() > user.resetTokenExp) return res.status(400).json({ error: "TOKEN_EXPIRED" });
    if (String(token).trim().toUpperCase() !== String(user.resetToken).toUpperCase()) {
      return res.status(400).json({ error: "INVALID_TOKEN" });
    }

    user.passwordHash = await bcrypt.hash(String(newPassword), 10);
    user.resetToken = null;
    user.resetTokenExp = null;

    await safeWriteJson(db);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});

// ====== ADMIN API ======

// Admin login
app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "MISSING_FIELDS" });

  if (String(username) === ADMIN_USER && String(password) === ADMIN_PASS) {
    req.session.isAdmin = true;
    req.session.userId = null;
    return res.json({ ok: true, role: "admin", username: ADMIN_USER });
  }
  return res.status(401).json({ error: "INVALID_LOGIN" });
});

app.get("/api/admin/me", (req, res) => {
  if (!req.session.isAdmin) return res.status(401).json({ error: "ADMIN_ONLY" });
  res.json({ ok: true, username: ADMIN_USER });
});

// ====== ORDERS ======
app.post("/api/orders", requireUser, async (req, res) => {
  try {
    const { service, amount, note } = req.body || {};
    if (!service || !amount) return res.status(400).json({ error: "MISSING_FIELDS" });

    const db = safeReadJson();
    const user = db.users.find((u) => u.id === req.session.userId);
    if (!user) return res.status(401).json({ error: "NOT_LOGGED_IN" });

    const order = {
      id: uid("od_"),
      userId: user.id,
      username: user.username,
      service: String(service),
      amount: Number(amount),
      note: String(note || "").slice(0, 500),
      status: "Chờ xử lý",
      adminNote: "",
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };

    db.orders.unshift(order);
    await safeWriteJson(db);

    res.json({ ok: true, id: order.id, order });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});

app.get("/api/orders/me", requireUser, (req, res) => {
  const db = safeReadJson();
  const items = db.orders.filter((o) => o.userId === req.session.userId);
  res.json({ ok: true, orders: items });
});

// Admin: list orders
app.get("/api/admin/orders", requireAdmin, (req, res) => {
  const db = safeReadJson();
  res.json({ ok: true, orders: db.orders });
});

// Admin: update order status/adminNote
app.post("/api/admin/orders/:id", requireAdmin, async (req, res) => {
  try {
    const { status, adminNote } = req.body || {};
    const db = safeReadJson();
    const o = db.orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: "NOT_FOUND" });

    if (status) o.status = String(status);
    if (adminNote !== undefined) o.adminNote = String(adminNote).slice(0, 500);
    o.updatedAt = nowISO();

    await safeWriteJson(db);
    res.json({ ok: true, order: o });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});

// ====== TOPUPS (manual) ======
app.post("/api/topups", requireUser, async (req, res) => {
  try {
    const { method, amount } = req.body || {};
    if (!method || !amount) return res.status(400).json({ error: "MISSING_FIELDS" });

    const db = safeReadJson();
    const user = db.users.find((u) => u.id === req.session.userId);
    if (!user) return res.status(401).json({ error: "NOT_LOGGED_IN" });

    const code = "NAP_" + crypto.randomBytes(3).toString("hex").toUpperCase(); // NAP_XXXXXX

    const topup = {
      id: uid("tp_"),
      userId: user.id,
      username: user.username,
      method: String(method),
      amount: Number(amount),
      code,
      status: "Chờ duyệt",
      adminNote: "",
      createdAt: nowISO(),
      updatedAt: nowISO(),
    };

    db.topups.unshift(topup);
    await safeWriteJson(db);

    res.json({
      ok: true,
      id: topup.id,
      topup,
      bank: {
        name: BANK_NAME,
        accountName: BANK_ACCOUNT_NAME,
        accountNumber: BANK_ACCOUNT_NUMBER,
        qrImage: BANK_QR_IMAGE,
        transferContent: code,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});

// User: list topups
app.get("/api/topups/me", requireUser, (req, res) => {
  const db = safeReadJson();
  const items = db.topups.filter((t) => t.userId === req.session.userId);
  res.json({ ok: true, topups: items });
});

// Admin: list topups
app.get("/api/admin/topups", requireAdmin, (req, res) => {
  const db = safeReadJson();
  res.json({ ok: true, topups: db.topups });
});

// Admin: approve/reject topup + optionally credit balance
app.post("/api/admin/topups/:id", requireAdmin, async (req, res) => {
  try {
    const { status, adminNote, creditBalance } = req.body || {};
    const db = safeReadJson();
    const t = db.topups.find((x) => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: "NOT_FOUND" });

    if (status) t.status = String(status);
    if (adminNote !== undefined) t.adminNote = String(adminNote).slice(0, 500);
    t.updatedAt = nowISO();

    // Nếu admin set creditBalance=true và status=Đã duyệt -> cộng tiền
    if (creditBalance === true && String(t.status).toLowerCase().includes("duyệt")) {
      const u = db.users.find((x) => x.id === t.userId);
      if (u) {
        u.balance = Number(u.balance || 0) + Number(t.amount || 0);
      }
    }

    await safeWriteJson(db);
    res.json({ ok: true, topup: t });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});

// ====== HISTORY (combined) ======
app.get("/api/history", requireUser, (req, res) => {
  const db = safeReadJson();
  const orders = db.orders.filter((o) => o.userId === req.session.userId);
  const topups = db.topups.filter((t) => t.userId === req.session.userId);
  res.json({ ok: true, orders, topups });
});

// ====== PAYMENT INFO (for payment.html) ======
app.get("/api/payment-info", requireUser, (req, res) => {
  // query: ?type=order&id=...
  const { type, id } = req.query || {};
  const db = safeReadJson();
  const user = db.users.find((u) => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: "NOT_LOGGED_IN" });

  if (type === "order") {
    const o = db.orders.find((x) => x.id === id && x.userId === user.id);
    if (!o) return res.status(404).json({ error: "NOT_FOUND" });
    return res.json({
      ok: true,
      type: "order",
      item: o,
      bank: {
        name: BANK_NAME,
        accountName: BANK_ACCOUNT_NAME,
        accountNumber: BANK_ACCOUNT_NUMBER,
        qrImage: BANK_QR_IMAGE,
        transferContent: `DON_${o.id}`.slice(0, 30),
      },
      note: "Đây là thanh toán thủ công. Chuyển khoản đúng nội dung, admin sẽ xác nhận.",
    });
  }

  if (type === "topup") {
    const t = db.topups.find((x) => x.id === id && x.userId === user.id);
    if (!t) return res.status(404).json({ error: "NOT_FOUND" });
    return res.json({
      ok: true,
      type: "topup",
      item: t,
      bank: {
        name: BANK_NAME,
        accountName: BANK_ACCOUNT_NAME,
        accountNumber: BANK_ACCOUNT_NUMBER,
        qrImage: BANK_QR_IMAGE,
        transferContent: t.code,
      },
      note: "Chuyển khoản đúng nội dung (mã nạp). Admin sẽ duyệt và cộng tiền.",
    });
  }

  res.status(400).json({ error: "INVALID_TYPE" });
});

// ====== HEALTH ======
app.get("/api/health", (req, res) => res.json({ ok: true, time: nowISO() }));

// ====== START ======
app.listen(PORT, () => {
  console.log("Shop Gà Con server listening on port", PORT);
  console.log("Public dir:", PUBLIC_DIR);
});
const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));

const DATA_FILE = "./data.json";

function readData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ users: [], orders: [], topups: [] }, null, 2)
    );
  }
  return JSON.parse(fs.readFileSync(DATA_FILE));
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

/* ===== AUTH ===== */
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const data = readData();
  const user = data.users.find(
    (u) => u.username === username && u.password === password
  );
  if (!user) return res.status(401).json({ msg: "Sai tài khoản hoặc mật khẩu" });
  res.json({ user });
});

app.post("/api/register", (req, res) => {
  const { username, password, email } = req.body;
  const data = readData();
  if (data.users.find((u) => u.username === username)) {
    return res.status(400).json({ msg: "Tài khoản đã tồn tại" });
  }
  data.users.push({
    username,
    password,
    email,
    balance: 0,
  });
  writeData(data);
  res.json({ msg: "Đăng ký thành công" });
});

/* ===== ORDER ===== */
app.post("/api/order", (req, res) => {
  const { username, service, price, note } = req.body;
  const data = readData();

  const order = {
    id: Date.now(),
    username,
    service,
    price,
    note,
    status: "Chờ xử lý",
    time: new Date().toLocaleString(),
  };

  data.orders.push(order);
  writeData(data);
  res.json(order);
});

app.get("/api/orders/:username", (req, res) => {
  const data = readData();
  res.json(data.orders.filter(o => o.username === req.params.username));
});

/* ===== TOPUP ===== */
app.post("/api/topup", (req, res) => {
  const { username, amount } = req.body;
  const data = readData();

  const code = "NAP_" + Math.random().toString(36).substring(2, 8).toUpperCase();

  data.topups.push({
    id: Date.now(),
    username,
    amount,
    code,
    status: "Chờ duyệt",
    time: new Date().toLocaleString(),
  });

  writeData(data);
  res.json({ code });
});

/* ===== ADMIN ===== */
app.post("/api/admin/login", (req, res) => {
  const { user, pass } = req.body;
  if (
    user === process.env.ADMIN_USER &&
    pass === process.env.ADMIN_PASS
  ) {
    return res.json({ ok: true });
  }
  res.status(401).json({ msg: "Sai admin" });
});

app.get("/api/admin/data", (req, res) => {
  res.json(readData());
});

app.post("/api/admin/order-status", (req, res) => {
  const { id, status } = req.body;
  const data = readData();
  const order = data.orders.find(o => o.id === id);
  if (order) order.status = status;
  writeData(data);
  res.json({ ok: true });
});

app.listen(PORT, () =>
  console.log("Server running on port " + PORT)
);

