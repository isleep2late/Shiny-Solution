# webapp/hunt: the PRACTICE / HUNT side of the wall

Code that watches a capture (screen, audio, emulator memory, savestate retry, auto-manip: anything
that is not the runner's own button press and typed outcome) lives ONLY here and in RNG Solution's
`rngsolution/watch.py`. Nothing else in this repository may read the game.

Rules (README "Modes", RNG Solution's `docs/RNG_GUIDE_DESIGN.md` section 4.2):

- Nothing under this directory is referenced by `webapp/index.html`, so the static site never
  loads it.
- `webapp/build-mobile-bundle.mjs` and `electron/build.sh` refuse to bundle anything under this
  directory unless `--with-hunt` is passed explicitly; the published mobile bundle and the
  desktop builds are made without it; both compare the whole text of every file here with
  what they built, so a file without the sentinel line is caught too. `tests/run-tests.sh`
  greps a built bundle for the sentinel in `sentinel.js` and fails if it is there, and checks
  that it IS there with `--with-hunt`.
- Anything that runs from here runs only while PRACTICE / HUNT mode is on (`webapp/mode.js`,
  the banner above every tab), stamps `mode: "practice"` on every record and log line it
  writes, and keeps its calibration, its reset adjustments and its Secret ID pins under the
  practice store keys (`shinySolution.gen1tid.calibration.practice`, `...resetAdjust.practice`,
  `...sidPins.practice`), never the RUN ones. A record it writes under any other `mode` value is
  in force nowhere: the RUN side keeps only exact matches and names the rest as unknown.
- It never touches LiveSplit, autosplit or reset logic.

What lives here (all of it staged and bundled only with `--with-hunt`):

- `hunt-panel.js`: the Gen 1 menu-box watcher in JS, RNG Solution's `rngsolution/hunt` pipeline
  for the GBA HD (the profiles' geometry and thresholds, the sample-rate guard, the
  open -> close state machine with the overlay's hold check, the table lookup with the calibrated
  lag, the practice-namespace calibration store `shinySolution.hunt.calibration.practice`
  through `mode.js`'s `storeKey`). It exports the pure functions for node (`tests/test-hunt.cjs`
  checks them against RNG Solution's `tests/fixtures/hunt/gen1-parity.json`, frame for frame on
  the shared PNG poll and attempt for attempt on the real GBA HD timeline) and mounts the panel
  into `#hunt-panel` when the page has one; it refuses to run while RUN mode is on.
- `hunt.html`: the page the Electron app opens from its "Practice & Hunt" menu. It has no mode
  switch of its own: the mode is the main window's (the one shared setting), the banner is shown,
  and the page closes itself when it finds RUN at load or when the main window switches back
  (the `storage` event, and a check every second).
- `electron-main.js`: the menu and the window, in the Electron main process. `electron/main.js`
  requires it only when this directory was staged, so a plain build's main process names no
  window, menu or capture source. The menu item is enabled only while the main window's page
  holds mode `practice` (read every second, and again at the click, which refuses with a dialog
  otherwise), and a hunt window still open when the mode goes back to RUN is closed from here.
- `preload.js` and `electron-source.js`: the hunt window's bridge and its frame sources in the
  Electron main process: a PNG-sequence replay (`tests/fixtures/hunt/<name>/frames.csv`), and
  obs-websocket screenshots through the `ws` package, opened only after the renderer's
  confirmation dialog and never by any test. `ws` is not in `electron/package.json`;
  `electron/build.sh --with-hunt` installs it (`npm install --no-save ws`), a plain build never.
- `sentinel.js`: the marker the bundle tests use.

Every prediction the panel prints says which methodology it assumes and, when the source was
undersampled, the quantisation it was measured with.
