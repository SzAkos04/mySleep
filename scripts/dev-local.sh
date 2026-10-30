#!/usr/bin/env bash
# The API on its own test data (data/) for the iOS Simulator: starts it, makes the Test profile on the
# first run, and prints the link that pairs the app with it. Ctrl-C stops it.
#
#   scripts/dev-local.sh                       # API on http://localhost:3000
#   API_PORT=3001 scripts/dev-local.sh         # next to myGym's dev stack
#   xcrun simctl openurl booted "<the printed link>"    # pairs the Simulator's app
#
# Log: /tmp/mysleep-api.log
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_PORT="${API_PORT:-3000}"
[ -x /opt/homebrew/opt/node@22/bin/node ] && PATH="/opt/homebrew/opt/node@22/bin:$PATH"

if lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $API_PORT is already in use. Stop the process using it first, or pick another (API_PORT):" >&2
  lsof -nP -iTCP:"$API_PORT" -sTCP:LISTEN >&2
  exit 1
fi

export DATA_DIR="$ROOT/data" PORT="$API_PORT" ORIGIN="http://localhost:$API_PORT"
cd "$ROOT/api"
node scripts/dev-session.mjs Test >/dev/null 2>&1 || node scripts/dev-session.mjs --create Test >/dev/null

node server.js >/tmp/mysleep-api.log 2>&1 &
API_PID=$!
trap 'echo; echo "Stopping..."; kill "$API_PID" 2>/dev/null || true; wait 2>/dev/null || true' EXIT INT TERM

for _ in $(seq 1 30); do curl -s -o /dev/null "http://localhost:$API_PORT/api/health" && break; sleep 1; done
echo "API on http://localhost:$API_PORT  (profile Test, data in data/)"
echo "Pair the app:  xcrun simctl openurl booted \"$(node scripts/pair.mjs Test)\""
echo "Log: /tmp/mysleep-api.log  |  Ctrl-C stops it"
wait "$API_PID"
