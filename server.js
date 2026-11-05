// Gupta Cyber Cafe - website + online tools + auto-print queue + admin panel
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { PDFDocument } = require('pdf-lib');

const PORT = process.env.PORT || 3000;
const STORAGE = process.env.STORAGE_DIR || __dirname; // on Render: point to a persistent disk, e.g. /var/data
const DATA = path.join(STORAGE, 'data');
const UPLOADS = path.join(STORAGE, 'uploads');
const SETTINGS_FILE = path.join(DATA, 'settings.json');
const JOBS_FILE = path.join(DATA, 'jobs.json');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });

const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const DEFAULTS = () => {
  const salt = crypto.randomBytes(8).toString('hex');
  return {
    adminSalt: salt,
    adminHash: hash('admin123', salt), // change after first login
    autoPrint: false,
    acceptingJobs: true,
    pricePerPage: { color: 10, bw: 2 },
    printers: {
      color: { enabled: true, name: '' },
      bw: { enabled: true, name: '' }
    }
  };
};
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJSON = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));

let settings = readJSON(SETTINGS_FILE, null);
if (!settings) { settings = DEFAULTS(); writeJSON(SETTINGS_FILE, settings); }
let jobs = readJSON(JOBS_FILE, []);
const saveJobs = () => writeJSON(JOBS_FILE, jobs);
const saveSettings = () => writeJSON(SETTINGS_FILE, settings);
// Hosted mode: admin is reachable remotely, so a strong password must come from the environment.
if (process.env.ALLOW_REMOTE_ADMIN) {
  const pw = process.env.ADMIN_PASSWORD || '';
  if (pw.length < 8) { console.error('ALLOW_REMOTE_ADMIN is set, so ADMIN_PASSWORD (8+ characters) is required.'); process.exit(1); }
  settings.adminSalt = crypto.randomBytes(8).toString('hex');
  settings.adminHash = hash(pw, settings.adminSalt);
  saveSettings();
}

// ---------- sessions ----------
const sessions = new Map(); // token -> expiry
const parseCookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=').map(decodeURIComponent)).filter(a => a[0]));
function requireAdmin(req, res, next) {
  const t = parseCookies(req).ee_admin;
  const exp = t && sessions.get(t);
  if (exp && exp > Date.now()) return next();
  res.status(401).json({ error: 'Login required' });
}
const loginFails = new Map();

// ---------- print agent (hosted mode) ----------
// On Render there are no printers. A small agent on the shop laptop (agent/ folder) polls this server,
// reports its printers, downloads queued jobs and prints them. Enabled when AGENT_TOKEN is set.
const AGENT_TOKEN = process.env.AGENT_TOKEN || '';
const AGENT_MODE = !!AGENT_TOKEN;
let agentPrinters = [];
let agentLastSeen = 0;
const agentOnline = () => Date.now() - agentLastSeen < 30000;
function requireAgent(req, res, next) {
  const given = String((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  const a = Buffer.from(given), b = Buffer.from(AGENT_TOKEN);
  if (AGENT_MODE && a.length === b.length && crypto.timingSafeEqual(a, b)) { agentLastSeen = Date.now(); return next(); }
  res.status(401).json({ error: 'Bad agent token' });
}

// ---------- printing ----------
function listSystemPrinters() {
  if (AGENT_MODE) return Promise.resolve(agentPrinters);
  return new Promise(resolve => {
    if (process.platform === 'win32') {
      execFile('powershell', ['-NoProfile', '-Command', 'Get-Printer | Select-Object -ExpandProperty Name'], (e, out) =>
        resolve(e ? [] : out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)));
    } else {
      execFile('lpstat', ['-e'], (e, out) => resolve(e ? [] : out.split('\n').map(s => s.trim()).filter(Boolean)));
    }
  });
}

async function printJob(job) {
  const cfg = settings.printers[job.mode];
  if (!cfg || !cfg.enabled) throw new Error(`${job.mode === 'color' ? 'Colour' : 'Black & White'} printer is disabled`);
  if (!cfg.name) throw new Error(`No printer selected for ${job.mode === 'color' ? 'Colour' : 'Black & White'} in Admin > Printers`);
  const file = path.join(UPLOADS, job.stored);
  if (!fs.existsSync(file)) throw new Error('File missing on disk');
  if (AGENT_MODE) return; // handled by the agent: job stays 'printing' until the agent reports back
  if (process.platform === 'win32') {
    let pdfToPrinter;
    try { pdfToPrinter = require('pdf-to-printer'); } catch { throw new Error('Run "npm install" again (pdf-to-printer missing)'); }
    await pdfToPrinter.print(file, { printer: cfg.name, copies: job.copies });
  } else {
    await new Promise((res, rej) => execFile('lp', ['-d', cfg.name, '-n', String(job.copies), file], (e, o, se) => e ? rej(new Error(se || e.message)) : res()));
  }
}

async function runPrint(job) {
  job.status = 'printing'; job.error = ''; saveJobs();
  try {
    await printJob(job);
    if (AGENT_MODE) { job.claimedAt = 0; saveJobs(); return job; } // waits for the agent
    job.status = 'printed'; job.printedAt = new Date().toISOString(); job.printCount = (job.printCount || 0) + 1;
  } catch (e) {
    job.status = 'failed'; job.error = e.message;
  }
  saveJobs();
  return job;
}

// ---------- app ----------
const app = express();
app.set('trust proxy', 1); // behind Render's proxy: correct client IP for login rate-limit
app.use(express.json({ limit: '1mb' }));

// Admin is only reachable from the shop laptop itself (http://localhost:3000/admin.html).
// Requests coming through a tunnel (Cloudflare/ngrok add forwarding headers) are blocked.
// Set ALLOW_REMOTE_ADMIN=1 to turn this off (not recommended).
const isLocalRequest = req => {
  const viaProxy = ['cf-connecting-ip', 'x-forwarded-for', 'x-forwarded-host', 'cf-ray', 'x-real-ip'].some(h => req.headers[h]);
  const ip = req.socket.remoteAddress || '';
  return !viaProxy && (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1');
};
app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  const adminPath = p.startsWith('/api/admin') || p === '/admin.html' || p === '/admin.js';
  if (adminPath && !process.env.ALLOW_REMOTE_ADMIN && !isLocalRequest(req)) return res.status(404).send('Not found');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

const ALLOWED = ['.pdf', '.jpg', '.jpeg', '.png'];
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS,
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 30 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED.includes(path.extname(file.originalname).toLowerCase()))
});

// public: settings visible to customers
app.get('/healthz', (req, res) => res.send('ok'));
app.get('/api/public-info', (req, res) => res.json({
  accepting: settings.acceptingJobs,
  colorAvailable: settings.printers.color.enabled,
  bwAvailable: settings.printers.bw.enabled,
  pricePerPage: settings.pricePerPage
}));

// public: send a file to print
app.post('/api/print-upload', (req, res, next) => {
  if (!settings.acceptingJobs) return res.status(503).json({ error: 'Printing is currently closed.' });
  next();
}, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Upload a PDF, JPG or PNG file (max 30 MB).' });
    const mode = req.body.mode === 'color' ? 'color' : 'bw';
    if (!settings.printers[mode].enabled) { fs.unlink(req.file.path, () => {}); return res.status(400).json({ error: 'That print type is not available right now.' }); }
    const copies = Math.min(Math.max(parseInt(req.body.copies) || 1, 1), 100);
    const ext = path.extname(req.file.filename);
    let stored = req.file.filename, pages = 1;
    const bytes = fs.readFileSync(req.file.path);
    if (ext === '.pdf') {
      try { pages = (await PDFDocument.load(bytes, { ignoreEncryption: false })).getPageCount(); }
      catch { fs.unlink(req.file.path, () => {}); return res.status(400).json({ error: 'This PDF is damaged or password-protected.' }); }
    } else {
      // wrap image in an A4 PDF
      const pdf = await PDFDocument.create();
      const img = ext === '.png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      const W = 595.28, H = 841.89, M = 28;
      const page = pdf.addPage([W, H]);
      const s = Math.min((W - 2 * M) / img.width, (H - 2 * M) / img.height);
      page.drawImage(img, { x: (W - img.width * s) / 2, y: (H - img.height * s) / 2, width: img.width * s, height: img.height * s });
      stored = crypto.randomUUID() + '.pdf';
      fs.writeFileSync(path.join(UPLOADS, stored), await pdf.save());
      fs.unlink(req.file.path, () => {});
    }
    const rate = settings.pricePerPage[mode];
    const job = {
      id: crypto.randomUUID().slice(0, 8).toUpperCase(),
      name: String(req.body.name || '').slice(0, 60),
      phone: String(req.body.phone || '').replace(/[^\d+]/g, '').slice(0, 15),
      original: req.file.originalname.slice(0, 120),
      stored, mode, copies, pages,
      amount: rate * pages * copies,
      status: 'queued', error: '', createdAt: new Date().toISOString(), printCount: 0
    };
    jobs.unshift(job); jobs = jobs.slice(0, 2000); saveJobs();
    if (settings.autoPrint) runPrint(job); // fire and forget
    res.json({ ok: true, id: job.id, pages, amount: job.amount, autoPrint: settings.autoPrint });
  } catch (e) {
    res.status(500).json({ error: 'Could not process file: ' + e.message });
  }
});

// public: check status of a job by its ID
app.get('/api/job/:id', (req, res) => {
  const j = jobs.find(x => x.id === req.params.id.toUpperCase());
  if (!j) return res.status(404).json({ error: 'No such job' });
  res.json({ id: j.id, status: j.status, pages: j.pages, amount: j.amount, mode: j.mode });
});

// ---------- admin ----------
app.post('/api/admin/login', (req, res) => {
  const ip = req.ip;
  const f = loginFails.get(ip) || { n: 0, until: 0 };
  if (f.until > Date.now()) return res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
  const ok = crypto.timingSafeEqual(Buffer.from(hash(String(req.body.password || ''), settings.adminSalt)), Buffer.from(settings.adminHash));
  if (!ok) {
    f.n++; if (f.n >= 5) { f.until = Date.now() + 60000; f.n = 0; }
    loginFails.set(ip, f);
    return res.status(401).json({ error: 'Wrong password' });
  }
  loginFails.delete(ip);
  const t = crypto.randomBytes(24).toString('hex');
  sessions.set(t, Date.now() + 12 * 3600 * 1000);
  res.setHeader('Set-Cookie', `ee_admin=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${12 * 3600}${process.env.RENDER ? '; Secure' : ''}`);
  res.json({ ok: true, defaultPassword: ok && hash('admin123', settings.adminSalt) === settings.adminHash });
});
app.post('/api/admin/logout', requireAdmin, (req, res) => {
  sessions.delete(parseCookies(req).ee_admin);
  res.setHeader('Set-Cookie', 'ee_admin=; Max-Age=0; Path=/');
  res.json({ ok: true });
});
app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ ok: true, defaultPassword: hash('admin123', settings.adminSalt) === settings.adminHash }));

app.get('/api/admin/state', requireAdmin, async (req, res) => {
  const today = new Date().toDateString();
  const todays = jobs.filter(j => new Date(j.createdAt).toDateString() === today);
  res.json({
    settings: { autoPrint: settings.autoPrint, acceptingJobs: settings.acceptingJobs, pricePerPage: settings.pricePerPage, printers: settings.printers },
    systemPrinters: await listSystemPrinters(),
    jobs: jobs.slice(0, 300),
    stats: {
      today: todays.length,
      queued: jobs.filter(j => j.status === 'queued').length,
      failed: jobs.filter(j => j.status === 'failed').length,
      todayPages: todays.reduce((a, j) => a + j.pages * j.copies, 0),
      todayAmount: todays.filter(j => j.status === 'printed').reduce((a, j) => a + j.amount, 0)
    }
  });
});

app.post('/api/admin/settings', requireAdmin, (req, res) => {
  const b = req.body || {};
  if (typeof b.autoPrint === 'boolean') settings.autoPrint = b.autoPrint;
  if (typeof b.acceptingJobs === 'boolean') settings.acceptingJobs = b.acceptingJobs;
  for (const k of ['color', 'bw']) {
    if (b.printers && b.printers[k]) {
      if (typeof b.printers[k].enabled === 'boolean') settings.printers[k].enabled = b.printers[k].enabled;
      if (typeof b.printers[k].name === 'string') settings.printers[k].name = b.printers[k].name.slice(0, 200);
    }
    if (b.pricePerPage && Number.isFinite(+b.pricePerPage[k]) && +b.pricePerPage[k] >= 0) settings.pricePerPage[k] = +b.pricePerPage[k];
  }
  saveSettings();
  res.json({ ok: true });
});

app.post('/api/admin/password', requireAdmin, (req, res) => {
  const p = String(req.body.password || '');
  if (p.length < 6) return res.status(400).json({ error: 'Use at least 6 characters' });
  settings.adminSalt = crypto.randomBytes(8).toString('hex');
  settings.adminHash = hash(p, settings.adminSalt);
  saveSettings();
  res.json({ ok: true });
});

app.post('/api/admin/jobs/:id/print', requireAdmin, async (req, res) => {
  const j = jobs.find(x => x.id === req.params.id);
  if (!j) return res.status(404).json({ error: 'No such job' });
  await runPrint(j);
  res.json({ ok: j.status === 'printed', status: j.status, error: j.error });
});
app.post('/api/admin/print-all', requireAdmin, async (req, res) => {
  const pending = jobs.filter(j => j.status === 'queued' || j.status === 'failed').reverse();
  for (const j of pending) await runPrint(j);
  res.json({ ok: true, count: pending.length });
});
app.post('/api/admin/test/:mode', requireAdmin, async (req, res) => {
  const mode = req.params.mode === 'color' ? 'color' : 'bw';
  try {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    page.drawText(`Gupta Cyber Cafe - ${mode === 'color' ? 'COLOUR' : 'BLACK & WHITE'} printer test`, { x: 60, y: 760, size: 18 });
    if (mode === 'color') {
      const { rgb } = require('pdf-lib');
      [[1, 0, 0], [0, 0.6, 0], [0, 0, 1]].forEach((c, i) => page.drawRectangle({ x: 60 + i * 130, y: 600, width: 110, height: 110, color: rgb(...c) }));
    }
    const stored = 'test-' + mode + '-' + crypto.randomBytes(3).toString('hex') + '.pdf';
    fs.writeFileSync(path.join(UPLOADS, stored), await pdf.save());
    if (AGENT_MODE) {
      const cfg = settings.printers[mode];
      if (!cfg.enabled || !cfg.name) throw new Error('Choose and save a printer first');
      if (!agentOnline()) throw new Error('Print agent is offline - start it on the shop laptop');
      const tj = { id: 'TEST' + crypto.randomBytes(2).toString('hex').toUpperCase(), name: 'Printer test', phone: '', original: 'printer-test.pdf', stored, mode, copies: 1, pages: 1, amount: 0, status: 'queued', error: '', createdAt: new Date().toISOString(), printCount: 0 };
      jobs.unshift(tj); await runPrint(tj);
      return res.json({ ok: true });
    }
    await printJob({ mode, copies: 1, stored });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/admin/jobs/:id/file', requireAdmin, (req, res) => {
  const j = jobs.find(x => x.id === req.params.id);
  if (!j) return res.status(404).end();
  res.download(path.join(UPLOADS, j.stored), j.original.replace(/\.[^.]+$/, '') + '.pdf');
});
app.delete('/api/admin/jobs/:id', requireAdmin, (req, res) => {
  const i = jobs.findIndex(x => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'No such job' });
  fs.unlink(path.join(UPLOADS, jobs[i].stored), () => {});
  jobs.splice(i, 1); saveJobs();
  res.json({ ok: true });
});

// ---------- agent API ----------
app.post('/api/agent/heartbeat', requireAgent, (req, res) => {
  const list = Array.isArray(req.body && req.body.printers) ? req.body.printers.map(x => String(x).slice(0, 200)).slice(0, 100) : [];
  agentPrinters = list;
  res.json({ ok: true });
});
app.get('/api/agent/jobs', requireAgent, (req, res) => {
  const now = Date.now();
  const todo = jobs.filter(j => j.status === 'printing' && (!j.claimedAt || now - j.claimedAt > 3 * 60000));
  todo.forEach(j => { j.claimedAt = now; });
  if (todo.length) saveJobs();
  res.json(todo.map(j => ({ id: j.id, mode: j.mode, copies: j.copies, printer: (settings.printers[j.mode] || {}).name || '', enabled: !!(settings.printers[j.mode] || {}).enabled })));
});
app.get('/api/agent/jobs/:id/file', requireAgent, (req, res) => {
  const j = jobs.find(x => x.id === req.params.id);
  if (!j) return res.status(404).end();
  res.sendFile(path.join(UPLOADS, j.stored));
});
app.post('/api/agent/jobs/:id/result', requireAgent, (req, res) => {
  const j = jobs.find(x => x.id === req.params.id);
  if (!j) return res.status(404).json({ error: 'No such job' });
  if (req.body && req.body.ok) { j.status = 'printed'; j.error = ''; j.printedAt = new Date().toISOString(); j.printCount = (j.printCount || 0) + 1; }
  else { j.status = 'failed'; j.error = String((req.body && req.body.error) || 'Print failed').slice(0, 300); }
  saveJobs();
  res.json({ ok: true });
});

// auto-delete printed files older than 3 days (privacy: Aadhaar/PAN copies etc.)
setInterval(() => {
  const cutoff = Date.now() - 3 * 24 * 3600 * 1000;
  jobs = jobs.filter(j => {
    if (new Date(j.createdAt).getTime() < cutoff && j.status === 'printed') { fs.unlink(path.join(UPLOADS, j.stored), () => {}); return false; }
    return true;
  });
  saveJobs();
}, 3600 * 1000);

app.use((err, req, res, next) => res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 30 MB)' : err.message }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\nGupta Cyber Cafe running:\n  Website : http://localhost:${PORT}\n  Admin   : http://localhost:${PORT}/admin.html  (default password: admin123 - change it!)\n`);
});
