# CLAUDE.md

mySleep: a self-hosted sleep tracker and smart alarm for one iPhone: the native app mySleep Night and a
small server on the user's own machine. Built like myGym (`~/Projects/myGym`). The plan and the reasons
are in `docs/dev/MVP.md` (the first version, now partly history) and `docs/dev/NATIVE_PLAN.md` (how the
web app was retired for the native app). The file layout is in `PROJECT_STRUCTURE.md`.

## Layout

```
ios/       mySleep Night: the app (SwiftUI): Tonight (the alarm, Sleep), the night itself (record with the
           phone locked, alarm, Live Activity), the Journal, Trends, the night's report, Settings.
           NightKit/: its logic as a Swift package with tests (swift test on the Mac); MySleepNight/: the
           app; rules.js there is GENERATED from shared/ (below). Logs go up as JSON, nights sync.
shared/    The night rules in JavaScript (analysis, record, score, sentences, statistics, the sync's
           reducers, the view models of the screens), tested here with vitest and run by the app in
           JavaScriptCore as one bundle (ios/MySleepNight/rules.js). scripts/ makes the bundle and the
           golden file, replays audio, reports on a log.
api/       server.js on node:http, JSON files in DATA_DIR. No dependencies. Sync, night logs, pairing.
web/       nginx in front of the API (one address for Tailscale serve, the request-size limit).
scripts/   server-update.sh (runs on the server), test.sh, pair.sh, dev-local.sh, ios-install.sh,
           ios-fetch-night.sh, fetch-debug.sh.
```

There is no web app any more (removed 2026-10-30). The server is a backup and the history: the app keeps
its nights on the phone and syncs them (`POST /api/sync`, with the device token).

## Commands

```bash
scripts/test.sh                    # everything: shared tests, API tests, ios/NightKit tests
scripts/ios-install.sh             # mySleep Night onto the iPhone (free Apple ID: weekly, 7 days)
scripts/pair.sh                    # a link that pairs the app with the server (copied: paste it on the iPhone)
scripts/ios-fetch-night.sh         # its night logs from the iPhone into debug/ios/, with the report
scripts/dev-local.sh               # the API on http://localhost:3000 (data/), prints the Simulator's pairing link
cd shared && npm run build:rules   # after changing shared/lib: rebuilds ios/MySleepNight/rules.js and the golden file
cd shared && npm run test:watch    # vitest while writing code
cd api && npm test                 # node:test, boots server.js on a temp DATA_DIR
cd ios/NightKit && swift test      # the app's logic
```

iPhone checks: the iOS Simulator device "iPhone 11 Pro Max test". Build with
`xcodebuild -project ios/MySleepNight.xcodeproj -scheme MySleepNight -sdk iphonesimulator -configuration Debug -derivedDataPath ios/build/sim CODE_SIGN_IDENTITY=- build`,
install and launch with `xcrun simctl install/launch booted hu.szakos.mysleep.night`. Start `scripts/dev-local.sh`
and open its pairing link with `xcrun simctl openurl booted`. Start a night with
`xcrun simctl openurl booted "mysleepnight://sleep?alarm=1&smart=0&wake=HH%3AMM"`. The Simulator's microphone is a
steady tone with a click every second, never what the analysis hears; AlarmKit is always denied there.
To see the screens with a month of nights, seed `Application Support/nights.json` in the app's container.
To check audio analysis: `node shared/scripts/replay.mjs some.wav` and `docs/dev/SOUND_ANALYSIS.md`.

Use Node 22 (Homebrew `node@22`). Homebrew's npm 10 crashes resolving this tree
(`Cannot read properties of null (reading 'edgesOut')`): change dependencies with
`npx -y npm@11 install`; `npm ci` works with either.

## Branches, machines

- **Mac**: development only, on `dev`. Commit and push as you go.
- **Server** `csodabogar2` (Arch, Tailscale SSH `ssh szakos@csodabogar2`): `~/mySleep` on `main`,
  Docker only. Nobody codes there.
- **Merging `dev` into `main` and deploying happen only when the user says so** ("mergelj",
  "telepítsd"). Then: `git switch main && git merge dev && git push && git switch dev`, and
  `ssh szakos@csodabogar2 '~/mySleep/scripts/server-update.sh'`. Verify live: `/api/health`.
- Back up `data/` before touching it on the server: `ssh szakos@csodabogar2 'cd ~/mySleep &&
  docker compose exec -T api tar -C /data -cf - . > ~/backups/mysleep-data-$(date +%Y%m%d-%H%M%S).tar'`.
- `https://csodabogar2.tailbd3336.ts.net:8443` (Tailscale serve → 127.0.0.1:8081). `ORIGIN` in `.env` is that
  address: the pairing link carries it, and the server names its cookie by it.

## Test-driven (the user's rule since 2026-10-29)

Every change starts with a test, so anything can be checked for working or broken:
1. Write the test first and run it: it must fail, for the reason you expect.
2. Write the least code that makes it pass; then tidy with the tests green.
3. A bug is fixed only after a test reproduces it (it fails before the fix, passes after).
4. `scripts/test.sh` green before every commit. The pre-commit hook runs it
   (`git config core.hooksPath scripts/hooks` in a new clone); never bypass it with `--no-verify`.
   The Docker builds run the API tests too, so a failing change cannot be deployed.

Where tests go:
- What the night means (analysis, record, score, sentences, statistics, sync, the screens' wording and
  numbers): `shared/lib/*.test.js` beside the code. `views.js` decides what each screen shows; the app draws it.
  Export what the app needs from `shared/lib/rules.js`, rebuild the bundle (`npm run build:rules`);
  `rules.test.js` fails while the bundle or `golden.json` is stale.
- The app's logic: `ios/NightKit/Tests`. `RulesTests` runs the bundle in JavaScriptCore and compares a fixed
  night with node's output as strings (in any time zone: the fixture makes local time UTC).
- API: `api/test/server.test.js`, a real server on a temp DATA_DIR. Every route and its refusals.
- What only the iPhone can show (microphone, lock screen, sound, notifications): check it in the Simulator
  and say what was not verified. A failure found there gets a unit test when its cause is in code.

## Rules

- Rules about a night live in `shared/lib`, pure, with a test beside them; the app has no copy of them.
  Tuning constants in `analysis.js` are knobs: change them from real nights, not from guesses.
- The UI is English; the user writes Hungarian.
- The night (microphone, alarm) runs for real only on the iPhone; say what was not verified.
- Motion: opacity, offset, scale, numbers and symbol effects only (an iPhone 11 Pro Max); none of it with Reduce
  Motion; no animated blur.
- Never `pkill -f` a broad pattern (myGym's servers run on this Mac too): stop what you started by port or pid.

## Token and context efficiency

### Codebase navigation
- Locate files with `PROJECT_STRUCTURE.md` first. No broad recursive searches (`find .`, `grep -r`,
  `ls -R`, `**/*` globs) without a targeted keyword or an exact path.
- Files over ~150 lines: read the part needed (`offset`/`limit`) or look up the symbol, not the whole file.
- Do not re-read a file already read or edited this session, unless a build or test changed it.

### Commands and output
- Filter build, lint and test output to failures and errors (`| grep -E "error:|✘|FAIL|✖"`, `| tail`),
  or run the one targeted test file.
- No full project build after a minor edit. The test-first rule above still holds: the failing test is
  run on its own while working, and `scripts/test.sh` runs once before each commit (the hook does it).

### Responses
- Short: the diff or the result, then a few lines of explanation. Keep an internal list of the files
  changed instead of re-scanning directories.
