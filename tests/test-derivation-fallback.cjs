#!/usr/bin/env node
// THE FAMILY FALLBACK, exercised in all three implementations at once.
//
// Round 7 finding R7-5. "Exactly one expression resolves an evidence string" was false: there were
// four, and the fourth was wrong.
//   * core/gen1tid.js derivationPlatform          - methodology's own field, else the family's
//   * RNG Solution rngsolution/tables.py          - the same
//   * RNG Solution rngsolution/cli.py             - a SECOND Python copy, whose docstring said so
//   * app/Core/Gen1Tid.cs                         - NO FAMILY FALLBACK AT ALL
// Proven latent: with blue/gba/hold-start-v1's own verified_targets_evidence removed, the JS engine
// yielded the family's sentence and the desktop head yielded "". Nothing could see it because every
// shipped methodology carries its own evidence, so the fallback never fires on the shipped data -
// and every cross-head guard runs on the shipped data. A family-level fixture path (the obvious way
// to ship one evidence file for a whole console family) would have made the desktop head print the
// off-repository tag while the web tab, the CLI and the public website printed the flat one.
//
// The Python duplicate is gone (cli.py calls tables.verified_field). Three languages cannot share
// an implementation, so what is left is one per language - and this drives all three off ONE
// gen1-tid.json with a methodology's own evidence REMOVED, which is the case the shipped data never
// exercises, and requires them to agree field for field.
//
// usage: node test-derivation-fallback.cjs [--rng <RNG-Solution>] [--root <Shiny-Solution>]
// exit 0 = ran in full and passed, 3 = passed but a head could not run (DEGRADED), 1 = failed.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
const root = path.resolve(opt("--root", path.join(__dirname, "..")));
const rngRoot = opt("--rng", null);

let failures = 0, checks = 0;
function check(label, ok, detail) {
  checks++;
  if (!ok) { failures++; console.error("FAIL derivation fallback: " + label + (detail === undefined ? "" : "\n  " + detail)); }
}

const METH = "blue/gba/hold-start-v1";
const PLATFORM = "gse";          // a GBA-family console, so the fallback is the gba family's
const GAME = "blue";
const FIELDS = ["verified_targets", "verified_targets_note", "verified_targets_evidence"];

const dataPath = path.join(root, "core", "data", "gen1-tid.json");
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const meth = data.methodologies[METH];
// gen1-tid.json carries the three fields TWICE: on the methodology record (which is the registry's
// own shape, and what RNG Solution reads back through SHINY_SOLUTION_DATA - spec_from_shared drops
// the generated `timing` block) and inside `timing` (which is what the JS engine and the C# head
// read). Both copies have to go, or the heads are not being asked the same question.
const carriers = [meth, meth.timing];
const family = data.families[meth.console_id];

// The test only means anything if the methodology really carries its own today and the family
// really carries a DIFFERENT one: otherwise removing the first proves nothing.
for (const f of FIELDS) {
  check(`${METH} carries its own ${f} today (so removing it exercises the fallback)`,
    carriers.every((c) => c[f] !== undefined), JSON.stringify(carriers.map((c) => c[f])));
  check(`the ${meth.console_id} family carries a ${f} to fall back to`, family[f] !== undefined, JSON.stringify(family[f]));
  check(`the family's ${f} differs from the methodology's (so a head that ignores the fallback is visible)`,
    JSON.stringify(family[f]) !== JSON.stringify(meth.timing[f]), JSON.stringify([meth.timing[f], family[f]]));
}
for (const f of FIELDS) for (const c of carriers) delete c[f];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shiny-fallback-"));
fs.writeFileSync(path.join(tmp, "gen1-tid.json"), JSON.stringify(data, null, 1));
fs.copyFileSync(path.join(root, "core", "data", "gen3-sid.json"), path.join(tmp, "gen3-sid.json"));

const expected = {
  targets: family.verified_targets,
  note: family.verified_targets_note,
  evidence: family.verified_targets_evidence,
};

const heads = {};
const degraded = [];

// ---- head 1: the JavaScript engine (core/gen1tid.js), which the web tab and the WEBSITE run ----
{
  const G = require(path.join(root, "core", "gen1tid.js"));
  const plat = G.derivationPlatform(data, GAME, METH, null);
  heads["javascript (core/gen1tid.js)"] = {
    targets: plat.verifiedTargets, note: plat.verifiedNote, evidence: plat.verifiedEvidence,
    sentence: G.derivationSentence(plat, expected.targets[0]),
  };
}

// ---- head 2: the desktop head (app/Core/Gen1Tid.cs + app/App/Gen1TidSupport.cs) -----------------
{
  const dotnet = fs.existsSync(path.join(os.homedir(), ".dotnet", "dotnet")) ? path.join(os.homedir(), ".dotnet", "dotnet") : "dotnet";
  const out = path.join(tmp, "claims.json");
  try {
    execFileSync(dotnet, ["run", "--project", path.join(root, "app", "Tests"), "-c", "Release", "--",
      "--emit-gen1-claims", out, path.join(tmp, "gen1-tid.json"), path.join(root, "core", "data", "citations.json")],
      { cwd: path.join(root, "tests"), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        env: Object.assign({}, process.env, { DOTNET_ROOT: path.join(os.homedir(), ".dotnet") }) });
    const emitted = JSON.parse(fs.readFileSync(out, "utf8"));
    const p = emitted.platforms.find((x) => x.game === GAME && x.platform === PLATFORM);
    check("the desktop head emitted the platform under test", p !== undefined, JSON.stringify(emitted.platforms.map((x) => x.game + "/" + x.platform)));
    if (p) heads["csharp (app/Core/Gen1Tid.cs)"] = { targets: p.verifiedTargets, note: p.note, evidence: p.evidence };
  } catch (e) {
    degraded.push("dotnet could not run, so the DESKTOP head - the one round 7 finding R7-5 found wrong - was NOT compared: "
      + String((e && e.stderr) || (e && e.message)).slice(0, 300));
  }
}

// ---- head 3: RNG Solution's Python (rngsolution/tables.py, which cli.py now calls) --------------
if (!rngRoot || !fs.existsSync(path.join(rngRoot, "rngsolution", "tables.py"))) {
  degraded.push(`no RNG Solution checkout given (--rng): the Python head was NOT compared`);
} else {
  const script = "import json\n"
    + "from rngsolution import tables, cli\n"
    + `p = tables.get_platform(${JSON.stringify(PLATFORM)}, game=${JSON.stringify(GAME)})\n`
    + "spec = tables.load_platforms()\n"
    + "m = spec['methodologies'][p.methodology_id]\n"
    + "fam = spec.get('families', {}).get(m.get('console_id'), {})\n"
    + "print(json.dumps({'targets': p.verified_targets(), 'note': p.verified_targets_note(),\n"
    + "  'evidence': p.verified_targets_evidence(),\n"
    + "  'cli_targets': list(tables.verified_field(m, fam, 'verified_targets', [])),\n"
    + "  'cli_note': tables.verified_field(m, fam, 'verified_targets_note', ''),\n"
    + "  'cli_evidence': tables.verified_field(m, fam, 'verified_targets_evidence', '')}))\n";
  try {
    const out = execFileSync("python3", ["-c", script],
      { cwd: rngRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
        env: Object.assign({}, process.env, { SHINY_SOLUTION_DATA: tmp }) });
    const got = JSON.parse(out);
    heads["python (rngsolution/tables.py)"] = { targets: got.targets, note: got.note, evidence: got.evidence };
    // the second Python copy is gone: cli.py resolves through the same function, so it cannot differ
    check("rngsolution/cli.py resolves the evidence through tables.verified_field, not its own copy",
      JSON.stringify([got.cli_targets, got.cli_note, got.cli_evidence]) === JSON.stringify([got.targets, got.note, got.evidence]),
      JSON.stringify([got.cli_evidence, got.evidence]));
  } catch (e) {
    degraded.push("the Python head could not run: " + String((e && e.stderr) || (e && e.message)).slice(0, 300));
  }
}

// ---- and they must all say what the FAMILY says ------------------------------------------------
const names = Object.keys(heads);
check("more than one implementation was compared (one head agreeing with itself proves nothing)",
  names.length >= 2, JSON.stringify(names));
for (const name of names) {
  const h = heads[name];
  check(`${name}: with the methodology's own evidence removed, falls back to the family's evidence`,
    h.evidence === expected.evidence, JSON.stringify([h.evidence, expected.evidence]));
  check(`${name}: falls back to the family's note`, h.note === expected.note, JSON.stringify([h.note, expected.note]));
  check(`${name}: falls back to the family's verified offsets`,
    JSON.stringify(h.targets) === JSON.stringify(expected.targets), JSON.stringify([h.targets, expected.targets]));
  check(`${name}: the fallback evidence is not empty (the C# head returned "" here)`, String(h.evidence) !== "", name);
}
fs.rmSync(tmp, { recursive: true, force: true });

if (failures) { console.error(`derivation fallback guard: ${checks} checks, ${failures} FAILURE(S)`); process.exit(1); }
if (degraded.length) {
  console.log(`derivation fallback guard: ${checks} checks over ${names.length} implementations, 0 failures, but DEGRADED - ${degraded.join("; ")}`);
  process.exit(3);
}
console.log(`derivation fallback guard: ${checks} checks, 0 failures (${names.join(", ")} all fall back to the console family)`);
