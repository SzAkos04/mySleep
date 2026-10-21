#!/usr/bin/env node
// A session cookie for a profile in a local data dir, signed the way server.js signs one, so a
// browser without the passkey (Claude's browser pane, the iOS Simulator) can be signed in.
// Local test data only: it needs DATA_DIR/secret, which is full control of the instance anyway.
//
//   DATA_DIR=../data node scripts/dev-session.mjs [name-or-id]   # prints sleepsid=<token>
//   DATA_DIR=../data node scripts/dev-session.mjs --create Test  # makes a profile first
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA = process.env.DATA_DIR || '/data';
fs.mkdirSync(DATA, { recursive: true });
const secretFile = path.join(DATA, 'secret'), dbFile = path.join(DATA, 'db.json');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const secret = fs.readFileSync(secretFile, 'utf8').trim();
const db = fs.existsSync(dbFile) ? JSON.parse(fs.readFileSync(dbFile, 'utf8')) : { users: [], creds: [], subs: [] };

let [want, name] = process.argv.slice(2);
if (want === '--create') {
  const user = { id: crypto.randomBytes(12).toString('base64url'), name: name || 'Test', created: new Date().toISOString() };
  db.users.push(user);
  fs.writeFileSync(dbFile, JSON.stringify(db), { mode: 0o600 });
  want = user.id;
}
const found = want ? db.users.filter(u => u.id === want || u.name === want) : db.users;
if (found.length !== 1) {
  console.error(`No single match. Profiles in ${DATA}:`);
  for (const u of db.users) console.error(`  ${u.id}  ${u.name}`);
  process.exit(1);
}
const p = found[0].id + ':' + (Date.now() + 180 * 864e5);
console.log('sleepsid=' + p + '.' + crypto.createHmac('sha256', secret).update(p).digest('base64url'));
