import { useState } from 'react'
import { useStore, syncNow } from '../store.js'
import { passkeyLogin, passkeyRegister } from '../lib/api.js'

export function Login({ signup }) {
  const setUser = useStore(s => s.setUser)
  const [name, setName] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  async function run(fn) {
    setErr(null); setBusy(true)
    try { setUser(await fn()); syncNow() }
    catch (e) { if (e.name !== 'NotAllowedError') setErr(e.message) }
    finally { setBusy(false) }
  }

  return <div className="stack" style={{ paddingTop: '18vh' }}>
    <header className="hdr" style={{ display: 'block' }}><h1>mySleep</h1><div className="sub">Sign in with the passkey on this phone.</div></header>
    <button className="btn" disabled={busy} onClick={() => run(passkeyLogin)}>Sign in with passkey</button>
    {signup && <form className="stack" style={{ marginTop: 24 }} onSubmit={e => { e.preventDefault(); name.trim() && run(() => passkeyRegister(name.trim())) }}>
      <span className="sect-t">First time on this server</span>
      <input className="field-in" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" aria-label="Your name" maxLength={40} />
      <button className="btn ghost" disabled={busy || !name.trim()}>Create profile</button>
    </form>}
    {err && <div className="err">{err}</div>}
  </div>
}
