// Draws the home-screen icons (public/icon-180.png, icon-512.png): a crescent in the accent
// colour on the app's background. No image library: a disc minus an offset disc, 4x4 supersampled.
//   node scripts/icons.mjs
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const BG = [0x0b, 0x0a, 0x09], FG = [0x8b, 0x8c, 0xf8]

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
function png(size) {
  const raw = Buffer.alloc(size * (size * 3 + 1))
  const r = size * 0.3, cx = size * 0.5, cy = size * 0.5, ox = cx + r * 0.55, oy = cy - r * 0.45
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0
    for (let x = 0; x < size; x++) {
      let hit = 0
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const px = x + (sx + 0.5) / 4, py = y + (sy + 0.5) / 4
        if ((px - cx) ** 2 + (py - cy) ** 2 < r * r && (px - ox) ** 2 + (py - oy) ** 2 >= (r * 0.85) ** 2) hit++
      }
      const a = hit / 16, i = y * (size * 3 + 1) + 1 + x * 3
      for (let k = 0; k < 3; k++) raw[i + k] = Math.round(BG[k] + (FG[k] - BG[k]) * a)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
for (const s of [180, 512]) writeFileSync(new URL(`../public/icon-${s}.png`, import.meta.url), png(s))
// the native night app's icon (ios/MySleepNight): one 1024 px image, iOS makes the rest
writeFileSync(new URL('../../ios/MySleepNight/Assets.xcassets/AppIcon.appiconset/icon-1024.png', import.meta.url), png(1024))
