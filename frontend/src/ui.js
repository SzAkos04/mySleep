import { create } from 'zustand'

// Screen state that is not data: which sheet is open, the toast.
export const useUI = create(set => ({
  sheet: null,        // { type: 'review', night } (correcting a night's times), plus a key per opening
  toast: null,
  openSheet: sheet => set({ sheet: { ...sheet, key: Date.now() } }),
  closeSheet: () => set({ sheet: null }),
  say: text => { set({ toast: text }); setTimeout(() => set(s => s.toast === text ? { toast: null } : s), 1800) }
}))
