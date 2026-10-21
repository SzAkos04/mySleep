import { Link } from 'react-router-dom'
import { useStore, nightList } from '../store.js'
import { Icon } from '../components/Icon.jsx'
import { Timeline, ScoreRing, scoreColor } from '../components/Charts.jsx'
import { NightReport, Insights } from '../components/Report.jsx'
import { sleepScore } from '../lib/score.js'
import { summary, noonToClock } from '../lib/stats.js'
import { SOUNDS } from '../lib/sounds.js'
import { alarmPlan } from './Tracking.jsx'
import { clockOf, dur, nextAt, todayLabel } from '../lib/time.js'

const pad = n => String(n).padStart(2, '0')
const idOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// This week, Monday first, as myGym's strip: a dot under each day coloured by that night's score.
function Week({ byId, settings }) {
  const today = new Date(), mon = new Date(today)
  mon.setDate(today.getDate() - (today.getDay() + 6) % 7)
  return <div className="week">{Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon); d.setDate(mon.getDate() + i)
    const n = byId[idOf(d)], isToday = idOf(d) === idOf(today)
    const dot = n && <span className="d" style={{ background: scoreColor(sleepScore(n, settings).score) }} />
    const inner = <><span className="l">{DAY[d.getDay()]}</span><span className="n">{d.getDate()}</span>{dot || <span className="d" />}</>
    return n ? <Link key={i} to={'/night/' + n.id} className={'wd' + (isToday ? ' today' : '')}>{inner}</Link>
      : <div key={i} className={'wd' + (isToday ? ' today' : '')}>{inner}</div>
  })}</div>
}

function TonightCard({ settings, compact }) {
  const plan = alarmPlan(settings)
  const toBed = (nextAt(settings.bedtime) - Date.now()) / 60000
  const sound = (SOUNDS.find(o => o.id === settings.alarmSound) || SOUNDS[0]).name
  const alarm = plan ? (settings.smart ? `${clockOf(plan.from)}–${clockOf(plan.at)}` : clockOf(plan.at)) : 'Off'
  if (compact) return <Link to="/settings" className="card line-card"><span className="muted">Tonight</span><span className="num">{settings.bedtime} · alarm {alarm}</span></Link>
  return <div className="hero">
    <div className="eyebrow">Tonight</div>
    <div className="hero-row"><span className="big num">{settings.bedtime}</span>{toBed < 12 * 60 && <span className="muted">in {dur(toBed)}</span>}</div>
    <div className="pair">
      <div><span className="small muted">Alarm{plan && settings.smart ? ' · smart' : ''}</span><b className="num">{alarm}</b></div>
      <div><span className="small muted">Sound</span><b>{plan ? sound : '–'}</b></div>
    </div>
  </div>
}

// One home that changes with the time of day (docs/dev/structure-options.html, option A):
// in the morning it opens with last night's report, otherwise with tonight's plan.
export function Today() {
  const settings = useStore(s => s.settings), nights = nightList(useStore(s => s.nights))
  const byId = Object.fromEntries(nights.map(n => [n.id, n]))
  const last = nights[0], now = new Date()
  const morning = last && now.getHours() < 12 && Date.now() - last.wake < 12 * 3600e3
  const thisWeek = nights.slice(0, 7), s = summary(thisWeek, 480)
  const avg = thisWeek.length ? Math.round(thisWeek.reduce((t, n) => t + sleepScore(n, settings).score, 0) / thisWeek.length) : null

  return <>
    <header className="hdr"><div><h1>{morning ? 'Good morning' : 'Today'}</h1><div className="sub">{todayLabel()}</div></div></header>

    {morning ? <>
      <Link to={'/night/' + last.id} className="plain"><NightReport n={last} label="Last night" /></Link>
      <div style={{ height: 12 }} />
      <Insights n={last} max={3} />
      <Week byId={byId} settings={settings} />
      <TonightCard settings={settings} compact />
    </> : <>
      <Week byId={byId} settings={settings} />
      <TonightCard settings={settings} />
      <div style={{ height: 12 }} />
      {last ? <Link to={'/night/' + last.id} className="card plain">
        <div className="last">
          <ScoreRing score={sleepScore(last, settings).score} size={58} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="eyebrow">Last night</div>
            <div className="last-title">{dur(last.asleepMin || 0)} asleep</div>
            <div className="small muted">{[last.wakes ? `Woke ${last.wakes === 1 ? 'once' : last.wakes + ' times'}` : last.on && 'Slept through', last.snoreMin ? `snored ${last.snoreMin} min` : null].filter(Boolean).join(' · ')}</div>
          </div>
          <Icon name="chev" className="chev" />
        </div>
        {last.timeline && <div style={{ marginTop: 10 }}><Timeline t={last.timeline} /></div>}
      </Link> : <div className="card empty">Tap Sleep at bedtime: your first night shows up here in the morning.</div>}
    </>}

    {thisWeek.length > 1 && <Link to="/trends" className="card plain">
      <div className="eyebrow" style={{ marginBottom: 8 }}>Last 7 nights</div>
      <div className="minibars">{thisWeek.slice().reverse().map(n => <i key={n.id} style={{ height: Math.max(6, Math.min(100, (n.asleepMin || 0) / 540 * 100)) + '%', background: scoreColor(sleepScore(n, settings).score) }} />)}</div>
      <div className="small muted" style={{ marginTop: 8 }}>Average {avg}{s?.on ? ` · asleep around ${noonToClock(s.on.mean)} ± ${Math.round(s.on.sd)} min` : ''}</div>
    </Link>}
  </>
}
