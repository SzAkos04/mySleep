import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store.js'
import { Icon } from '../components/Icon.jsx'
import * as tracker from '../lib/tracker.js'
import { summarize, stirring } from '../lib/analysis.js'
import { armBackup, uploadClips } from '../lib/api.js'
import { clockOf, dur, nextAt, nightIdOf } from '../lib/time.js'

const CHECK_MS = 10000
const LIT_MS = 8000      // how long a tap shows the screen before it goes black again
const HOLD_MS = 1500     // how long to hold before the night ends

export function alarmPlan(settings, from = Date.now()) {
  if (!settings.alarm) return null
  const at = nextAt(settings.wake, from)
  return { at, from: settings.smart ? at - 30 * 60000 : at }   // the smart window: 30 min
}

// From the Start tap (the microphone and the alarm's sound both need it). Throws a message for
// the person when the microphone cannot start.
export async function startNight() {
  try { await tracker.start() }
  catch (e) { throw new Error(e.name === 'NotAllowedError' ? 'mySleep needs the microphone. Allow it in Settings › Safari › Microphone, then try again.' : 'The microphone did not start: ' + e.message) }
  const { settings, setTracking } = useStore.getState(), start = tracker.samples.start, p = alarmPlan(settings, start)
  setTracking({ start, nightId: nightIdOf(start), ringFrom: p?.from ?? null, ringAt: p?.at ?? null, smart: settings.smart })
  if (p) armBackup(p.at + 60000)
}

const rnd = (lo, hi) => Math.round(lo + Math.random() * (hi - lo))

// Ends something only after a press held for HOLD_MS; letting go early does nothing.
// Touch is handled natively with preventDefault: otherwise iOS treats a long press as its own
// gesture and cancels the pointer half-way through the hold.
function Hold({ label, icon, onDone, disabled }) {
  const [holding, setHolding] = useState(false)
  const btn = useRef(null), t = useRef(null), live = useRef({ disabled, onDone })
  live.current = { disabled, onDone }
  const start = () => {
    if (live.current.disabled || t.current) return
    setHolding(true)
    t.current = setTimeout(() => { t.current = null; setHolding(false); live.current.onDone() }, HOLD_MS)
  }
  const stop = () => { clearTimeout(t.current); t.current = null; setHolding(false) }
  useEffect(() => {
    const el = btn.current
    const down = e => { e.preventDefault(); start() }
    el.addEventListener('touchstart', down, { passive: false })
    el.addEventListener('touchend', stop)
    el.addEventListener('touchcancel', stop)
    return () => {
      clearTimeout(t.current)
      el.removeEventListener('touchstart', down)
      el.removeEventListener('touchend', stop)
      el.removeEventListener('touchcancel', stop)
    }
  }, [])
  const mouse = fn => e => e.pointerType === 'mouse' && fn()
  return <div className="hold-wrap">
    <button ref={btn} className={'hold' + (holding ? ' holding' : '')} aria-label={label}
      onPointerDown={mouse(start)} onPointerUp={mouse(stop)} onPointerLeave={mouse(stop)}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && !e.repeat && start()} onKeyUp={stop}
      onContextMenu={e => e.preventDefault()}>
      <svg className="hold-ring" viewBox="0 0 92 92" aria-hidden="true"><circle cx="46" cy="46" r="44" /></svg>
      <Icon name={icon} />
    </button>
    <div className="hold-label">{holding ? 'Keep holding' : label}</div>
  </div>
}

// The night screen, then the alarm. Shown over everything while `tracking` is set.
// Black is the resting state: on the OLED screen black pixels are off, so the phone looks
// switched off. A tap shows the time for a few seconds; ending the night needs a held press.
export function Tracking() {
  const tr = useStore(s => s.tracking), setTracking = useStore(s => s.setTracking), saveNight = useStore(s => s.saveNight)
  const nav = useNavigate()
  const [now, setNow] = useState(Date.now())
  const [live, setLive] = useState(tracker.micLive())
  const [ringing, setRinging] = useState(null)
  const [lit, setLit] = useState(true)
  const [first, setFirst] = useState(true)
  const [shift, setShift] = useState([0, 0])
  const lastCheck = useRef(0), litTimer = useRef(null)
  // a page that was closed in the night comes back here with the saved seconds, not listening
  const [stale, setStale] = useState(() => {
    if (tracker.samples.start) return false
    if (!tracker.loadProgress()) Object.assign(tracker.samples, { start: tr.start, db: [], low: [] })
    return true
  })

  // Light the screen for a while. The clock lands a few pixels off each time, so nothing burns in.
  function light() {
    setLit(true)
    setShift([rnd(-10, 10), rnd(-16, 16)])
    clearTimeout(litTimer.current)
    litTimer.current = setTimeout(() => { setLit(false); setFirst(false) }, LIT_MS)
  }
  useEffect(() => { light(); return () => clearTimeout(litTimer.current) }, [])

  // Black behind the status bar too (the page and theme colour are the app's near-black).
  useEffect(() => {
    const meta = document.querySelector('meta[name=theme-color]'), was = meta?.content
    meta?.setAttribute('content', '#000000')
    document.documentElement.style.background = document.body.style.background = '#000'
    return () => { meta?.setAttribute('content', was); document.documentElement.style.background = document.body.style.background = '' }
  }, [])

  useEffect(() => {
    if (stale || ringing) return
    const t = setInterval(() => {
      const n = Date.now()
      setNow(n)
      setLive(tracker.micLive())
      if (n - lastCheck.current < CHECK_MS) return
      lastCheck.current = n
      if (n % 60000 < CHECK_MS) tracker.saveProgress()
      if (useStore.getState().settings.clips !== false) tracker.collectClips().catch(() => {})
      if (!tr.ringAt) return
      if (n >= tr.ringAt || (tr.smart && n >= tr.ringFrom && stirring(tracker.samples))) wake(n)
    }, 1000)
    return () => clearInterval(t)
  }, [stale, ringing, tr])

  async function wake(n) {
    setRinging({ at: n, early: Math.max(0, Math.round((tr.ringAt - n) / 60000)) })
    await tracker.ring(useStore.getState().settings.alarmSound || 'chime', 60)
  }

  async function snooze() {
    const snoozeMin = 9
    await tracker.snooze()
    setRinging(null)
    setTracking({ ...tr, ringAt: Date.now() + snoozeMin * 60000, smart: false })
    armBackup(Date.now() + (snoozeMin + 1) * 60000)
    light()
  }

  function finish() {
    tracker.stop()
    const end = Date.now(), s = tracker.samples, r = summarize(s, s.start)
    armBackup(null)
    tracker.clearProgress()
    setTracking(null)
    // saved now, so closing the review keeps the night; the review has Discard
    const night = {
      id: tr.nightId, bed: s.start, on: r.on, wake: end,   // on: null when no sleep was found
      wakes: r.wakes, awakeMin: r.awakeMin, asleepMin: r.asleepMin, restfulMin: r.restfulMin,
      snoreMin: r.snoreMin, talks: r.talks, coughs: r.coughs, events: r.events,
      timeline: r.timeline, clips: [],
      ...(ringing && { alarm: { at: ringing.at, early: ringing.early } })
    }
    saveNight(night)
    // the morning is just the night's data; nothing to fill in
    nav('/night/' + night.id, { state: { morning: true } })
    // the recordings go up after; the night gains them when they are on the server
    const list = tracker.clips.splice(0)
    if (list.length) uploadClips(night.id, list).then(done => {
      const cur = useStore.getState().nights[night.id]
      if (done.length && cur && !cur.deleted) saveNight({ ...cur, clips: done })
    })
  }

  async function resume() {
    try { await tracker.start({ resume: true }); setStale(false); setLive(true); light() }
    catch { setLive(false) }
  }

  if (ringing) return <div className="night ring" role="alertdialog" aria-label="Alarm">
    <div className="night-ui">
      <div className="night-status" style={{ color: 'var(--acc)' }}>{tr.smart ? 'Smart alarm' : 'Alarm'}</div>
      <div className="night-mid">
        <div className="night-clock">{clockOf(ringing.at)}</div>
        <div className="ring-title">Good morning</div>
        {ringing.early > 0 && <div className="night-sub">You were moving, so it rang {ringing.early} min early.</div>}
      </div>
      <div className="night-foot">
        <button className="btn" onClick={finish}>Stop</button>
        <button className="btn ghost" onClick={snooze}>Snooze 9 min</button>
      </div>
    </div>
  </div>

  const elapsed = Math.max(0, (now - tracker.samples.start) / 60000)
  const alarm = tr.ringAt ? (tr.smart ? `Alarm ${clockOf(tr.ringFrom)}–${clockOf(tr.ringAt)}, when you stir` : `Alarm ${clockOf(tr.ringAt)}`) : 'No alarm'
  return <div className={'night' + (lit || stale ? '' : ' dark')} onPointerDown={light} onTouchStart={light}>
    <div className="night-ui">
      {stale
        ? <div className="night-status warn"><i />Stopped listening at {clockOf(tracker.samples.start + tracker.samples.db.length * 1000)}</div>
        : live
          ? <div className="night-status"><i />Listening · {elapsed < 60 ? Math.floor(elapsed) + ' min' : dur(elapsed)}</div>
          : <button className="night-status warn" onClick={() => lit && resume()}><i />Microphone stopped · tap to resume</button>}
      <div className="night-mid" style={{ transform: `translate(${shift[0]}px,${shift[1]}px)` }}>
        <div className="night-clock">{clockOf(now)}</div>
        <div className="night-sub">{alarm}</div>
      </div>
      <div className="night-foot">
        {stale && <button className="btn" onClick={resume}>Resume listening</button>}
        <Hold label={stale ? 'Hold to finish the night' : 'Hold to wake up'} icon="sun" onDone={finish} disabled={!lit && !stale} />
        {first && !stale && <div className="night-hint">The screen goes black in a moment, so the phone looks switched off. Tap anywhere to see the time.</div>}
      </div>
    </div>
  </div>
}
