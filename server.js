// Fly Visuals Shop Tool — job board, install calendar, quotes, materials.
// Jobs come in from GoHighLevel through a workflow webhook.
const express = require('express');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const APP_PASSWORD = process.env.APP_PASSWORD || 'changeme';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const WEBHOOK_KEY = process.env.WEBHOOK_KEY || 'dev-webhook-key';

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'shop.db'));
db.pragma('journal_mode = WAL');

// ---------- schema ----------
db.exec(`
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ghl_opportunity_id TEXT UNIQUE,
  ghl_contact_id TEXT,
  customer TEXT, phone TEXT, email TEXT,
  title TEXT, service TEXT, vehicle TEXT,
  stage TEXT DEFAULT 'new',
  value REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  install_date TEXT, bay TEXT, assigned_to TEXT,
  source TEXT DEFAULT 'manual',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT, category TEXT, unit TEXT,
  on_hand REAL DEFAULT 0, reorder_at REAL DEFAULT 0, cost REAL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS job_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER, material_id INTEGER, qty REAL,
  used_by TEXT, used_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER, who TEXT, text TEXT,
  at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS webhook_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  body TEXT, result TEXT, at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
`);

const DEFAULT_SETTINGS = {
  stages: [
    { id: 'new', name: 'New / From GHL' },
    { id: 'design', name: 'Design' },
    { id: 'approval', name: 'Customer Approval' },
    { id: 'print', name: 'Print / Cut' },
    { id: 'scheduled', name: 'Install Scheduled' },
    { id: 'install', name: 'Installing' },
    { id: 'qc', name: 'QC / Pickup' },
    { id: 'done', name: 'Done' }
  ],
  bays: ['Bay 1', 'Bay 2', 'Tint Bay', 'Mobile'],
  team: ['Brian'],
  // Placeholder prices — edit in Settings to match the shop.
  pricing: {
    wrap: {
      sqft: { 'Compact car': 180, 'Sedan': 220, 'SUV / Pickup': 280, 'Cargo van': 340, 'Box truck (16ft)': 500 },
      material_per_sqft: { 'Calendared': 4, 'Cast (3M / Avery)': 7, 'Color change premium': 9, 'Chrome / specialty': 14 },
      labor_per_sqft: 6,
      design_fee: 350
    },
    tint: {
      base: { 'Coupe': 1, 'Sedan': 1.1, 'SUV / Truck': 1.25, 'Van': 1.4 },
      film: { 'Dyed': 199, 'Carbon': 279, 'Ceramic': 399, 'IR Ceramic': 499 },
      addons: { 'Windshield': 150, 'Sun strip': 40, 'Old tint removal': 100 }
    },
    sign: {
      per_sqft: { 'Coroplast': 6, 'Aluminum .040': 14, 'ACM / Dibond': 18, 'Vinyl banner': 5, 'Magnetic': 12 },
      min_charge: 45,
      install_fee: 0
    },
    tax_rate: 7
  }
};
function getSettings() {
  const row = db.prepare("SELECT value FROM settings WHERE key='app'").get();
  if (!row) {
    db.prepare("INSERT INTO settings (key,value) VALUES ('app',?)").run(JSON.stringify(DEFAULT_SETTINGS));
    return DEFAULT_SETTINGS;
  }
  return JSON.parse(row.value);
}
getSettings();

// ---------- app ----------
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(SESSION_SECRET));

// ---------- GHL webhook (no login; protected by key) ----------
function pick(obj, keys) {
  for (const k of keys) {
    const parts = k.split('.');
    let v = obj;
    for (const p of parts) v = v == null ? undefined : v[p];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return undefined;
}
function parseGhl(body) {
  const b = { ...body, ...(body.customData || {}), ...(body.custom_data || {}) };
  const first = pick(b, ['first_name', 'firstName', 'contact.first_name', 'contact.firstName']);
  const last = pick(b, ['last_name', 'lastName', 'contact.last_name', 'contact.lastName']);
  const full = pick(b, ['customer', 'full_name', 'fullName', 'contact_name', 'name', 'contact.name']);
  const value = pick(b, ['value', 'lead_value', 'monetary_value', 'monetaryValue', 'opportunity_value', 'opportunity.monetary_value']);
  return {
    ghl_opportunity_id: pick(b, ['opportunity_id', 'opportunityId', 'id', 'opportunity.id']),
    ghl_contact_id: pick(b, ['contact_id', 'contactId', 'contact.id']),
    customer: full || [first, last].filter(Boolean).join(' ') || 'Unknown customer',
    phone: pick(b, ['phone', 'contact.phone']) || '',
    email: pick(b, ['email', 'contact.email']) || '',
    title: pick(b, ['title', 'job_title', 'opportunity_name', 'opportunityName', 'opportunity.name']) || '',
    service: pick(b, ['service', 'service_type', 'job_type']) || '',
    vehicle: pick(b, ['vehicle', 'vehicle_info', 'year_make_model']) || '',
    notes: pick(b, ['notes', 'job_notes', 'message']) || '',
    value: value ? parseFloat(String(value).replace(/[^0-9.\-]/g, '')) || 0 : 0
  };
}
app.post('/api/ghl/webhook', (req, res) => {
  const key = req.query.key || req.get('x-webhook-key');
  if (key !== WEBHOOK_KEY) return res.status(401).json({ error: 'bad key' });
  const raw = JSON.stringify(req.body).slice(0, 20000);
  try {
    const j = parseGhl(req.body || {});
    let result;
    const existing = j.ghl_opportunity_id
      ? db.prepare('SELECT * FROM jobs WHERE ghl_opportunity_id=?').get(String(j.ghl_opportunity_id))
      : null;
    if (existing) {
      // Update contact/deal info but never move the job's stage or schedule.
      db.prepare(`UPDATE jobs SET customer=COALESCE(NULLIF(NULLIF(?,'Unknown customer'),''),customer),
        phone=COALESCE(NULLIF(?,''),phone), email=COALESCE(NULLIF(?,''),email), title=COALESCE(NULLIF(?,''),title),
        service=COALESCE(NULLIF(?,''),service), vehicle=COALESCE(NULLIF(?,''),vehicle),
        value=CASE WHEN ?>0 THEN ? ELSE value END, updated_at=datetime('now') WHERE id=?`)
        .run(j.customer, j.phone, j.email, j.title, j.service, j.vehicle, j.value, j.value, existing.id);
      db.prepare('INSERT INTO activity (job_id,who,text) VALUES (?,?,?)').run(existing.id, 'GHL', 'Updated from GoHighLevel');
      result = `updated job ${existing.id}`;
    } else {
      const info = db.prepare(`INSERT INTO jobs (ghl_opportunity_id,ghl_contact_id,customer,phone,email,title,service,vehicle,notes,value,source)
        VALUES (?,?,?,?,?,?,?,?,?,?, 'ghl')`).run(
        j.ghl_opportunity_id ? String(j.ghl_opportunity_id) : null, j.ghl_contact_id ? String(j.ghl_contact_id) : null,
        j.customer, j.phone, j.email, j.title || `${j.service || 'Job'} — ${j.customer}`, j.service, j.vehicle, j.notes, j.value);
      db.prepare('INSERT INTO activity (job_id,who,text) VALUES (?,?,?)').run(info.lastInsertRowid, 'GHL', 'Job created from GoHighLevel');
      result = `created job ${info.lastInsertRowid}`;
    }
    db.prepare('INSERT INTO webhook_log (body,result) VALUES (?,?)').run(raw, result);
    res.json({ ok: true, result });
  } catch (e) {
    db.prepare('INSERT INTO webhook_log (body,result) VALUES (?,?)').run(raw, 'error: ' + e.message);
    res.status(500).json({ error: e.message });
  }
});

// ---------- login ----------
app.post('/api/login', (req, res) => {
  const { password, name } = req.body || {};
  const a = Buffer.from(String(password || ''));
  const b = Buffer.from(APP_PASSWORD);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Wrong password' });
  const who = String(name || 'Staff').slice(0, 40);
  res.cookie('fv_user', who, { signed: true, httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === 'production' });
  res.json({ ok: true, name: who });
});
app.post('/api/logout', (req, res) => { res.clearCookie('fv_user'); res.json({ ok: true }); });

function auth(req, res, next) {
  const who = req.signedCookies.fv_user;
  if (!who) return res.status(401).json({ error: 'login required' });
  req.who = who;
  next();
}
app.use('/api', auth);

app.get('/api/me', (req, res) => res.json({ name: req.who }));

// ---------- settings ----------
app.get('/api/settings', (req, res) => res.json(getSettings()));
app.put('/api/settings', (req, res) => {
  const s = { ...getSettings(), ...req.body };
  db.prepare("UPDATE settings SET value=? WHERE key='app'").run(JSON.stringify(s));
  res.json(s);
});
app.get('/api/webhook-log', (req, res) =>
  res.json(db.prepare('SELECT * FROM webhook_log ORDER BY id DESC LIMIT 25').all()));

// ---------- jobs ----------
const JOB_FIELDS = ['customer', 'phone', 'email', 'title', 'service', 'vehicle', 'stage', 'value', 'notes', 'install_date', 'bay', 'assigned_to'];
app.get('/api/jobs', (req, res) => {
  const rows = db.prepare(`SELECT j.*, COALESCE((SELECT SUM(jm.qty*m.cost) FROM job_materials jm JOIN materials m ON m.id=jm.material_id WHERE jm.job_id=j.id),0) AS material_cost
    FROM jobs j ORDER BY COALESCE(install_date,'9999'), id DESC`).all();
  res.json(rows);
});
app.get('/api/jobs/:id', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  job.activity = db.prepare('SELECT * FROM activity WHERE job_id=? ORDER BY id DESC LIMIT 50').all(job.id);
  job.materials = db.prepare(`SELECT jm.*, m.name, m.unit, m.cost FROM job_materials jm JOIN materials m ON m.id=jm.material_id WHERE jm.job_id=? ORDER BY jm.id DESC`).all(job.id);
  res.json(job);
});
app.post('/api/jobs', (req, res) => {
  const b = req.body || {};
  const info = db.prepare(`INSERT INTO jobs (customer,phone,email,title,service,vehicle,stage,value,notes,install_date,bay,assigned_to)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(...JOB_FIELDS.map(f => b[f] ?? (f === 'stage' ? 'new' : f === 'value' ? 0 : null)));
  db.prepare('INSERT INTO activity (job_id,who,text) VALUES (?,?,?)').run(info.lastInsertRowid, req.who, 'Job created');
  res.json(db.prepare('SELECT * FROM jobs WHERE id=?').get(info.lastInsertRowid));
});
app.patch('/api/jobs/:id', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  const changes = Object.keys(req.body || {}).filter(k => JOB_FIELDS.includes(k));
  if (!changes.length) return res.json(job);
  db.prepare(`UPDATE jobs SET ${changes.map(k => k + '=?').join(',')}, updated_at=datetime('now') WHERE id=?`)
    .run(...changes.map(k => req.body[k] === '' ? null : req.body[k]), job.id);
  const st = getSettings();
  const notes = [];
  if (changes.includes('stage') && req.body.stage !== job.stage) {
    const name = (st.stages.find(s => s.id === req.body.stage) || {}).name || req.body.stage;
    notes.push(`Moved to ${name}`);
  }
  if (changes.includes('install_date') && req.body.install_date !== job.install_date)
    notes.push(req.body.install_date ? `Install set for ${req.body.install_date}` : 'Install date cleared');
  if (changes.includes('assigned_to') && req.body.assigned_to !== job.assigned_to)
    notes.push(`Assigned to ${req.body.assigned_to || 'nobody'}`);
  if (changes.includes('bay') && req.body.bay !== job.bay && req.body.bay) notes.push(`Bay: ${req.body.bay}`);
  for (const t of notes) db.prepare('INSERT INTO activity (job_id,who,text) VALUES (?,?,?)').run(job.id, req.who, t);
  res.json(db.prepare('SELECT * FROM jobs WHERE id=?').get(job.id));
});
app.post('/api/jobs/:id/comment', (req, res) => {
  const text = String((req.body || {}).text || '').trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: 'empty' });
  db.prepare('INSERT INTO activity (job_id,who,text) VALUES (?,?,?)').run(req.params.id, req.who, text);
  res.json({ ok: true });
});
app.delete('/api/jobs/:id', (req, res) => {
  const tx = db.transaction(id => {
    // Return any logged material to stock.
    for (const u of db.prepare('SELECT * FROM job_materials WHERE job_id=?').all(id))
      db.prepare('UPDATE materials SET on_hand=on_hand+? WHERE id=?').run(u.qty, u.material_id);
    db.prepare('DELETE FROM job_materials WHERE job_id=?').run(id);
    db.prepare('DELETE FROM activity WHERE job_id=?').run(id);
    db.prepare('DELETE FROM jobs WHERE id=?').run(id);
  });
  tx(req.params.id);
  res.json({ ok: true });
});

// ---------- materials ----------
app.get('/api/materials', (req, res) => res.json(db.prepare('SELECT * FROM materials ORDER BY category, name').all()));
app.post('/api/materials', (req, res) => {
  const b = req.body || {};
  const info = db.prepare('INSERT INTO materials (name,category,unit,on_hand,reorder_at,cost) VALUES (?,?,?,?,?,?)')
    .run(b.name, b.category || 'Vinyl', b.unit || 'sq ft', +b.on_hand || 0, +b.reorder_at || 0, +b.cost || 0);
  res.json(db.prepare('SELECT * FROM materials WHERE id=?').get(info.lastInsertRowid));
});
app.patch('/api/materials/:id', (req, res) => {
  const f = ['name', 'category', 'unit', 'on_hand', 'reorder_at', 'cost'].filter(k => k in (req.body || {}));
  if (f.length) db.prepare(`UPDATE materials SET ${f.map(k => k + '=?').join(',')} WHERE id=?`).run(...f.map(k => req.body[k]), req.params.id);
  res.json(db.prepare('SELECT * FROM materials WHERE id=?').get(req.params.id));
});
app.delete('/api/materials/:id', (req, res) => {
  const used = db.prepare('SELECT COUNT(*) c FROM job_materials WHERE material_id=?').get(req.params.id).c;
  if (used) return res.status(400).json({ error: 'This material is logged on jobs. Set stock to 0 instead.' });
  db.prepare('DELETE FROM materials WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});
// Log material used on a job (deducts stock).
app.post('/api/jobs/:id/materials', (req, res) => {
  const { material_id, qty } = req.body || {};
  const m = db.prepare('SELECT * FROM materials WHERE id=?').get(material_id);
  const q = parseFloat(qty);
  if (!m || !(q > 0)) return res.status(400).json({ error: 'Pick a material and a quantity' });
  db.transaction(() => {
    db.prepare('INSERT INTO job_materials (job_id,material_id,qty,used_by) VALUES (?,?,?,?)').run(req.params.id, m.id, q, req.who);
    db.prepare('UPDATE materials SET on_hand=on_hand-? WHERE id=?').run(q, m.id);
    db.prepare('INSERT INTO activity (job_id,who,text) VALUES (?,?,?)').run(req.params.id, req.who, `Used ${q} ${m.unit} of ${m.name}`);
  })();
  res.json({ ok: true });
});
app.delete('/api/job-materials/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM job_materials WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'not found' });
  db.transaction(() => {
    db.prepare('UPDATE materials SET on_hand=on_hand+? WHERE id=?').run(u.qty, u.material_id);
    db.prepare('DELETE FROM job_materials WHERE id=?').run(u.id);
  })();
  res.json({ ok: true });
});

// ---------- static UI ----------
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`Fly Visuals Shop Tool running on http://localhost:${PORT}`);
  if (APP_PASSWORD === 'changeme') console.log('WARNING: set APP_PASSWORD before going live.');
});
