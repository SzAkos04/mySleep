import { describe, it, expect } from 'vitest'
import { summarize, stirring } from './analysis.js'

// A synthetic 8-hour night: a quiet room at ~30 dB with a little jitter.
function night() {
  const n = 8 * 3600, db = new Array(n), low = new Array(n)
  let seed = 1
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  for (let s = 0; s < n; s++) { db[s] = 30 + rnd() * 2; low[s] = 0.3 }
  const burst = (s, len, d = 45, l = 0.3) => { for (let i = s; i < s + len; i++) { db[i] = d; low[i] = l } }
  return { db, low, burst, n }
}

describe('summarize', () => {
  it('finds sleep onset, one wake-up, and snoring that is not movement', () => {
    const { db, low, burst } = night()
    for (let s = 0; s < 15 * 60; s += 20) burst(s, 2)                   // awake in bed, tossing: 15 min
    for (let s = 7200; s < 7200 + 5 * 60; s += 15) burst(s, 3)          // a 5-minute wake-up at 2h
    for (let s = 3 * 3600; s < 3 * 3600 + 600; s += 4) burst(s, 2, 48, 0.8)   // 10 min of snoring at 3h
    for (let s = 4 * 3600; s < 8 * 3600; s += 600) burst(s, 1)          // a turn every 10 min: still asleep
    for (let s = 8 * 3600 - 900; s < 8 * 3600 - 40; s += 25) burst(s, 2) // up for 15 min before Stop, a quiet half minute at the end

    const r = summarize(db, low, 0)
    expect(r.on / 60000).toBeGreaterThanOrEqual(14)
    expect(r.on / 60000).toBeLessThanOrEqual(19)
    expect(r.wakes).toBe(1)
    expect(r.awakeMin).toBeGreaterThanOrEqual(4)
    expect(r.awakeMin).toBeLessThanOrEqual(9)
    expect(r.snoreMin).toBeGreaterThanOrEqual(9)
    expect(r.snoreMin).toBeLessThanOrEqual(11)
    expect(r.asleepMin).toBeGreaterThan(7 * 60 - 15)
    expect(r.timeline.states.endsWith('w')).toBe(true)
    expect(r.timeline.states.length).toBe(960)
    expect(r.timeline.db.length).toBe(480)
  })

  it('marks missing seconds as gaps and does not count them as sleep', () => {
    const { db, low } = night()
    for (let s = 3600; s < 7200; s++) db[s] = NaN
    const r = summarize(db, low, 0)
    expect(r.timeline.states.slice(120, 240)).toBe('g'.repeat(120))
    expect(r.asleepMin).toBeLessThanOrEqual(7 * 60)
  })
})

describe('stirring', () => {
  it('is true after movement in the last minute, false in quiet or snoring', () => {
    const a = night()
    expect(stirring(a.db.slice(0, 3600), a.low.slice(0, 3600))).toBe(false)
    for (let s = 3600 - 50; s < 3600; s += 10) a.burst(s, 2)
    expect(stirring(a.db.slice(0, 3600), a.low.slice(0, 3600))).toBe(true)

    const b = night()
    for (let s = 3600 - 60; s < 3600; s += 4) b.burst(s, 2, 48, 0.8)
    expect(stirring(b.db.slice(0, 3600), b.low.slice(0, 3600))).toBe(false)
  })
})
