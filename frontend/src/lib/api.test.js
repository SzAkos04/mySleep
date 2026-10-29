import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api, b64uToBuf, passkeyRegister, passkeyLogin, enablePush } from './api.js'

// The only place that talks to the server, against a fetch that answers like it would.
let sent, answer
beforeEach(() => {
  sent = []
  answer = () => ({ status: 200, body: { ok: true } })
  globalThis.fetch = vi.fn(async (path, o = {}) => {
    sent.push({ path, method: o.method || 'GET', body: o.body && typeof o.body === 'string' ? JSON.parse(o.body) : o.body, headers: o.headers })
    const a = answer(path, o)
    if (a instanceof Error) throw a
    return { ok: a.status < 300, status: a.status, json: async () => { if (a.raw) throw new SyntaxError('not JSON'); return a.body } }
  })
})
const b64u = bytes => Buffer.from(bytes).toString('base64url')

describe('api', () => {
  it('GETs without a body, POSTs JSON with one', async () => {
    await api('/api/me')
    await api('/api/sync', { since: 3 })
    expect(sent[0]).toMatchObject({ path: '/api/me', method: 'GET' })
    expect(sent[1]).toMatchObject({ path: '/api/sync', method: 'POST', body: { since: 3 }, headers: { 'Content-Type': 'application/json' } })
  })
  it("a refusal carries the server's words, its status and data", async () => {
    answer = () => ({ status: 401, body: { error: 'sign in first', signup: true } })
    await expect(api('/api/me')).rejects.toMatchObject({ message: 'sign in first', status: 401, data: { signup: true } })
  })
  it('an error page that is not JSON still says the status', async () => {
    answer = () => ({ status: 502, raw: true })
    await expect(api('/api/sync', {})).rejects.toMatchObject({ message: 'server error 502', status: 502 })
  })
  it('offline: the network error, with no status', async () => {
    answer = () => new TypeError('Load failed')
    const e = await api('/api/me').catch(e => e)
    expect(e.message).toBe('Load failed')
    expect(e.status).toBeUndefined()
  })
})

describe('passkeys', () => {
  const buf = s => new TextEncoder().encode(s).buffer
  beforeEach(() => {
    globalThis.navigator ??= {}
    navigator.credentials = {
      create: vi.fn(async ({ publicKey }) => ({ id: 'cred1', rawId: buf('raw'), type: 'public-key', authenticatorAttachment: 'platform',
        getClientExtensionResults: () => ({}), response: { clientDataJSON: buf('cdj'), attestationObject: buf('att'), getTransports: () => ['internal', 'hybrid'] }, _opts: publicKey })),
      get: vi.fn(async () => ({ id: 'cred1', rawId: buf('raw'), type: 'public-key',
        response: { clientDataJSON: buf('cdj'), authenticatorData: buf('ad'), signature: buf('sig'), userHandle: null } }))
    }
  })

  it('base64url round-trips', () => {
    expect([...b64uToBuf(b64u([0, 255, 62, 63, 1]))]).toEqual([0, 255, 62, 63, 1])
  })

  it('registering: the options are decoded for the phone, the new passkey encoded for the server', async () => {
    answer = path => path.endsWith('/options')
      ? { status: 200, body: { cid: 'c1', options: { challenge: b64u([1, 2, 3]), user: { id: b64u([9]), name: 'Ákos' }, excludeCredentials: [{ id: b64u([7]) }] } } }
      : { status: 200, body: { user: { id: 'u1', name: 'Ákos' } } }
    expect(await passkeyRegister('Ákos')).toEqual({ id: 'u1', name: 'Ákos' })
    const o = navigator.credentials.create.mock.calls[0][0].publicKey
    expect([...o.challenge]).toEqual([1, 2, 3])
    expect([...o.user.id]).toEqual([9])
    expect([...o.excludeCredentials[0].id]).toEqual([7])
    expect(sent[1].body).toEqual({ cid: 'c1', credential: {
      id: 'cred1', rawId: b64u(Buffer.from('raw')), type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
      response: { clientDataJSON: b64u(Buffer.from('cdj')), attestationObject: b64u(Buffer.from('att')), transports: ['internal', 'hybrid'] } } })
  })

  it('signing in: the assertion is encoded for the server', async () => {
    answer = path => path.endsWith('/options') ? { status: 200, body: { cid: 'c2', options: { challenge: b64u([5]) } } } : { status: 200, body: { user: { id: 'u1' } } }
    expect(await passkeyLogin()).toEqual({ id: 'u1' })
    expect(sent[1].body.credential.response).toEqual({ clientDataJSON: b64u(Buffer.from('cdj')), authenticatorData: b64u(Buffer.from('ad')), signature: b64u(Buffer.from('sig')), userHandle: null })
  })
})

describe('notifications', () => {
  it('outside the home-screen app: says to add it first', async () => {
    delete globalThis.PushManager
    await expect(enablePush()).rejects.toThrow(/Add mySleep to the home screen first/)
  })
  it('permission refused: says where to turn it on', async () => {
    globalThis.PushManager = class {}
    globalThis.Notification = { requestPermission: async () => 'denied' }
    await expect(enablePush()).rejects.toThrow(/turned off for mySleep in Settings/)
  })
  it('allowed: subscribes with the server key and sends the subscription', async () => {
    globalThis.PushManager = class {}
    globalThis.Notification = { requestPermission: async () => 'granted' }
    const subscribe = vi.fn(async () => ({ toJSON: () => ({ endpoint: 'https://push' }) }))
    navigator.serviceWorker = { ready: Promise.resolve({ pushManager: { getSubscription: async () => null, subscribe } }) }
    answer = path => path === '/api/push/key' ? { status: 200, body: { key: b64u([4, 4]) } } : { status: 200, body: {} }
    await enablePush()
    expect([...subscribe.mock.calls[0][0].applicationServerKey]).toEqual([4, 4])
    expect(sent.at(-1)).toMatchObject({ path: '/api/push/subscribe', body: { subscription: { endpoint: 'https://push' } } })
  })
})
