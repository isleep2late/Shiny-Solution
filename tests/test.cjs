const fs = require("fs");
const path = require("path");
const core = require(path.join(__dirname, "..", "core", "rng.js"));

const vectorsPath = process.argv[2] || path.join(__dirname, "vectors.json");
const vectors = JSON.parse(fs.readFileSync(vectorsPath, "utf8"));

let failures = 0;

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
  }
}

for (const [seed, seq] of Object.entries(vectors.sequences)) {
  let s = Number(seed) >>> 0;
  const got = [];
  for (let i = 0; i < seq.length; i++) {
    s = core.next(s);
    got.push(s);
  }
  check(`sequence seed=${seed}`, got, seq);
}

for (const j of vectors.jumps) {
  check(`jump seed=${j.seed} n=${j.n}`, core.jump(j.seed, j.n), j.state);
}

for (const m of vectors.method1) {
  const s = core.jump(0x5a0, m.advance);
  const mon = core.method1(s);
  check(`method1 adv=${m.advance}`, {
    pid: mon.pid,
    nature: mon.nature,
    natureName: mon.natureName,
    genderValue: mon.genderValue,
    ivs: mon.ivs,
    advance: m.advance
  }, m);
}

for (const t of vectors.tidPairs) {
  const found = core.findByTid(0x5a0, 0, t.tid, t.sid, t.advance + 10);
  const match = found.find((f) => f.advance === t.advance);
  check(`tidPair adv=${t.advance}`, match, t);
}

{
  const anchor = vectors.shinyAnchor;
  const hits = core.searchStarter(core.jump(0x5a0, 701), 701, anchor.tid, anchor.sid, {
    maxAdvance: 3000000,
    limit: vectors.shinyHits.length
  });
  const got = hits.map((h) => ({
    pid: h.pid,
    nature: h.nature,
    natureName: h.natureName,
    genderValue: h.genderValue,
    ivs: h.ivs,
    advance: h.advance
  }));
  check("shinyHits", got, vectors.shinyHits);
  for (const h of hits) {
    if (!core.isShiny(h.pid, anchor.tid, anchor.sid)) {
      failures++;
      console.error(`FAIL shiny invariant pid=${h.pid}`);
    }
  }
}

{
  const s = 0xdeadbeef >>> 0;
  check("jump composition", core.jump(s, 12345), core.jump(core.jump(s, 12000), 345));
  check("jump single", core.jump(s, 1), core.next(s));
  check("jump zero", core.jump(s, 0), s);
}

{
  const searched = core.searchTid(0x5a0, 0, vectors.tidPairs[2].tid, { maxAdvance: 600, limit: 5 });
  const hit = searched.find((r) => r.advance === vectors.tidPairs[2].advance);
  check("searchTid finds known pair", hit, vectors.tidPairs[2]);
}

if (failures > 0) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log("all vector and invariant checks passed");
