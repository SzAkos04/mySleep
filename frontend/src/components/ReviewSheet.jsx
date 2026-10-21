import { useState } from 'react'
import { useStore } from '../store.js'
import { useUI } from '../ui.js'
import { Sheet, SheetHead, Confirm } from './Sheet.jsx'
import { Timeline } from './Charts.jsx'
import { Icon } from './Icon.jsx'
import { atClock, clockOf, dayLabel, nightIdOf } from '../lib/time.js'

// The morning form, a night typed in by hand, or an edit of a saved night.
// A tracked night is already saved when this opens (Tracking.jsx), so swiping it away keeps it;
// "Discard night" is how it goes. A night typed in by hand exists only once Save is tapped.
export function ReviewSheet({ night, fresh }) {
  const settings = useStore(s => s.settings), saveNight = useStore(s => s.saveNight), deleteNight = useStore(s => s.deleteNight)
  const { closeSheet, say } = useUI()
  const manual = !night.timeline, isNew = !night.ts
  const [id, setId] = useState(night.id || nightIdOf(Date.now()))
  const [t, setT] = useState({
    bed: clockOf(night.bed ?? atClock(id, settings.bedtime)),
    on: clockOf(night.on ?? night.bed ?? atClock(id, settings.bedtime)),
    wake: clockOf(night.wake ?? atClock(id, settings.wake))
  })
  const [edited, setEdited] = useState(manual)
  const [wakes, setWakes] = useState(night.wakes ?? 0)
  const [q, setQ] = useState(night.q ?? null)
  const [tags, setTags] = useState(night.tags || [])
  const [note, setNote] = useState(night.note || '')
  const [confirm, setConfirm] = useState(false)
  const time = k => e => { setT({ ...t, [k]: e.target.value }); setEdited(true) }

  function save(close) {
    const bed = atClock(id, t.bed), on = atClock(id, t.on), wake = atClock(id, t.wake)
    const awakeMin = manual ? 0 : night.awakeMin || 0
    // untouched, the analysed minutes stand; once the times change, they are what counts
    const asleepMin = !edited && night.asleepMin != null ? night.asleepMin : Math.max(0, Math.round((wake - on) / 60000 - awakeMin))
    saveNight({ ...night, id, bed, on, wake, wakes, awakeMin, asleepMin, q, tags, note: note.trim() })
    close()
    say('Night saved')
  }

  const title = fresh ? 'Good morning' : isNew ? 'Log a night' : 'Edit night'
  const sub = night.timeline ? `Night of ${dayLabel(id)} · filled in from sound` : isNew ? 'No recording · type it in' : dayLabel(id)
  return <Sheet label={title} onClosed={closeSheet}>{close => <div className="stack">
    <SheetHead title={title} sub={sub} close={close} />
    {night.timeline && <Timeline t={night.timeline} />}
    <div className="sect-b">
      {isNew && <div className="row"><span>Night of</span><input type="date" value={id} max={nightIdOf(Date.now())} onChange={e => e.target.value && setId(e.target.value)} className="num" style={{ color: 'var(--acc)', background: 'var(--surface-2)', border: 0, borderRadius: 8, padding: '5px 8px' }} /></div>}
      <div className="row"><span>In bed</span><input type="time" value={t.bed} onChange={time('bed')} /></div>
      <div className="row"><span>Fell asleep{!manual && <span className="est">estimated</span>}</span><input type="time" value={t.on} onChange={time('on')} /></div>
      <div className="row"><span>Woke up</span><input type="time" value={t.wake} onChange={time('wake')} /></div>
      <div className="row"><span>Times awake{!manual && <span className="est">estimated</span>}</span>
        <div className="stepper"><button onClick={() => setWakes(Math.max(0, wakes - 1))} aria-label="One fewer">−</button><b className="num">{wakes}</b><button onClick={() => setWakes(wakes + 1)} aria-label="One more">+</button></div>
      </div>
      {night.snoreMin != null && <div className="row"><span>Snoring</span><span className="muted num">{night.snoreMin} min</span></div>}
    </div>
    <div><span className="sect-t">How did you sleep?</span>
      <div className="seg q">{[1, 2, 3, 4, 5].map(i => <button key={i} aria-pressed={q === i} onClick={() => setQ(i)}>{i}</button>)}</div>
    </div>
    <div><span className="sect-t">Tags</span>
      <div className="chips">{settings.tags.map(tag => <button key={tag} className="chip" aria-pressed={tags.includes(tag)} onClick={() => setTags(tags.includes(tag) ? tags.filter(x => x !== tag) : [...tags, tag])}>{tag}</button>)}</div>
    </div>
    <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" />
    <button className="btn" onClick={() => save(close)}>Save night</button>
    {!isNew && <button className="btn danger" onClick={() => setConfirm(true)}><Icon name="trash" />{fresh ? 'Discard night' : 'Delete night'}</button>}
    {confirm && <Confirm title={`${fresh ? 'Discard' : 'Delete'} ${dayLabel(id)}?`} body="The night and its recording summary go from every device." action={fresh ? 'Discard' : 'Delete'}
      onConfirm={() => { deleteNight(night.id); say(fresh ? 'Night discarded' : 'Night deleted'); close() }} onClosed={() => setConfirm(false)} />}
  </div>}</Sheet>
}
