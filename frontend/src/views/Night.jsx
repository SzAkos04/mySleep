import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store.js'
import { useUI } from '../ui.js'
import { Icon } from '../components/Icon.jsx'
import { Timeline, TimelineLegend } from '../components/Charts.jsx'
import { NightReport, Insights } from '../components/Report.jsx'
import { Confirm } from '../components/Sheet.jsx'
import { sleepScore } from '../lib/score.js'
import { clockOf, dayLabel, dur } from '../lib/time.js'

const KIND = { snore: 'Snoring', talk: 'Talking', cough: 'Coughing', noise: 'Room noise' }
const fmtSec = s => s < 60 ? `${s} s` : `${Math.round(s / 60)} min`

// Plays one clip of the night. Fetched as a blob: Safari's <audio> wants range requests otherwise.
function Clip({ night, clip }) {
  const [state, setState] = useState('idle')   // idle | loading | playing | error
  const audio = useRef(null)
  useEffect(() => () => { audio.current?.pause(); if (audio.current) URL.revokeObjectURL(audio.current.src) }, [])
  async function toggle() {
    if (state === 'playing') { audio.current.pause(); audio.current.currentTime = 0; return setState('idle') }
    try {
      if (!audio.current) {
        setState('loading')
        const r = await fetch(`/api/clips/${night}/${clip.id}`)
        if (!r.ok) throw new Error()
        audio.current = new Audio(URL.createObjectURL(await r.blob()))
        audio.current.onended = () => setState('idle')
      }
      await audio.current.play()
      setState('playing')
    } catch { setState('error') }
  }
  return <button className="iconbtn sm" onClick={toggle} aria-label={state === 'playing' ? 'Stop' : 'Play the recording'} disabled={state === 'error'}>
    <Icon name={state === 'playing' ? 'stop' : 'play'} />
  </button>
}

export function Night() {
  const { id } = useParams(), nav = useNavigate(), morning = useLocation().state?.morning
  const n = useStore(s => s.nights[id]), settings = useStore(s => s.settings), deleteNight = useStore(s => s.deleteNight)
  const { openSheet, say } = useUI()
  const [confirm, setConfirm] = useState(false)
  const [parts, setParts] = useState(false)
  const back = <div className="back"><button className="iconbtn" onClick={() => morning ? nav('/', { replace: true }) : nav(-1)} aria-label="Back"><Icon name="back" /></button></div>
  if (!n || n.deleted) return <>{back}<div className="empty">This night is gone.</div></>

  const inBed = (n.wake - n.bed) / 60000, s = sleepScore(n, settings)
  const evs = (n.events || []).filter(e => KIND[e.kind])
  const clipOf = e => (n.clips || []).find(c => c.kind === e.kind && Math.abs(c.t - e.t) < 60000)
  return <>
    {back}
    <header className="hdr">
      <div><h1>{morning ? 'Good morning' : dayLabel(n.id)}</h1><div className="sub num">{morning ? dayLabel(n.id) + ' · ' : 'In bed '}{clockOf(n.bed)} – {clockOf(n.wake)} · {dur(inBed)}</div></div>
      <button className="iconbtn" onClick={() => openSheet({ type: 'review', night: n })} aria-label="Correct the times"><Icon name="edit" /></button>
    </header>

    <NightReport n={n} />
    <button className="link score-how" onClick={() => setParts(!parts)} aria-expanded={parts}>{parts ? 'Hide' : 'How'} the score adds up</button>
    {parts && <div className="sect"><div className="sect-b">
      {s.parts.map(p => <div key={p.label} className="row"><div className="t">{p.label}<div className="s">{p.note}</div></div><div className="r">{p.pts}/{p.max}</div></div>)}
    </div></div>}
    <Insights n={n} />

    {n.timeline && <div className="card">
      <div className="eyebrow" style={{ marginBottom: 12 }}>What the microphone heard</div>
      <Timeline t={n.timeline} full />
      <TimelineLegend />
      <div className="small muted" style={{ marginTop: 10 }}>Light and restful are a rough estimate from how still and quiet you were, not measured sleep stages.{n.alarm ? ` The alarm rang at ${clockOf(n.alarm.at)}${n.alarm.early ? `, ${n.alarm.early} min early` : ''}.` : ''}</div>
    </div>}

    {evs.length > 0 && <div className="sect">
      <span className="sect-t">Sounds · recordings kept 7 days</span>
      <div className="sect-b">{evs.map(e => {
        const c = clipOf(e)
        return <div key={e.t + e.kind} className="row">
          {c ? <Clip night={n.id} clip={c} /> : <span className="iconbtn sm" aria-hidden="true" style={{ opacity: .35 }}><Icon name="wave" /></span>}
          <div className="t">{KIND[e.kind]}<div className="s num">{clockOf(e.t)}{c ? '' : ' · not recorded'}</div></div>
          <div className="r">{fmtSec(e.sec)}</div>
        </div>
      })}</div>
    </div>}

    {n.diag && <div className="sect">
      <span className="sect-t">Diagnostics · full log on your server</span>
      <div className="sect-b">
        {[
          ['Screen kept on', n.diag.lockOk || n.diag.videoOk ? `${n.diag.lockOk ? 'wake lock' : ''}${n.diag.lockOk && n.diag.videoOk ? ' + ' : ''}${n.diag.videoOk ? 'video' : ''}` : 'no', !(n.diag.lockOk || n.diag.videoOk)],
          ['Wake lock released', n.diag.lockReleased, n.diag.lockReleased > 0],
          ['Microphone lost', n.diag.micLost, n.diag.micLost > 0],
          ['App hidden / locked', n.diag.hidden, n.diag.hidden > 0],
          ['App stalled', n.diag.stalls, n.diag.stalls > 0],
          ['Reloaded in the night', n.diag.reloads, n.diag.reloads > 0],
          ['Errors', n.diag.errors, n.diag.errors > 0]
        ].map(([l, v, bad]) => <div key={l} className="row"><span>{l}</span><span className="r" style={bad ? { color: 'var(--awake)' } : null}>{String(v)}</span></div>)}
      </div>
    </div>}

    <button className="btn danger" onClick={() => setConfirm(true)}><Icon name="trash" />{morning ? 'Discard this night' : 'Delete night'}</button>
    {confirm && <Confirm title={`Delete ${dayLabel(n.id)}?`} body="The night, its recordings and its summary go from every device." action="Delete"
      onConfirm={() => { deleteNight(n.id); say('Night deleted'); nav('/journal', { replace: true }) }} onClosed={() => setConfirm(false)} />}
  </>
}
