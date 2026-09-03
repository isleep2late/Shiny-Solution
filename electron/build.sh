#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
rm -rf webapp
mkdir -p webapp/data
bash ../webapp/sync-core.sh
cp ../webapp/index.html ../webapp/app.css ../webapp/app.js ../webapp/downloads.js ../webapp/gen1tid-ui.js \
   ../webapp/rng.js ../webapp/gen4.js ../webapp/gen12.js ../webapp/gen1tid.js ../webapp/gen1-data.js webapp/
cp ../webapp/data/gen1-tid.json ../webapp/data/gen3-sid.json webapp/data/
[ -d node_modules ] || npm install --no-audit --no-fund
npx electron-builder --linux
