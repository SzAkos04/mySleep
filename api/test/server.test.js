import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = path.dirname(new URL(import.meta.url).pathname);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mysleep-test-'));
const PORT = 20000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${PORT}`;
let proc, cookie, otherCookie;

// Registered at the top level, not inside before (node:test).
after(() => { proc?.kill(); fs.rmSync(DATA, { recursive: true, force: true }); });

before(async () => {
  cookie = execFileSync('node', [path.join(dir, '../scripts/dev-session.mjs'), '--create', 'Test'], { env: { ...process.env, DATA_DIR: DATA } }).toString().trim();
  // a second profile, to see that one's token never reaches the other's nights
  otherCookie = execFileSync('node', [path.join(dir, '../scripts/dev-session.mjs'), '--create', 'Other'], { env: { ...process.env, DATA_DIR: DATA } }).toString().trim();
  proc = spawn('node', [path.join(dir, '../server.js')], { env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT) }, stdio: 'inherit' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base + '/api/health')).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});

const sync = (body, headers = {}) => fetch(base + '/api/sync', {
  method: 'POST', headers: { cookie, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers }, body: JSON.stringify(body)
});
const night = (id, ts, q) => ({ kind: 'night', id, ts, data: { q } });

test('sync needs a session', async () => {
  assert.equal((await sync({ changes: [] }, { cookie: '' })).status, 401);
});

test('a request from another origin on the same host is refused', async () => {
  assert.equal((await sync({ changes: [] }, { 'sec-fetch-site': 'same-site' })).status, 403);
});

test('newer edit wins per entry, and a device gets only what it has not seen', async () => {
  let r = await (await sync({ since: 0, changes: [night('2026-10-20', 100, 3), night('2026-10-19', 100, 4)] })).json();
  assert.equal(r.rev, 2);
  assert.equal(r.changes.length, 2);

  // an older edit of 10-20 loses, a newer one of 10-19 wins
  r = await (await sync({ since: 2, changes: [night('2026-10-20', 50, 1), night('2026-10-19', 200, 5)] })).json();
  assert.equal(r.rev, 3);
  assert.deepEqual(r.changes.map(c => [c.id, c.data.q]), [['2026-10-19', 5]]);

  // a device that never synced gets the merged state
  r = await (await sync({ since: 0, changes: [] })).json();
  assert.deepEqual(Object.fromEntries(r.changes.map(c => [c.id, c.data.q])), { '2026-10-20': 3, '2026-10-19': 5 });
});

test('bad changes are refused whole', async () => {
  assert.equal((await sync({ changes: [{ kind: 'user', id: 'x', ts: 1, data: {} }] })).status, 400);
});

test('a night log is stored (gzipped too), read back, and kept over a later partial one', async () => {
  const zlib = await import('node:zlib')
  const url = base + '/api/debug/2026-10-28'
  const put = (body, gz) => fetch(url, { method: 'PUT', headers: { cookie, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...(gz ? { 'content-encoding': 'gzip' } : {}) }, body: gz ? zlib.gzipSync(JSON.stringify(body)) : JSON.stringify(body) })
  assert.equal((await put({ night: '2026-10-27', events: [] })).status, 400)
  assert.equal((await put({ night: '2026-10-28', start: 1, events: [[0, 'start']], final: true, samples: { db: [30] } }, true)).status, 200)
  assert.equal((await put({ night: '2026-10-28', start: 1, events: [[0, 'start']], final: false })).status, 200)
  const got = await (await fetch(url, { headers: { cookie } })).json()
  assert.equal(got.final, true)
  assert.deepEqual(got.samples.db, [30])
  // a new night under the same date (another start) replaces it
  assert.equal((await put({ night: '2026-10-28', start: 2, events: [], final: false })).status, 200)
  assert.equal((await (await fetch(url, { headers: { cookie } })).json()).start, 2)
  // refused: signed out, cross-site, broken bodies, a bad date, a gzip bomb
  assert.equal((await fetch(url, { method: 'PUT', headers: { 'sec-fetch-site': 'same-origin' }, body: '{}' })).status, 401)
  assert.equal((await fetch(url, { method: 'PUT', headers: { cookie, 'sec-fetch-site': 'cross-site' }, body: '{}' })).status, 403)
  assert.equal((await fetch(url, { method: 'PUT', headers: { cookie, 'sec-fetch-site': 'same-origin', 'content-encoding': 'gzip' }, body: 'not gzip' })).status, 400)
  assert.equal((await fetch(url, { method: 'PUT', headers: { cookie, 'sec-fetch-site': 'same-origin' }, body: '{' })).status, 400)
  assert.equal((await fetch(base + '/api/debug/../../x', { method: 'PUT', headers: { cookie, 'sec-fetch-site': 'same-origin' }, body: '{}' })).status, 404)
  assert.equal((await fetch(base + '/api/debug/2026-10-29', { headers: { cookie } })).status, 404)
  const bomb = zlib.gzipSync(Buffer.alloc(80 * 1024 * 1024, 32))
  assert.equal((await fetch(url, { method: 'PUT', headers: { cookie, 'sec-fetch-site': 'same-origin', 'content-encoding': 'gzip' }, body: bomb })).status, 400)
})

// mySleep Night (the native app) has no sign-in: scripts/pair.mjs pairs it, and it signs its requests
// with the token it got (Authorization: Bearer), for its own few routes only.
const bearer = t => ({ authorization: 'Bearer ' + t });
const pair = () => fetch(base + '/api/devices', { method: 'POST', headers: { cookie, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'mySleep Night' }) });
const nativeLog = { night: '2026-11-01', start: 1793570000000, final: true, env: { app: 'native' }, events: [[0, 'start']], samples: { start: 1793570000000, db: [40, null], low: [0.3, 0], mid: [0.3, 0], vr: [1, 0], at: [1, 0] } };

test('pairing mySleep Night: a token for the app, which uploads its night and says when it expires', async () => {
  assert.equal((await fetch(base + '/api/devices', { method: 'POST', body: '{}' })).status, 401)
  const r = await pair();
  assert.equal(r.status, 200);
  const { token } = await r.json();
  assert.ok(token.length >= 40);
  // the app, as an app sends it: no cookie, no Sec-Fetch-Site
  const put = (t, body = nativeLog) => fetch(base + '/api/debug/2026-11-01', { method: 'PUT', headers: { ...bearer(t), 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await put(token)).status, 200);
  assert.equal((await put('not-the-token')).status, 401);
  const expires = Date.now() + 6 * 864e5;
  const st = await fetch(base + '/api/devices/status', { method: 'POST', headers: { ...bearer(token), 'content-type': 'application/json' }, body: JSON.stringify({ expires, build: '202611011200' }) });
  assert.equal(st.status, 200);
  // the operator sees the device (never its token) and the night's log
  const devices = await (await fetch(base + '/api/devices', { headers: { cookie } })).json();
  assert.equal(devices.length, 1);
  assert.deepEqual(Object.keys(devices[0]).sort(), ['build', 'expires', 'id', 'lastSeen', 'name']);
  assert.equal(devices[0].expires, expires);
  assert.equal((await fetch(base + '/api/devices')).status, 401);
  assert.equal((await fetch(base + '/api/devices', { headers: bearer(token) })).status, 401);
  const logs = await (await fetch(base + '/api/debug', { headers: { cookie } })).json();
  const listed = logs.find(l => l.night === '2026-11-01');
  assert.deepEqual({ ...listed, uploadedAt: typeof listed.uploadedAt }, { night: '2026-11-01', start: nativeLog.start, final: true, app: 'native', uploadedAt: 'number' });
  // a device token is not a session: it syncs (below) and uploads logs, and opens nothing else
  assert.equal((await fetch(base + '/api/debug', { headers: bearer(token) })).status, 401);
  assert.equal((await fetch(base + '/api/devices', { method: 'POST', headers: bearer(token), body: '{}' })).status, 401);
  // pairing again replaces it: the old token stops working
  const { token: again } = await (await pair()).json();
  assert.equal((await put(token)).status, 401);
  assert.equal((await put(again)).status, 200);
  assert.equal((await (await fetch(base + '/api/devices', { headers: { cookie } })).json()).length, 1);
});

test('refused: a device saying nonsense about its expiry', async () => {
  const { token } = await (await pair()).json();
  const st = body => fetch(base + '/api/devices/status', { method: 'POST', headers: { ...bearer(token), 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await st({ expires: 'soon' })).status, 400);
  assert.equal((await st({ expires: null, build: 'x' })).status, 200);
});

// mySleep Night is the only app: what the web app needed is gone from the server.
test('the web app’s routes are gone: passkeys, push, its sign-in, clips, the backup alarm', async () => {
  for (const [method, p] of [['POST', '/api/register/options'], ['POST', '/api/register/verify'], ['POST', '/api/login/options'], ['POST', '/api/login/verify'], ['POST', '/api/logout'],
    ['GET', '/api/me'], ['GET', '/api/push/key'], ['POST', '/api/push/subscribe'], ['POST', '/api/push/test'], ['POST', '/api/alarm'],
    ['POST', '/api/devices/web-code'], ['GET', '/api/session/code'], ['GET', '/api/clips/2026-10-20/abc123'], ['PUT', '/api/clips/2026-10-20/abc123']]) {
    const r = await fetch(base + p, { method, headers: { cookie, 'sec-fetch-site': 'same-origin' } });
    assert.equal(r.status, 404, method + ' ' + p);
  }
});

// The app syncs nights and settings itself (NATIVE_PLAN 0.1): the same route as the web app, with
// its device token, and only ever for the profile it was paired with.
test('the app syncs with its device token, for its own profile only', async () => {
  const { token } = await (await pair()).json();
  const send = (t, body) => fetch(base + '/api/sync', { method: 'POST', headers: { ...bearer(t), 'content-type': 'application/json' }, body: JSON.stringify(body) });
  // as the app sends it: no cookie, no Sec-Fetch-Site
  let r = await send(token, { since: 0, changes: [night('2026-11-03', 100, 7)] });
  assert.equal(r.status, 200);
  assert.ok((await r.json()).changes.some(c => c.id === '2026-11-03' && c.data.q === 7));
  // the operator (a session) sees what the app pushed, and the app sees what the operator pushed
  await sync({ changes: [night('2026-11-04', 100, 8)] });
  const web = await (await sync({ since: 0, changes: [] })).json();
  assert.ok(web.changes.some(c => c.id === '2026-11-03'));
  const app = await (await send(token, { since: 0, changes: [] })).json();
  assert.ok(app.changes.some(c => c.id === '2026-11-04'));
  // the newer edit wins as ever
  await send(token, { since: 0, changes: [night('2026-11-04', 50, 1)] });
  assert.equal((await (await send(token, { since: 0, changes: [] })).json()).changes.find(c => c.id === '2026-11-04').data.q, 8);
  // another profile never sees these nights, nor can its token be had by the first
  const other = await (await fetch(base + '/api/sync', { method: 'POST', headers: { cookie: otherCookie, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: '{"since":0,"changes":[]}' })).json();
  assert.deepEqual(other.changes, []);
  // refused: no token, a wrong one, bad changes
  assert.equal((await send('x'.repeat(30), { changes: [] })).status, 401);
  assert.equal((await fetch(base + '/api/sync', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await send(token, { changes: [{ kind: 'user', id: 'x', ts: 1, data: {} }] })).status, 400);
  // a web page cannot use it cross-site: the token is the app's, a browser never has it
  assert.equal((await fetch(base + '/api/sync', { method: 'POST', headers: { ...bearer(token), 'sec-fetch-site': 'cross-site' }, body: '{"changes":[]}' })).status, 403);
});

// Without the web app there is no page to pair from: a script on the server asks the running server
// for the token as the profile (api/scripts/pair.mjs) and prints the link the phone opens.
test('pairing without the web app: a script on the server prints the link', async () => {
  const run = (...args) => execFileSync('node', [path.join(dir, '../scripts/pair.mjs'), ...args], { env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), ORIGIN: 'http://localhost:5173' }, stdio: ['ignore', 'pipe', 'pipe'] })   // the server's own, as in production.toString().trim();
  const link = new URL(run('Test'));
  assert.equal(link.protocol, 'mysleepnight:');
  assert.equal(link.host, 'pair');
  assert.equal(link.searchParams.get('server'), 'http://localhost:5173');
  const token = link.searchParams.get('token');
  assert.ok(token.length >= 40);
  // the token is the app's: it syncs the profile it was made for, and nobody else's
  const as = (t, body) => fetch(base + '/api/sync', { method: 'POST', headers: { ...bearer(t), 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await as(token, { since: 0, changes: [night('2026-11-09', 100, 1)] })).status, 200);
  assert.ok((await (await sync({ since: 0, changes: [] })).json()).changes.some(c => c.id === '2026-11-09'));
  // pairing again replaces the device, as the web page did
  const again = new URL(run('Test')).searchParams.get('token');
  assert.equal((await as(token, { changes: [] })).status, 401);
  assert.equal((await as(again, { changes: [] })).status, 200);
  // a profile it does not know, or none named when there are several: refused, and it says which there are
  assert.throws(() => run('Nobody'), e => /Nobody|Test/.test(String(e.stderr)));
  assert.throws(() => run(), e => /Other/.test(String(e.stderr)));
});

// In production the server is behind https and reads the __Host- cookie; the script has to make that one.
test('pairing on an https server: the script makes the cookie that server reads', async () => {
  const ORIGIN = 'https://host.example:8443', dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mysleep-test-https-')), port2 = PORT + 1;
  const env = { ...process.env, DATA_DIR: dir2, PORT: String(port2), ORIGIN };
  execFileSync('node', [path.join(dir, '../scripts/dev-session.mjs'), '--create', 'Solo'], { env });
  const server2 = spawn('node', [path.join(dir, '../server.js')], { env, stdio: 'inherit' });
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${port2}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    const link = new URL(execFileSync('node', [path.join(dir, '../scripts/pair.mjs')], { env }).toString().trim());
    assert.equal(link.searchParams.get('server'), ORIGIN);
    const r = await fetch(`http://127.0.0.1:${port2}/api/sync`, { method: 'POST', headers: { ...bearer(link.searchParams.get('token')), 'content-type': 'application/json' }, body: '{"since":0,"changes":[]}' });
    assert.equal(r.status, 200);
  } finally { server2.kill(); fs.rmSync(dir2, { recursive: true, force: true }); }
});

// What an uptime monitor asks: the server is up, and so is the app (GET /api/health/app, no sign-in).
test('the app’s health: not heard from, then heard from', async () => {
  const get = () => fetch(base + '/api/health/app');
  await pair();   // a fresh device: paired, never heard from
  let r = await get();
  assert.equal(r.status, 503);
  assert.deepEqual(await r.json(), { ok: false, app: 'never heard', seenHoursAgo: null });
  const { token } = await (await pair()).json();
  await fetch(base + '/api/devices/status', { method: 'POST', headers: { ...bearer(token), 'content-type': 'application/json' }, body: JSON.stringify({ expires: Date.now() + 3 * 864e5, build: 'x' }) });
  r = await get();
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, app: 'running', seenHoursAgo: 0 });
});

// `docker stop` sends SIGTERM: the server finishes its requests and leaves cleanly (exit code 0).
test('SIGTERM stops the server cleanly', async () => {
  const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'mysleep-test-term-')), port3 = PORT + 2;
  const s = spawn('node', [path.join(dir, '../server.js')], { env: { ...process.env, DATA_DIR: dir3, PORT: String(port3) }, stdio: 'inherit' });
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${port3}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    const exited = new Promise(r => s.once('exit', (code, signal) => r({ code, signal })));
    s.kill('SIGTERM');
    assert.deepEqual(await exited, { code: 0, signal: null });
  } finally { s.kill('SIGKILL'); fs.rmSync(dir3, { recursive: true, force: true }); }
});

/* ---------- sessions, devices, bodies, the debug route: the refusals and the tidying ---------- */
const same = { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
const signed = (uid, exp) => {   // a cookie signed as server.js signs one (DATA/secret)
  const p = uid + ':' + exp, secret = fs.readFileSync(path.join(DATA, 'secret'), 'utf8').trim();
  return 'sleepsid=' + p + '.' + crypto.createHmac('sha256', secret).update(p).digest('base64url');
};

test('a session cookie that is forged, expired or malformed is no session', async () => {
  const value = cookie.split('=')[1], uid = value.split(':')[0];
  const list = c => fetch(base + '/api/devices', { headers: { cookie: c } });
  assert.equal((await list(cookie)).status, 200);
  assert.equal((await list(cookie.slice(0, -3) + 'xxx')).status, 401, 'a changed signature');
  assert.equal((await list('sleepsid=nodothere')).status, 401, 'no signature at all');
  assert.equal((await list(signed(uid, Date.now() - 1000))).status, 401, 'expired');
  assert.equal((await list(signed('nobody', Date.now() + 1e6))).status, 401, 'a profile that does not exist');
  assert.equal((await list(signed(uid, Date.now() + 1e6))).status, 200, 'the same cookie, still valid, is accepted');
});

test('devices: named, trimmed, one per name, listed without their secrets', async () => {
  const add = async name => (await fetch(base + '/api/devices', { method: 'POST', headers: { cookie, ...same }, body: JSON.stringify({ name }) })).json();
  await add('  Bedside  ');
  const first = await add('Bedside');                 // the same name again replaces the device
  await add('x'.repeat(60));
  await add('   ');                                    // a blank name is the default one
  const list = await (await fetch(base + '/api/devices', { headers: { cookie } })).json();
  assert.equal(list.filter(d => d.name === 'Bedside').length, 1);
  assert.ok(list.some(d => d.name === 'x'.repeat(40)), 'cut to 40 characters');
  assert.ok(list.some(d => d.name === 'mySleep Night'));
  assert.ok(list.every(d => !('hash' in d) && !('token' in d)), 'never the token or its hash');
  assert.ok(first.token && first.id);
});

test('a device says when it expires and which build it is; nothing else goes in', async () => {
  const { token } = await (await fetch(base + '/api/devices', { method: 'POST', headers: { cookie, ...same }, body: JSON.stringify({ name: 'Status test' }) })).json();
  const status = body => fetch(base + '/api/devices/status', { method: 'POST', headers: { ...bearer(token), ...same }, body: JSON.stringify(body) });
  assert.equal((await status({ expires: 'soon' })).status, 400);
  assert.equal((await status({})).status, 400, 'expires has to be there');
  assert.equal((await status({ expires: 1893456000000, build: 'b'.repeat(60) })).status, 200);
  const d = (await (await fetch(base + '/api/devices', { headers: { cookie } })).json()).find(x => x.name === 'Status test');
  assert.equal(d.expires, 1893456000000);
  assert.equal(d.build, 'b'.repeat(40));
  assert.ok(d.lastSeen > 0);
  assert.equal((await status({ expires: null, build: 7 })).status, 200);   // a build that is not text is dropped
  const again = (await (await fetch(base + '/api/devices', { headers: { cookie } })).json()).find(x => x.name === 'Status test');
  assert.equal(again.build, null);
  assert.equal(again.expires, null);
});

test('a body that is not JSON is refused, and one that is too large', async () => {
  const post = body => fetch(base + '/api/devices', { method: 'POST', headers: { cookie, ...same }, body });
  assert.equal((await post('{not json')).status, 400);
  assert.equal((await post('x'.repeat(4 * 1024 * 1024 + 10))).status, 413);
  assert.equal((await fetch(base + '/api/sync', { method: 'POST', headers: { cookie, ...same }, body: '{"since":0,"changes":"no"}' })).status, 200, 'changes that are not a list are none');
});

test('the debug route takes GET and PUT, and a log not too large', async () => {
  const url = base + '/api/debug/2026-12-24';
  assert.equal((await fetch(url, { method: 'DELETE', headers: { cookie, ...same } })).status, 405);
  assert.equal((await fetch(url, { method: 'PUT', headers: { cookie, ...same }, body: 'x'.repeat(4 * 1024 * 1024 + 10) })).status, 413);
});

test('a log nobody can read is replaced by the next one; old logs are swept at start', async () => {
  const dbg = path.join(DATA, 'debug', fs.readdirSync(path.join(DATA, 'debug'))[0]);
  fs.writeFileSync(path.join(dbg, '2026-12-25.json'), '{ broken');           // a half-written file
  const put = await fetch(base + '/api/debug/2026-12-25', { method: 'PUT', headers: { cookie, ...same }, body: JSON.stringify({ night: '2026-12-25', start: 1, final: false, env: { app: 'native' }, events: [] }) });
  assert.equal(put.status, 200);
  const logs = await (await fetch(base + '/api/debug', { headers: { cookie } })).json();
  assert.ok(logs.some(l => l.night === '2026-12-25' && l.final === false && l.app === 'native'));
  // swept at start: a log older than DEBUG_DAYS goes, a fresh one stays
  const old = path.join(dbg, '2020-01-01.json'), fresh = path.join(dbg, '2026-12-26.json');
  fs.writeFileSync(old, '{}'); fs.writeFileSync(fresh, '{}');
  const t = new Date(Date.now() - 40 * 864e5); fs.utimesSync(old, t, t);
  const dir4 = DATA, port4 = PORT + 3;
  const s = spawn('node', [path.join(dir, '../server.js')], { env: { ...process.env, DATA_DIR: dir4, PORT: String(port4) }, stdio: 'inherit' });
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${port4}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    assert.equal(fs.existsSync(old), false);
    assert.equal(fs.existsSync(fresh), true);
  } finally { s.kill(); }
});

test('a request from another site is refused, one from our own page or from the app is not', async () => {
  const post = headers => fetch(base + '/api/sync', { method: 'POST', headers: { cookie, 'content-type': 'application/json', ...headers }, body: '{"since":0,"changes":[]}' });
  assert.equal((await post({ 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await post({ 'sec-fetch-site': 'same-site' })).status, 403);
  assert.equal((await post({ origin: 'https://evil.example' })).status, 403, 'no Sec-Fetch-Site: the Origin has to be ours');
  assert.equal((await post({ 'sec-fetch-site': 'same-origin' })).status, 200);
  assert.equal((await post({})).status, 200, 'the app sends neither');
});

test('an unknown route is 404 and a change that is not valid is 400, in JSON', async () => {
  const r = await fetch(base + '/api/nothing-here');
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { error: 'not found' });
  const bad = await fetch(base + '/api/sync', { method: 'POST', headers: { cookie, ...same }, body: JSON.stringify({ since: 0, changes: [{ kind: 'night' }] }) });
  assert.equal(bad.status, 400);
  const many = await fetch(base + '/api/sync', { method: 'POST', headers: { cookie, ...same }, body: JSON.stringify({ since: 0, changes: Array.from({ length: 1001 }, (_, i) => night('2027-01-01', i, 1)) }) });
  assert.equal(many.status, 400, 'at most 1000 changes at a time');
});
