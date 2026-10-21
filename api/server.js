/* mySleep API: passkey auth, per-user sync of nights and settings, Web Push for the bedtime
   reminder and the backup alarm. node:http, JSON files in DATA_DIR, no framework. */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
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
const b64u = s => Buffer.from(s, 'base64url');

const routes = {
  'GET /api/health': (req, res) => json(res, 200, { ok: true }),

  'GET /api/me': (req, res) => {
    const u = readSession(req);
    json(res, u ? 200 : 401, u ? { user: publicUser(u) } : { error: 'not signed in', signup: ALLOW_SIGNUP || !db.users.length });
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
  const route = routes[req.method + ' ' + new URL(req.url, 'http://x').pathname];
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
  setInterval(() => tick().catch(e => console.error('tick', e)), 20000).unref();
}
