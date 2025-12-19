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

// ===== SERVICES (Báº£ng giĂ¡ báº¡n gá»­i) =====
const SERVICES = [
  // CĂ y Level, Beli, Fragment, Mastery
  { id: "lv_1_700", category: "CĂ y Level / Beli / Frag / Mastery", name: "CĂ y Level 1-700", price: 10000, note: "" },
  { id: "lv_700_1500", category: "CĂ y Level / Beli / Frag / Mastery", name: "CĂ y Level 700-1500", price: 10000, note: "" },
  { id: "lv_1500_max", category: "CĂ y Level / Beli / Frag / Mastery", name: "CĂ y Level 1500-max", price: 20000, note: "" },
  { id: "lv_1_max_godhuman", category: "CĂ y Level / Beli / Frag / Mastery", name: "CĂ y Level 1-max", price: 50000, note: "cáº£ láº¥y godhuman" },
  { id: "beli_9m", category: "CĂ y Level / Beli / Frag / Mastery", name: "9m beli", price: 10000, note: "" },
  { id: "frag_20k", category: "CĂ y Level / Beli / Frag / Mastery", name: "20k frag", price: 10000, note: "" },
  { id: "mas_1_600_melee_sword_fruit_m1", category: "CĂ y Level / Beli / Frag / Mastery", name: "1-600 mas", price: 10000, note: "(mele + kiáº¿m + trĂ¡i cĂ³ m1)" },
  { id: "mas_1_600_gun_fruit_no_m1", category: "CĂ y Level / Beli / Frag / Mastery", name: "1-600 mas", price: 20000, note: "(sĂºng + trĂ¡i ko cĂ³ m1)" },

  // Láº¥y Melle/Items
  { id: "get_deathstep", category: "Láº¥y Melee / Items", name: "Láº¥y Death step", price: 10000, note: "10k/1 vĂµ" },
  { id: "get_sharkman", category: "Láº¥y Melee / Items", name: "Láº¥y Sharkman karate", price: 10000, note: "10k/1 vĂµ" },
  { id: "get_electric_claw", category: "Láº¥y Melee / Items", name: "Láº¥y Electric claw", price: 10000, note: "10k/1 vĂµ" },
  { id: "get_dragon_talon", category: "Láº¥y Melee / Items", name: "Láº¥y Dragon talon", price: 10000, note: "10k/1 vĂµ" },

  { id: "get_godhuman_fullskill_need_mats", category: "Láº¥y Melee / Items", name: "Láº¥y Godhuman + cĂ y full skill", price: 40000, note: "ChÆ°a Ä‘á»§ nguyĂªn liá»‡u" },
  { id: "get_godhuman_fullskill_have_mats", category: "Láº¥y Melee / Items", name: "Láº¥y Godhuman + cĂ y full skill", price: 20000, note: "Äá»§ nguyĂªn liá»‡u" },

  { id: "get_sanguine_art", category: "Láº¥y Melee / Items", name: "Láº¥y Sanguine art", price: 10000, note: "ÄĂ£ kĂ©o tim vá» tiki" },
  { id: "get_cdk", category: "Láº¥y Melee / Items", name: "Láº¥y Curse dual katana", price: 20000, note: "" },

  { id: "get_shisui", category: "Láº¥y Melee / Items", name: "Láº¥y Shisui", price: 7000, note: "7k/1 cĂ¢y (cáº£ cĂ y mas)" },
  { id: "get_saddi", category: "Láº¥y Melee / Items", name: "Láº¥y Saddi", price: 7000, note: "7k/1 cĂ¢y (cáº£ cĂ y mas)" },
  { id: "get_wando", category: "Láº¥y Melee / Items", name: "Láº¥y Wando", price: 7000, note: "7k/1 cĂ¢y (cáº£ cĂ y mas)" },

  { id: "get_ttk", category: "Láº¥y Melee / Items", name: "Láº¥y True Triple Katana", price: 5000, note: "(ÄĂ£ cĂ³ 3 kiáº¿m, chá»‰ cáº§n cĂ y mas)" },
  { id: "get_fox_lamp", category: "Láº¥y Melee / Items", name: "Láº¥y Fox lamp", price: 40000, note: "" },
  { id: "get_tushita", category: "Láº¥y Melee / Items", name: "Láº¥y Tushita", price: 10000, note: "" },
  { id: "get_yama", category: "Láº¥y Melee / Items", name: "Láº¥y Yama", price: 10000, note: "" },
  { id: "get_shark_anchor", category: "Láº¥y Melee / Items", name: "Láº¥y Shark Anchor", price: 20000, note: "" },
  { id: "get_soul_guitar", category: "Láº¥y Melee / Items", name: "Láº¥y Soul guitar", price: 10000, note: "" },
  { id: "get_dark_fragment", category: "Láº¥y Melee / Items", name: "Láº¥y Dark Fragment", price: 7000, note: "" },
  { id: "upgrade_star", category: "Láº¥y Melee / Items", name: "NĂ¢ng sao cho kiáº¿m/sĂºng", price: 2000, note: "2k/1" },
  { id: "get_haki_legendary", category: "Láº¥y Melee / Items", name: "Láº¥y Haki legendary", price: 20000, note: "20k/3 mĂ u" },
  { id: "materials_quote", category: "Láº¥y Melee / Items", name: "Tuá»³ tá»«ng nguyĂªn liá»‡u", price: 0, note: "IB mĂ¬nh bĂ¡o giĂ¡" },

  // Up tá»™c v4
  { id: "race_cyborg", category: "Up tá»™c v4", name: "Láº¥y tá»™c Cyborg", price: 20000, note: "" },
  { id: "race_ghoul", category: "Up tá»™c v4", name: "Láº¥y tá»™c Ghoul", price: 10000, note: "" },
  { id: "race_v1_v3", category: "Up tá»™c v4", name: "Up tá»™c v1-v3", price: 10000, note: "" },
  { id: "pull_lever_have_mirror_rip", category: "Up tá»™c v4", name: "Gáº¡t cáº§n", price: 5000, note: "(CĂ³ máº£nh gÆ°Æ¡ng, Ä‘Ă¡nh rip)" },
  { id: "pull_lever_no_rip_doughking", category: "Up tá»™c v4", name: "Gáº¡t cáº§n", price: 20000, note: "(ChÆ°a Ä‘Ă¡nh rip, dough king)" },
  { id: "v4_1_gear", category: "Up tá»™c v4", name: "Up v4 1 gear", price: 7000, note: "" },
  { id: "v4_full_gear", category: "Up tá»™c v4", name: "UP v4 full gear", price: 40000, note: "(Bao frag, cáº£ gear Ä‘á»•i)" },

  // Leviathan
  { id: "leviathan_break_idk", category: "Leviathan", name: "PhĂ¡ IDK", price: 10000, note: "" },
  { id: "leviathan_heart_tiki", category: "Leviathan", name: "KĂ©o tim vá» Tiki", price: 30000, note: "" },
  { id: "leviathan_heart_hydra", category: "Leviathan", name: "KĂ©o tim vá» Hydra", price: 40000, note: "" },

  // Draco Update
  { id: "draco_full_belt", category: "Draco Update", name: "Láº¥y full Ä‘ai", price: 20000, note: "" },
  { id: "draco_race_v1", category: "Draco Update", name: "Láº¥y tá»™c Draco v1", price: 7000, note: "" },
  { id: "draco_v1_v3", category: "Draco Update", name: "Up Draco v1-v3", price: 10000, note: "(yĂªu cáº§u trĂªn 3.5m beli)" },
  { id: "draco_heart", category: "Draco Update", name: "Láº¥y Dragon Heart", price: 7000, note: "" },
  { id: "draco_storm", category: "Draco Update", name: "Láº¥y Dragon Storm", price: 15000, note: "" },
  { id: "draco_egg", category: "Draco Update", name: "Láº¥y 1 trá»©ng", price: 7000, note: "" },
  { id: "draco_gear_1", category: "Draco Update", name: "Up gear Draco", price: 7000, note: "1 gear (Ä‘Ă£ train)" },
  { id: "draco_gear_full", category: "Draco Update", name: "Up gear Draco full", price: 35000, note: "full gear (bao f)" },
  { id: "draco_combo_az", category: "Draco Update", name: "Full combo A-Z", price: 150000, note: "" },

  // Bounty Hunt
  { id: "bounty_pirate_1m", category: "Bounty Hunt", name: "1m Bounty háº£i táº·c", price: 10000, note: "" },
  { id: "bounty_marine_1m", category: "Bounty Hunt", name: "1m Bounty háº£i quĂ¢n", price: 15000, note: "" }
];

// ===== USER AUTH =====
app.post("/api/auth/register", (req, res) => {
  const { username, password, gmail } = req.body || {};
  if (!username || !password || !gmail) {
    return res.status(400).json({ ok: false, msg: "Thiáº¿u username/password/gmail" });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ ok: false, msg: "Máº­t kháº©u >= 6 kĂ½ tá»±" });
  }

  const db = loadDB();
  const uName = String(username).trim();

  if (db.users.find(u => u.username === uName)) {
    return res.status(409).json({ ok: false, msg: "TĂ i khoáº£n Ä‘Ă£ tá»“n táº¡i" });
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
  if (!u) return res.status(401).json({ ok: false, msg: "Sai tĂ i khoáº£n hoáº·c máº­t kháº©u" });

  const ok = bcrypt.compareSync(String(password || ""), u.passHash);
  if (!ok) return res.status(401).json({ ok: false, msg: "Sai tĂ i khoáº£n hoáº·c máº­t kháº©u" });

  res.json({
    ok: true,
    user: { username: u.username, gmail: u.gmail, balance: Number(u.balance || 0) }
  });
});

app.post("/api/auth/reset-password", async (req, res) => {
  const { username, gmail, newPassword } = req.body || {};
  const uName = String(username || "").trim();
  const mail = String(gmail || "").trim();

  if (!uName || !mail || !newPassword) {
    return res.status(400).json({ ok: false, msg: "Thiáº¿u username/gmail/máº­t kháº©u má»›i" });
  }
  if (String(newPassword).length < 6) {
    return res.status(400).json({ ok: false, msg: "Máº­t kháº©u má»›i >= 6 kĂ½ tá»±" });
  }

  const db = loadDB();
  const u = db.users.find(x => x.username === uName);
  if (!u) return res.status(404).json({ ok: false, msg: "TĂ i khoáº£n khĂ´ng tá»“n táº¡i" });

  if (String(u.gmail || "").trim().toLowerCase() !== mail.toLowerCase()) {
    return res.status(401).json({ ok: false, msg: "Gmail khĂ´ng khá»›p" });
  }

  const passHash = await bcrypt.hash(String(newPassword), 10);
  u.passHash = passHash;
  u.passUpdatedAt = nowISO();

  saveDB(db);
  res.json({ ok: true, msg: "Äá»•i máº­t kháº©u thĂ nh cĂ´ng" });
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

// ===== ORDERS: táº¡o Ä‘Æ¡n + ghi chĂº + tráº¡ng thĂ¡i =====
app.post("/api/orders", (req, res) => {
  const { username, serviceId, note } = req.body || {};
  const db = loadDB();

  const u = db.users.find(x => x.username === String(username || "").trim());
  if (!u) return res.status(404).json({ ok: false, msg: "KhĂ´ng tĂ¬m tháº¥y user" });

  const s = SERVICES.find(x => x.id === serviceId);
  if (!s) return res.status(404).json({ ok: false, msg: "KhĂ´ng tĂ¬m tháº¥y dá»‹ch vá»¥" });

  if (Number(s.price) <= 0) {
    return res.status(400).json({ ok: false, msg: "Dá»‹ch vá»¥ nĂ y lĂ  IB bĂ¡o giĂ¡, khĂ´ng thá»ƒ mua trá»±c tiáº¿p." });
  }

  const bal = Number(u.balance || 0);
  if (bal < s.price) return res.status(400).json({ ok: false, msg: "Sá»‘ dÆ° khĂ´ng Ä‘á»§" });

  u.balance = bal - s.price;

  const order = {
    id: Date.now().toString(),
    username: u.username,
    serviceId: s.id,
    category: s.category,
    serviceName: s.name,
    note: String(note || "").trim(),
    amount: Number(s.price),
    status: "PAID",         // máº·c Ä‘á»‹nh khi user mua xong
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
    return res.status(400).json({ ok: false, msg: "Thiáº¿u username hoáº·c sá»‘ tiá»n khĂ´ng há»£p lá»‡" });
  }

  const db = loadDB();
  const u = db.users.find(x => x.username === String(username).trim());
  if (!u) return res.status(404).json({ ok: false, msg: "User khĂ´ng tá»“n táº¡i" });

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
  if (!t) return res.status(404).json({ ok: false, msg: "KhĂ´ng tháº¥y topup" });
  if (t.status === "APPROVED") return res.json({ ok: true });

  const u = db.users.find(x => x.username === t.username);
  if (!u) return res.status(404).json({ ok: false, msg: "User khĂ´ng tá»“n táº¡i" });

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
  if (!t) return res.status(404).json({ ok: false, msg: "KhĂ´ng tháº¥y topup" });
  if (t.status !== "PENDING") return res.status(400).json({ ok: false, msg: "Topup Ä‘Ă£ xá»­ lĂ½" });

  t.status = "REJECTED";
  t.approvedAt = nowISO();

  saveDB(db);
  res.json({ ok: true });
});

// Admin: Ä‘á»•i tráº¡ng thĂ¡i Ä‘Æ¡n
app.post("/api/admin/orders/set-status", (req, res) => {
  if (!isAdmin(req.body)) return res.status(401).json({ ok: false, msg: "Sai admin" });

  const { orderId, status } = req.body || {};
  const allow = ["PAID", "DOING", "DONE"];
  if (!allow.includes(status)) {
    return res.status(400).json({ ok: false, msg: "Status khĂ´ng há»£p lá»‡" });
  }

  const db = loadDB();
  const o = db.orders.find(x => x.id === orderId);
  if (!o) return res.status(404).json({ ok: false, msg: "KhĂ´ng tĂ¬m tháº¥y order" });

  o.status = status;
  o.updatedAt = nowISO();

  saveDB(db);
  res.json({ ok: true });
});

// Admin: xoĂ¡ user + xoĂ¡ lá»‹ch sá»­ liĂªn quan
app.post("/api/admin/delete-user", (req, res) => {
  if (!isAdmin(req.body)) return res.status(401).json({ ok: false, msg: "Sai admin" });

  const user = String(req.body?.username || "").trim();
  if (!user) return res.status(400).json({ ok: false, msg: "Thiáº¿u username" });

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
    return res.status(400).json({ ok: false, msg: "Dá»¯ liá»‡u khĂ´ng há»£p lá»‡" });
  }

  const db = loadDB();
  const u = db.users.find(x => x.username === user);
  if (!u) return res.status(404).json({ ok: false, msg: "User khĂ´ng tá»“n táº¡i" });

  u.balance = b;
  saveDB(db);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on", PORT));
