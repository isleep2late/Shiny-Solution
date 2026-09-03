// JS <-> C# cross-check for core/seedtime4.js and app/Core/SeedTime4.cs on random inputs.
//   node tests/seedtime4-cross.cjs inputs <out.json> [count]      writes deterministic random inputs
//   node tests/seedtime4-cross.cjs compare <inputs.json> <csharp-out.json>
// The C# side answers the same inputs with `ShinySolution.Tests --seedtime4-cross <inputs.json> <out.json>`.
const fs = require("fs");
const path = require("path");
const st = require(path.join(__dirname, "..", "core", "seedtime4.js"));

let x = 0xc0ffee42 >>> 0;
function rnd() { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; }
const ri = (n) => rnd() % n;
const GAMES = ["DPPt", "HGSS"];

function makeInputs(total) {
  const inputs = { seedToTimes: [], calibrate: [], ivs: [], pids: [], reachable: [], wanted: [], planner: [], tidToSeeds: [], mtSecond: [], chatot: [] };
  const share = { seedToTimes: 40, calibrate: 40, ivs: 60, pids: 40, reachable: 20, wanted: 20, planner: 20, tidToSeeds: 10, mtSecond: 30, chatot: 20 };
  const scale = total / 300;
  for (let i = 0; i < Math.round(share.seedToTimes * scale); i++) inputs.seedToTimes.push({ seed: rnd(), year: 2000 + ri(100), forceSecond: i % 3 === 0 ? null : ri(60), pokefinderDelay: i % 5 === 0 });
  // the carry into the hour byte: low16 below year - 2000, a third with the hour byte 0, half in PokeFinder's convention
  for (let i = 0; i < Math.round(10 * scale); i++) {
    const seed = ((ri(256) << 24) | ((i % 3 === 0 ? 0 : 1 + ri(23)) << 16) | ri(50)) >>> 0;
    inputs.seedToTimes.push({ seed, year: 2050 + ri(50), forceSecond: i % 2 === 0 ? null : ri(60), pokefinderDelay: i % 2 === 1 });
  }
  for (let i = 0; i < Math.round(share.calibrate * scale); i++) {
    // keep the hour byte a clock hour so the row is a real time
    const seed = ((ri(256) << 24) | (ri(24) << 16) | ri(65536)) >>> 0;
    inputs.calibrate.push({ seed, game: GAMES[i % 2], delayRange: ri(4), secondRange: ri(3), year: 2000 + ri(60), forceSecond: i % 4 === 0 ? ri(60) : null,
      roamers: { raikou: i % 3 === 0, entei: i % 5 === 0, lati: i % 7 === 0 }, routes: { raikou: [0, 29, 42][i % 3], entei: [0, 33][i % 2], lati: [0, 5, 24][i % 3] }, elmWays: i % 6 === 0 ? 2 : 3 });
  }
  for (let i = 0; i < Math.round(share.ivs * scale); i++) inputs.ivs.push({ ivs: [ri(32), ri(32), ri(32), ri(32), ri(32), ri(32)], method: i % 2 ? "M4" : "M1" });
  for (let i = 0; i < Math.round(share.pids * scale); i++) inputs.pids.push(rnd());
  for (let i = 0; i < Math.round(share.reachable * scale); i++) inputs.reachable.push({ origins: [rnd(), rnd()], callsBefore: ri(3), maxFrame: 20 + ri(200) });
  for (let i = 0; i < Math.round(share.wanted * scale); i++) {
    const w = { method: i % 2 ? "M4" : "M1", maxFrame: 50 + ri(200), delayMin: ri(3000), delayMax: 8000 + ri(60000), targetDelay: 500 + ri(6000), yearMin: 2000, yearMax: 2000 + ri(100), limit: 30, forceSecond: i % 3 === 0 ? ri(60) : null };
    if (i % 4 === 3) { w.pid = rnd(); } else { w.ivs = { hp: ri(32), atk: ri(32), def: ri(32), spa: ri(32), spd: ri(32), spe: ri(32) }; if (i % 4 === 1) { w.tid = ri(65536); w.sid = ri(65536); } }
    inputs.wanted.push(w);
  }
  for (let i = 0; i < Math.round(share.planner * scale); i++) inputs.planner.push({ current: ri(1000), target: ri(3000), partyCount: 1 + ri(6), tools: [["walk128", "journal", "chatot"], ["journal", "chatot"], ["chatot"], ["walk128", "elmCall"]][i % 4] });
  for (let i = 0; i < Math.round(share.tidToSeeds * scale); i++) { const d = ri(60000); inputs.tidToSeeds.push({ tid: ri(65536), year: 2000 + ri(50), delayMin: d, delayMax: d + 2 }); }
  for (let i = 0; i < Math.round(share.mtSecond * scale); i++) inputs.mtSecond.push(rnd());
  for (let i = 0; i < Math.round(share.chatot * scale); i++) inputs.chatot.push({ seed: rnd(), count: 1 + ri(12) });
  return inputs;
}

const rowPick = (r) => ({ year: r.year, month: r.month, day: r.day, hour: r.hour, minute: r.minute, second: r.second, delay: r.delay });
function answer(inputs) {
  return {
    seedToTimes: inputs.seedToTimes.map((c) => st.seedToTimes(c.seed, c.year, { forceSecond: c.forceSecond, limit: 200, pokefinderDelay: !!c.pokefinderDelay }).map(rowPick)),
    calibrate: inputs.calibrate.map((c) => st.calibrateRows(c.seed, c.delayRange, c.secondRange, c.game, { year: c.year, forceSecond: c.forceSecond, roamers: c.roamers, routes: c.routes, elmWays: c.elmWays })
      .map((r) => ({ year: r.year, month: r.month, day: r.day, hour: r.hour, minute: r.minute, second: r.second, delay: r.delay, secondOffset: r.secondOffset, delayOffset: r.delayOffset, seed: r.seed, sequence: r.sequence,
        roamer: r.roamer ? { raikou: r.roamer.raikou, entei: r.roamer.entei, lati: r.roamer.lati, skips: r.roamer.skips, routeString: r.roamer.routeString } : null }))),
    ivs: inputs.ivs.map((c) => (c.method === "M4" ? st.ivsToSeedsSkip : st.ivsToSeeds).apply(null, c.ivs)),
    pids: inputs.pids.map((p) => st.pidToSeeds(p)),
    reachable: inputs.reachable.map((c) => st.reachableSeeds(c.origins, { callsBefore: c.callsBefore, maxFrame: c.maxFrame }).map((r) => ({ seed: r.seed, frame: r.frame, hour: r.hour, origin: r.origin }))),
    wanted: inputs.wanted.map((w) => st.wantedToTimes({ ivs: w.ivs, pid: w.pid, tid: w.tid, sid: w.sid, method: w.method, maxFrame: w.maxFrame, delayMin: w.delayMin, delayMax: w.delayMax, targetDelay: w.targetDelay, yearMin: w.yearMin, yearMax: w.yearMax, limit: w.limit, forceSecond: w.forceSecond })
      .map((r) => ({ seed: r.seed, frame: r.frame, year: r.year, month: r.month, day: r.day, hour: r.hour, minute: r.minute, second: r.second, delay: r.delay, delayDistance: r.delayDistance, pid: r.pid, nature: r.nature, ivs: [r.ivs.hp, r.ivs.atk, r.ivs.def, r.ivs.spa, r.ivs.spd, r.ivs.spe], shiny: r.shiny }))),
    planner: inputs.planner.map((c) => { const p = st.planAdvances(c.current, c.target, { partyCount: c.partyCount, tools: c.tools }); return { needed: p.needed, plan: p.plan.map((s) => ({ tool: s.tool, uses: s.uses, perUse: s.perUse, advances: s.advances })), remainder: p.remainder }; }),
    tidToSeeds: inputs.tidToSeeds.map((c) => st.tidToSeeds(c.tid, c.year, c.delayMin, c.delayMax).map((r) => ({ seed: r.seed, delay: r.delay, tid: r.tid, sid: r.sid, tsv: r.tsv }))),
    mtSecond: inputs.mtSecond.map((s) => st.mtSecondOutput(s)),
    chatot: inputs.chatot.map((c) => st.chatotSequence(c.seed, c.count))
  };
}

function canon(o) {
  if (Array.isArray(o)) return o.map(canon);
  if (o && typeof o === "object") { const r = {}; for (const k of Object.keys(o).sort()) r[k] = canon(o[k]); return r; }
  return o;
}

const mode = process.argv[2];
if (mode === "inputs") {
  const inputs = makeInputs(Number(process.argv[4] || 300));
  fs.writeFileSync(process.argv[3], JSON.stringify(inputs));
  const n = Object.keys(inputs).reduce((s, k) => s + inputs[k].length, 0);
  console.log(`wrote ${n} cross-check inputs to ${process.argv[3]}`);
} else if (mode === "compare") {
  const inputs = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
  const cs = JSON.parse(fs.readFileSync(process.argv[4], "utf8"));
  const js = answer(inputs);
  let failures = 0, n = 0;
  for (const k of Object.keys(js)) {
    for (let i = 0; i < js[k].length; i++) {
      n++;
      const a = JSON.stringify(canon(js[k][i])), b = JSON.stringify(cs[k] ? canon(cs[k][i]) : undefined);
      if (a !== b) { failures++; console.error(`FAIL cross ${k}[${i}]\n  js ${a.slice(0, 300)}\n  cs ${b === undefined ? "missing" : b.slice(0, 300)}`); }
    }
  }
  if (failures) { console.error(`${failures} JS/C# seedtime4 mismatch(es) in ${n} inputs`); process.exit(1); }
  console.log(`JS/C# seedtime4 cross-check: ${n} inputs agree`);
} else {
  console.error("usage: seedtime4-cross.cjs inputs <out.json> [count] | compare <inputs.json> <csharp-out.json>");
  process.exit(2);
}
