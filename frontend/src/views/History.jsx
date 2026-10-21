import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore, nightList } from '../store.js'
import { Icon } from '../components/Icon.jsx'
import { Dots } from '../components/Charts.jsx'
import { clockOf, dayLabel, dur } from '../lib/time.js'

const PAGE = 20

export function History() {
  const nights = nightList(useStore(s => s.nights))
  const [shown, setShown] = useState(PAGE)
  return <>
    <header className="hdr"><div><h1>History</h1><div className="sub">{nights.length} {nights.length === 1 ? 'night' : 'nights'}</div></div></header>
    {nights.length ? <div className="sect"><div className="sect-b">
      {nights.slice(0, shown).map(n => <Link key={n.id} to={'/night/' + n.id} className="row" style={{ color: 'inherit', textDecoration: 'none' }}>
        <div className="t">
          <div>{dayLabel(n.id)}</div>
          <div className="s num">{clockOf(n.bed)} – {clockOf(n.wake)}{n.snoreMin ? ` · snoring ${n.snoreMin}m` : ''}{n.tags?.length ? ' · ' + n.tags.join(', ') : ''}</div>
        </div>
        <div className="r"><div>{dur(n.asleepMin || 0)}</div><Dots q={n.q} /></div>
        <Icon name="chev" className="chev" />
      </Link>)}
    </div></div> : <div className="empty">No nights yet.</div>}
    {shown < nights.length && <button className="btn ghost" onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, nights.length - shown)} more</button>}
  </>
}
