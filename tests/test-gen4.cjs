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
  check(`minutesSpanned agrees with phases ${t.td}/${t.ts}`, gen4.minutesSpanned(t.td, t.ts, t.cd, t.cs), spanned);
  // and minutesBefore stays EonTimer's calibration-0 figure (gen4Timer.ts:25-29)
  const eon = gen4.timerPhases(t.td, t.ts, 0, 0);
  check(`minutesBefore is the calibration-0 span ${t.td}/${t.ts}`, gen4.minutesBefore(t.td, t.ts), Math.floor((eon.phase1Ms + eon.phase2Ms) / 60000));
  check(`calibrate ${t.td}/${t.ts}`, gen4.calibrate(t.cd, t.td, t.td + 40), t.calibrated);
}

// The pair where EonTimer's figure and the calibrated span part ways, kept by name
// because none of the three timer vectors above is one of the 26,516 (of 282,060)
// that do: at the default calibration (500 / 14), delay 300 at second 19 winds p1
// across the 14 s minimum, so the calibrated timer spans a whole minute while the
// calibration-0 figure EonTimer shows is zero. Both must be reported, and the UI
// must show both when they differ - a DS clock set by the wrong one misses the seed.
{
  check("minutesBefore 300/19 is EonTimer's 0", gen4.minutesBefore(300, 19), 0);
  check("minutesSpanned 300/19 @500/14 is 1", gen4.minutesSpanned(300, 19, 500, 14), 1);
  check("the two differ here, by design", gen4.minutesBefore(300, 19) !== gen4.minutesSpanned(300, 19, 500, 14), true);
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


// ---- Cute Charm TID/SID (decomp: pokeplatinum pokemon.c sub_02074128 / pokeheartgold GenPersonalityByGenderAndNature) ----
{
  // Smogon part 5's worked example: 20101/20101 -> "Male Lead Shiny Group 1", PIDs 0x00-0x07
  const cc = gen4.cuteCharm(20101, 20101);
  check("cuteCharm 20101/20101 tsv", cc.tsv, 0);
  check("cuteCharm 20101/20101 male-lead natures", cc.groups[0].natures, [0, 1, 2, 3, 4, 5, 6, 7]);
  check("cuteCharm 20101/20101 male-lead pids", cc.groups[0].pids, [0, 1, 2, 3, 4, 5, 6, 7]);
  check("cuteCharm 20101/20101 chance", Math.round(cc.groups[0].chance * 10000), 2133);
  check("cuteCharm 20101/20101 only the male-lead group", cc.groups.length, 1);
  // the forced-male PID bases per ratio: 50, 75, 150, 200, 250 (25 * (floor(ratio/25) + 1))
  check("cuteCharmPid bases", gen4.GENDER_RATIOS.map((r) => gen4.cuteCharmPid(r.ratio, "male", 0)), [50, 75, 150, 200, 250]);
  // female lead vs 87.5%-male species: PIDs 50-74 -> PSV 6..9, so TSV 7 gets natures 6-13
  const cc7 = gen4.cuteCharm(7 << 3, 0);
  const g7 = cc7.groups.find((g) => g.lead === "female" && /87\.5% male/.test(g.ratio));
  check("cuteCharm tsv7 female lead vs 87.5% male", g7 && g7.natures, [6, 7, 8, 9, 10, 11, 12, 13]);
  // every reported nature is shiny by the Gen 4 rule and every unreported one is not: exhaustive over 300 random pairs
  let bad = 0, seen = 0;
  for (let i = 0; i < 300; i++) {
    const tid = (i * 7919 + 13) & 0xffff, sid = (i * 104729 + 977) & 0xffff;
    const r = gen4.cuteCharm(tid, sid);
    const combos = [["female", 31]].concat(gen4.GENDER_RATIOS.map((x) => ["male", x.ratio]));
    for (const [forced, ratio] of combos) {
      const g = r.groups.find((x) => x.target === forced && (forced === "female" || x.ratio === gen4.GENDER_RATIOS.find((y) => y.ratio === ratio).label));
      for (let n = 0; n < 25; n++) {
        const pid = gen4.cuteCharmPid(ratio, forced, n);
        const shiny = ((tid ^ sid ^ (pid >>> 16) ^ (pid & 0xffff)) & 0xffff) < 8;
        const reported = !!(g && g.natures.includes(n));
        if (shiny !== reported) bad++;
        seen++;
      }
    }
  }
  check("cuteCharm agrees with the shiny rule on every nature", [bad, seen > 30000], [0, true]);
  // the 12.5%-male ratio: forced-male natures 6-24 wrap past 255 and come out female
  // TSV 31 holds PIDs 250-255 (natures 0-5, genuinely male); TSV 32 holds 256-263 (natures 6-13), all wrapped to female
  const ok31 = gen4.cuteCharm(31 << 3, 0).groups.find((g) => /12\.5% male/.test(g.ratio));
  check("cuteCharm 12.5%-male TSV 31: natures 0-5, no wrap", [ok31 && ok31.natures, ok31 && ok31.genderMismatch], [[0, 1, 2, 3, 4, 5], []]);
  const wrap = gen4.cuteCharm(32 << 3, 0).groups.find((g) => /12\.5% male/.test(g.ratio));
  check("cuteCharm 12.5%-male TSV 32: natures 6-13 all wrap to female", [wrap && wrap.natures, wrap && wrap.genderMismatch], [[6, 7, 8, 9, 10, 11, 12, 13], [6, 7, 8, 9, 10, 11, 12, 13]]);
  check("cuteCharmTable: TSV 0-3, 6-12, 18-21, 25-28, 31-34 have groups", gen4.cuteCharmTable().map((r) => r.tsv), [0, 1, 2, 3, 6, 7, 8, 9, 10, 11, 12, 18, 19, 20, 21, 25, 26, 27, 28, 31, 32, 33, 34]);
}

if (failures > 0) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log("all gen4/gen12 parity checks passed");
