import { describe, it, expect } from 'vitest'
import { toImport, nightFromLog, nativeSummary, takeIn } from './native.js'

// mySleep Night (ios/) records the night and keeps its log; the rules turn a finished log into the
// night it holds, once.

// a night as mySleep Night logs it: 23:00 to 07:00, quiet, 15 min tossing first; the alarm rang early
const start = new Date(2026, 9, 29, 23, 0).getTime()
function log({ night = '2026-10-29', from = start, final = true, events } = {}) {
  const n = 8 * 3600, s = { start: from, db: [], low: [], mid: [], vr: [], at: [] }
  for (let i = 0; i < n; i++) { const m = i < 900 && i % 20 < 2; s.db.push(m ? 45 : 30 + (i % 7) / 4); s.low.push(0.3); s.mid.push(0.3); s.vr.push(1); s.at.push(m ? 2 : 1) }
  s.db[100] = null   // a gap, as JSON keeps it
  return { night, start: from, final, env: { app: 'native' }, samples: s,
    events: events ?? [[0, 'start'], [3600e3, 'interruption-began'], [3610e3, 'audio', { reason: 'interruption-ended' }], [7 * 3600e3, 'mic-silent'], [7.4 * 3600e3, 'wake', { early: 12 }], [7.4 * 3600e3 + 2000, 'alarm-ringing'], [8 * 3600e3, 'finish']] }
}

describe('turning a log into a night', () => {
  it('is the night record, marked as recorded by the app', () => {
    const n = nightFromLog(log())
    expect(n).toMatchObject({ id: '2026-10-29', bed: start, wake: start + 8 * 3600e3, source: 'native', clips: [] })
    expect(n.asleepMin).toBeGreaterThan(7 * 60)
    expect(n.timeline.states).toHaveLength(960)
  })
  it('keeps when the alarm rang and how early', () => {
    expect(nightFromLog(log()).alarm).toEqual({ at: start + 7.4 * 3600e3 + 2000, early: 12 })
    const noAlarm = log({ events: [[0, 'start'], [8 * 3600e3, 'finish']] })
    expect(nightFromLog(noAlarm)).not.toHaveProperty('alarm')
  })
  it('the app rang by itself (no system alarm): that counts as ringing too', () => {
    const l = log({ events: [[0, 'start'], [7 * 3600e3, 'ring', { self: true, early: 0 }], [8 * 3600e3, 'finish']] })
    expect(nightFromLog(l).alarm).toEqual({ at: start + 7 * 3600e3, early: 0 })
  })
  it('sums up what went wrong in the night, the app’s way', () => {
    expect(nativeSummary(log().events)).toEqual({ app: 'native', events: 7, interruptions: 1, restarts: 1, micSilent: 1, recoveries: 0, stalls: 0, locked: 0, memoryWarnings: 0 })
  })
})

describe('which logs to import', () => {
  const logs = [
    { night: '2026-10-29', start, final: true, app: 'native' },
    { night: '2026-10-28', start: start - 864e5, final: false, app: 'native' },   // still running, or cut short
    { night: '2026-10-27', start: start - 2 * 864e5, final: true, app: 'web' },   // the web app's own flight log
    { night: '2026-10-26', start: start - 3 * 864e5, final: true, app: 'native' }
  ]
  it('the app’s finished nights the web app does not have yet', () => {
    expect(toImport(logs, {}).map(l => l.night)).toEqual(['2026-10-29', '2026-10-26'])
  })
  it('not again once imported, not a night deleted here, and never over a night of another source', () => {
    const nights = {
      '2026-10-29': { id: '2026-10-29', bed: start, source: 'native' },
      '2026-10-26': { id: '2026-10-26', deleted: true }
    }
    expect(toImport(logs, nights)).toEqual([])
    expect(toImport(logs, { '2026-10-29': { id: '2026-10-29', bed: start - 5000 } })).toEqual([logs[3]])
  })
  it('a later night the same date from the app replaces the earlier one', () => {
    expect(toImport(logs, { '2026-10-29': { id: '2026-10-29', bed: start - 5000, source: 'native' } }).map(l => l.night)).toEqual(['2026-10-29', '2026-10-26'])
  })
})

describe('takeIn: the night to make of a log, if there is one (mySleep Night does it itself)', () => {
  it('a finished log of a night not here yet becomes the night', () => {
    expect(takeIn(log(), {})).toMatchObject({ id: '2026-10-29', source: 'native', bed: start })
  })
  it('not an unfinished one, not one already here (same start), not over a night deleted or from elsewhere', () => {
    expect(takeIn(log({ final: false }), {})).toBeNull()
    expect(takeIn(log(), { '2026-10-29': { id: '2026-10-29', source: 'native', bed: start } })).toBeNull()
    expect(takeIn(log(), { '2026-10-29': { id: '2026-10-29', deleted: true } })).toBeNull()
    expect(takeIn(log(), { '2026-10-29': { id: '2026-10-29', source: 'web', bed: start } })).toBeNull()
  })
  it('a later night under the same date replaces the earlier one', () => {
    expect(takeIn(log({ from: start + 3600e3 }), { '2026-10-29': { id: '2026-10-29', source: 'native', bed: start } })).not.toBeNull()
  })
})

describe('nativeSummary', () => {
  it('counts the microphone coming back, under the name the app logs it by', () => {
    const events = [[0, 'start'], [5000, 'mic-silent'], [9000, 'recovered', { afterSec: 14 }], [20000, 'mic-silent'], [30000, 'recovered', { afterSec: 10 }]]
    expect(nativeSummary(events)).toMatchObject({ micSilent: 2, recoveries: 2 })
  })
})
