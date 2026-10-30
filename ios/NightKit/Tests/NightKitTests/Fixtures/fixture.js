// A fixed night and what the rules make of it, run by node (shared/scripts/golden.mjs writes
// golden.json) and by NightKit's RulesTests in JavaScriptCore, after ios/MySleepNight/rules.js.
// Both must print the same: that is what "both apps judge a night the same way" means.
// The rules read the clock in local time (clockOf, fromNoon, atClock ...). The process's time zone
// is fixed by whichever test touches it first, so here local time is made UTC, the same way in
// node and in JavaScriptCore: the golden file does not depend on the machine.
(function () {
  const D = Date
  function UTCDate(...a) { if (!new.target) return D(); return a.length > 1 ? new D(D.UTC(...a)) : new D(...a) }
  UTCDate.prototype = D.prototype; UTCDate.now = D.now; UTCDate.UTC = D.UTC; UTCDate.parse = D.parse
  for (const k of ['FullYear', 'Month', 'Date', 'Day', 'Hours', 'Minutes', 'Seconds', 'Milliseconds']) {
    D.prototype['get' + k] = D.prototype['getUTC' + k]
    if (k !== 'Day') D.prototype['set' + k] = D.prototype['setUTC' + k]
  }
  D.prototype.getTimezoneOffset = () => 0
  globalThis.Date = UTCDate
})()

function fixtureLog() {
  const start = Date.UTC(2026, 9, 29, 22, 0), n = 3 * 3600
  const s = { start, db: [], low: [], mid: [], vr: [], at: [] }
  for (let i = 0; i < n; i++) {
    const toss = i < 900 && i % 20 < 2, snore = i > 7200 && i < 7500 && i % 5 < 2
    s.db.push(toss ? 45 : snore ? 41 : 30 + (i % 7) / 4); s.low.push(snore ? 0.6 : 0.3); s.mid.push(0.3); s.vr.push(1); s.at.push(toss ? 2 : 1)
  }
  s.db[100] = null
  return { night: '2026-10-29', start, final: true, env: { app: 'native' }, samples: s,
    events: [[0, 'start'], [3600e3, 'interruption-began'], [3610e3, 'audio', { reason: 'interruption-ended' }], [2.5 * 3600e3, 'wake', { early: 12 }], [2.5 * 3600e3 + 2000, 'alarm-ringing'], [n * 1000, 'finish']] }
}
function goldenOutputs() {
  const R = MySleepRules, settings = { bedtime: '23:00', wake: '06:45', alarm: true, smart: true }
  const night = R.nightFromLog(fixtureLog())
  return {
    night: R.canonical(night), score: R.canonical(R.sleepScore(night, settings)), insights: R.canonical(R.insights(night)),
    summary: R.canonical(R.summary([night], 480)), plan: R.canonical(R.alarmPlan(settings, Date.UTC(2026, 9, 29, 22, 0))),
    corrected: R.canonical(R.corrected(night, { bed: '22:00', on: '22:20', wake: '00:45' })),
    labels: R.canonical([R.dur(125), R.clockOf(Date.UTC(2026, 9, 29, 22, 5)), R.dayLabel('2026-10-29'), R.nightIdOf(Date.UTC(2026, 9, 30, 5, 0))])
  }
}
