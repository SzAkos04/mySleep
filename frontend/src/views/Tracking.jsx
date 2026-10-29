import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store.js'
import { Icon } from '../components/Icon.jsx'
import * as tracker from '../lib/tracker.js'
import { stirring, events } from '../lib/analysis.js'
import { alarmPlan, shouldRing, snoozePlan, heardLabel, windowLabel, stoppedAt, nightRecord, micErrorMessage, SNOOZE_MIN } from '../lib/night.js'
import { armBackup, uploadClips } from '../lib/api.js'
import { diag, diagStart, diagResume, diagUpload, diagSummary } from '../lib/diag.js'
import { clockOf, dur, nightIdOf } from '../lib/time.js'

const CHECK_MS = 10000
const LIT_MS = 30000     // how long the screen stays lit before only a dim clock is left
const HOLD_MS = 1500     // how long to hold before the night ends

// From the Start tap (the microphone and the alarm's sound both need it). Throws a message for
// the person when the microphone cannot start.
export async function startNight() {
  const { settings: st } = useStore.getState()
  // synchronous, so the Sleep tap's gesture still reaches the wake lock and video inside start()
  diagStart(nightIdOf(Date.now()), { settings: { wake: st.wake, bedtime: st.bedtime, alarm: st.alarm, smart: st.smart, clips: st.clips } })
  try { await tracker.start() }
  catch (e) { diag('start-failed', { name: e?.name, message: e?.message }); diagUpload(null, true); throw new Error(micErrorMessage(e)) }
  const { settings, setTracking } = useStore.getState(), start = tracker.samples.start, p = alarmPlan(settings, start)
  setTracking({ start, nightId: nightIdOf(start), ringFrom: p?.from ?? null, ringAt: p?.at ?? null, smart: settings.smart })
  if (p) armBackup(p.at + 60000)
  diag('night', { ringFrom: p?.from ?? null, ringAt: p?.at ?? null, awake: tracker.awake })
}

const rnd = (lo, hi) => Math.round(lo + Math.random() * (hi - lo))

// The last second's loudness, 20–90 on the tracker's dB scale (a quiet bedroom is around 40–50).
function Meter({ db }) {
  const pct = db == null ? 0 : Math.max(0, Math.min(100, Math.round((db - 20) / 70 * 100)))
  return <div className="meter" role="meter" aria-label="Sound level" aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct}><i style={{ width: pct + '%' }} /></div>
}

// Ends something only after a press held for HOLD_MS; letting go early does nothing.
// Touch is handled natively with preventDefault: otherwise iOS treats a long press as its own
// gesture and cancels the pointer half-way through the hold.
function Hold({ label, icon, text, onDone, disabled, light }) {
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
    <button ref={btn} className={'hold' + (light ? ' light' : '') + (holding ? ' holding' : '')} aria-label={label}
      onPointerDown={mouse(start)} onPointerUp={mouse(stop)} onPointerLeave={mouse(stop)}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && !e.repeat && start()} onKeyUp={stop}
      onContextMenu={e => e.preventDefault()}>
      <svg className="hold-ring" viewBox="0 0 92 92" aria-hidden="true"><circle cx="46" cy="46" r="44" /></svg>
      {text ? <span className="hold-text">{text}</span> : <Icon name={icon} />}
    </button>
    <div className="hold-label">{holding ? 'Keep holding' : label}</div>
  </div>
}

// The night screen, then the alarm. Shown over everything while `tracking` is set.
// Lit for 30 s, then black with only a dim clock: on the OLED screen black pixels are off, so the
// phone is dark apart from those digits, which drift a few pixels each minute against burn-in.
// A tap lights it again; ending the night needs a held press.
export function Tracking() {
  const tr = useStore(s => s.tracking), setTracking = useStore(s => s.setTracking), saveNight = useStore(s => s.saveNight)
  const nav = useNavigate()
  const [now, setNow] = useState(Date.now())
  const [live, setLive] = useState(tracker.hearing())   // sound is arriving
  const [micOn, setMicOn] = useState(tracker.micLive())  // iOS says the microphone is on
  const [level, setLevel] = useState(null)
  const [ringing, setRinging] = useState(null)
  const [lit, setLit] = useState(true)
  const [first, setFirst] = useState(true)
  const [shift, setShift] = useState([0, 0])
  const [heard, setHeard] = useState('Quiet so far')
  const [awake, setAwake] = useState(tracker.awake)   // is anything keeping the screen on
  const [toneOnly, setToneOnly] = useState(null)   // why the piano is not playing, if it is not
  const lastCheck = useRef(0), litTimer = useRef(null)
  // a page that was closed in the night comes back here with the saved seconds, not listening
  const [stale, setStale] = useState(() => {
    if (tracker.samples.start) return false
    diagResume(tr.nightId)
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
      setLive(tracker.hearing())
      setMicOn(tracker.micLive())
      setLevel(tracker.level())
      setAwake(tracker.awake)
      if (n - lastCheck.current < CHECK_MS) return
      lastCheck.current = n
      if (n % 60000 < CHECK_MS) {
        tracker.saveProgress()
        tracker.heartbeat()
        diagUpload()   // at most every 5 min; a log on the server even if the page dies
        setShift([rnd(-12, 12), rnd(-24, 24)])
        setHeard(heardLabel(events(tracker.samples, tracker.samples.start)))
      }
      if (useStore.getState().settings.clips !== false) tracker.collectClips().catch(() => {})
      if (shouldRing(n, tr, () => stirring(tracker.samples))) wake(n)
    }, 1000)
    return () => clearInterval(t)
  }, [stale, ringing, tr])

  // the lock screen's Now Playing card says what is running
  useEffect(() => {
    if (stale || ringing) return
    tracker.nowPlaying('mySleep is listening', tr.ringAt ? 'Alarm ' + windowLabel(tr, '–') : 'No alarm')
  }, [stale, ringing, tr])

  async function wake(n) {
    diag('wake', { at: n, ringAt: tr.ringAt, smart: tr.smart, early: tr.ringAt - n })
    setRinging({ at: n, early: Math.max(0, Math.round((tr.ringAt - n) / 60000)) })
    await tracker.ring()
    tracker.nowPlaying('Alarm', 'Hold Stop in mySleep to turn it off')
    setToneOnly(tracker.ringingTone() ? (tracker.alarmProblem || 'the recording did not load') : null)
  }

  async function snooze() {
    diag('snooze')
    await tracker.snooze()
    setRinging(null)
    const p = snoozePlan(tr, Date.now())
    setTracking(p.tracking)
    armBackup(p.backupAt)
    light()
  }

  function finish() {
    diag('finish', { ringing: !!ringing, stale })
    tracker.stop()
    const s = tracker.samples
    armBackup(null)
    tracker.clearProgress()
    setTracking(null)
    // saved now, so closing the review keeps the night; the review has Discard
    const night = nightRecord({ tr, samples: s, end: Date.now(), ringing, diag: diagSummary() })
    saveNight(night)
    diag('summary', { asleepMin: night.asleepMin, on: night.on, wakes: night.wakes, missingSec: s.db.filter(v => !Number.isFinite(v)).length, sec: s.db.length })
    diagUpload(s, true)
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
    diag('resume-tap')
    try { await tracker.start({ resume: true }); setStale(false); setLive(true); light() }
    catch { setLive(false) }
  }

  if (ringing) return <div className="night alarm" role="alertdialog" aria-label="Alarm">
    <div className="night-ui">
      <div className="pill">{tr.smart ? 'Smart alarm' : 'Alarm'}{toneOnly ? ' · backup tone' : ''}</div>
      <div>
        <div className="night-clock num">{clockOf(ringing.at)}</div>
        <div className="gm">Good morning</div>
        {ringing.early > 0 && <div className="night-sub">You were stirring, so it rang {ringing.early} min early</div>}
        {toneOnly && <div className="night-sub" style={{ fontSize: 12 }}>Piano not loaded: {toneOnly}</div>}
      </div>
      <div className="night-foot">
        {/* held like ending the night, so a sleepy tap cannot silence it */}
        <Hold light text="Stop" label="Hold to stop" onDone={finish} />
        <button className="snooze" onClick={snooze}>Snooze {SNOOZE_MIN} min</button>
      </div>
    </div>
  </div>

  const elapsed = Math.max(0, (now - tracker.samples.start) / 60000)
  const win = windowLabel(tr)
  const left = tr.ringAt ? (tr.ringAt - now) / 60000 : null
  return <div className={'night' + (lit || stale ? '' : ' dark')} onPointerDown={light} onTouchStart={light}>
    <div className="glow" />
    <div className="night-ui">
      {stale
        ? <div className="pill warn"><i />Stopped listening at {clockOf(stoppedAt(tracker.samples))}</div>
        : live
          ? <div className="pill"><i />Listening · {elapsed < 1 ? 'just started' : dur(elapsed)}</div>
          : <button className="pill warn" onClick={() => lit && resume()}><i />{micOn ? 'Not hearing anything · tap to restart' : 'Microphone stopped · tap to resume'}</button>}
      <div>
        <div className="night-clock num">{clockOf(now)}</div>
        <div className="night-line">{win ? `Alarm ${win}` : 'No alarm'}</div>
        {left > 0 && <div className="night-sub">Up to {dur(left)} of sleep</div>}
        {!stale && <div className="night-tags"><span>{heard}</span></div>}
        {/* lit only: what the microphone hears, so a deaf night shows in seconds, not in the morning */}
        {!stale && lit && <Meter db={level} />}
        {!stale && awake === 'none' && <div className="night-warn">The screen may lock, and the microphone stops when it does. Set Settings › Display &amp; Brightness › Auto-Lock to Never for the night, and turn off Low Power Mode.</div>}
      </div>
      <div className="night-foot">
        {stale && <button className="btn" onClick={resume}>Resume listening</button>}
        <Hold label={stale ? 'Hold to finish the night' : 'Hold to wake up'} icon="sun" onDone={finish} disabled={!lit && !stale} />
        {!stale && <div className="night-hint">{first ? 'Dims in 30 s · tap anywhere to light it up' : 'Tap anywhere to light it up'}</div>}
      </div>
    </div>
    {/* all night: only these pixels light on the OLED screen */}
    <div className="dimface" style={{ transform: `translate(${shift[0]}px,${shift[1]}px)` }} aria-hidden={lit}>
      <div className="dim-clock num">{clockOf(now)}</div>
      {win && <div className="dim-line num">{win}</div>}
    </div>
  </div>
}
