// Stand-ins for what tracker.js uses on the iPhone: microphone, Web Audio, Screen Wake Lock, the
// keep-awake video, Media Session. They behave as WebKit does in the ways that matter here (a track
// can be muted or end, the wake lock can be let go, a video can refuse to play) and record what was
// asked of them, so tests can say what the tracker did. Test-only: nothing here ships.

class Emitter extends EventTarget {
  emit(type) { this.dispatchEvent(new Event(type)) }
}

export class FakeTrack extends Emitter {
  readyState = 'live'; muted = false; label = 'iPhone Microphone'
  getSettings() { return { sampleRate: 48000, echoCancellation: false } }
  stop() { this.readyState = 'ended' }
  mute() { this.muted = true; this.emit('mute') }
  unmute() { this.muted = false; this.emit('unmute') }
  end() { this.readyState = 'ended'; this.emit('ended') }
}

class FakeNode {
  connect(n) { this.out = n; return n }
  disconnect() { this.out = null }
}

// The room the microphone hears: rms amplitude (0 = digital silence) and how much of the energy
// is under 500 Hz. Change it between ticks to make sounds.
export const room = { rms: 0.01, low: 0.3 }

class FakeAnalyser extends FakeNode {
  fftSize = 2048; smoothingTimeConstant = 0.8
  get frequencyBinCount() { return this.fftSize / 2 }
  getFloatTimeDomainData(a) { for (let i = 0; i < a.length; i++) a[i] = i % 2 ? room.rms : -room.rms }
  getFloatFrequencyData(f) {
    // two levels, so that the share of power below 500 Hz is room.low (bins 50–4000 Hz counted)
    const hz = 48000 / this.fftSize, lowBins = Math.floor(500 / hz) - Math.ceil(50 / hz), restBins = Math.ceil(4000 / hz) - Math.floor(500 / hz)
    const lo = 10 * Math.log10(room.low / lowBins || 1e-12), hi = 10 * Math.log10((1 - room.low) / restBins || 1e-12)
    for (let i = 0; i < f.length; i++) f[i] = i * hz < 500 ? lo : hi
  }
}

class FakeParam { value = 1; setValueCurveAtTime(curve, start, dur) { this.curve = curve; this.curveStart = start; this.curveDur = dur } }

export class FakeAudioContext {
  static made = []
  state = 'suspended'; sampleRate = 48000; destination = new FakeNode(); born = Date.now()
  get currentTime() { return (Date.now() - this.born) / 1000 }   // the audio clock runs with the (fake) wall clock
  audioWorklet = { addModule: async () => { if (browser.worklet === 'fail') throw new Error('worklet refused') } }
  constructor() { FakeAudioContext.made.push(this) }
  createMediaStreamSource(s) { const n = new FakeNode(); n.stream = s; return n }
  createAnalyser() { return new FakeAnalyser() }
  createGain() { const g = new FakeNode(); g.gain = new FakeParam(); return this.lastGain = g }
  createBufferSource() { const s = new FakeNode(); Object.assign(s, { start() { s.started = true }, stop() { s.stopped = true } }); return this.lastSource = s }
  createOscillator() { const s = this.createBufferSource(); s.frequency = new FakeParam(); s.oscillator = true; return s }
  resume() { if (this.state !== 'closed') this.state = 'running'; return Promise.resolve() }
  close() { this.state = 'closed'; return Promise.resolve() }
  decodeAudioData(data, ok, fail) {
    // like WebKit: callback form, and a promise
    return browser.alarm === 'ok' ? (ok({ duration: 19.4, bytes: data.byteLength }), Promise.resolve()) : (fail(new DOMException('Decoding failed', 'EncodingError')), Promise.reject(new DOMException('Decoding failed', 'EncodingError')))
  }
}

// The clip buffer worklet: answers 'snap' with the last `seconds` of 16 kHz audio.
export class FakeWorkletNode extends FakeNode {
  constructor(ctx, name, { processorOptions }) {
    super(); this.ctx = ctx; this.opts = processorOptions
    this.port = { postMessage: () => queueMicrotask(() => this.port.onmessage?.({ data: { pcm: new Float32Array(processorOptions.rate * processorOptions.seconds).fill(0.1), at: ctx.currentTime, rate: processorOptions.rate } })) }
  }
}

class FakeSentinel extends Emitter {
  released = false
  release() { if (!this.released) { this.released = true; this.emit('release') } return Promise.resolve() }
}

class FakeVideo extends Emitter {
  paused = true; readyState = 0; style = {}; attrs = {}; removed = false
  setAttribute(k, v) { this.attrs[k] = v }
  play() {
    if (browser.video !== 'ok') return Promise.reject(new DOMException('play() refused', 'NotAllowedError'))
    this.paused = false; this.readyState = 4; this.emit('playing'); return Promise.resolve()
  }
  pause() { this.paused = true; this.emit('pause') }
  remove() { this.removed = true }
}

// What the fakes were asked, and switches for how they answer.
export const browser = {}

export function installBrowser({ mic = 'ok', wakeLock = 'ok', video = 'ok', alarm = 'ok', worklet = 'ok' } = {}) {
  Object.assign(browser, { mic, wakeLock, video, alarm, worklet, tracks: [], locks: [], videos: [], micRequests: 0, fetches: 0 })
  Object.assign(room, { rms: 0.01, low: 0.3 })
  FakeAudioContext.made = []
  const nav = {
    userAgent: 'test', language: 'en', standalone: true,
    mediaDevices: {
      getUserMedia: async () => {
        browser.micRequests++
        if (browser.mic !== 'ok') throw new DOMException('The request is not allowed', browser.mic)
        const t = new FakeTrack(); browser.tracks.push(t)
        return { getAudioTracks: () => [t], getTracks: () => [t] }
      }
    },
    audioSession: { type: 'auto' },
    mediaSession: { metadata: null, playbackState: 'none', handlers: {}, setActionHandler(a, h) { this.handlers[a] = h } }
  }
  if (wakeLock !== 'unsupported') nav.wakeLock = {
    request: async () => {
      if (browser.wakeLock !== 'ok') throw new DOMException('Wake lock refused', 'NotAllowedError')
      const s = new FakeSentinel(); browser.locks.push(s); return s
    }
  }
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true })
  Object.assign(globalThis, {
    AudioContext: FakeAudioContext, AudioWorkletNode: FakeWorkletNode,
    MediaMetadata: class { constructor(m) { Object.assign(this, m) } },
    location: { href: 'http://localhost/' },
    fetch: async () => { browser.fetches++; return browser.alarm === 'offline' ? Promise.reject(new TypeError('Load failed')) : { ok: true, arrayBuffer: async () => new ArrayBuffer(1200) } }
  })
  document.visibilityState = 'visible'
  document.createElement = tag => tag === 'canvas'
    ? { getContext: () => ({ fillRect() {} }), captureStream: () => ({ getTracks: () => [{ stop() {} }] }) }
    : (browser.videos.push(new FakeVideo()), browser.videos.at(-1))
  document.body = { appendChild() {} }
  return browser
}

// The page goes to the background (or the phone locks) and comes back.
export function setVisibility(state) {
  document.visibilityState = state
  document.dispatchEvent(new Event('visibilitychange'))
}
