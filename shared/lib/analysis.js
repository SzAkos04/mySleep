// Turns a night of per-second sound readings into what happened: asleep/awake, a rough
// restful/light estimate, and sounds (snoring, talking, coughing, movement, room noise).
//
// Input `f`: arrays with one value per second from the start of the night (mySleep Night's log,
// ios/NightKit Features.swift):
//   db   loudest reading of the second (relative dB; NaN = not recorded)
//   low  share of the sound's energy under 500 Hz
//   mid  share between 500 and 3000 Hz (speech)
//   vr   spread of the 100 ms readings within the second, dB (syllables make it move)
//   at   largest rise from one 100 ms reading to the next, dB (a cough starts with a jump)
//
// Method (docs/dev/MVP.md, SOUND_ANALYSIS.md): a second well above the room's own noise floor
// is part of a sound. Each sound is told apart by its traits; movement per 30-s epoch, smoothed
// over neighbouring epochs the way wrist actigraphy does it (Cole-Kripke weights), separates
// awake from asleep. Sleep stages proper are not attempted: sound cannot tell them apart well.

// Tuning knobs. They are set on paper; real nights in a real bedroom will move them.
export const LOUD_DB = 6           // least dB above the noise floor that makes a second part of a sound
export const WOBBLE_K = 5          // ...or this many times the room's own wobble (floor to 75th percentile)
export const LOUD_MAX = 12         // ...but never more: a rustle in bed is 15 dB and up
export const FLOOR_PCT = 0.1       // noise floor: this percentile of the last FLOOR_WIN seconds
export const FLOOR_WIN = 600
export const SNORE_LOW = 0.5       // share of energy under 500 Hz for a snore (0.54–0.58 measured)
export const SNORE_MAX_LEN = 4     // a snore lasts a few seconds at most
export const SNORE_GAP = [2, 9]    // seconds from one snore's start to the next (a breath)
export const SNORE_RUN = 3         // snores in a row before we call it snoring
// Measured with scripts/replay.mjs on speech (macOS say), and rough synthetic snoring and
// coughing: every kind jumps; what differs is how sharply, where the energy sits, and length.
export const SNORE_MAX_JUMP = 22   // a snore swells (13–17 dB measured); speech and coughs snap on
export const TALK_JUMP = 20        // syllables start sharply (30–37 dB measured)
export const TALK_VAR = 8          // ...and swing within each second (11–15 dB measured)
export const COUGH_JUMP = 25       // a cough is the sharpest start of all (38 dB measured)
export const COUGH_MID = 0.5       // ...with its energy above 500 Hz (0.66 measured; speech 0.3–0.45)
export const COUGH_MAX_LEN = 1
export const NOISE_MIN_LEN = 20    // one sound this long is the room (fan, traffic), not you
export const MERGE_GAP = 3         // sounds of one kind this close are one event
export const WAKE_MOVE = 1.5       // weighted movement seconds per epoch that score awake
export const GAP_SEC = 15          // seconds without data that make an epoch a gap
export const ONSET_EPOCHS = 20     // 10 min asleep in a row = fell asleep
export const WAKE_EPOCHS = 4       // 2 min awake in a row = a wake-up; shorter runs are ignored
export const RESTFUL_EPOCHS = 20   // 10 min asleep without movement, talk or cough = restful
export const STIR_SEC = 3          // movement seconds in the last minute that ring the smart alarm
export const EPOCH = 30

export const QUIET = 0, MOVE = 1, SNORE = 2, TALK = 3, COUGH = 4, NOISE = 5
const NAME = ['quiet', 'move', 'snore', 'talk', 'cough', 'noise']
const CK = [1.06, 0.54, 0.58, 0.76, 2.3, 0.74, 0.67]   // epochs -4 .. +2
const CK_SUM = CK.reduce((a, b) => a + b)

function percentile(vals, p) {
  if (!vals.length) return NaN
  vals.sort((a, b) => a - b)
  return vals[Math.min(vals.length - 1, Math.floor(p * vals.length))]
}

// One floor per epoch, from the seconds before and including it, and the margin above it that
// makes a second loud: LOUD_DB, or more in a room whose level wobbles by itself (a very quiet room
// sits at the microphone's own noise: 21 dB, moving 3-4 dB for nothing).
export function noiseFloors(db) {
  const E = Math.ceil(db.length / EPOCH), out = new Float64Array(E)
  out.margin = new Float64Array(E)
  for (let e = 0; e < E; e++) {
    const hi = Math.min(db.length, (e + 1) * EPOCH), lo = Math.max(0, hi - FLOOR_WIN)
    const vals = []
    for (let s = lo; s < hi; s++) if (Number.isFinite(db[s])) vals.push(db[s])
    out[e] = percentile(vals, FLOOR_PCT)
    out.margin[e] = Math.min(LOUD_MAX, Math.max(LOUD_DB, WOBBLE_K * (percentile(vals, 0.75) - out[e])))
  }
  return out
}

// Every sound of the night: { start, end (seconds), kind, low, mid, vr, at }.
export function sounds(f) {
  const { db } = f, floors = noiseFloors(db), out = []
  for (let s = 0; s < db.length; s++) {
    if (!(db[s] > floors[Math.floor(s / EPOCH)] + floors.margin[Math.floor(s / EPOCH)])) continue
    const last = out[out.length - 1]
    if (last && last.end === s) {
      last.end++; last.low += f.low[s] || 0; last.mid += f.mid?.[s] || 0; last.vr += f.vr?.[s] || 0
      last.at = Math.max(last.at, f.at?.[s] || 0)
    } else out.push({ start: s, end: s + 1, low: f.low[s] || 0, mid: f.mid?.[s] || 0, vr: f.vr?.[s] || 0, at: f.at?.[s] || 0 })
  }
  for (const b of out) {
    const len = b.end - b.start
    b.low /= len; b.mid /= len; b.vr /= len
    b.kind = len >= NOISE_MIN_LEN ? NOISE
      : len <= COUGH_MAX_LEN && b.at >= COUGH_JUMP && b.mid >= COUGH_MID ? COUGH
      : b.at >= TALK_JUMP && b.vr >= TALK_VAR ? TALK
      : MOVE
    b.snorish = b.kind === MOVE && len <= SNORE_MAX_LEN && b.low >= SNORE_LOW && b.at < SNORE_MAX_JUMP
  }
  // chains of snore-like sounds at breathing pace
  let chain = []
  const flush = () => { if (chain.length >= SNORE_RUN) for (const b of chain) b.kind = SNORE; chain = [] }
  for (const b of out) {
    if (!b.snorish) { if (b.kind !== MOVE || b.end - b.start > SNORE_MAX_LEN) flush(); continue }
    const prev = chain[chain.length - 1]
    if (prev && (b.start - prev.start < SNORE_GAP[0] || b.start - prev.start > SNORE_GAP[1])) flush()
    chain.push(b)
  }
  flush()
  return out
}

// Per second: QUIET, MOVE, SNORE, TALK, COUGH or NOISE.
export function classify(f) {
  const kind = new Uint8Array(f.db.length)
  for (const b of sounds(f)) kind.fill(b.kind, b.start, b.end)
  return kind
}

// The night's events worth listing (not plain movement): sounds of one kind close together
// become one, so a snoring episode or a sentence is one line. `start` is the tracking start (ms).
export function events(f, start) {
  const out = []
  for (const b of sounds(f)) {
    if (b.kind === MOVE) continue
    const last = out.findLast(e => e.kind === NAME[b.kind])
    const gap = b.kind === SNORE ? SNORE_GAP[1] : MERGE_GAP
    if (last && b.start - last.end <= gap) last.end = b.end
    else out.push({ kind: NAME[b.kind], start: b.start, end: b.end })
  }
  return out.sort((a, b) => a.start - b.start)
    .map(e => ({ t: start + e.start * 1000, kind: e.kind, sec: e.end - e.start }))
}

export function epochs(f) {
  const kind = classify(f), db = f.db, E = Math.ceil(db.length / EPOCH), out = []
  for (let e = 0; e < E; e++) {
    const ep = { move: 0, snore: 0, talk: 0, cough: 0, noise: 0, gap: 0 }
    for (let s = e * EPOCH; s < Math.min(db.length, (e + 1) * EPOCH); s++) {
      if (!Number.isFinite(db[s])) ep.gap++
      else if (kind[s]) ep[NAME[kind[s]]]++
    }
    if (e === E - 1) ep.gap += (e + 1) * EPOCH - db.length   // a short last epoch
    out.push(ep)
  }
  return out
}

// Movement that counts towards being awake: a cough usually wakes you, talking in your sleep does not.
const restless = ep => ep.move + ep.cough

// 'w' awake, 'l' light, 'd' restful, 'g' no data, per epoch.
export function sleepWake(eps) {
  const E = eps.length
  const awake = eps.map((_, e) => {
    let score = 0
    for (let k = -4; k <= 2; k++) score += CK[k + 4] * (eps[e + k] ? restless(eps[e + k]) : 0)
    return score / CK_SUM > WAKE_MOVE
  })
  // fell asleep: the first run of ONSET_EPOCHS asleep (gaps break it)
  let onset = -1
  for (let e = 0, run = 0; e < E; e++) {
    run = !awake[e] && eps[e].gap <= GAP_SEC ? run + 1 : 0
    if (run === ONSET_EPOCHS) { onset = e - ONSET_EPOCHS + 1; break }
  }
  const st = eps.map((ep, e) => ep.gap > GAP_SEC ? 'g' : onset < 0 || e < onset || awake[e] ? 'w' : 's')
  if (onset < 0) return { states: st.join(''), onset, end: -1 }
  // Runs too short to count take their neighbours' state: a quiet minute while getting up is not
  // sleep, a single restless minute is not a wake-up. Sleep first, so the night ends where it should.
  shortRuns(st, 's', 'w', onset + ONSET_EPOCHS, E)
  const end = st.lastIndexOf('s') + 1
  shortRuns(st, 'w', 's', onset, end)
  // restful: long stretches of sleep with nothing from you in them
  for (let e = 0; e < E; e++) {
    if (st[e] !== 's') continue
    let f = e
    const calm = i => st[i] === 's' && !restless(eps[i]) && !eps[i].talk
    while (f < E && calm(f)) f++
    st.fill(f - e >= RESTFUL_EPOCHS ? 'd' : 'l', e, Math.max(f, e + 1))
    e = Math.max(f, e + 1) - 1
  }
  return { states: st.join(''), onset, end }
}

function shortRuns(st, from, to, lo, hi) {
  for (let e = lo; e < hi; e++) {
    if (st[e] !== from) continue
    let f = e
    while (f < hi && st[f] === from) f++
    if (f - e < WAKE_EPOCHS && st[e - 1] !== 'g' && st[f] !== 'g') st.fill(to, e, f)
    e = f
  }
}

const count = (s, re) => (s.match(re) || []).length

export function summarize(f, start) {
  const eps = epochs(f)
  const { states, onset, end } = sleepWake(eps)
  const mid = onset >= 0 ? states.slice(onset, end) : ''
  const dbMin = []
  for (let s = 0; s < f.db.length; s += 60) {
    let m = -Infinity
    for (let i = s; i < Math.min(f.db.length, s + 60); i++) if (f.db[i] > m) m = f.db[i]
    dbMin.push(Number.isFinite(m) ? Math.round(m) : null)
  }
  const ev = events(f, start)
  return {
    on: onset >= 0 ? start + onset * EPOCH * 1000 : null,
    wakes: count(mid, /w+/g),
    awakeMin: count(mid, /w/g) / 2,
    asleepMin: count(states, /[ld]/g) / 2,
    restfulMin: count(states, /d/g) / 2,
    snoreMin: eps.filter(ep => ep.snore > 0).length / 2,
    talks: ev.filter(e => e.kind === 'talk').length,
    coughs: ev.filter(e => e.kind === 'cough').length,
    events: ev,
    timeline: {
      start, states,
      events: eps.map(ep => ep.cough ? 'c' : ep.talk ? 't' : ep.snore ? 'n' : ep.move >= 2 ? 'm' : ep.noise >= 15 ? 'x' : '.').join(''),
      db: dbMin
    }
  }
}

// Smart alarm: is the sleeper moving right now? Looks at the last 11 minutes only, so it is
// cheap to call every few seconds.
export function stirring(f) {
  const from = Math.max(0, f.db.length - 660)
  const kind = classify(slice(f, from))
  let n = 0
  for (let s = Math.max(0, kind.length - 60); s < kind.length; s++) if (kind[s] === MOVE || kind[s] === COUGH) n++
  return n >= STIR_SEC
}

export const slice = (f, from, to) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Array.isArray(v) || ArrayBuffer.isView(v) ? v.slice(from, to) : v]))
