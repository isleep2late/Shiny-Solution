#!/usr/bin/env bash
# Copies the engines and the shared data into webapp/ (the copies are gitignored; run this before
# serving or packaging the webapp). gen1-data.js carries core/data/*.json as globals so the static
# page, the Electron file:// page and the mobile bundle need no fetch.
set -euo pipefail
cd "$(dirname "$0")"
cp ../core/rng.js ../core/gen4.js ../core/gen12.js ../core/gen1tid.js ../core/timers.js ../core/gen5.js ../core/generators.js .
mkdir -p data
cp ../core/data/gen1-tid.json ../core/data/gen3-sid.json data/
{
  printf 'window.ShinyGen1Data = '; cat data/gen1-tid.json; printf ';\n'
  printf 'window.ShinyGen3SidData = '; cat data/gen3-sid.json; printf ';\n'
} > gen1-data.js
