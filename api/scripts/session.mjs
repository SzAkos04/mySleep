// A profile of a data dir and a session cookie for it, signed the way server.js signs one. Needs
// DATA_DIR/secret, which is full control of the instance anyway: for the people who run it
// (dev-session.mjs on the Mac, pair.mjs on the server), never reachable from outside.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const readDb = dir => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')); } catch { return { users: [] }; } };

// The one profile that `who` (an id or a name) names; with no `who`, the only profile there is.
export function profile(dir, who) {
  const users = readDb(dir).users, found = who ? users.filter(u => u.id === who || u.name === who) : users;
  if (found.length === 1) return found[0];
  throw new Error(`No single match. Profiles in ${dir}:\n` + users.map(u => `  ${u.id}  ${u.name}`).join('\n'));
}

// The cookie's name follows the address the server is behind: https gets the __Host- one (server.js reads it).
export const cookieName = origin => String(origin || '').startsWith('https:') ? '__Host-sleepsid' : 'sleepsid';

export function cookieFor(dir, user, origin = process.env.ORIGIN) {
  const secret = fs.readFileSync(path.join(dir, 'secret'), 'utf8').trim();
  const p = user.id + ':' + (Date.now() + 180 * 864e5);
  return cookieName(origin) + '=' + p + '.' + crypto.createHmac('sha256', secret).update(p).digest('base64url');
}
