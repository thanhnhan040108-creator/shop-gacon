const express = require("express");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));

// ================== SUPABASE ==================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in env");
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// ================== HELPERS ==================
function normStr(x) {
  return String(x ?? "").trim();
}
function isEmail(x) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x || "").trim());
}
function newToken() {
  return crypto.randomBytes(24).toString("hex");
}

// ================== ADMIN SESSION (in-memory) ==================
const adminSessions = new Map(); // token -> { createdAt }

function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];
  if (!token || !adminSessions.has(token)) return res.status(401).json({ msg: "Unauthorized" });
  next();
}

// ================== HEALTH ==================
app.get("/health", (req, res) => res.status(200).send("ok"));

// ================== USER AUTH ==================
app.post("/api/register", async (req, res) => {
  try {
    const username = normStr(req.body.username);
    const password = normStr(req.body.password);
    const email = normStr(req.body.email).toLowerCase();

    if (!username || !password || !email) return res.status(400).json({ msg: "Thiếu thông tin" });
    if (!isEmail(email)) return res.status(400).json({ msg: "Email không hợp lệ" });

    const { data: existed, error: e1 } = await sb
      .from("users")
      .select("username")
      .eq("username", username)
      .maybeSingle();

    if (e1) return res.status(500).json({ msg: "Lỗi DB" });
    if (existed) return res.status(400).json({ msg: "Tài khoản đã tồn tại" });

    const { error: e2 } = await sb.from("users").insert([{ username, password, email, balance: 0 }]);
    if (e2) return res.status(500).json({ msg: e2.message });

    res.json({ msg: "Đăng ký thành công" });
  } catch {
    res.status(500).json({ msg: "Lỗi server" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const username = normStr(req.body.username);
    const password = normStr(req.body.password);

    const { data: user, error } = await sb
      .from("users")
      .select("id, username, email, balance")
      .eq("username", username)
      .eq("password", password)
      .maybeSingle();

    if (error) return res.status(500).json({ msg: "Lỗi DB" });
    if (!user) return res.status(401).json({ msg: "Sai tài khoản hoặc mật khẩu" });

    res.json({ user });
  } catch {
    res.status(500).json({ msg: "Lỗi server" });
  }
});

// Quên mật khẩu: username + email -> set password mới
app.post("/api/forgot", async (req, res) => {
  try {
    const username = normStr(req.body.username);
    const email = normStr(req.body.email).toLowerCase();
    const newPassword = normStr(req.body.newPassword);

    if (!username || !email || !newPassword) return res.status(400).json({ msg: "Thiếu thông tin" });
    if (!isEmail(email)) return res.status(400).json({ msg: "Email không hợp lệ" });

    const { data: user, error: e1 } = await sb
      .from("users")
      .select("username")
      .eq("username", username)
      .eq("email", email)
      .maybeSingle();

    if (e1) return res.status(500).json({ msg: "Lỗi DB" });
    if (!user) return res.status(404).json({ msg: "Không khớp tài khoản + email" });

    const { error: e2 } = await sb
      .from("users")
      .update({ password: newPassword })
      .eq("username", username)
      .eq("email", email);

    if (e2) return res.status(500).json({ msg: e2.message });
    res.json({ msg: "Đổi mật khẩu thành công. Hãy đăng nhập lại." });
  } catch {
    res.status(500).json({ msg: "Lỗi server" });
  }
});

app.get("/api/me/:username", async (req, res) => {
  try {
    const username = req.params.username;

    const { data: user, error } = await sb
      .from("users")
      .select("id, username, email, balance")
      .eq("username", username)
      .maybeSingle();

    if (error) return res.status(500).json({ msg: "Lỗi DB" });
    if (!user) return res.status(404).json({ msg: "Không tìm thấy user" });

    res.json({ user });
  } catch {
    res.status(500).json({ msg: "Lỗi server" });
  }
});

// ================== ORDERS ==================
app.post("/api/order", async (req, res) => {
  try {
    const username = normStr(req.body.username);
    const service = normStr(req.body.service);
    const price = Number(req.body.price || 0);
    const note = normStr(req.body.note);

    if (!username || !service || !price) return res.status(400).json({ msg: "Thiếu dữ liệu tạo đơn" });

    // check user exists
    const { data: u, error: eu } = await sb
      .from("users")
      .select("username")
      .eq("username", username)
      .maybeSingle();
    if (eu) return res.status(500).json({ msg: "Lỗi DB" });
    if (!u) return res.status(404).json({ msg: "User không tồn tại" });

    const payCode = "DON_" + crypto.randomBytes(3).toString("hex").toUpperCase();

    const { data: order, error } = await sb
      .from("orders")
      .insert([
        {
          username,
          service,
          price: Math.floor(price),
          note,
          pay_code: payCode,
          paid_status: "Chưa thanh toán",
          status: "Chờ xử lý",
          admin_note: "",
        },
      ])
      .select("*")
      .single();

    if (error) return res.status(500).json({ msg: error.message });

    res.json({
      id: order.id,
      username: order.username,
      service: order.service,
      price: order.price,
      note: order.note,
      payCode: order.pay_code,
      paidStatus: order.paid_status,
      payMethod: order.pay_method,
      paidTime: order.paid_time ? new Date(order.paid_time).toLocaleString("vi-VN") : null,
      status: order.status,
      adminNote: order.admin_note,
      time: new Date(order.created_at).toLocaleString("vi-VN"),
    });
  } catch {
    res.status(500).json({ msg: "Lỗi server" });
  }
});

app.get("/api/orders/:username", async (req, res) => {
  try {
    const username = req.params.username;

    const { data: orders, error } = await sb
      .from("orders")
      .select("*")
      .eq("username", username)
      .order("id", { ascending: false });

    if (error) return res.status(500).json({ msg: error.message });

    res.json(
      (orders || []).map((o) => ({
        id: o.id,
        username: o.username,
        service: o.service,
        price: o.price,
        note: o.note,
        payCode: o.pay_code,
        paidStatus: o.paid_status,
        payMethod: o.pay_method,
        paidTime: o.paid_time ? new Date(o.paid_time).toLocaleString("vi-VN") : null,
        status: o.status,
        adminNote: o.admin_note,
        time: new Date(o.created_at).toLocaleString("vi-VN"),
      }))
    );
  } catch {
    res.status(500).json({ msg: "Lỗi server" });
  }
});

// ===== Pay by balance =====
app.post("/api/order/pay-balance", async (req, res) => {
  try {
    const username = normStr(req.body.username);
    const orderId = Number(req.body.orderId || 0);
    if (!username || !orderId) return res.status(400).json({ msg: "Thiếu dữ liệu thanh toán" });

    const { data: user, error: e1 } = await sb
      .from("users")
      .select("balance")
      .eq("username", username)
      .maybeSingle();
    if (e1) return res.status(500).json({ msg: "Lỗi DB" });
    if (!user) return res.status(404).json({ msg: "User không tồn tại" });

    const { data: order, error: e2 } = await sb
      .from("orders")
      .select("id, price, paid_status")
      .eq("id", orderId)
      .eq("username", username)
      .maybeSingle();
    if (e2) return res.status(500).json({ msg: "Lỗi DB" });
    if (!order) return res.status(404).json({ msg: "Không tìm thấy đơn" });
    if (order.paid_status === "Đã thanh toán") return res.status(400).json({ msg: "Đơn đã thanh toán rồi" });

    const bal = Number(user.balance || 0);
    const price = Number(order.price || 0);
    if (bal < price) return res.status(400).json({ msg: "Số dư không đủ để thanh toán" });

    const newBal = bal - price;

    const { error: e3 } = await sb.from("users").update({ balance: newBal }).eq("username", username);
    if (e3) return res.status(500).json({ msg: e3.message });

    const { data: updated, error: e4 } = await sb
      .from("orders")
      .update({
        paid_status: "Đã thanh toán",
        pay_method: "Số dư",
        paid_time: new Date().toISOString(),
      })
      .eq("id", orderId)
      .select("*")
      .single();

    if (e4) return res.status(500).json({ msg: e4.message });

    res.json({
      ok: true,
      balance: newBal,
      order: {
        id: updated.id,
        username: updated.username,
        service: updated.service,
        price: updated.price,
        note: updated.note,
        payCode: updated.pay_code,
        paidStatus: updated.paid_status,
        payMethod: updated.pay_method,
        paidTime: updated.paid_time ? new Date(updated.paid_time).toLocaleString("vi-VN") : null,
        status: updated.status,
        adminNote: updated.admin_note,
        time: new Date(updated.created_at).toLocaleString("vi-VN"),
      },
    });
  } catch {
    res.status(500).json({ msg: "Lỗi server" });
  }
});

// ================== TOPUP MB ==================
app.post("/api/topup", async (req, res) => {
  try {
    const username = normStr(req.body.username);
    const amount = Number(req.body.amount || 0);
    const method = normStr(req.body.method || "MB Bank");

    if (!username || amount <= 0) return res.status(400).json({ msg: "Thiếu dữ liệu nạp" });

    const { data: u, error: eu } = await sb
      .from("users")
      .select("username")
      .eq("username", username)
      .maybeSingle();
    if (eu) return res.status(500).json({ msg: "Lỗi DB" });
    if (!u) return res.status(404).json({ msg: "User không tồn tại" });

    const code = "NAP_" + crypto.randomBytes(3).toString("hex").toUpperCase();

    const { data: topup, error } = await sb
      .from("topups")
      .insert([{ username, amount: Math.floor(amount), method, code, status: "Chờ duyệt" }])
      .select("*")
      .single();

    if (error) return res.status(500).json({ msg: error.message });

    res.json({
      topup: {
        id: topup.id,
        username: topup.username,
        amount: topup.amount,
        method: topup.method,
        code: topup.code,
        status: topup.status,
        time: new Date(topup.created_at).toLocaleString("vi-VN"),
      },
    });
  } catch {
    res.status(500).json({ msg: "Lỗi server" });
  }
});

app.get("/api/topups/:username", async (req, res) => {
  try {
    const username = req.params.username;

    const { data: topups, error } = await sb
      .from("topups")
      .select("*")
      .eq("username", username)
      .order("id", { ascending: false });

    if (error) return res.status(500).json({ msg: error.message });

    res.json(
      (topups || []).map((t) => ({
        id: t.id,
        username: t.username,
        amount: t.amount,
        method: t.method,
        code: t.code,
        status: t.status,
        time: new Date(t.created_at).toLocaleString("vi-VN"),
      }))
    );
  } catch {
    res.status(500).json({ msg: "Lỗi server" });
  }
});

// ================== CARD TOPUP ==================
function calcCardFeePercent(amount) {
  amount = Number(amount || 0);
  if (amount >= 100000) return 20;
  return 15;
}

app.post("/api/cardtopup", async (req, res) => {
  try {
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
      return res.status(400).json({ msg: "Mệnh giá không hợp lệ (20k/50k/100k/200k/500k)" });
    }

    const { data: u, error: eu } = await sb
      .from("users")
      .select("username")
      .eq("username", username)
      .maybeSingle();
    if (eu) return res.status(500).json({ msg: "Lỗi DB" });
    if (!u) return res.status(404).json({ msg: "User không tồn tại" });

    const feePercent = calcCardFeePercent(amount);
    const netAmount = Math.floor((amount * (100 - feePercent)) / 100);
    const code = "CARD_" + crypto.randomBytes(3).toString("hex").toUpperCase();

    const { data: card, error } = await sb
      .from("card_topups")
      .insert([
        {
          username,
          provider,
          amount: Math.floor(amount),
          fee_percent: feePercent,
          net_amount: netAmount,
          serial,
          pin,
          code,
          status: "Chờ duyệt",
          admin_note: "",
        },
      ])
      .select("*")
      .single();

    if (error) return res.status(500).json({ msg: error.message });

    res.json({
      card: {
        id: card.id,
        code: card.code,
        username: card.username,
        provider: card.provider,
        amount: card.amount,
        feePercent: card.fee_percent,
        netAmount: card.net_amount,
        status: card.status,
        adminNote: card.admin_note,
        time: new Date(card.created_at).toLocaleString("vi-VN"),
      },
    });
  } catch {
    res.status(500).json({ msg: "Lỗi server" });
  }
});

app.get("/api/cardtopups/:username", async (req, res) => {
  try {
    const username = req.params.username;

    const { data: cards, error } = await sb
      .from("card_topups")
      .select("*")
      .eq("username", username)
      .order("id", { ascending: false });

    if (error) return res.status(500).json({ msg: error.message });

    res.json(
      (cards || []).map((c) => ({
        id: c.id,
        code: c.code,
        username: c.username,
        provider: c.provider,
        amount: c.amount,
        feePercent: c.fee_percent,
        netAmount: c.net_amount,
        serial: c.serial,
        pin: c.pin,
        status: c.status,
        adminNote: c.admin_note,
        time: new Date(c.created_at).toLocaleString("vi-VN"),
      }))
    );
  } catch {
    res.status(500).json({ msg: "Lỗi server" });
  }
});

// ================== ADMIN ==================
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

// Lấy toàn bộ dữ liệu cho dashboard
app.get("/api/admin/data", requireAdmin, async (req, res) => {
  try {
    const { data: users, error: eU } = await sb.from("users").select("*").order("id", { ascending: false });
    if (eU) return res.status(500).json({ msg: eU.message });

    const { data: orders, error: eO } = await sb.from("orders").select("*").order("id", { ascending: false });
    if (eO) return res.status(500).json({ msg: eO.message });

    const { data: topups, error: eT } = await sb.from("topups").select("*").order("id", { ascending: false });
    if (eT) return res.status(500).json({ msg: eT.message });

    const { data: cardTopups, error: eC } = await sb.from("card_topups").select("*").order("id", { ascending: false });
    if (eC) return res.status(500).json({ msg: eC.message });

    res.json({ users: users || [], orders: orders || [], topups: topups || [], cardTopups: cardTopups || [] });
  } catch {
    res.status(500).json({ msg: "Lỗi server" });
  }
});

app.post("/api/admin/order-update", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.body.id);
    const status = normStr(req.body.status);
    const adminNote = normStr(req.body.adminNote);

    const payload = {};
    if (status) payload.status = status;
    payload.admin_note = adminNote;

    const { error } = await sb.from("orders").update(payload).eq("id", id);
    if (error) return res.status(500).json({ msg: error.message });

    res.json({ ok: true });
  } catch {
    res.status(500).json({ msg: "Lỗi server" });
  }
});

app.post("/api/admin/order-paid", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.body.id);
    const paid = Boolean(req.body.paid);

    const { error } = await sb
      .from("orders")
      .update({ paid_status: paid ? "Đã thanh toán" : "Chưa thanh toán" })
      .eq("id", id);

    if (error) return res.status(500).json({ msg: error.message });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ msg: "Lỗi server" });
  }
});

app.post("/api/admin/order-delete", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.body.id);
    const { error } = await sb.from("orders").delete().eq("id", id);
    if (error) return res.status(500).json({ msg: error.message });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ msg: "Lỗi server" });
  }
});

// Duyệt nạp MB: approve => cộng balance + set topup "Đã duyệt"
app.post("/api/admin/topup-approve", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.body.id);
    const approve = Boolean(req.body.approve);

    const { data: topup, error: e1 } = await sb.from("topups").select("*").eq("id", id).maybeSingle();
    if (e1) return res.status(500).json({ msg: e1.message });
    if (!topup) return res.status(404).json({ msg: "Không tìm thấy topup" });
    if (topup.status !== "Chờ duyệt") return res.status(400).json({ msg: "Topup đã xử lý rồi" });

    if (!approve) {
      const { error: e2 } = await sb.from("topups").update({ status: "Từ chối" }).eq("id", id);
      if (e2) return res.status(500).json({ msg: e2.message });
      return res.json({ ok: true });
    }

    const { data: user, error: eU } = await sb
      .from("users")
      .select("balance")
      .eq("username", topup.username)
      .maybeSingle();
    if (eU) return res.status(500).json({ msg: eU.message });
    if (!user) return res.status(404).json({ msg: "User không tồn tại" });

    const newBal = Number(user.balance || 0) + Number(topup.amount || 0);

    const { error: e3 } = await sb.from("users").update({ balance: newBal }).eq("username", topup.username);
    if (e3) return res.status(500).json({ msg: e3.message });

    const { error: e4 } = await sb.from("topups").update({ status: "Đã duyệt" }).eq("id", id);
    if (e4) return res.status(500).json({ msg: e4.message });

    res.json({ ok: true });
  } catch {
    res.status(500).json({ msg: "Lỗi server" });
  }
});

// Duyệt thẻ: approve => cộng net_amount + set card "Đã duyệt"
app.post("/api/admin/card-approve", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.body.id);
    const approve = Boolean(req.body.approve);
    const adminNote = normStr(req.body.adminNote);

    const { data: card, error: e1 } = await sb.from("card_topups").select("*").eq("id", id).maybeSingle();
    if (e1) return res.status(500).json({ msg: e1.message });
    if (!card) return res.status(404).json({ msg: "Không tìm thấy thẻ" });
    if (card.status !== "Chờ duyệt") return res.status(400).json({ msg: "Thẻ đã xử lý rồi" });

    if (!approve) {
      const { error: e2 } = awa
