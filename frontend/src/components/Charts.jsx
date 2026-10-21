import { clockOf } from '../lib/time.js'
import { noonToClock } from '../lib/stats.js'

const W = 340
const STATE = { s: 'var(--acc)', w: 'var(--awake)', g: 'var(--surface-3)' }

// A night as the microphone heard it: loudness, asleep/awake, and sound events.
export function Timeline({ t, full }) {
  if (!t?.states) return null
  const E = t.states.length, x = e => (e / E) * W
  const sH = full ? 44 : 30, laneY = sH + 6, laneH = full ? 14 : 10, evY = laneY + laneH + 8
  const H = full ? 118 : 70
  const vals = t.db.filter(v => v != null), lo = Math.min(...vals), hi = Math.max(lo + 10, ...vals)
  const y = v => sH - ((v - lo) / (hi - lo)) * sH
  let d = `M0 ${sH}`
  t.db.forEach((v, m) => { d += ` L${((m * 2) / E * W).toFixed(1)} ${(v == null ? sH : y(v)).toFixed(1)}` })
  d += ` L${W} ${sH} Z`
  const runs = []
  for (let s = 0, e = 1; e <= E; e++) if (e === E || t.states[e] !== t.states[s]) { runs.push([s, e, t.states[s]]); s = e }
  const hours = []
  for (let h = Math.ceil(t.start / 3600e3) * 3600e3; h < t.start + E * 30e3; h += 3600e3) hours.push(h)
  return <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Loudness, asleep or awake, and sounds through the night">
    <path d={d} fill="var(--label-4)" />
    {runs.map(([s, e, k]) => <rect key={s} x={x(s)} y={laneY} width={Math.max(x(e) - x(s) - 0.6, 1)} height={laneH} rx="2" fill={STATE[k]} />)}
    {full && [...t.events].map((c, e) => c === '.' ? null :
      <rect key={e} x={x(e)} y={evY + (c === 'm' ? 4 : 0)} width={Math.max(x(1), 1.2)} height={c === 'm' ? 8 : 12} fill={c === 'n' ? 'var(--snore)' : 'var(--move)'} />)}
    {full ? hours.map(h => {
      const hx = x((h - t.start) / 30e3)
      return <g key={h}><line x1={hx} x2={hx} y1="0" y2={evY + 14} stroke="var(--label-4)" strokeWidth=".5" /><text x={hx} y="116" textAnchor="middle">{clockOf(h)}</text></g>
    }) : <>
      <text x="0" y="68">{clockOf(t.start)}</text>
      <text x={W} y="68" textAnchor="end">{clockOf(t.start + E * 30e3)}</text>
    </>}
  </svg>
}

export const TimelineLegend = () => <div className="legend">
  <span><i style={{ background: 'var(--acc)' }} />Asleep</span>
  <span><i style={{ background: 'var(--awake)' }} />Awake</span>
  <span><i style={{ background: 'var(--snore)' }} />Snoring</span>
  <span><i style={{ background: 'var(--move)' }} />Movement</span>
  <span><i style={{ background: 'var(--surface-3)' }} />Not recorded</span>
</div>

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
