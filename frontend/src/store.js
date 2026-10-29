import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api } from './lib/api.js'
import { pendingChanges, mergeRemote, stillDirty } from './lib/sync.js'
import { useUI } from './ui.js'

export const defaultSettings = () => ({
  bedtime: '23:00', wake: '06:45',
  alarm: true, smart: true,
  remind: true, clips: true,
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  ts: 0   // 0: the server's copy wins on first sync
})

// Everything here is persisted and synced, except `user`, `rev` and `dirty`, which are this
// device's bookkeeping.
export const useStore = create(persist((set, get) => ({
  user: null,
  nights: {},
  settings: defaultSettings(),
  rev: 0,
  dirty: {},
  lastSynced: null,

  // `owner` is whose nights these are. Another profile signing in on this device starts clean;
  // the same one signing back in (an expired session) keeps its unsynced edits.
  owner: null,
  setUser: user => set(s => !user ? { user } : s.owner && s.owner !== user.id
    ? { user, owner: user.id, nights: {}, settings: defaultSettings(), rev: 0, dirty: {} }
    : { user, owner: user.id }),
  saveNight: n => { set(s => ({ nights: { ...s.nights, [n.id]: { ...n, ts: Date.now() } }, dirty: { ...s.dirty, ['night:' + n.id]: true } })); schedule() },
  deleteNight: id => { set(s => ({ nights: { ...s.nights, [id]: { id, deleted: true, ts: Date.now() } }, dirty: { ...s.dirty, ['night:' + id]: true } })); schedule() },
  saveSettings: patch => { set(s => ({ settings: { ...s.settings, ...patch, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, ts: Date.now() }, dirty: { ...s.dirty, 'settings:main': true } })); schedule() },
  signOut: () => set({ user: null, owner: null, nights: {}, settings: defaultSettings(), rev: 0, dirty: {} })
}), { name: 'mysleep_v1' }))

// Newest first, without deleted ones.
export const nightList = nights => Object.values(nights).filter(n => !n.deleted).sort((a, b) => b.id.localeCompare(a.id))

/* ---------- sync: debounced after each change, whenever the app comes back, and once a minute
   while it is open (so the server check in the corner stays current). The connection state lives
   in the UI store, not here: it must not survive a reload. ---------- */
let timer = null, running = false, again = false
function schedule(ms = 800) { clearTimeout(timer); timer = setTimeout(syncNow, ms) }

export async function syncNow() {
  if (!useStore.getState().user) return
  if (running) { again = true; return }
  running = true
  useUI.setState({ syncBusy: true })
  try {
    const s = useStore.getState()
    const changes = pendingChanges(s)
    const r = await api('/api/sync', { since: s.rev, changes })
    useStore.setState(cur => ({ ...mergeRemote(cur, r.changes), rev: r.rev, dirty: stillDirty(cur, changes), lastSynced: Date.now() }))
    useUI.setState({ syncError: null })
  } catch (e) {
    // no status: the request never got an answer (offline, Tailscale down); 502-504: nginx is up
    // but the API behind it is not. Both are "not reachable"; anything else is the API saying no.
    const down = !e.status || (e.status >= 502 && e.status <= 504)
    useUI.setState({ syncError: e.status === 401 ? 'auth' : down ? 'offline' : 'server' })
    if (e.status === 401) useStore.setState({ user: null })
    else schedule(30000)   // try again later, the edits stay dirty
  } finally {
    running = false
    useUI.setState({ syncBusy: false })
    if (again) { again = false; schedule(0) }
  }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow() })
setInterval(() => { if (document.visibilityState === 'visible') syncNow() }, 60000)
