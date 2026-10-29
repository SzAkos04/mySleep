import { create } from 'zustand'

// Screen state that is not data: which sheet is open, the toast.
export const useUI = create(set => ({
  sheet: null,        // { type: 'review', night } (correcting a night's times), plus a key per opening
  toast: null,
  syncBusy: false,
  syncError: null,   // null | 'offline' | 'server' | 'auth'
  devices: [],       // mySleep Night, paired or not, and when it stops (from /api/me)
  openSheet: sheet => set({ sheet: { ...sheet, key: Date.now() } }),
  closeSheet: () => set({ sheet: null }),
  say: (text, ms = 1800) => { set({ toast: text }); setTimeout(() => set(s => s.toast === text ? { toast: null } : s), ms) }
}))
