#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
rm -rf webapp
mkdir -p webapp
bash ../webapp/sync-core.sh
cp ../webapp/index.html ../webapp/app.css ../webapp/app.js ../webapp/downloads.js \
   ../webapp/rng.js ../webapp/gen4.js ../webapp/gen12.js webapp/
[ -d node_modules ] || npm install --no-audit --no-fund
npx electron-builder --linux
