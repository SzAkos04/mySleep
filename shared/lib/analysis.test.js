import { describe, it, expect } from 'vitest'
import { summarize, stirring, events, slice } from './analysis.js'

// A synthetic 8-hour night: a quiet room at ~30 dB with a little jitter.
function night(hours = 8) {
  const n = hours * 3600, f = { db: new Array(n), low: new Array(n), mid: new Array(n), vr: new Array(n), at: new Array(n) }
  let seed = 1
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  for (let s = 0; s < n; s++) { f.db[s] = 30 + rnd() * 2; f.low[s] = 0.3; f.mid[s] = 0.3; f.vr[s] = 1; f.at[s] = 1 }
  // a sound: movement by default (broadband, steady, no jump)
  f.burst = (s, len, o = {}) => { for (let i = s; i < s + len; i++) { f.db[i] = o.db ?? 45; f.low[i] = o.low ?? 0.3; f.mid[i] = o.mid ?? 0.3; f.vr[i] = o.vr ?? 1; f.at[i] = o.at ?? 2 } }
  return f
}
// traits as scripts/replay.mjs measured them (SOUND_ANALYSIS.md)
const snore = { db: 48, low: 0.57, mid: 0.33, vr: 9.7, at: 14 }, talk = { db: 44, low: 0.45, mid: 0.4, vr: 13, at: 32 }, cough = { db: 55, low: 0.17, mid: 0.66, vr: 13.6, at: 38 }

describe('summarize', () => {
  it('finds sleep onset, one wake-up, and snoring that is not movement', () => {
    const f = night()
    for (let s = 0; s < 15 * 60; s += 20) f.burst(s, 2)                   // awake in bed, tossing: 15 min
    for (let s = 7200; s < 7200 + 5 * 60; s += 15) f.burst(s, 3)          // a 5-minute wake-up at 2h
    for (let s = 3 * 3600; s < 3 * 3600 + 600; s += 4) f.burst(s, 2, snore) // 10 min of snoring at 3h
    for (let s = 4 * 3600; s < 8 * 3600; s += 600) f.burst(s, 1)          // a turn every 10 min: still asleep
    for (let s = 8 * 3600 - 900; s < 8 * 3600 - 40; s += 20) f.burst(s, 3) // up and about for 15 min before Stop

    const r = summarize(f, 0)
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

  it('estimates restful sleep only where nothing happened for 10 minutes', () => {
    const f = night()
    // asleep from the start; a turn every 5 minutes for the first 4 hours, nothing after
    for (let s = 1800; s < 4 * 3600; s += 300) f.burst(s, 1)
    const r = summarize(f, 0)
    const st = r.timeline.states
    expect(st.slice(60, 470)).not.toContain('d')        // turns every 5 min: light
    expect(st.slice(500, 950)).toMatch(/^d+$/)           // the quiet second half: restful
    expect(r.restfulMin).toBeGreaterThan(200)
  })

  it('marks missing seconds as gaps and does not count them as sleep', () => {
    const f = night()
    for (let s = 3600; s < 7200; s++) f.db[s] = NaN
    const r = summarize(f, 0)
    expect(r.timeline.states.slice(120, 240)).toBe('g'.repeat(120))
    expect(r.asleepMin).toBeLessThanOrEqual(7 * 60)
  })
})

// A very quiet room (a real one, 2026-10-30: floor 21 dB, close to the microphone's own noise) whose
// level wobbles by itself: now and then a second is 7-9 dB up, with nobody moving.
function wobbly(hours = 4) {
  const f = night(hours); let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  for (let s = 0; s < f.db.length; s++) f.db[s] = 21 + rnd() * 3 + (rnd() < 0.08 ? 7 + rnd() * 2 : 0)
  return f
}

describe('a quiet room that wobbles by itself', () => {
  it('is not mistaken for someone awake', () => {
    const r = summarize(wobbly(), 0)
    expect(r.wakes).toBeLessThanOrEqual(1)
    expect(r.asleepMin).toBeGreaterThan(3.5 * 60)
  })

  it('still hears real movement in it', () => {
    const f = wobbly()
    for (let s = 2 * 3600; s < 2 * 3600 + 5 * 60; s += 15) f.burst(s, 3, { db: 45 })   // 5 minutes of tossing
    const r = summarize(f, 0)
    expect(r.wakes).toBe(1)
    expect(r.awakeMin).toBeGreaterThanOrEqual(4)
  })
})

describe('light sleep towards the morning', () => {
  it('turning over every quarter hour (a few movement seconds a minute) is not waking up', () => {
    const f = night(6)
    for (let s = 3 * 3600; s < 6 * 3600; s += 900) for (let t = s; t < s + 180; t += 15) f.burst(t, 1)   // 3 min of rustling (2 s of movement in each 30), every quarter hour
    const r = summarize(f, 0)
    expect(r.wakes).toBe(0)
    expect(r.asleepMin).toBeGreaterThan(5 * 60 + 30)
  })
})

describe('sounds', () => {
  it('tells talking, coughing, snoring and room noise apart, and lists them as events', () => {
    const f = night(2)
    f.burst(1000, 4, talk); f.burst(1006, 3, talk)                        // one sentence, a short pause
    f.burst(2000, 1, cough); f.burst(2002, 1, cough)                      // a double cough
    for (let s = 3000; s < 3060; s += 4) f.burst(s, 2, snore)             // a minute of snoring
    f.burst(5000, 90, { db: 40, vr: 0.5 })                                // a car passing for 90 s
    f.burst(6000, 2)                                                      // a turn: not an event
    const ev = events(f, 0)
    expect(ev.map(e => e.kind)).toEqual(['talk', 'cough', 'snore', 'noise'])
    expect(ev[0]).toEqual({ t: 1000000, kind: 'talk', sec: 9 })
    expect(ev[2].sec).toBeGreaterThanOrEqual(56)
    const r = summarize(f, 0)
    expect(r.talks).toBe(1)
    expect(r.coughs).toBe(1)
  })

  it('does not count talking or room noise as being awake', () => {
    const f = night()
    for (let s = 2 * 3600; s < 2 * 3600 + 600; s += 30) f.burst(s, 5, talk)  // talking in your sleep, 10 min
    f.burst(5 * 3600, 1200, { db: 40, vr: 0.5 })                              // a fan for 20 min
    expect(summarize(f, 0).wakes).toBe(0)
  })
})

describe('stirring', () => {
  it('is true after movement in the last minute, false in quiet, snoring or talking', () => {
    const at = f => stirring(slice(f, 0, 3600))
    const a = night()
    expect(at(a)).toBe(false)
    for (let s = 3600 - 50; s < 3600; s += 10) a.burst(s, 2)
    expect(at(a)).toBe(true)

    const b = night()
    for (let s = 3600 - 60; s < 3600; s += 4) b.burst(s, 2, snore)
    expect(at(b)).toBe(false)

    const c = night()
    for (let s = 3600 - 60; s < 3600; s += 10) c.burst(s, 4, talk)
    expect(at(c)).toBe(false)
  })
})
