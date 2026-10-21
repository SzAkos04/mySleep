// The only place that talks to the server.
export async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error || 'server error ' + res.status), { status: res.status, data })
  return data
}

const bufToB64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export const b64uToBuf = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

function credToJSON(cred) {
  const r = cred.response
  const out = {
    id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults?.() || {},
    authenticatorAttachment: cred.authenticatorAttachment || null,
    response: { clientDataJSON: bufToB64u(r.clientDataJSON) }
  }
  if (r.attestationObject) {
    out.response.attestationObject = bufToB64u(r.attestationObject)
    out.response.transports = r.getTransports?.() || ['internal']
  }
  if (r.authenticatorData) {
    out.response.authenticatorData = bufToB64u(r.authenticatorData)
    out.response.signature = bufToB64u(r.signature)
    out.response.userHandle = r.userHandle ? bufToB64u(r.userHandle) : null
  }
  return out
}

export async function passkeyRegister(name) {
  const { cid, options: o } = await api('/api/register/options', { name })
  o.challenge = b64uToBuf(o.challenge)
  o.user.id = b64uToBuf(o.user.id)
  for (const c of o.excludeCredentials || []) c.id = b64uToBuf(c.id)
  const cred = await navigator.credentials.create({ publicKey: o })
  return (await api('/api/register/verify', { cid, credential: credToJSON(cred) })).user
}

export async function passkeyLogin() {
  const { cid, options: o } = await api('/api/login/options', {})
  o.challenge = b64uToBuf(o.challenge)
  const cred = await navigator.credentials.get({ publicKey: o })
  return (await api('/api/login/verify', { cid, credential: credToJSON(cred) })).user
}

export async function enablePush() {
  if (!('PushManager' in window)) throw new Error('Add mySleep to the home screen first: iPhone only sends notifications to installed apps.')
  if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications are turned off for mySleep in Settings.')
  const reg = await navigator.serviceWorker.ready
  const { key } = await api('/api/push/key')
  const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBuf(key) })
  await api('/api/push/subscribe', { subscription: sub.toJSON() })
}

// The backup alarm; never let a failure here get in the way of the night.
export const armBackup = at => api('/api/alarm', { at }).catch(() => {})

// Tonight's clips to the server once the night is over; returns the ones that made it.
export async function uploadClips(night, list) {
  const done = []
  for (const c of list) {
    const r = await fetch(`/api/clips/${night}/${c.id}`, { method: 'PUT', headers: { 'Content-Type': 'audio/wav' }, body: c.blob }).catch(() => null)
    if (r?.ok) done.push({ id: c.id, t: c.t, kind: c.kind, sec: c.sec })
  }
  return done
}
