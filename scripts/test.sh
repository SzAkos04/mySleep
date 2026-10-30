#!/bin/sh
# Everything that can be checked without the iPhone: the shared rules' tests (what mySleep Night's
# screens and scores are made of, and that its bundle is current), the API's tests (a real server on
# a temp DATA_DIR) and the native app's logic (ios/NightKit, on a Mac with Swift). The pre-commit
# hook runs this; so do the Docker builds on the server, so a failing change is never deployed.
set -eu
cd "$(dirname "$0")/.."
# the Node the server runs (node:22-alpine), when the Mac has it (CLAUDE.md: Homebrew node@22)
[ -x /opt/homebrew/opt/node@22/bin/node ] && PATH="/opt/homebrew/opt/node@22/bin:$PATH"
echo "== shared tests"; (cd shared && npx vitest run --reporter=dot)
echo "== api tests";    (cd api && node --test --test-reporter=dot test/*.test.js && echo)
command -v swift >/dev/null && { echo "== ios tests"; (cd ios/NightKit && swift test --quiet); }
echo ok
