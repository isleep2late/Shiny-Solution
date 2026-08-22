# Shiny-Solution

RNG manipulation for classic Pokémon, done for you. A Windows desktop app plus mGBA scripts
that press the button on the exact frame that makes your target shiny — or lands the exact
Trainer ID you want. Fully automatic on emulator where the games allow it, and a smart,
self-calibrating assistant everywhere else.

Every mechanic is verified line-by-line against the pret decompilations — see
[docs/FACTS.md](docs/FACTS.md). Step-by-step instructions live in [USAGE.md](USAGE.md) and
in the app's Help tab.

## What each generation gets

| Generation | Emulator | Real hardware |
|---|---|---|
| **Gen 3** R/S (E/FRLG experimental) | Fully automatic: the mGBA script reads the live RNG, self-calibrates with a throwaway press + savestate rewind, and presses A on the exact shiny/TID frame — starters, gifts, AND static legendaries (enemy-slot mode); a brute-force hunt covers wild grass | Calibrated power-on timer for dead-battery R/S (every boot seeds 0x5A0); TID manip converges in a few attempts and reveals your SID |
| **Gen 1/2** R/B/Y/G/S/C | Automatic hunt bot: no seedable RNG exists, so the bot retries a savestate with shifted timing until the roll is shiny (Gen 2 rule) or matches your DV pattern — encounters, gifts/starters, and TIDs | Not practical (hardware divider RNG) |
| **Gen 4** D/P/Pt/HG/SS | Assisted: seed searcher + verifiers | Full EonTimer-model two-phase timer, TID-target search by delay, coin-flip seed matching (DPPt) and Elm-call sequence prediction (HGSS), Method-1 shiny search per seed |

## The pieces

| Path | What |
|---|---|
| `app/` | **ShinySolution.exe** — WinForms desktop app (.NET 10, self-contained single file): all searchers and timers, plus a live TCP link that drives the mGBA scripts so you never touch the Lua console. The scripts are embedded; export them from the Help tab. |
| `lua/shiny-solution.lua` | Gen 3 mGBA auto-manip script (also usable standalone via console commands). |
| `lua/shiny-solution-gb.lua` | Gen 1/2 mGBA hunt bot (also standalone: `hunt()`, `stop()`, `setopt()`). |
| `core/rng.js` + `core/gen4.js` + `core/gen12.js` | Browser/Node ports of the engines (Gen 3 LCRNG/Method 1, Gen 4 seed/MT19937/timer, Gen 1-2 shiny DVs), bit-for-bit parity-tested against the C# engine. They power `timer/index.html`, the full `webapp/`, the hackmons.com tool page, and the Hackmons Hub mobile screen. |
| `webapp/` | The complete no-emulator toolset as a static web app (all four gens: searchers, checkers, both timers with WebAudio beeps). Also the payload for the Linux/macOS desktop builds and the mobile WebView screen (`build-mobile-bundle.mjs`). |
| `electron/` | Electron packaging for the calculators-and-timers desktop build (Linux AppImage/tar.gz locally, macOS dmg/zip via the `build-desktop` GitHub Actions workflow — unsigned; right-click Open on first launch). |
| `app/Core/` | The C# engine: LCRNG, MT19937, Method 1, Gen 4 seed model, searches, timer math. |
| `docs/FACTS.md` | Every mechanic used, with decompilation citations. |
| `tests/` | The test suites (see below). |

## Verification

- `tests/run-tests.sh` — the JS engine vs an algorithmically independent Python reference.
- `app/run-core-tests.sh` — the C# engine vs the same vectors, plus canonical MT19937
  vectors and the Gen 4 seed/timer model.
- `tests/run-lua-sim.sh` — the actual Gen 3 Lua script run against a stubbed mGBA API:
  full calibrate → rewind → arm → press → verify pipeline, including miss recovery.
- `tests/luasim-venv/bin/python tests/lua-sim-gb.py` — the GB hunt bot against a stubbed
  GB game: encounter, gift, and TID hunts, timeouts, unknown-ROM refusal.
- `tests/harness/` — ground truth against real Pokémon Ruby under libmgba's Python
  bindings: RNG trace verification and a full automated New Game run.
- `tests/test-gen4.cjs` — the JS Gen 4/Gen 1-2 ports vs vectors emitted by the C# engine
  (`--emit-gen4-vectors`), proving bit-for-bit parity; wired into `run-tests.sh`.
- Gen 1/2 addresses come from rgbds builds of the pret repos sha1-verified against retail
  ROM hashes; Gen 4 formulas are decomp-verified in Platinum/HGSS (DP's TID path inferred).

## Building the app

```
export DOTNET_ROOT=$HOME/.dotnet PATH=$HOME/.dotnet:$PATH
dotnet publish app/App/ShinySolution.App.csproj -c Release -r win-x64 \
  -p:PublishSingleFile=true --self-contained true -o <outdir>
```

## Roadmap

- Verified Emerald and FRLG auto-flows (Emerald boots at seed 0 — the easiest console
  target of all; FRLG seeds from title-screen timing)
- Wild encounters, eggs, and lead-ability aware searches for Gen 3/4
- Gen 4 emulator automation (needs a scriptable DS emulator path)
- Model-based Gen 1/2 prediction to replace brute-force hunting
- Gen 5+ (different seeding: SHA-1 into MT — a separate project-sized effort)
- Hardware auto-mode: a microcontroller pressing buttons through a Game Boy Player

## License

GPL-3.0. The implementations are original, written against the pret decompilations; the
Gen 4 timing model follows EonTimer's MIT-licensed source, and seed-inversion edge cases
were cross-checked against PokeFinder (GPL-3.0), whose license this project shares.
