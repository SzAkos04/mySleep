import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { summarize } from './analysis.js'

// Real data, not a simulation: two hours of the night of 2026-10-29 as mySleep Night heard it
// (fixtures/real-night.json; per-second numbers, no audio). The sleeper reports sleeping calmly
// through the night and the morning, with only small awakenings. A very quiet room: the floor is
// ~21 dB, close to the microphone's own noise. Tune the knobs in analysis.js from real nights like this.
const real = JSON.parse(readFileSync(new URL('./fixtures/real-night.json', import.meta.url)))
const hour = k => ({ ...real[k], db: real[k].db.map(v => v ?? NaN) })

describe('a real night in a very quiet room', () => {
  it('sleeps through the small hours: no wake-up in an hour of calm', () => {
    const r = summarize(hour('night'), 0)
    expect(r.wakes).toBe(0)
    expect(r.awakeMin).toBeLessThanOrEqual(2)
    expect(r.asleepMin).toBeGreaterThanOrEqual(55)
  })

  it('does not wake the sleeper in the morning light, with the daytime noise coming up', () => {
    const r = summarize(hour('morning'), 0)
    expect(r.wakes).toBeLessThanOrEqual(1)
    expect(r.awakeMin).toBeLessThanOrEqual(5)
    expect(r.asleepMin).toBeGreaterThanOrEqual(40)
  })
})
