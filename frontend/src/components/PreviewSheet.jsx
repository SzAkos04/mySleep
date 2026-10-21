import { useState } from 'react'
import { useStore } from '../store.js'
import { useUI } from '../ui.js'
import { Sheet, SheetHead } from './Sheet.jsx'
import { Icon } from './Icon.jsx'
import * as tracker from '../lib/tracker.js'
import { armBackup } from '../lib/api.js'
import { nextAt, clockOf, nightIdOf } from '../lib/time.js'

export function alarmPlan(settings, from = Date.now()) {
  if (!settings.alarm) return null
  const at = nextAt(settings.wake, from)
  return { at, from: settings.smart ? at - settings.window * 60000 : at }
}

// What tonight will do, before it starts (myGym's session preview).
export function PreviewSheet() {
  const settings = useStore(s => s.settings), setTracking = useStore(s => s.setTracking)
  const closeSheet = useUI(s => s.closeSheet)
  const [tags, setTags] = useState([])
  const [err, setErr] = useState(null)
  const plan = alarmPlan(settings)

  async function go(close) {
    setErr(null)
    try { await tracker.start() }
    catch (e) { setErr(e.name === 'NotAllowedError' ? 'mySleep needs the microphone. Allow it in Settings › Safari › Microphone (or for the app), then try again.' : 'The microphone did not start: ' + e.message); return }
    const start = tracker.samples.start, p = alarmPlan(settings, start)
    setTracking({ start, nightId: nightIdOf(start), tags, ringFrom: p?.from ?? null, ringAt: p?.at ?? null, smart: settings.smart })
    if (p) armBackup(p.at + 60000)
    close()
  }

  return <Sheet label="Before you sleep" onClosed={closeSheet}>{close => <div className="stack">
      <SheetHead title="Before you sleep" sub="Listening until you hold Wake up" close={close} />
      <div className="card stack" style={{ margin: 0, gap: 10 }}>
        <div className="check off"><Icon name="check" /><div>Phone on the charger, face up, next to your pillow</div></div>
        <div className="check off"><Icon name="check" /><div>Volume up: the alarm plays at media volume</div></div>
        <div className="check"><Icon name="check" /><div>The screen stays on, black. Leave mySleep open.</div></div>
        <div className="check"><Icon name="check" /><div>{plan ? (settings.smart ? `Alarm ${clockOf(plan.from)}–${clockOf(plan.at)}, rings when you stir` : `Alarm at ${clockOf(plan.at)}`) : 'No alarm tonight'}</div></div>
      </div>
      <div><span className="sect-t">Today</span>
        <div className="chips">{settings.tags.map(t => <button key={t} className="chip" aria-pressed={tags.includes(t)} onClick={() => setTags(tags.includes(t) ? tags.filter(x => x !== t) : [...tags, t])}>{t}</button>)}</div>
      </div>
      {err && <div className="err">{err}</div>}
      <button className="btn" onClick={() => go(close)}><Icon name="moon" />Start tracking</button>
    </div>}</Sheet>
}
