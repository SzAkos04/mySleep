// The night's rules that stay the web app's: tonight's alarm plan (shown on Today and passed to
// mySleep Night by the Sleep link), and the night record made from the samples (lib/native.js turns
// mySleep Night's logs into nights with it).
import { summarize } from './analysis.js'
import { atClock, nextAt } from './time.js'

export const SMART_MIN = 30    // the smart alarm may ring this much before the wake time

// When tonight's alarm rings: { at, from }, `from` opening the smart window (never in the past).
export function alarmPlan(settings, from = Date.now()) {
  if (!settings.alarm) return null
  const at = nextAt(settings.wake, from)
  return { at, from: settings.smart ? Math.max(from, at - SMART_MIN * 60000) : at }
}

// What the morning shows, saved when the night ends. `ringing`: the alarm, if it rang.
export function nightRecord({ tr, samples, end, ringing, diag }) {
  const r = summarize(samples, samples.start)
  return {
    id: tr.nightId, bed: samples.start, on: r.on, wake: end,   // on: null when no sleep was found
    wakes: r.wakes, awakeMin: r.awakeMin, asleepMin: r.asleepMin, restfulMin: r.restfulMin,
    snoreMin: r.snoreMin, talks: r.talks, coughs: r.coughs, events: r.events,
    timeline: r.timeline, clips: [], diag,
    ...(ringing && { alarm: { at: ringing.at, early: ringing.early } })
  }
}

// A night's times put right by hand ("HH:MM"; `on` may be blank). Bed is on the night's evening;
// asleep and awake come after it, the next day if need be (up at 12:30 after a 23:00 bed).
// Untouched, the analysed minutes stand; changed, the sleep is counted from the new times.
const after = (ms, from) => { const d = new Date(ms); while (d.getTime() < from) d.setDate(d.getDate() + 1); return d.getTime() }
export function corrected(night, t) {
  if (!t.bed || !t.wake) return { error: 'Going to bed and waking up need a time.' }
  const bed = atClock(night.id, t.bed)
  const wake = after(atClock(night.id, t.wake), bed + 60000)
  const on = t.on ? after(atClock(night.id, t.on), bed) : null
  if (on != null && on > wake) return { error: 'Falling asleep has to be between going to bed and waking up.' }
  if (bed === night.bed && wake === night.wake && on === (night.on ?? null)) return { night }
  return { night: { ...night, bed, on, wake, asleepMin: Math.max(0, Math.round((wake - (on ?? wake)) / 60000 - (night.awakeMin || 0))) } }
}
