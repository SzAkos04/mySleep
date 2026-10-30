#!/bin/sh
# Copy mySleep Night's night logs from the iPhone to debug/ios/ (gitignored) and print the report of
# the newest. night-report.mjs reads them.
#   scripts/ios-fetch-night.sh
set -eu
cd "$(dirname "$0")/.."
if [ -z "${DEVICE:-}" ]; then
  j=$(mktemp)
  xcrun devicectl list devices --json-output "$j" >/dev/null 2>&1 || true
  DEVICE=$(python3 -c "import json; d=json.load(open('$j'))['result']['devices']; p=[x for x in d if x.get('hardwareProperties',{}).get('reality')=='physical']; print(p[0]['hardwareProperties']['udid'] if p else '')" 2>/dev/null || true)
  rm -f "$j"
fi
[ -n "$DEVICE" ] || { echo "No iPhone found."; exit 1; }
mkdir -p debug/ios
xcrun devicectl device copy from --device "$DEVICE" --domain-type appDataContainer --domain-identifier hu.szakos.mysleep.night \
  --source Documents --destination debug/ios >/dev/null
file=$(ls -t debug/ios/*.json debug/ios/Documents/*.json 2>/dev/null | head -1)
echo "== $file"
node shared/scripts/night-report.mjs "$file"
