import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore, syncNow } from '../store.js'
import { useUI } from '../ui.js'
import { Icon } from './Icon.jsx'
import { ago } from '../lib/time.js'

const BADGE = {
  ok: <path d="M3.4 6.3 5.2 8.1 8.7 4.3" />,
  wait: <path d="M3.4 6h.01M6 6h.01M8.6 6h.01" />,
  off: <path d="M6 3.4v3.2M6 8.6h.01" />,
  bad: <path d="M6 3.4v3.2M6 8.6h.01" />
}
const LINE = {
  ok: 'All synced', sync: 'Syncing…', wait: 'Changes waiting to sync',
  off: 'Server not reachable', bad: 'The server refused the sync'
}

// The self-hosted server at a glance, as myGym's cloud: quiet while all is synced, turning
// while a sync is out, crossed out when the server cannot be reached. A tap opens what it knows.
export function ServerStatus() {
  const { syncBusy, syncError } = useUI()
  const waiting = useStore(s => Object.keys(s.dirty).length)
  const [slow, setSlow] = useState(false)   // a sync that takes a moment, not every quick one
  const [open, setOpen] = useState(false)
  const btn = useRef(null)
  useEffect(() => {
    if (!syncBusy) { setSlow(false); return }
    const t = setTimeout(() => setSlow(true), 300)
    return () => clearTimeout(t)
  }, [syncBusy])

  const st = slow ? 'sync' : syncError === 'offline' ? 'off' : syncError ? 'bad' : waiting ? 'wait' : 'ok'
  return <>
    <button ref={btn} className={'iconbtn cloud ' + st} onClick={() => setOpen(o => !o)} aria-label={'Server, ' + LINE[st]} aria-expanded={open}>
      <Icon name={st === 'sync' ? 'sync' : st === 'off' || st === 'bad' ? 'cloudoff' : 'cloud'} />
      {BADGE[st] && <svg className="cloud-b" viewBox="0 0 12 12" aria-hidden="true">{BADGE[st]}</svg>}
    </button>
    {open && createPortal(<Panel anchor={btn} st={st} waiting={waiting} close={() => setOpen(false)} />, document.body)}
  </>
}

function Panel({ anchor, st, waiting, close }) {
  const lastSynced = useStore(s => s.lastSynced), syncError = useUI(s => s.syncError)
  const [pos, setPos] = useState(null)
  const [ping, setPing] = useState(null)   // null asking, ms, or 'none'
  useLayoutEffect(() => {
    const r = anchor.current.getBoundingClientRect()
    setPos({ top: Math.round(r.bottom + 10), right: Math.max(12, Math.round(innerWidth - r.right)) })
    const esc = e => e.key === 'Escape' && close()
    addEventListener('scroll', close, { passive: true }); addEventListener('keydown', esc)
    return () => { removeEventListener('scroll', close); removeEventListener('keydown', esc) }
  }, [])
  // asked as the panel opens, and again with Sync now
  const [busy, setBusy] = useState(false)
  const check = async () => {
    setPing(null)
    const t0 = performance.now(), ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 5000)
    try {
      const r = await fetch('/api/health', { signal: ctl.signal, cache: 'no-store' })
      if (!r.ok) throw 0
      setPing(performance.now() - t0)
    } catch {
      setPing('none')
      if (!useUI.getState().syncError) useUI.setState({ syncError: 'offline' })
    } finally { clearTimeout(tm) }
  }
  useEffect(() => { check() }, [])
  const refresh = async () => {
    if (busy) return
    setBusy(true)
    await Promise.all([syncNow(), check()])
    setBusy(false)
  }

  const note = syncError === 'offline' ? 'Your nights are kept on this phone and go up as soon as the server answers.'
    : syncError === 'auth' ? 'Sign in again with your passkey.' : syncError === 'server' ? 'The server answered with an error. Your nights stay on this phone meanwhile.' : null
  return <>
    <div className="pop-bg" onClick={close} />
    <div className={'pop ' + st} role="dialog" aria-label="Server" style={pos || { visibility: 'hidden' }}>
      <div className="pop-h">{LINE[st]}</div>
      <div className="pop-host">{location.host}</div>
      <dl>
        <dt>Last synced</dt><dd>{lastSynced ? ago(lastSynced) : '–'}</dd>
        <dt>Waiting changes</dt><dd>{waiting}</dd>
        <dt>Response time</dt><dd>{ping == null ? '…' : ping === 'none' ? 'No answer' : Math.round(ping) + ' ms'}</dd>
      </dl>
      {note && <p className="pop-note">{note}</p>}
      <button className="btn" style={{ height: 40, fontSize: 15 }} disabled={busy} onClick={refresh}>{busy ? 'Syncing…' : 'Sync now'}</button>
    </div>
  </>
}
