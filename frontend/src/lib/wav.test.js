import { it, expect } from 'vitest'
import { encodeWav } from './wav.js'

it('writes a 16-bit mono WAV header and clamped samples', () => {
  const v = new DataView(encodeWav(new Float32Array([0, 1, -2]), 16000))
  const tag = o => String.fromCharCode(...[0, 1, 2, 3].map(i => v.getUint8(o + i)))
  expect([tag(0), tag(8), tag(12), tag(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data'])
  expect(v.getUint32(24, true)).toBe(16000)
  expect(v.getUint32(40, true)).toBe(6)
  expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true)]).toEqual([0, 32767, -32767])
})
