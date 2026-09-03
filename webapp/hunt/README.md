# webapp/hunt: the PRACTICE / HUNT side of the wall

Code that watches a capture (screen, audio, emulator memory, savestate retry, auto-manip: anything
that is not the runner's own button press and typed outcome) lives ONLY here and in RNG Solution's
`rngsolution/watch.py`. Nothing else in this repository may read the game.

Rules (README "Modes", RNG Solution's `docs/RNG_GUIDE_DESIGN.md` section 4.2):

- Nothing under this directory is referenced by `webapp/index.html`, so the static site never
  loads it.
- `webapp/build-mobile-bundle.mjs` and `electron/build.sh` refuse to bundle anything under this
  directory unless `--with-hunt` is passed explicitly; the published mobile bundle and the
  desktop builds are made without it. `tests/run-tests.sh` greps a built bundle for the
  sentinel in `sentinel.js` and fails if it is there, and checks that it IS there with
  `--with-hunt`.
- Anything that runs from here runs only while PRACTICE / HUNT mode is on (`webapp/mode.js`,
  the banner above every tab), stamps `mode: "practice"` on every record and log line it
  writes, and keeps its calibration under the practice store key, never the RUN one.
- It never touches LiveSplit, autosplit or reset logic.

There is no capture-watching code here yet. `sentinel.js` is the marker the bundle tests use.
