// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { mount, unmount, button, byText, text, input, click, type, key, flush } from '../test/dom.js'

// Every tap outside the night screen: a night's page, correcting its times, Settings, the server
// check, signing in, and the Sleep button. The server is a stand-in (lib/api.js mocked).
const api = vi.hoisted(() => {
  // nothing reaches a real server, not even what modules fetch as they load (the alarm sound)
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(8) })
  return { calls: [], reply: {} }
})
vi.mock('../lib/api.js', () => ({
  api: vi.fn(async (path, body) => {
    api.calls.push([path, body])
    const r = api.reply[path]
    if (r instanceof Error) throw r
    return typeof r === 'function' ? r(body) : r ?? { rev: 0, changes: [] }
  }),
  armBackup: vi.fn(async () => {}), uploadClips: vi.fn(async () => []),
  enablePush: vi.fn(async () => { throw new Error('Add mySleep to the home screen first') }),
  passkeyLogin: vi.fn(async () => ({ id: 'u1', name: 'Test' })), passkeyRegister: vi.fn(async name => ({ id: 'u2', name }))
}))
const tracker = vi.hoisted(() => ({ start: null }))
vi.mock('../lib/tracker.js', async orig => ({ ...(await orig()), start: (...a) => tracker.start(...a) }))

const { useStore, defaultSettings, syncNow } = await import('../store.js')
const { useUI } = await import('../ui.js')
const apiMod = await import('../lib/api.js')
const { Night } = await import('./Night.jsx')
const { Settings } = await import('./Settings.jsx')
const { Login } = await import('./Login.jsx')
const { Journal } = await import('./Journal.jsx')
const { Trends } = await import('./Trends.jsx')
const { ReviewSheet } = await import('../components/ReviewSheet.jsx')
const { ServerStatus } = await import('../components/ServerStatus.jsx')
const { App } = await import('../App.jsx')

const { summarize } = await import('../lib/analysis.js')
const BED = new Date(2026, 9, 28, 23, 0).getTime()
// 8 quiet hours, as the tracker records them
const quietNight = () => { const n = 8 * 3600, f = { db: [], low: [], mid: [], vr: [], at: [] }; for (let s = 0; s < n; s++) { f.db.push(30 + (s % 5) / 4); f.low.push(0.3); f.mid.push(0.3); f.vr.push(1); f.at.push(1) } return f }
const night = { id: '2026-10-28', bed: BED, on: BED + 15 * 60e3, wake: BED + 8 * 3600e3, wakes: 1, awakeMin: 5, asleepMin: 460, restfulMin: 200, snoreMin: 0, talks: 0, coughs: 0, events: [], clips: [],
  timeline: summarize(quietNight(), BED).timeline }
let where
function Where() { where = useLocation().pathname; return null }
const at = (path, el, route = path) => <MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={el} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>

beforeEach(() => {
  api.calls = []; api.reply = {}
  useStore.setState({ user: { id: 'u1', name: 'Test' }, owner: 'u1', settings: { ...defaultSettings(), ts: 1 }, nights: { [night.id]: night }, dirty: {}, rev: 0, tracking: null, lastSynced: null })
  useUI.setState({ sheet: null, toast: null, syncBusy: false, syncError: null })
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }))
})
afterEach(async () => { await unmount(); vi.useRealTimers() })

describe("a night's page", () => {
  it('Delete asks first; Cancel keeps the night, Delete removes it everywhere and goes to the Journal', async () => {
    await mount(at('/night/' + night.id, <Night />, '/night/:id'))
    await click(button('Delete night'))
    expect(text()).toMatch(/The night, its recordings and its summary go from every device/)
    await click(button('Cancel'))
    expect(useStore.getState().nights[night.id].deleted).toBeUndefined()
    await click(button('Delete night'))
    await click(button('Delete'))
    expect(useStore.getState().nights[night.id]).toMatchObject({ deleted: true })
    expect(useStore.getState().dirty['night:' + night.id]).toBe(true)   // goes to the server too
    expect(where).toBe('/journal')
    expect(useUI.getState().toast).toBe('Night deleted')
  })

  it('shows how the score adds up, on a tap', async () => {
    await mount(at('/night/' + night.id, <Night />, '/night/:id'))
    expect(text()).not.toMatch(/\d+\/\d+/)
    await click(button('How the score adds up'))
    expect(text()).toMatch(/\d+\/\d+/)
    expect(button('Hide the score adds up')).not.toBeNull()
  })

  it('the pencil opens Correct the times', async () => {
    await mount(at('/night/' + night.id, <Night />, '/night/:id'))
    await click(button('Correct the times'))
    expect(useUI.getState().sheet).toMatchObject({ type: 'review', night: { id: night.id } })
  })

  it('a deleted night says it is gone', async () => {
    useStore.setState({ nights: { [night.id]: { id: night.id, deleted: true } } })
    await mount(at('/night/' + night.id, <Night />, '/night/:id'))
    expect(text()).toMatch(/This night is gone/)
  })
})

describe('correcting the times', () => {
  it('saves new times and recounts the sleep from them', async () => {
    await mount(<MemoryRouter><ReviewSheet night={night} /></MemoryRouter>)
    const [bed, on, wake] = document.querySelectorAll('input[type=time]')
    expect([bed.value, on.value, wake.value]).toEqual(['23:00', '23:15', '07:00'])
    await type(on, '23:45')
    await type(wake, '06:45')
    await click(button('Save'))
    const n = useStore.getState().nights[night.id]
    expect(n.on).toBe(BED + 45 * 60e3)
    expect(n.wake).toBe(BED + 7 * 3600e3 + 45 * 60e3)
    expect(n.asleepMin).toBe(7 * 60 - 5)   // 23:45–06:45, less the 5 min awake
    expect(useUI.getState().toast).toBe('Night saved')
  })

  it('saved untouched, the analysed minutes stand', async () => {
    await mount(<MemoryRouter><ReviewSheet night={night} /></MemoryRouter>)
    await click(button('Save'))
    expect(useStore.getState().nights[night.id].asleepMin).toBe(460)
  })

  it('Escape closes it without saving', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    useUI.setState({ sheet: { type: 'review', night } })
    await mount(<MemoryRouter><ReviewSheet night={night} /></MemoryRouter>)
    await key('Escape')
    vi.advanceTimersByTime(300); await flush()
    expect(useUI.getState().sheet).toBeNull()
    expect(useStore.getState().dirty).toEqual({})
  })
})

describe('Settings', () => {
  it('the alarm switch hides the wake time and is saved to sync', async () => {
    await mount(<MemoryRouter><Settings /></MemoryRouter>)
    expect(input('Wake-up time').value).toBe('06:45')
    await click(button('Alarm'))
    expect(useStore.getState().settings.alarm).toBe(false)
    expect(useStore.getState().dirty['settings:main']).toBe(true)
    expect(input('Wake-up time')).toBeNull()
    await click(button('Alarm'))
    expect(input('Wake-up time')).not.toBeNull()
  })

  it('wake time, bedtime, smart alarm, reminder and recordings are saved', async () => {
    await mount(<MemoryRouter><Settings /></MemoryRouter>)
    await type(input('Wake-up time'), '07:10')
    await type(input('Bedtime'), '22:30')
    await click(button('Smart alarm'))
    await click(button('Bedtime reminder'))
    await click(button('Keep recordings'))
    expect(useStore.getState().settings).toMatchObject({ wake: '07:10', bedtime: '22:30', smart: false, remind: false, clips: false })
  })

  it('a cleared time field is ignored, not saved as nothing', async () => {
    await mount(<MemoryRouter><Settings /></MemoryRouter>)
    await type(input('Wake-up time'), '')
    expect(useStore.getState().settings.wake).toBe('06:45')
  })

  it('notifications that cannot be turned on say why', async () => {
    await mount(<MemoryRouter><Settings /></MemoryRouter>)
    await click(button('Allow notifications on this phone'))
    expect(text()).toMatch(/Add mySleep to the home screen first/)
  })

  it('Sign out tells the server and forgets this profile here', async () => {
    await mount(<MemoryRouter><Settings /></MemoryRouter>)
    await click(button('Sign out'))
    expect(api.calls.map(c => c[0])).toContain('/api/logout')
    expect(useStore.getState()).toMatchObject({ user: null, owner: null, nights: {} })
  })
})

describe('the server check', () => {
  it('a tap opens what it knows; Sync now syncs and keeps it open', async () => {
    await mount(<MemoryRouter><ServerStatus /></MemoryRouter>)
    expect(button('Server, All synced')).not.toBeNull()
    await click(button('Server, All synced'))
    expect(byText('All synced')).not.toBeNull()
    expect(text()).toMatch(/Response time\s*\d+ ms/)
    let finish
    api.reply['/api/sync'] = () => new Promise(r => { finish = r })
    await click(button('Sync now'))
    expect(button('Syncing…')).not.toBeNull()
    finish({ rev: 1, changes: [] }); await flush(); await flush()
    expect(document.querySelector('[role=dialog][aria-label=Server]')).not.toBeNull()   // still open
    expect(button('Sync now')).not.toBeNull()
    expect(useStore.getState().lastSynced).toBeGreaterThan(0)
  })

  it('a server that does not answer: crossed-out cloud, and what that means for your nights', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Load failed') })
    await mount(<MemoryRouter><ServerStatus /></MemoryRouter>)
    await click(button('Server, All synced'))
    await flush()
    expect(text()).toMatch(/No answer/)
    expect(text()).toMatch(/kept on this phone/)
    expect(button('Server, Server not reachable')).not.toBeNull()
  })

  it('changes waiting are counted', async () => {
    useStore.setState({ dirty: { 'night:a': true, 'settings:main': true } })
    await mount(<MemoryRouter><ServerStatus /></MemoryRouter>)
    expect(button('Server, Changes waiting to sync')).not.toBeNull()
  })
})

describe('signing in', () => {
  it('with the passkey', async () => {
    useStore.setState({ user: null, owner: null })
    await mount(<Login />)
    await click(button('Sign in with passkey'))
    expect(useStore.getState().user).toEqual({ id: 'u1', name: 'Test' })
  })

  it('a first profile, only when the server allows sign-up, and only with a name', async () => {
    useStore.setState({ user: null, owner: null })
    await mount(<Login signup />)
    expect(button('Create profile').disabled).toBe(true)
    await type(input('Your name'), '  Ákos ')
    await click(button('Create profile'))
    expect(apiMod.passkeyRegister).toHaveBeenCalledWith('Ákos')
    expect(useStore.getState().user.name).toBe('Ákos')
  })

  it('a refused passkey prompt is not an error; a server error is shown', async () => {
    useStore.setState({ user: null, owner: null })
    apiMod.passkeyLogin.mockRejectedValueOnce(Object.assign(new Error('cancelled'), { name: 'NotAllowedError' }))
    await mount(<Login />)
    await click(button('Sign in with passkey'))
    expect(document.querySelector('.err')).toBeNull()
    apiMod.passkeyLogin.mockRejectedValueOnce(new Error('No passkey on this server'))
    await click(button('Sign in with passkey'))
    expect(document.querySelector('.err').textContent).toBe('No passkey on this server')
  })
})

describe('the app', () => {
  it('signed out on the server: the sign-in page, with sign-up when the server allows it', async () => {
    api.reply['/api/me'] = Object.assign(new Error('no session'), { status: 401, data: { signup: true } })
    await mount(<App />)
    await flush()
    expect(button('Sign in with passkey')).not.toBeNull()
    expect(button('Create profile')).not.toBeNull()
  })

  it('offline: keeps the profile on the phone and opens as usual', async () => {
    api.reply['/api/me'] = new TypeError('Load failed')
    await mount(<App />)
    await flush()
    expect(button('Sign in with passkey')).toBeNull()
    expect(button('Sleep')).not.toBeNull()
  })

  it('Sleep with the microphone refused: says how to allow it, starts no night', async () => {
    api.reply['/api/me'] = { user: { id: 'u1', name: 'Test' } }
    tracker.start = vi.fn(async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }) })
    await mount(<App />)
    await click(button('Sleep'))
    await flush()
    expect(text()).toMatch(/Allow it in Settings › Safari › Microphone/)
    expect(useStore.getState().tracking).toBeNull()
  })

  it('the tabs lead to their screens', async () => {
    api.reply['/api/me'] = { user: { id: 'u1', name: 'Test' } }
    await mount(<App />)
    for (const [tab, title] of [['Journal', /October|November/], ['Trends', 'Trends'], ['Settings', 'Settings'], ['Today', /Good (morning|evening|afternoon)|Today/]]) {
      await click([...document.querySelectorAll('#tabbar a')].find(a => a.textContent === tab))
      expect(document.querySelector('h1').textContent).toMatch(title)
    }
  })
})

describe('the Journal and Trends', () => {
  it('the calendar moves by month, not past this one, and a coloured day opens its night', async () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 29, 9, 0), toFake: ['Date'] })
    await mount(<MemoryRouter><Journal /></MemoryRouter>)
    expect(document.querySelector('h1').textContent).toBe('October')
    expect(button('Next month').disabled).toBe(true)
    expect(text()).toMatch(/Average \d+ · 1 night/)
    await click(button('Previous month'))
    expect(document.querySelector('h1').textContent).toBe('September')
    expect(text()).toMatch(/No nights this month/)
    await click(button('Next month'))
    const day = document.querySelector('button[aria-label^="Wed, Oct 28, score"]')
    expect(day.disabled).toBe(false)
    await click(day)
    expect(day.classList.contains('sel')).toBe(true)
  })

  it('Trends: week, month and year, and snoring only when there was some', async () => {
    const more = Object.fromEntries([1, 2, 3].map(d => { const id = `2026-10-2${d}`; return [id, { ...night, id, snoreMin: d === 2 ? 14 : 0 }] }))
    useStore.setState({ nights: { [night.id]: night, ...more } })
    await mount(<MemoryRouter><Trends /></MemoryRouter>)
    expect(text()).toMatch(/Snoring/)
    for (const p of ['Month', 'Year', 'Week']) {
      await click(button(p))
      expect(button(p).getAttribute('aria-pressed')).toBe('true')
    }
  })
})

describe("a night's sounds", () => {
  const T = BED + 3 * 3600e3
  const withSounds = { ...night, events: [{ t: T, kind: 'talk', sec: 6 }, { t: T + 600e3, kind: 'snore', sec: 180 }], clips: [{ id: 'c1', t: T, kind: 'talk', sec: 6 }] }
  let played
  beforeEach(() => {
    played = []
    globalThis.Audio = class { constructor(src) { this.src = src } play() { played.push(this.src); return Promise.resolve() } pause() { this.paused = true } }
    URL.createObjectURL = () => 'blob:clip'; URL.revokeObjectURL = () => {}
    useStore.setState({ nights: { [night.id]: withSounds } })
  })

  it('lists them, and plays a kept recording; a tap again stops it', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['RIFF']) }))
    await mount(at('/night/' + night.id, <Night />, '/night/:id'))
    expect(text()).toMatch(/Talking/)
    expect(text()).toMatch(/Snoring.*not recorded.*3 min/)
    await click(button('Play the recording'))
    expect(fetch).toHaveBeenCalledWith('/api/clips/2026-10-28/c1')
    expect(played).toEqual(['blob:clip'])
    await click(button('Stop'))
    expect(button('Play the recording')).not.toBeNull()
  })

  it('a recording the server lost: the button gives up instead of spinning', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404 }))
    await mount(at('/night/' + night.id, <Night />, '/night/:id'))
    await click(button('Play the recording'))
    expect(button('Play the recording').disabled).toBe(true)
  })
})

describe('sheets and messages', () => {
  const finger = (el, type, y, x = 200) => {
    const e = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] })
    el.dispatchEvent(e)
    return e
  }
  async function pull(dy, { dx = 0, ms = 400 } = {}) {
    const sheet = document.querySelector('.sheet'), t0 = performance.now()
    let now = t0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    await act(() => { finger(sheet, 'touchstart', 100) })
    for (let i = 1; i <= 5; i++) { now = t0 + ms * i / 5; await act(() => { finger(sheet, 'touchmove', 100 + dy * i / 5, 200 + dx * i / 5) }) }
    await act(() => { finger(sheet, 'touchend') })
    vi.restoreAllMocks()
    return sheet
  }
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); useUI.setState({ sheet: { type: 'review', night } }) })

  it('a long pull down closes a sheet; a short one springs back', async () => {
    await mount(<MemoryRouter><ReviewSheet night={night} /></MemoryRouter>)
    const sheet = await pull(40)
    expect(sheet.style.transform).toBe('')
    vi.advanceTimersByTime(300); await flush()
    expect(useUI.getState().sheet).not.toBeNull()
    await pull(150)
    vi.advanceTimersByTime(300); await flush()
    expect(useUI.getState().sheet).toBeNull()
  })

  it('a quick flick closes it; a sideways swipe is not the sheet’s', async () => {
    await mount(<MemoryRouter><ReviewSheet night={night} /></MemoryRouter>)
    await pull(10, { dx: 120 })
    vi.advanceTimersByTime(300); await flush()
    expect(useUI.getState().sheet).not.toBeNull()
    await pull(50, { ms: 40 })
    vi.advanceTimersByTime(300); await flush()
    expect(useUI.getState().sheet).toBeNull()
  })

  it('a message shows for a moment, then goes', () => {
    useUI.getState().say('Night saved', 1800)
    expect(useUI.getState().toast).toBe('Night saved')
    vi.advanceTimersByTime(1799)
    expect(useUI.getState().toast).toBe('Night saved')
    vi.advanceTimersByTime(1)
    expect(useUI.getState().toast).toBeNull()
  })
})
