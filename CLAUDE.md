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
scripts/   server-update.sh (runs on the server).
```

## Commands

```bash
cd frontend && npm test            # vitest
cd api && npm test                 # node:test, boots server.js on a temp DATA_DIR
# local, signed in without a passkey:
cd api && DATA_DIR=../data ORIGIN=http://localhost:5173 node server.js
cd frontend && DEV_SESSION=$(cd ../api && DATA_DIR=../data node scripts/dev-session.mjs Test) npx vite
# (make the profile once: DATA_DIR=../data node scripts/dev-session.mjs --create Test)
```

iPhone checks: the iOS Simulator device "iPhone 11 Pro Max test". Serve the build signed in
(`npm run build && DEV_SESSION=… npx vite preview --port 4174`; 4173 is often myGym's), open
`http://localhost:4174/__dev-session?c=<cookie value>` in its Safari, and test the home-screen app
(Share › Add to Home Screen; quit it with `xcrun simctl terminate <udid> com.apple.webapp`).
Record with `xcrun simctl io <udid> recordVideo --codec h264` to see an animation frame by frame.
WebKit: `swift frontend/scripts/webkit-run.swift <url> "<cookie>" flow.js` (outside the sandbox).
Its window runs hidden, so animations do not advance and timers are throttled: use it for what
happens (elements, classes, state), measure motion in the Simulator.

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

## Rules

- Analysis, stats, sync and time logic stay pure in `src/lib` with a test beside them.
- Tuning constants in `analysis.js` are knobs: change them from real nights, not from guesses.
- The UI is English; the user writes Hungarian.
- The microphone, wake lock and alarm paths only run for real on the iPhone (home-screen app).
  Claude's browser pane blocks the mic; say what was not verified.
