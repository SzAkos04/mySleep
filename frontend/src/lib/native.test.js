import { describe, it, expect, vi } from 'vitest'
import { sleepLink, pairLink, toImport, nightFromLog, nativeSummary, expiryNote, importNative, isEmbedded } from './native.js'

// The web app no longer listens: mySleep Night (ios/) records the night and uploads its log; the
// web app opens it, pairs it, turns its logs into nights, and says when it needs reinstalling.

describe('links into mySleep Night', () => {
  it('Sleep opens the app with tonight’s alarm', () => {
    expect(sleepLink({ alarm: true, smart: true, wake: '06:45' })).toBe('mysleepnight://sleep?alarm=1&smart=1&wake=06%3A45')
    expect(sleepLink({ alarm: false, smart: false, wake: '07:00' })).toBe('mysleepnight://sleep?alarm=0&smart=0&wake=07%3A00')
  })
  it('pairing hands the app this server and its token', () => {
    expect(pairLink('https://host.ts.net:8443', 'tok_123')).toBe('mysleepnight://pair?server=https%3A%2F%2Fhost.ts.net%3A8443&token=tok_123')
  })
})

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
  it('is the web app’s own night record, marked as recorded by the app', () => {
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

describe('importing', () => {
  it('fetches the new logs and saves their nights; one that fails waits for next time', async () => {
    const full = { '2026-10-29': log(), '2026-10-26': log({ night: '2026-10-26', from: start - 3 * 864e5 }) }
    const get = vi.fn(async path => {
      if (path === '/api/debug') return [{ night: '2026-10-29', start, final: true, app: 'native' }, { night: '2026-10-26', start: start - 3 * 864e5, final: true, app: 'native' }, { night: '2026-10-25', start: 1, final: true, app: 'native' }]
      const id = path.split('/').pop()
      if (!full[id]) throw new Error('gone')
      return full[id]
    })
    const save = vi.fn()
    expect(await importNative({ get, nights: {}, save })).toBe(2)
    expect(save.mock.calls.map(c => c[0].id)).toEqual(['2026-10-29', '2026-10-26'])
  })
})

describe('when the app needs reinstalling', () => {
  const now = new Date(2026, 10, 3, 12, 0).getTime(), day = 864e5
  const app = expires => [{ id: 'a', name: 'mySleep Night', expires, lastSeen: now - day }]
  it('says nothing while there is time', () => {
    expect(expiryNote(app(now + 5 * day), now)).toBeNull()
  })
  it('two days before, the last day, and after', () => {
    expect(expiryNote(app(now + 2 * day - 3600e3), now)).toMatchObject({ level: 'soon' })
    expect(expiryNote(app(now + 3600e3), now)).toMatchObject({ level: 'today' })
    expect(expiryNote(app(now - 3600e3), now)).toMatchObject({ level: 'expired' })
  })
  it('not paired yet, or never said when: says how to start', () => {
    expect(expiryNote([], now)).toMatchObject({ level: 'unpaired' })
    expect(expiryNote(app(null), now)).toMatchObject({ level: 'unknown' })
  })
  it('names the day it stops', () => {
    expect(expiryNote(app(new Date(2026, 10, 5, 13, 0).getTime()), now).until).toBe(new Date(2026, 10, 5, 13, 0).getTime())
  })
})

describe('inside mySleep Night', () => {
  it('the app opens the pages with ?embed=1', () => {
    expect(isEmbedded('?embed=1')).toBe(true)
    expect(isEmbedded('?x=2&embed=1')).toBe(true)
    expect(isEmbedded('')).toBe(false)
    expect(isEmbedded('?embedded=1')).toBe(false)
  })
})
