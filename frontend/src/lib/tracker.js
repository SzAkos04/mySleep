// The microphone at night and the alarm in the morning. Browser-only; the logic that reads the
// numbers is in analysis.js.
//
// iPhone rules this follows (docs/dev/MVP.md):
// - A home-screen web app loses the microphone when locked or in the background, so the screen
//   stays on (Wake Lock) and the stream is re-opened whenever the page is visible again.
// - The AudioContext is made inside the Start tap, so it may play the alarm hours later.
// - While the mic is open iOS may send sound to the earpiece; the alarm closes the mic first and
//   switches the audio session to playback, which also ignores the silent switch.
import { events, slice } from './analysis.js'
import { encodeWav } from './wav.js'
import { diag } from './diag.js'
// its own file, not a data: URL, which Safari may refuse for a worklet
import ringWorklet from './ring-worklet.js?url&no-inline'

const POLL_MS = 100
const RING_SEC = 30            // how far back a clip can reach
export const CLIP_LIMITS = { talk: 6, snore: 3, cough: 3 }   // per night

// One value per second from the start (analysis.js says what each is); NaN db = not recorded.
const KEYS = ['db', 'low', 'mid', 'vr', 'at']
export const samples = { start: 0, db: [], low: [], mid: [], vr: [], at: [] }
export const clips = []        // { id, t, kind, sec, blob } cut tonight, uploaded when the night ends

let ctx = null, stream = null, analyser = null, ringNode = null, poll = null, wakeLock = null, wallAt0 = 0
let acc = null, lastDb = null
const fresh = () => ({ n: 0, db: -Infinity, low: 0, mid: 0, dbs: [], at: 0 })

const KEY = 'mysleep_track'
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100
export function saveProgress() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      start: samples.start, db: samples.db.map(v => Number.isFinite(v) ? r1(v) : null),
      low: samples.low.map(r2), mid: samples.mid.map(r2), vr: samples.vr.map(r1), at: samples.at.map(r1)
    }))
  } catch (e) { diag('save-failed', { name: e?.name, message: e?.message, sec: samples.db.length }) }   // full storage: a reload would lose the night
}
export function loadProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY))
    if (!p) return false
    samples.start = p.start
    samples.db = p.db.map(v => v ?? NaN)
    for (const k of ['low', 'mid', 'vr', 'at']) samples[k] = p[k] || p.db.map(() => 0)
    return true
  } catch { return false }
}
export const clearProgress = () => { try { localStorage.removeItem(KEY) } catch {} }

/* ---------- keeping the screen on ----------
   A home-screen web app loses the microphone the moment the phone locks, so the night depends on
   the screen staying on. Two ways, both started from the Sleep tap itself (WebKit wants the user's
   gesture for each):
   1. the Screen Wake Lock, re-requested whenever iOS lets go of it;
   2. a tiny video playing a live canvas stream. WebKit does not let the display sleep while a
      video with a live MediaStream plays (a looping file would not do: looping media may sleep).
   `awake` says how it went, for the night screen: 'lock', 'video', or 'none'. */
let keeping = false, video = null, painter = null
export let awake = 'none'
const setAwake = () => { awake = wakeLock && !wakeLock.released ? 'lock' : video && !video.paused ? 'video' : 'none' }

async function lockScreen() {
  if (!navigator.wakeLock) { diag('wakelock-failed', { name: 'unsupported' }); return setAwake() }
  if (wakeLock && !wakeLock.released) return setAwake()
  try {
    wakeLock = await navigator.wakeLock.request('screen')
    // the night ended (or failed to start) while iOS was granting it
    if (!keeping) { wakeLock.release().catch(() => {}); wakeLock = null; return setAwake() }
    diag('wakelock', { visibility: document.visibilityState })
    wakeLock.addEventListener('release', () => {
      diag('wakelock-released', { visibility: document.visibilityState, keeping })
      setAwake()
      // iOS lets go of it (a call, Low Power Mode, the page hidden); ask again while the night runs
      if (keeping && document.visibilityState === 'visible') setTimeout(lockScreen, 1000)
    })
  } catch (e) { diag('wakelock-failed', { name: e?.name, message: e?.message, visibility: document.visibilityState }) }
  setAwake()
}

function startVideo() {
  const played = () => { diag('video-playing', { paused: video?.paused, readyState: video?.readyState }); setAwake() }
  const failed = e => { diag('video-failed', { name: e?.name, message: e?.message }); setAwake() }
  if (video) return video.play().then(played, failed)
  try {
    const c = document.createElement('canvas'); c.width = c.height = 2
    const g = c.getContext('2d'), stream = c.captureStream(1)
    let on = false
    painter = setInterval(() => { on = !on; g.fillStyle = on ? '#000' : '#010101'; g.fillRect(0, 0, 2, 2) }, 1000)
    video = document.createElement('video')
    Object.assign(video, { muted: true, playsInline: true, srcObject: stream })
    video.setAttribute('playsinline', '')
    video.setAttribute('aria-hidden', 'true')
    // on screen (some engines pause what is not), but one pixel and invisible
    Object.assign(video.style, { position: 'fixed', left: '0', top: '0', width: '1px', height: '1px', opacity: '0.01', pointerEvents: 'none', zIndex: '-1' })
    for (const ev of ['pause', 'stalled', 'suspend', 'ended', 'error', 'emptied', 'waiting']) video.addEventListener(ev, () => diag('video-' + ev, { paused: video?.paused, readyState: video?.readyState }))
    document.body.appendChild(video)
    return video.play().then(played, failed)
  } catch (e) { failed(e) }
}

function stopVideo() {
  clearInterval(painter); painter = null
  if (!video) return
  video.pause(); video.srcObject?.getTracks().forEach(t => t.stop()); video.remove(); video = null
}

// From the Sleep tap, before anything is awaited, so both run inside the user's gesture.
export function keepAwake() {
  keeping = true
  lockScreen()
  startVideo()
}

async function openMic() {
  closeMic()   // a reopen replaces the old stream, it does not leave it running beside the new one
  if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
  } catch (e) { diag('mic-failed', { name: e?.name, message: e?.message, visibility: document.visibilityState }); throw e }
  const track = stream.getAudioTracks()[0]
  diag('mic-open', { label: track?.label, settings: track?.getSettings?.(), session: navigator.audioSession?.type })
  for (const ev of ['ended', 'mute', 'unmute']) track?.addEventListener(ev, () => diag('mic-' + ev, { readyState: track.readyState, muted: track.muted, visibility: document.visibilityState }))
  const src = ctx.createMediaStreamSource(stream)
  analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  analyser.smoothingTimeConstant = 0
  src.connect(analyser)
  try {
    if (!ringNode) {
      await ctx.audioWorklet.addModule(ringWorklet)
      ringNode = new AudioWorkletNode(ctx, 'ring', { processorOptions: { rate: 16000, seconds: RING_SEC } })
      const mute = ctx.createGain(); mute.gain.value = 0
      ringNode.connect(mute).connect(ctx.destination)   // pulled by the graph, heard by nobody
    }
    src.connect(ringNode)
  } catch (e) { ringNode = null; diag('clips-unavailable', { message: e?.message }) }   // no clips then; the night is still tracked
  await ctx.resume()
  wallAt0 = Date.now() - ctx.currentTime * 1000
  diag('ctx', { state: ctx.state, sampleRate: ctx.sampleRate, clips: !!ringNode })
}
// muted: iOS took the microphone (a call, Siri, the screen locked); it delivers silence, not the room
export const micLive = () => !!stream && stream.getAudioTracks().some(t => t.readyState === 'live' && !t.muted)
function closeMic() { stream?.getTracks().forEach(t => t.stop()); stream = null; analyser = null }

function push(a) {
  samples.db.push(a.n ? a.db : NaN)
  samples.low.push(a.n ? a.low / a.n : 0)
  samples.mid.push(a.n ? a.mid / a.n : 0)
  const m = a.n ? a.dbs.reduce((s, v) => s + v, 0) / a.n : 0
  samples.vr.push(a.n ? Math.sqrt(a.dbs.reduce((s, v) => s + (v - m) ** 2, 0) / a.n) : 0)
  samples.at.push(a.at)
}

let lastRead = 0, micWasLive = true
function read() {
  const now = Date.now()
  // the page was not running (frozen, hidden, locked): say how long
  if (lastRead && now - lastRead > 3000) diag('stall', { ms: now - lastRead, visibility: document.visibilityState })
  lastRead = now
  const sec = Math.floor((now - samples.start) / 1000)
  // seconds the page was not running are gaps
  while (samples.db.length < sec) { push(acc); acc = fresh() }
  const live = !!analyser && micLive()
  if (live !== micWasLive) { diag(live ? 'mic-live' : 'mic-dead', { visibility: document.visibilityState, ctx: ctx?.state }); micWasLive = live }
  if (!live) return
  const t = new Float32Array(analyser.fftSize), f = new Float32Array(analyser.frequencyBinCount)
  analyser.getFloatTimeDomainData(t)
  analyser.getFloatFrequencyData(f)
  let sum = 0
  for (const v of t) sum += v * v
  if (!sum) return   // exact digital silence: nothing reaches the graph, a gap and not a quiet room
  // dB relative to full scale, +100 to keep it positive; only differences matter
  const db = 20 * Math.log10(Math.sqrt(sum / t.length) || 1e-10) + 100
  const hz = ctx.sampleRate / analyser.fftSize
  let lo = 0, mid = 0, all = 0
  for (let i = Math.ceil(50 / hz); i < Math.min(f.length, 4000 / hz); i++) {
    const p = 10 ** (f[i] / 10), at = i * hz
    all += p
    if (at < 500) lo += p
    else if (at < 3000) mid += p
  }
  acc.n++; acc.db = Math.max(acc.db, db); acc.dbs.push(db)
  acc.low += all ? lo / all : 0; acc.mid += all ? mid / all : 0
  if (lastDb != null) acc.at = Math.max(acc.at, db - lastDb)
  lastDb = db
}

async function onVisible() {
  if (document.visibilityState !== 'visible' || !ctx) return
  await lockScreen()
  if (keeping && video?.paused) video.play().then(() => { diag('video-playing', { again: true }); setAwake() }, e => { diag('video-failed', { again: true, name: e?.name }); setAwake() })
  if (!micLive() && !ringing) { diag('mic-reopen'); try { await openMic() } catch {} }
}

// Call from the Start tap. `resume` continues a night whose page was closed (gap in between).
export async function start({ resume = false } = {}) {
  keepAwake()
  ctx = ctx || new AudioContext()
  ctx.onstatechange = () => diag('ctx', { state: ctx?.state })
  if (!resume) { for (const k of KEYS) samples[k] = []; samples.start = Date.now(); clips.length = 0 }
  acc = fresh(); lastDb = null; lastRead = 0; micWasLive = true
  // no microphone, no night: let go of the screen too
  try { await openMic() } catch (e) { stop(); throw e }
  await lockScreen()
  loadAlarm()
  clearInterval(poll)
  poll = setInterval(read, POLL_MS)
  document.addEventListener('visibilitychange', onVisible)
}

export function stop() {
  clearInterval(poll); poll = null
  read()
  closeMic()
  silence()
  keeping = false
  wakeLock?.release().catch(() => {}); wakeLock = null
  stopVideo(); awake = 'none'
  document.removeEventListener('visibilitychange', onVisible)
  // An open AudioContext keeps the "Now Playing" card on the lock screen; the night is over, so
  // close it. The next Sleep tap makes a new one (the decoded alarm works in any context).
  nowPlaying(null)
  ctx?.close().catch(() => {}); ctx = null; ringNode = null
}

// The lock screen's Now Playing card, which iOS shows while the AudioContext runs: say what it
// is, and make its buttons do nothing, so a tap there cannot pause the night or the alarm.
const ACTIONS = ['play', 'pause', 'stop', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack']
export function nowPlaying(title, artist = '') {
  const ms = navigator.mediaSession
  if (!ms) return
  try {
    if (!title) {
      ms.metadata = null
      ms.playbackState = 'none'
      for (const a of ACTIONS) try { ms.setActionHandler(a, null) } catch {}
      return
    }
    ms.metadata = new MediaMetadata({ title, artist, album: 'mySleep', artwork: [512, 180].map(n => ({ src: new URL(`icon-${n}.png`, location.href).href, sizes: `${n}x${n}`, type: 'image/png' })) })
    ms.playbackState = 'playing'
    for (const a of ACTIONS) try { ms.setActionHandler(a, () => {}) } catch {}
  } catch {}
}

/* ---------- clips ---------- */
function snapshot() {
  return new Promise(res => {
    ringNode.port.onmessage = e => res(e.data)
    ringNode.port.postMessage('snap')
  })
}

// Cut clips of tonight's talking, coughing and snoring while they are still in the 30 s buffer.
// Called every few seconds by the night screen.
export async function collectClips() {
  if (!ringNode || !micLive()) return
  const now = Date.now(), from = Math.max(0, samples.db.length - 90)
  const found = events(slice(samples, from), samples.start + from * 1000)
  for (const e of found) {
    if (!(e.kind in CLIP_LIMITS)) continue
    const end = e.t + e.sec * 1000
    if (e.kind !== 'snore' && now - end < 3000) continue            // let it finish
    if (now - e.t > (RING_SEC - 4) * 1000) continue                 // already out of the buffer
    if (clips.some(c => c.kind === e.kind && Math.abs(c.t - e.t) < 60000)) continue
    if (clips.filter(c => c.kind === e.kind).length >= CLIP_LIMITS[e.kind]) continue
    const a = e.t - 1500, b = Math.min(now, end + 1500, a + 15000)
    const { pcm, at, rate } = await snapshot()
    const bufEnd = wallAt0 + at * 1000, bufStart = bufEnd - (pcm.length / rate) * 1000
    const i = Math.max(0, Math.round((a - bufStart) / 1000 * rate)), j = Math.min(pcm.length, Math.round((b - bufStart) / 1000 * rate))
    if (j - i < rate) continue
    clips.push({ id: crypto.randomUUID().slice(0, 8), t: e.t, kind: e.kind, sec: Math.round((j - i) / rate), blob: new Blob([encodeWav(pcm.subarray(i, j), Math.round(rate))], { type: 'audio/wav' }) })
  }
}

/* ---------- alarm ---------- */
// The alarm is a recording: "Soft Piano Loop" by Ncone (freesound.org #710546, CC0), mono 32 kHz,
// made louder once with a look-ahead limiter (scripts/loud-alarm.mjs, +9 dB, peaks -1 dBFS,
// public/alarm-piano.wav). Loaded when the night starts, so ringing needs no network at 6 am.
// While it rings only a gain curve runs, no compressor: WebKit's added make-up gain and pumped the
// piano, which was heard as steps. The curve is smooth in loudness: from -42 dB, easing into the
// full level at RISE_SEC with no corner, then held there (very loud at full media volume).
const RISE_SEC = 25, FROM_DB = -42
let ringing = null, alarmBuffer = null

function riseCurve() {
  const n = 500, c = new Float32Array(n)
  for (let i = 0; i < n; i++) c[i] = 10 ** (FROM_DB * (1 - i / (n - 1)) ** 2 / 20)
  return c
}

// The recording's bytes are fetched as soon as the app opens, not at the Sleep tap: a smart alarm
// can ring within seconds of starting, and the file is 1.2 MB over Tailscale.
let alarmBytes = null
function fetchAlarm() {
  return fetch('alarm-piano.wav').then(r => { if (!r.ok) throw new Error('server answered ' + r.status); return r.arrayBuffer() })
    .catch(e => { alarmBytes = null; throw e })
}
if (typeof window !== 'undefined') alarmBytes = fetchAlarm()
alarmBytes?.catch(() => {})

// Why the recording is not loaded, if it is not: shown on the alarm screen when the tone rings.
export let alarmProblem = null
let loading = null
function loadAlarm() {
  if (alarmBuffer) return Promise.resolve()
  return loading ||= (async () => {
    try {
      const data = (await (alarmBytes ||= fetchAlarm())).slice(0)   // decoding detaches its input
      // the callback form too: some WebKit builds leave the promise form unsettled
      alarmBuffer = await new Promise((res, rej) => { const p = ctx.decodeAudioData(data, res, rej); p?.then?.(res, rej) })
      alarmProblem = null
      diag('alarm-loaded', { sec: Math.round(alarmBuffer.duration) })
    } catch (e) {
      alarmProblem = (e && (e.message || e.name)) || 'could not decode the recording'
      diag('alarm-load-failed', { problem: alarmProblem })
    } finally { loading = null }
  })()
}

export async function ring() {
  closeMic()
  if (navigator.audioSession) navigator.audioSession.type = 'playback'
  await ctx.resume().catch(() => {})
  // not loaded at bedtime (offline, or it failed): one more try before the tone
  if (!alarmBuffer) await Promise.race([loadAlarm(), new Promise(r => setTimeout(r, 4000))])
  const gain = ctx.createGain()
  gain.gain.setValueCurveAtTime(riseCurve(), ctx.currentTime, RISE_SEC)
  gain.connect(ctx.destination)
  let src
  if (alarmBuffer) {
    src = ctx.createBufferSource()
    src.buffer = alarmBuffer
    src.loop = true
  } else {
    src = ctx.createOscillator()   // the recording did not load
    src.frequency.value = 660
  }
  src.connect(gain)
  src.start()
  ringing = { src, gain, tone: !alarmBuffer }
  diag('ring', { recording: !!alarmBuffer, problem: alarmProblem, ctx: ctx.state, session: navigator.audioSession?.type, visibility: document.visibilityState })
}

export function silence() {
  if (!ringing) return
  diag('silence')
  try { ringing.src.stop() } catch {}
  ringing.gain.disconnect()
  ringing = null
}

// Snooze: back to listening (the tap allows opening the mic again).
export async function snooze() {
  silence()
  try { await openMic() } catch {}
}

export const ringingTone = () => !!ringing?.tone

// Once a minute from the night screen: the state of everything that keeps the night going.
export function heartbeat() {
  const last60 = samples.db.slice(-60)
  diag('beat', {
    sec: samples.db.length, missing60: last60.filter(v => !Number.isFinite(v)).length,
    db: Math.round(Math.max(...last60.filter(Number.isFinite), -1)), live: micLive(), ctx: ctx?.state,
    awake, lock: !!wakeLock && !wakeLock.released, video: video ? (video.paused ? 'paused' : 'playing') : 'none',
    visibility: document.visibilityState, clips: clips.length, session: navigator.audioSession?.type
  })
}
