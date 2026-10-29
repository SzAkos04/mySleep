// The sleep score (0–100) and the night in a few plain sentences. Derived from a saved night, so
// changing the formula re-scores every night (docs/dev/SOUND_ANALYSIS.md).
import { fromNoon } from './stats.js'
import { clockOf, dur } from './time.js'

// What a night is scored against: the middle of the 7–9 h adults need (AASM, 2015). Not a
// setting: nobody knows their own number, and the score should not depend on a guess.
export const NEED = 480

const clamp = v => Math.max(0, Math.min(1, v))
const lerp = (v, zero, full) => clamp((v - zero) / (full - zero))
const toNoon = hhmm => { const [h, m] = hhmm.split(':').map(Number); return (h * 60 + m + 720) % 1440 }

export function sleepScore(n, settings) {
  const inBed = (n.wake - n.bed) / 60000, latency = n.on ? (n.on - n.bed) / 60000 : null
  // without sleep there is nothing to be continuous, quick or on time about
  const slept = (n.asleepMin || 0) > 0
  const parts = [
    { label: 'Duration', max: 35, pts: 35 * clamp((n.asleepMin || 0) / NEED), note: `${dur(n.asleepMin || 0)} of ${dur(NEED)}` },
    inBed > 0 && { label: 'Efficiency', max: 20, pts: 20 * lerp((n.asleepMin || 0) / inBed, 0.6, 0.9), note: `${Math.round((n.asleepMin || 0) / inBed * 100)}% of time in bed asleep` },
    slept && { label: 'Continuity', max: 15, pts: 15 * lerp(n.awakeMin || 0, 40, 0), note: n.wakes ? `${n.wakes} wake-up${n.wakes > 1 ? 's' : ''}, ${Math.round(n.awakeMin || 0)} min awake` : 'Slept through' },
    slept && latency != null && { label: 'Falling asleep', max: 10, pts: 10 * lerp(latency, 60, 15), note: `${Math.round(latency)} min` },
    slept && n.timeline && n.restfulMin != null && { label: 'Restfulness', max: 10, pts: 10 * clamp(n.restfulMin / Math.max(1, n.asleepMin) / 0.35), note: `${dur(n.restfulMin)} restful (estimate)` },
    slept && n.on && { label: 'Routine', max: 10, pts: 10 * lerp(Math.abs(fromNoon(n.on) - toNoon(settings.bedtime)), 90, 15), note: `asleep at ${clockOf(n.on)}, bedtime ${settings.bedtime}` }
  ].filter(Boolean)
  const max = parts.reduce((s, p) => s + p.max, 0), pts = parts.reduce((s, p) => s + p.pts, 0)
  return { score: Math.round(100 * pts / max), parts: parts.map(p => ({ ...p, pts: Math.round(p.pts) })) }
}

// The longest run of one letter in the timeline, as [from, to] in ms.
function longestRun(t, ch) {
  let best = null
  for (let i = 0; i < t.states.length; i++) {
    if (t.states[i] !== ch) continue
    let j = i
    while (j < t.states.length && t.states[j] === ch) j++
    if (!best || j - i > best[1] - best[0]) best = [i, j]
    i = j
  }
  return best && best.map(e => t.start + e * 30000)
}

const times = list => list.map(e => clockOf(e.t)).join(', ')

// Most of the night without a recording ('g' epochs): the microphone sent nothing (29 October),
// which says nothing about sleep. Told apart from a night the microphone heard and found no sleep in.
const UNRECORDED = 0.9
const gapRuns = t => [...t.states.matchAll(/g+/g)].map(m => [m.index, m[0].length])
export const unrecorded = n => !!n.timeline?.states?.length && (n.timeline.states.match(/g/g) || []).length >= UNRECORDED * n.timeline.states.length

export function insights(n) {
  if (unrecorded(n)) {
    const gapMin = Math.min((n.timeline.states.match(/g/g) || []).length / 2, (n.wake - n.bed) / 60000)   // the last block is padded
    return [`The microphone recorded nothing (${dur(gapMin)}), so this night has no score.`]
  }
  const out = []
  if (n.timeline && !n.on) out.push('No sleep was heard: you were moving, or the recording was too short.')
  if (n.on) out.push(`You fell asleep at ${clockOf(n.on)}, ${Math.round((n.on - n.bed) / 60000)} min after going to bed.`)
  const wakes = (n.events || []).length && n.timeline ? wakeTimes(n.timeline) : []
  if (n.wakes) out.push(`You woke ${n.wakes === 1 ? 'once' : n.wakes + ' times'}${wakes.length ? ' (' + wakes.join(', ') + ')' : ''}, ${Math.round(n.awakeMin || 0)} min awake in all.`)
  else if (n.on && n.asleepMin > 0) out.push('You slept through without waking.')
  const ev = n.events || []
  const snore = ev.filter(e => e.kind === 'snore')
  if (snore.length) out.push(`You snored for about ${Math.round(n.snoreMin)} min, ${snore.length === 1 ? 'from ' + clockOf(snore[0].t) : 'mostly ' + peakHour(snore)}.`)
  const talk = ev.filter(e => e.kind === 'talk')
  if (talk.length) out.push(`You talked in your sleep ${talk.length === 1 ? 'once' : talk.length + ' times'} (${times(talk.slice(0, 4))}${talk.length > 4 ? '…' : ''}).`)
  const cough = ev.filter(e => e.kind === 'cough')
  if (cough.length) out.push(`You coughed ${cough.length === 1 ? 'once' : cough.length + ' times'} (${times(cough.slice(0, 4))}${cough.length > 4 ? '…' : ''}).`)
  const noise = ev.filter(e => e.kind === 'noise')
  if (noise.length) out.push(`The room was noisy ${noise.length === 1 ? 'once' : noise.length + ' times'} (${times(noise.slice(0, 3))}): long sounds that were not you.`)
  const gaps = n.timeline ? gapRuns(n.timeline) : [], gapMin = gaps.reduce((s, g) => s + g[1], 0) / 2
  if (gapMin >= 10) {
    const longest = gaps.reduce((a, b) => b[1] > a[1] ? b : a), from = clockOf(n.timeline.start + longest[0] * 30000)
    out.push(`The microphone recorded nothing for ${dur(gapMin)}${gaps.length > 1 ? ` in ${gaps.length} stretches, the longest from ${from}` : `, from ${from}`}.`)
  }
  const calm = n.timeline && longestRun(n.timeline, 'd')
  if (calm && calm[1] - calm[0] >= 20 * 60000) out.push(`Your most restful stretch was ${clockOf(calm[0])}–${clockOf(calm[1])} (estimate).`)
  return out
}

function wakeTimes(t) {
  const out = [], s = t.states, first = s.search(/[ld]/), last = Math.max(s.lastIndexOf('l'), s.lastIndexOf('d'))
  for (let i = first; first >= 0 && i < last; i++) if (s[i] === 'w' && s[i - 1] !== 'w') out.push(clockOf(t.start + i * 30000))
  return out
}

function peakHour(list) {
  const by = {}
  for (const e of list) { const h = new Date(e.t).getHours(); by[h] = (by[h] || 0) + e.sec }
  const h = +Object.entries(by).sort((a, b) => b[1] - a[1])[0][0]
  return `between ${String(h).padStart(2, '0')}:00 and ${String((h + 1) % 24).padStart(2, '0')}:00`
}
