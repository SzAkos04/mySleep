// Draws the two apps' home-screen icons, so they tell themselves apart at a glance:
// - mySleep, the web app, the mornings (public/icon-180.png, icon-512.png, icon.svg): a light
//   indigo tile with three rising white bars and a small crescent.
// - mySleep Night, the native app, the nights (ios/.../AppIcon.appiconset/icon-1024.png): black,
//   as its night screen, with the indigo crescent and a red record dot.
// No image library: shapes tested per pixel, 4x4 supersampled.
//   node scripts/icons.mjs
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const BG = [0x0b, 0x0a, 0x09], ACC = [0x8b, 0x8c, 0xf8], RED = [0xff, 0x45, 0x3a], WHITE = [255, 255, 255]
const TOP = [0x9d, 0x9e, 0xff], BOTTOM = [0x5a, 0x4c, 0xd6]

const disc = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 < r * r
const crescent = (cx, cy, r) => (x, y) => disc(cx, cy, r)(x, y) && !disc(cx + r * 0.55, cy - r * 0.45, r * 0.85)(x, y)
// a bar with a round top, from `top` down to `bottom`
const bar = (cx, w, top, bottom) => (x, y) => (Math.abs(x - cx) < w / 2 && y > top + w / 2 && y < bottom) || disc(cx, top + w / 2, w / 2)(x, y)

// What each icon is: a background (unit coordinates) and shapes drawn over it in order.
const ICONS = {
  web: {
    bg: (x, y) => TOP.map((t, i) => t + (BOTTOM[i] - t) * y),
    shapes: [
      [WHITE, bar(0.32, 0.13, 0.56, 0.76)],
      [WHITE, bar(0.5, 0.13, 0.44, 0.76)],
      [WHITE, bar(0.68, 0.13, 0.32, 0.76)],
      [WHITE, crescent(0.33, 0.33, 0.1)]
    ]
  },
  night: {
    bg: () => BG,
    shapes: [
      [ACC, crescent(0.46, 0.54, 0.3)],
      [RED, disc(0.72, 0.28, 0.075)]
    ]
  }
}

// The colour at (x, y), 0..1, sampled at that point (the tests look at single points).
export function pixel(kind, x, y) {
  const { bg, shapes } = ICONS[kind]
  let c = bg(x, y)
  for (const [col, inside] of shapes) if (inside(x, y)) c = col
  return c.map(Math.round)
}

function crc32(buf) {
  let c, crc = ~0
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c }
  return ~crc >>> 0
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0); out.write(type, 4); data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}
export function png(kind, size) {
  const raw = Buffer.alloc(size * (size * 3 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0]
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const c = pixel(kind, (x + (sx + 0.5) / 4) / size, (y + (sy + 0.5) / 4) / size)
        for (let k = 0; k < 3; k++) sum[k] += c[k]
      }
      const i = y * (size * 3 + 1) + 1 + x * 3
      for (let k = 0; k < 3; k++) raw[i + k] = Math.round(sum[k] / 16)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  for (const s of [180, 512]) writeFileSync(new URL(`../public/icon-${s}.png`, import.meta.url), png('web', s))
  // the browser tab's icon, the same picture as the web app's
  writeFileSync(new URL('../public/icon.svg', import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="512"><stop offset="0" stop-color="#9d9eff"/><stop offset="1" stop-color="#5a4cd6"/></linearGradient></defs>
<rect width="512" height="512" fill="url(#g)"/>
<g fill="#fff">${[[0.32, 0.56], [0.5, 0.44], [0.68, 0.32]].map(([cx, top]) => `<rect x="${(cx - 0.065) * 512}" y="${top * 512}" width="${0.13 * 512}" height="${(0.76 - top) * 512}" rx="${0.065 * 512}"/>`).join('')}
<path fill-rule="evenodd" d="M${(0.33 - 0.1) * 512} ${0.33 * 512}a${0.1 * 512} ${0.1 * 512} 0 1 0 ${0.2 * 512} 0a${0.1 * 512} ${0.1 * 512} 0 1 0 ${-0.2 * 512} 0Z"/></g>
<circle cx="${(0.33 + 0.055) * 512}" cy="${(0.33 - 0.045) * 512}" r="${0.085 * 512}" fill="url(#g)"/></svg>
`)
  // the native night app's icon: one 1024 px image, iOS makes the rest
  writeFileSync(new URL('../../ios/MySleepNight/Assets.xcassets/AppIcon.appiconset/icon-1024.png', import.meta.url), png('night', 1024))
}
