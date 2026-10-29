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
import { profile, cookieFor, readDb } from './session.mjs';

const DATA = process.env.DATA_DIR || '/data';
fs.mkdirSync(DATA, { recursive: true });
const secretFile = path.join(DATA, 'secret'), dbFile = path.join(DATA, 'db.json');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });

let [want, name] = process.argv.slice(2);
if (want === '--create') {
  const db = readDb(DATA), user = { id: crypto.randomBytes(12).toString('base64url'), name: name || 'Test', created: new Date().toISOString() };
  db.users.push(user);
  fs.writeFileSync(dbFile, JSON.stringify(db), { mode: 0o600 });
  want = user.id;
}
try { console.log(cookieFor(DATA, profile(DATA, want))); }
catch (e) { console.error(e.message); process.exit(1); }
