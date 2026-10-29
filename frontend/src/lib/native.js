// mySleep Night (ios/), the native app, records the night: the web app opens it from Sleep, pairs it
// with this server, turns the logs it uploads into nights, and says when it needs reinstalling
// (a free Apple ID signs it for 7 days). The night's analysis stays this app's: nightRecord.
import { nightRecord } from './night.js'

const q = o => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
export const sleepLink = s => 'mysleepnight://sleep?' + q({ alarm: s.alarm ? 1 : 0, smart: s.smart ? 1 : 0, wake: s.wake })
export const pairLink = (server, token) => 'mysleepnight://pair?' + q({ server, token })

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

// Runs when the app opens. A log that does not come now is tried again next time.
export async function importNative({ get, nights, save }) {
  let done = 0
  for (const l of toImport(await get('/api/debug'), nights)) {
    try { save(nightFromLog(await get('/api/debug/' + l.night))); done++ } catch {}
  }
  return done
}

// For Today: is mySleep Night paired, and how long until it stops?
export function expiryNote(devices, now = Date.now()) {
  const d = devices.find(x => x.name === 'mySleep Night') ?? devices[0]
  if (!d) return { level: 'unpaired' }
  if (!Number.isFinite(d.expires)) return { level: 'unknown' }
  const days = Math.round((new Date(d.expires).setHours(12, 0, 0, 0) - new Date(now).setHours(12, 0, 0, 0)) / 864e5)
  const level = d.expires <= now ? 'expired' : days === 0 ? 'today' : days <= 2 ? 'soon' : null
  return level && { level, until: d.expires }
}
