import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { installBrowser, browser, room, setVisibility, FakeAudioContext } from '../test/browser.js'

// The night engine against stand-ins for the iPhone's microphone, Web Audio, wake lock and video
// (src/test/browser.js). Each test loads a fresh tracker, at 23:00 with a fake clock.
let t, d
async function load(opts) {
  vi.useFakeTimers({ now: new Date(2026, 9, 28, 23, 0), toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  installBrowser(opts)
  vi.resetModules()
  d = await import('./diag.js')
  t = await import('./tracker.js')
  d.diagStart('2026-10-28')
}
const types = () => d.diagEvents().map(e => e[1])
const last = type => d.diagEvents().filter(e => e[1] === type).at(-1)?.[2]
const tick = ms => vi.advanceTimersByTimeAsync(ms)
const ctx = () => FakeAudioContext.made.at(-1)

beforeEach(() => localStorage.clear())
// each test's tracker stops, so its listeners do not answer the next test's events
afterEach(() => { if (t?.samples.start) t.stop(); vi.useRealTimers() })

describe('starting the night', () => {
  it('asks for the wake lock and starts the video inside the tap, before the microphone answers', async () => {
    await load()
    const started = t.start()
    // synchronously, still inside the user's gesture
    expect(browser.videos).toHaveLength(1)
    expect(browser.micRequests).toBe(1)
    await started
    await tick(0)   // the alarm decodes in the background
    expect(browser.locks).toHaveLength(1)
    expect(t.awake).toBe('lock')
    expect(navigator.audioSession.type).toBe('play-and-record')
    expect(ctx().state).toBe('running')
    expect(types()).toEqual(expect.arrayContaining(['wakelock', 'video-playing', 'mic-open', 'ctx', 'alarm-loaded']))
  })

  it('without a wake lock, the video keeps the screen on; with neither, it says so', async () => {
    await load({ wakeLock: 'unsupported' })
    await t.start()
    expect(t.awake).toBe('video')
    expect(last('wakelock-failed')).toEqual({ name: 'unsupported' })
    t.stop()
    await load({ wakeLock: 'refused', video: 'refused' })
    await t.start()
    expect(t.awake).toBe('none')
    expect(types()).toEqual(expect.arrayContaining(['wakelock-failed', 'video-failed']))
  })

  it('microphone refused: no night, and the screen is let go', async () => {
    await load({ mic: 'NotAllowedError' })
    await expect(t.start()).rejects.toMatchObject({ name: 'NotAllowedError' })
    expect(browser.locks.every(l => l.released)).toBe(true)
    expect(browser.videos[0].removed).toBe(true)
    expect(ctx().state).toBe('closed')
    expect(t.awake).toBe('none')
    const n = t.samples.db.length
    await tick(5000)
    expect(t.samples.db.length).toBe(n)   // not listening
    expect(last('mic-failed')).toMatchObject({ name: 'NotAllowedError' })
  })

  it('no clip buffer (the worklet refused): the night is still recorded', async () => {
    await load({ worklet: 'fail' })
    await t.start()
    await tick(3000)
    expect(t.samples.db.filter(Number.isFinite)).toHaveLength(3)
    expect(last('clips-unavailable')).toMatchObject({ message: 'worklet refused' })
    await t.collectClips()
    expect(t.clips).toHaveLength(0)
  })
})

describe('listening', () => {
  it('keeps one reading per second: loudness, low share, spread, jump', async () => {
    await load(); await t.start()
    await tick(3000)
    expect(t.samples.db).toHaveLength(3)
    for (const v of t.samples.db) expect(v).toBeCloseTo(60, 1)   // rms 0.01 = -40 dBFS, +100
    for (const v of t.samples.low) expect(v).toBeCloseTo(0.3, 1)
    room.rms = 0.1   // a sound: +20 dB
    await tick(1000)
    expect(t.samples.db.at(-1)).toBeCloseTo(80, 1)
    expect(t.samples.at.at(-1)).toBeCloseTo(20, 1)
  })

  it('a muted microphone (iOS took it) is a gap, not a quiet room, and comes back', async () => {
    await load(); await t.start()
    await tick(2000)
    browser.tracks[0].mute()
    await tick(3000)
    expect(t.micLive()).toBe(false)
    expect(t.samples.db.slice(-2).every(Number.isNaN)).toBe(true)   // the seconds after the mute
    expect(types()).toEqual(expect.arrayContaining(['mic-mute', 'mic-dead']))
    browser.tracks[0].unmute()
    await tick(2000)
    expect(t.samples.db.at(-1)).toBeCloseTo(60, 1)
    expect(types()).toContain('mic-live')
  })

  it('exact digital silence is a gap too', async () => {
    await load(); await t.start()
    room.rms = 0
    await tick(3000)
    expect(t.samples.db.every(Number.isNaN)).toBe(true)
  })

  it('seconds the page was not running are gaps, and the log says how long', async () => {
    await load(); await t.start()
    await tick(2000)
    vi.setSystemTime(Date.now() + 10000)   // frozen for 10 s: no timers ran
    await tick(100)
    expect(t.samples.db.length).toBe(12)
    expect(t.samples.db.slice(2, 12).filter(Number.isNaN).length).toBeGreaterThanOrEqual(9)
    expect(last('stall').ms).toBeGreaterThanOrEqual(10000)
  })

  it('a microphone that ended is reopened when the page is back, and the old one stopped', async () => {
    await load(); await t.start()
    browser.tracks[0].mute()
    setVisibility('hidden'); setVisibility('visible')
    await tick(10)
    expect(browser.micRequests).toBe(2)
    expect(browser.tracks[0].readyState).toBe('ended')   // not left running beside the new one
    expect(t.micLive()).toBe(true)
    expect(types()).toContain('mic-reopen')
  })
})

describe('keeping the screen on', () => {
  it('a wake lock iOS lets go of is asked for again; while hidden, when the page is back', async () => {
    await load(); await t.start()
    browser.locks[0].release()
    expect(t.awake).toBe('video')   // the video still holds
    await tick(1000)
    expect(browser.locks).toHaveLength(2)
    expect(t.awake).toBe('lock')
    setVisibility('hidden')
    browser.locks[1].release()
    await tick(5000)
    expect(browser.locks).toHaveLength(2)
    setVisibility('visible')
    await tick(10)
    expect(browser.locks).toHaveLength(3)
  })

  it('a video paused in the background plays again when the page is back', async () => {
    await load(); await t.start()
    browser.videos[0].pause()
    setVisibility('hidden'); setVisibility('visible')
    await tick(10)
    expect(browser.videos[0].paused).toBe(false)
    expect(last('video-playing')).toEqual({ again: true })
  })
})

describe('stopping', () => {
  it('before any night is harmless (no gap from 1970 to now)', async () => {
    await load()
    expect(() => t.stop()).not.toThrow()
    expect(t.samples.db).toHaveLength(0)
  })

  it('lets go of everything: microphone, wake lock, video, audio, the lock screen card', async () => {
    await load(); await t.start()
    t.nowPlaying('mySleep is listening', 'Alarm 06:45')
    await tick(2000)
    t.stop()
    expect(browser.tracks[0].readyState).toBe('ended')
    expect(browser.locks[0].released).toBe(true)
    expect(browser.videos[0].removed).toBe(true)
    expect(ctx().state).toBe('closed')
    expect(navigator.mediaSession.metadata).toBeNull()
    expect(t.awake).toBe('none')
    const n = t.samples.db.length
    await tick(3000)
    expect(t.samples.db.length).toBe(n)
  })

  it('a night whose page was closed can be finished without resuming: the rest is gaps', async () => {
    await load(); await t.start()
    await tick(5000)
    t.saveProgress()
    // the page dies and a new one loads 10 minutes later
    vi.setSystemTime(Date.now() + 600000)
    vi.resetModules()
    t = await import('./tracker.js')
    expect(t.loadProgress()).toBe(true)
    expect(t.samples.db).toHaveLength(5)
    expect(() => t.stop()).not.toThrow()
    expect(t.samples.db.length).toBeGreaterThanOrEqual(605)
    expect(t.samples.db.slice(5).every(Number.isNaN)).toBe(true)
  })
})

describe('progress kept for a reload', () => {
  it('round-trips the readings, gaps included', async () => {
    await load(); await t.start()
    await tick(2000); room.rms = 0; await tick(2000)
    t.saveProgress()
    const before = t.samples.db.slice()
    t.samples.db = []
    expect(t.loadProgress()).toBe(true)
    expect(t.samples.db.map(v => Number.isNaN(v) ? 'gap' : Math.round(v))).toEqual(before.map(v => Number.isNaN(v) ? 'gap' : Math.round(v)))
    t.clearProgress()
    expect(t.loadProgress()).toBe(false)
  })

  it('full storage is logged, not silent', async () => {
    await load(); await t.start(); await tick(1000)
    const set = localStorage.setItem
    localStorage.setItem = () => { throw new DOMException('quota', 'QuotaExceededError') }
    try { t.saveProgress() } finally { localStorage.setItem = set }
    expect(last('save-failed')).toMatchObject({ name: 'QuotaExceededError', sec: 1 })
  })
})

describe('the alarm', () => {
  it('plays the piano: microphone closed, playback session, looping, from near silence to full in 25 s', async () => {
    await load(); await t.start()
    await t.ring()
    expect(browser.tracks[0].readyState).toBe('ended')
    expect(navigator.audioSession.type).toBe('playback')
    expect(t.ringingTone()).toBe(false)
    expect(last('ring')).toMatchObject({ recording: true, problem: null })
    expect(lastGain().out).toBe(ctx().destination)   // the curve feeds the speaker
    const curve = lastGain().gain
    expect(curve.curveDur).toBe(25)
    expect(curve.curve[0]).toBeCloseTo(10 ** (-42 / 20), 4)
    expect(curve.curve.at(-1)).toBe(1)
    for (let i = 1; i < curve.curve.length; i++) expect(curve.curve[i]).toBeGreaterThanOrEqual(curve.curve[i - 1])
    expect(lastSource()).toMatchObject({ loop: true, started: true })
    expect(lastSource().buffer.duration).toBeCloseTo(19.4)
    expect(lastSource().out).toBe(lastGain())
  })

  it('without the recording: a tone, and the screen can say why', async () => {
    await load({ alarm: 'broken' }); await t.start()
    await t.ring()
    expect(t.ringingTone()).toBe(true)
    expect(lastSource().oscillator).toBe(true)
    expect(lastSource().frequency.value).toBe(660)
    expect(t.alarmProblem).toBe('Decoding failed')
    expect(last('alarm-load-failed')).toEqual({ problem: 'Decoding failed' })
  })

  it('offline at bedtime: tries once more when it rings, and still rings within 4 s', async () => {
    await load({ alarm: 'offline' }); await t.start(); await tick(0)
    expect(t.alarmProblem).toBe('Load failed')
    const rang = t.ring()
    await tick(4000)
    await rang
    expect(browser.fetches).toBeGreaterThanOrEqual(2)
    expect(t.ringingTone()).toBe(true)
  })

  it('stop silences it; snooze silences it and listens again', async () => {
    await load(); await t.start()
    await t.ring()
    const src = lastSource()
    await t.snooze()
    expect(src.stopped).toBe(true)
    expect(browser.micRequests).toBe(2)
    expect(t.micLive()).toBe(true)
    expect(t.ringingTone()).toBe(false)
    await t.ring()
    t.silence()
    expect(lastSource().stopped).toBe(true)
    expect(types().filter(x => x === 'silence')).toHaveLength(2)
  })
})

describe('the lock screen card', () => {
  it('says what runs, and its buttons do nothing', async () => {
    await load()
    t.nowPlaying('mySleep is listening', 'Alarm 06:15–06:45')
    const ms = navigator.mediaSession
    expect(ms.metadata).toMatchObject({ title: 'mySleep is listening', artist: 'Alarm 06:15–06:45', album: 'mySleep' })
    expect(ms.playbackState).toBe('playing')
    expect(Object.keys(ms.handlers)).toEqual(['play', 'pause', 'stop', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'])
    expect(ms.handlers.pause()).toBeUndefined()
    t.nowPlaying(null)
    expect(ms.metadata).toBeNull()
    expect(Object.values(ms.handlers).every(h => h === null)).toBe(true)
  })
})

describe('heartbeat and clips', () => {
  it('the minute heartbeat says the state of everything', async () => {
    await load(); await t.start()
    await tick(60000)
    t.heartbeat()
    expect(last('beat')).toMatchObject({ sec: 60, missing60: 0, db: 60, live: true, ctx: 'running', awake: 'lock', lock: true, video: 'playing', visibility: 'visible', clips: 0, session: 'play-and-record' })
  })

  it('cuts a clip of talking from the 30 s buffer, once', async () => {
    await load(); await t.start()
    await tick(40000)
    // talking 25–30 s ago (traits measured in SOUND_ANALYSIS.md): sharp onsets, big swings
    const n = t.samples.db.length
    for (let s = n - 15; s < n - 10; s++) t.samples.db[s] = 74, t.samples.low[s] = 0.45, t.samples.mid[s] = 0.4, t.samples.vr[s] = 13, t.samples.at[s] = 32
    await t.collectClips()
    expect(t.clips).toHaveLength(1)
    expect(t.clips[0]).toMatchObject({ kind: 'talk' })
    expect(t.clips[0].blob.type).toBe('audio/wav')
    expect(t.clips[0].sec).toBeGreaterThanOrEqual(1)
    await t.collectClips()
    expect(t.clips).toHaveLength(1)
  })
})

// the last nodes the audio context made (the alarm's, after ring())
function lastSource() { return ctx().lastSource }
function lastGain() { return ctx().lastGain }
