import { useState } from 'react'
import { useStore } from '../store.js'
import { api, enablePush } from '../lib/api.js'
import { Icon } from '../components/Icon.jsx'

// iOS Settings rows, as myGym has them: a tinted icon tile, the title, a value or a control.
const Row = ({ icon, tint, title, sub, children, onClick, danger }) => {
  const Tag = onClick ? 'button' : 'div'
  return <Tag className={'srow' + (onClick ? ' tap' : '') + (danger ? ' danger' : '')} onClick={onClick}>
    {icon && <span className="srow-i" style={{ background: tint }}><Icon name={icon} /></span>}
    <span className="srow-m"><span className="srow-t">{title}</span>{sub && <span className="srow-s">{sub}</span>}</span>
    {children}
  </Tag>
}
const Section = ({ title, footer, children }) => <section className="sect">
  {title && <h2 className="sect-t">{title}</h2>}
  <div className="sect-b">{children}</div>
  {footer && <p className="sect-f">{footer}</p>}
</section>
const Switch = ({ on, set, label }) => <button className="switch" role="switch" aria-checked={!!on} aria-label={label} onClick={() => set(!on)} />
const Time = ({ v, set, label }) => <input type="time" value={v} aria-label={label} onChange={e => e.target.value && set(e.target.value)} />

export function Settings() {
  const { settings: s, saveSettings: save, user, signOut } = useStore()
  const [push, setPush] = useState(() => typeof Notification !== 'undefined' && Notification.permission === 'granted' ? 'on' : null)

  async function notifications() {
    try { await enablePush(); await api('/api/push/test', {}); setPush('on') }
    catch (e) { setPush(e.message) }
  }
  async function logout() {
    await api('/api/logout', {}).catch(() => {})
    signOut()
  }

  return <>
    <header className="hdr"><div><h1>Settings</h1></div></header>

    <Section title="Alarm" footer={s.alarm ? 'A soft piano that starts almost silent and is fully up in 20 seconds and very loud within a minute. Turn the phone\u2019s volume up: it plays at media volume.' : null}>
      <Row icon="alarm" tint="var(--awake)" title="Alarm"><Switch on={s.alarm} set={alarm => save({ alarm })} label="Alarm" /></Row>
      {s.alarm && <>
        <Row icon="sun" tint="var(--awake)" title="Wake up"><Time v={s.wake} set={wake => save({ wake })} label="Wake-up time" /></Row>
        <Row icon="sparkle" tint="var(--acc)" title="Smart alarm" sub="Up to 30 min earlier, when you stir"><Switch on={s.smart} set={smart => save({ smart })} label="Smart alarm" /></Row>
      </>}
    </Section>

    <Section title="Bedtime" footer={push && push !== 'on' ? push : null}>
      <Row icon="moon" tint="var(--acc)" title="Go to bed"><Time v={s.bedtime} set={bedtime => save({ bedtime })} label="Bedtime" /></Row>
      <Row icon="bell" tint="var(--red)" title="Reminder" sub="30 min before"><Switch on={s.remind} set={remind => save({ remind })} label="Bedtime reminder" /></Row>
      {push !== 'on' && <Row icon="bell" tint="var(--grey)" title="Allow notifications on this phone" onClick={notifications}><Icon name="chev" className="srow-c" /></Row>}
    </Section>

    <Section title="Night" footer="Analysed on the phone. Only the summary and, if kept, these short recordings go to your server.">
      <Row icon="mic" tint="var(--snore)" title="Keep recordings" sub="Snoring, talking, coughing · 7 days"><Switch on={s.clips !== false} set={clips => save({ clips })} label="Keep recordings" /></Row>
    </Section>

    <Section title="Account" footer={`mySleep v${__APP_VERSION__}`}>
      <Row icon="person" tint="var(--grey)" title={user?.name} />
      <Row title="Sign out" onClick={logout} danger />
    </Section>

  </>
}
