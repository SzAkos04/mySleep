// The night's decisions, apart from the screen that shows them (views/Tracking.jsx): when the
// alarm rings, what a finished night saves, snooze, and the words on the night screen.
import { summarize } from './analysis.js'
import { clockOf, nextAt } from './time.js'

export const SMART_MIN = 30    // the smart alarm may ring this much before the wake time
export const SNOOZE_MIN = 9

// When tonight's alarm rings: { at, from }, `from` opening the smart window (never in the past).
export function alarmPlan(settings, from = Date.now()) {
  if (!settings.alarm) return null
  const at = nextAt(settings.wake, from)
  return { at, from: settings.smart ? Math.max(from, at - SMART_MIN * 60000) : at }
}

// Checked every few seconds: the wake time, or the smart window once the sleeper stirs.
// `isStirring` reads the last minute of sound; it is only asked inside the window.
export function shouldRing(now, tr, isStirring) {
  if (!tr.ringAt) return false
  if (now >= tr.ringAt) return true
  return !!tr.smart && now >= tr.ringFrom && isStirring()
}

export function snoozePlan(tr, now) {
  const ringAt = now + SNOOZE_MIN * 60000
  return { tracking: { ...tr, ringAt, smart: false }, backupAt: ringAt + 60000 }
}

const times = (n, what) => `${what} ${n === 1 ? 'once' : n + ' times'}`
export function heardLabel(evs) {
  const c = k => evs.filter(e => e.kind === k).length
  const said = [c('snore') && 'snoring', c('talk') && times(c('talk'), 'talked'), c('cough') && times(c('cough'), 'coughed')].filter(Boolean)
  return said.length ? said.join(' · ').replace(/^./, x => x.toUpperCase()) : 'Quiet so far'
}

export const windowLabel = (tr, sep = ' – ') => !tr.ringAt ? null : tr.smart ? clockOf(tr.ringFrom) + sep + clockOf(tr.ringAt) : clockOf(tr.ringAt)

// The page was closed in the night: listening stopped after the last second it saved.
export const stoppedAt = samples => samples.start + samples.db.length * 1000

export const micErrorMessage = e => e?.name === 'NotAllowedError'
  ? 'mySleep needs the microphone. Allow it in Settings › Safari › Microphone, then try again.'
  : 'The microphone did not start: ' + e?.message

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
