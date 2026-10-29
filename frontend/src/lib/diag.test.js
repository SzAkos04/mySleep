import { describe, it, expect, beforeEach, vi } from 'vitest'

// the page itself is src/test-setup.js; localStorage starts empty in each test
const store = { has: k => localStorage.getItem(k) !== null, get: k => localStorage.getItem(k) }
const { diag, diagStart, diagResume, diagUpload, diagRetryPending, diagSummary, diagActive } = await import('./diag.js')

let sent, answer
globalThis.fetch = vi.fn(async (url, o) => {
  let text = o.body
  if (o.headers['Content-Encoding'] === 'gzip') text = await new Response(o.body.stream().pipeThrough(new DecompressionStream('gzip'))).text()
  sent.push({ url, ...JSON.parse(text) })
  if (answer instanceof Error) throw answer
  return { ok: answer < 300, status: answer }
})
beforeEach(() => { sent = []; answer = 200 })

const night = sec => ({ start: 1e12, db: Array.from({ length: sec }, (_, i) => i % 97 ? 40 + (i % 13) * 1.234 : NaN),
  low: Array(sec).fill(0.123), mid: Array(sec).fill(0.456), vr: Array(sec).fill(3.21), at: Array(sec).fill(1.05) })

describe('night log', () => {
  it('records events, counts them, and survives a reload', () => {
    diagStart('2026-10-28', { settings: { wake: '06:45' } })
    diag('wakelock'); diag('wakelock-released'); diag('visibility', { state: 'hidden' }); diag('stall', { ms: 9000 }); diag('mic-dead')
    expect(diagSummary()).toMatchObject({ lockOk: 1, lockReleased: 1, hidden: 1, stalls: 1, micLost: 1, reloads: 0 })
    diag('mic-silent', { sec: 10 }); diag('recover', { step: 'engine' }); diag('recover', { step: 'mic' }); diag('recovered', { step: 'mic' })
    expect(diagSummary()).toMatchObject({ micSilent: 1, recoveries: 2, recovered: 1 })
    // the page dies; a new one picks the log up from localStorage
    expect(diagResume('2026-10-29')).toBe(false)
    expect(diagResume('2026-10-28')).toBe(true)
    expect(diagSummary()).toMatchObject({ lockOk: 1, reloads: 1 })
  })

  it('uploads the log every 5 minutes, and the readings once at the end', async () => {
    diagStart('2026-10-28')
    await diagUpload(); await diagUpload()   // the second is too soon
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ url: '/api/debug/2026-10-28', final: false, night: '2026-10-28' })
    expect(sent[0].samples).toBeUndefined()
    await diagUpload(night(10), true)
    expect(sent[1].final).toBe(true)
    expect(sent[1].samples.db.slice(0, 3)).toEqual([null, 41.2, 42.5])   // gaps as null, rounded
    expect(sent[1].samples.low[0]).toBe(0.12)
    expect(diagActive()).toBe(false)   // the day is not recorded
    expect(store.has('mysleep_diag')).toBe(false)
    // a new night uploads at its first minute, not 5 minutes after the last night's end
    diagStart('2026-10-29'); await diagUpload()
    expect(sent).toHaveLength(3)
  })

  it('keeps a final log that could not be sent, and sends it at the next start', async () => {
    diagStart('2026-10-28')
    answer = new Error('offline')
    await diagUpload(night(5), true)
    expect(diagActive()).toBe(false)
    const pending = JSON.parse(store.get('mysleep_diag_pending'))
    expect(pending.events.at(-1)[1]).toBe('upload-failed')
    expect(pending.samples.db).toHaveLength(5)
    answer = 503; await diagRetryPending()
    expect(store.has('mysleep_diag_pending')).toBe(true)    // the server may come back
    answer = 200; await diagRetryPending()
    expect(store.has('mysleep_diag_pending')).toBe(false)
    expect(sent.at(-1)).toMatchObject({ final: true, night: '2026-10-28' })
  })

  it('stops at its size limit, and a 12-hour night still fits the server (4 MB, even unzipped)', () => {
    diagStart('2026-10-28')
    for (let i = 0; i < 7000; i++) diag('beat', { sec: i, missing60: 0, db: 55, live: true, ctx: 'running', awake: 'lock', lock: true, video: 'playing', visibility: 'visible', clips: 3, session: 'play-and-record' })
    expect(diagSummary().events).toBe(6001)   // 6000 and one 'log-full'
    const s = night(12 * 3600), r1 = v => Number.isFinite(v) ? Math.round(v * 10) / 10 : null, r2 = v => Math.round(v * 100) / 100
    const body = JSON.stringify({ events: Array(6001).fill([12345678, 'beat', { sec: 1, missing60: 0, db: 55, live: true, ctx: 'running', awake: 'lock', lock: true, video: 'playing', visibility: 'visible', clips: 3, session: 'play-and-record' }]),
      samples: { db: s.db.map(r1), low: s.low.map(r2), mid: s.mid.map(r2), vr: s.vr.map(r1), at: s.at.map(r1) } })
    expect(body.length).toBeLessThan(4 * 1024 * 1024)
  })
})
