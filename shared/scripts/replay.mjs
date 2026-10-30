// Replays a WAV file through the night analysis, the way tracker.js reads the microphone
// (100 ms readings of a 2048-sample window: loudness, energy under 500 Hz and in 500–3000 Hz,
// then per second the loudest reading, the shares, the spread and the largest jump), and prints
// every sound it finds with its traits. For tuning analysis.js on real recordings, e.g. the
// night's clips (Settings › Keep recordings) or `say -o x.wav --data-format=LEI16@48000 "…"`.
//
//   node scripts/replay.mjs recording.wav [--room -60]   # room noise added under it, dBFS
import { readFileSync } from 'node:fs'
import { sounds, events } from '../lib/analysis.js'

const [file, ...rest] = process.argv.slice(2)
const room = rest.includes('--room') ? +rest[rest.indexOf('--room') + 1] : -60

function readWav(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let p = 12, fmt, data
  while (p < buf.length - 8) {
    const id = buf.toString('latin1', p, p + 4), size = v.getUint32(p + 4, true)
    if (id === 'fmt ') fmt = { format: v.getUint16(p + 8, true), ch: v.getUint16(p + 10, true), rate: v.getUint32(p + 12, true), bits: v.getUint16(p + 22, true) }
    if (id === 'data') data = { at: p + 8, size }
    p += 8 + size + (size & 1)
  }
  const n = data.size / (fmt.bits / 8) / fmt.ch, out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let c = 0; c < fmt.ch; c++) {
      const o = data.at + (i * fmt.ch + c) * (fmt.bits / 8)
      s += fmt.format === 3 ? v.getFloat32(o, true) : fmt.bits === 16 ? v.getInt16(o, true) / 32768 : v.getInt32(o, true) / 2147483648
    }
    out[i] = s / fmt.ch
  }
  return { pcm: out, rate: fmt.rate }
}

function powerSpectrum(x) {   // Blackman window, radix-2 FFT, |X|²
  const n = x.length, re = new Float64Array(n), im = new Float64Array(n)
  for (let i = 0; i < n; i++) re[i] = x[i] * (0.42 - 0.5 * Math.cos(2 * Math.PI * i / n) + 0.08 * Math.cos(4 * Math.PI * i / n))
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len
    for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
      const wr = Math.cos(a * k), wi = Math.sin(a * k), r = re[i + k + len / 2], m = im[i + k + len / 2]
      const tr = r * wr - m * wi, ti = r * wi + m * wr
      re[i + k + len / 2] = re[i + k] - tr; im[i + k + len / 2] = im[i + k] - ti
      re[i + k] += tr; im[i + k] += ti
    }
  }
  return Array.from({ length: n / 2 }, (_, i) => re[i] ** 2 + im[i] ** 2)
}

const { pcm, rate } = readWav(readFileSync(file))
// a quiet minute of room before the recording, so there is a noise floor to stand out from
const lead = rate * 60, sig = new Float32Array(lead + pcm.length)
const amp = 10 ** (room / 20)
for (let i = 0; i < sig.length; i++) sig[i] = (i >= lead ? pcm[i - lead] : 0) + (Math.random() * 2 - 1) * amp

const N = 2048, hop = Math.round(rate / 10), hz = rate / N
const f = { db: [], low: [], mid: [], vr: [], at: [] }
let acc = null, last = null
for (let end = N; end <= sig.length; end += hop) {
  const w = sig.subarray(end - N, end)
  let sum = 0
  for (const s of w) sum += s * s
  const db = 20 * Math.log10(Math.sqrt(sum / N) || 1e-10) + 100
  const ps = powerSpectrum(w)
  let lo = 0, mid = 0, all = 0
  for (let i = Math.ceil(50 / hz); i < Math.min(ps.length, 4000 / hz); i++) {
    all += ps[i]
    if (i * hz < 500) lo += ps[i]; else if (i * hz < 3000) mid += ps[i]
  }
  const sec = Math.floor(end / rate)
  if (!acc || acc.sec !== sec) {
    if (acc) push(acc)
    acc = { sec, dbs: [], low: 0, mid: 0, at: 0 }
  }
  acc.dbs.push(db); acc.low += all ? lo / all : 0; acc.mid += all ? mid / all : 0
  if (last != null) acc.at = Math.max(acc.at, db - last)
  last = db
}
push(acc)
function push(a) {
  const n = a.dbs.length, m = a.dbs.reduce((s, v) => s + v, 0) / n
  f.db.push(Math.max(...a.dbs)); f.low.push(a.low / n); f.mid.push(a.mid / n)
  f.vr.push(Math.sqrt(a.dbs.reduce((s, v) => s + (v - m) ** 2, 0) / n)); f.at.push(a.at)
}

const KIND = ['quiet', 'move', 'snore', 'talk', 'cough', 'noise'], r = v => v.toFixed(2)
console.log('start  len  kind   low   mid   spread  jump')
for (const b of sounds(f)) console.log(`${String(b.start - 60).padStart(5)} ${String(b.end - b.start).padStart(4)}  ${KIND[b.kind].padEnd(6)} ${r(b.low)}  ${r(b.mid)}  ${b.vr.toFixed(1).padStart(5)}  ${b.at.toFixed(1).padStart(5)}`)
console.log('\nevents:', events(f, 0).map(e => `${e.kind}@${e.t / 1000 - 60}s/${e.sec}s`).join('  ') || 'none')
