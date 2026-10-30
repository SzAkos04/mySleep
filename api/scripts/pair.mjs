#!/usr/bin/env node
// Pairs mySleep Night with this server without a web page: asks the running server for a device
// token as the profile (POST /api/devices) and prints the
// link the phone opens (Notes, Messages, a QR): it hands the app the server and its token. Pairing
// again replaces the device. Run it where the server runs:
//   docker compose exec -T api node scripts/pair.mjs [profile]
// ORIGIN is the address the phone reaches the server at (the container has it).
import { profile, cookieFor } from './session.mjs';

const DATA = process.env.DATA_DIR || '/data', PORT = process.env.PORT || 3000, ORIGIN = process.env.ORIGIN;
try {
  if (!ORIGIN) throw new Error('ORIGIN is not set: it is the address the phone reaches this server at.');
  const user = profile(DATA, process.argv[2]);
  const res = await fetch(`http://127.0.0.1:${PORT}/api/devices`, {
    method: 'POST', headers: { cookie: cookieFor(DATA, user), 'content-type': 'application/json' }, body: JSON.stringify({ name: 'mySleep Night' })
  });
  if (!res.ok) throw new Error(`the server said ${res.status}: ${(await res.json().catch(() => ({}))).error || ''}`);
  const { token } = await res.json();
  console.log(`mysleepnight://pair?server=${encodeURIComponent(ORIGIN)}&token=${encodeURIComponent(token)}`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
