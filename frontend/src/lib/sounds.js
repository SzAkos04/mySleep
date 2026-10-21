// Wake-up sounds, made with Web Audio: no files to ship or cache. Each plays into `out` until
// the returned function stops it.
export const SOUNDS = [
  { id: 'chime', name: 'Chime' },
  { id: 'bells', name: 'Bells' },
  { id: 'marimba', name: 'Marimba' },
  { id: 'birds', name: 'Birds' },
  { id: 'waves', name: 'Waves' },
  { id: 'beep', name: 'Classic' }
]

const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51]

function tone(ctx, out, { hz, at = 0, type = 'sine', peak = 0.5, attack = 0.02, decay = 1.2, slide }) {
  const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + at
  o.type = type
  o.frequency.setValueAtTime(hz, t)
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + attack + decay * 0.5)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.linearRampToValueAtTime(peak, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
  o.connect(g).connect(out)
  o.start(t); o.stop(t + attack + decay + 0.05)
}

const PATTERNS = {
  chime: { every: 2400, play: (ctx, out) => [523.25, 659.25, 783.99].forEach((hz, i) => tone(ctx, out, { hz, at: i * 0.28 })) },
  bells: {
    every: 1100,
    play: (ctx, out) => {
      const hz = PENTA[Math.floor(Math.random() * PENTA.length)]
      tone(ctx, out, { hz, peak: 0.4, decay: 3 })
      tone(ctx, out, { hz: hz * 2.76, peak: 0.08, decay: 1.5 })   // the bell's inharmonic partial
    }
  },
  marimba: {
    every: 2000,
    play: (ctx, out) => [0, 2, 4, 7, 4, 2].forEach((n, i) => tone(ctx, out, { hz: PENTA[n % PENTA.length] / 2 * (n > 4 ? 2 : 1), at: i * 0.2, type: 'triangle', peak: 0.6, attack: 0.005, decay: 0.45 }))
  },
  birds: {
    every: 1600,
    play: (ctx, out) => {
      const n = 2 + Math.floor(Math.random() * 4), base = 2400 + Math.random() * 1200
      for (let i = 0; i < n; i++) tone(ctx, out, { hz: base, slide: base * 1.5, at: i * 0.12 + Math.random() * 0.05, peak: 0.25, attack: 0.01, decay: 0.09 })
    }
  },
  beep: { every: 1400, play: (ctx, out) => [0, 0.2, 0.4, 0.6].forEach(at => tone(ctx, out, { hz: 880, at, type: 'square', peak: 0.25, attack: 0.005, decay: 0.12 })) }
}

// Waves: brown noise through a low-pass filter, swelling and ebbing every 8 s.
function waves(ctx, out) {
  const len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0)
  let last = 0
  for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5 }
  const src = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain()
  src.buffer = buf; src.loop = true
  lp.type = 'lowpass'; lp.frequency.value = 900
  src.connect(lp).connect(g).connect(out)
  const swell = () => {
    const t = ctx.currentTime
    g.gain.cancelScheduledValues(t)
    g.gain.setValueAtTime(0.15, t); g.gain.linearRampToValueAtTime(1, t + 3.5); g.gain.linearRampToValueAtTime(0.15, t + 8)
  }
  swell(); src.start()
  const timer = setInterval(swell, 8000)
  return () => { clearInterval(timer); try { src.stop() } catch {} ; g.disconnect() }
}

export function playSound(ctx, out, id) {
  if (id === 'waves') return waves(ctx, out)
  const p = PATTERNS[id] || PATTERNS.chime
  p.play(ctx, out)
  const timer = setInterval(() => p.play(ctx, out), p.every)
  return () => clearInterval(timer)
}
