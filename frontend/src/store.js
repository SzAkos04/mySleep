import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api } from './lib/api.js'
import { pendingChanges, mergeRemote, stillDirty } from './lib/sync.js'

export const defaultSettings = () => ({
  bedtime: '23:00', wake: '06:45',
  alarm: true, smart: true, alarmSound: 'chime',
  remind: true, clips: true,
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  ts: 0   // 0: the server's copy wins on first sync
})

// Everything here is persisted and synced, except `user`, `rev` and `dirty`, which are this
// device's bookkeeping, and `tracking`, the night in progress, which stays on this phone.
export const useStore = create(persist((set, get) => ({
  user: null,
  nights: {},
  settings: defaultSettings(),
  rev: 0,
  dirty: {},
  tracking: null,

  setUser: user => set({ user }),
  saveNight: n => { set(s => ({ nights: { ...s.nights, [n.id]: { ...n, ts: Date.now() } }, dirty: { ...s.dirty, ['night:' + n.id]: true } })); schedule() },
  deleteNight: id => { set(s => ({ nights: { ...s.nights, [id]: { id, deleted: true, ts: Date.now() } }, dirty: { ...s.dirty, ['night:' + id]: true } })); schedule() },
  saveSettings: patch => { set(s => ({ settings: { ...s.settings, ...patch, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, ts: Date.now() }, dirty: { ...s.dirty, 'settings:main': true } })); schedule() },
  setTracking: tracking => set({ tracking }),
  signOut: () => set({ user: null, nights: {}, settings: defaultSettings(), rev: 0, dirty: {} })
}), { name: 'mysleep_v1' }))

// Newest first, without deleted ones.
export const nightList = nights => Object.values(nights).filter(n => !n.deleted).sort((a, b) => b.id.localeCompare(a.id))

/* ---------- sync: debounced after each change, and whenever the app comes back ---------- */
let timer = null, running = false, again = false
function schedule(ms = 800) { clearTimeout(timer); timer = setTimeout(syncNow, ms) }

export async function syncNow() {
  if (!useStore.getState().user) return
  if (running) { again = true; return }
  running = true
  try {
    const s = useStore.getState()
    const changes = pendingChanges(s)
    const r = await api('/api/sync', { since: s.rev, changes })
    useStore.setState(cur => ({ ...mergeRemote(cur, r.changes), rev: r.rev, dirty: stillDirty(cur, changes) }))
  } catch (e) {
    if (e.status === 401) useStore.setState({ user: null })
    else schedule(30000)   // offline: try again later, the edits stay dirty
  } finally {
    running = false
    if (again) { again = false; schedule(0) }
  }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow() })
