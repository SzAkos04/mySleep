// What mySleep Night (ios/) runs of this app's night logic, as one script: scripts/build-rules.mjs
// bundles this file into ios/MySleepNight/rules.js (global `MySleepRules`), which the app runs in
// JavaScriptCore. So both apps judge, score and summarise a night the same way, and the tests
// here cover both. Add what a native screen needs here, then rebuild (scripts/test.sh does).
export { stirring } from './analysis.js'
export { nightFromLog, takeIn, toImport } from './native.js'
export { corrected } from './night.js'
export { defaultSettings, pendingChanges, withNight, withoutNight, withSettings, afterSync } from './sync.js'
export { sleepScore, insights, unrecorded } from './score.js'
export { summary, noonToClock, fromNoon } from './stats.js'
export { reportView, journalView, trendsView, startMonth, tone } from './views.js'
export { atClock, clockOf, dayLabel, dur, nightIdOf } from './time.js'

// Numbers rounded and keys sorted, so node and JavaScriptCore print a result the same way
// (the golden test compares them as strings).
export const canonical = v => JSON.stringify(v, (k, x) => typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : 1)) : x)
