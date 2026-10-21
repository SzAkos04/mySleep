import { clockOf } from '../lib/time.js'
import { noonToClock } from '../lib/stats.js'

const W = 340
const STATE = { s: 'color-mix(in srgb,var(--acc) 55%,transparent)', l: 'color-mix(in srgb,var(--acc) 55%,transparent)', d: 'var(--acc)', w: 'var(--awake)', g: 'var(--surface-3)' }
const LEVEL = { w: 0, l: 1, s: 1, d: 2 }   // hypnogram rows, top to bottom
export const EVENT = {
  n: ['Snoring', 'var(--snore)'], t: ['Talking', 'var(--talk)'], c: ['Coughing', 'var(--red)'],
  m: ['Movement', 'var(--move)'], x: ['Room noise', 'var(--label-4)']
}

// A night as the microphone heard it: loudness, then (full) a three-row estimate of the night
// (awake / light / restful) and the sounds; (small) one coloured lane.
export function Timeline({ t, full }) {
  if (!t?.states) return null
  const E = t.states.length, x = e => (e / E) * W
  const sH = full ? 34 : 30, top = sH + 8, rowH = full ? 18 : 10, evY = full ? top + 3 * rowH + 8 : 0
  const H = full ? evY + 34 : 70
  const vals = t.db.filter(v => v != null), lo = Math.min(...vals), hi = Math.max(lo + 10, ...vals)
  const y = v => sH - ((v - lo) / (hi - lo)) * sH
  let d = `M0 ${sH}`
  t.db.forEach((v, m) => { d += ` L${((m * 2) / E * W).toFixed(1)} ${(v == null ? sH : y(v)).toFixed(1)}` })
  d += ` L${W} ${sH} Z`
  const runs = []
  for (let s = 0, e = 1; e <= E; e++) if (e === E || t.states[e] !== t.states[s]) { runs.push([s, e, t.states[s]]); s = e }
  const hours = []
  for (let h = Math.ceil(t.start / 3600e3) * 3600e3; h < t.start + E * 30e3; h += 3600e3) hours.push(h)
  return <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Loudness, an estimate of awake, light and restful sleep, and sounds through the night">
    <path d={d} fill="var(--label-4)" />
    {full ? <>
      {['Awake', 'Light', 'Restful'].map((l, i) => <text key={l} x="0" y={top + i * rowH + rowH * 0.7} style={{ fontSize: 9 }}>{l}</text>)}
      {runs.map(([s, e, k]) => k === 'g' ? null :
        <rect key={s} x={42 + x(s) * (W - 42) / W} y={top + LEVEL[k] * rowH} width={Math.max((x(e) - x(s)) * (W - 42) / W - 0.4, 1)} height={rowH - 3} rx="2" fill={STATE[k]} />)}
      {[...t.events].map((c, e) => c === '.' || !EVENT[c] ? null :
        <rect key={e} x={42 + x(e) * (W - 42) / W} y={evY + (c === 'm' ? 4 : 0)} width={Math.max(x(1) * (W - 42) / W, 1.2)} height={c === 'm' ? 8 : 12} fill={EVENT[c][1]} />)}
      {hours.map(h => {
        const hx = 42 + x((h - t.start) / 30e3) * (W - 42) / W
        return <g key={h}><line x1={hx} x2={hx} y1="0" y2={evY + 14} stroke="var(--label-4)" strokeWidth=".5" /><text x={hx} y={H - 2} textAnchor="middle">{clockOf(h)}</text></g>
      })}
    </> : <>
      {runs.map(([s, e, k]) => <rect key={s} x={x(s)} y={top} width={Math.max(x(e) - x(s) - 0.6, 1)} height={rowH} rx="2" fill={STATE[k]} />)}
      <text x="0" y="68">{clockOf(t.start)}</text>
      <text x={W} y="68" textAnchor="end">{clockOf(t.start + E * 30e3)}</text>
    </>}
  </svg>
}

export const TimelineLegend = () => <div className="legend">
  <span><i style={{ background: 'var(--awake)' }} />Awake</span>
  <span><i style={{ background: STATE.l }} />Light</span>
  <span><i style={{ background: STATE.d }} />Restful</span>
  {Object.entries(EVENT).map(([k, [name, color]]) => <span key={k}><i style={{ background: color }} />{name}</span>)}
</div>

// The sleep score as a ring.
export function ScoreRing({ score, size = 96 }) {
  const r = 42, c = 2 * Math.PI * r
  const color = score >= 80 ? 'var(--good)' : score >= 60 ? 'var(--acc)' : 'var(--awake)'
  return <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`Sleep score ${score}`} style={{ flex: 'none' }}>
    <circle cx="50" cy="50" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="8" />
    <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${c * score / 100} ${c}`} transform="rotate(-90 50 50)" />
    <text x="50" y="58" textAnchor="middle" style={{ fontSize: 28, fontWeight: 700, fill: 'var(--label)' }}>{score}</text>
  </svg>
}

const DAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const dayOf = id => new Date(id + 'T12:00')

// Bars per night, oldest left. `ticks` are values on the axis, `tick` labels them.
export function Bars({ nights, val, max, ticks, tick, target, color, h = 120 }) {
  const L = 28, top = 6, B = h - 16, n = nights.length, bw = (W - L) / Math.max(n, 1), y = v => B - (Math.min(v, max) / max) * (B - top)
  return <svg className="chart" viewBox={`0 0 ${W} ${h}`}>
    {ticks.map(v => <g key={v}><line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke="var(--label-4)" strokeWidth=".5" /><text x="0" y={y(v) + 3}>{tick(v)}</text></g>)}
    {nights.map((nt, i) => {
      const v = val(nt) || 0, bx = L + i * bw + bw * 0.18, d = dayOf(nt.id)
      return <g key={nt.id}>
        {v > 0 && <rect x={bx} y={y(v)} width={bw * 0.64} height={B - y(v)} rx={Math.min(3, bw * 0.2)} fill={color ? color(nt) : 'var(--acc)'} />}
        {(n <= 7 || d.getDay() === 1) && <text x={bx + bw * 0.32} y={h - 2} textAnchor="middle">{n <= 7 ? DAY[d.getDay()] : d.getDate()}</text>}
      </g>
    })}
    {target != null && <line x1={L} x2={W} y1={y(target)} y2={y(target)} stroke="var(--label-2)" strokeDasharray="3 3" />}
  </svg>
}

// When each night's sleep happened: a bar from falling asleep to waking, on a clock axis.
export function Windows({ nights, bedtime, wake, fromNoon }) {
  const h = 170, L = 34, top = 4, B = 156, lo = 600, hi = 1260, n = nights.length, bw = (W - L) / Math.max(n, 1)
  const y = m => top + ((Math.min(Math.max(m, lo), hi) - lo) / (hi - lo)) * (B - top)
  return <svg className="chart" viewBox={`0 0 ${W} ${h}`}>
    {[600, 720, 840, 960, 1080, 1200].map(m => <g key={m}><line x1={L} x2={W} y1={y(m)} y2={y(m)} stroke="var(--label-4)" strokeWidth=".5" /><text x="0" y={y(m) + 3}>{noonToClock(m)}</text></g>)}
    {[bedtime, wake].map(m => <line key={m} x1={L} x2={W} y1={y(m)} y2={y(m)} stroke="var(--label-2)" strokeDasharray="3 3" />)}
    {nights.map((nt, i) => {
      if (!nt.on || !nt.wake) return null
      const bx = L + i * bw + bw * 0.2, a = fromNoon(nt.on), b = fromNoon(nt.wake), d = dayOf(nt.id)
      return <g key={nt.id}>
        <rect x={bx} y={y(a)} width={bw * 0.6} height={Math.max(y(b) - y(a), 1)} rx={Math.min(3, bw * 0.25)} fill="var(--acc)" />
        {(n <= 7 || d.getDay() === 1) && <text x={bx + bw * 0.3} y={h - 2} textAnchor="middle">{n <= 7 ? DAY[d.getDay()] : d.getDate()}</text>}
      </g>
    })}
  </svg>
}

export const Dots = ({ q, big }) => <span className={'dots' + (big ? ' big' : '')} aria-label={q ? `Quality ${q} of 5` : 'No quality'}>
  {[1, 2, 3, 4, 5].map(i => <i key={i} className={i <= (q || 0) ? 'on' : ''} />)}
</span>
