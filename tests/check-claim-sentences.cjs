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
// usage: node check-claim-sentences.cjs [--cs <claims.json>] [--webapp <dir>] [--data <gen1-tid.json>]
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
const dataPath = opt("--data", path.join(root, "core", "data", "gen1-tid.json"));
const gen2Path = opt("--gen2", path.join(root, "core", "data", "gen2-tid.json"));
const citationsPath = opt("--citations", path.join(root, "core", "data", "citations.json"));
const docsRoot = opt("--docs-root", root);
const rngRoot = opt("--rng", null);
const DOCS = ["README.md", "USAGE.md", path.join("docs", "FACTS.md"), path.join("docs", "DATA.md")];

let failures = 0, checks = 0, unitsSeen = 0, claimsSeen = 0;
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
globalThis.ShinyCore = require(path.join(root, "core", "rng.js"));
globalThis.ShinyGen1Tid = require(path.join(root, "core", "gen1tid.js"));
globalThis.ShinyGen1Data = DATA;
globalThis.ShinyGen3SidData = JSON.parse(fs.readFileSync(path.join(root, "core", "data", "gen3-sid.json"), "utf8"));
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

// ---- the data the WEBSITE renders verbatim, and the prose --------------------------------------
judgeJson("core/data/gen1-tid.json", DATA);
judgeJson("core/data/gen2-tid.json", JSON.parse(fs.readFileSync(gen2Path, "utf8")));
// the citation registry: generated from docs/FACTS.md, rendered as the footnotes under every panel
judgeJson("core/data/citations.json", globalThis.ShinyCitations);
for (const d of DOCS) {
  const file = path.join(docsRoot, d);
  check(`${d} exists to be judged`, fs.existsSync(file), file);
  if (fs.existsSync(file)) judgeText(d, fs.readFileSync(file, "utf8"));
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

if (failures) { console.error(`claim-sentence guard: ${checks} checks over ${unitsSeen} units (${claimsSeen} making a derivation claim), ${failures} FAILURE(S)`); process.exit(1); }
if (degraded) {
  console.log(`claim-sentence guard: ${checks} checks over ${unitsSeen} units (${claimsSeen} making a derivation claim), 0 failures, but DEGRADED - ${degraded}`);
  process.exit(3);
}
console.log(`claim-sentence guard: ${checks} checks over ${unitsSeen} units (${claimsSeen} making a derivation claim), 0 failures (both heads, the data and the docs)`);
