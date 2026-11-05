// Gupta Cyber Cafe print agent - runs on the shop laptop next to the printers.
// It reports the laptop's printers to the website, downloads jobs queued there and prints them.
// Needs Node 18+. Settings come from environment variables (see start-agent.bat).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const SERVER = (process.env.SERVER_URL || 'https://gupta-cyber-cafe.onrender.com').replace(/\/+$/, '');
const TOKEN = process.env.AGENT_TOKEN || '';
const POLL_MS = 5000;
if (!TOKEN) { console.error('AGENT_TOKEN is not set. Edit start-agent.bat and put your token in it.'); process.exit(1); }

const headers = { Authorization: 'Bearer ' + TOKEN };
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

async function call(method, url, body) {
  const r = await fetch(SERVER + url, {
    method,
    headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000)
  });
  if (r.status === 401) throw new Error('Server rejected the token (AGENT_TOKEN does not match the one on Render)');
  if (!r.ok) throw new Error(`${method} ${url} -> HTTP ${r.status}`);
  return r;
}

function listPrinters() {
  return new Promise(resolve => {
    if (process.platform === 'win32') {
      execFile('powershell', ['-NoProfile', '-Command', 'Get-Printer | Select-Object -ExpandProperty Name'], (e, out) =>
        resolve(e ? [] : out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)));
    } else {
      execFile('lpstat', ['-e'], (e, out) => resolve(e ? [] : out.split('\n').map(s => s.trim()).filter(Boolean)));
    }
  });
}

async function printFile(file, printer, copies) {
  if (process.platform === 'win32') {
    const { print } = require('pdf-to-printer');
    await print(file, { printer, copies });
  } else {
    await new Promise((res, rej) => execFile('lp', ['-d', printer, '-n', String(copies), file], (e, o, se) => e ? rej(new Error(se || e.message)) : res()));
  }
}

async function handle(job) {
  log(`Job ${job.id}: ${job.mode} x${job.copies} -> "${job.printer}"`);
  const tmp = path.join(os.tmpdir(), `gcc-${job.id}-${Date.now()}.pdf`);
  try {
    if (!job.enabled) throw new Error('This printer type is turned off in Admin');
    if (!job.printer) throw new Error('No printer selected in Admin > Printers');
    const r = await call('GET', `/api/agent/jobs/${job.id}/file`);
    fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
    await printFile(tmp, job.printer, job.copies);
    await call('POST', `/api/agent/jobs/${job.id}/result`, { ok: true });
    log(`Job ${job.id}: printed`);
  } catch (e) {
    log(`Job ${job.id}: FAILED - ${e.message}`);
    try { await call('POST', `/api/agent/jobs/${job.id}/result`, { ok: false, error: e.message }); } catch {}
  } finally {
    fs.unlink(tmp, () => {});
  }
}

let lastPrinters = '', lastBeat = 0, busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const now = Date.now();
    if (now - lastBeat > 15000) {
      const printers = await listPrinters();
      await call('POST', '/api/agent/heartbeat', { printers });
      lastBeat = now;
      const key = printers.join('|');
      if (key !== lastPrinters) { lastPrinters = key; log('Printers found: ' + (printers.join(', ') || '(none)')); }
    }
    const jobs = await (await call('GET', '/api/agent/jobs')).json();
    for (const j of jobs) await handle(j);
  } catch (e) {
    log('Problem: ' + e.message + ' (will retry)');
  } finally { busy = false; }
}

log(`Print agent started. Server: ${SERVER}`);
tick();
setInterval(tick, POLL_MS);
