// mySleep Night (ios/) records the night and keeps its log; this turns a finished log into the night
// it holds (the analysis is nightRecord's).
import { nightRecord } from './night.js'

// What went wrong in the night, as mySleep Night logs it (ios/MySleepNight/NightEngine.swift).
export function nativeSummary(events) {
  const c = t => events.filter(e => e[1] === t).length
  return {
    app: 'native', events: events.length,
    interruptions: c('interruption-began'),
    restarts: events.filter(e => e[1] === 'audio' && e[2]?.reason !== 'start').length,
    micSilent: c('mic-silent'), recoveries: c('recover'), stalls: c('stall'),
    locked: c('locked'), memoryWarnings: c('memory-warning')
  }
}

export function nightFromLog(log) {
  const s = log.samples, at = ms => log.start + ms
  const samples = { start: s.start, db: s.db.map(v => v ?? NaN), low: s.low, mid: s.mid, vr: s.vr, at: s.at }
  const finish = log.events.find(e => e[1] === 'finish')
  const rang = log.events.find(e => e[1] === 'ring' || e[1] === 'alarm-ringing')
  const wake = log.events.find(e => e[1] === 'wake')
  const ringing = rang && { at: at(rang[0]), early: wake?.[2]?.early ?? rang[2]?.early ?? 0 }
  const end = finish ? at(finish[0]) : at(s.db.length * 1000)
  return { ...nightRecord({ tr: { nightId: log.night }, samples, end, ringing, diag: nativeSummary(log.events) }), source: 'native' }
}

// The app's finished nights not here yet. Never over a night of another source or one deleted
// here; a later night from the app under the same date replaces the earlier one.
export const toImport = (logs, nights) => logs.filter(l => {
  if (l.app !== 'native' || !l.final) return false
  const have = nights[l.night]
  return !have || (!have.deleted && have.source === 'native' && have.bed !== l.start)
})

// The night mySleep Night makes of one of its own finished logs (null: nothing to make), by the
// same rule as toImport, so the app and the web app do not make it twice.
export const takeIn = (log, nights) => toImport([{ app: 'native', final: !!log.final, night: log.night, start: log.start }], nights).length ? nightFromLog(log) : null
