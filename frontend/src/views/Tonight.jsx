import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore, nightList } from '../store.js'
import { Icon } from '../components/Icon.jsx'
import { Timeline, Bars, ScoreRing } from '../components/Charts.jsx'
import { sleepScore, NEED } from '../lib/score.js'
import { alarmPlan, startNight } from './Tracking.jsx'
import { clockOf, dur, nextAt, todayLabel } from '../lib/time.js'

export function Tonight() {
  const settings = useStore(s => s.settings), nights = nightList(useStore(s => s.nights))
  const [err, setErr] = useState(null)
  const last = nights[0], week = nights.slice(0, 7).reverse()
  const toBed = (nextAt(settings.bedtime) - Date.now()) / 60000
  const plan = alarmPlan(settings)
  const debt = week.reduce((s, n) => s + Math.max(0, NEED - (n.asleepMin || 0)), 0)

  return <>
    <header className="hdr">
      <div><h1>Tonight</h1><div className="sub">{todayLabel()}</div></div>
    </header>

    <div className="card">
      <div className="eyebrow">Bedtime</div>
      <div className="card-title">{toBed < 12 * 60 ? `Lights out in ${dur(toBed)}` : `Lights out at ${settings.bedtime}`}</div>
      <div className="target">
        <div><span className="muted small">Go to bed</span><b>{settings.bedtime}</b></div>
        <div><span className="muted small">{settings.smart ? 'Alarm window' : 'Alarm'}</span><b>{plan ? (settings.smart ? `${clockOf(plan.from)}–${clockOf(plan.at)}` : clockOf(plan.at)) : 'Off'}</b></div>
      </div>
      <button className="btn" onClick={() => { setErr(null); startNight().catch(e => setErr(e.message)) }}><Icon name="moon" />Start sleep tracking</button>
      {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}
    </div>

    {last ? <div className="card">
      <div className="card-head">
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <ScoreRing score={sleepScore(last, settings).score} size={56} />
          <div><div className="eyebrow">Last night</div><div className="card-title">{dur(last.asleepMin || 0)} asleep</div></div>
        </div>
        <Link className="link" to={'/night/' + last.id}>Details</Link>
      </div>
      <Timeline t={last.timeline} />
      <div className="tiles in">
        <div className="tile"><div className="l">Fell asleep</div><div className="v">{last.on ? Math.round((last.on - last.bed) / 60000) + ' min' : '–'}</div></div>
        <div className="tile"><div className="l">Woke up</div><div className="v">{last.wakes ?? 0}×</div>{last.awakeMin > 0 && <div className="d">{Math.round(last.awakeMin)} min awake</div>}</div>
        <div className="tile"><div className="l">Snoring</div><div className="v">{last.snoreMin != null ? last.snoreMin + ' min' : '–'}</div></div>
        <div className="tile"><div className="l">Restful</div><div className="v">{last.restfulMin != null ? dur(last.restfulMin) : '–'}</div><div className="d">estimate</div></div>
      </div>
    </div> : <div className="card empty">Your first night shows up here. Tap Start sleep tracking at bedtime.</div>}

    {week.length > 1 && <div className="card">
      <div className="card-head"><div><div className="eyebrow">This week</div><div className="card-title">Sleep debt {dur(debt)}</div></div></div>
      <Bars nights={week} val={n => n.asleepMin} max={540} ticks={[0, 180, 360, 540]} tick={v => v / 60 + 'h'} target={NEED}
        color={n => n.asleepMin < NEED ? 'color-mix(in srgb,var(--acc) 55%,transparent)' : 'var(--acc)'} />
    </div>}
  </>
}
