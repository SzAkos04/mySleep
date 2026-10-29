#!/bin/sh
# Everything that can be checked without the iPhone: the frontend's tests (logic and every screen),
# the API's tests (a real server on a temp DATA_DIR), and the production build. The pre-commit hook
# runs this; so do the Docker builds on the server, so a failing change is never deployed.
set -eu
cd "$(dirname "$0")/.."
echo "== frontend tests"; (cd frontend && npx vitest run --reporter=dot)
echo "== api tests";      (cd api && node --test --test-reporter=dot test/*.test.js && echo)
echo "== build";          (cd frontend && npx vite build --logLevel error >/dev/null && echo ok)
