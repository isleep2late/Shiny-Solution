// The claim-SENTENCE guard: a rendered sentence that asserts a multi-boot derivation must say what
// ships from it.
//
// tests/check-verification-claims.cjs checks the TAG - that a flat "[3x cold-boot verified]" is only
// printed where the three derivations ship as a fixture. It says nothing about the SENTENCES beside
// the tag, and those are what every round of this retraction has left behind: the prose got
// qualified, the rendered string did not (RNG Solution's CLI printed eight unqualified
// "re-derived byte-identically" sweep sentences with the word SAMPLE nowhere in its output while
// both repositories' docs already said "a sample").
//
// The rule lives in tests/claim-phrases.json, byte-identical to RNG Solution's copy (each guard
// fails if the sibling's copy differs, so the rule cannot drift between the two repositories):
//   * strip the three per-offset tags - a bare tag is not a sentence, and the other guard owns it;
//   * split into UNITS (a rendered panel, a blank-line block, a Markdown table row, a JSON string);
//   * collapse whitespace, so a wrapped sentence reads like an unwrapped one;
//   * a unit that matches a CLAIM pattern must also match a SHIPS pattern.
// Plus the linkage half: a rendered panel that prints a verified tag must print that platform's
// note AND its evidence line, so the STRONGER (flat) claim is never the bare one.
//
// Surfaces: both heads rendered for real (the web tab's module loaded here; the desktop head's
// --emit-gen1-claims output), core/data/gen1-tid.json and gen2-tid.json (the website renders their
// derivation fields verbatim), and the prose files that feed the citation registry.
//
// Round 5 added three surfaces, each because the guard was PROVEN blind to it:
//   * the Gen 3 Secret ID panel and core/data/gen3-sid.json. The panel prints model.status, which
//     said the constants were "emulator-measured on mGBA 0.10.5 by TWO INDEPENDENT HARNESSES
//     (tools/gba-sid-harness ...; /tmp/gen3sid ...)" - an UNCOMMITTED scratch directory named as
//     evidence for a load-bearing constant. gen3-sid.json was not among the JSON judged here and
//     "two independent harnesses" was not a claim pattern.
//   * RNG Solution's tests/fixtures headers. Both heads print
//     "Evidence (RNG Solution): tests/fixtures/yellow-gba-triple.csv", so that file is where a
//     reader who doubts the claim is sent - and its first line said "Rows: every route-valid offset
//     plus every 50th offset" over 48 rows that were every 50th offset and no route-valid row at
//     all. Neither guard read it.
//   * the uncommitted-path rule: no judged unit may cite a /tmp path without saying it is not
//     committed.
//
// usage: node check-claim-sentences.cjs [--cs <claims.json>] [--webapp <dir>] [--core <dir>] [--data <gen1-tid.json>] [--gen3 <gen3-sid.json>]
//                                       [--gen2 <gen2-tid.json>] [--citations <citations.json>]
//                                       [--rng <RNG-Solution root>] [--docs-root <dir>]
// exit 0 = ran in full and passed, 3 = passed but a half could not run (DEGRADED), 1 = failed.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const argv = process.argv.slice(2);
function opt(name, def) { const i = argv.indexOf(name); return i === -1 ? def : argv[i + 1]; }

const RULE = JSON.parse(fs.readFileSync(path.join(__dirname, "claim-phrases.json"), "utf8"));
const CASE_SENSITIVE = new Set(RULE.ships_patterns_case_sensitive);
const csPath = opt("--cs", null);
const webappDir = opt("--webapp", path.join(root, "webapp"));
// --core points the ENGINE half at a copy. The derivation decision lives in core/gen1tid.js now
// (one implementation for all three heads, including the website), so the negative control that
// puts it back on verified-target membership has to plant it there.
const coreDir = opt("--core", path.join(root, "core"));
const dataPath = opt("--data", path.join(coreDir, "data", "gen1-tid.json"));
const gen2Path = opt("--gen2", path.join(coreDir, "data", "gen2-tid.json"));
const citationsPath = opt("--citations", path.join(coreDir, "data", "citations.json"));
const docsRoot = opt("--docs-root", root);
const rngRoot = opt("--rng", null);
const gen3Path = opt("--gen3", path.join(coreDir, "data", "gen3-sid.json"));
const DOCS = ["README.md", "USAGE.md", path.join("docs", "FACTS.md"), path.join("docs", "DATA.md")];

// ---- the PROVENANCE DIRECTORIES ----------------------------------------------------------------
// Round 7 finding R7-3. RNG Solution grew this list in round 6 (tests/claim_sentences.py
// PROVENANCE_DIRS) because tools/gen1-tid-tables - the directory docs/FACTS.md sends a reader to -
// was governed by nothing. This repository has exactly the same hole and it was left open:
// README.md line 28, USAGE.md line 507 and docs/FACTS.md line 974 all cite tests/harness/ as the
// evidence for the Gen 3 boot-seed model ("verified on Ruby under libmgba (tests/harness/)"), and
// DOCS above never included it. A planted three-boot + two-harness claim carrying a ~/AI/gen3-scratch
// citation passed at 150 checks over 10135 units, 0 failures - and the real README in there cited
// /tmp/mgba-src/build and /tmp/libmgba-py with no qualifier at all.
//
// Every text file under these directories is judged, not only the README: the sentence that
// misleads is as likely to be a comment in the script that produced the evidence as it is to be
// prose about it.
const PROVENANCE_DIRS = ["tests/harness"];
const PROVENANCE_SUFFIXES = [".md", ".txt", ".sh", ".py", ".cpp", ".json", ".jsonl", ".csv", ".log", ".js", ".cjs"];
const provenanceRoot = opt("--provenance-root", root);

// ---- and the two lists above are PINNED --------------------------------------------------------
// Round 7 finding R7-4: the list that decides WHAT is governed was governed by nothing, in both
// repositories. The pin does not live beside the list - it lives in tests/claim-phrases.json, the
// rule this repository and RNG Solution hold byte-identical copies of (this guard fails if the
// sibling's copy differs, at the bottom of this file) and the website reads rather than copying.
// Shrinking a list here fails here; shrinking the pin fails in RNG Solution too.
const PINNED = (RULE.governed_surfaces || {}).shiny_solution || {};
function checkGoverned() {
  const docs = DOCS.map((d) => d.split(path.sep).join("/"));
  for (const rel of PINNED.docs || [])
    check(`DOCS still governs ${rel}`, docs.indexOf(rel) !== -1, JSON.stringify(docs));
  for (const rel of PINNED.provenance_dirs || [])
    check(`PROVENANCE_DIRS still governs ${rel}`, PROVENANCE_DIRS.indexOf(rel) !== -1, JSON.stringify(PROVENANCE_DIRS));
  check("the shared rule pins this repository's governed surfaces at all",
    (PINNED.docs || []).length >= 4 && (PINNED.provenance_dirs || []).length >= 1,
    JSON.stringify(PINNED));
}

let failures = 0, checks = 0, unitsSeen = 0, claimsSeen = 0, pathsSeen = 0, pathsJudged = 0, fixtureClaims = 0;
function check(label, ok, detail) {
  checks++;
  if (!ok) { failures++; console.error("FAIL claim sentence: " + label + (detail === undefined ? "" : "\n  " + detail)); }
}

// ---- the rule --------------------------------------------------------------------------------
// Whitespace collapsed (a wrapped sentence reads like an unwrapped one) and Markdown emphasis
// dropped (so "in **neither repository**" is still the phrase it is).
function normalise(s) {
  let out = String(s);
  for (const ch of RULE.strip_characters) out = out.split(ch).join("");
  return out.split(/\s+/).filter(Boolean).join(" ");
}
function stripTags(s) {
  let out = String(s);
  for (const tag of RULE.tag_literals) out = out.split(tag).join(" ");
  return out;
}
function match(pattern, text) {
  return new RegExp(pattern, CASE_SENSITIVE.has(pattern) ? "" : "i").test(text);
}
function claimsIn(unit) { return RULE.claim_patterns.filter((p) => match(p, unit)); }
function shipsIn(unit) { return RULE.ships_patterns.filter((p) => match(p, unit)); }
// Every claim match with no ships phrase within proximity_chars of it. The qualifier has to be NEAR
// the claim: a rendered listing is one unit, and a footer at the bottom does not qualify a sentence
// at the top.
function unqualifiedClaims(unit) {
  const w = RULE.proximity_chars, bad = [];
  for (const pattern of RULE.claim_patterns) {
    const re = new RegExp(pattern, CASE_SENSITIVE.has(pattern) ? "g" : "gi");
    let m;
    while ((m = re.exec(unit)) !== null) {
      if (m[0] === "") { re.lastIndex++; continue; }
      const window = unit.slice(Math.max(0, m.index - w), m.index + m[0].length + w);
      if (!shipsIn(window).length) bad.push([pattern, m.index]);
    }
  }
  return bad;
}

// Round 5 finding D. Every path outside both repositories (a /tmp scratch directory) named in a
// judged unit, with no "not committed" phrase within proximity_chars of it. Citing a directory that
// is not in the repository as evidence is the same defect as a flat cold-boot tag whose logs are not
// here: the reader cannot open the thing the sentence rests on. Every unit is judged, not only the
// ones that make a claim - "Evidence: /tmp/x" asserts nothing by itself and is exactly the sentence
// that misleads.
// Round 6 finding E widened the patterns from /tmp to ~/ too. The one exemption is the class of ~/
// path that is not a citation at all: the files the tools write on the READER'S machine
// (runtime_path_patterns - ~/.rng-solution/config.json and the like). Saying those are "not
// committed" would be saying something false about the reader's own state.
function isRuntimePath(text) {
  return (RULE.runtime_path_patterns || []).some((q) => new RegExp("^(?:" + q + ")$").test(text));
}
function uncommittedPathCitations(unit) {
  const w = RULE.proximity_chars, bad = [];
  for (const pattern of RULE.uncommitted_path_patterns) {
    const re = new RegExp(pattern, "g");
    let m;
    while ((m = re.exec(unit)) !== null) {
      if (m[0] === "") { re.lastIndex++; continue; }
      if (isRuntimePath(m[0])) continue;
      const window = unit.slice(Math.max(0, m.index - w), m.index + m[0].length + w);
      if (!RULE.uncommitted_qualifier_patterns.some((q) => new RegExp(q, "i").test(window))) bad.push([m[0], m.index]);
    }
  }
  return bad;
}
// every path outside both repositories the unit names, qualified or not: a rule with nothing to
// judge is not a rule
function countPaths(unit) {
  let n = 0;
  for (const pattern of RULE.uncommitted_path_patterns)
    for (const hit of unit.match(new RegExp(pattern, "g")) || []) if (!isRuntimePath(hit)) n++;
  return n;
}

function unitsOfText(text) {
  const out = [];
  for (const block of String(text).split(/\n\s*\n/)) {
    const lines = block.split("\n");
    const rows = lines.filter((l) => l.trimStart().startsWith("|"));
    if (rows.length) {
      out.push(...rows);
      const rest = lines.filter((l) => !l.trimStart().startsWith("|")).join("\n");
      if (rest.trim()) out.push(rest);
    } else if (block.trim()) out.push(block);
  }
  return out;
}
function unitsOfJson(obj, p, out) {
  if (typeof obj === "string") out.push([p, obj]);
  else if (Array.isArray(obj)) obj.forEach((v, i) => unitsOfJson(v, `${p}[${i}]`, out));
  else if (obj && typeof obj === "object") for (const k of Object.keys(obj)) unitsOfJson(obj[k], `${p}.${k}`, out);
  return out;
}
// The judgement, on one unit. Every call is counted, so a rule that matches nothing is visible.
function judge(surface, label, text) {
  const unit = normalise(stripTags(text));
  unitsSeen++;
  pathsSeen += countPaths(unit);
  for (const [p, at] of uncommittedPathCitations(unit)) {
    pathsJudged++;
    check(`${surface} | ${label} | cites ${p}, which is in neither repository, without saying so`,
      false, unit.slice(Math.max(0, at - 120), at + 240));
  }
  if (!claimsIn(unit).length) return;
  claimsSeen++;
  const bad = unqualifiedClaims(unit);
  check(`${surface} | ${label} | asserts ${JSON.stringify(bad.length ? bad[0][0] : "")} without naming what ships`,
    bad.length === 0, bad.length ? unit.slice(Math.max(0, bad[0][1] - 60), bad[0][1] + 240) : "");
}
function judgeText(surface, text) { unitsOfText(text).forEach((u, i) => judge(surface, "block " + (i + 1), u)); }
function judgeJson(surface, obj) { unitsOfJson(obj, "$", []).forEach(([p, s]) => judge(surface, p, s)); }

// ---- head 1: the web tab's module, rendering for real ------------------------------------------
const DATA = JSON.parse(fs.readFileSync(dataPath, "utf8"));
globalThis.ShinyCore = require(path.join(coreDir, "rng.js"));
globalThis.ShinyGen1Tid = require(path.join(coreDir, "gen1tid.js"));
globalThis.ShinyGen1Data = DATA;
globalThis.ShinyGen3SidData = JSON.parse(fs.readFileSync(path.join(coreDir, "data", "gen3-sid.json"), "utf8"));
globalThis.ShinyMode = require(path.join(root, "webapp", "mode.js"));
globalThis.ShinyCitations = JSON.parse(fs.readFileSync(citationsPath, "utf8"));
require(path.join(webappDir, "footnotes.js"));
const U = require(path.join(webappDir, "gen1tid-ui.js"));

function jsHead() {
  const platforms = [];
  for (const game of U.supportedGames(DATA)) {
    for (const p of U.platformsFor(DATA, game)) {
      const plat = U.resolve(DATA, game, p.key, null, null);
      const targets = [];
      for (let o = 0; o <= plat.maxOffset; o++) {
        if (U.derivationTag(plat, o) === "" && plat.verifiedTargets.indexOf(o) === -1) continue;
        targets.push({ offset: o, line: U.describeTarget(plat, o) });
      }
      platforms.push({
        game: game, platform: p.key, note: plat.verifiedNote, evidence: plat.verifiedEvidence,
        verificationLines: U.verificationLines(plat, "  "),
        methodologyLines: U.methodologyLines(plat, true, "  "), targets: targets
      });
    }
  }
  return { head: "javascript (webapp/gen1tid-ui.js)", platforms: platforms };
}

const heads = [jsHead()];
let degraded = "";
if (csPath) heads.push(JSON.parse(fs.readFileSync(csPath, "utf8")));
else degraded = "no desktop-head emission given (--cs): app/App/Gen1TidSupport.cs was NOT rendered or judged";

// ---- the rule over every rendered panel of every head ------------------------------------------
for (const h of heads) {
  check(`${h.head}: some platform was rendered`, h.platforms.length > 0);
  let tagged = 0;
  for (const p of h.platforms) {
    const where = `${h.head} ${p.game}/${p.platform}`;
    // a panel is one unit: the claim and its qualifier belong in the same block of text
    judge(where, "methodology panel", (p.methodologyLines || []).join("\n"));
    judge(where, "verification lines", (p.verificationLines || []).join("\n"));
    for (const t of p.targets) judge(where, "target line " + t.offset, t.line);
    // the linkage half: a panel that prints a verified tag prints the note and the evidence too
    const panel = normalise((p.methodologyLines || []).join("\n"));
    const flat = RULE.tag_literals.slice(0, 2).some((tag) => panel.indexOf(tag) !== -1);
    if (flat) {
      tagged++;
      check(`${where}: the panel prints a verified tag and the note behind it`,
        p.note !== "" && panel.indexOf(normalise(p.note)) !== -1, normalise(p.note).slice(0, 160));
      check(`${where}: the panel prints a verified tag and its evidence line`,
        p.evidence !== "" && panel.indexOf(normalise(p.evidence)) !== -1, normalise(p.evidence).slice(0, 160));
    }
  }
  check(`${h.head}: the linkage half saw panels that print a verified tag (it has fired)`, tagged > 0, String(tagged));
  console.log(`  ${h.head}: ${h.platforms.length} platforms rendered, ${tagged} panels carrying a verified tag`);
}

// the two heads must render the same sentences, not merely the same tags
if (heads.length === 2) {
  const key = (p) => p.game + "/" + p.platform;
  for (const pa of heads[0].platforms) {
    const pb = heads[1].platforms.find((x) => key(x) === key(pa));
    check(`${key(pa)}: the desktop head renders this platform too`, pb !== undefined);
    if (!pb) continue;
    for (const f of ["verificationLines", "methodologyLines"])
      check(`${key(pa)}: the heads render the same ${f}`, JSON.stringify(pa[f]) === JSON.stringify(pb[f]),
        JSON.stringify([pa[f], pb[f]]).slice(0, 600));
  }
}

// ---- head 1 again: the Gen 3 Secret ID panel, rendered for real --------------------------------
// Round 5 finding D: this panel prints model.status (webapp/gen1tid-ui.js sidCueProtocolLines), which
// is where the two-independent-harnesses claim is rendered, and nothing judged it.
const SID = JSON.parse(fs.readFileSync(gen3Path, "utf8"));
{
  let panels = 0, harnessClaims = 0;
  for (const game of U.SID_GAMES) {
    const m = U.sidMethodologyFor(SID, game);
    const paths = Object.keys(m.model.variants || { "": 1 });
    for (const variant of paths) {
      const p = variant === "" ? null : variant;
      const model = U.sidModelFor(m, "mid", p);
      const cue = U.sidCue(m, 1, "mid", 30, 0, 0, p);
      const lines = U.sidMethodologyLines(m, true).concat(U.sidCueProtocolLines(m, game, 1, "mid", 30, cue));
      const where = `javascript (webapp/gen1tid-ui.js) gen3 ${game}${p ? "/" + p : ""}`;
      judge(where, "Secret ID panel", lines.join("\n"));
      panels++;
      // the panel must PRINT the model's status, not merely have it in the data behind it
      const body = normalise(lines.join("\n"));
      check(`${where}: the panel prints the model's status`, body.indexOf(normalise(model.status)) !== -1,
        normalise(model.status).slice(0, 160));
      if (claimsIn(normalise(m.status) + " " + normalise(model.status)).length) harnessClaims++;
    }
  }
  check("the Gen 3 Secret ID panel was rendered at all", panels >= 3, String(panels));
  check("the Gen 3 panels carry an independence claim the rule can see (it has fired)", harnessClaims > 0, String(harnessClaims));
  console.log(`  javascript (webapp/gen1tid-ui.js): ${panels} Gen 3 Secret ID panels rendered, ${harnessClaims} making an independence claim`);
}

// ---- the data the WEBSITE renders verbatim, and the prose --------------------------------------
judgeJson("core/data/gen1-tid.json", DATA);
judgeJson("core/data/gen2-tid.json", JSON.parse(fs.readFileSync(gen2Path, "utf8")));
// round 5 finding D: gen3-sid.json was not among the JSON this guard judged, and both the Shiny
// panel and the website's Gen 3 flow render its strings
judgeJson("core/data/gen3-sid.json", SID);
// the citation registry: generated from docs/FACTS.md, rendered as the footnotes under every panel
judgeJson("core/data/citations.json", globalThis.ShinyCitations);
for (const d of DOCS) {
  const file = path.join(docsRoot, d);
  check(`${d} exists to be judged`, fs.existsSync(file), file);
  if (fs.existsSync(file)) judgeText(d, fs.readFileSync(file, "utf8"));
}

// ---- the provenance directories this repository sends readers to -------------------------------
{
  checkGoverned();
  let provenanceUnits = 0, provenanceFiles = 0;
  const walkDir = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === "__pycache__" || e.name === "venv" || e.name === "node_modules" ? [] : walkDir(path.join(dir, e.name)))
      : [path.join(dir, e.name)]);
  for (const rel of PROVENANCE_DIRS) {
    const base = path.join(provenanceRoot, rel);
    check(`the provenance directory ${rel} is where the docs say it is`, fs.existsSync(base), base);
    if (!fs.existsSync(base)) continue;
    for (const file of walkDir(base).sort()) {
      if (!PROVENANCE_SUFFIXES.some((x) => file.endsWith(x))) continue;
      const label = path.relative(provenanceRoot, file);
      const text = fs.readFileSync(file, "utf8");
      provenanceFiles++;
      if (file.endsWith(".json")) {
        let parsed = null;
        try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
        if (parsed !== null) { const before = unitsSeen; judgeJson(label, parsed); provenanceUnits += unitsSeen - before; continue; }
      }
      if (file.endsWith(".jsonl")) {
        text.split("\n").forEach((line, i) => {
          if (!line.trim()) return;
          provenanceUnits++;
          try { judgeJson(label + " line " + (i + 1), JSON.parse(line)); } catch (e) { judge(label, "line " + (i + 1), line); }
        });
        continue;
      }
      unitsOfText(text).forEach((u, i) => { provenanceUnits++; judge(label, "block " + (i + 1), u); });
    }
  }
  check("the provenance directories were read at all (round 7 finding R7-3: they never had been)",
    provenanceFiles >= 5 && provenanceUnits > 100, `${provenanceFiles} files, ${provenanceUnits} units`);
  console.log(`  provenance directories (${PROVENANCE_DIRS.join(", ")}): ${provenanceFiles} files, ${provenanceUnits} units judged`);
}

// ---- the EVIDENCE FILES this repository sends readers to ----------------------------------------
// Round 5 finding C. Both heads print "Evidence (RNG Solution): tests/fixtures/<x>-triple.csv". That
// header is the surface a reader who doubts the claim actually opens, and it lived in the sibling
// checkout, which neither guard read. The fixtures are RNG Solution's, so without that checkout this
// half cannot run and the guard says so instead of passing quietly.
if (!rngRoot) {
  degraded += (degraded ? "; " : "") + "no RNG Solution checkout given (--rng): the evidence fixtures both heads cite were NOT judged";
} else {
  const fxRoot = path.join(rngRoot, "tests", "fixtures");
  check("the evidence fixtures both heads cite are where the evidence says", fs.existsSync(fxRoot), fxRoot);
  if (fs.existsSync(fxRoot)) {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
    let headers = 0;
    // Round 7 finding R7-6, and the same widening RNG Solution's fixture_header_units got: .log and
    // .jsonl fixtures were read by neither guard, while tests/fixtures/hunt/README.md - a judged
    // surface - names them as what the hunt tools produced. A .log has no header and no blank line,
    // so every line is a unit; a .jsonl is a JSON record per line.
    const judgeFixtureLine = (rel, i, text) => {
      judge("RNG Solution evidence fixtures", rel + " line " + (i + 1), text);
      headers++;
      if (claimsIn(normalise(stripTags(text))).length) fixtureClaims++;
    };
    for (const file of walk(fxRoot).sort()) {
      const rel = path.relative(rngRoot, file);
      if (file.endsWith(".md")) { judgeText("RNG Solution " + rel, fs.readFileSync(file, "utf8")); headers++; continue; }
      if (file.endsWith(".json")) {
        let parsed = null;
        try { parsed = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { parsed = null; }
        if (parsed !== null) { for (const [p2, v] of unitsOfJson(parsed, "$", [])) judgeFixtureLine(rel + " " + p2, 0, v); }
        continue;
      }
      if (file.endsWith(".jsonl")) {
        fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => {
          if (!line.trim()) return;
          let parsed = null;
          try { parsed = JSON.parse(line); } catch (e) { parsed = null; }
          if (parsed === null) { judgeFixtureLine(rel, i, line); return; }
          for (const [p2, v] of unitsOfJson(parsed, "$", [])) judgeFixtureLine(rel + " " + p2, i, v);
        });
        continue;
      }
      if (file.endsWith(".log")) {
        fs.readFileSync(file, "utf8").split("\n").forEach((line, i) => { if (line.trim()) judgeFixtureLine(rel, i, line); });
        continue;
      }
      if (!file.endsWith(".csv") && !file.endsWith(".txt")) continue;
      const lines = fs.readFileSync(file, "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) if (lines[i].trimStart().startsWith("#")) judgeFixtureLine(rel, i, lines[i]);
    }
    check("some evidence fixture header was read (it has fired)", headers > 0, String(headers));
    check("the evidence fixtures make a derivation claim the rule can see", fixtureClaims >= 8, String(fixtureClaims));
    console.log(`  evidence fixture headers read from ${rngRoot}: ${headers} (${fixtureClaims} making a derivation claim)`);
  }
}

// ---- the rule is the same rule on both sides ----------------------------------------------------
if (!rngRoot) {
  degraded += (degraded ? "; " : "") + "no RNG Solution checkout given (--rng): the two copies of claim-phrases.json were NOT compared";
} else {
  const other = path.join(rngRoot, "tests", "claim-phrases.json");
  check("RNG Solution has the claim-sentence rule", fs.existsSync(other), other);
  if (fs.existsSync(other)) {
    check("the claim-sentence rule is byte-identical in both repositories",
      fs.readFileSync(other, "utf8") === fs.readFileSync(path.join(__dirname, "claim-phrases.json"), "utf8"),
      "the rule has drifted: one repository would accept a sentence the other rejects");
  }
}

// ---- it has to have seen claims to have judged any ---------------------------------------------
check("the guard saw enough text to be judging anything", unitsSeen > 200, String(unitsSeen));
check("the guard saw derivation claims (a rule that matches nothing is not a check)", claimsSeen > 20, String(claimsSeen));
// round 5: this number was 0 and nobody could see it, which is how "/tmp/gen3sid" stayed rendered
check("the uncommitted-path rule had something to judge (a rule with no input is not a rule)", pathsSeen > 0, String(pathsSeen));

const tally = `${checks} checks over ${unitsSeen} units (${claimsSeen} making a derivation claim, ${fixtureClaims} of those in the evidence fixtures themselves; ${pathsSeen} paths outside both repositories judged, ${pathsJudged} of them unqualified)`;
if (failures) { console.error(`claim-sentence guard: ${tally}, ${failures} FAILURE(S)`); process.exit(1); }
if (degraded) {
  console.log(`claim-sentence guard: ${tally}, 0 failures, but DEGRADED - ${degraded}`);
  process.exit(3);
}
console.log(`claim-sentence guard: ${tally}, 0 failures (both heads, the Gen 3 panel, the data, the docs and the evidence fixtures)`);
