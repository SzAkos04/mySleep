import { useState } from 'react'
import { useStore } from '../store.js'
import { useUI } from '../ui.js'
import { Sheet, SheetHead } from './Sheet.jsx'
import { atClock, clockOf, dayLabel } from '../lib/time.js'

// Correcting a night's times, when the microphone got them wrong. Nothing else to fill in.
export function ReviewSheet({ night }) {
  const saveNight = useStore(s => s.saveNight)
  const { closeSheet, say } = useUI()
  const [t, setT] = useState({ bed: clockOf(night.bed), on: night.on ? clockOf(night.on) : '', wake: clockOf(night.wake) })
  const set = k => e => setT({ ...t, [k]: e.target.value })

  function save(close) {
    const bed = atClock(night.id, t.bed), wake = atClock(night.id, t.wake), on = t.on ? atClock(night.id, t.on) : null
    const moved = bed !== night.bed || wake !== night.wake || on !== night.on
    // untouched, the analysed minutes stand; once the times change, they are what counts
    const asleepMin = moved ? Math.max(0, Math.round((wake - (on ?? wake)) / 60000 - (night.awakeMin || 0))) : night.asleepMin
    saveNight({ ...(useStore.getState().nights[night.id] || night), bed, on, wake, asleepMin })
    close()
    say('Night saved')
  }

  return <Sheet label="Correct the times" onClosed={closeSheet}>{close => <div className="stack">
    <SheetHead title="Correct the times" sub={dayLabel(night.id)} close={close} />
    <div className="sect-b">
      <div className="row"><span>In bed</span><input type="time" value={t.bed} onChange={set('bed')} /></div>
      <div className="row"><span>Fell asleep</span><input type="time" value={t.on} onChange={set('on')} /></div>
      <div className="row"><span>Woke up</span><input type="time" value={t.wake} onChange={set('wake')} /></div>
    </div>
    <button className="btn" onClick={() => save(close)}>Save</button>
  </div>}</Sheet>
}
