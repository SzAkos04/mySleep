import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expiryReminder } from '../reminders.js';

// mySleep Night is signed with a free Apple ID: it stops working 7 days after it was installed.
// The server reminds the person (web push) before that, once per stage, at a waking hour.
const H = 3600e3, tz = 'Europe/Budapest';
const at = (d, h) => new Date(Date.UTC(2026, 10, d, h - 1)).getTime();   // Budapest = UTC+1 in November
const device = (expires, reminded = null) => ({ name: 'mySleep Night', expires, reminded });

test('two days before: a heads-up naming the day', () => {
  const r = expiryReminder(device(at(5, 20)), at(3, 19), tz);
  assert.equal(r.stage, 'soon');
  assert.match(r.title, /mySleep Night stops on Thursday/);
  assert.match(r.body, /Reinstall it from the Mac before then/);
});

test('the last day: tonight it would not record', () => {
  const r = expiryReminder(device(at(5, 20)), at(5, 9), tz);
  assert.equal(r.stage, 'today');
  assert.match(r.title, /mySleep Night stops tonight/);
});

test('expired: it has stopped', () => {
  const r = expiryReminder(device(at(5, 20)), at(6, 10), tz);
  assert.equal(r.stage, 'expired');
  assert.match(r.title, /mySleep Night has stopped/);
});

test('each stage once', () => {
  assert.equal(expiryReminder(device(at(5, 20), 'soon'), at(4, 10), tz), null);
  assert.equal(expiryReminder(device(at(5, 20), 'soon'), at(5, 10), tz).stage, 'today');
  assert.equal(expiryReminder(device(at(5, 20), 'expired'), at(8, 10), tz), null);
});

test('never in the night: from 9:00 to 21:00 local time only', () => {
  assert.equal(expiryReminder(device(at(5, 20)), at(4, 3), tz), null);
  assert.equal(expiryReminder(device(at(5, 20)), at(4, 22), tz), null);
  assert.equal(expiryReminder(device(at(5, 20)), at(4, 9), tz).stage, 'soon');
});

test('nothing while far off, or for a device that never said when', () => {
  assert.equal(expiryReminder(device(at(12, 20)), at(4, 10), tz), null);
  assert.equal(expiryReminder(device(null), at(4, 10), tz), null);
});
