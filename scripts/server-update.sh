#!/bin/sh
# mySleep server update (Arch box `csodabogar2`, ~/mySleep on `main`), run from the Mac:
#   ssh szakos@csodabogar2 '~/mySleep/scripts/server-update.sh'
# Pulls main, rebuilds and restarts with the commit in the version (Settings shows "v0.1.0+<commit>").
set -eu
cd "$(dirname "$0")/.."
git pull --ff-only
APP_BUILD=$(git rev-parse --short HEAD)
export APP_BUILD
echo "Building $APP_BUILD"
docker compose up -d --build
docker compose ps
