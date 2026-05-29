/**
 * Mainframe Research — Express Server
 *
 * Serves static files from /public and provides a POST /api/submit
 * endpoint for MOMCI 2026 survey submissions.
 *
 * Storage: GoDaddy Hosted Database (MySQL). DB_HOST, DB_PORT, DB_USER,
 * DB_PASSWORD, and DB_NAME are injected automatically by GoDaddy when
 * a Hosted Database is attached to this app — no manual config needed.
 * Falls back to local data/submissions.json if DB vars are not present.
 */

'use strict';

const express  = require('express');
const cors     = require('cors');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');

// --- Optional: load .env if present ---
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .forEach(line => {
      const [k, ...rest] = line.split('=');
      if (k && rest.length) process.env[k.trim()] = rest.join('=').trim();
    });
}

const app      = express();
const PORT     = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'submissions.json');

// --- Ensure local fallback store exists ---
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, '[]');
}

// --- MySQL config (GoDaddy Hosted Database injects all five vars automatically) ---
const DB_CONFIG = process.env.DB_HOST ? {
  host:     process.env.DB_HOST,
  port:     Number(process.env.DB_PORT || '3306'),
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
} : null;

if (DB_CONFIG) {
  console.log(`[DB] GoDaddy Hosted Database configured — ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`);
} else {
  console.log('[DB] DB_HOST not set — using local data/submissions.json');
}

// Helper: open a short-lived connection, run fn(conn), always close after.
// Per GoDaddy's guidance: prefer per-request connections, close in finally.
async function withDB(fn) {
  if (!DB_CONFIG) return null;
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection(DB_CONFIG);
  try {
    return await fn(conn);
  } finally {
    await conn.end();
  }
}

// Ensure table exists on startup
if (DB_CONFIG) {
  withDB(conn => conn.execute(`
    CREATE TABLE IF NOT EXISTS momci_responses (
      id                  VARCHAR(36)   NOT NULL PRIMARY KEY,
      received_at         DATETIME      NOT NULL,
      seniority           VARCHAR(200),
      role                VARCHAR(200),
      team_arch           VARCHAR(200),
      superpowers         TEXT,
      toil_reactive       VARCHAR(10),
      toil_proactive      VARCHAR(10),
      manual_intervention VARCHAR(200),
      oncall              VARCHAR(200),
      shadow_oncall       VARCHAR(200),
      sustainability      VARCHAR(10),
      automation          VARCHAR(200),
      error_culture       VARCHAR(200),
      narrative_goal      TEXT,
      INDEX idx_received  (received_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `))
  .then(() => console.log('[DB] momci_responses table ready'))
  .catch(err => console.error('[DB] Table init failed:', err.message));
}

// --- Middleware ---
app.use(cors());
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- POST /api/submit — MOMCI 2026 survey ---
app.post('/api/submit', async (req, res) => {
  const body = req.body;

  if (!body.role || !body.seniority) {
    return res.status(400).json({ ok: false, error: 'Missing required fields.' });
  }

  const record = {
    id:          crypto.randomUUID(),
    received_at: new Date().toISOString().slice(0, 19).replace('T', ' '), // MySQL DATETIME format

    // Section 1 — Technical Identity
    seniority:       sanitize(body.seniority),
    role:            sanitize(body.role),
    team_arch:       sanitize(body.team_arch),
    superpowers:     sanitize(body.superpowers, 2000),

    // Section 2 — Operational Workflow
    toil_reactive:       sanitize(body.toil_reactive),
    toil_proactive:      sanitize(body.toil_proactive),
    manual_intervention: sanitize(body.manual_intervention),

    // Section 3 — Logistics & Sustainability
    oncall:         sanitize(body.oncall),
    shadow_oncall:  sanitize(body.shadow_oncall),
    sustainability: sanitize(body.sustainability),

    // Section 4 — Innovation Culture
    automation:    sanitize(body.automation),
    error_culture: sanitize(body.error_culture),

    // Section 5 — Narrative
    narrative_goal: sanitize(body.narrative_goal, 5000),
  };

  try {
    if (DB_CONFIG) {
      // --- Store in GoDaddy Hosted Database (short-lived connection) ---
      await withDB(conn => conn.execute(
        `INSERT INTO momci_responses
          (id, received_at, seniority, role, team_arch, superpowers,
           toil_reactive, toil_proactive, manual_intervention,
           oncall, shadow_oncall, sustainability,
           automation, error_culture, narrative_goal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,            record.received_at,
          record.seniority,     record.role,          record.team_arch,  record.superpowers,
          record.toil_reactive, record.toil_proactive, record.manual_intervention,
          record.oncall,        record.shadow_oncall,  record.sustainability,
          record.automation,    record.error_culture,  record.narrative_goal,
        ]
      ));
      console.log(`[MOMCI] Stored in DB — id: ${record.id}`);
    } else {
      // --- Fallback: save locally ---
      const existing = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      existing.push(record);
      fs.writeFileSync(DATA_FILE, JSON.stringify(existing, null, 2));
      console.log(`[MOMCI] Stored locally — id: ${record.id}`);
    }
  } catch (err) {
    console.error('[MOMCI] Storage error:', err.message);
    return res.status(500).json({ ok: false, error: 'Storage error. Please try again.' });
  }

  sendEmailNotification(record).catch(err =>
    console.warn('[MOMCI] Email skipped:', err.message)
  );

  return res.json({ ok: true, id: record.id });
});

// --- GET /api/submissions — password-protected export ---
app.get('/api/submissions', async (req, res) => {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) return res.status(403).json({ error: 'Admin access not configured.' });

  const provided = req.headers['x-admin-key'] || req.query.key;
  if (provided !== adminKey) return res.status(403).json({ error: 'Forbidden.' });

  try {
    if (DB_CONFIG) {
      const rows = await withDB(conn =>
        conn.execute('SELECT * FROM momci_responses ORDER BY received_at DESC')
          .then(([r]) => r)
      );
      res.json(rows);
    } else {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      res.setHeader('Content-Type', 'application/json');
      res.send(data);
    }
  } catch (err) {
    console.error('[MOMCI] Export error:', err.message);
    res.status(500).json({ error: 'Could not read submissions.' });
  }
});

// --- Catch-all: serve index.html ---
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Start ---
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Mainframe Research server running on port ${PORT}`);
});

// ============================================================
// Helpers
// ============================================================

function sanitize(val, maxLen = 200) {
  if (val === undefined || val === null) return '';
  return String(val).replace(/\0/g, '').slice(0, maxLen).trim();
}

async function sendEmailNotification(record) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const to   = process.env.NOTIFY_EMAIL;

  if (!host || !user || !pass || !to) return;

  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: `"Mainframe Research" <${user}>`,
    to,
    subject: `New MOMCI 2026 Submission — ${record.id.slice(0, 8)}`,
    text: [
      `New MOMCI 2026 submission received.`,
      ``,
      `ID:          ${record.id}`,
      `Received:    ${record.received_at}`,
      `Role:        ${record.role}`,
      `Seniority:   ${record.seniority}`,
      `Team Arch:   ${record.team_arch}`,
      `Reactive:    ${record.toil_reactive}%`,
      `Proactive:   ${record.toil_proactive}%`,
      `On-Call:     ${record.oncall}`,
      `Shadow OC:   ${record.shadow_oncall}`,
      `Sustain:     ${record.sustainability}/5`,
      `Automation:  ${record.automation}`,
      `Error Cx:    ${record.error_culture}`,
      ``,
      `--- Superpowers ---`,
      record.superpowers,
      ``,
      `--- Narrative Goal ---`,
      record.narrative_goal,
    ].join('\n'),
  });
}
