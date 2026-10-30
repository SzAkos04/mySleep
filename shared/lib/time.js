export const pad = n => String(n).padStart(2, '0')
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// A night is named after its evening: anything before noon belongs to the day before.
export function nightIdOf(ms) {
  const d = new Date(ms - 12 * 3600e3)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const noonOf = id => { const [y, m, d] = id.split('-').map(Number); return new Date(y, m - 1, d, 12) }

// "HH:MM" on a night: evening hours on its date, morning hours on the next.
export function atClock(id, hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  const t = noonOf(id)
  t.setMinutes(t.getMinutes() + ((h * 60 + m - 720 + 1440) % 1440))
  return t.getTime()
}

export const clockOf = ms => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()) }
export const dur = min => {
  if (min < 59.5) return Math.round(min) + ' min'
  const t = Math.round(min)   // whole minutes first, so 119.6 is 2h 00m, not 1h 60m
  return Math.floor(t / 60) + 'h ' + pad(t % 60) + 'm'
}
// "once" or "3 times"
export const nTimes = n => n === 1 ? 'once' : `${n} times`
export const dayLabel = id => { const d = noonOf(id); return `${DAY[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}` }
