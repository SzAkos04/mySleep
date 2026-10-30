import { describe, it, expect } from 'vitest'
import { nightRecord, corrected } from './night.js'

const at = (h, m, day = 28) => new Date(2026, 9, day, h, m).getTime()

describe('nightRecord', () => {
  // 8 quiet hours, as the tracker leaves them; the first 15 minutes tossing
  const samples = { start: at(23, 0), db: [], low: [], mid: [], vr: [], at: [] }
  for (let s = 0; s < 8 * 3600; s++) {
    const moving = s < 900 && s % 20 < 2
    samples.db.push(moving ? 45 : 30 + (s % 7) / 4); samples.low.push(0.3); samples.mid.push(0.3); samples.vr.push(1); samples.at.push(moving ? 2 : 1)
  }
  const tr = { nightId: '2026-10-28', start: samples.start, ringAt: at(7, 0, 29) }
  const diag = { events: 9, lockOk: 1 }

  it('is what the morning shows: the analysis of the samples, with times', () => {
    const n = nightRecord({ tr, samples, end: at(7, 0, 29), ringing: null, diag })
    expect(n).toMatchObject({ id: '2026-10-28', bed: samples.start, wake: at(7, 0, 29), clips: [], diag, wakes: 0 })
    expect(n.on - samples.start).toBeGreaterThan(10 * 60000)
    expect(n.asleepMin).toBeGreaterThan(7 * 60)
    expect(n.timeline.states.length).toBe(8 * 120)
    expect(n).not.toHaveProperty('alarm')
  })
  it('keeps when the alarm rang and how early', () => {
    const n = nightRecord({ tr, samples, end: at(6, 40, 29), ringing: { at: at(6, 38, 29), early: 22 }, diag })
    expect(n.alarm).toEqual({ at: at(6, 38, 29), early: 22 })
  })
})

describe('corrected: a night’s times put right by hand', () => {
  // in bed 23:00, asleep 23:15, up 07:00, 5 min awake in the night
  const n = { id: '2026-10-28', bed: at(23, 0), on: at(23, 15), wake: at(7, 0, 29), awakeMin: 5, asleepMin: 460 }
  it('untouched, the analysed minutes stand', () => {
    expect(corrected(n, { bed: '23:00', on: '23:15', wake: '07:00' })).toEqual({ night: n })
  })
  it('new times: the sleep is counted from them, less the time awake', () => {
    const r = corrected(n, { bed: '23:00', on: '23:45', wake: '06:45' })
    expect(r.night).toMatchObject({ bed: at(23, 0), on: at(23, 45), wake: at(6, 45, 29), asleepMin: 7 * 60 - 5 })
  })
  it('asleep after midnight and up after noon: both the next day', () => {
    const r = corrected(n, { bed: '23:00', on: '00:30', wake: '12:30' })
    expect(r.night).toMatchObject({ on: at(0, 30, 29), wake: at(12, 30, 29), asleepMin: 12 * 60 - 5 })
  })
  it('no sleep time: nothing asleep', () => {
    expect(corrected(n, { bed: '23:00', on: '', wake: '07:00' }).night).toMatchObject({ on: null, asleepMin: 0 })
  })
  it('a cleared bed or wake time is refused (a time input can be emptied)', () => {
    expect(corrected(n, { bed: '', on: '23:15', wake: '07:00' }).error).toMatch(/need a time/)
    expect(corrected(n, { bed: '23:00', on: '23:15', wake: '' }).error).toMatch(/need a time/)
  })
  it('asleep before bed or after waking is refused, not saved', () => {
    expect(corrected(n, { bed: '23:00', on: '22:30', wake: '07:00' })).toEqual({ error: 'Falling asleep has to be between going to bed and waking up.' })
    expect(corrected(n, { bed: '23:00', on: '07:30', wake: '07:00' }).error).toBeTruthy()
  })
})
