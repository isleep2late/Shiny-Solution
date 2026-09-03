// core/seedtime4.js against tests/seedtime4-vectors.json (tools/gen-seedtime4-vectors.cjs): PokeFinder's
// seed-to-time / ID / reversal cases bit for bit, the design's two gate cases run forward from the seed, the
// reversal's soundness (every returned seed reproduces the IV words / PID) and completeness sample (the
// generating seed is among the results), the roamer routes against the decomp tables, and the planner.
const fs = require("fs");
const path = require("path");
const st = require(path.join(__dirname, "..", "core", "seedtime4.js"));
const gen4 = require(path.join(__dirname, "..", "core", "gen4.js"));
const core = require(path.join(__dirname, "..", "core", "rng.js"));

const vectorsPath = process.argv[2] || path.join(__dirname, "seedtime4-vectors.json");
const v = JSON.parse(fs.readFileSync(vectorsPath, "utf8"));
let failures = 0, checks = 0;

function check(label, actual, expected) {
  checks++;
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.error(`FAIL ${label}\n  expected ${e.length > 300 ? e.slice(0, 300) + "..." : e}\n  actual   ${a.length > 300 ? a.slice(0, 300) + "..." : a}`);
  }
}
const pick = (r) => ({ year: r.year, month: r.month, day: r.day, hour: r.hour, minute: r.minute, second: r.second, delay: r.delay });
const hi15 = (s) => (s & 0x7fff0000) >>> 0;

// 1. seedToTimes: PokeFinder ordering and delay, every row re-seeds to the input, forceSecond honoured
for (const c of v.seedToTimes) {
  const rows = st.seedToTimes(c.seed, c.year, { forceSecond: c.forceSecond });
  check(`seedToTimes ${c.id}`, rows.map(pick), c.results);
  check(`seedToTimes ${c.id} rows re-seed`, rows.every((r) => st.calcSeed(r, r.delay) === c.seed), true);
  const all = st.seedToTimes(c.seed, c.year);
  check(`seedToTimes ${c.id} unforced superset`, all.length >= rows.length && all.every((r) => st.calcSeed(r, r.delay) === c.seed), true);
}
{
  // hour overflow: PokeFinder shows hour 23 and moves (cd-23)*0x10000 into the delay; the strict option drops it
  const rows = st.seedToTimes(0x00190000, 2000, { limit: 1 });
  check("seedToTimes hour overflow -> 23 + delay", [rows[0].hour, rows[0].delay], [23, 0x20000]);
  check("seedToTimes hour overflow re-seeds", st.calcSeed(rows[0], rows[0].delay), 0x00190000);
  check("seedToTimes strict hour filter", st.seedToTimes(0x00190000, 2000, { allowHourOverflow: false }).length, 0);
}

// 2. ID generator (fixed date, PokeFinder IDGenerator4 order = gen4.searchTid order) and ID searcher (all times)
for (const c of v.idGenerator) {
  const got = gen4.searchTid(c.tid, c.year, c.month, c.day, c.hour, c.minute, c.minDelay, c.maxDelay, 1000000)
    .map((r) => ({ delay: r.delay, seconds: r.second, seed: r.seed, sid: r.sid, tid: r.tid, tsv: ((r.tid ^ r.sid) >>> 3) & 0x1fff }));
  check(`idGenerator ${c.id}`, got, c.results);
}
for (const c of v.idSearcher) {
  const got = st.tidToSeeds(c.tid, c.year, c.minDelay, c.maxDelay).map((r) => ({ delay: r.delay, seed: r.seed, sid: r.sid, tid: r.tid, tsv: r.tsv }));
  check(`idSearcher ${c.id}`, got, c.results);
  check(`idSearcher ${c.id} every hit re-derives through the full MT`, got.every((r) => { const t = gen4.tidSid(r.seed); return t.tid === r.tid && t.sid === r.sid; }), true);
}
for (const c of v.mtSecond) check(`mtSecondOutput ${c.seed}`, st.mtSecondOutput(c.seed), c.expected);

// 3. reversal: PokeFinder's cases mapped to PKHeX semantics, soundness, completeness sample, collisions
function sound(r, ivs, method) {
  const w1 = (ivs.hp | (ivs.atk << 5) | (ivs.def << 10)) << 16 >>> 0;
  const w2 = (ivs.spe | (ivs.spa << 5) | (ivs.spd << 10)) << 16 >>> 0;
  const s3 = st.next(r), s4 = st.next(s3), s5 = st.next(s4);
  return hi15(s3) === w1 && hi15(method === "M4" ? s5 : s4) === w2;
}
for (const c of v.lcrngReverse.ivs) {
  const [hp, atk, def, spa, spd, spe] = c.ivs;
  const got = c.method === "M4" ? st.ivsToSeedsSkip(hp, atk, def, spa, spd, spe) : st.ivsToSeeds(hp, atk, def, spa, spd, spe);
  check(`lcrngReverse ${c.id}`, got, c.expected);
  check(`lcrngReverse ${c.id} = prev(PokeFinder)`, got.map((s) => st.next(s)), c.pokefinder);
  check(`lcrngReverse ${c.id} sound`, got.every((r) => sound(r, { hp, atk, def, spa, spd, spe }, c.method)), true);
}
for (const c of v.lcrngReverse.pid) {
  const got = st.pidToSeeds(c.pid);
  check(`lcrngReverse ${c.id}`, got, c.expected);
  check(`lcrngReverse ${c.id} sound`, got.every((s0) => { const s1 = st.next(s0), s2 = st.next(s1); return ((((s2 >>> 16) << 16) | (s1 >>> 16)) >>> 0) === c.pid; }), true);
}
for (const c of v.ivsRoundTrip) {
  const got = st.ivsToSeedsByMethod(c.ivs, c.method);
  check(`ivsRoundTrip ${c.origin} ${c.method} parity`, got, c.results);
  check(`ivsRoundTrip ${c.origin} ${c.method} contains origin`, got.indexOf(c.origin) >= 0, true);
  check(`ivsRoundTrip ${c.origin} ${c.method} sound`, got.every((r) => sound(r, c.ivs, c.method)), true);
  check(`ivsRoundTrip ${c.origin} ${c.method} twins`, got.length % 2 === 0 && got.every((r, i) => i % 2 === 1 ? r === ((got[i - 1] ^ 0x80000000) >>> 0) : true), true);
}
for (const c of v.pidRoundTrip) {
  const got = st.pidToSeeds(c.pid);
  check(`pidRoundTrip ${c.frameSeed} parity`, got, c.results);
  check(`pidRoundTrip ${c.frameSeed} contains frame seed`, got.indexOf(c.frameSeed) >= 0, true);
  check(`pidRoundTrip ${c.frameSeed} sound`, got.every((s0) => { const s1 = st.next(s0), s2 = st.next(s1); return ((((s2 >>> 16) << 16) | (s1 >>> 16)) >>> 0) === c.pid; }), true);
}
for (const c of v.collisions) check(`collisions ${c.id}`, st.ivsToSeedsByMethod(c.ivs, c.method).length, c.count);
{
  const hist = {};
  for (const c of v.ivsRoundTrip) hist[c.results.length] = (hist[c.results.length] || 0) + 1;
  check("ivsRoundTrip histogram", hist, v.roundTripHistogram);
  const mean = v.ivsRoundTrip.reduce((n, c) => n + c.results.length, 0) / v.ivsRoundTrip.length;
  check("ivsRoundTrip mean seeds per IV set near 4 (30 of 32 bits fixed; sampling from a hit biases it up)", mean > 3 && mean < 7, true);
}
{
  // the shiny path: every shiny PID of one nature for (tid, sid) reverses to seeds that regenerate it
  const pids = st.shinyPids(12345, 54321, "Modest");
  check("shinyPids all shiny and Modest", pids.every((p) => st.isShiny(p, 12345, 54321) && p % 25 === 15), true);
  check("shinyPids count", pids.length > 20000 && pids.length < 22000, true);
  let ok = true, found = 0;
  for (let i = 0; i < 2000; i++) { for (const s0 of st.pidToSeeds(pids[i])) { found++; if (st.monFromFrameSeed(s0).pid !== pids[i]) ok = false; } }
  check("shinyPids -> pidToSeeds regenerate", ok && found > 1000, true);
}

// 4. gate: the design's two flawless seeds, run forward and found by the search
for (const g of v.gate) {
  const mon = st.monFromFrameSeed(core.jump(g.seed, g.frame), g.method);
  check(`gate ${g.id} forward IVs`, mon.ivs, { hp: 31, atk: 31, def: 31, spe: 31, spa: 31, spd: 31 });
  check(`gate ${g.id} IV1 state`, core.jump(g.seed, g.frame + 3), g.ivState);
  check(`gate ${g.id} hour byte`, (g.seed >>> 16) & 0xff, g.hour);
  const rows = st.wantedToTimes({ ivs: g.ivs, method: g.method, maxFrame: 10, delayMin: 0, delayMax: 0xffff, yearMin: 2000, yearMax: 2000, targetDelay: g.delayIn2000, limit: 50 });
  const hit = rows.find((r) => r.seed === g.seed && r.frame === g.frame);
  check(`gate ${g.id} found by wantedToTimes`, !!hit, true);
  if (hit) {
    check(`gate ${g.id} delay in 2000`, hit.delay, g.delayIn2000);
    check(`gate ${g.id} time re-seeds`, gen4.seed(hit.year, hit.month, hit.day, hit.hour, hit.minute, hit.second, hit.delay), g.seed);
    check(`gate ${g.id} first row is the target delay`, rows[0].delayDistance, 0);
  }
  const none = st.wantedToTimes({ ivs: g.ivs, method: g.method, maxFrame: 10, yearMin: 2000, yearMax: 2000, delayMin: g.delayIn2000 + 1, delayMax: g.delayIn2000 + 1, limit: 50 });
  check(`gate ${g.id} excluded by a delay window that misses it`, none.some((r) => r.seed === g.seed), false);
}
{
  // reachableSeeds: only hour bytes <= 23 survive, frames count back-steps from the origin
  const cand = st.reachableSeeds([0x68501323], { callsBefore: 2, maxFrame: 8 }); // origin = prev(7FFF305A), the PID-high state
  check("reachableSeeds hour filter", cand.every((c) => c.hour <= 23), true);
  check("reachableSeeds frames", cand.map((c) => [st.hex8(c.seed), c.frame]), [["7B0448D1", 0], ["5D12A61D", 4], ["E2028A12", 5]]);
  const all = st.reachableSeeds([0x68501323], { callsBefore: 2, maxFrame: 8, allowHourOverflow: true });
  check("reachableSeeds unfiltered count", all.length, 9);
}

// 5. calibrate rows: the module's rows (parity fixture) plus an independent re-derivation of each row
for (const c of v.calibrate) {
  const rows = st.calibrateRows(c.seed, c.delayRange, c.secondRange, c.game, c.opts);
  check(`calibrate ${c.id} parity`, rows, c.rows);
  const target = c.opts.target || st.seedToTimes(c.seed, c.opts.year, { forceSecond: c.opts.forceSecond, limit: 1 })[0];
  const expectedRows = (2 * c.delayRange + 1) * (2 * c.secondRange + 1);
  const underflow = c.id.indexOf("underflow") >= 0;
  check(`calibrate ${c.id} row count`, rows.length, underflow ? expectedRows - 2 * (2 * c.delayRange + 1) : expectedRows);
  check(`calibrate ${c.id} centre row is the target`, rows.some((r) => r.secondOffset === 0 && r.delayOffset === 0 && r.seed === c.seed), true);
  for (const r of rows) {
    check(`calibrate ${c.id} row seed ${r.secondOffset}/${r.delayOffset}`, gen4.seed(r.year, r.month, r.day, r.hour, r.minute, r.second, r.delay), r.seed);
    if (r.flips !== undefined) {
      check(`calibrate ${c.id} flips ${r.seed}`, r.flips, gen4.coinFlips(r.seed, 20));
      check(`calibrate ${c.id} sequence ${r.seed}`, r.sequence, r.flips.split("").join(", "));
    } else {
      const skips = r.roamer ? r.roamer.skips : 0;
      const ways = c.opts.elmWays || 3;
      check(`calibrate ${c.id} calls ${r.seed}`, r.calls, ways === 3 ? gen4.elmCalls(r.seed, 20, skips) : (() => { let s = r.seed, o = ""; for (let i = 0; i < 20 + skips; i++) { s = core.next(s); if (i >= skips) o += (s >>> 16) % 2 === 0 ? "E" : "K"; } return o; })());
      check(`calibrate ${c.id} sequence ends with calls`, r.sequence.replace(/[^EKP]/g, "").slice(-20), r.calls);
      if (skips > 0) check(`calibrate ${c.id} skipped shown`, r.sequence.indexOf(" skipped)  ") > 0 && r.sequence[0] === "(", true);
    }
  }
}
{
  const rows = st.calibrateRows(0x01000000, 0, 2, "DP", { year: 2000, forceSecond: 0 });
  check("calibrate underflow before 2000-01-01 skips rows", rows.map((r) => r.secondOffset), [0, 1, 2]);
  const wrap = st.calibrateRows(0xea17ffff, 0, 1, "DP", { target: { year: 2099, month: 12, day: 31, hour: 23, minute: 59, second: 59, delay: 65535 - 99 } });
  check("calibrate wrap past 2099 goes to 2000-01-01", wrap.map((r) => [r.year, r.month, r.day, r.hour, r.minute, r.second]), [[2099, 12, 31, 23, 59, 58], [2099, 12, 31, 23, 59, 59], [2000, 1, 1, 0, 0, 0]]);
}

// 6. roamers (decomp tables) and Chatot
for (const c of v.roamer) check(`roamer ${c.id}`, st.roamerRoutes(c.seed, c.roamers, c.routes), c.expected);
for (const c of v.chatot) check(`chatot ${c.seed}`, st.chatotSequence(c.seed, c.count), c.expected);
check("chatot bands at the PokeFinder thresholds 20/40/60/80", [0, 1638, 1639, 3277, 4915, 4916, 6554, 8191].map((r) => st.chatotPitch(r).band), ["L", "L", "ML", "M", "M", "MH", "H", "H"]);

// 7. planner
for (const c of v.planner) {
  const got = st.planAdvances(c.current, c.target, { partyCount: c.partyCount, tools: c.tools });
  check(`planner ${c.id}`, { needed: got.needed, plan: got.plan.map((p) => ({ tool: p.tool, uses: p.uses, perUse: p.perUse, advances: p.advances })), remainder: got.remainder }, c.expected);
  check(`planner ${c.id} sums`, got.plan.reduce((n, p) => n + p.advances, 0) + got.remainder, Math.max(0, got.needed));
}
{
  const costs = st.advanceCosts();
  check("planner costs labelled", Object.keys(costs).every((k) => (costs[k].label === "STRUCTURAL" || costs[k].label === "EMPIRICAL") && costs[k].cite.length > 10), true);
  check("planner journal is EMPIRICAL", costs.journal.label, "EMPIRICAL");
  check("planner coin flip costs nothing", costs.coinFlip.perUse, 0);
}

// 8. input checking
for (const bad of [() => st.seedToTimes(-1, 2000), () => st.seedToTimes(1, 1999), () => st.seedToTimes(1, 2000, { forceSecond: 60 }),
  () => st.ivsToSeeds(32, 0, 0, 0, 0, 0), () => st.pidToSeeds(2 ** 32), () => st.calibrateRows(0, 1, 1, "Emerald"), () => st.planAdvances(0, 5, { tools: ["bicycle"] }),
  () => st.wantedToTimes({}), () => st.tidToSeeds(70000, 2000, 0, 1)]) {
  let threw = false; try { bad(); } catch (e) { threw = true; }
  check("refuses " + bad.toString().replace(/^\(\) => /, ""), threw, true);
}

if (failures > 0) { console.error(`${failures} failure(s) in ${checks} seedtime4 checks`); process.exit(1); }
console.log(`all ${checks} seedtime4 checks passed`);
