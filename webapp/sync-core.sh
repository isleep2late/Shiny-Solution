#!/usr/bin/env bash
# Copies the engines and the shared data into webapp/ (the copies are gitignored; run this before
# serving or packaging the webapp). gen1-data.js carries the Gen 1 / Gen 2 TID and Gen 3 SID JSON as
# globals so the static page, the Electron file:// page and the mobile bundle need no fetch. The wizard's
# tables (species, encounters, statics: 1.3 MB for Gen 3, 3.4 MB for Gen 4) go to data/wizard-gen3.js and
# data/wizard-gen4.js, which the wizard tab loads lazily on first use with a script element (no fetch, so
# file:// works in the Electron app and in headless Chrome); the mobile bundle carries neither (docs/DATA.md).
set -euo pipefail
cd "$(dirname "$0")"
cp ../core/rng.js ../core/gen4.js ../core/gen12.js ../core/gen1tid.js ../core/timers.js ../core/gen5.js ../core/seedtime4.js ../core/generators.js ../core/gen2tid.js .
mkdir -p data
cp ../core/data/gen1-tid.json ../core/data/gen3-sid.json ../core/data/gen2-tid.json data/
{
  printf 'window.ShinyGen1Data = '; cat data/gen1-tid.json; printf ';\n'
  printf 'window.ShinyGen3SidData = '; cat data/gen3-sid.json; printf ';\n'
  printf 'window.ShinyGen2TidData = '; cat data/gen2-tid.json; printf ';\n'
} > gen1-data.js
for gen in 3 4; do
  cp "../core/data/species-gen$gen.json" "../core/data/encounters-gen$gen.json" "../core/data/statics-gen$gen.json" data/
  {
    printf 'window.ShinyWizardData%s = {"species": ' "$gen"; cat "data/species-gen$gen.json"
    printf ', "encounters": '; cat "data/encounters-gen$gen.json"
    printf ', "statics": '; cat "data/statics-gen$gen.json"
    printf '};\n'
  } > "data/wizard-gen$gen.js"
done
