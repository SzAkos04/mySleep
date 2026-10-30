#!/bin/sh
# mySleep server update (Arch box `csodabogar2`, ~/mySleep on `main`), run from the Mac:
#   ssh szakos@csodabogar2 '~/mySleep/scripts/server-update.sh'
# Pulls main, rebuilds and restarts (the images run the tests first).
set -eu
cd "$(dirname "$0")/.."
git pull --ff-only
echo "Building $(git rev-parse --short HEAD)"
docker compose up -d --build --remove-orphans   # a service taken out of the compose file goes too
docker compose ps
