#!/bin/sh
# Build mySleep Night (ios/) and put it on the iPhone, by cable or over the same Wi-Fi. Signed with
# the free Apple ID Xcode is signed in with, so the app runs 7 days: run this weekly.
#   scripts/ios-install.sh            # the first iPhone devicectl finds
#   DEVICE=<udid> scripts/ios-install.sh
# Once: Xcode › Settings › Accounts › add your Apple ID; on the phone, Settings › Privacy & Security
# › Developer Mode on; after the first install, Settings › General › VPN & Device Management › trust.
set -eu
cd "$(dirname "$0")/../ios"

TEAM=${TEAM:-$(security find-certificate -a -c "Apple Development" -p 2>/dev/null | openssl x509 -noout -subject 2>/dev/null | sed -n 's/.*OU *= *\([A-Z0-9]\{10\}\).*/\1/p' | head -1)}
if [ -z "$TEAM" ]; then
  echo "No Apple Development certificate on this Mac. In Xcode: Settings › Accounts › + › Apple ID, then"
  echo "select the account › Manage Certificates › + › Apple Development. Then run this again."
  exit 1
fi
if [ -z "${DEVICE:-}" ]; then
  j=$(mktemp)
  xcrun devicectl list devices --json-output "$j" >/dev/null 2>&1 || true
  DEVICE=$(python3 -c "import json,sys; d=json.load(open('$j'))['result']['devices']; p=[x for x in d if x.get('hardwareProperties',{}).get('reality')=='physical' and x.get('hardwareProperties',{}).get('deviceType')=='iPhone']; print(p[0]['hardwareProperties']['udid'] if p else '')" 2>/dev/null || true)
  rm -f "$j"
fi
[ -n "$DEVICE" ] || { echo "No iPhone found: connect it with a cable (the first time), unlock it, and trust this Mac."; exit 1; }

echo "== tests"; (cd NightKit && swift test --quiet)   # nothing goes on the phone with a failing test
echo "== build for $DEVICE (team $TEAM)"
xcodebuild -project MySleepNight.xcodeproj -scheme MySleepNight -configuration Release \
  -destination "id=$DEVICE" -derivedDataPath build/device \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM="$TEAM" CURRENT_PROJECT_VERSION="$(date +%Y%m%d%H%M)" build -quiet
echo "== install"
xcrun devicectl device install app --device "$DEVICE" build/device/Build/Products/Release-iphoneos/MySleepNight.app
echo "Installed. It runs until $(date -v+7d '+%A %d %B'): install again before then."
