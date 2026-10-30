// What mySleep Night's screens show of the nights, as plain data: the night's report, the
// journal's month, the trends. The app draws it (bundled in rules.js, read by Swift as JSON), so
// the wording and the numbers are decided here, once, and tested here. `state` is the store's:
// { nights, settings }.
import { sleepScore, insights, unrecorded, NEED } from './score.js'
import { summary, fromNoon, noonToClock, toNoon } from './stats.js'
import { clockOf, dayLabel, dur, nTimes, pad } from './time.js'

const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const SOUND = { snore: 'Snoring', talk: 'Talking', cough: 'Coughing', noise: 'Room noise' }

export const verdict = s => s >= 85 ? 'A great night' : s >= 70 ? 'A good night' : s >= 55 ? 'An okay night' : 'A rough night'
// good / accent / warn: the app picks the colours
export const tone = s => s >= 80 ? 'good' : s >= 60 ? 'accent' : 'warn'

const list = nights => Object.values(nights).filter(n => !n.deleted).sort((a, b) => b.id.localeCompare(a.id))
const dayOf = id => new Date(id + 'T12:00')
// The average score of the nights the microphone recorded: an empty night says nothing about sleep.
const meanScore = (nights, settings) => { const r = nights.filter(n => !unrecorded(n)); return r.length ? Math.round(r.reduce((t, n) => t + sleepScore(n, settings).score, 0) / r.length) : null }
const fmtSec = s => s < 60 ? `${s} s` : `${Math.round(s / 60)} min`

export function reportView(state, id) {
  const n = state.nights[id]
  if (!n || n.deleted) return null
  const { settings } = state, s = sleepScore(n, settings), blank = unrecorded(n)
  const avg = (w => w.length >= 3 ? meanScore(w, settings) : null)(list(state.nights).filter(x => x.id !== n.id && !unrecorded(x)).slice(0, 7))
  const latency = n.on ? Math.round((n.on - n.bed) / 60000) : null
  const diag = n.diag?.app === 'native' ? [
    ['Recorded by', 'mySleep Night', false], ['Interruptions', n.diag.interruptions, n.diag.interruptions > 0], ['Audio restarted', n.diag.restarts, n.diag.restarts > 0],
    ['Microphone sent nothing', n.diag.micSilent, n.diag.micSilent > 0], ['Phone locked', n.diag.locked, false]
  ].map(([label, v, bad]) => ({ label, value: String(v), bad })) : []
  return {
    id, title: dayLabel(id), range: `In bed ${clockOf(n.bed)} – ${clockOf(n.wake)} · ${dur((n.wake - n.bed) / 60000)}`,
    times: { bed: clockOf(n.bed), on: n.on ? clockOf(n.on) : '', wake: clockOf(n.wake) },   // as the correction form starts
    score: s.score, tone: tone(s.score), blank, verdict: blank ? 'Nothing recorded' : verdict(s.score),
    vsWeek: avg != null && !blank ? `${s.score > avg ? 'Better than' : s.score < avg ? 'Below' : 'Same as'} your week (${avg})` : null,
    facts: [{ value: dur(n.asleepMin || 0), label: 'asleep' }, { value: latency != null ? latency + ' min' : '–', label: 'to fall asleep' }, { value: n.restfulMin != null ? dur(n.restfulMin) : '–', label: 'restful' }],
    timeline: n.timeline ?? null,
    parts: s.parts.map(({ label, note, pts, max }) => ({ label, note, pts, max })),
    insights: insights(n),
    sounds: (n.events || []).filter(e => SOUND[e.kind]).map(e => ({ label: SOUND[e.kind], time: clockOf(e.t), length: fmtSec(e.sec) })),
    alarm: n.alarm ? `The alarm rang at ${clockOf(n.alarm.at)}${n.alarm.early ? `, ${n.alarm.early} min early` : ''}.` : null,
    diag
  }
}

// The month the journal opens on: the newest night's.
export function startMonth(state, now) {
  const last = list(state.nights)[0], d = last ? dayOf(last.id) : new Date(now)
  return { year: d.getFullYear(), month: d.getMonth() }
}

// `month`: { year, month (0-based) }; `sel`: the chosen night's id, or the newest.
export function journalView(state, { year: y, month: m }, sel, now) {
  const { settings } = state, all = list(state.nights), byId = Object.fromEntries(all.map(n => [n.id, n]))
  const today = new Date(now), count = new Date(y, m + 1, 0).getDate(), lead = (new Date(y, m, 1).getDay() + 6) % 7
  const inMonth = all.filter(n => n.id.startsWith(`${y}-${pad(m + 1)}`)), avg = meanScore(inMonth, settings)
  const days = Array.from({ length: count }, (_, i) => {
    const id = `${y}-${pad(m + 1)}-${pad(i + 1)}`, n = byId[id]
    if (!n) return { n: i + 1, id, kind: new Date(y, m, i + 1) > today ? 'future' : 'none' }
    if (unrecorded(n)) return { n: i + 1, id, kind: 'blank' }
    const score = sleepScore(n, settings).score
    return { n: i + 1, id, kind: 'scored', score, tone: tone(score) }
  })
  const n = byId[sel ?? all[0]?.id]
  const blank = n && unrecorded(n), score = n && sleepScore(n, settings).score
  const selected = n && {
    id: n.id, title: dayLabel(n.id), blank, score, tone: tone(score),
    headline: blank ? 'Nothing recorded' : dur(n.asleepMin || 0) + ' asleep',
    line: [n.wakes ? `Woke ${nTimes(n.wakes)}` : n.on && 'Slept through', n.snoreMin ? `snored ${n.snoreMin} min` : null, n.talks ? `talked ${nTimes(n.talks)}` : null].filter(Boolean).join(' · '),
    timeline: n.timeline ?? null
  }
  return {
    title: MONTH[m] + (y !== today.getFullYear() ? ' ' + y : ''),
    sub: inMonth.length ? `${avg != null ? `Average ${avg} · ` : ''}${inMonth.length} ${inMonth.length === 1 ? 'night' : 'nights'}` : 'No nights this month',
    canNext: !(y === today.getFullYear() && m === today.getMonth()), lead, days, selected: selected || null,
    empty: selected ? null : all.length ? 'Pick a night in the calendar.' : 'Your nights will fill this calendar.'
  }
}

// `days`: 7, 30 or 365.
export function trendsView(state, days) {
  const { settings } = state, all = list(state.nights), L = all.slice(0, days), s = summary(L, NEED)
  if (!s) return { empty: 'Trends start after a couple of nights.' }
  const chrono = L.slice().reverse(), scored = chrono.map(n => sleepScore(n, settings).score)
  const avg = meanScore(L, settings) ?? 0, prev = meanScore(all.slice(days, 2 * days), settings)
  const period = days === 7 ? 'week' : days === 30 ? 'month' : 'year'
  const label = n => { const d = dayOf(n.id); return chrono.length <= 7 ? DAY[d.getDay()] : d.getDay() === 1 ? String(d.getDate()) : '' }
  return {
    label: `This ${period}`, avg, change: prev != null ? `${avg >= prev ? 'up' : 'down'} ${Math.abs(avg - prev)} on the ${period} before` : null,
    kpis: [
      { value: dur(s.avgAsleep), label: 'asleep a night' }, { value: dur(s.debt), label: 'short of 8 h, in all' },
      { value: s.on ? noonToClock(s.on.mean) : '–', label: s.on ? `asleep ± ${Math.round(s.on.sd)} min` : 'asleep' },
      { value: s.wake ? noonToClock(s.wake.mean) : '–', label: s.wake ? `awake ± ${Math.round(s.wake.sd)} min` : 'awake' }
    ],
    scores: chrono.map((n, i) => ({ id: n.id, label: label(n), value: scored[i], tone: tone(scored[i]) })),
    hours: chrono.map(n => ({ id: n.id, label: label(n), value: n.asleepMin || 0, full: (n.asleepMin || 0) >= NEED })),
    windows: chrono.map(n => ({ id: n.id, label: label(n), on: n.on && n.wake ? fromNoon(n.on) : null, wake: n.on && n.wake ? fromNoon(n.wake) : null })),
    target: { bed: toNoon(settings.bedtime), wake: toNoon(settings.wake), label: `${settings.bedtime}–${settings.wake}` },
    snoring: chrono.some(n => n.snoreMin) ? chrono.map(n => ({ id: n.id, label: label(n), value: n.snoreMin || 0 })) : null
  }
}
