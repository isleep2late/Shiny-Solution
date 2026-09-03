#!/usr/bin/env bash
# Copies the engines and the shared data into webapp/ (the copies are gitignored; run this before
# serving or packaging the webapp). gen1-data.js carries the Gen 1 / Gen 2 TID and Gen 3 SID JSON as
# globals (with the decomp citation registry core/data/citations.json as window.ShinyCitations) so the static
# page, the Electron file:// page and the mobile bundle need no fetch. The wizard's
# tables (species, encounters, statics: 1.3 MB for Gen 3, 3.4 MB for Gen 4) go to data/wizard-gen3.js and
# data/wizard-gen4.js, which the wizard tab loads lazily on first use with a script element (no fetch, so
# file:// works in the Electron app and in headless Chrome); the mobile bundle carries neither (docs/DATA.md).
set -euo pipefail
cd "$(dirname "$0")"
cp ../core/rng.js ../core/gen4.js ../core/gen12.js ../core/gen1tid.js ../core/timers.js ../core/gen5.js ../core/seedtime4.js ../core/generators.js ../core/gen2tid.js .
mkdir -p data
cp ../core/data/gen1-tid.json ../core/data/gen3-sid.json ../core/data/gen2-tid.json ../core/data/citations.json data/
{
  printf 'window.ShinyGen1Data = '; cat data/gen1-tid.json; printf ';\n'
  printf 'window.ShinyGen3SidData = '; cat data/gen3-sid.json; printf ';\n'
  printf 'window.ShinyGen2TidData = '; cat data/gen2-tid.json; printf ';\n'
  printf 'window.ShinyCitations = '; cat data/citations.json; printf ';\n'
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
# The build stamp for the offline copy (sw.js): the first 12 hex digits of the SHA-256 of every shipped source
# (the engines, the data, the page's own scripts and stylesheet, the manifest and the icons, and index.html and
# sw.js with their stamp lines left out), written into sw.js and index.html. Any change to a shipped file gives a
# new stamp, so the browser installs a new worker with new caches and drops the old ones (README "The heads",
# USAGE "Web, mobile, and non-Windows desktop"; tests/test-sw.cjs recomputes the stamp and refuses a stale one).
build=$( {
  cat ../core/rng.js ../core/gen4.js ../core/gen12.js ../core/gen1tid.js ../core/timers.js ../core/gen5.js ../core/seedtime4.js ../core/generators.js ../core/gen2tid.js
  cat ../core/data/gen1-tid.json ../core/data/gen3-sid.json ../core/data/gen2-tid.json ../core/data/citations.json
  cat ../core/data/species-gen3.json ../core/data/encounters-gen3.json ../core/data/statics-gen3.json ../core/data/species-gen4.json ../core/data/encounters-gen4.json ../core/data/statics-gen4.json
  cat app.css app.js downloads.js mode.js gen1tid-ui.js gen2tid-ui.js wizard-ui.js manifest.webmanifest icons/icon-192.png icons/icon-512.png icons/icon-512-maskable.png
  grep -v 'window.SHINY_BUILD = "' index.html
  grep -v '^const BUILD = "' sw.js
} | sha256sum | cut -c1-12)
sed -i "s/^const BUILD = \"[0-9a-f]*\";/const BUILD = \"$build\";/" sw.js
sed -i "s/<script>window.SHINY_BUILD = \"[0-9a-f]*\";<\/script>/<script>window.SHINY_BUILD = \"$build\";<\/script>/" index.html
grep -q "^const BUILD = \"$build\";" sw.js && grep -q "window.SHINY_BUILD = \"$build\";" index.html || { echo "sync-core.sh: the build stamp was not written" >&2; exit 1; }
echo "build stamp $build (sw.js, index.html)"
