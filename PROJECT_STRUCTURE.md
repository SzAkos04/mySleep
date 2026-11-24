# Project structure

Generated from `git ls-files` (build output, lock files, binaries, assets and data left out). Refresh it (`git ls-files -co --exclude-standard`) when files are added or moved.

## (root)
`.env.example`, `.gitignore`, `CLAUDE.md`, `README.md`, `docker-compose.yml`

## .claude
`launch.json`

## .github/workflows
`test.yml`

## api
`Dockerfile`, `package.json`, `server.js`, `status.js`

## api/scripts
`dev-session.mjs`, `pair.mjs`, `session.mjs`

## api/test
`server.test.js`, `status.test.js`

## docs/dev
`ALGS_MASTER_PROMPT.md`, `MVP.md`, `NATIVE_PLAN.md`, `SERVER_MASTER_PROMPT.md`, `SOUND_ANALYSIS.md`, `design-draft-v2.html`, `design-draft.html`, `structure-options.html`

## ios/MySleepNight
`AlarmController.swift`, `Info.plist`, `JournalScreen.swift`, `LiveCardController.swift`, `MySleepNightApp.swift`, `NightData.swift`, `NightEngine.swift`, `NightPictures.swift`, `NightViews.swift`, `Notifier.swift`, `ReportScreen.swift`, `ServerLink.swift`, `SettingsTab.swift`, `TonightTab.swift`, `TrendsScreen.swift`

## ios/MySleepNight.xcodeproj
`project.pbxproj`

## ios/MySleepNight.xcodeproj/xcshareddata/xcschemes
`MySleepNight.xcscheme`

## ios/MySleepNightUITests
`MySleepUITests.swift`

## ios/MySleepNightWidget
`Info.plist`, `NightWidget.swift`

## ios/NightKit
`Package.swift`

## ios/NightKit/Sources/NightKit
`Alarm.swift`, `Analysis.swift`, `Clock.swift`, `Correction.swift`, `Demo.swift`, `Features.swift`, `Live.swift`, `Night.swift`, `NightStore.swift`, `Record.swift`, `RecordRules.swift`, `Reminders.swift`, `Score.swift`, `Screens.swift`, `Server.swift`, `Settings.swift`, `Sync.swift`, `Views.swift`

## ios/NightKit/Tests/NightKitTests
`AlarmTests.swift`, `AnalysisTests.swift`, `ClockTests.swift`, `CorrectionTests.swift`, `DemoTests.swift`, `Helpers.swift`, `LiveTests.swift`, `NightKitTests.swift`, `NightStoreTests.swift`, `RecordTests.swift`, `ReminderTests.swift`, `ScaleTests.swift`, `ScoreTests.swift`, `ScreenTests.swift`, `ServerTests.swift`, `SettingsTests.swift`, `SyncScheduleTests.swift`, `SyncTests.swift`, `ViewRulesTests.swift`, `ViewsTests.swift`

## ios/NightKit/Tests/NightKitTests/Fixtures
`real-night.json`

## ios/NightKit/Tools
`main.swift`

## ios/Shared
`NightActivity.swift`

## scripts
`dev-local.sh`, `fetch-debug.sh`, `ios-fetch-night.sh`, `ios-install.sh`, `loud-alarm.mjs`, `make-alarm-rise.py`, `night-report.mjs`, `pair.sh`, `server-update.sh`, `test.sh`

## scripts/hooks
`pre-commit`
