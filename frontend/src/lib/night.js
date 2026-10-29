// The night's rules that stay the web app's: tonight's alarm plan (shown on Today and passed to
// mySleep Night by the Sleep link), and the night record made from the samples (lib/native.js turns
// mySleep Night's logs into nights with it).
import { summarize } from './analysis.js'
import { nextAt } from './time.js'

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
