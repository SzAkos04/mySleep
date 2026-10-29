import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The saved, synced store: who owns the nights on this phone, and when sync runs (after an edit,
// when the app comes back, once a minute) and what a failed one leaves behind.
const server = vi.hoisted(() => ({ calls: [], reply: null }))
vi.mock('./lib/api.js', () => ({
  api: vi.fn(async (path, body) => {
    server.calls.push(body)
    const r = typeof server.reply === 'function' ? server.reply(body) : server.reply
    if (r instanceof Error) throw r
    return r ?? { rev: body.since + 1, changes: [] }
  })
}))

let useStore, syncNow, useUI
beforeEach(async () => {
  vi.useFakeTimers({ now: new Date(2026, 9, 29, 7, 0), toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  server.calls = []; server.reply = null
  vi.resetModules()
  ;({ useStore, syncNow } = await import('./store.js'))
  ;({ useUI } = await import('./ui.js'))
  useStore.getState().setUser({ id: 'u1', name: 'Test' })
})
// each test loads its own store; signed out, an earlier one stays quiet when the next test syncs
afterEach(() => { useStore.getState().setUser(null); vi.useRealTimers() })
const tick = ms => vi.advanceTimersByTimeAsync(ms)

describe('whose nights', () => {
  it('the same profile signing back in keeps its unsynced edits; another one starts clean', () => {
    useStore.getState().saveNight({ id: 'a' })
    useStore.getState().setUser(null)
    useStore.getState().setUser({ id: 'u1' })
    expect(useStore.getState().nights.a).toBeTruthy()
    useStore.getState().setUser({ id: 'u2' })
    expect(useStore.getState()).toMatchObject({ nights: {}, dirty: {}, rev: 0, owner: 'u2' })
  })
  it('signing out forgets the nights here (the server keeps them)', () => {
    useStore.getState().saveNight({ id: 'a' })
    useStore.getState().signOut()
    expect(useStore.getState()).toMatchObject({ user: null, owner: null, nights: {}, dirty: {} })
  })
})

describe('edits', () => {
  it('a saved night is stamped and waits for sync; a deleted one leaves a tombstone', () => {
    useStore.getState().saveNight({ id: 'a', asleepMin: 400 })
    expect(useStore.getState().nights.a).toMatchObject({ asleepMin: 400, ts: Date.now() })
    useStore.getState().deleteNight('a')
    expect(useStore.getState().nights.a).toEqual({ id: 'a', deleted: true, ts: Date.now() })
    expect(useStore.getState().dirty).toEqual({ 'night:a': true })
  })
  it('settings keep this phone’s time zone', () => {
    useStore.getState().saveSettings({ wake: '07:00' })
    expect(useStore.getState().settings).toMatchObject({ wake: '07:00', tz: Intl.DateTimeFormat().resolvedOptions().timeZone, ts: Date.now() })
    expect(useStore.getState().dirty['settings:main']).toBe(true)
  })
})

describe('sync', () => {
  it('runs shortly after edits, once for several, and clears what the server took', async () => {
    useStore.getState().saveNight({ id: 'a' })
    useStore.getState().saveNight({ id: 'b' })
    await tick(500)
    expect(server.calls).toHaveLength(0)
    await tick(400)
    expect(server.calls).toHaveLength(1)
    expect(server.calls[0].changes.map(c => c.id).sort()).toEqual(['a', 'b'])
    expect(useStore.getState().dirty).toEqual({})
    expect(useStore.getState().lastSynced).toBe(new Date(2026, 9, 29, 7, 0).getTime() + 800)
  })

  it("takes the server's changes in", async () => {
    server.reply = { rev: 5, changes: [{ kind: 'night', id: 'z', ts: 10, data: { id: 'z', ts: 10, asleepMin: 300 } }] }
    await syncNow()
    expect(useStore.getState().nights.z).toMatchObject({ asleepMin: 300 })
    expect(useStore.getState().rev).toBe(5)
  })

  it('offline: edits stay, the cloud says not reachable, it tries again in 30 s', async () => {
    useStore.getState().saveNight({ id: 'a' })
    server.reply = new TypeError('Load failed')
    await tick(800)
    expect(useStore.getState().dirty).toEqual({ 'night:a': true })
    expect(useUI.getState().syncError).toBe('offline')
    server.reply = null
    await tick(30000)
    expect(useStore.getState().dirty).toEqual({})
    expect(useUI.getState().syncError).toBeNull()
  })

  it('nginx up but the API down (502–504) is "not reachable" too; another error is the server refusing', async () => {
    server.reply = Object.assign(new Error('bad gateway'), { status: 502 })
    await syncNow()
    expect(useUI.getState().syncError).toBe('offline')
    server.reply = Object.assign(new Error('boom'), { status: 500 })
    await syncNow()
    expect(useUI.getState().syncError).toBe('server')
  })

  it('a session that ran out signs out, and does not retry', async () => {
    server.reply = Object.assign(new Error('sign in'), { status: 401 })
    await syncNow()
    expect(useUI.getState().syncError).toBe('auth')
    expect(useStore.getState().user).toBeNull()
    await tick(60000)
    expect(server.calls).toHaveLength(1)
  })

  it('one at a time: a sync asked for during another runs right after it', async () => {
    let finish
    server.reply = () => new Promise(r => { finish = r })
    const first = syncNow()
    syncNow()
    expect(server.calls).toHaveLength(1)
    server.reply = null
    finish({ rev: 1, changes: [] }); await first
    await tick(0)
    expect(server.calls).toHaveLength(2)
  })

  it('when the app comes back, and every minute while it is open', async () => {
    document.dispatchEvent(new Event('visibilitychange'))
    await tick(0)
    expect(server.calls).toHaveLength(1)
    await tick(60000)
    expect(server.calls).toHaveLength(2)
    await tick(60000)
    expect(server.calls).toHaveLength(3)
  })

  it('signed out: never', async () => {
    useStore.getState().setUser(null)
    await syncNow()
    expect(server.calls).toHaveLength(0)
  })
})
