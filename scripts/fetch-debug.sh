#!/bin/sh
# Copy the night logs (frontend/src/lib/diag.js) from the server to the Mac, read-only on the
# server side, into debug/ (gitignored), and print a report of the newest or the named night.
#
#   scripts/fetch-debug.sh               # all logs, report of the newest
#   scripts/fetch-debug.sh 2026-10-29    # report of that night
set -eu
cd "$(dirname "$0")/.."
mkdir -p debug
ssh szakos@csodabogar2 'cd ~/mySleep && docker compose exec -T api tar -C /data -cf - debug 2>/dev/null' | tar -xf - -C debug --strip-components=1
night="${1:-}"
if [ -z "$night" ]; then file=$(ls -t debug/*/*.json | head -1); else file=$(ls debug/*/"$night".json | head -1); fi
echo "== $file"
node frontend/scripts/night-report.mjs "$file"
