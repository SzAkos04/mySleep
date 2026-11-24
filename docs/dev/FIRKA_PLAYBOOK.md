# What firka-ios can teach mySleep

A brief for the agent working on `~/Projects/mySleep`. It comes from `~/Projects/firka-ios`, a SwiftUI KRÉTA client built test-first in November 2026, and from a read-only look at mySleep on 2026-11-23. Nothing in mySleep has been changed.

**Decided by the user (2026-11-23): the JavaScript in mySleep is to be rewritten in Swift, because the app is very slow this way.** You don't need to ask whether to do it, only to report how it goes.

**How to use it.** Read the whole brief. Check each claim about mySleep against the code: it was true on 2026-11-23 and the code moves. mySleep's own `CLAUDE.md` still rules over this brief:

- work on `dev`;
- the pre-commit hook runs the tests;
- deploy only when the user says so;
- UI text is in English.

---

## 1. Why mySleep feels unfixable

| What | Where | Cost |
|---|---|---|
| The night rules are JavaScript (670 lines, 735 lines of tests) that **only the iOS app runs**, inside JavaScriptCore. The API does not import `shared/`, so this is left over from the web app retired on 2026-10-30. | `shared/lib/*.js` → generated `ios/MySleepNight/rules.js` | Two languages and two test runners for one feature. You need Node and npm to build an iOS app, and Homebrew's npm 10 crashes on this tree. |
| The app's whole state is a **JSON string**. Each call builds JavaScript source with the full state inlined as a literal and evaluates it. | `NightStore.withState`, `Rules.evaluate` | Nothing is typed. Errors show up only at runtime. The whole state is re-parsed on every call. Results come back as strings, and the test compares strings (`RulesTests`). |
| A generated bundle plus `golden.json` have to stay in step. | `npm run build:rules`, `rules.test.js` | Every rule change needs a rebuild step that is easy to forget. |
| **No UI tests at all.** Screens are checked by hand in the Simulator. | no UI test target | A button that does nothing, a screen that crashes or a colour that vanishes in dark mode is caught by nobody. |

firka-ios has none of these. The phone runs one language: the logic is plain Swift functions with no UI, and the views only call them. That is the main thing to carry over.

## 2. Target shape

```
ios/NightKit/        all the night logic in Swift, pure (input → output), Swift Testing tests beside it
ios/MySleepNight/    views that only lay out what NightKit returns; app wiring
ios/...UITests/      XCUITest in a demo mode (new)
api/                 stays JavaScript: it doesn't use the rules; keep its node:test suite
shared/              gone, once every module is ported (or kept only for something the API really shares)
```

The state becomes a typed `Codable` struct, saved as JSON on disk but never passed around as a string. The tuning constants in `analysis.js` become named Swift constants, still treated as knobs.

## 3. The migration, one module at a time, never broken in between

Use the JS as an oracle while you port, then delete it.

**Measure first.** The reason for this work is speed, so prove it:

- Before touching anything, time what the user feels on the phone's build in the Simulator:
  - opening each screen with a year of nights;
  - recording a night;
  - a sync.
- Write those times down, and time how long one `evaluate(` call costs with the real state inlined.
- A test already says "a year of nights answers a screen in well under 100 ms". Keep it, and tighten the bound as modules move to Swift.
- Report before and after numbers to the user.

1. **Order.** Start with leaves and finish with what depends on everything:
   - `time`
   - `night` / record
   - `analysis`, using `replay.mjs` and the real-night fixtures
   - `score`
   - `stats`
   - `views` (the screens' wording and numbers)
   - `sync` reducers
   - `demo`
2. **For each module:**
   1. Port its `*.test.js` cases to Swift Testing in NightKit first. Add a stub so they compile, and watch them fail for the expected reason. This is the TDD rule as practised in firka-ios.
   2. Port the code until they pass.
   3. Add a temporary **parity test**: run the same fixtures through the JS bundle (the existing `Rules` bridge) and through Swift, and compare typed values with a tolerance. Do not compare strings. The JS side rounds to 1e-6 (`canonical`) and the fixtures use UTC local time, so mind number rounding, time zones and `Int64` ms against `Date`.
   4. Switch the callers in the app to the Swift version.
   5. Delete the JS module, its test and the parity test.
3. **Done means:**
   - nothing imports JavaScriptCore;
   - `rules.js`, `golden.json` and `build:rules` are gone;
   - `scripts/test.sh` runs the API tests, `swift test` and the new UI tests;
   - the iOS build needs no Node.
4. **Order of risk.** Sync is the one that loses data if wrong. Port it last, and add tests for:
   - a phone ahead of the server's revision;
   - a phone behind it;
   - a restored backup;
   - two writes racing.

   The recent commits fixed exactly these cases, so turn each of those fixes into a test.

## 4. Testing setup to copy, with the firka-ios file to read

- **Unit tests hosted in the app** (Swift Testing, `FirkaTests/`). Tests that touch shared state (keychain, UserDefaults, files) go in one serialized suite: `@Suite(.serialized) enum Global {}`. Each class suite saves that state in `init` and restores it in `deinit` (`FirkaTests/StorageTests.swift`).
- **The test host stays idle.** When `XCTestConfigurationFilePath` is set, the app shows `Color.clear`, does not sync, and clears preferences that UI tests leave behind on the same simulator. A UI test's rename once broke three unit tests (`Firka/FirkaApp.swift`).
- **Network against a fake server.** A `URLProtocol` stub is registered globally. It has routes, a log of `requests` and `Reply(status, body)`, and covers retries, 401 then renewal, parallel renewals, and logout mid-request (`FirkaTests/Stub.swift`, `NetworkTests.swift`, `SyncTests.swift`). For mySleep's `ServerLink` this checks the phone's side; the API's own tests stay as they are.
- **UI tests in a demo mode** (`FirkaUITests/FirkaUITests.swift`, `Firka/Store.swift` DEBUG block):
  - `FIRKA_DEMO=1` starts clean. It deletes the token, resets every preference a test can change, loads fixed demo data, and **turns UIKit animations off**, so XCUITest stops waiting for each transition.
  - Variants are switched by the env value, for example `FIRKA_DEMO=noClassAverages`. Then one test checks both "with" and "without" optional data, relaunching the app inside the test.
  - Tapped elements get an `accessibilityIdentifier`.
  - `shows(e)` checks `exists` before `waitForExistence`, because XCTest's waits look only once a second. `wait(q, count:)` likewise checks once before waiting.
  - mySleep already has `demo.js` and `mysleepnight://` links. A seeded `nights.json` plus a demo env gives it the same thing.
- **Light and dark mode:**
  - `testContrastInLightAndDarkMode` runs `performAccessibilityAudit(for: .contrast)` on every main screen with `XCUIDevice.shared.appearance` set to `.light`, then `.dark`. It ignores "nearly passed" (iOS's own greys), disabled controls and rows under the tab bar, and resets the appearance in a teardown block. Its first run found four real bugs.
  - `FirkaTests/ColorTests.swift` computes the WCAG contrast of our own colour pairs in both modes, including the Live Activity, which UI tests cannot reach.
- **Proving the tests catch bugs.**
  - Mutation runs: break a rule on purpose and confirm a test goes red. In firka-ios 10 of 10 mutations were caught.
  - Coverage: `xcodebuild -enableCodeCoverage YES` plus `xccov`. firka-ios went from 21% to 80%. What is left uncovered on purpose (ActivityKit, BGTask, the real server) is named in the docs.
- **Speed** (the user cares; a full run used to heat the laptop):
  - Keep build products in a gitignored `build/` between runs instead of a temp dir.
  - Do not run UI tests on parallel simulator clones: the CPU hit 100% for about 10% gain.
  - With animations off and immediate checks, the UI tests went from 157 s to 85 s, and the whole script from about 190 s to about 100 s.
  - `FAST=1` runs unit tests only.
- **The user's working rule:** write the test first, then run only that suite while iterating. Run the full script for bigger changes and before a commit or a phone install, not after every small edit.

## 5. Live Activity lessons (mySleep has `LiveCardController`)

- An activity can be **started only while the app is in the foreground**.
- iOS will not start one that is already stale. It can only update a running one to stale.
- The headline is out of date as soon as a boundary passes while the app is not running, and a free Apple ID cannot use push updates.
  - So give each state a `staleDate`.
  - Design a **passive view** from elements that update themselves: `ProgressView(timerInterval:)` and `Text(timerInterval:)`. firka-ios shows one column per lesson with a short name, a self-filling bar and the room.
- **The lock screen gives the activity `.dark` in light mode too.**
  - The app passes the phone's appearance in the content state, read from its window scene.
  - The view sets `.environment(\.colorScheme, …)` and the background tint from it.
  - Two catches:
    - a tinted near-white background gets its hue amplified into a coloured glass, so use pure white and black;
    - `activitySystemActionForegroundColor` tints the whole card.
- The system `ProgressView` track is near black on a dark card, so put a track of your own under it.
- Add DEBUG env hooks to see every state in the Simulator (`FIRKA_ACTIVITY_DEMO=1 | break | stale` in `Firka/LiveActivity.swift`).
- Keep state logic in the shared `ContentState` extension (`next`, `inBreak`, `held`, `sameContent`) so it can be unit tested.

## 6. Process habits that held up

- A short `CLAUDE.md` with numbered test rules. Add a rule whenever a class of bug slips through: rule 8, light and dark mode, came from such a miss.
- Logic in UI-free functions (`TimetableNav`, `Notifier.changes`, `HomeLogic`, `GradesLogic`): the views only call them. Most UI bugs became unit tests this way.
- Personal settings stay out of git (`Config/Local.xcconfig`, `scripts/renew.local.sh`). Before each commit, scan the staged diff for the device id, team id and e-mail.
- Commits use the owner's identity with no co-author lines. Commit messages say what changed and why.
- The free-account renewal (`scripts/renew-on-iphone.sh`, launchd at 9:00 and 19:00, run with `--force` to install):
  - It moves old profiles aside so Xcode fetches fresh 7-day ones, and puts them back if anything fails.
  - If Xcode is signed out ("No Accounts"), the build still works with the existing profiles until they expire. Tell the user to sign in again.

## 7. Suggested first session in mySleep

1. Confirm the diagnosis:
   - `grep -rn shared api/` should be empty;
   - list every `evaluate(` call site.
2. Take the "before" timings (section 3). Tell the user the target (section 2) and the order (section 3) in a few lines. The rewrite itself is already decided.
3. Port `time` end to end as the pattern: Swift tests → red → code → parity test → switch callers → delete the JS.
4. Add the UI test target with a demo env and a first test that opens every tab, plus the light/dark contrast audit.
5. Keep `scripts/test.sh` green at every commit. Say plainly what only the iPhone can verify (microphone, alarm, lock screen).
