// Turns a night of per-second sound readings into asleep/awake, snoring and movement.
// Input: `db` (loudness, relative dB, NaN where nothing was recorded) and `low` (share of the
// sound's energy under 500 Hz), one value per second from the start of tracking.
//
// Method (docs/dev/MVP.md): a second well above the room's own noise floor is a sound event.
// Short low-pitched events repeating at breathing pace are snoring; every other event counts as
// movement. Movement per 30-s epoch, smoothed over neighbouring epochs the way wrist actigraphy
// does it (Cole-Kripke weights), separates awake from asleep. No sleep stages: sound cannot tell
// them apart well enough to be worth showing.

// Tuning knobs. They are set on paper; real nights in a real bedroom will move them.
export const LOUD_DB = 6           // dB above the noise floor that makes a second an event
export const FLOOR_PCT = 0.1       // noise floor: this percentile of the last FLOOR_WIN seconds
export const FLOOR_WIN = 600
export const SNORE_LOW = 0.55      // share of energy under 500 Hz for a snore
export const SNORE_MAX_LEN = 4     // a snore lasts a few seconds at most
export const SNORE_GAP = [2, 9]    // seconds from one snore's start to the next (a breath)
export const SNORE_RUN = 3         // snores in a row before we call it snoring
export const WAKE_MOVE = 1.5       // weighted movement seconds per epoch that score awake
export const GAP_SEC = 15          // seconds without data that make an epoch a gap
export const ONSET_EPOCHS = 20     // 10 min asleep in a row = fell asleep
export const WAKE_EPOCHS = 4       // 2 min awake in a row = a wake-up; shorter runs are ignored
export const STIR_SEC = 3          // movement seconds in the last minute that ring the smart alarm
export const EPOCH = 30

const QUIET = 0, MOVE = 1, SNORE = 2
const CK = [1.06, 0.54, 0.58, 0.76, 2.3, 0.74, 0.67]   // epochs -4 .. +2
const CK_SUM = CK.reduce((a, b) => a + b)

function percentile(vals, p) {
  if (!vals.length) return NaN
  vals.sort((a, b) => a - b)
  return vals[Math.min(vals.length - 1, Math.floor(p * vals.length))]
}

// One floor per epoch, from the seconds before and including it.
export function noiseFloors(db) {
  const E = Math.ceil(db.length / EPOCH), out = new Float64Array(E)
  for (let e = 0; e < E; e++) {
    const hi = Math.min(db.length, (e + 1) * EPOCH), lo = Math.max(0, hi - FLOOR_WIN)
    const vals = []
    for (let s = lo; s < hi; s++) if (Number.isFinite(db[s])) vals.push(db[s])
    out[e] = percentile(vals, FLOOR_PCT)
  }
  return out
}

// Per second: QUIET, MOVE or SNORE.
export function classify(db, low) {
  const n = db.length, floors = noiseFloors(db), kind = new Uint8Array(n)
  const bursts = []
  for (let s = 0; s < n; s++) {
    const f = floors[Math.floor(s / EPOCH)]
    if (!(db[s] > f + LOUD_DB)) continue
    const last = bursts[bursts.length - 1]
    if (last && last.end === s) { last.end++; last.low += low[s] || 0 }
    else bursts.push({ start: s, end: s + 1, low: low[s] || 0 })
  }
  for (const b of bursts) {
    b.low /= b.end - b.start
    b.snorish = b.end - b.start <= SNORE_MAX_LEN && b.low >= SNORE_LOW
  }
  // chains of snore-like bursts at breathing pace
  let chain = []
  const flush = () => { if (chain.length >= SNORE_RUN) for (const b of chain) b.snore = true; chain = [] }
  for (const b of bursts) {
    if (!b.snorish) { flush(); continue }
    const prev = chain[chain.length - 1]
    const gap = prev ? b.start - prev.start : 0
    if (prev && (gap < SNORE_GAP[0] || gap > SNORE_GAP[1])) flush()
    chain.push(b)
  }
  flush()
  for (const b of bursts) kind.fill(b.snore ? SNORE : MOVE, b.start, b.end)
  return kind
}

export function epochs(db, low) {
  const kind = classify(db, low), E = Math.ceil(db.length / EPOCH), out = []
  for (let e = 0; e < E; e++) {
    const ep = { move: 0, snore: 0, gap: 0 }
    for (let s = e * EPOCH; s < Math.min(db.length, (e + 1) * EPOCH); s++) {
      if (!Number.isFinite(db[s])) ep.gap++
      else if (kind[s] === MOVE) ep.move++
      else if (kind[s] === SNORE) ep.snore++
    }
    if (e === E - 1) ep.gap += (e + 1) * EPOCH - db.length   // a short last epoch
    out.push(ep)
  }
  return out
}

// 's' asleep, 'w' awake, 'g' no data, per epoch.
export function sleepWake(eps) {
  const E = eps.length
  const awake = eps.map((_, e) => {
    let score = 0
    for (let k = -4; k <= 2; k++) score += CK[k + 4] * (eps[e + k]?.move || 0)
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

export function summarize(db, low, start) {
  const eps = epochs(db, low)
  const { states, onset, end } = sleepWake(eps)
  const mid = onset >= 0 ? states.slice(onset, end) : ''
  const dbMin = []
  for (let s = 0; s < db.length; s += 60) {
    let m = -Infinity
    for (let i = s; i < Math.min(db.length, s + 60); i++) if (db[i] > m) m = db[i]
    dbMin.push(Number.isFinite(m) ? Math.round(m) : null)
  }
  return {
    on: onset >= 0 ? start + onset * EPOCH * 1000 : null,
    wakes: (mid.match(/w+/g) || []).length,
    awakeMin: (mid.match(/w/g) || []).length / 2,
    asleepMin: (states.match(/s/g) || []).length / 2,
    snoreMin: eps.filter(ep => ep.snore > 0).length / 2,
    timeline: {
      start, states,
      events: eps.map(ep => ep.snore ? 'n' : ep.move >= 2 ? 'm' : '.').join(''),
      db: dbMin
    }
  }
}

// Smart alarm: is the sleeper moving right now? Looks at the last 11 minutes only, so it is
// cheap to call every few seconds.
export function stirring(db, low) {
  const from = Math.max(0, db.length - 660)
  const kind = classify(db.slice(from), low.slice(from))
  let n = 0
  for (let s = Math.max(0, kind.length - 60); s < kind.length; s++) if (kind[s] === MOVE) n++
  return n >= STIR_SEC
}
