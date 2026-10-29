import { it, expect } from 'vitest'
import { pixel } from './icons.mjs'

// The two apps side by side on the home screen must tell themselves apart at a glance:
// mySleep (the web app, the mornings) is a light indigo tile with rising bars,
// mySleep Night (the native app, the nights) a black tile with the crescent and a red record dot.
const near = (c, want, tol = 40) => c.every((v, i) => Math.abs(v - want[i]) <= tol)

it('mySleep: an indigo tile, white rising bars, the tallest on the right', () => {
  expect(near(pixel('web', 0.05, 0.05), [0x9d, 0x9e, 0xff])).toBe(true)        // light at the top
  expect(near(pixel('web', 0.05, 0.95), [0x5a, 0x4c, 0xd6])).toBe(true)        // deeper at the bottom
  expect(pixel('web', 0.68, 0.45)).toEqual([255, 255, 255])                    // inside the tall bar
  expect(pixel('web', 0.32, 0.45)).not.toEqual([255, 255, 255])                // above the short one
  expect(pixel('web', 0.32, 0.68)).toEqual([255, 255, 255])
})

it('mySleep Night: black, the indigo crescent, a red dot', () => {
  expect(pixel('night', 0.05, 0.05)).toEqual([0x0b, 0x0a, 0x09])
  expect(near(pixel('night', 0.72, 0.28), [0xff, 0x45, 0x3a], 10)).toBe(true)  // the record dot
  expect(near(pixel('night', 0.3, 0.55), [0x8b, 0x8c, 0xf8], 10)).toBe(true)   // the crescent's body
})
