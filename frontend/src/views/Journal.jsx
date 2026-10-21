import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore, nightList } from '../store.js'
import { Icon } from '../components/Icon.jsx'
import { Timeline, ScoreRing, scoreColor } from '../components/Charts.jsx'
import { sleepScore } from '../lib/score.js'
import { dayLabel, dur } from '../lib/time.js'

const pad = n => String(n).padStart(2, '0')
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// Every night as a month calendar coloured by score; the chosen night (last night at first) below.
export function Journal() {
  const settings = useStore(s => s.settings), nights = nightList(useStore(s => s.nights))
  const byId = Object.fromEntries(nights.map(n => [n.id, n]))
  const now = new Date()
  const [month, setMonth] = useState(() => { const last = nights[0] ? new Date(nights[0].id + 'T12:00') : now; return new Date(last.getFullYear(), last.getMonth(), 1) })
  const [sel, setSel] = useState(nights[0]?.id)
  const y = month.getFullYear(), m = month.getMonth()
  const days = new Date(y, m + 1, 0).getDate(), lead = (new Date(y, m, 1).getDay() + 6) % 7
  const inMonth = nights.filter(n => n.id.startsWith(`${y}-${pad(m + 1)}`))
  const avg = inMonth.length ? Math.round(inMonth.reduce((t, n) => t + sleepScore(n, settings).score, 0) / inMonth.length) : null
  const n = byId[sel]
  const go = d => setMonth(new Date(y, m + d, 1))

  return <>
    <header className="hdr">
      <div><h1>{MONTH[m]}{y !== now.getFullYear() ? ' ' + y : ''}</h1><div className="sub">{inMonth.length ? `Average ${avg} · ${inMonth.length} ${inMonth.length === 1 ? 'night' : 'nights'}` : 'No nights this month'}</div></div>
      <div className="hdr-btns">
        <button className="iconbtn" onClick={() => go(-1)} aria-label="Previous month"><Icon name="back" /></button>
        <button className="iconbtn" onClick={() => go(1)} aria-label="Next month" disabled={y === now.getFullYear() && m === now.getMonth()}><Icon name="chev" /></button>
      </div>
    </header>

    <div className="card cal-card">
      <div className="cal">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="h">{d}</span>)}
        {Array.from({ length: lead }, (_, i) => <span key={'l' + i} />)}
        {Array.from({ length: days }, (_, i) => {
          const id = `${y}-${pad(m + 1)}-${pad(i + 1)}`, night = byId[id], future = new Date(y, m, i + 1) > now
          const c = night && scoreColor(sleepScore(night, settings).score)
          return <button key={id} className={'c' + (future ? ' fut' : '') + (id === sel ? ' sel' : '')} disabled={!night}
            style={c ? { background: `color-mix(in srgb,${c} 30%,transparent)`, color: 'var(--label)' } : null}
            onClick={() => setSel(id)} aria-label={night ? `${dayLabel(id)}, score ${sleepScore(night, settings).score}` : undefined}>{i + 1}</button>
        })}
      </div>
    </div>

    {n ? <Link to={'/night/' + n.id} className="card plain">
      <div className="last">
        <ScoreRing score={sleepScore(n, settings).score} size={58} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="eyebrow">{dayLabel(n.id)}</div>
          <div className="last-title">{dur(n.asleepMin || 0)} asleep</div>
          <div className="small muted">{[n.wakes ? `Woke ${n.wakes === 1 ? 'once' : n.wakes + ' times'}` : n.on && 'Slept through', n.snoreMin ? `snored ${n.snoreMin} min` : null, n.talks ? `talked ${n.talks === 1 ? 'once' : n.talks + ' times'}` : null].filter(Boolean).join(' · ')}</div>
        </div>
        <Icon name="chev" className="chev" />
      </div>
      {n.timeline && <div style={{ marginTop: 10 }}><Timeline t={n.timeline} /></div>}
    </Link> : <div className="empty">{nights.length ? 'Pick a night in the calendar.' : 'Your nights will fill this calendar.'}</div>}
  </>
}
