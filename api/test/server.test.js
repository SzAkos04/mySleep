import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'mysleep-test-'));
const PORT = 20000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${PORT}`;
const PUSH_LOG = path.join(DATA, 'pushes.jsonl');
let proc, cookie, otherCookie;

// Registered at the top level, not inside before (node:test).
after(() => { proc?.kill(); fs.rmSync(DATA, { recursive: true, force: true }); });

before(async () => {
  cookie = execFileSync('node', [path.join(dir, '../scripts/dev-session.mjs'), '--create', 'Test'], { env: { ...process.env, DATA_DIR: DATA } }).toString().trim();
  // a second profile, to see that one's token never reaches the other's nights
  otherCookie = execFileSync('node', [path.join(dir, '../scripts/dev-session.mjs'), '--create', 'Other'], { env: { ...process.env, DATA_DIR: DATA } }).toString().trim();
  // TICK_MS: reminders checked often; PUSH_LOG: pushes written to a file instead of sent
  proc = spawn('node', [path.join(dir, '../server.js')], { env: { ...process.env, DATA_DIR: DATA, PORT: String(PORT), TICK_MS: '200', PUSH_LOG: PUSH_LOG }, stdio: 'inherit' });
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

test('sign-up is closed once a profile exists', async () => {
  const r = await fetch(base + '/api/register/options', { method: 'POST', body: '{"name":"x"}' });
  assert.equal(r.status, 403);
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

// Sound clips came from the web app's own night tracking, gone since mySleep Night records the
// night: old nights' clips play back until they age out, and nothing uploads new ones.
test('an old clip is served back and goes with its night; none can be uploaded any more', async () => {
  const wav = Buffer.alloc(64); wav.write('RIFF', 0, 'latin1'); wav.write('WAVE', 8, 'latin1')
  const uid = cookie.split('=')[1].split(':')[0]
  fs.mkdirSync(path.join(DATA, 'clips', uid), { recursive: true })
  fs.writeFileSync(path.join(DATA, 'clips', uid, '2026-10-20_abc123.wav'), wav)
  const url = base + '/api/clips/2026-10-20/abc123'
  assert.equal((await fetch(url, { method: 'PUT', headers: { cookie, 'sec-fetch-site': 'same-origin' }, body: wav })).status, 405)
  assert.equal((await fetch(url)).status, 401)
  const got = await fetch(url, { headers: { cookie } })
  assert.equal(got.headers.get('content-type'), 'audio/wav')
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), wav)
  assert.equal((await fetch(base + '/api/clips/2026-10-20/../../db', { headers: { cookie } })).status, 404)
  await sync({ changes: [{ kind: 'night', id: '2026-10-20', ts: 999, deleted: true }] })
  assert.equal((await fetch(url, { headers: { cookie } })).status, 404)
})

test('the web app’s backup alarm is gone (mySleep Night rings through AlarmKit)', async () => {
  assert.equal((await fetch(base + '/api/alarm', { method: 'POST', headers: { cookie, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: '{"at":1}' })).status, 404)
})

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

// mySleep Night (the native app) has no passkey: the web app pairs it, and it signs its requests
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
  // the web app sees the device (never its token) and the night's log
  const me = await (await fetch(base + '/api/me', { headers: { cookie } })).json();
  assert.equal(me.devices.length, 1);
  assert.deepEqual(Object.keys(me.devices[0]).sort(), ['build', 'expires', 'id', 'lastSeen', 'name']);
  assert.equal(me.devices[0].expires, expires);
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
  assert.equal((await (await fetch(base + '/api/me', { headers: { cookie } })).json()).devices.length, 1);
});

test('a reminder to reinstall goes out once when mySleep Night is about to stop', async () => {
  // a time zone where it is midday now, so the reminder's waking hours hold whenever this runs
  const off = (12 - new Date().getUTCHours() + 24) % 24, o = off > 12 ? off - 24 : off;
  const tz = o === 0 ? 'UTC' : 'Etc/GMT' + (o > 0 ? '-' : '+') + Math.abs(o);
  assert.equal((await sync({ changes: [{ kind: 'settings', id: 'main', ts: Date.now(), data: { tz, remind: false } }] })).status, 200);
  const { token } = await (await pair()).json();
  await fetch(base + '/api/devices/status', { method: 'POST', headers: { ...bearer(token), 'content-type': 'application/json' }, body: JSON.stringify({ expires: Date.now() + 3600e3, build: 'x' }) });
  const sent = () => fs.existsSync(PUSH_LOG) ? fs.readFileSync(PUSH_LOG, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(p => p.payload.tag === 'reinstall') : [];
  for (let i = 0; i < 30 && !sent().length; i++) await new Promise(r => setTimeout(r, 100));
  assert.equal(sent().length, 1);
  assert.match(sent()[0].payload.title, /mySleep Night stops tonight/);
  await new Promise(r => setTimeout(r, 800));   // several ticks later: still once
  assert.equal(sent().length, 1);
});

// mySleep Night shows the web app's Journal and Trends inside itself: it signs those pages in with
// a one-time code it gets with its device token (no passkey inside an app).
test('the app signs its web pages in with a one-time code', async () => {
  const { token } = await (await pair()).json();
  const code = () => fetch(base + '/api/devices/web-code', { method: 'POST', headers: bearer(token) });
  assert.equal((await fetch(base + '/api/devices/web-code', { method: 'POST' })).status, 401);
  const r = await code();
  assert.equal(r.status, 200);
  const { code: c, expires } = await r.json();
  assert.ok(c.length >= 30);
  assert.ok(expires - Date.now() <= 60000 && expires > Date.now());
  // exchanged for a session and sent on to the page asked for, inside this site only
  const go = (cc, to) => fetch(base + '/api/session/code?c=' + encodeURIComponent(cc) + (to ? '&to=' + encodeURIComponent(to) : ''), { redirect: 'manual' });
  const ok = await go(c, '/?embed=1#/journal');
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.get('location'), '/?embed=1#/journal');
  const cookieSet = ok.headers.get('set-cookie');
  assert.match(cookieSet, /sleepsid=[^;]+; Path=\//);
  const me = await fetch(base + '/api/me', { headers: { cookie: cookieSet.split(';')[0] } });
  assert.equal(me.status, 200);
  // once only
  assert.equal((await go(c, '/')).status, 401);
  // never off the site
  for (const to of ['https://evil.example/', '//evil.example/x', '/\\evil.example']) {
    const { code: fresh } = await (await code()).json();
    assert.equal((await go(fresh, to)).headers.get('location'), '/');
  }
  // nonsense
  assert.equal((await go('nope', '/')).status, 401);
});

test('the bedtime reminder goes out once, 30 min before bedtime in the profile’s own time zone', async () => {
  // a minute well inside, so the minute does not turn while the ticks look
  if (new Date().getUTCSeconds() > 50) await new Promise(r => setTimeout(r, 11000));
  const t = new Date(Date.now() + 30 * 60000), bedtime = String(t.getUTCHours()).padStart(2, '0') + ':' + String(t.getUTCMinutes()).padStart(2, '0');
  assert.equal((await sync({ changes: [{ kind: 'settings', id: 'main', ts: Date.now(), data: { tz: 'UTC', remind: true, bedtime } }] })).status, 200);
  const sent = () => fs.existsSync(PUSH_LOG) ? fs.readFileSync(PUSH_LOG, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(p => p.payload.tag === 'bedtime') : [];
  for (let i = 0; i < 30 && !sent().length; i++) await new Promise(r => setTimeout(r, 100));
  assert.equal(sent().length, 1);
  assert.deepEqual(sent()[0].payload, { title: 'Bedtime in 30 min', body: 'Lights out at ' + bedtime + '.', tag: 'bedtime' });
  await new Promise(r => setTimeout(r, 800));
  assert.equal(sent().length, 1);
});

test('refused: a device saying nonsense about its expiry, a push subscription that is not https', async () => {
  const { token } = await (await pair()).json();
  const st = body => fetch(base + '/api/devices/status', { method: 'POST', headers: { ...bearer(token), 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await st({ expires: 'soon' })).status, 400);
  assert.equal((await st({ expires: null, build: 'x' })).status, 200);
  const sub = subscription => fetch(base + '/api/push/subscribe', { method: 'POST', headers: { cookie, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: JSON.stringify({ subscription }) });
  assert.equal((await sub({ endpoint: 'http://push.example/x', keys: { p256dh: 'a', auth: 'b' } })).status, 400);
  assert.equal((await sub({ endpoint: 'https://push.example/x', keys: {} })).status, 400);
  assert.equal((await sub({ endpoint: 'https://push.example/x', keys: { p256dh: 'a', auth: 'b' } })).status, 200);
});

test('signing out clears the cookie', async () => {
  const r = await fetch(base + '/api/logout', { method: 'POST', headers: { cookie, 'sec-fetch-site': 'same-origin' } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /sleepsid=; Path=\/; Max-Age=0/);
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
  // the web app (a session) sees what the app pushed, and the app sees what the web app pushed
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
