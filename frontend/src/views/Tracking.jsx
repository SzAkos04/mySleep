import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store.js'
import { useUI } from '../ui.js'
import { Icon } from '../components/Icon.jsx'
import * as tracker from '../lib/tracker.js'
import { summarize, stirring } from '../lib/analysis.js'
import { armBackup } from '../lib/api.js'
import { clockOf, dur } from '../lib/time.js'

const CHECK_MS = 10000

// The night screen, then the alarm. Shown over everything while `tracking` is set.
export function Tracking() {
  const tr = useStore(s => s.tracking), setTracking = useStore(s => s.setTracking)
  const openSheet = useUI(s => s.openSheet)
  const [now, setNow] = useState(Date.now())
  const [live, setLive] = useState(tracker.micLive())
  const [ringing, setRinging] = useState(null)
  const lastCheck = useRef(0)
  // a page that was closed in the night comes back here with the saved seconds, not listening
  const [stale, setStale] = useState(() => {
    if (tracker.samples.start) return false
    if (!tracker.loadProgress()) Object.assign(tracker.samples, { start: tr.start, db: [], low: [] })
    return true
  })

  useEffect(() => {
    if (stale || ringing) return
    const t = setInterval(() => {
      const n = Date.now()
      setNow(n)
      setLive(tracker.micLive())
      if (n - lastCheck.current < CHECK_MS) return
      lastCheck.current = n
      if (n % 60000 < CHECK_MS) tracker.saveProgress()
      if (!tr.ringAt) return
      const s = tracker.samples
      if (n >= tr.ringAt || (tr.smart && n >= tr.ringFrom && stirring(s.db, s.low))) wake(n)
    }, 1000)
    return () => clearInterval(t)
  }, [stale, ringing, tr])

  async function wake(n) {
    setRinging({ at: n, early: Math.max(0, Math.round((tr.ringAt - n) / 60000)) })
    await tracker.ring()
  }

  async function snooze() {
    const snoozeMin = useStore.getState().settings.snooze
    await tracker.snooze()
    setRinging(null)
    setTracking({ ...tr, ringAt: Date.now() + snoozeMin * 60000, smart: false })
    armBackup(Date.now() + (snoozeMin + 1) * 60000)
  }

  function finish() {
    tracker.stop()
    const end = Date.now(), s = tracker.samples, r = summarize(s.db, s.low, s.start)
    armBackup(null)
    tracker.clearProgress()
    setTracking(null)
    openSheet({ type: 'review', night: {
      id: tr.nightId, bed: s.start, on: r.on ?? s.start, wake: end,
      wakes: r.wakes, awakeMin: r.awakeMin, asleepMin: r.asleepMin, snoreMin: r.snoreMin,
      tags: tr.tags, timeline: r.timeline,
      ...(ringing && { alarm: { at: ringing.at, early: ringing.early } })
    } })
  }

  async function resume() {
    try { await tracker.start({ resume: true }); setStale(false); setLive(true) }
    catch { setLive(false) }
  }

  if (ringing) return <div className="ring" role="alertdialog" aria-label="Alarm">
    <div>
      <div className="eyebrow" style={{ color: 'var(--acc)' }}>{tr.smart ? 'Smart alarm' : 'Alarm'}</div>
      <div className="clock num">{clockOf(ringing.at)}</div>
      <div style={{ fontSize: 20, fontWeight: 600 }}>Good morning</div>
      {ringing.early > 0 && <div className="muted" style={{ marginTop: 6 }}>You were moving, so it rang {ringing.early} min early.</div>}
    </div>
    <div className="stack" style={{ width: 'min(340px,100%)' }}>
      <button className="btn" onClick={finish}>Stop</button>
      <button className="btn ghost" onClick={snooze}>Snooze {useStore.getState().settings.snooze} min</button>
    </div>
  </div>

  const elapsed = Math.max(0, Math.floor((now - tracker.samples.start) / 1000))
  return <div className="night">
    <div>
      {stale
        ? <div className="pill warn"><Icon name="mic" />Stopped listening at {clockOf(tracker.samples.start + tracker.samples.db.length * 1000)}</div>
        : live
          ? <div className="pill"><Icon name="mic" />Listening · {dur(elapsed / 60)}</div>
          : <button className="pill warn" onClick={resume}><Icon name="mic" />Microphone stopped · tap to resume</button>}
    </div>
    <div>
      <div className="clock">{clockOf(now)}</div>
      <div>{tr.ringAt ? (tr.smart ? `Alarm ${clockOf(tr.ringFrom)}–${clockOf(tr.ringAt)} · when you stir` : `Alarm ${clockOf(tr.ringAt)}`) : 'No alarm'}</div>
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, width: '100%' }}>
      {stale && <button className="wake" onClick={resume} style={{ color: 'var(--acc)' }}>Resume listening</button>}
      <button className="wake" onClick={finish}>{stale ? 'Finish the night' : 'Wake up'}</button>
      {!stale && <div className="hint">Keep this screen open. iPhone stops the microphone when a web app is locked or in the background.</div>}
    </div>
  </div>
}
