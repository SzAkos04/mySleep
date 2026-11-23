#!/bin/sh
# Everything that can be checked without the iPhone: the API's tests (a real server on a temp
# DATA_DIR), the app's logic (ios/NightKit: the night rules, the store, the sync) and the app itself in
# the Simulator (ios/MySleepNightUITests, demo mode, light and dark contrast). The pre-commit hook runs
# this; the Docker builds on the server run the API tests, so a failing change is never deployed.
#   FAST=1 scripts/test.sh          # without the UI tests, while iterating
#   SIM="iPhone 17" scripts/test.sh # another Simulator than "iPhone 11 Pro Max test"
set -eu
cd "$(dirname "$0")/.."
# the Node the server runs (node:22-alpine), when the Mac has it (CLAUDE.md: Homebrew node@22)
[ -x /opt/homebrew/opt/node@22/bin/node ] && PATH="/opt/homebrew/opt/node@22/bin:$PATH"
echo "== api tests";    (cd api && node --test --test-reporter=dot test/*.test.js && echo)
command -v swift >/dev/null && { echo "== ios tests"; (cd ios/NightKit && swift test --quiet); }
if [ -z "${FAST:-}" ] && command -v xcodebuild >/dev/null; then
  echo "== ui tests"
  # build products stay in ios/build/sim (gitignored) between runs; one Simulator, no clones
  mkdir -p ios/build
  if ! (cd ios && xcodebuild test -project MySleepNight.xcodeproj -scheme MySleepNight -derivedDataPath build/sim CODE_SIGN_IDENTITY=- \
        -destination "platform=iOS Simulator,name=${SIM:-iPhone 11 Pro Max test}" -parallel-testing-enabled NO > build/ui-tests.log 2>&1); then
    grep -E "error:|contrast,|Test Case .*failed|TEST FAILED" ios/build/ui-tests.log | head -40; echo "(all of it: ios/build/ui-tests.log)"; exit 1
  fi
  grep -E "Executed [0-9]+ tests" ios/build/ui-tests.log | tail -1
fi
echo ok
