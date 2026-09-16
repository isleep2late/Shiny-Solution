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
  // minutesBefore has to describe the timer the user actually runs. It used to do its
  // own arithmetic with the calibration dropped, so it disagreed with these very phases
  // for 9.4% of (delay, second) pairs at the app's default calibration - and the number
  // is printed beside the countdown as how far to set the DS clock back, so being one
  // minute out fails the manip silently. The vector above pins the uncalibrated value;
  // this pins the thing that actually matters.
  const spanned = Math.floor((phases.phase1Ms + phases.phase2Ms) / 60000);
  check(`minutesBefore agrees with phases ${t.td}/${t.ts}`, gen4.minutesBefore(t.td, t.ts, t.cd, t.cs), spanned);
  check(`calibrate ${t.td}/${t.ts}`, gen4.calibrate(t.cd, t.td, t.td + 40), t.calibrated);
}

// The exact pair the old code got wrong, kept as a named case because none of the
// three timer vectors above happens to be one of the 26,516 (of 282,060) that
// disagreed: at the app's default calibration (500 / 14) the timer for delay 300 at
// second 19 spans a whole minute, and minutesBefore used to say zero.
{
  const p = gen4.timerPhases(300, 19, 500, 14);
  check("minutesBefore 300/19 agrees with its phases", gen4.minutesBefore(300, 19, 500, 14), Math.floor((p.phase1Ms + p.phase2Ms) / 60000));
  check("minutesBefore 300/19 is 1 minute", gen4.minutesBefore(300, 19, 500, 14), 1);
}

// An out-of-range calibrated second used to spin `while (p1 < 14000) p1 += 60000`
// forever, hanging the tab rather than showing a bad number.
for (const bad of [Infinity, -Infinity, NaN]) {
  const p = gen4.timerPhases(600, 45, 500, bad);
  check(`timerPhases returns on ${bad}`, isFinite(p.phase1Ms), false);
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
