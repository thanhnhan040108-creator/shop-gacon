const express = require("express");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const DB_PATH = path.join(__dirname, "data.json");

// ===== Helpers =====
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
function nowISO() {
  return new Date().toISOString();
}
function genCode(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}
function isAdmin(body) {
  return (
    body?.adminUser === process.env.ADMIN_USER &&
    body?.adminPass === process.env.ADMIN_PASS
  );
}

// ===== SERVICES (Bảng giá bạn gửi) =====
const SERVICES = [
  // Cày Level, Beli, Fragment, Mastery
  { id: "lv_1_700", category: "Cày Level / Beli / Frag / Mastery", name: "Cày Level 1-700", price: 10000, note: "" },
  { id: "lv_700_1500", category: "Cày Level / Beli / Frag / Mastery", name: "Cày Level 700-1500", price: 10000, note: "" },
  { id: "lv_1500_max", category: "Cày Level / Beli / Frag / Mastery", name: "Cày Level 1500-max", price: 20000, note: "" },
  { id: "lv_1_max_godhuman", category: "Cày Level / Beli / Frag / Mastery", name: "Cày Level 1-max", price: 50000, note: "cả lấy godhuman" },
  { id: "beli_9m", category: "Cày Level / Beli / Frag / Mastery", name: "9m beli", price: 10000, note: "" },
  { id: "frag_20k", category: "Cày Level / Beli / Frag / Mastery", name: "20k frag", price: 10000, note: "" },
  { id: "mas_1_600_melee_sword_fruit_m1", category: "Cày Level / Beli / Frag / Mastery", name: "1-600 mas", price: 10000, note: "(mele + kiếm + trái có m1)" },
  { id: "mas_1_600_gun_fruit_no_m1", category: "Cày Level / Beli / Frag / Mastery", name: "1-600 mas", price: 20000, note: "(súng + trái ko có m1)" },

  // Lấy Melle/Items
  { id: "get_deathstep", category: "Lấy Melee / Items", name: "Lấy Death step", price: 10000, note: "10k/1 võ" },
  { id: "get_sharkman", category: "Lấy Melee / Items", name: "Lấy Sharkman karate", price: 10000, note: "10k/1 võ" },
  { id: "get_electric_claw", category: "Lấy Melee / Items", name: "Lấy Electric claw", price: 10000, note: "10k/1 võ" },
  { id: "get_dragon_talon", category: "Lấy Melee / Items", name: "Lấy Dragon talon", price: 10000, note: "10k/1 võ" },

  { id: "get_godhuman_fullskill_need_mats", category: "Lấy Melee / Items", name: "Lấy Godhuman + cày full skill", price: 40000, note: "Chưa đủ nguyên liệu" },
  { id: "get_godhuman_fullskill_have_mats", category: "Lấy Melee / Items", name: "Lấy Godhuman + cày full skill", price: 20000, note: "Đủ nguyên liệu" },

  { id: "get_sanguine_art", category: "Lấy Melee / Items", name: "Lấy Sanguine art", price: 10000, note: "Đã kéo tim về tiki" },
  { id: "get_cdk", category: "Lấy Melee / Items", name: "Lấy Curse dual katana", price: 20000, note: "" },

  { id: "get_shisui", category: "Lấy Melee / Items", name: "Lấy Shisui", price: 7000, note: "7k/1 cây (cả cày mas)" },
  { id: "get_saddi", category: "Lấy Melee / Items", name: "Lấy Saddi", price: 7000, note: "7k/1 cây (cả cày mas)" },
  { id: "get_wando", category: "Lấy Melee / Items", name: "Lấy Wando", price: 7000, note: "7k/1 cây (cả cày mas)" },

  { id: "get_ttk", category: "Lấy Melee / Items", name: "Lấy True Triple Katana", price: 5000, note: "(Đã có 3 kiếm, chỉ cần cày mas)" },
  { id: "get_fox_lamp", category: "Lấy Melee / Items", name: "Lấy Fox lamp", price: 40000, note: "" },
  { id: "get_tushita", category: "Lấy Melee / Items", name: "Lấy Tushita", price: 10000, note: "" },
  { id: "get_yama", category: "Lấy Melee / Items", name: "Lấy Yama", price: 10000, note: "" },
  { id: "get_shark_anchor", category: "Lấy Melee / Items", name: "Lấy Shark Anchor", price: 20000, note: "" },
  { id: "get_soul_guitar", category: "Lấy Melee / Items", name: "Lấy Soul guitar", price: 10000, note: "" },
  { id: "get_dark_fragment", category: "Lấy Melee / Items", name: "Lấy Dark Fragment", price: 7000, note: "" },
  { id: "upgrade_star", category: "Lấy Melee / Items", name: "Nâng sao cho kiếm/súng", price: 2000, note: "2k/1" },
  { id: "get_haki_legendary", category: "Lấy Melee / Items", name: "Lấy Haki legendary", price: 20000, note: "20k/3 màu" },
  { id: "materials_quote", category: "Lấy Melee / Items", name: "Tuỳ từng nguyên liệu", price: 0, note: "IB mình báo giá" },

  // Up tộc v4
  { id: "race_cyborg", category: "Up tộc v4", name: "Lấy tộc Cyborg", price: 20000, note: "" },
  { id: "race_ghoul", category: "Up tộc v4", name: "Lấy tộc Ghoul", price: 10000, note: "" },
  { id: "race_v1_v3", category: "Up tộc v4", name: "Up tộc v1-v3", price: 10000, note: "" },
  { id: "pull_lever_have_mirror_rip", category: "Up tộc v4", name: "Gạt cần", price: 5000, note: "(Có mảnh gương, đánh rip)" },
  { id: "pull_lever_no_rip_doughking", category: "Up tộc v4", name: "Gạt cần", price: 20000, note: "(Chưa đánh rip, dough king)" },
  { id: "v4_1_gear", category: "Up tộc v4", name: "Up v4 1 gear", price: 7000, note: "" },
  { id: "v4_full_gear", category: "Up tộc v4", name: "UP v4 full gear", price: 40000, note: "(Bao frag, cả gear đổi)" },

  // Leviathan
  { id: "leviathan_break_idk", category: "Leviathan", name: "Phá IDK", price: 10000, note: "" },
  { id: "leviathan_heart_tiki", category: "Leviathan", name: "Kéo tim về Tiki", price: 30000, note: "" },
  { id: "leviathan_heart_hydra", category: "Leviathan", name: "Kéo tim về Hydra", price: 40000, note: "" },

  // Draco Update
  { id: "draco_full_belt", category: "Draco Update", name: "Lấy full đai", price: 20000, note: "" },
  { id: "draco_race_v1", category: "Draco Update", name: "Lấy tộc Draco v1", price: 7000, note: "" },
  { id: "draco_v1_v3", category: "Draco Update", name: "Up Draco v1-v3", price: 10000, note: "(yêu cầu trên 3.5m beli)" },
  { id: "draco_heart", category: "Draco Update", name: "Lấy Dragon Heart", price: 7000, note: "" },
  { id: "draco_storm", category: "Draco Update", name: "Lấy Dragon Storm", price: 15000, note: "" },
  { id: "draco_egg", category: "Draco Update", name: "Lấy 1 trứng", price: 7000, note: "" },
  { id: "draco_gear_1", category: "Draco Update", name: "Up gear Draco", price: 7000, note: "1 gear (đã train)" },
  { id: "draco_gear_full", category: "Draco Update", name: "Up gear Draco full", price: 35000, note: "full gear (bao f)" },
  { id: "draco_combo_az", category: "Draco Update", name: "Full combo A-Z", price: 150000, note: "" },

  // Bounty Hunt
  { id: "bounty_pirate_1m", category: "Bounty Hunt", name: "1m Bounty hải tặc", price: 10000, note: "" },
  { id: "bounty_marine_1m", category: "Bounty Hunt", name: "1m Bounty hải quân", price: 15000, note: "" }
];

// ===== USER AUTH =====
app.post("/api/auth/register", (req, res) => {
  const { username, password, gmail } = req.body || {};
  if (!username || !password || !gmail) {
    return res.status(400).json({ ok: false, msg: "Thiếu username/password/gmail" });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ ok: false, msg: "Mật khẩu >= 6 ký tự" });
  }

  const db = loadDB();
  const uName = String(username).trim();

  if (db.users.find(u => u.username === uName)) {
    return res.status(409).json({ ok: false, msg: "Tài khoản đã tồn tại" });
  }

  const passHash = bcrypt.hashSync(String(password), 10);
  db.users.push({
    username: uName,
    passHash,
    gmail: String(gmail).trim(),
    balance: 0,
    createdAt: nowISO()
  });

  saveDB(db);
  res.json({ ok: true });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  const db = loadDB();
  const u = db.users.find(x => x.username === String(username || "").trim());
  if (!u) return res.status(401).json({ ok: false, msg: "Sai tài khoản hoặc mật khẩu" });

  const ok = bcrypt.compareSync(String(password || ""), u.passHash);
  if (!ok) return res.status(401).json({ ok: false, msg: "Sai tài khoản hoặc mật khẩu" });

  res.json({
    ok: true,
    user: { username: u.username, gmail: u.gmail, balance: Number(u.balance || 0) }
  });
});

app.get("/api/balance", (req, res) => {
  const { username } = req.query;
  const db = loadDB();
  const u = db.users.find(x => x.username === String(username || "").trim());
  res.json({ ok: true, balance: u ? Number(u.balance || 0) : 0 });
});

// ===== SERVICES =====
app.get("/api/services", (req, res) => {
  res.json({ ok: true, services: SERVICES });
});

// ===== ORDERS: tạo đơn + ghi chú + trạng thái =====
app.post("/api/orders", (req, res) => {
  const { username, serviceId, note } = req.body || {};
  const db = loadDB();

  const u = db.users.find(x => x.username === String(username || "").trim());
  if (!u) return res.status(404).json({ ok: false, msg: "Không tìm thấy user" });

  const s = SERVICES.find(x => x.id === serviceId);
  if (!s) return res.status(404).json({ ok: false, msg: "Không tìm thấy dịch vụ" });

  if (Number(s.price) <= 0) {
    return res.status(400).json({ ok: false, msg: "Dịch vụ này là IB báo giá, không thể mua trực tiếp." });
  }

  const bal = Number(u.balance || 0);
  if (bal < s.price) return res.status(400).json({ ok: false, msg: "Số dư không đủ" });

  u.balance = bal - s.price;

  const order = {
    id: Date.now().toString(),
    username: u.username,
    serviceId: s.id,
    category: s.category,
    serviceName: s.name,
    note: String(note || "").trim(),
    amount: Number(s.price),
    status: "PAID",         // mặc định khi user mua xong
    createdAt: nowISO(),
    updatedAt: null
  };

  db.orders.unshift(order);
  saveDB(db);

  res.json({ ok: true, order, balance: u.balance });
});

app.get("/api/orders", (req, res) => {
  const { username } = req.query;
  const db = loadDB();
  const list = String(username || "").trim()
    ? db.orders.filter(o => o.username === String(username).trim())
    : db.orders;
  res.json({ ok: true, orders: list });
});

// ===== TOPUP (MB manual approve) =====
app.post("/api/topups", (req, res) => {
  const { username, amount } = req.body || {};
  const amt = Number(amount);

  if (!username || !Number.isFinite(amt) || amt < 1000) {
    return res.status(400).json({ ok: false, msg: "Thiếu username hoặc số tiền không hợp lệ" });
  }

  const db = loadDB();
  const u = db.users.find(x => x.username === String(username).trim());
  if (!u) return res.status(404).json({ ok: false, msg: "User không tồn tại" });

  const code = genCode("NAP");
  const topup = {
    id: Date.now().toString(),
    username: u.username,
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
  const list = String(username || "").trim()
    ? db.topups.filter(t => t.username === String(username).trim())
    : db.topups;
  res.json({ ok: true, topups: list });
});

// ===== ADMIN =====
app.post("/api/admin/summary", (req, res) => {
  if (!isAdmin(req.body)) return res.status(401).json({ ok: false, msg: "Sai admin" });
  const db = loadDB();
  res.json({ ok: true, users: db.users, topups: db.topups, orders: db.orders });
});

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

app.post("/api/admin/topups/reject", (req, res) => {
  if (!isAdmin(req.body)) return res.status(401).json({ ok: false, msg: "Sai admin" });

  const { topupId } = req.body || {};
  const db = loadDB();

  const t = db.topups.find(x => x.id === topupId);
  if (!t) return res.status(404).json({ ok: false, msg: "Không thấy topup" });
  if (t.status !== "PENDING") return res.status(400).json({ ok: false, msg: "Topup đã xử lý" });

  t.status = "REJECTED";
  t.approvedAt = nowISO();

  saveDB(db);
  res.json({ ok: true });
});

// Admin: đổi trạng thái đơn
app.post("/api/admin/orders/set-status", (req, res) => {
  if (!isAdmin(req.body)) return res.status(401).json({ ok: false, msg: "Sai admin" });

  const { orderId, status } = req.body || {};
  const allow = ["PAID", "DOING", "DONE"];
  if (!allow.includes(status)) {
    return res.status(400).json({ ok: false, msg: "Status không hợp lệ" });
  }

  const db = loadDB();
  const o = db.orders.find(x => x.id === orderId);
  if (!o) return res.status(404).json({ ok: false, msg: "Không tìm thấy order" });

  o.status = status;
  o.updatedAt = nowISO();

  saveDB(db);
  res.json({ ok: true });
});

// Admin: xoá user + xoá lịch sử liên quan
app.post("/api/admin/delete-user", (req, res) => {
  if (!isAdmin(req.body)) return res.status(401).json({ ok: false, msg: "Sai admin" });

  const user = String(req.body?.username || "").trim();
  if (!user) return res.status(400).json({ ok: false, msg: "Thiếu username" });

  const db = loadDB();
  const before = db.users.length;

  db.users = db.users.filter(u => u.username !== user);
  db.orders = db.orders.filter(o => o.username !== user);
  db.topups = db.topups.filter(t => t.username !== user);

  saveDB(db);
  res.json({ ok: true, removed: before - db.users.length });
});

// Admin: set balance
app.post("/api/admin/set-balance", (req, res) => {
  if (!isAdmin(req.body)) return res.status(401).json({ ok: false, msg: "Sai admin" });

  const user = String(req.body?.username || "").trim();
  const b = Number(req.body?.balance);

  if (!user || !Number.isFinite(b) || b < 0) {
    return res.status(400).json({ ok: false, msg: "Dữ liệu không hợp lệ" });
  }

  const db = loadDB();
  const u = db.users.find(x => x.username === user);
  if (!u) return res.status(404).json({ ok: false, msg: "User không tồn tại" });

  u.balance = b;
  saveDB(db);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on", PORT));
