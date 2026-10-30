// A night log (lib/diag.js) as something to read: the device, every event with its clock time,
// where the readings have holes and why, and, when the raw readings are there, the analysis run
// again on them (so a change to analysis.js can be tried on a real night).
//   node shared/scripts/night-report.mjs debug/<uid>/<night>.json [--events all]
import { readFileSync } from 'node:fs'
import { summarize, events as soundEvents } from '../lib/analysis.js'

const [file, ...rest] = process.argv.slice(2)
const all = rest.includes('all')
const log = JSON.parse(readFileSync(file, 'utf8'))
const pad = n => String(n).padStart(2, '0')
const clock = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` }
const at = t => clock(log.start + t)
const brief = (d, max = 220) => d === undefined ? '' : JSON.stringify(d).replace(/"(\w+)":/g, '$1:').slice(0, max)

console.log(`night ${log.night}  started ${new Date(log.start).toString().slice(0, 24)}  ${log.final ? 'FINAL' : 'partial (the page never finished the night)'}, uploaded ${log.uploadedAt ? clock(log.uploadedAt) : '?'}`)
console.log('device', brief(log.env, Infinity))
if (log.settings) console.log('settings', brief(log.settings))

// counts first: what kind of night it was
const count = {}
for (const [, type] of log.events) count[type] = (count[type] || 0) + 1
console.log('\nevent counts', brief(count, Infinity))

// the story, without the minute beats (they come as a table below)
console.log('\nevents')
for (const [t, type, data] of log.events) {
  if (type === 'beat' && !all) continue
  if ((type === 'blur' || type === 'focus') && !all) continue
  console.log(` ${at(t)}  ${type.padEnd(18)} ${brief(data)}`)
}

const beats = log.events.filter(e => e[1] === 'beat')
if (beats.length) {
  // reads/zeros: analyser reads this minute and how many were exact digital silence; raw: the
  // level range in dBFS; ran: seconds the capture engine's clock moved (from 30 October)
  const native = log.env?.app === 'native'   // ios/MySleepNight: its own columns
  if (native) console.log('\nheartbeats (every minute): time  sec  missing/60  loudest  hearing  reads/zeros  raw dBFS  engine  app  locked  battery  charging  thermal  restarts')
  else console.log('\nheartbeats (every minute): time  sec  missing/60  loudest  mic  hearing  reads/zeros  raw dBFS  ran  ctx  awake  lock  video  vis')
  const shown = all ? beats : beats.filter((b, i) => i < 5 || i >= beats.length - 5 || b[2].missing60 || (!native && !b[2].live) || b[2].hearing === false || b[2].zeros || b[2].awake === 'none' || b[2].visibility !== 'visible')
  let prev = -1
  for (const b of shown) {
    const i = beats.indexOf(b)
    if (prev >= 0 && i > prev + 1) console.log(`   … ${i - prev - 1} normal minutes`)
    prev = i
    const d = b[2]
    const raw = d.peak == null ? '   –   ' : `${d.floor}…${d.peak}`
    if (native) { console.log(` ${at(b[0])}  ${String(d.sec).padStart(5)}  ${String(d.missing60).padStart(3)}  ${String(d.db).padStart(4)}  ${d.hearing ? 'yes' : 'NO '}  ${d.reads}/${d.zeros}  ${raw}  ${d.engine ? 'on' : 'OFF'}  ${d.app}  ${d.locked ? 'locked' : 'open'}  ${Math.round((d.battery ?? -1) * 100)}%  ${d.charging ? 'charging' : 'on battery'}  ${d.thermal}  ${d.restarts}`); continue }
    console.log(` ${at(b[0])}  ${String(d.sec).padStart(5)}  ${String(d.missing60).padStart(3)}  ${String(d.db).padStart(4)}  ${d.live ? 'live' : 'DEAD'}  ${d.hearing === false ? 'NO ' : d.hearing ? 'yes' : ' ? '}  ${d.reads ?? '?'}/${d.zeros ?? '?'}  ${raw}  ${d.ran ?? '?'}  ${d.ctx}${d.alarmCtx ? '/alarm ' + d.alarmCtx : ''}  ${d.awake}  ${d.lock}  ${d.video}  ${d.visibility}`)
  }
  // the page stops beating when it stops running: say where the last one was
  const tries = log.events.filter(e => /^(mic-silent|recover|recovered|recover-stuck|recover-failed)$/.test(e[1]))
  if (tries.length) console.log(`\nsilence and ways back: ${tries.map(e => `${at(e[0])} ${e[1]}${e[2]?.step ? ' ' + e[2].step : ''}`).join(', ').slice(0, 2000)}`)
  const last = beats.at(-1)
  console.log(` last beat ${at(last[0])}; log ends ${at(log.events.at(-1)[0])}`)
}

if (log.samples) {
  const s = log.samples, db = s.db.map(v => v ?? NaN)
  const holes = []
  for (let i = 0; i < db.length; i++) if (!Number.isFinite(db[i])) {
    let j = i; while (j < db.length && !Number.isFinite(db[j])) j++
    if (j - i >= 5) holes.push([i, j])
    i = j
  }
  console.log(`\nreadings: ${db.length} s (${(db.length / 3600).toFixed(2)} h), missing ${db.filter(v => !Number.isFinite(v)).length} s`)
  for (const [i, j] of holes.slice(0, 40)) console.log(`  hole ${clock(s.start + i * 1000)} – ${clock(s.start + j * 1000)}  (${j - i} s)`)
  const f = { db, low: s.low, mid: s.mid, vr: s.vr, at: s.at }
  const r = summarize(f, s.start)
  console.log('\nanalysis run again on the readings')
  console.log(' ', brief({ on: r.on && clock(r.on), asleepMin: r.asleepMin, restfulMin: r.restfulMin, wakes: r.wakes, awakeMin: r.awakeMin, snoreMin: r.snoreMin, talks: r.talks, coughs: r.coughs }))
  console.log('  states per 10 min:', r.timeline.states.match(/.{1,20}/g).map(x => [...new Set(x)].join('')).join(' '))
  const ev = soundEvents(f, s.start)
  console.log(`  sounds: ${ev.length}`, ev.slice(0, 30).map(e => `${e.kind}@${clock(e.t)}/${e.sec}s`).join('  '))
} else console.log('\n(no raw readings: only the final upload carries them)')
