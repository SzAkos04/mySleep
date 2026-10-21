// Clock times as minutes after noon, so a night's 23:50 and 00:10 sit 20 minutes apart
// instead of 23 hours.
export const fromNoon = ms => { const d = new Date(ms); return (d.getHours() * 60 + d.getMinutes() + 720) % 1440 }
export const noonToClock = m => { m = ((Math.round(m) + 720) % 1440 + 1440) % 1440; return pad(Math.floor(m / 60)) + ':' + pad(m % 60) }
const pad = n => String(n).padStart(2, '0')

const mean = a => a.reduce((s, v) => s + v, 0) / a.length
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))) }

// nights: newest first, only ones with numbers in them.
export function summary(nights, need) {
  const L = nights.filter(n => n.asleepMin > 0)
  if (!L.length) return null
  const on = L.filter(n => n.on).map(n => fromNoon(n.on)), wake = L.filter(n => n.wake).map(n => fromNoon(n.wake))
  return {
    n: L.length,
    avgAsleep: mean(L.map(n => n.asleepMin)),
    debt: L.reduce((s, n) => s + Math.max(0, need - n.asleepMin), 0),
    on: on.length ? { mean: mean(on), sd: sd(on) } : null,
    wake: wake.length ? { mean: mean(wake), sd: sd(wake) } : null,
    snore: mean(L.map(n => n.snoreMin || 0))
  }
}
