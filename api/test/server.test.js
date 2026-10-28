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
let proc, cookie;

// Registered at the top level, not inside before (node:test).
after(() => { proc?.kill(); fs.rmSync(DATA, { recursive: true, force: true }); });

before(async () => {
  cookie = execFileSync('node', [path.join(dir, '../scripts/dev-session.mjs'), '--create', 'Test'], { env: { ...process.env, DATA_DIR: DATA } }).toString().trim();
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

test('a clip is stored, served back, and goes with its night', async () => {
  const wav = Buffer.alloc(64); wav.write('RIFF', 0, 'latin1'); wav.write('WAVE', 8, 'latin1')
  const url = base + '/api/clips/2026-10-20/abc123'
  const put = (body, headers = {}) => fetch(url, { method: 'PUT', headers: { cookie, 'sec-fetch-site': 'same-origin', ...headers }, body })
  assert.equal((await put(Buffer.from('not audio'))).status, 400)
  assert.equal((await put(wav, { cookie: '' })).status, 401)
  assert.equal((await put(wav)).status, 200)
  const got = await fetch(url, { headers: { cookie } })
  assert.equal(got.headers.get('content-type'), 'audio/wav')
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), wav)
  assert.equal((await fetch(base + '/api/clips/2026-10-20/../../db', { headers: { cookie } })).status, 404)
  await sync({ changes: [{ kind: 'night', id: '2026-10-20', ts: 999, deleted: true }] })
  assert.equal((await fetch(url, { headers: { cookie } })).status, 404)
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
})
