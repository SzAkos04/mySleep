// The night's flight recorder: everything that can explain a night that went wrong. Events (screen
// kept on or not, microphone lost, page hidden, reloaded, stalled, errors), a heartbeat every
// minute, and at the end the raw per-second readings. Kept in localStorage while the night runs,
// uploaded to the server every few minutes and at the end (PUT /api/debug/<night>), kept apart
// from the night itself so a discarded night still leaves its log. Read it on the Mac with
// scripts/fetch-debug.sh and frontend/scripts/night-report.mjs.
const KEY = 'mysleep_diag'
const MAX_EVENTS = 6000
let log = null, lastSave = 0

const env = () => ({
  ua: navigator.userAgent,
  standalone: !!navigator.standalone || matchMedia('(display-mode: standalone)').matches,
  screen: `${screen.width}x${screen.height}@${devicePixelRatio}`,
  lang: navigator.language,
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  build: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '?',
  wakeLockApi: 'wakeLock' in navigator,
  audioSessionApi: 'audioSession' in navigator,
  mediaSessionApi: 'mediaSession' in navigator,
  captureStream: typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype,
  compressionStream: typeof CompressionStream !== 'undefined',
  memory: navigator.deviceMemory ?? null,
  cores: navigator.hardwareConcurrency ?? null
})

function save(force) {
  if (!log) return
  const now = Date.now()
  if (!force && now - lastSave < 5000) return
  lastSave = now
  try { localStorage.setItem(KEY, JSON.stringify(log)) } catch {}
}

export function diagStart(night, extra = {}) {
  log = { v: 1, night, start: Date.now(), env: env(), ...extra, events: [] }
  diag('start', { visibility: document.visibilityState })
  save(true)
}

// After a reload in the night: carry on with the same log.
export function diagResume(night) {
  try {
    const l = JSON.parse(localStorage.getItem(KEY))
    if (l && l.night === night) { log = l; diag('page-reloaded', { visibility: document.visibilityState, navType: performance.getEntriesByType?.('navigation')?.[0]?.type }); return true }
  } catch {}
  return false
}

// One line: [ms since start, type, data].
export function diag(type, data) {
  if (!log) return
  if (log.events.length >= MAX_EVENTS) { if (log.events.at(-1)?.[1] !== 'log-full') log.events.push([Date.now() - log.start, 'log-full']); return }
  log.events.push(data === undefined ? [Date.now() - log.start, type] : [Date.now() - log.start, type, data])
  save(type === 'error' || type === 'pagehide' || type === 'visibility')
}

export const diagActive = () => !!log
export const diagNight = () => log?.night

let lastUpload = 0
// Every few minutes during the night (log only), and once at the end with the raw readings.
export async function diagUpload(samples, final) {
  if (!log) return
  const now = Date.now()
  if (!final && now - lastUpload < 5 * 60000) return
  lastUpload = now
  const body = { ...log, uploadedAt: now, final: !!final }
  if (final && samples) {
    const r1 = v => Number.isFinite(v) ? Math.round(v * 10) / 10 : null, r2 = v => Math.round(v * 100) / 100
    body.samples = { start: samples.start, db: samples.db.map(r1), low: samples.low.map(r2), mid: samples.mid.map(r2), vr: samples.vr.map(r1), at: samples.at.map(r1) }
  }
  try {
    let payload = JSON.stringify(body), headers = { 'Content-Type': 'application/json' }
    if (typeof CompressionStream !== 'undefined') {
      payload = await new Response(new Blob([payload]).stream().pipeThrough(new CompressionStream('gzip'))).blob()
      headers['Content-Encoding'] = 'gzip'
    }
    const r = await fetch('/api/debug/' + log.night, { method: 'PUT', headers, body: payload, keepalive: !final && payload.size < 60000 })
    if (!r.ok) throw new Error('server answered ' + r.status)
    if (final) { log = null; try { localStorage.removeItem(KEY) } catch {} }
  } catch (e) {
    diag('upload-failed', { final: !!final, error: String(e?.message || e) })
    // the end-of-night upload failed: keep it for the next app start
    if (final) try { localStorage.setItem(KEY + '_pending', JSON.stringify(body)) } catch {}
  }
}

// A final upload that failed (offline in the morning): send it when the app next opens.
export async function diagRetryPending() {
  let body
  try { body = JSON.parse(localStorage.getItem(KEY + '_pending')) } catch {}
  if (!body) return
  try {
    const r = await fetch('/api/debug/' + body.night, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (r.ok) localStorage.removeItem(KEY + '_pending')
  } catch {}
}

// A short summary kept on the night itself (the night page shows it).
export function diagSummary() {
  if (!log) return null
  const c = t => log.events.filter(e => e[1] === t).length
  return {
    events: log.events.length,
    lockOk: c('wakelock'), lockFailed: c('wakelock-failed'), lockReleased: c('wakelock-released'),
    videoOk: c('video-playing'), videoFailed: c('video-failed'),
    micLost: c('mic-ended') + c('mic-dead'), hidden: c('visibility') ? log.events.filter(e => e[1] === 'visibility' && e[2]?.state === 'hidden').length : 0,
    reloads: c('page-reloaded'), stalls: c('stall'), errors: c('error')
  }
}

// Things that happen to the page, whatever the night screen is doing.
if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => diag('visibility', { state: document.visibilityState }))
  addEventListener('pagehide', e => diag('pagehide', { persisted: e.persisted }))
  addEventListener('pageshow', e => diag('pageshow', { persisted: e.persisted }))
  document.addEventListener('freeze', () => diag('freeze'))
  document.addEventListener('resume', () => diag('resume'))
  addEventListener('blur', () => diag('blur'))
  addEventListener('focus', () => diag('focus'))
  addEventListener('online', () => diag('online'))
  addEventListener('offline', () => diag('offline'))
  addEventListener('error', e => diag('error', { message: String(e.message), at: `${e.filename}:${e.lineno}:${e.colno}` }))
  addEventListener('unhandledrejection', e => diag('error', { message: String(e.reason?.message || e.reason), kind: 'promise' }))
}
