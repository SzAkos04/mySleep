const pad = n => String(n).padStart(2, '0')
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

// The next time the clock shows "HH:MM", after `from`.
export function nextAt(hhmm, from = Date.now()) {
  const [h, m] = hhmm.split(':').map(Number), t = new Date(from)
  t.setHours(h, m, 0, 0)
  if (t.getTime() <= from) t.setDate(t.getDate() + 1)
  return t.getTime()
}

export const clockOf = ms => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()) }
export const dur = min => min < 59.5 ? Math.round(min) + ' min' : Math.floor(min / 60) + 'h ' + pad(Math.round(min % 60)) + 'm'
export const dayLabel = id => { const d = noonOf(id); return `${DAY[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}` }
export const todayLabel = (d = new Date()) => d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
