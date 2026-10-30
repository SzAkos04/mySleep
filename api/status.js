// Is mySleep Night alive? What an uptime monitor asks of the server (GET /api/health/app): it is
// paired, its install has not run out (a free Apple ID signs it for 7 days) and it has been heard
// from lately (it syncs after every night and whenever it is opened). Pure, so it is tested alone.
// The device that spoke last speaks for the app.
export function appStatus(users, now, silentMs) {
  const devices = users.flatMap(u => u.devices || []);
  if (!devices.length) return { ok: false, app: 'not paired', seenHoursAgo: null };
  const d = devices.reduce((a, b) => (b.lastSeen ?? 0) > (a.lastSeen ?? 0) ? b : a);
  const seenHoursAgo = d.lastSeen == null ? null : Math.round((now - d.lastSeen) / 3600e3);
  const app = Number.isFinite(d.expires) && d.expires <= now ? 'stopped'
    : d.lastSeen == null ? 'never heard'
    : now - d.lastSeen > silentMs ? 'silent' : 'running';
  return { ok: app === 'running', app, seenHoursAgo };
}
