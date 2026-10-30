/* mySleep API: what mySleep Night, the iPhone app, needs of a server: its nights and settings in a
   folder per profile (sync), its night logs, and the device token that pairs it. node:http, JSON
   files in DATA_DIR, no framework. A profile is made on the server (scripts/dev-session.mjs
   --create) and the app is paired by scripts/pair.mjs; there is no sign-in page. */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { cookieName } from './scripts/session.mjs';
import { appStatus } from './status.js';

const PORT = +(process.env.PORT || 3000);
const DATA = process.env.DATA_DIR || '/data';
const ORIGIN = process.env.ORIGIN || 'http://localhost:5173';
const MAX_BODY = 4 * 1024 * 1024;
const COOKIE = cookieName(ORIGIN);
const KINDS = new Set(['night', 'settings']);
// the app syncs after every night: a day and a half without a word is a night missed or an app that stopped
const APP_SILENT_HOURS = +(process.env.APP_SILENT_HOURS || 36);

fs.mkdirSync(DATA, { recursive: true });

/* ---------- files ---------- */
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
// Temp file then rename: a crash mid-write leaves the previous version whole.
function writeJSON(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
const dbFile = path.join(DATA, 'db.json');
const db = readJSON(dbFile, { users: [] });
const saveDb = () => writeJSON(dbFile, db);
// signs the operator's session cookie
const secretFile = path.join(DATA, 'secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = fs.readFileSync(secretFile, 'utf8').trim();
const stateFile = uid => path.join(DATA, 'state-' + uid.replace(/[^\w-]/g, '') + '.json');
const readState = uid => readJSON(stateFile(uid), { rev: 0, entries: {} });

// A night's flight recorder (mySleep Night's log, ios/NightKit Night.swift): events and, at the end,
// the raw readings.
// DATA_DIR/debug/<uid>/<night>.json, replaced on each upload, kept DEBUG_DAYS (30), and kept when
// the night itself is discarded: that is when it is most needed.
const DEBUG_DAYS = +(process.env.DEBUG_DAYS || 30);
const DEBUG_PATH = /^\/api\/debug\/(\d{4}-\d{2}-\d{2})$/;
const debugDir = uid => path.join(DATA, 'debug', uid.replace(/[^\w-]/g, ''));
const DEBUG_FILE = /^\d{4}-\d{2}-\d{2}\.json$/;
async function debugRoute(req, res, night) {
  // reading needs the session (the operator's); mySleep Night uploads with its device token
  const user = req.method === 'PUT' && !readSession(req) ? needDevice(req).user : needUser(req);
  const file = path.join(debugDir(user.id), night + '.json');
  if (req.method === 'GET') {
    if (!fs.existsSync(file)) throw new HttpError(404, 'no log for that night');
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return fs.createReadStream(file).pipe(res);
  }
  if (req.method !== 'PUT') throw new HttpError(405, 'GET or PUT');
  const chunks = []; let size = 0;
  for await (const d of req) { size += d.length; if (size > MAX_BODY) throw new HttpError(413, 'log too large'); chunks.push(d); }
  let raw = Buffer.concat(chunks);
  if (/gzip/i.test(req.headers['content-encoding'] || '')) {
    try { raw = zlib.gunzipSync(raw, { maxOutputLength: 64 * 1024 * 1024 }); } catch { throw new HttpError(400, 'bad gzip'); }
  }
  let body;
  try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'invalid JSON'); }
  if (!body || body.night !== night || !Array.isArray(body.events)) throw new HttpError(400, 'not a night log');
  // a periodic upload must not replace a finished log that already has the readings
  if (!body.final && fs.existsSync(file)) {
    let kept = null;
    try { kept = readJSON(file, null); } catch {}   // a broken file is simply replaced
    if (kept?.final && kept.start === body.start) return json(res, 200, { ok: true, kept: 'final' });
  }
  fs.mkdirSync(debugDir(user.id), { recursive: true });
  writeJSON(file, { ...body, receivedAt: Date.now() });
  json(res, 200, { ok: true });
}
function sweepDebug() {
  const cutoff = Date.now() - DEBUG_DAYS * 864e5;
  for (const u of db.users) {
    try { for (const f of fs.readdirSync(debugDir(u.id))) { const p = path.join(debugDir(u.id), f); if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true }); } }
    catch (e) { if (e.code !== 'ENOENT') console.error('debug', e.message); }
  }
}

/* ---------- sync ---------- */
// Every entry carries the client's edit time (ts) and the server's revision (rev). The newer ts
// wins per entry, so two devices editing different nights both keep their change; a client asks
// for everything with rev > since and gets only what it has not seen.
export function applyChanges(state, changes) {
  let applied = 0;
  for (const c of changes) {
    const key = c.kind + ':' + c.id;
    const cur = state.entries[key];
    if (cur && cur.ts >= c.ts) continue;
    state.rev++;
    state.entries[key] = { kind: c.kind, id: c.id, ts: c.ts, rev: state.rev, deleted: !!c.deleted, data: c.deleted ? null : c.data };
    applied++;
  }
  return applied;
}
export const changesSince = (state, since) => Object.values(state.entries).filter(e => e.rev > since);

function validChange(c) {
  return c && KINDS.has(c.kind) && typeof c.id === 'string' && c.id.length > 0 && c.id.length <= 64
    && Number.isFinite(c.ts) && (c.deleted === true || (c.data && typeof c.data === 'object' && !Array.isArray(c.data)));
}

/* ---------- the operator's session ----------
   Whoever runs the server (a script with DATA_DIR/secret, scripts/session.mjs) has a signed cookie
   for a profile: to pair the app and to read its logs with curl. The app itself uses its device token. */
const mac = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
function readSession(req) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  if (!m) return null;
  const tok = m[1], i = tok.lastIndexOf('.');
  if (i < 0) return null;
  const p = tok.slice(0, i), sig = Buffer.from(tok.slice(i + 1)), want = Buffer.from(mac(p));
  if (sig.length !== want.length || !crypto.timingSafeEqual(sig, want)) return null;
  const [uid, exp] = p.split(':');
  if (+exp < Date.now()) return null;
  return db.users.find(u => u.id === uid) || null;
}

// State-changing requests from a browser must come from our own page. Sec-Fetch-Site is set by the
// browser and cannot be forged by a page; the app sends none.
function csrfOk(req) {
  if (req.method === 'GET') return true;
  const site = req.headers['sec-fetch-site'];
  if (site) return site === 'same-origin' || site === 'none';
  return !req.headers.origin || req.headers.origin === ORIGIN;
}

/* ---------- http ---------- */
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
function json(res, code, obj, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
}
async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const d of req) { size += d.length; if (size > MAX_BODY) throw new HttpError(413, 'body too large'); chunks.push(d); }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}; } catch { throw new HttpError(400, 'invalid JSON'); }
}
function needUser(req) { const u = readSession(req); if (!u) throw new HttpError(401, 'not signed in'); return u; }

/* ---------- devices: mySleep Night, the native app ----------
   It pairs with a token (scripts/pair.mjs asks POST /api/devices for it): shown once, kept here only
   as a hash. With it the app may sync its nights and settings, upload its nights' logs and say when
   it expires; it is not a session. One device per name. */
const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('base64url');
function deviceOf(req) {
  const m = (req.headers.authorization || '').match(/^Bearer ([\w-]{20,})$/);
  if (!m) return null;
  const h = hashToken(m[1]);
  for (const user of db.users) { const device = (user.devices || []).find(d => d.hash === h); if (device) return { user, device }; }
  return null;
}
function needDevice(req) { const d = deviceOf(req); if (!d) throw new HttpError(401, 'not a paired device'); d.device.lastSeen = Date.now(); return d; }
// A session (the operator's) or a device token (the app): the profile a request is for.
function needUserOrDevice(req) { return readSession(req) || needDevice(req).user; }
const publicDevice = d => ({ id: d.id, name: d.name, expires: d.expires, lastSeen: d.lastSeen, build: d.build });

const routes = {
  'GET /api/health': (req, res) => json(res, 200, { ok: true }),

  // for an uptime monitor (no sign-in, nothing secret): the server answers, and is the app alive?
  'GET /api/health/app': (req, res) => {
    const r = appStatus(db.users, Date.now(), APP_SILENT_HOURS * 3600e3);
    json(res, r.ok ? 200 : 503, r);
  },

  'GET /api/devices': (req, res) => json(res, 200, (needUser(req).devices || []).map(publicDevice)),

  'POST /api/devices': async (req, res) => {
    const user = needUser(req), body = await readBody(req);
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 40) : 'mySleep Night';
    const token = crypto.randomBytes(32).toString('base64url');
    const device = { id: crypto.randomBytes(8).toString('base64url'), name, hash: hashToken(token), created: Date.now(), lastSeen: null, expires: null, build: null };
    user.devices = [...(user.devices || []).filter(d => d.name !== name), device];
    saveDb();
    json(res, 200, { id: device.id, token });
  },

  'POST /api/devices/status': async (req, res) => {
    const { device } = needDevice(req), body = await readBody(req);
    if (body.expires !== null && !Number.isFinite(body.expires)) throw new HttpError(400, 'expires must be a time or null');
    device.expires = body.expires;
    device.build = typeof body.build === 'string' ? body.build.slice(0, 40) : null;
    saveDb();
    json(res, 200, { ok: true });
  },

  // the nights' logs mySleep Night uploaded
  'GET /api/debug': (req, res) => {
    const user = needUser(req);
    let files = [];
    try { files = fs.readdirSync(debugDir(user.id)).filter(f => DEBUG_FILE.test(f)); } catch {}
    json(res, 200, files.map(f => {
      const l = readJSON(path.join(debugDir(user.id), f), {});
      return { night: l.night, start: l.start, final: !!l.final, app: l.env?.app || 'web', uploadedAt: l.uploadedAt ?? l.receivedAt };
    }));
  },

  // Push what changed, get back what this device has not seen. One round trip both ways.
  'POST /api/sync': async (req, res) => {
    const user = needUserOrDevice(req);
    const body = await readBody(req);
    const changes = Array.isArray(body.changes) ? body.changes : [];
    if (changes.length > 1000 || !changes.every(validChange)) throw new HttpError(400, 'invalid changes');
    const since = Number.isFinite(body.since) ? body.since : 0;
    const state = readState(user.id);
    if (applyChanges(state, changes)) writeJSON(stateFile(user.id), state);
    json(res, 200, { rev: state.rev, changes: changesSince(state, since) });
  }
};

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname, dbg = pathname.match(DEBUG_PATH);
  const route = dbg ? (rq, rs) => debugRoute(rq, rs, dbg[1]) : routes[req.method + ' ' + pathname];
  try {
    if (!route) throw new HttpError(404, 'not found');
    if (!csrfOk(req)) throw new HttpError(403, 'cross-origin request refused');
    await route(req, res);
  } catch (e) {
    if (!e.status) console.error(e);
    if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : 'server error' });
  }
});

if (process.argv[1] === new URL(import.meta.url).pathname) {
  server.listen(PORT, () => console.log(`mySleep API on :${PORT}, ORIGIN=${ORIGIN}`));
  sweepDebug();
  setInterval(sweepDebug, 864e5).unref();
  // docker stop: finish what is running, then leave with 0
  process.on('SIGTERM', () => { server.close(() => process.exit(0)); server.closeIdleConnections(); });
}
