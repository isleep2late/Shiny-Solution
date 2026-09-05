#!/usr/bin/env node
// Emits tests/seedtime4-vectors.json for core/seedtime4.js and app/Core/SeedTime4.cs.
//
//   node tools/gen-seedtime4-vectors.cjs [pokefinder-checkout] [out.json]
//
// Oracle cases are copied from PokeFinder's own test data (GPL-3, Test/Gen4/seedtotime4.json, Test/Gen4/id4.json,
// Test/RNG/lcrngreverse.json) with their names kept as ids. The reversal cases are mapped from PokeFinder's
// return convention (the IV1 state / the PID-low state) to PKHeX's (one LCRNG step earlier) by prev(); both
// lists are stored. The two gate cases come from RNG_GUIDE_DESIGN.md:791 and :956 and are checked by
// running the LCRNG forward from the seed. The round-trip cases are built by running the LCRNG forward from
// seeds of a fixed xorshift stream; their `results` arrays are this JS module's output (a parity fixture for
// C#), while the inclusion and soundness checks in the harnesses do not depend on them. The roamer cases are
// derived from the decomp's route tables (field_roamer.c:24-69, 236-254), not from the module's routeJ/routeK.
const fs = require("fs");
const path = require("path");
const st = require(path.join(__dirname, "..", "core", "seedtime4.js"));
const gen4 = require(path.join(__dirname, "..", "core", "gen4.js"));
const core = require(path.join(__dirname, "..", "core", "rng.js"));

const pf = process.argv[2] || "/tmp/PokeFinder";
const out = process.argv[3] || path.join(__dirname, "..", "tests", "seedtime4-vectors.json");
const readPf = (p) => JSON.parse(fs.readFileSync(path.join(pf, p), "utf8"));

let x = 0x5eed7e57 >>> 0;
function rnd() { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; }
function rndInt(n) { return rnd() % n; }

const v = {
  source: {
    module: "core/seedtime4.js + app/Core/SeedTime4.cs",
    pokefinder: "PokeFinder Test/Gen4/seedtotime4.json, Test/Gen4/id4.json, Test/RNG/lcrngreverse.json (GPL-3; ids kept)",
    pkhex: "PKHeX.Core/Legality/RNG/Algorithms/LCRNGReversal.cs, LCRNGReversalSkip.cs (return convention of ivsToSeeds/pidToSeeds)",
    gate: "RNG_GUIDE_DESIGN.md:791 (7B0448D1 -> frame 0) and :956 (7B0459CB -> frame 3)",
    roundTrip: "xorshift32 stream seeded 0x5EED7E57; results arrays are this module's output (parity fixture)",
    prng: "xorshift32 seed 0x5EED7E57"
  }
};

// ---- PokeFinder seed-to-time (three of the four cases are a year past 2000 + low16 with the hour byte 0:
// PokeFinder writes them as hour 0 with the delay wrapped to a u32, the module's pokefinderDelay option)
v.seedToTimes = readPf("Test/Gen4/seedtotime4.json").calculateTimes.map((c) => ({
  id: "pokefinder/seedtotime4/calculateTimes/" + c.name, seed: c.seed, year: c.year, forceSecond: 0, convention: "pokefinder",
  results: c.results.map((r) => ({ year: r.year, month: r.month, day: r.day, hour: r.hour, minute: r.minute, second: r.second, delay: r.delay }))
}));

// ---- the hardware decomposition: when low16 < year - 2000 the console's sum carried into the hour byte, so
// the real time is hour cd-1 with delay + 0x10000 (none when the hour byte is 0). `results` are the module's
// rows (parity fixture); the harnesses rebuild every bruteForce case from scratch over every clock time with
// delay 0..65535 through gen4.seed, and `pokefinder` is the first row in PokeFinder's convention.
const pickRow = (r) => ({ year: r.year, month: r.month, day: r.day, hour: r.hour, minute: r.minute, second: r.second, delay: r.delay });
v.seedToTimesHardware = [
  { id: "hardware/carry/E80E0001-2018", seed: 0xe80e0001, year: 2018, forceSecond: 59, note: "low16 1 < 18: hour 13 (byte 14), delay 65519" },
  { id: "hardware/carry/6F0B0008-2009", seed: 0x6f0b0008, year: 2009, forceSecond: null, note: "low16 8 < 9: hour 10 (byte 11), delay 65535" },
  { id: "hardware/carry/hour-byte-0/40000000-2025", seed: 0x40000000, year: 2025, forceSecond: 0, note: "PokeFinder's own case: the hour byte is 0, so no clock hour reaches the seed in 2025" },
  { id: "hardware/plain/gate-7B0448D1-2000", seed: 0x7b0448d1, year: 2000, forceSecond: 59 },
  { id: "hardware/plain/E80E0001-2000", seed: 0xe80e0001, year: 2000, forceSecond: 59, note: "the same seed in 2000: hour 14, delay 1" },
  { id: "hardware/overflow-and-carry/01190005-2010", seed: 0x01190005, year: 2010, forceSecond: 0, bruteForce: false, note: "hour byte 25 with low16 5 < 10: hour 23, delay 131067 (beyond the brute force's 65535)" }
].map((c) => Object.assign({}, c, {
  results: st.seedToTimes(c.seed, c.year, { forceSecond: c.forceSecond }).map(pickRow),
  pokefinder: st.seedToTimes(c.seed, c.year, { forceSecond: c.forceSecond, pokefinderDelay: true, limit: 1 }).map(pickRow)
}));

// ---- the carry through the search: the frame-0 mon of a carried seed is found at the carried time
v.carrySearch = [0xe80e0001, 0x40000000].map((seed) => ({ seed, frame: 0, method: "M1", ivs: st.monFromFrameSeed(seed, "M1").ivs }));
v.carrySearch[0] = Object.assign(v.carrySearch[0], { id: "carry/search/E80E0001", year: 2018, expected: { hour: 13, delay: 65519 } });
v.carrySearch[1] = Object.assign(v.carrySearch[1], { id: "carry/search/hour-byte-0/40000000", year: 2025, expected: null, yearWithTime: 2000, delayIn2000: 0 });

// ---- PokeFinder id4
const id4 = readPf("Test/Gen4/id4.json");
v.idGenerator = id4.idgenerator4.generate.map((c) => ({
  id: "pokefinder/id4/idgenerator4/generate/" + c.name, tid: c.tid, minDelay: c.minDelay, maxDelay: c.maxDelay,
  year: c.year, month: c.month, day: c.day, hour: c.hour, minute: c.minute,
  results: c.results.map((r) => ({ delay: r.delay, seconds: r.seconds, seed: r.seed, sid: r.sid, tid: r.tid, tsv: r.tsv }))
}));
v.idSearcher = id4.idsearcher4.search.map((c) => ({
  id: "pokefinder/id4/idsearcher4/search/" + c.name, tid: c.tid, minDelay: c.minDelay, maxDelay: c.maxDelay, year: c.year,
  results: c.results.map((r) => ({ delay: r.delay, seed: r.seed, sid: r.sid, tid: r.tid, tsv: r.tsv }))
}));

// ---- PokeFinder reversal, mapped to PKHeX semantics
const rev = readPf("Test/RNG/lcrngreverse.json");
v.lcrngReverse = {
  mapping: "expected[i] = prev(pokefinder[i]): PokeFinder returns the IV1 state (LCRNGReverse.cpp recoverPokeRNGIVMethod12/4) or the PID-low state (recoverPokeRNGPID); PKHeX returns the state one call earlier (LCRNGReversal.cs:102-104, :63-65; LCRNGReversalSkip.cs:96-98)",
  ivs: rev.recoverPokeRNGIV.map((c) => ({
    id: "pokefinder/lcrngreverse/recoverPokeRNGIV/" + c.name, method: c.method === "Method4" ? "M4" : "M1", ivs: c.ivs,
    pokefinder: c.results, expected: c.results.map((s) => st.prev(s))
  })),
  pid: rev.recoverPokeRNGPID_data.map((c) => ({
    id: "pokefinder/lcrngreverse/recoverPokeRNGPID/" + c.name, pid: c.pid, pokefinder: c.results, expected: c.results.map((s) => st.prev(s))
  }))
};

// ---- gate cases (design doc), checked forward from the seed in the harnesses
v.gate = [
  { id: "design/RNG_GUIDE_DESIGN.md:791", seed: 0x7b0448d1, frame: 0, ivState: 0x7fff305a, hour: 4, delayIn2000: 18641, method: "M1", ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } },
  { id: "design/RNG_GUIDE_DESIGN.md:956", seed: 0x7b0459cb, frame: 3, ivState: 0x7ffff961, hour: 4, delayIn2000: 22987, method: "M1", ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } }
];

// ---- round trips
function ivsOf(w1, w2) { return { hp: w1 & 31, atk: (w1 >> 5) & 31, def: (w1 >> 10) & 31, spe: w2 & 31, spa: (w2 >> 5) & 31, spd: (w2 >> 10) & 31 }; }
v.ivsRoundTrip = [];
v.collisions = [
  { id: "design/RNG_GUIDE_DESIGN.md:781 flawless Method 1 states", method: "M1", ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, count: 6 },
  { id: "design/RNG_GUIDE_DESIGN.md:782 flawless Method 4 states", method: "M4", ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, count: 4 }
];
for (let i = 0; i < 500; i++) {
  const method = i % 2 === 0 ? "M1" : "M4";
  const origin = rnd();
  const s3 = st.next(origin), s4 = st.next(s3), s5 = st.next(s4);
  const ivs = ivsOf(s3 >>> 16, (method === "M4" ? s5 : s4) >>> 16);
  const results = st.ivsToSeedsByMethod(ivs, method);
  v.ivsRoundTrip.push({ origin, method, ivs, results });
  if (results.length >= 8) v.collisions.push({ id: "roundTrip[" + i + "] " + method, method, ivs, count: results.length, source: "found while sampling (30 of 32 bits fixed: 4 seeds per IV set on average; sampling from a hit is size-biased, so 6 is common and 8+ is rare)" });
}
// how many seeds each sampled IV set has (twins counted): 30 bits fixed over 2^32 states gives 4 on average
v.roundTripHistogram = {};
for (const c of v.ivsRoundTrip) v.roundTripHistogram[c.results.length] = (v.roundTripHistogram[c.results.length] || 0) + 1;
v.pidRoundTrip = [];
for (let i = 0; i < 200; i++) {
  const s0 = rnd();
  const s1 = st.next(s0), s2 = st.next(s1);
  const pid = (((s2 >>> 16) << 16) | (s1 >>> 16)) >>> 0;
  v.pidRoundTrip.push({ frameSeed: s0, pid, results: st.pidToSeeds(pid) });
}

// ---- roamers from the decomp tables (independent of routeJ/routeK)
const JOHTO = [29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 42, 43, 44, 45, 46];            // field_roamer.c:26-41
const KANTO = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28]; // :44-68
function roamerFromTables(seed, roamers, routes) {
  let s = seed >>> 0, skips = 0;
  const pick = (table, prevRoute) => { let r; do { s = core.next(s); skips++; r = table[(s >>> 16) % table.length]; } while (r === prevRoute); return r; }; // :251-253
  const raikou = roamers.raikou ? pick(JOHTO, routes.raikou) : 0;
  const entei = roamers.entei ? pick(JOHTO, routes.entei) : 0;
  const lati = roamers.lati ? pick(KANTO, routes.lati) : 0;
  let str = ""; if (raikou) str += "R: " + raikou + " "; if (entei) str += "E: " + entei + " "; if (lati) str += "L: " + lati;
  return { raikou, entei, lati, skips, routeString: str };
}
v.roamer = [];
for (let i = 0; i < 60; i++) {
  const seed = rnd();
  const roamers = { raikou: i % 4 !== 1, entei: i % 3 !== 2, lati: i % 5 !== 3 };
  // previous routes: half the time force a retry by choosing the route the first roll would give
  const s1 = core.next(seed) >>> 16;
  const routes = { raikou: i % 2 === 0 ? JOHTO[s1 % 16] : 0, entei: i % 6 === 0 ? 33 : 0, lati: i % 7 === 0 ? 5 : 0 };
  v.roamer.push({ id: "roamer[" + i + "]", seed, roamers, routes, expected: roamerFromTables(seed, roamers, routes) });
}

// ---- chatot: value from the decomp's % 8192 and PokeFinder's *100 >> 13 scale; bands per Utilities.cpp getPitch
v.chatot = [];
for (let i = 0; i < 20; i++) {
  const seed = rnd();
  let s = seed; const expected = [];
  for (let k = 0; k < 8; k++) { s = core.next(s); const val = Math.floor(((s >>> 16) % 8192) * 100 / 8192); expected.push({ value: val, band: val < 20 ? "L" : val < 40 ? "ML" : val < 60 ? "M" : val < 80 ? "MH" : "H" }); }
  v.chatot.push({ seed, count: 8, expected });
}

// ---- calibrate rows (module output; the harnesses re-derive every row's seed and string independently)
v.calibrate = [
  { id: "calibrate/dppt/seed0", seed: 0, game: "DPPt", delayRange: 2, secondRange: 1, opts: { year: 2000, forceSecond: 0 } },
  { id: "calibrate/pt/gate-7B0448D1", seed: 0x7b0448d1, game: "Pt", delayRange: 3, secondRange: 2, opts: { year: 2000 } },
  { id: "calibrate/hgss/no-roamers", seed: 0x7b0459cb, game: "HGSS", delayRange: 1, secondRange: 1, opts: { year: 2000 } },
  { id: "calibrate/hgss/roamers", seed: 0x7b0459cb, game: "HGSS", delayRange: 1, secondRange: 1, opts: { year: 2000, roamers: { raikou: true, entei: true, lati: true }, routes: { raikou: 0, entei: 0, lati: 0 } } },
  { id: "calibrate/hgss/two-way", seed: 0x12345678, game: "SS", delayRange: 1, secondRange: 0, opts: { year: 2010, elmWays: 2 } },
  { id: "calibrate/dppt/midnight-underflow", seed: 0x01000000, game: "DP", delayRange: 0, secondRange: 2, opts: { year: 2000, forceSecond: 0 } },
  { id: "calibrate/dppt/year-end-wrap", seed: 0xea17ffff, game: "DP", delayRange: 0, secondRange: 1, opts: { target: { year: 2099, month: 12, day: 31, hour: 23, minute: 59, second: 59, delay: 65535 - 99 } } }
];
for (const c of v.calibrate) c.rows = st.calibrateRows(c.seed, c.delayRange, c.secondRange, c.game, c.opts);

// ---- planner (hand-computed expectations)
v.planner = [
  { id: "planner/walk-journal-chatot", current: 10, target: 137, partyCount: 3, tools: ["walk128", "journal", "chatot"],
    expected: { needed: 127, plan: [{ tool: "walk128", uses: 42, perUse: 3, advances: 126 }, { tool: "chatot", uses: 1, perUse: 1, advances: 1 }], remainder: 0 } },
  { id: "planner/journal-only-odd", current: 0, target: 7, partyCount: 1, tools: ["journal"],
    expected: { needed: 7, plan: [{ tool: "journal", uses: 3, perUse: 2, advances: 6 }], remainder: 1 } },
  { id: "planner/coin-flips-do-not-advance", current: 5, target: 9, partyCount: 6, tools: ["coinFlip", "chatot"],
    expected: { needed: 4, plan: [{ tool: "chatot", uses: 4, perUse: 1, advances: 4 }], remainder: 0 } },
  { id: "planner/behind", current: 50, target: 20, partyCount: 1, tools: ["chatot"],
    expected: { needed: -30, plan: [], remainder: 0 } },
  { id: "planner/party-larger-than-gap", current: 0, target: 4, partyCount: 6, tools: ["walk128", "journal"],
    expected: { needed: 4, plan: [{ tool: "journal", uses: 2, perUse: 2, advances: 4 }], remainder: 0 } }
];

// ---- second MT output from the full generator (independent of the fast path)
v.mtSecond = [];
for (let i = 0; i < 200; i++) { const seed = rnd(); const mt = new gen4.Mt19937(seed); mt.next(); v.mtSecond.push({ seed, expected: mt.next() }); }

fs.writeFileSync(out, JSON.stringify(v));
console.log("wrote " + out + ": " + [
  v.seedToTimes.length + " seedToTimes", v.seedToTimesHardware.length + " seedToTimesHardware", v.carrySearch.length + " carrySearch", v.idGenerator.length + " idGenerator", v.idSearcher.length + " idSearcher",
  v.lcrngReverse.ivs.length + "+" + v.lcrngReverse.pid.length + " lcrngReverse", v.gate.length + " gate",
  v.ivsRoundTrip.length + " ivsRoundTrip", v.pidRoundTrip.length + " pidRoundTrip", v.collisions.length + " collisions",
  v.calibrate.length + " calibrate (" + v.calibrate.reduce((n, c) => n + c.rows.length, 0) + " rows)", v.roamer.length + " roamer",
  v.chatot.length + " chatot", v.planner.length + " planner", v.mtSecond.length + " mtSecond"].join(", "));
