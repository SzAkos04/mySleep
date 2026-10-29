# Project structure

Generated from `git ls-files` (build output, lock files, binaries, assets and data left out). Refresh it (`git ls-files -co --exclude-standard`) when files are added or moved.

## (root)
`.env.example`, `.gitignore`, `CLAUDE.md`, `README.md`, `docker-compose.yml`

## .claude
`launch.json`

## .github/workflows
`test.yml`

## api
`Dockerfile`, `package.json`, `reminders.js`, `server.js`

## api/scripts
`dev-session.mjs`

## api/test
`reminders.test.js`, `server.test.js`

## docs/dev
`MVP.md`, `NATIVE_PLAN.md`, `SOUND_ANALYSIS.md`, `design-draft-v2.html`, `design-draft.html`, `structure-options.html`

## frontend
`index.html`, `package.json`, `vite.config.js`

## frontend/public
`icon.svg`, `manifest.json`, `sw.js`

## frontend/scripts
`icons.mjs`, `icons.test.mjs`, `loud-alarm.mjs`, `night-report.mjs`, `replay.mjs`, `webkit-run.swift`

## frontend/src
`App.jsx`, `index.css`, `main.jsx`, `store.js`, `store.test.js`, `test-setup.js`, `ui.js`

## frontend/src/components
`Charts.jsx`, `Icon.jsx`, `Report.jsx`, `ReviewSheet.jsx`, `ServerStatus.jsx`, `Sheet.jsx`

## frontend/src/lib
`analysis.js`, `analysis.test.js`, `api.js`, `api.test.js`, `native.js`, `native.test.js`, `night.js`, `night.test.js`, `score.js`, `score.test.js`, `stats.js`, `stats.test.js`, `sync.js`, `sync.test.js`, `time.js`, `time.test.js`

## frontend/src/test
`dom.js`

## frontend/src/views
`Journal.jsx`, `Login.jsx`, `Night.jsx`, `Settings.jsx`, `Today.jsx`, `Trends.jsx`, `screens.test.jsx`, `taps.test.jsx`

## ios/MySleepNight
`AlarmController.swift`, `Info.plist`, `LiveCardController.swift`, `MySleepNightApp.swift`, `NightEngine.swift`, `NightViews.swift`, `ServerLink.swift`, `SettingsTab.swift`, `TonightTab.swift`, `WebTab.swift`

## ios/MySleepNight.xcodeproj
`project.pbxproj`

## ios/MySleepNight.xcodeproj/xcshareddata/xcschemes
`MySleepNight.xcscheme`

## ios/MySleepNight.xcodeproj/xcuserdata/admin.xcuserdatad/xcschemes
`xcschememanagement.plist`

## ios/MySleepNightWidget
`Info.plist`, `NightWidget.swift`

## ios/NightKit
`Package.swift`

## ios/NightKit/Sources/NightKit
`Alarm.swift`, `Analysis.swift`, `Features.swift`, `Live.swift`, `Night.swift`, `Screens.swift`, `Server.swift`

## ios/NightKit/Tests/NightKitTests
`AlarmTests.swift`, `LiveTests.swift`, `NightKitTests.swift`, `ScreenTests.swift`, `ServerTests.swift`

## ios/Shared
`NightActivity.swift`

## scripts
`dev-local.sh`, `fetch-debug.sh`, `ios-fetch-night.sh`, `ios-install.sh`, `server-update.sh`, `test.sh`

## scripts/hooks
`pre-commit`

## web
`Dockerfile`, `nginx.conf.template`
