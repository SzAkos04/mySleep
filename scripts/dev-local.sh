#!/usr/bin/env bash
# Local dev stack on the Mac: the API on its own test data (data/), the frontend with hot reload,
# signed in as the "Test" profile (made on first run), so no passkey is needed. Ctrl-C stops both.
#
#   scripts/dev-local.sh                                  # http://localhost:5173
#   API_PORT=3001 WEB_PORT=5174 scripts/dev-local.sh      # next to myGym's dev stack
#
# Logs: /tmp/mysleep-api.log and /tmp/mysleep-web.log
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_PORT="${API_PORT:-3000}"
WEB_PORT="${WEB_PORT:-5173}"

for port in "$API_PORT" "$WEB_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is already in use. Stop the process using it first, or pick other ports (API_PORT, WEB_PORT):" >&2
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >&2
    exit 1
  fi
done

for dir in api frontend; do
  [[ -d "$ROOT/$dir/node_modules" ]] || (cd "$ROOT/$dir" && npm ci)
done

# A session cookie for the Test profile, minted from data/secret (api/scripts/dev-session.mjs).
cd "$ROOT/api"
SESSION="$(DATA_DIR=../data node scripts/dev-session.mjs Test 2>/dev/null || DATA_DIR=../data node scripts/dev-session.mjs --create Test)"

# exec in the subshells: the PIDs below are the servers themselves, so killing them stops them
cleanup() {
  echo; echo "Stopping..."
  [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null || true
  [[ -n "${WEB_PID:-}" ]] && kill "$WEB_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

(cd "$ROOT/api" && DATA_DIR=../data PORT="$API_PORT" ORIGIN="http://localhost:$WEB_PORT" exec node server.js) >/tmp/mysleep-api.log 2>&1 &
API_PID=$!

(cd "$ROOT/frontend" && API_TARGET="http://127.0.0.1:$API_PORT" DEV_SESSION="$SESSION" exec node_modules/.bin/vite --port "$WEB_PORT" --strictPort) >/tmp/mysleep-web.log 2>&1 &
WEB_PID=$!

for _ in $(seq 1 60); do
  if curl -s -o /dev/null "http://localhost:$WEB_PORT/" && curl -s -o /dev/null "http://localhost:$API_PORT/api/health"; then
    echo "Ready: http://localhost:$WEB_PORT/  (signed in as Test)"
    break
  fi
  sleep 1
done

echo "API log: /tmp/mysleep-api.log  |  web log: /tmp/mysleep-web.log  |  Ctrl-C stops both"
wait
