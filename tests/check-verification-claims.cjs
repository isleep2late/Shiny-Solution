// The verification-claims guard: "[3x cold-boot verified]" is a claim about evidence, so both heads
// must only print it flat when the three cold-boot re-derivations are a fixture that actually ships.
//
// It reads the REAL rendered output of both heads - the web tab's module (webapp/gen1tid-ui.js, loaded
// here) and the desktop head's emission (app/Tests --emit-gen1-claims, app/App/Gen1TidSupport.cs) - and
// fails if either prints the flat tag for an offset whose methodology/family evidence is not an in-repo
// fixture, or if the two heads disagree about any of it. RNG Solution's tests/test_games.py
// VerificationClaims is the same rule on that side; this is the missing half on this one.
//
// usage: node check-verification-claims.cjs --cs <claims.json> [--webapp <dir>] [--data <gen1-tid.json>]
//                                           [--citations <citations.json>] [--rng <RNG-Solution root>]
// exit 0 = ran in full and passed, 3 = passed but a half could not run (DEGRADED), 1 = failed.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const argv = process.argv.slice(2);
function opt(name, def) { const i = argv.indexOf(name); return i === -1 ? def : argv[i + 1]; }

const FIXTURE_PREFIX = "tests/fixtures/";
const csPath = opt("--cs", null);
if (!csPath) { console.error("usage: node check-verification-claims.cjs --cs <claims.json> [--webapp <dir>] [--data <gen1-tid.json>] [--citations <citations.json>] [--rng <root>]"); process.exit(2); }
const webappDir = opt("--webapp", path.join(root, "webapp"));
const dataPath = opt("--data", path.join(root, "core", "data", "gen1-tid.json"));
const citationsPath = opt("--citations", path.join(root, "core", "data", "citations.json"));
const rngRoot = opt("--rng", null);

let failures = 0, checks = 0;
function check(label, ok, detail) {
  checks++;
  if (!ok) { failures++; console.error("FAIL verification claims: " + label + (detail === undefined ? "" : "\n  " + detail)); }
}

// ---- head 1: the web tab's module, rendering for real -------------------------------------------
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
        const tag = U.derivationTag(plat, o);
        if (tag === "" && plat.verifiedTargets.indexOf(o) === -1) continue;
        targets.push({ offset: o, tid: globalThis.ShinyGen1Tid.formatTid(plat.table[o]), verified: plat.verifiedTargets.indexOf(o) !== -1, tag: tag, line: U.describeTarget(plat, o) });
      }
      platforms.push({
        game: game, platform: p.key, methodologyId: plat.methodologyId, family: plat.familyKey,
        verifiedTargets: plat.verifiedTargets.slice(), evidence: plat.verifiedEvidence, note: plat.verifiedNote,
        evidenceInRepo: U.verifiedEvidenceInRepo(plat), verificationLines: U.verificationLines(plat, "  "), targets: targets
      });
    }
  }
  return { head: "javascript (webapp/gen1tid-ui.js)", flatTag: U.VERIFIED_TAG, offRepoTag: U.VERIFIED_OFF_REPO_TAG, oneDerivationTag: U.ONE_DERIVATION_TAG, platforms: platforms };
}

const heads = [jsHead(), JSON.parse(fs.readFileSync(csPath, "utf8"))];

// ---- the rule, on each head's own rendered strings ----------------------------------------------
// Every route-valid target's tag is one of the three; the flat claim needs in-repo evidence; a platform
// whose evidence is off-repository must carry the qualifier on every one of its verified targets and
// must not print the flat string anywhere at all (it is a prefix of the qualified one, so compare tags).
for (const h of heads) {
  check(`${h.head}: the three tags are the expected strings`,
    h.flatTag === "[3x cold-boot verified]" && h.offRepoTag === "[3x cold-boot verified off-repository: no derivation fixture here]" && h.oneDerivationTag === "[extended sweep, one derivation]",
    JSON.stringify([h.flatTag, h.offRepoTag, h.oneDerivationTag]));
  check(`${h.head}: some platform was rendered`, h.platforms.length > 0);
  let flat = 0, offRepo = 0, one = 0;
  for (const p of h.platforms) {
    const where = `${h.head} ${p.game}/${p.platform}`;
    check(`${where}: evidence is stated at all`, typeof p.evidence === "string" && p.evidence !== "" || p.verifiedTargets.length === 0, JSON.stringify(p.evidence));
    check(`${where}: evidenceInRepo agrees with the evidence string`, p.evidenceInRepo === p.evidence.startsWith(FIXTURE_PREFIX), p.evidence);
    for (const t of p.targets) {
      if (t.tag === h.flatTag) {
        flat++;
        check(`${where}: the FLAT claim at offset ${t.offset} is backed by an in-repo fixture`, p.evidenceInRepo,
          `the head printed ${h.flatTag} but the evidence is ${JSON.stringify(p.evidence)}`);
        check(`${where}: the flat claim at offset ${t.offset} is one of the verified targets`, t.verified);
      } else if (t.tag === h.offRepoTag) {
        offRepo++;
        check(`${where}: the qualified claim at offset ${t.offset} is NOT an in-repo fixture`, !p.evidenceInRepo, p.evidence);
      } else if (t.tag === h.oneDerivationTag) {
        one++;
        check(`${where}: an unverified offset ${t.offset} is not in the verified list`, !t.verified);
      } else {
        check(`${where}: offset ${t.offset} carries a known tag`, t.tag === "", JSON.stringify(t.tag));
      }
      check(`${where}: the rendered line at offset ${t.offset} carries exactly the tag it reports`,
        t.tag === "" ? t.line.indexOf("cold-boot verified") === -1 && t.line.indexOf(h.oneDerivationTag) === -1 : t.line.indexOf(" " + t.tag + (t.line.endsWith(t.tag) ? "" : " ")) !== -1,
        t.line);
      // the flat string must never appear in a line whose platform has no in-repo fixture, however it got there
      check(`${where}: no unbacked line contains the flat claim at offset ${t.offset}`,
        p.evidenceInRepo || t.line.indexOf(h.flatTag + " ") === -1 && !t.line.endsWith(h.flatTag), t.line);
    }
    for (const o of p.verifiedTargets) {
      const t = p.targets.find((x) => x.offset === o);
      check(`${where}: verified target ${o} was rendered`, t !== undefined);
      if (t && t.tag !== "") check(`${where}: verified target ${o} carries the tag its evidence allows`, t.tag === (p.evidenceInRepo ? h.flatTag : h.offRepoTag), t.tag);
    }
    if (p.verifiedTargets.length) {
      check(`${where}: the verification lines say which tag and where the derivations are`,
        p.verificationLines.length >= 2 && p.verificationLines[0].endsWith(p.evidenceInRepo ? h.flatTag : h.offRepoTag) &&
        p.verificationLines.some((l) => l.indexOf(p.evidence) !== -1), JSON.stringify(p.verificationLines));
    }
  }
  check(`${h.head}: the guard saw all three kinds of tag (it can tell them apart)`, flat > 0 && offRepo > 0 && one > 0, `flat ${flat}, off-repository ${offRepo}, one-derivation ${one}`);
  console.log(`  ${h.head}: ${h.platforms.length} platforms, ${flat} flat, ${offRepo} off-repository, ${one} one-derivation`);
}

// ---- the two heads must render the same thing ---------------------------------------------------
{
  const key = (p) => p.game + "/" + p.platform;
  const a = heads[0], b = heads[1];
  check("both heads render the same platforms", JSON.stringify(a.platforms.map(key)) === JSON.stringify(b.platforms.map(key)),
    JSON.stringify([a.platforms.map(key), b.platforms.map(key)]));
  for (const pa of a.platforms) {
    const pb = b.platforms.find((x) => key(x) === key(pa));
    if (!pb) continue;
    for (const f of ["evidence", "note", "evidenceInRepo"]) check(`${key(pa)}: the heads agree on ${f}`, JSON.stringify(pa[f]) === JSON.stringify(pb[f]), JSON.stringify([pa[f], pb[f]]));
    check(`${key(pa)}: the heads render the same verification lines`, JSON.stringify(pa.verificationLines) === JSON.stringify(pb.verificationLines), JSON.stringify([pa.verificationLines, pb.verificationLines]));
    check(`${key(pa)}: the heads render the same target lines`, JSON.stringify(pa.targets) === JSON.stringify(pb.targets),
      JSON.stringify([pa.targets.filter((t, i) => JSON.stringify(t) !== JSON.stringify(pb.targets[i])), pb.targets.filter((t, i) => JSON.stringify(t) !== JSON.stringify(pa.targets[i]))]).slice(0, 600));
  }
}

// ---- the other half: an in-repo claim must be a fixture that exists and carries the row ----------
// (the fixtures live in RNG Solution, which owns the derivations; without that checkout this half
// cannot run and the guard says so instead of passing quietly)
let degraded = "";
const inRepoPlatforms = heads[0].platforms.filter((p) => p.evidenceInRepo && p.verifiedTargets.length);
if (!rngRoot) {
  degraded = "no RNG Solution checkout given (--rng): the fixture rows behind " + inRepoPlatforms.length + " flat-claim platforms were NOT read";
} else if (!fs.existsSync(path.join(rngRoot, "rngsolution", "data", "red", "platforms.json"))) {
  degraded = "--rng " + rngRoot + " is not an RNG Solution checkout: the fixture rows behind " + inRepoPlatforms.length + " flat-claim platforms were NOT read";
} else {
  let rows = 0;
  for (const p of inRepoPlatforms) {
    const rel = p.evidence.slice(FIXTURE_PREFIX.length).split(/\s/)[0];
    const file = path.join(rngRoot, FIXTURE_PREFIX, rel);
    const where = `${p.game}/${p.platform}`;
    check(`${where}: the fixture ${rel} its flat claim names exists`, fs.existsSync(file), file);
    if (!fs.existsSync(file)) continue;
    const table = {};
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line || line.startsWith("#")) continue;
      const c = line.trim().split(",");
      if (!/^\d+$/.test(c[0])) continue;
      table[Number(c[0])] = c.slice(1);
    }
    for (const t of p.targets.filter((x) => x.verified)) {
      const r = table[t.offset];
      check(`${where}: ${rel} carries a row for verified target ${t.offset}`, r !== undefined);
      if (!r) continue;
      rows++;
      const tid = t.tid.replace(/^.*\(\$/, "").replace(/\).*$/, "");
      check(`${where}: ${rel} row ${t.offset}: the three cold boots agree and are the shipped table's ID ${tid}`,
        r[0] === r[1] && r[1] === r[2] && r[0] === tid, JSON.stringify(r));
      check(`${where}: ${rel} row ${t.offset}: the outside-plateau control disagrees`, r[3] !== tid, JSON.stringify(r));
    }
  }
  check("the fixture half read some rows (it has fired)", rows > 0, String(rows));
  console.log(`  fixture rows read from ${rngRoot}: ${rows}`);
}

if (failures) { console.error(`verification claims guard: ${checks} checks, ${failures} FAILURE(S)`); process.exit(1); }
if (degraded) {
  console.log(`verification claims guard: ${checks} checks, 0 failures, but DEGRADED - ${degraded}`);
  process.exit(3);
}
console.log(`verification claims guard: ${checks} checks, 0 failures (both heads, fixtures read)`);
