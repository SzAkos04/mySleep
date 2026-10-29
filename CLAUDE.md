# CLAUDE.md

mySleep: a self-hosted sleep tracker and smart alarm PWA for one iPhone, built like myGym
(`~/Projects/myGym`). The plan and the reasons are in `docs/dev/MVP.md`; read it first.

## Layout

```
frontend/  React + Vite + Zustand + react-router, nothing else. src/lib/ pure logic with *.test.js
           beside it (analysis.js: the sound analysis and its tuning constants), src/views/ screens,
           src/components/ shared UI, src/store.js the persisted, synced store.
api/       server.js on node:http, JSON files in DATA_DIR. Deps: @simplewebauthn/server, web-push.
web/       multi-stage Dockerfile (builds frontend/, nginx) + nginx.conf.template (proxies /api).
scripts/   server-update.sh (runs on the server), test.sh, ios-install.sh, ios-fetch-night.sh.
ios/       mySleep Night, the native app for the night only (record with the phone locked; the PWA
           does the rest). NightKit/: its logic as a Swift package with tests (swift test on the
           Mac); MySleepNight/: the SwiftUI app. Logs in the web app's format (lib/diag.js).
```

## Commands

```bash
scripts/test.sh                    # everything: frontend tests, API tests, ios/NightKit tests, build
scripts/ios-install.sh             # mySleep Night onto the iPhone (free Apple ID: weekly, 7 days)
scripts/ios-fetch-night.sh         # its night logs from the iPhone into debug/ios/, with the report
cd frontend && npm run test:watch  # vitest while writing code
cd api && npm test                 # node:test, boots server.js on a temp DATA_DIR
scripts/dev-local.sh               # API + hot-reload frontend on http://localhost:5173, signed in as
                                   # Test (data/), Ctrl-C stops both; API_PORT/WEB_PORT to move them
```

iPhone checks: the iOS Simulator device "iPhone 11 Pro Max test". Serve the build signed in
(`npm run build && DEV_SESSION=… npx vite preview --port 4174`; 4173 is often myGym's), open
`http://localhost:4174/__dev-session?c=<cookie value>` in its Safari, and test the home-screen app
(Share › Add to Home Screen; quit it with `xcrun simctl terminate <udid> com.apple.webapp`).
Record with `xcrun simctl io <udid> recordVideo --codec h264` to see an animation frame by frame.
WebKit: `swift frontend/scripts/webkit-run.swift <url> "<cookie>" flow.js` (outside the sandbox).
Its window runs hidden, so animations do not advance and timers are throttled: use it for what
happens (elements, classes, state), measure motion in the Simulator.
The Simulator's microphone is a steady tone with a click every second, not the Mac's: it tests the
tracking flow and the clip upload, never what the analysis hears. For that, replay audio:
`node frontend/scripts/replay.mjs some.wav` (a clip from data/clips/, or `say -o x.wav
--data-format=LEI16@48000 "…"`), and see docs/dev/SOUND_ANALYSIS.md for the measured thresholds.

Use Node 22 (Homebrew `node@22`). Homebrew's npm 10 crashes resolving this tree
(`Cannot read properties of null (reading 'edgesOut')`): change dependencies with
`npx -y npm@11 install`; `npm ci` works with either.

## Branches, machines

- **Mac**: development only, on `dev`. Commit and push as you go.
- **Server** `csodabogar2` (Arch, Tailscale SSH `ssh szakos@csodabogar2`): `~/mySleep` on `main`,
  Docker only. Nobody codes there.
- **Merging `dev` into `main` and deploying happen only when the user says so** ("mergelj",
  "telepítsd"). Then: `git switch main && git merge dev && git push && git switch dev`, and
  `ssh szakos@csodabogar2 '~/mySleep/scripts/server-update.sh'`. Verify live: `/api/health`, the
  build in Settings.
- Back up `data/` before touching it on the server (MVP.md, Hosting).
- `https://csodabogar2.tailbd3336.ts.net:8443` (Tailscale serve → 127.0.0.1:8081). `RP_ID` is
  the hostname, shared with myGym; never change it (the passkeys are bound to it).

## Test-driven (the user's rule since 2026-10-29)

Every change starts with a test, so anything can be checked for working or broken:
1. Write the test first and run it: it must fail, for the reason you expect.
2. Write the least code that makes it pass; then tidy with the tests green.
3. A bug is fixed only after a test reproduces it (it fails before the fix, passes after).
4. `scripts/test.sh` green before every commit. The pre-commit hook runs it
   (`git config core.hooksPath scripts/hooks` in a new clone); never bypass it with `--no-verify`.
   The Docker builds run the tests too, so a failing change cannot be deployed.

Where tests go:
- Logic: `frontend/src/lib/*.test.js` beside the code. Keep logic out of views and `tracker.js`
  so it can be tested; move it into `src/lib` when it grows.
- Screens: `frontend/src/views/screens.test.jsx` renders each one to HTML with seeded nights (no
  DOM library: `react-dom/server`). New screen, new figure or new text → a case there.
- Page globals for tests: `frontend/src/test-setup.js` (document, localStorage, matchMedia).
- API: `api/test/server.test.js`, a real server on a temp DATA_DIR. Every route and its refusals.
- What only the iPhone can show (microphone, wake lock, lock screen, sound): check it in the
  Simulator (below) and say what was not verified. A failure found there gets a unit test when
  its cause is in code.

## Rules

- Analysis, stats, sync and time logic stay pure in `src/lib` with a test beside them.
- Tuning constants in `analysis.js` are knobs: change them from real nights, not from guesses.
- The UI is English; the user writes Hungarian.
- The microphone, wake lock and alarm paths only run for real on the iPhone (home-screen app).
  Claude's browser pane blocks the mic; say what was not verified.
