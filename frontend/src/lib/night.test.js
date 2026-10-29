import { describe, it, expect, vi } from 'vitest'
import { alarmPlan, shouldRing, heardLabel, windowLabel, snoozePlan, stoppedAt, nightRecord, micErrorMessage, SMART_MIN, SNOOZE_MIN } from './night.js'

const at = (h, m, day = 28) => new Date(2026, 9, day, h, m).getTime()
const settings = { alarm: true, smart: true, wake: '06:45' }

describe('alarmPlan', () => {
  it('rings at the next wake time; smart opens a 30-minute window before it', () => {
    expect(alarmPlan({ ...settings, smart: false }, at(23, 0))).toEqual({ at: at(6, 45, 29), from: at(6, 45, 29) })
    expect(alarmPlan(settings, at(23, 0))).toEqual({ at: at(6, 45, 29), from: at(6, 15, 29) })
    expect(SMART_MIN).toBe(30)
  })
  it('after midnight, still this morning; after the wake time, tomorrow', () => {
    expect(alarmPlan(settings, at(1, 0, 29)).at).toBe(at(6, 45, 29))
    expect(alarmPlan(settings, at(6, 50, 29)).at).toBe(at(6, 45, 30))
  })
  it('inside the window already: the window starts now, not in the past', () => {
    const p = alarmPlan(settings, at(6, 30, 29))
    expect(p.at).toBe(at(6, 45, 29))
    expect(p.from).toBe(at(6, 30, 29))
  })
  it('plans nothing with the alarm off', () => {
    expect(alarmPlan({ ...settings, alarm: false }, at(23, 0))).toBeNull()
  })
})

describe('shouldRing', () => {
  const tr = { ringFrom: at(6, 15, 29), ringAt: at(6, 45, 29), smart: true }
  it('never without an alarm', () => {
    expect(shouldRing(at(7, 0, 29), { ringAt: null }, () => true)).toBe(false)
  })
  it('at the wake time, stirring or not', () => {
    expect(shouldRing(at(6, 45, 29), tr, () => false)).toBe(true)
    expect(shouldRing(at(7, 30, 29), { ...tr, smart: false }, () => false)).toBe(true)
  })
  it('in the smart window only when stirring, and only if smart', () => {
    expect(shouldRing(at(6, 20, 29), tr, () => true)).toBe(true)
    expect(shouldRing(at(6, 20, 29), tr, () => false)).toBe(false)
    expect(shouldRing(at(6, 20, 29), { ...tr, smart: false, ringFrom: at(6, 45, 29) }, () => true)).toBe(false)
  })
  it('before the window it does not even look at the sound (it runs every 10 s)', () => {
    const stir = vi.fn(() => true)
    expect(shouldRing(at(5, 0, 29), tr, stir)).toBe(false)
    expect(stir).not.toHaveBeenCalled()
  })
})

describe('labels', () => {
  it('says what was heard, most telling first', () => {
    expect(heardLabel([])).toBe('Quiet so far')
    expect(heardLabel([{ kind: 'move' }, { kind: 'noise' }])).toBe('Quiet so far')
    expect(heardLabel([{ kind: 'snore' }, { kind: 'snore' }])).toBe('Snoring')
    expect(heardLabel([{ kind: 'talk' }, { kind: 'cough' }, { kind: 'cough' }])).toBe('Talked once · coughed 2 times')
    expect(heardLabel([{ kind: 'talk' }, { kind: 'snore' }, { kind: 'talk' }, { kind: 'talk' }])).toBe('Snoring · talked 3 times')
  })
  it('writes the alarm as a window or a time', () => {
    expect(windowLabel({ ringAt: null })).toBeNull()
    expect(windowLabel({ ringFrom: at(6, 15), ringAt: at(6, 45), smart: true })).toBe('06:15 – 06:45')
    expect(windowLabel({ ringFrom: at(6, 15), ringAt: at(6, 45), smart: true }, '–')).toBe('06:15–06:45')
    expect(windowLabel({ ringFrom: at(6, 45), ringAt: at(6, 45), smart: false })).toBe('06:45')
  })
  it('says when listening stopped: the last recorded second', () => {
    expect(stoppedAt({ start: at(23, 0), db: new Array(90) })).toBe(at(23, 1) + 30000)
  })
  it('explains a microphone that would not start', () => {
    expect(micErrorMessage({ name: 'NotAllowedError' })).toMatch(/Allow it in Settings › Safari › Microphone/)
    expect(micErrorMessage({ name: 'NotFoundError', message: 'no device' })).toBe('The microphone did not start: no device')
  })
})

describe('snoozePlan', () => {
  it('rings again in 9 minutes, plainly (no smart window), with the backup a minute after', () => {
    const tr = { nightId: 'x', start: 1, ringFrom: at(6, 15), ringAt: at(6, 45), smart: true }
    const p = snoozePlan(tr, at(6, 45))
    expect(SNOOZE_MIN).toBe(9)
    expect(p.tracking).toEqual({ ...tr, ringAt: at(6, 54), smart: false })
    expect(p.backupAt).toBe(at(6, 55))
  })
})

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
