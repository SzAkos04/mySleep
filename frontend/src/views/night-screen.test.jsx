// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { act } from 'react'
import { mount, unmount, button, byText, text, click, hold, flush } from '../test/dom.js'

// The night screen and the alarm, tapped through as a sleepy person would. The tracker (microphone,
// sound) is a stand-in here; it has its own tests in lib/tracker.test.js.
const tracker = vi.hoisted(() => ({
  samples: { start: 0, db: [], low: [], mid: [], vr: [], at: [] }, clips: [], awake: 'lock', alarmProblem: null,
  live: true, tone: false,
  start: null, stop: null, ring: null, snooze: null,
  micLive() { return this.live }, ringingTone() { return this.tone },
  nowPlaying() {}, saveProgress() {}, heartbeat() {}, collectClips: async () => {}, clearProgress() {}, loadProgress: () => false
}))
vi.mock('../lib/tracker.js', () => tracker)
const api = vi.hoisted(() => ({ api: async () => ({ rev: 0, changes: [] }), armBackup: null, uploadClips: async () => [], enablePush: async () => {} }))
vi.mock('../lib/api.js', () => api)

const { useStore, defaultSettings } = await import('../store.js')
const { Tracking } = await import('./Tracking.jsx')

const T0 = new Date(2026, 9, 28, 23, 0).getTime()
const advance = ms => vi.advanceTimersByTime(ms)
// time passes inside act(), so React has drawn what the timers changed before the test looks
const wait = ms => act(async () => { advance(ms) })
let where
function Where() { where = useLocation().pathname; return null }
function Screen() {
  const tracking = useStore(s => s.tracking)
  return <MemoryRouter><Routes><Route path="*" element={<Where />} /></Routes>{tracking && <Tracking />}</MemoryRouter>
}

beforeEach(async () => {
  vi.useFakeTimers({ now: T0, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  Object.assign(tracker, { live: true, tone: false, awake: 'lock', alarmProblem: null, clips: [] })
  Object.assign(tracker.samples, { start: T0, db: [], low: [], mid: [], vr: [], at: [] })
  for (const f of ['start', 'stop', 'ring', 'snooze']) tracker[f] = vi.fn(async () => {})
  tracker.stop = vi.fn()
  api.armBackup = vi.fn(async () => {})
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
  useStore.setState({ user: { id: 'u1', name: 'Test' }, owner: 'u1', settings: defaultSettings(), nights: {}, dirty: {},
    tracking: { start: T0, nightId: '2026-10-28', ringFrom: T0 + 7 * 3600e3 + 15 * 60e3, ringAt: T0 + 7 * 3600e3 + 45 * 60e3, smart: true } })
  await mount(<Screen />)
})
afterEach(async () => { await unmount(); vi.useRealTimers() })

describe('ending the night', () => {
  it('a short press does nothing; holding 1.5 s ends it and opens the morning', async () => {
    await hold(button('Hold to wake up'), 800, advance)
    expect(tracker.stop).not.toHaveBeenCalled()
    expect(useStore.getState().tracking).not.toBeNull()
    await hold(button('Hold to wake up'), 1500, advance)
    expect(tracker.stop).toHaveBeenCalledOnce()
    expect(useStore.getState().tracking).toBeNull()
    const n = useStore.getState().nights['2026-10-28']
    expect(n).toMatchObject({ id: '2026-10-28', bed: T0 })
    expect(n).not.toHaveProperty('alarm')
    expect(where).toBe('/night/2026-10-28')
    expect(api.armBackup).toHaveBeenLastCalledWith(null)   // the backup alarm is called off
  })

  it('once the screen has dimmed, the button sleeps too, until a tap lights it', async () => {
    await wait(30000)
    expect(document.querySelector('.night').classList.contains('dark')).toBe(true)
    await hold(button('Hold to wake up'), 2000, advance)
    expect(tracker.stop).not.toHaveBeenCalled()
    // a finger on the screen lights it
    await act(async () => { document.querySelector('.night').dispatchEvent(new Event('pointerdown', { bubbles: true })) })
    expect(document.querySelector('.night').classList.contains('dark')).toBe(false)
    await hold(button('Hold to wake up'), 1500, advance)
    expect(tracker.stop).toHaveBeenCalledOnce()
  })
})

describe('the alarm', () => {
  const ringAt = T0 + 7 * 3600e3 + 45 * 60e3
  async function toRing() {
    vi.setSystemTime(ringAt)
    await wait(10000)
    await flush()
  }

  it('rings at the wake time: the alarm screen, the sound, the lock screen card', async () => {
    await toRing()
    expect(tracker.ring).toHaveBeenCalledOnce()
    expect(text()).toMatch(/Good morning/)
    expect(text()).toMatch(/Smart alarm/)
    expect(button('Hold to stop')).not.toBeNull()
  })

  it('Stop needs a hold too, then the night is saved with when it rang', async () => {
    await toRing()
    await click(button('Hold to stop'))
    expect(tracker.stop).not.toHaveBeenCalled()
    await hold(button('Hold to stop'), 1500, advance)
    expect(tracker.stop).toHaveBeenCalledOnce()
    expect(useStore.getState().nights['2026-10-28'].alarm).toMatchObject({ at: expect.any(Number), early: 0 })
  })

  it('Snooze: quiet, listening again, rings 9 minutes later, the backup a minute after that', async () => {
    await toRing()
    await click(button('Snooze 9 min'))
    expect(tracker.snooze).toHaveBeenCalledOnce()
    const tr = useStore.getState().tracking
    expect(tr.ringAt - Date.now()).toBe(9 * 60000)
    expect(tr.smart).toBe(false)
    expect(api.armBackup).toHaveBeenLastCalledWith(tr.ringAt + 60000)
    expect(text()).toMatch(/Hold to wake up/)
    vi.setSystemTime(tr.ringAt)
    await wait(10000)
    expect(tracker.ring).toHaveBeenCalledTimes(2)
  })

  it('without the piano it says it plays a backup tone, and why', async () => {
    tracker.tone = true; tracker.alarmProblem = 'Load failed'
    await toRing()
    expect(text()).toMatch(/backup tone/)
    expect(text()).toMatch(/Piano not loaded: Load failed/)
  })
})

describe('when something stopped', () => {
  it('a stopped microphone says so, and a tap resumes it', async () => {
    tracker.live = false
    await wait(1000)
    expect(text()).toMatch(/Microphone stopped · tap to resume/)
    tracker.live = true
    await click(byText(/Microphone stopped/).closest('button'))
    expect(tracker.start).toHaveBeenCalledWith({ resume: true })
    await wait(1000)
    expect(text()).toMatch(/Listening/)
  })

  it('nothing keeps the screen on: it tells you to set Auto-Lock to Never', async () => {
    tracker.awake = 'none'
    await wait(1000)
    expect(text()).toMatch(/Auto-Lock to Never/)
  })
})
