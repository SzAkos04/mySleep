# Leaving the web app: mySleep Night takes over (plan, 2026-10-29)

Today the iPhone has two apps: mySleep Night (native, ios/) records the night and rings the alarm;
the web app (frontend/) turns the night into a record, scores it, shows the Journal and Trends
(also inside the native app, as web views), holds the settings, pairs the phone and sends
reminders. This plan moves all of that into the native app, one step at a time, until the web
frontend can be deleted. Each step is small, starts with a failing test, and ships on its own;
the web app keeps working until the last phase.

## Ground rules

- **The server stays.** It is the backup and the history: a reinstall or a new phone pulls every
  night back. Only the web *frontend* goes. Data does not migrate; the native app syncs the same
  records (`POST /api/sync`) the web app does.
- **The night's rules are not rewritten.** `analysis.js`, `score.js`, `stats.js`, `night.js`,
  `time.js` and `native.js` already run in the app through JavaScriptCore (`Analysis.swift` loads
  `analysis.js`). They become one bundle the app loads, so both apps judge and score a night the
  same way and their 30+ tests keep covering both. A Swift rewrite is possible later, but only
  if JavaScriptCore ever becomes a problem (it has not: a night is summarised once).
- **What a free Apple ID cannot do** shapes the plan: no APNs push (so reminders become local
  notifications), no Associated Domains (so no passkeys in the app: pairing stays a token), no
  iCloud (the server is the backup).
- **Night records stay JSON dictionaries in Swift**, with typed accessors for what the screens
  read. The web's shape is the contract; new fields pass through without a Swift change.
- **Test-driven, every step** (CLAUDE.md). Where tests go:
  - server: `api/test/server.test.js`, a real server on a temp DATA_DIR;
  - the rules: `frontend/src/lib/*.test.js` (later `shared/`);
  - Swift logic (store, sync, screen models): `ios/NightKit/Tests`;
  - JS and Swift agreeing: golden files written by node, read by the Swift tests;
  - screens: a NightKit model per screen with its strings and numbers tested, plus a Simulator
    check against the web screen side by side. What only the phone shows is said in the report.

## Order, and why

| # | Step | Why this early | Size |
|---|---|---|---|
| 0.1 | Device token may sync | everything after needs the app to read and write nights | S |
| 0.2 | The rules as one bundle | the app must score nights as the web does | M |
| 0.3 | Store and sync logic in Swift | nights on the phone, offline first | M |
| 0.4 | Sync in the app | the history arrives, edits go up | M |
| 1.1 | The app makes its own night | a new night no longer needs the web to exist | S |
| 2.1 | Night report | opened every morning | L |
| 2.2 | Correct the times, delete | the report's only actions | S |
| 2.3 | Journal | the next most used | M |
| 2.4 | Trends | weekly at most | M |
| 3.1 | Settings in the synced record | bedtime and alarm survive a reinstall | S |
| 3.2 | Bedtime reminder, local | today it is a web push to the PWA | S |
| 3.3 | Reinstall reminder, local | same | S |
| 4.1 | Pairing without the web | the last thing the web is needed for | S |
| 2.5 | Old clips | old nights only; the app records none | S |
| 5 | Retire the web | when 5.1 holds for a week | M |

## Phase 0: groundwork

### 0.1 A device token may sync *(done)*
`POST /api/sync` accepts `Authorization: Bearer <device token>` as the debug upload does, so the
app reads and writes the paired profile's nights and settings.
- Tests first (api): sync with the token returns the profile's changes and stores a pushed one;
  a wrong or unknown token is 401; a session still works; one profile's token never sees another's
  nights.
- Done when: `curl -H "Authorization: Bearer …" -d '{"since":0,"changes":[]}'` returns every night.

### 0.2 The rules as one bundle for the app
A build script (`frontend/scripts/build-rules.mjs`, esbuild from the installed Vite) bundles one
entry, `lib/rules.js`, re-exporting `nightFromLog`, `sleepScore`, `insights`, `summary`,
`alarmPlan`, `nightIdOf`, `dur`, `clockOf` and the analysis, into an IIFE `MySleepRules`, written
to `ios/MySleepNight/rules.js` in place of the copied `analysis.js`. `scripts/test.sh` builds it
before the iOS tests, so it is never stale.
- Tests first: `frontend/scripts/golden.mjs` turns fixture logs (a quiet night, a tossing one, a
  smart-alarm one, an empty one) into `ios/NightKit/Tests/Fixtures/golden.json`: night record,
  score, parts, insights. A NightKit `RulesTests` loads the bundle and must produce the same; it
  fails until the bundle exists. `Analysis.stirring` moves onto the bundle with its tests unchanged.
- Done when: both test suites green, and the app still rings the smart alarm off the bundle.

### 0.3 Store and sync logic in Swift (NightKit)
A `NightStore` value: `nights` (id → JSON), `settings`, `rev`, `dirty`, as `store.js` holds them.
`pendingChanges`, `mergeRemote` and `stillDirty` ported from `sync.js` as pure functions.
`save` marks dirty, `delete` leaves a tombstone, newest `ts` wins. Persisted as one JSON file in
Application Support, written atomically.
- Tests first: every case in `sync.test.js` and `store.test.js`, one for one; a file round trip; a
  half-written file is never what loads.

### 0.4 Sync in the app
When: at launch, on coming to the foreground, after a night, 0.8 s after an edit, every 60 s while
open; offline, again in 30 s; a 401 means the pairing is gone (Settings says so). The *when* and
the outcome (synced, offline, server error, unpaired) are a NightKit `SyncPlan` over a fake
transport; `ServerLink` only does the HTTP.
- Tests first: the schedule; a failed push keeps the edits dirty; an edit made during a push
  stays dirty; 401 stops retrying; the first sync from `rev 0` pulls everything.
- Simulator: pair against the local API (`scripts/dev-local.sh`) and see the night count match.

## Phase 1: the night lands in the app

### 1.0 Done on the way: logs reach the server whole
A log is saved every minute under one name; the uploader now remembers name *and version*, so the
finished log goes up even if a partial one did earlier (it did not before), a night iOS cut short is
finished at launch (`Night.recovered`), and logs the server has are deleted from the phone after
30 days. The server's copy is the history this plan relies on.

### 1.1 The app makes its own night
At the end of a night, `MySleepRules.nightFromLog` makes the record, the store saves it, sync sends
it. The log upload stays (diagnostics), but turning it into a night stops being the web's job.
- Tests first: NightKit, a fixture log → the same record as the golden file; JS, a night the app
  already synced (source `native`, same `bed`) is not imported again by `toImport` (holds today:
  keep it as a test).
- The morning summary then shows the score from the local night, not only the times.

## Phase 2: the screens, by how often they are opened

Each screen gets a NightKit model (strings and numbers, tested against the web's
`screens.test.jsx` and `taps.test.jsx` cases for the same seeded nights) and a thin SwiftUI view,
in the app's style and motion. Charts use Swift Charts (built in); the night's picture is one
`Canvas` draw.

### 2.1 Night report
The morning's page and any night's: date and time in bed; the score ring with its verdict; three
numbers (asleep, to fall asleep, restful); the night as a picture (awake / light / restful bands
and the sounds); "How the score adds up" (the parts); the insights; events with times. "See your
night and score" opens this instead of the Journal web view.
- Tests first: `ReportModel(night, settings, week)` for the seeded nights: score, verdict, the
  three numbers, the parts, the insights, an unrecorded night ("Nothing recorded").

### 2.2 Correct the times, delete
A sheet with bed, asleep and wake times; delete with a confirmation. *(The rule is done:
`lib/night.js` `corrected()`, tested, used by the web sheet; the app calls it through the bundle.)*
- Tests first: NightKit, delete leaves a dirty tombstone and the Journal no longer lists it; the
  app's sheet gives `corrected()` the same cases as `night.test.js`.

### 2.3 Journal
The month calendar coloured by score, previous and next month (never past this one), a day opens
its night, last night chosen at first, the month's average and count.
- Tests first: `MonthModel` (the grid from Monday, colours by score band, blank for unrecorded
  nights, "No nights this month", next disabled on this month).

### 2.4 Trends
Week, month, year: the average score and its change on the period before, asleep a night, short
of 8 h in all, asleep ± and awake ±; score per night, hours asleep against 8 h, when you slept,
snoring.
- Tests first: `TrendsModel` over `MySleepRules.summary` with the web's Trends cases.
- After 2.3 and 2.4 the web views are unused in the app: `WebTab`, `WebPage`, the sign-in codes
  go (their tests with them).

### 2.5 Old clips (last, optional)
Nights from the web's own tracking have sound clips; the app records none. Playing them needs
`GET /api/clips/…` to take the device token (api test first), then a play button on the report's
events. The Settings "clips" switch goes: nothing records clips any more.

## Phase 3: settings and reminders on the phone

### 3.1 Settings in the synced record
Bedtime, wake, alarm, smart and reminder live in the store's `settings` (synced as
`settings:main`), not only in `@AppStorage`; on first run the AppStorage values move in unless
the server's are newer.
- Tests first: the merge (newer `ts` wins), the first-run move, the Sleep link still setting them.

### 3.2 Bedtime reminder as a local notification
Daily at bedtime − 30 min, rescheduled when the settings change, off with the switch. The server
stops sending its web push for it in phase 5.
- Tests first: `ReminderPlan(settings)` → the notification's time and text; off → none.
- Phone only: that it fires.

### 3.3 Reinstall reminder as a local notification
Scheduled at each launch from `Provisioning.expiry`: two days before, the last day, after; 9:00.
The stages and texts as `api/reminders.js` has them.
- Tests first: the same cases as the api's reminder tests, in NightKit.
- Phone only, and needed before phase 5: whether a notification scheduled by an app whose
  signature has run out still arrives. If not, the last-day reminder is the one to rely on.

## Phase 4: pairing without the web

### 4.1 A pairing link from the server
`api/scripts/pair.mjs <profile>` (run with `docker compose exec api`) makes a device token and
prints the `mysleepnight://pair?…` link; `scripts/pair.sh` runs it over SSH from the Mac. Tap the
link on the phone (Notes, Messages). The token is in the Keychain, which survives the weekly
reinstall, so this is rare.
- Tests first (api): the script's function makes a working token for the named profile and refuses
  an unknown one.
- Settings, when the token is refused: "Pairing lost: run scripts/pair.sh on the Mac".

## Phase 5: retire the web

### 5.1 Before
A week on the native app alone: every new night on the server, the history on the phone matching
the server's, both reminders arriving, a reinstall keeping pairing and nights.

### 5.2 Remove
- `frontend/`: the views, components, store, PWA files. The rules (`lib/*.js` and their tests)
  move to `shared/`, still bundled into the app and tested by node.
- `web/`: no frontend build; nginx stays as the `/api` proxy behind Tailscale (least change).
- Server: the sign-in code exchange, passkey registration and login (and `@simplewebauthn`),
  sessions, Web Push (and `web-push`), the push reminders. Sync, devices, debug logs and backups
  stay. RP_ID stops mattering here; myGym keeps it.
- Back up `data/` first; nothing in it changes shape.

### 5.3 After
`scripts/test.sh` runs shared, api and iOS tests; CLAUDE.md and MVP.md describe one native app
and a server.

## Not ported

The web's own night tracking (gone already), Today (Tonight is it), the sign-in page (pairing is
it), Web Push (local notifications are it).
