/* mySleep API: passkey auth, per-user sync of nights and settings, Web Push for the bedtime
   reminder and the backup alarm. node:http, JSON files in DATA_DIR, no framework. */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { expiryReminder } from './reminders.js';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse
} from '@simplewebauthn/server';
import webpush from 'web-push';

const PORT = +(process.env.PORT || 3000);
const DATA = process.env.DATA_DIR || '/data';
const RP_ID = process.env.RP_ID || 'localhost';
const ORIGIN = process.env.ORIGIN || 'http://localhost:5173';
const RP_NAME = 'mySleep';
// A personal app: the first profile signs up, after that nobody unless this is set.
const ALLOW_SIGNUP = /^(1|true|yes)$/i.test(process.env.ALLOW_SIGNUP || '');
const SESSION_DAYS = 180;
const MAX_BODY = 4 * 1024 * 1024;
const SECURE = ORIGIN.startsWith('https:');
// Cookies are per host, not per port: myGym on the same Tailscale name has its own (gymsid).
const COOKIE = SECURE ? '__Host-sleepsid' : 'sleepsid';
const KINDS = new Set(['night', 'settings']);
const CLIP_DAYS = +(process.env.CLIP_DAYS || 7);
const MAX_CLIP = 2 * 1024 * 1024;

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
const db = readJSON(dbFile, { users: [], creds: [], subs: [] });
const saveDb = () => writeJSON(dbFile, db);
const stateFile = uid => path.join(DATA, 'state-' + uid.replace(/[^\w-]/g, '') + '.json');
const readState = uid => readJSON(stateFile(uid), { rev: 0, entries: {} });

// Sound clips of a night (docs/dev/SOUND_ANALYSIS.md): DATA_DIR/clips/<uid>/<night>_<id>.wav
const clipDir = uid => path.join(DATA, 'clips', uid.replace(/[^\w-]/g, ''));
const CLIP_PATH = /^\/api\/clips\/(\d{4}-\d{2}-\d{2})\/([\w-]{1,40})$/;
function dropClips(uid, night) {
  try { for (const f of fs.readdirSync(clipDir(uid))) if (f.startsWith(night + '_')) fs.rmSync(path.join(clipDir(uid), f), { force: true }); }
  catch (e) { if (e.code !== 'ENOENT') console.error('clips', e.message); }
}
function sweepClips() {
  const cutoff = Date.now() - CLIP_DAYS * 864e5;
  for (const u of db.users) {
    try { for (const f of fs.readdirSync(clipDir(u.id))) { const p = path.join(clipDir(u.id), f); if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true }); } }
    catch (e) { if (e.code !== 'ENOENT') console.error('clips', e.message); }
  }
}
// A night's flight recorder (frontend/src/lib/diag.js): events and, at the end, the raw readings.
// DATA_DIR/debug/<uid>/<night>.json, replaced on each upload, kept DEBUG_DAYS (30), and kept when
// the night itself is discarded: that is when it is most needed.
const DEBUG_DAYS = +(process.env.DEBUG_DAYS || 30);
const DEBUG_PATH = /^\/api\/debug\/(\d{4}-\d{2}-\d{2})$/;
const debugDir = uid => path.join(DATA, 'debug', uid.replace(/[^\w-]/g, ''));
const DEBUG_FILE = /^\d{4}-\d{2}-\d{2}\.json$/;
async function debugRoute(req, res, night) {
  // reading needs the session; mySleep Night uploads with its device token
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
    try { if (JSON.parse(fs.readFileSync(file, 'utf8')).final && body.start === JSON.parse(fs.readFileSync(file, 'utf8')).start) return json(res, 200, { ok: true, kept: 'final' }); } catch {}
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

async function clipRoute(req, res, night, id) {
  const user = needUser(req);
  const file = path.join(clipDir(user.id), `${night}_${id}.wav`);
  if (req.method === 'GET') {
    if (!fs.existsSync(file)) throw new HttpError(404, 'no such clip');
    res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'private, max-age=604800' });
    return fs.createReadStream(file).pipe(res);
  }
  if (req.method !== 'PUT') throw new HttpError(405, 'GET or PUT');
  const chunks = []; let size = 0;
  for await (const d of req) { size += d.length; if (size > MAX_CLIP) throw new HttpError(413, 'clip too large'); chunks.push(d); }
  const body = Buffer.concat(chunks);
  if (body.length < 44 || body.toString('latin1', 0, 4) !== 'RIFF' || body.toString('latin1', 8, 12) !== 'WAVE') throw new HttpError(400, 'not a WAV file');
  fs.mkdirSync(clipDir(user.id), { recursive: true });
  fs.writeFileSync(file, body, { mode: 0o600 });
  json(res, 200, { ok: true });
}

const secretFile = path.join(DATA, 'secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = fs.readFileSync(secretFile, 'utf8').trim();

const vapidFile = path.join(DATA, 'vapid.json');
const vapid = readJSON(vapidFile, null) || webpush.generateVAPIDKeys();
if (!fs.existsSync(vapidFile)) writeJSON(vapidFile, vapid);
webpush.setVapidDetails(SECURE ? ORIGIN : 'mailto:admin@localhost', vapid.publicKey, vapid.privateKey);

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

/* ---------- sessions ---------- */
const mac = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
const makeSession = user => { const p = user.id + ':' + (Date.now() + SESSION_DAYS * 864e5); return p + '.' + mac(p); };
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
const sessionCookie = user => `${COOKIE}=${makeSession(user)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${SECURE ? '; Secure' : ''}`;
const clearCookie = `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${SECURE ? '; Secure' : ''}`;

// State-changing requests must come from our own page. Sec-Fetch-Site is set by the browser and
// cannot be forged by a page; myGym on the same host reports 'same-site' and is refused.
function csrfOk(req) {
  if (req.method === 'GET') return true;
  const site = req.headers['sec-fetch-site'];
  if (site) return site === 'same-origin' || site === 'none';
  return !req.headers.origin || req.headers.origin === ORIGIN;
}

/* ---------- passkey challenges (in memory, 5 min) ---------- */
const challenges = new Map();
function putChallenge(data) {
  const cid = crypto.randomBytes(16).toString('base64url');
  challenges.set(cid, { ...data, exp: Date.now() + 5 * 60000 });
  return cid;
}
function takeChallenge(cid) {
  const c = challenges.get(cid);
  challenges.delete(cid);
  return c && c.exp > Date.now() ? c : null;
}
setInterval(() => { for (const [k, v] of challenges) if (v.exp < Date.now()) challenges.delete(k); }, 60000).unref();

/* ---------- push ---------- */
async function sendPush(userId, payload) {
  // tests: pushes written to a file instead of sent (web-push only speaks https)
  if (process.env.PUSH_LOG) { fs.appendFileSync(process.env.PUSH_LOG, JSON.stringify({ userId, payload }) + '\n'); return 1; }
  const subs = db.subs.filter(s => s.userId === userId);
  let dropped = false;
  for (const s of subs) {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: 600 }); }
    catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) { db.subs.splice(db.subs.indexOf(s), 1); dropped = true; }
      else console.error('push failed', e.statusCode || e.message);
    }
  }
  if (dropped) saveDb();
  return subs.length;
}

// Local wall-clock "HH:MM" and date in the user's own time zone.
function localNow(tz, now = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(now).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
}
const toMin = hhmm => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };

// ponytail: reads every user's state file each tick; fine for a household, cache it if that grows.
async function tick() {
  const now = Date.now();
  let changed = false;
  for (const user of db.users) {
    if (user.alarmAt && now >= user.alarmAt) {
      user.alarmAt = null; changed = true;
      await sendPush(user.id, { title: 'Wake up', body: 'mySleep stopped listening, so this is your backup alarm.', tag: 'alarm' });
    }
    const s = readState(user.id).entries['settings:main']?.data;
    // mySleep Night, signed with a free Apple ID, stops 7 days after it was installed
    for (const d of user.devices || []) {
      const r = expiryReminder(d, now, s?.tz);
      if (!r) continue;
      d.reminded = r.stage; changed = true;
      await sendPush(user.id, { title: r.title, body: r.body, tag: r.tag });
    }
    if (!s?.remind || !s.bedtime) continue;
    const { date, min } = localNow(s.tz);
    const at = (toMin(s.bedtime) - (s.remindMin ?? 30) + 1440) % 1440;
    if (min === at && user.remindedOn !== date) {
      user.remindedOn = date; changed = true;
      await sendPush(user.id, { title: 'Bedtime in ' + (s.remindMin ?? 30) + ' min', body: 'Lights out at ' + s.bedtime + '.', tag: 'bedtime' });
    }
  }
  if (changed) saveDb();
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
const publicUser = u => ({ id: u.id, name: u.name });
function needUser(req) { const u = readSession(req); if (!u) throw new HttpError(401, 'not signed in'); return u; }

/* ---------- devices: mySleep Night, the native app ----------
   It cannot use the passkey (a free Apple ID gives no associated domain), so the web app pairs it:
   POST /api/devices makes a token, shown once, kept here only as a hash. With it the app may only
   upload its nights' logs and say when it expires; it is not a session. One device per name. */
const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('base64url');
function deviceOf(req) {
  const m = (req.headers.authorization || '').match(/^Bearer ([\w-]{20,})$/);
  if (!m) return null;
  const h = hashToken(m[1]);
  for (const user of db.users) { const device = (user.devices || []).find(d => d.hash === h); if (device) return { user, device }; }
  return null;
}
function needDevice(req) { const d = deviceOf(req); if (!d) throw new HttpError(401, 'not a paired device'); d.device.lastSeen = Date.now(); return d; }
const publicDevice = d => ({ id: d.id, name: d.name, expires: d.expires, lastSeen: d.lastSeen, build: d.build });
const b64u = s => Buffer.from(s, 'base64url');

const routes = {
  'GET /api/health': (req, res) => json(res, 200, { ok: true }),

  'GET /api/me': (req, res) => {
    const u = readSession(req);
    json(res, u ? 200 : 401, u ? { user: publicUser(u), devices: (u.devices || []).map(publicDevice) } : { error: 'not signed in', signup: ALLOW_SIGNUP || !db.users.length });
  },

  'POST /api/devices': async (req, res) => {
    const user = needUser(req), body = await readBody(req);
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 40) : 'mySleep Night';
    const token = crypto.randomBytes(32).toString('base64url');
    const device = { id: crypto.randomBytes(8).toString('base64url'), name, hash: hashToken(token), created: Date.now(), lastSeen: null, expires: null, build: null, reminded: null };
    user.devices = [...(user.devices || []).filter(d => d.name !== name), device];
    saveDb();
    json(res, 200, { id: device.id, token });
  },

  'POST /api/devices/status': async (req, res) => {
    const { device } = needDevice(req), body = await readBody(req);
    if (body.expires !== null && !Number.isFinite(body.expires)) throw new HttpError(400, 'expires must be a time or null');
    if (body.expires !== device.expires) device.reminded = null;   // reinstalled: remind afresh
    device.expires = body.expires;
    device.build = typeof body.build === 'string' ? body.build.slice(0, 40) : null;
    saveDb();
    json(res, 200, { ok: true });
  },

  // the nights' logs (frontend/src/lib/diag.js, and mySleep Night's): the web app imports the app's
  'GET /api/debug': (req, res) => {
    const user = needUser(req);
    let files = [];
    try { files = fs.readdirSync(debugDir(user.id)).filter(f => DEBUG_FILE.test(f)); } catch {}
    json(res, 200, files.map(f => {
      const l = readJSON(path.join(debugDir(user.id), f), {});
      return { night: l.night, start: l.start, final: !!l.final, app: l.env?.app || 'web', uploadedAt: l.uploadedAt ?? l.receivedAt };
    }));
  },

  'POST /api/register/options': async (req, res) => {
    if (db.users.length && !ALLOW_SIGNUP) throw new HttpError(403, 'sign-up is closed on this server');
    const name = String((await readBody(req)).name || '').trim().slice(0, 40);
    if (!name) throw new HttpError(400, 'name required');
    const uid = crypto.randomBytes(12).toString('base64url');
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID: RP_ID, userID: Buffer.from(uid), userName: name, userDisplayName: name,
      attestationType: 'none', authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' }
    });
    json(res, 200, { cid: putChallenge({ kind: 'register', challenge: options.challenge, name, uid }), options });
  },

  'POST /api/register/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (c?.kind !== 'register') throw new HttpError(400, 'that took too long, try again');
    if (db.users.length && !ALLOW_SIGNUP) throw new HttpError(403, 'sign-up is closed on this server');
    let v;
    try {
      v = await verifyRegistrationResponse({ response: body.credential, expectedChallenge: c.challenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: false });
    } catch (e) { throw new HttpError(400, e.message); }
    if (!v.verified) throw new HttpError(400, 'passkey not verified');
    const { credential } = v.registrationInfo;
    const user = { id: c.uid, name: c.name, created: new Date().toISOString() };
    db.users.push(user);
    db.creds.push({ id: credential.id, userId: user.id, publicKey: Buffer.from(credential.publicKey).toString('base64url'), counter: credential.counter || 0, transports: body.credential?.response?.transports || [] });
    saveDb();
    json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/login/options': async (req, res) => {
    const options = await generateAuthenticationOptions({ rpID: RP_ID, userVerification: 'preferred', allowCredentials: [] });
    json(res, 200, { cid: putChallenge({ kind: 'login', challenge: options.challenge }), options });
  },

  'POST /api/login/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (c?.kind !== 'login') throw new HttpError(400, 'that took too long, try again');
    const cred = db.creds.find(x => x.id === body.credential?.id);
    if (!cred) throw new HttpError(404, 'this server does not know that passkey');
    let v;
    try {
      v = await verifyAuthenticationResponse({
        response: body.credential, expectedChallenge: c.challenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: false,
        credential: { id: cred.id, publicKey: b64u(cred.publicKey), counter: cred.counter, transports: cred.transports }
      });
    } catch (e) { throw new HttpError(400, e.message); }
    if (!v.verified) throw new HttpError(400, 'passkey not verified');
    cred.counter = v.authenticationInfo.newCounter;
    saveDb();
    const user = db.users.find(u => u.id === cred.userId);
    json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/logout': (req, res) => json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie }),

  // Push what changed, get back what this device has not seen. One round trip both ways.
  'POST /api/sync': async (req, res) => {
    const user = needUser(req);
    const body = await readBody(req);
    const changes = Array.isArray(body.changes) ? body.changes : [];
    if (changes.length > 1000 || !changes.every(validChange)) throw new HttpError(400, 'invalid changes');
    const since = Number.isFinite(body.since) ? body.since : 0;
    const state = readState(user.id);
    if (applyChanges(state, changes)) writeJSON(stateFile(user.id), state);
    for (const c of changes) if (c.kind === 'night' && c.deleted) dropClips(user.id, c.id);
    json(res, 200, { rev: state.rev, changes: changesSince(state, since) });
  },

  'GET /api/push/key': (req, res) => json(res, 200, { key: vapid.publicKey }),

  'POST /api/push/subscribe': async (req, res) => {
    const user = needUser(req);
    const sub = (await readBody(req)).subscription;
    // ponytail: https endpoint only, no private-address guard; the server is on a tailnet with one user.
    if (!sub || typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://') || !sub.keys?.p256dh || !sub.keys?.auth) throw new HttpError(400, 'invalid subscription');
    db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint);
    db.subs.push({ userId: user.id, endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
    saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/push/test': async (req, res) => {
    const user = needUser(req);
    json(res, 200, { sent: await sendPush(user.id, { title: 'mySleep', body: 'Notifications work.', tag: 'test' }) });
  },

  // The backup alarm: armed when tracking starts, cleared when the alarm is dismissed. If the
  // page died in the night nothing clears it, and the server pushes at `at`.
  'POST /api/alarm': async (req, res) => {
    const user = needUser(req);
    const at = (await readBody(req)).at;
    if (at !== null && !Number.isFinite(at)) throw new HttpError(400, 'at must be a time or null');
    user.alarmAt = at; saveDb();
    json(res, 200, { ok: true });
  }
};

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname, clip = pathname.match(CLIP_PATH);
  const dbg = pathname.match(DEBUG_PATH);
  const route = clip ? (rq, rs) => clipRoute(rq, rs, clip[1], clip[2]) : dbg ? (rq, rs) => debugRoute(rq, rs, dbg[1]) : routes[req.method + ' ' + pathname];
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
  server.listen(PORT, () => console.log(`mySleep API on :${PORT}, RP_ID=${RP_ID}, ORIGIN=${ORIGIN}`));
  setInterval(() => tick().catch(e => console.error('tick', e)), +(process.env.TICK_MS || 20000)).unref();
  sweepClips(); sweepDebug();
  setInterval(sweepDebug, 864e5).unref();
  setInterval(sweepClips, 3600e3).unref();
}
