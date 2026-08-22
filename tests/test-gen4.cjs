const fs = require("fs");
const path = require("path");
const gen4 = require(path.join(__dirname, "..", "core", "gen4.js"));
const gen12 = require(path.join(__dirname, "..", "core", "gen12.js"));

const vectorsPath = process.argv[2] || path.join(__dirname, "gen4-vectors.json");
const v = JSON.parse(fs.readFileSync(vectorsPath, "utf8"));

let failures = 0;

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
  }
}

for (const c of v.seedCases) {
  check(`seed ${c.y}-${c.mo}-${c.d} ${c.h}:${c.mi}:${c.s} d${c.dl}`, gen4.seed(c.y, c.mo, c.d, c.h, c.mi, c.s, c.dl), c.seed);
}

for (const t of v.tidSids) {
  const got = gen4.tidSid(t.seed);
  check(`tidSid ${t.seed}`, { tid: got.tid, sid: got.sid }, { tid: t.tid, sid: t.sid });
}

for (const f of v.flips) {
  check(`coinFlips ${f.seed}`, gen4.coinFlips(f.seed, 20), f.flips);
}

for (const e of v.elm) {
  check(`elmCalls ${e.seed}`, gen4.elmCalls(e.seed, 12, 2), e.calls);
}

for (const t of v.timers) {
  const phases = gen4.timerPhases(t.td, t.ts, t.cd, t.cs);
  check(`timer p1 ${t.td}/${t.ts}`, phases.phase1Ms, t.p1);
  check(`timer p2 ${t.td}/${t.ts}`, phases.phase2Ms, t.p2);
  check(`minutesBefore ${t.td}/${t.ts}`, gen4.minutesBefore(t.td, t.ts), t.minutesBefore);
  check(`calibrate ${t.td}/${t.ts}`, gen4.calibrate(t.cd, t.td, t.td + 40), t.calibrated);
}

{
  const want = gen4.tidSid(0x12345678).tid;
  const got = gen4.searchTid(want, 2026, 8, 21, 10, 30, 0, 3000, 5)
    .map((r) => ({ Second: r.second, Delay: r.delay, SeedValue: r.seed, Tid: r.tid, Sid: r.sid }));
  check("searchTid parity", got, v.search);
}

{
  check("gen2 shiny rule positive", gen12.isShinyDvs(10, 10, 10, 10), true);
  check("gen2 shiny rule negative def", gen12.isShinyDvs(10, 9, 10, 10), false);
  check("gen2 shiny atk set", gen12.SHINY_ATK_DVS, [2, 3, 6, 7, 10, 11, 14, 15]);
  check("gen2 word 2AAA shiny", gen12.isShinyWord(0x2aaa), true);
  check("gen2 word 1AAA not shiny", gen12.isShinyWord(0x1aaa), false);
  check("gen2 word FAAA shiny", gen12.isShinyWord(0xfaaa), true);
  check("gen2 pack/unpack roundtrip", gen12.unpack(gen12.pack(7, 10, 10, 10)), { atk: 7, def: 10, spe: 10, spc: 10 });
  check("gen1 hp dv", gen12.gen1HpDv(15, 10, 10, 10), 8);
}

if (failures > 0) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log("all gen4/gen12 parity checks passed");
