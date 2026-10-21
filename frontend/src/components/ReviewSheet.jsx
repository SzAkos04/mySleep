import { useState } from 'react'
import { useStore } from '../store.js'
import { useUI } from '../ui.js'
import { Sheet } from './Sheet.jsx'
import { Timeline } from './Charts.jsx'
import { atClock, clockOf, dayLabel, nightIdOf } from '../lib/time.js'

// The morning form: what the microphone filled in, to correct, plus quality, tags and a note.
// Also the form for a night typed in by hand, and for editing a saved night.
export function ReviewSheet({ night, open }) {
  const settings = useStore(s => s.settings), saveNight = useStore(s => s.saveNight)
  const { closeSheet, say } = useUI()
  const manual = !night.timeline
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
  const time = k => e => { setT({ ...t, [k]: e.target.value }); setEdited(true) }

  function save() {
    const bed = atClock(id, t.bed), on = atClock(id, t.on), wake = atClock(id, t.wake)
    const awakeMin = edited && manual ? 0 : night.awakeMin || 0
    // untouched, the analysed minutes stand; once the times change, they are what counts
    const asleepMin = !edited && night.asleepMin != null ? night.asleepMin : Math.max(0, Math.round((wake - on) / 60000 - awakeMin))
    saveNight({ ...night, id, bed, on, wake, wakes, awakeMin, asleepMin, q, tags, note: note.trim() })
    closeSheet()
    say('Night saved')
  }

  return <Sheet open={open} onClose={closeSheet} label="Review the night">
    <div className="stack">
      <div>
        <h2>{night.timeline && !night.ts ? 'Good morning' : manual && !night.ts ? 'Log a night' : 'Edit night'}</h2>
        <div className="muted">{night.timeline ? `Night of ${dayLabel(id)} · filled in from sound` : 'No recording · type it in'}</div>
      </div>
      {night.timeline && <Timeline t={night.timeline} />}
      <div className="sect-b">
        {manual && !night.ts && <div className="row"><span>Night of</span><input type="date" value={id} max={nightIdOf(Date.now())} onChange={e => e.target.value && setId(e.target.value)} className="num" style={{ color: 'var(--acc)', background: 'var(--surface-2)', border: 0, borderRadius: 8, padding: '5px 8px' }} /></div>}
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
      <button className="btn" onClick={save}>Save night</button>
    </div>
  </Sheet>
}
