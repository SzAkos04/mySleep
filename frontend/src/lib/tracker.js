// The microphone at night and the alarm in the morning. Browser-only; the logic that reads the
// numbers is in analysis.js.
//
// iPhone rules this follows (docs/dev/MVP.md):
// - A home-screen web app loses the microphone when locked or in the background, so the screen
//   stays on (Wake Lock) and the stream is re-opened whenever the page is visible again.
// - The AudioContext is made inside the Start tap, so it may play the alarm hours later.
// - While the mic is open iOS may send sound to the earpiece; the alarm closes the mic first and
//   switches the audio session to playback, which also ignores the silent switch.

const POLL_MS = 250
export const samples = { start: 0, db: [], low: [] }   // one value per second; NaN = not recorded

let ctx = null, stream = null, analyser = null, poll = null, wakeLock = null
let acc = { n: 0, db: -Infinity, low: 0 }

const KEY = 'mysleep_track'
export function saveProgress() {
  try { localStorage.setItem(KEY, JSON.stringify({ start: samples.start, db: samples.db.map(v => Number.isFinite(v) ? Math.round(v * 10) / 10 : null), low: samples.low.map(v => Math.round(v * 100) / 100) })) } catch {}
}
export function loadProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY))
    if (!p) return false
    Object.assign(samples, { start: p.start, db: p.db.map(v => v ?? NaN), low: p.low })
    return true
  } catch { return false }
}
export const clearProgress = () => { try { localStorage.removeItem(KEY) } catch {} }

async function lockScreen() {
  try { wakeLock = await navigator.wakeLock?.request('screen') } catch {}
}

async function openMic() {
  if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'
  stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
  const src = ctx.createMediaStreamSource(stream)
  analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  analyser.smoothingTimeConstant = 0
  src.connect(analyser)
  await ctx.resume()
}
export const micLive = () => !!stream && stream.getAudioTracks().some(t => t.readyState === 'live')
function closeMic() { stream?.getTracks().forEach(t => t.stop()); stream = null; analyser = null }

function read() {
  const now = Date.now(), sec = Math.floor((now - samples.start) / 1000)
  // seconds the page was not running are gaps
  while (samples.db.length < sec) {
    samples.db.push(acc.n ? acc.db : NaN); samples.low.push(acc.n ? acc.low / acc.n : 0)
    acc = { n: 0, db: -Infinity, low: 0 }
  }
  if (!analyser || !micLive()) return
  const t = new Float32Array(analyser.fftSize), f = new Float32Array(analyser.frequencyBinCount)
  analyser.getFloatTimeDomainData(t)
  analyser.getFloatFrequencyData(f)
  let sum = 0
  for (const v of t) sum += v * v
  // dB relative to full scale, +100 to keep it positive; only differences matter
  const db = 20 * Math.log10(Math.sqrt(sum / t.length) || 1e-10) + 100
  const hz = ctx.sampleRate / analyser.fftSize
  let lo = 0, all = 0
  for (let i = Math.ceil(50 / hz); i < Math.min(f.length, 4000 / hz); i++) {
    const p = 10 ** (f[i] / 10)
    all += p
    if (i * hz < 500) lo += p
  }
  acc.n++; acc.db = Math.max(acc.db, db); acc.low += all ? lo / all : 0
}

async function onVisible() {
  if (document.visibilityState !== 'visible' || !ctx) return
  await lockScreen()
  if (!micLive() && !ringing) { try { await openMic() } catch {} }
}

// Call from the Start tap. `resume` continues a night whose page was closed (gap in between).
export async function start({ resume = false } = {}) {
  ctx = ctx || new AudioContext()
  if (!resume) Object.assign(samples, { start: Date.now(), db: [], low: [] })
  await openMic()
  await lockScreen()
  clearInterval(poll)
  poll = setInterval(read, POLL_MS)
  document.addEventListener('visibilitychange', onVisible)
}

export function stop() {
  clearInterval(poll); poll = null
  read()
  closeMic()
  silence()
  wakeLock?.release().catch(() => {}); wakeLock = null
  document.removeEventListener('visibilitychange', onVisible)
}

/* ---------- alarm ---------- */
let ringing = null
const NOTES = [523.25, 659.25, 783.99]   // C5 E5 G5

export async function ring() {
  closeMic()
  if (navigator.audioSession) navigator.audioSession.type = 'playback'
  await ctx.resume().catch(() => {})
  const master = ctx.createGain()
  master.gain.setValueAtTime(0.05, ctx.currentTime)
  master.gain.linearRampToValueAtTime(1, ctx.currentTime + 60)   // gets louder over a minute
  master.connect(ctx.destination)
  const chime = () => NOTES.forEach((hz, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + i * 0.28
    o.frequency.value = hz
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.5, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.2)
    o.connect(g).connect(master)
    o.start(t); o.stop(t + 1.3)
  })
  chime()
  ringing = { master, timer: setInterval(chime, 2400) }
}

export function silence() {
  if (!ringing) return
  clearInterval(ringing.timer)
  ringing.master.disconnect()
  ringing = null
}

// Snooze: back to listening (the tap allows opening the mic again).
export async function snooze() {
  silence()
  try { await openMic() } catch {}
}
