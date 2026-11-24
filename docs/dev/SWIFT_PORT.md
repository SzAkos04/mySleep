# The night rules from JavaScript to Swift (2026-11-23/24)

What was done, why, and what is left: the record of a session started from firka-ios, so the
conversation itself can go. The brief it worked from: `~/Projects/firka-ios/MYSLEEP_PLAYBOOK.md`.

## Why

The user decided on 2026-11-23: the app is slow, the JavaScript goes. Before, the iPhone app ran the
night rules (`shared/lib`, 670 lines + 735 lines of vitest tests) as one bundle (`ios/MySleepNight/rules.js`)
in JavaScriptCore, and `NightStore` kept the whole state as a JSON string, inlined into a new script on
every call. The API never imported `shared/` (a leftover of the web app retired 2026-10-30). An app's
JavaScriptCore on the iPhone has no JIT.

## Before the work started

Another session ("Self-hosted sleep tracker app") had 29 uncommitted files on `dev` (a demo mode,
`shared/lib/demo.js`, a first UI test, `Jerk.swift` deleted, `alarm-piano.wav` moved, screen and Live
Activity edits). The user stopped it and chose to discard them; they were reset to 0fc2365. A patch of
them was kept only in that session's scratchpad (temporary, may be gone).

## Commits (dev, then main)

| commit | what |
|---|---|
| ab00bdb | The rules in Swift beside the JS, the JS tests ported to Swift Testing, a temporary JS/Swift parity test |
| 8945ccd | The app switched to Swift; typed `NightState`; JavaScriptCore, `shared/`, `rules.js`, `golden.json`, `build:rules` deleted; `night-tool` |
| 48d7d27 | `MySleepNightUITests` in a demo mode, contrast audit in light and dark mode; `scripts/test.sh` runs them |
| 8b739a4 | `ScaleTests` bound back to 100 ms (20 ms failed once on GitHub's slower macOS runner) |

`main` = `dev` = 8b739a4. Deployed 2026-11-24 05:12 (server at 48d7d27: the later commit is a test
only); the server's `data/` was backed up first: `csodabogar2:~/backups/mysleep-data-20261124-051139.tar`.
Installed on the iPhone 2026-11-24, build 202611240620, signed until Tue 1 Dec 05:20.

## Where things are now (ios/NightKit/Sources/NightKit)

- `Record.swift`: `NightRecord` (a night; unknown fields kept in `extra`, so nothing older is lost when
  saved or synced again), `Timeline`, `NightLog` (the app's log), `JSONValue`, `JS` (JavaScript's
  rounding and number printing, where the words depend on it).
- `Clock.swift` (was time.js and the clock half of stats.js), `Analysis.swift` (analysis.js: the knobs
  are named constants), `RecordRules.swift` (night.js, native.js: `NightRecord(log:)`, `takeIn`,
  `corrected`), `Score.swift` (score.js, stats.js `summary`), `Views.swift` (views.js, on `NightState`),
  `Sync.swift` (`NightState`, `Change`, sync.js reducers), `Demo.swift` (`NightState.demo`).
- `NightStore.swift`: holds `NightState`; `load(from:)` moves an unreadable file aside
  (`nights.unreadable-<ms>.json`) instead of writing over it; `sync` as before.
- The app: `NightData` saves the 2 MB state off the main thread, in order, and waits for it when the app
  goes to the background (`flush`). `NightEngine` uses `Clock.nightId` and `Analysis.stirring`.
- `ios/NightKit/Tools` (`night-tool`): `analyse <log.json>` (the analysis again on a log; `scripts/night-report.mjs`
  calls it) and `replay <file.wav>` (replaces replay.mjs, reading audio with the app's own code).
  `scripts/night-report.mjs` and `scripts/loud-alarm.mjs` moved out of the deleted `shared/scripts`.
- CI: the `shared` job became `nightkit` (`swift test` on macos-latest).

## How it was checked

- Every JS test ported; mutation runs (8 rules broken on purpose) found 3 no test caught (three snores in
  a row, an equally long restart, the noon boundary): each has a test now.
- Parity, before the JS was deleted: synthetic nights, the fixture, the real-night hours, every screen of
  a 400-night state, corrections, and the Mac's 31 real night logs (`debug/`) gave equal typed values in
  JS and Swift, in Budapest, New York, Tokyo, UTC and Sydney time. No tolerance was needed.
- Sync tests from the recent fixes: a phone behind the server, a server restored from a backup (behind
  the phone), writes racing while a request is out, a reply that is not JSON.
- Simulator: a `nights.json` written by the old JS app (22 real nights) opened on every screen and synced
  both ways with `scripts/dev-local.sh` (44 nights each side, rev 107). The local `data/` now holds them.
- UI tests (demo mode): every tab opens, a report opens from the Journal and goes back, the Journal's
  months, the Trends periods, and `performAccessibilityAudit(for: .contrast)` on every tab in light and
  dark mode. The audit flags the calendar's lone "T" however bright it is (Theme.text2 on the card is
  6.7:1; white at 80% only "nearly passed"): one-letter labels are skipped. A darkened `text2` fails it.
- `scripts/test.sh`: API tests, 162 NightKit tests, 5 UI tests, about a minute. `FAST=1` skips the UI tests.

## Speed

Before (JS, Debug, Mac / Simulator, 2 MB state = 1100 nights ≈ a year): a screen 6-13 ms, one
`evaluate` with the state inlined 6 ms, launch 18-20 ms, a recorded night 40-68 ms, a sync 13 ms; and the
iPhone has no JIT. After (Swift): a screen 1-2.5 ms optimised (about 10 ms in Debug); an 8 h night
analysed in about 10 ms optimised; saving the 2 MB state about 80 ms and loading it 60 ms on the Mac,
off the main thread. Not measured on the iPhone.

## Not verified (only the iPhone can)

The microphone through a night, the smart alarm and the system alarm, the lock screen and the Live
Activity, notifications, and the real speed on the phone. Record a night with this build and look at the
morning, the report and `scripts/ios-fetch-night.sh`.

## Open

- The pre-commit hook runs the tests on the working tree, not on what is staged: a commit missing files
  passed once (it was amended before the push).
- The API refuses more than 1000 changes in one sync; after a backup is restored the phone sends every
  night again, so over 1000 nights that sync would keep failing.
- From the brief, not done: a Live Activity demo hook and its own colour test (UI tests cannot reach it),
  a coverage run, a `ColorTests` for the Theme's own colour pairs.
