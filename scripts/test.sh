#!/bin/sh
# Everything that can be checked without the iPhone: the API's tests (a real server on a temp
# DATA_DIR) and the app's logic (ios/NightKit: the night rules, the store, the sync). The pre-commit
# hook runs this; the Docker builds on the server run the API tests, so a failing change is never deployed.
set -eu
cd "$(dirname "$0")/.."
# the Node the server runs (node:22-alpine), when the Mac has it (CLAUDE.md: Homebrew node@22)
[ -x /opt/homebrew/opt/node@22/bin/node ] && PATH="/opt/homebrew/opt/node@22/bin:$PATH"
echo "== api tests";    (cd api && node --test --test-reporter=dot test/*.test.js && echo)
command -v swift >/dev/null && { echo "== ios tests"; (cd ios/NightKit && swift test --quiet); }
echo ok
