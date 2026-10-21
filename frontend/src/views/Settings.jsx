import { useState } from 'react'
import { useStore } from '../store.js'
import { api, enablePush } from '../lib/api.js'
import { SOUNDS } from '../lib/sounds.js'
import { previewSound } from '../lib/tracker.js'
import { Icon } from '../components/Icon.jsx'

const Switch = ({ on, set, label }) => <button className="switch" role="switch" aria-checked={!!on} aria-label={label} onClick={() => set(!on)} />
const Num = ({ v, set, min, max, label }) => <input type="number" inputMode="numeric" min={min} max={max} value={v} aria-label={label}
  onChange={e => { const n = Math.round(+e.target.value); if (n >= min && n <= max) set(n) }} />

export function Settings() {
  const { settings: s, saveSettings: save, user, signOut } = useStore()
  const [tag, setTag] = useState('')
  const [pushMsg, setPushMsg] = useState(null)

  async function notifications() {
    setPushMsg(null)
    try { await enablePush(); await api('/api/push/test', {}); setPushMsg('On. A test notification is on its way.') }
    catch (e) { setPushMsg(e.message) }
  }
  async function logout() {
    await api('/api/logout', {}).catch(() => {})
    signOut()
  }

  return <>
    <header className="hdr"><div><h1>Settings</h1></div></header>

    <div className="sect"><span className="sect-t">Schedule</span><div className="sect-b">
      <div className="row"><span>Go to bed</span><input type="time" value={s.bedtime} onChange={e => e.target.value && save({ bedtime: e.target.value })} /></div>
      <div className="row"><span>Wake up</span><input type="time" value={s.wake} onChange={e => e.target.value && save({ wake: e.target.value })} /></div>
      <div className="row"><span>Sleep need<div className="s">Minutes a night</div></span><Num v={s.need} min={180} max={720} set={need => save({ need })} label="Sleep need in minutes" /></div>
    </div></div>

    <div className="sect"><span className="sect-t">Alarm</span><div className="sect-b">
      <div className="row"><span>Alarm</span><Switch on={s.alarm} set={alarm => save({ alarm })} label="Alarm" /></div>
      {s.alarm && <>
        <div className="row"><span>Smart alarm<div className="s">Rings at the first stir in the window</div></span><Switch on={s.smart} set={smart => save({ smart })} label="Smart alarm" /></div>
        {s.smart && <div className="row"><span>Window<div className="s">Minutes before {s.wake}</div></span><Num v={s.window} min={5} max={90} set={window => save({ window })} label="Window in minutes" /></div>}
        <div className="row"><span>Snooze<div className="s">Minutes</div></span><Num v={s.snooze} min={1} max={30} set={snooze => save({ snooze })} label="Snooze in minutes" /></div>
        <div className="row"><span>Gets louder over</span>
          <div className="seg" style={{ width: 170 }}>{[[30, '30 s'], [60, '1 min'], [120, '2 min']].map(([v, l]) => <button key={v} aria-pressed={(s.rise || 60) === v} onClick={() => save({ rise: v })}>{l}</button>)}</div>
        </div>
      </>}
    </div></div>
    {s.alarm && <div className="sect"><span className="sect-t">Alarm sound · tap to hear it</span><div className="sect-b">
      {SOUNDS.map(o => <button key={o.id} className="row" onClick={() => { save({ alarmSound: o.id }); previewSound(o.id) }}>
        <span>{o.name}</span>
        {(s.alarmSound || 'chime') === o.id && <Icon name="check" style={{ width: 20, height: 20, color: 'var(--acc)' }} />}
      </button>)}
    </div>
    <span className="sect-f">If mySleep stops listening in the night, a notification comes a minute after the window ends.</span></div>}

    <div className="sect"><span className="sect-t">Reminders</span><div className="sect-b">
      <div className="row"><span>Bedtime reminder</span><Switch on={s.remind} set={remind => save({ remind })} label="Bedtime reminder" /></div>
      {s.remind && <div className="row"><span>Minutes before {s.bedtime}</span><Num v={s.remindMin} min={5} max={120} set={remindMin => save({ remindMin })} label="Reminder minutes before bedtime" /></div>}
      <button className="row" onClick={notifications}><span style={{ color: 'var(--acc)' }}>Turn on notifications on this phone</span></button>
    </div>
    {pushMsg && <span className="sect-f">{pushMsg}</span>}</div>

    <div className="sect"><span className="sect-t">Sounds of the night</span><div className="sect-b">
      <div className="row"><span>Keep recordings<div className="s">A few seconds of talking, coughing and snoring, up to 12 a night, kept 7 days on your server</div></span><Switch on={s.clips !== false} set={clips => save({ clips })} label="Keep recordings" /></div>
    </div></div>

    <div className="sect"><span className="sect-t">Tags</span><div className="sect-b">
      <div className="row"><div className="chips">{s.tags.map(t => <button key={t} className="chip" aria-label={'Remove ' + t} onClick={() => save({ tags: s.tags.filter(x => x !== t) })}>{t} ×</button>)}</div></div>
      <form className="row" onSubmit={e => { e.preventDefault(); const t = tag.trim(); if (t && !s.tags.includes(t)) save({ tags: [...s.tags, t] }); setTag('') }}>
        <input value={tag} onChange={e => setTag(e.target.value)} placeholder="New tag" aria-label="New tag" maxLength={30} style={{ flex: 1, background: 'none', border: 0, fontSize: 15 }} />
        <button className="link" type="submit">Add</button>
      </form>
    </div></div>

    <div className="sect"><span className="sect-t">Account</span><div className="sect-b">
      <div className="row"><span>Signed in as</span><span className="muted">{user?.name}</span></div>
      <button className="row" onClick={logout}><span style={{ color: 'var(--red)' }}>Sign out</span></button>
      <div className="row"><span>Build</span><span className="muted num">v{__APP_VERSION__}</span></div>
    </div>
    <span className="sect-f">The night is analysed on the phone. Your server gets the summary, the timeline and, if you keep them, the short recordings; nothing goes anywhere else.</span></div>
  </>
}
