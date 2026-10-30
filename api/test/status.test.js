import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appStatus } from '../status.js';

// Is mySleep Night alive? What an uptime monitor asks (GET /api/health/app): the server answers,
// the app is paired, its install has not run out (a free Apple ID: 7 days) and it has been heard
// from lately (it syncs after every night and whenever it is opened).
const H = 3600e3, now = Date.UTC(2026, 10, 3, 12), silent = 36 * H;
const user = (...devices) => ({ id: 'u', devices });
const device = (o = {}) => ({ name: 'mySleep Night', lastSeen: now - 2 * H, expires: now + 3 * 864e5, ...o });

test('heard from lately, and not run out: running', () => {
  assert.deepEqual(appStatus([user(device())], now, silent), { ok: true, app: 'running', seenHoursAgo: 2 });
});

test('nothing paired', () => {
  assert.deepEqual(appStatus([user()], now, silent), { ok: false, app: 'not paired', seenHoursAgo: null });
  assert.deepEqual(appStatus([], now, silent), { ok: false, app: 'not paired', seenHoursAgo: null });
});

test('paired but never heard from', () => {
  assert.deepEqual(appStatus([user(device({ lastSeen: null }))], now, silent), { ok: false, app: 'never heard', seenHoursAgo: null });
});

test('not heard from for a day and a half: silent', () => {
  assert.equal(appStatus([user(device({ lastSeen: now - 37 * H }))], now, silent).app, 'silent');
  assert.equal(appStatus([user(device({ lastSeen: now - 35 * H }))], now, silent).app, 'running');
  assert.equal(appStatus([user(device({ lastSeen: now - 37 * H }))], now, silent).seenHoursAgo, 37);
});

test('the install ran out: stopped, however recently it spoke', () => {
  const r = appStatus([user(device({ expires: now - H, lastSeen: now - H }))], now, silent);
  assert.deepEqual(r, { ok: false, app: 'stopped', seenHoursAgo: 1 });
});

test('no date from the app (the Simulator, an old build): judged by when it was heard', () => {
  assert.equal(appStatus([user(device({ expires: null }))], now, silent).app, 'running');
});

test('the one heard from last speaks for the app', () => {
  const r = appStatus([user(device({ name: 'old', lastSeen: now - 100 * H }), device({ name: 'new', lastSeen: now - H }))], now, silent);
  assert.equal(r.app, 'running');
});
