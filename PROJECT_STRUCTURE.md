# Project structure

Generated from `git ls-files` (build output, lock files, binaries, assets and data left out). Refresh it (`git ls-files -co --exclude-standard`) when files are added or moved.

## (root)
`.env.example`, `.gitignore`, `CLAUDE.md`, `README.md`, `docker-compose.yml`

## .claude
`launch.json`

## .github/workflows
`test.yml`

## api
`Dockerfile`, `package.json`, `server.js`

## api/scripts
`dev-session.mjs`, `pair.mjs`, `session.mjs`

## api/test
`server.test.js`

## docs/dev
`MVP.md`, `NATIVE_PLAN.md`, `SOUND_ANALYSIS.md`

## ios/MySleepNight
`AlarmController.swift`, `Info.plist`, `JournalScreen.swift`, `LiveCardController.swift`, `MySleepNightApp.swift`, `NightData.swift`, `NightEngine.swift`, `NightPictures.swift`, `NightViews.swift`, `Notifier.swift`, `ReportScreen.swift`, `ServerLink.swift`, `SettingsTab.swift`, `TonightTab.swift`, `TrendsScreen.swift`, `rules.js`

## ios/MySleepNight.xcodeproj
`project.pbxproj`

## ios/MySleepNight.xcodeproj/xcshareddata/xcschemes
`MySleepNight.xcscheme`

## ios/MySleepNightWidget
`Info.plist`, `NightWidget.swift`

## ios/NightKit
`Package.swift`

## ios/NightKit/Sources/NightKit
`Alarm.swift`, `Correction.swift`, `Features.swift`, `Jerk.swift`, `Live.swift`, `Night.swift`, `NightStore.swift`, `Reminders.swift`, `Rules.swift`, `Screens.swift`, `Server.swift`, `Settings.swift`, `Views.swift`

## ios/NightKit/Tests/NightKitTests
`AlarmTests.swift`, `CorrectionTests.swift`, `LiveTests.swift`, `NightKitTests.swift`, `NightStoreTests.swift`, `ReminderTests.swift`, `RulesTests.swift`, `ScreenTests.swift`, `ServerTests.swift`, `SettingsTests.swift`, `SyncScheduleTests.swift`, `ViewsTests.swift`

## ios/NightKit/Tests/NightKitTests/Fixtures
`fixture.js`, `golden.json`

## ios/Shared
`NightActivity.swift`

## scripts
`dev-local.sh`, `fetch-debug.sh`, `ios-fetch-night.sh`, `ios-install.sh`, `pair.sh`, `server-update.sh`, `test.sh`

## scripts/hooks
`pre-commit`

## shared
`package.json`

## shared/lib
`analysis.js`, `analysis.test.js`, `native.js`, `native.test.js`, `night.js`, `night.test.js`, `real-night.test.js`, `fixtures/real-night.json`, `rules.js`, `rules.test.js`, `score.js`, `score.test.js`, `stats.js`, `stats.test.js`, `sync.js`, `sync.test.js`, `time.js`, `time.test.js`, `views.js`, `views.test.js`

## shared/scripts
`build-rules.mjs`, `golden.mjs`, `loud-alarm.mjs`, `night-report.mjs`, `replay.mjs`

## web
`Dockerfile`, `nginx.conf.template`
