// Makes the alarm recording louder once, offline, so the app needs no compressor while it rings
// (WebKit's adds its own make-up gain and pumped the piano in steps). A look-ahead peak limiter:
// drive the signal up, then hold every peak at the ceiling, recovering over RELEASE_MS.
//   node scripts/loud-alarm.mjs in.wav out.wav [drive dB, 6]
import { readFileSync, writeFileSync } from 'node:fs'
const [inp, outp, driveDb = '6'] = process.argv.slice(2)
const CEIL = 10 ** (-1 / 20), LOOK = 160, RELEASE_MS = 120   // 5 ms look-ahead at 32 kHz
const b = Buffer.from(readFileSync(inp))
let p = 12, at, size, rate
while (p < b.length - 8) {
  const id = b.toString('latin1', p, p + 4), s = b.readUInt32LE(p + 4)
  if (id === 'fmt ') rate = b.readUInt32LE(p + 12)
  if (id === 'data') { at = p + 8; size = s; break }
  p += 8 + s + (s & 1)
}
const n = size / 2, x = new Float32Array(n), drive = 10 ** (+driveDb / 20)
for (let i = 0; i < n; i++) x[i] = b.readInt16LE(at + i * 2) / 32768 * drive
// the gain each sample needs, seen LOOK samples ahead, released smoothly
const rel = Math.exp(-1 / (rate * RELEASE_MS / 1000)), need = new Float32Array(n)
for (let i = 0; i < n; i++) { let m = 0; for (let j = i; j < Math.min(n, i + LOOK); j++) m = Math.max(m, Math.abs(x[j])); need[i] = m > CEIL ? CEIL / m : 1 }
let g = 1
const rms = a => 20 * Math.log10(Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length))
const before = rms(Float32Array.from(x, v => v / drive))
for (let i = 0; i < n; i++) { g = need[i] < g ? need[i] : need[i] - (need[i] - g) * rel; x[i] *= g }
let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v))
for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), at + i * 2)
writeFileSync(outp, b)
console.log(`rms ${before.toFixed(1)} -> ${rms(x).toFixed(1)} dBFS, peak ${(20 * Math.log10(peak)).toFixed(2)} dBFS`)
