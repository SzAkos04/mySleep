import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store.js'
import { useUI } from '../ui.js'
import { Icon } from '../components/Icon.jsx'
import { Timeline, TimelineLegend, Dots } from '../components/Charts.jsx'
import { Confirm } from '../components/Sheet.jsx'
import { clockOf, dayLabel, dur } from '../lib/time.js'

export function Night() {
  const { id } = useParams(), nav = useNavigate()
  const n = useStore(s => s.nights[id]), deleteNight = useStore(s => s.deleteNight)
  const { openSheet, say } = useUI()
  const [confirm, setConfirm] = useState(false)
  const back = <div className="back"><button className="iconbtn" onClick={() => nav(-1)} aria-label="Back"><Icon name="back" /></button></div>
  if (!n || n.deleted) return <>{back}<div className="empty">This night is gone.</div></>

  const inBed = (n.wake - n.bed) / 60000
  return <>
    {back}
    <header className="hdr">
      <div><h1>{dayLabel(n.id)}</h1><div className="sub num">In bed {clockOf(n.bed)} – {clockOf(n.wake)} · {dur(inBed)}</div></div>
      <button className="iconbtn" onClick={() => openSheet({ type: 'review', night: n })} aria-label="Edit night"><Icon name="edit" /></button>
    </header>
    <div className="tiles">
      <div className="tile"><div className="l">Asleep</div><div className="v">{dur(n.asleepMin || 0)}</div>{inBed > 0 && <div className="d">{Math.round((n.asleepMin || 0) / inBed * 100)}% of time in bed</div>}</div>
      <div className="tile"><div className="l">Fell asleep</div><div className="v">{Math.round((n.on - n.bed) / 60000)} min</div><div className="d">at {clockOf(n.on)}{n.timeline ? ' · estimated' : ''}</div></div>
      <div className="tile"><div className="l">Woke up</div><div className="v">{n.wakes ?? 0}×</div>{n.awakeMin > 0 && <div className="d">{Math.round(n.awakeMin)} min awake</div>}</div>
      {n.snoreMin != null
        ? <div className="tile"><div className="l">Snoring</div><div className="v">{n.snoreMin} min</div></div>
        : <div className="tile"><div className="l">Quality</div><div className="v"><Dots q={n.q} big /></div></div>}
    </div>
    {n.timeline && <div className="card">
      <div className="eyebrow">Night</div>
      <div className="card-title" style={{ marginBottom: 12 }}>What the microphone heard</div>
      <Timeline t={n.timeline} full />
      <TimelineLegend />
      {n.alarm && <div className="small muted" style={{ marginTop: 10 }}>Alarm rang at {clockOf(n.alarm.at)}{n.alarm.early ? `, ${n.alarm.early} min early` : ''}.</div>}
    </div>}
    <div className="sect">
      <span className="sect-t">Your notes</span>
      <div className="card stack" style={{ margin: 0, gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Quality</span><Dots q={n.q} big /></div>
        {n.tags?.length > 0 && <div className="chips" style={{ gap: 6 }}>{n.tags.map(t => <span key={t} className="tag">{t}</span>)}</div>}
        {n.note ? <div>{n.note}</div> : <div className="muted small">No note.</div>}
      </div>
    </div>
    <button className="btn danger" onClick={() => setConfirm(true)}><Icon name="trash" />Delete night</button>
    {confirm && <Confirm title={`Delete ${dayLabel(n.id)}?`} body="The night and its recording summary go from every device." action="Delete"
      onConfirm={() => { deleteNight(n.id); say('Night deleted'); nav('/history', { replace: true }) }} onClosed={() => setConfirm(false)} />}
  </>
}
