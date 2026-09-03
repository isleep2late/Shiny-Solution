// core/gen2tid.js (over core/data/gen2-tid.json) against tests/gen2tid-vectors.json, emitted by
// tests/gen2_reference.py from the derivation CSVs read directly. Every table sample, lookup, inversion,
// target, verdict, schedule, calibration and verify value must match: integers and strings exactly,
// floats to 1e-9 (relative above |1|); a case recorded as {"error": ...} must throw. A mismatch in a
// table sample is a generator bug (tools/gen-gen2-data.py) as much as an engine bug.
const fs = require("fs");
const path = require("path");
const G1 = require(path.join(__dirname, "..", "core", "gen1tid.js"));
const G = require(path.join(__dirname, "..", "core", "gen2tid.js"));

const vectorsPath = process.argv[2] || path.join(__dirname, "gen2tid-vectors.json");
const V = JSON.parse(fs.readFileSync(vectorsPath, "utf8"));
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "core", "data", "gen2-tid.json"), "utf8"));
const GEN1 = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "core", "data", "gen1-tid.json"), "utf8"));

let failures = 0;
let checks = 0;
const TOL = 1e-9;

function mismatch(label, e, a) {
  failures++;
  if (failures <= 40) console.error(`FAIL ${label}\n  expected ${JSON.stringify(e)}\n  actual   ${JSON.stringify(a)}`);
}

function same(e, a) {
  if (e === null || e === undefined) return a === null || a === undefined;
  if (typeof e === "number") {
    if (typeof a !== "number" || Number.isNaN(a)) return false;
    if (Number.isInteger(e) && Number.isInteger(a)) return e === a;
    return Math.abs(a - e) <= TOL * Math.max(1, Math.abs(e));
  }
  if (typeof e === "string" || typeof e === "boolean") return e === a;
  if (Array.isArray(e)) {
    if (!Array.isArray(a) || a.length !== e.length) return false;
    for (let i = 0; i < e.length; i++) if (!same(e[i], a[i])) return false;
    return true;
  }
  if (typeof e === "object") {
    if (!a || typeof a !== "object" || Array.isArray(a)) return false;
    const ek = Object.keys(e).sort(), ak = Object.keys(a).filter((k) => a[k] !== undefined).sort();
    if (ek.join("\0") !== ak.join("\0")) return false;
    for (const k of ek) if (!same(e[k], a[k])) return false;
    return true;
  }
  return false;
}

function check(label, expected, actual) {
  checks++;
  if (!same(expected, actual)) mismatch(label, expected, actual);
}

function checkCase(label, c, fn) {
  checks++;
  let got, threw = null;
  try { got = fn(); } catch (e) { threw = e; }
  if ("error" in c) {
    if (!threw) mismatch(label, { error: c.error }, got);
  } else if (threw) {
    mismatch(label, c.result, `threw ${threw.name}: ${threw.message}`);
  } else if (!same(c.result, got)) {
    mismatch(label, c.result, got);
  }
}

const cand = (c) => ({ key: c.key, table: c.table, members: c.members, bin: c.bin, offsets: c.offsets, tid: c.tid, lid: c.lid, sid: c.sid, family: c.family, reachableAfterFirstBoot: c.reachableAfterFirstBoot });
const inversion = (r) => ({ candidates: r.candidates.map(cand), preferred: r.preferred.map(cand), ambiguous: r.ambiguous, resolved: r.resolved ? cand(r.resolved) : null });

// ---- constants and rules --------------------------------------------------------------------------
{
  const c = V.constants;
  check("constants", c, {
    fps: G.FPS, frameMs: G.FRAME_MS, visibleMenuLagFrames: G.VISIBLE_MENU_LAG_FRAMES, binCount: G.BIN_COUNT, offsetMax: G.OFFSET_MAX,
    tapFrames: G.TAP_FRAMES, tapMs: G.TAP_MS, rollSettleS: G.ROLL_SETTLE_S, outlierFrames: G.OUTLIER_FRAMES, twoStatePrior: G.TWO_STATE_PRIOR,
    gbpResetExtraS: G1.resetAnchorExtraSeconds(GEN1.reset_models["gbp-fade"])
  });
  check("data constants", { lag: 4, poll: 4, tap: [4, 8], settle: 0.35 },
    { lag: DATA.visible_menu_lag_frames, poll: DATA.poll_period_frames, tap: DATA.tap_frames, settle: DATA.roll_settle_s });
  for (const g of Object.keys(V.binRules)) {
    const r = G.binRule(DATA, g);
    check(`binRule ${g}`, V.binRules[g], { droppedOffsets: r.dropped_offsets, bin0Offsets: r.bin0_offsets, subtract: r.subtract, acceptToRollFrames: r.accept_to_roll_frames });
  }
}

// ---- data invariants --------------------------------------------------------------------------------
{
  const csvs = Object.keys(DATA.inputs_sha1).filter((k) => k.endsWith(".csv"));
  check("162 CSV inputs recorded", 162, csvs.length);
  check("10 methodologies", 10, Object.keys(DATA.methodologies).length);
  check("152 rtc tables", 152, Object.keys(DATA.rtc.tables).length);
  for (const [id, m] of Object.entries(DATA.methodologies)) {
    check(`anchors of ${id} are known`, true, m.anchors.every((a) => G.ANCHORS.includes(a)));
    check(`timing of ${id}: visible = menu + 4`, m.timing.menu_frame + 4, m.timing.visible_menu_frame);
    check(`timing of ${id}: first poll`, m.timing.menu_frame + 1 + G.binRule(DATA, m.game_key).bin0_offsets[1], m.timing.first_poll_frame);
    check(`table_data of ${id} carries a payload`, true, !!m.table_data.tids_hex);
    for (const k of m.rtc_tables) check(`rtc table ${k} resolves`, true, !!G.resolveTable(DATA, k).record.tids_hex);
  }
  for (const [key, ts] of Object.entries(DATA.target_sets)) check(`target set ${key} is community-script with hits measured`, true, ts.protocol === "community-script" && Array.isArray(ts.single_press_hits));
  check("header lines deduplicated", true, Object.keys(DATA.header_lines).length > 200 && Object.keys(DATA.header_lines).length < 300);
}

// ---- bins -------------------------------------------------------------------------------------------
for (const c of V.binEdges) check(`bin ${c.game} offset ${c.offset}`, c.bin, G.bin(DATA, c.game, c.offset));
for (const c of V.offsetsForBin) {
  const rule = G.binRule(DATA, c.game);
  checkCase(`offsetsForBin ${c.game} ${c.bin}`, c, () => ({ offsets: G.offsetsForBin(c.bin, rule), aim: G.aimOffset(c.bin, rule), visible: G.visibleWindow(c.bin, rule) }));
}

// ---- tables (the JSON payload against the CSV rows the reference read) --------------------------------
const identical = {};
for (const c of V.tables) {
  const rec = G.tableRecord(DATA, c.key);
  const res = G.resolveTable(DATA, c.key);
  const t = G.decodeTable(res.record);
  const m = G.methodologyFor(DATA, c.game, c.platformKey);
  let sumT = 0, sumL = 0, sumS = 0, sumR = 0;
  const seenT = new Set(), seenL = new Set();
  for (let b = 0; b < G.BIN_COUNT; b++) {
    sumT = (sumT + (b + 1) * t.tids[b]) % 4294967296;
    sumL = (sumL + (b + 1) * t.lids[b]) % 4294967296;
    sumS = (sumS + (b + 1) * (t.sids ? t.sids[b] : 0)) % 4294967296;
    sumR += G.rollFrame(t, m.timing, b);
    seenT.add(t.tids[b]); seenL.add(t.lids[b]);
  }
  check(`table ${c.key}`, {
    methodology: c.methodology, file: c.file, sha1: c.sha1, sameDataAs: c.sameDataAs, menuFrame: c.menuFrame, visibleMenuFrame: c.visibleMenuFrame, firstPollFrame: c.firstPollFrame,
    holdLo: c.holdLo, holdHi: c.holdHi, rows: c.rows, distinctTids: c.distinctTids, distinctLids: c.distinctLids,
    checksumTid: c.checksumTid, checksumLid: c.checksumLid, checksumSid: c.checksumSid, checksumRoll: c.checksumRoll
  }, {
    methodology: m.id, file: rec.file, sha1: rec.sha1, sameDataAs: res.key === c.key ? null : res.key, menuFrame: m.timing.menu_frame, visibleMenuFrame: m.timing.visible_menu_frame,
    firstPollFrame: m.timing.first_poll_frame, holdLo: m.timing.hold_lo_frame, holdHi: m.timing.hold_hi_frame, rows: t.tids.length, distinctTids: seenT.size, distinctLids: seenL.size,
    checksumTid: sumT, checksumLid: sumL, checksumSid: sumS, checksumRoll: sumR
  });
  check(`table ${c.key} samples`, c.samples, c.samples.map((s) => [s[0], t.tids[s[0]], t.lids[s[0]], t.sids ? t.sids[s[0]] : 0, G.rollFrame(t, m.timing, s[0])]));
  check(`table ${c.key} sha1 recorded in inputs`, c.sha1, DATA.inputs_sha1[c.file]);
  if (c.sameDataAs) (identical[c.sameDataAs] = identical[c.sameDataAs] || [c.sameDataAs]).push(c.key);
}
check("identical groups", Object.values(identical).map((g) => g.sort()).sort(), DATA.rtc.identical_tables);

// ---- lookups ----------------------------------------------------------------------------------------
for (const c of V.lookups) {
  const r = G.lookup(DATA, c.game, c.platformKey, c.state, c.bin);
  check(`lookup ${c.game}/${c.platformKey}/${c.state} bin ${c.bin}`, c, {
    game: c.game, platformKey: c.platformKey, state: c.state, bin: c.bin, tid: r.tid, lid: r.lid, sid: r.sid, offsets: r.offsets, pressFrames: r.pressFrames,
    acceptFrame: r.acceptFrame, rollFrame: r.rollFrame, visible: r.visible, aim: r.aim
  });
}

// ---- inversion --------------------------------------------------------------------------------------
function subsetOpts(name) {
  if (name === "gbp_days0_and_days512") return { platformKey: "gbp", states: ["days0", "days512"] };
  if (name === "primaries_days0_all_platforms") return { states: ["days0"] };
  const m = name.match(/^(.+?)_(all_states|running_10|halted_distinct)$/);
  if (!m) throw new Error("unknown subset " + name);
  return { platformKey: m[1], family: m[2] === "all_states" ? "all" : m[2] === "running_10" ? "running" : "halted" };
}
for (const c of V.inversionStats) {
  const a = G.ambiguity(DATA, c.game, subsetOpts(c.subset));
  check(`ambiguity ${c.game} ${c.subset}`, c, { game: c.game, subset: c.subset, ...a });
}
for (const c of V.inversionCases) {
  const r = G.invert(DATA, c.game, c.tid, { lid: c.lid, sid: c.sid, platformKey: c.platformKey, family: c.family, states: c.states });
  check(`invert ${c.game} ${c.tid}/${c.lid}/${c.sid} on ${c.platformKey} ${c.family} ${JSON.stringify(c.states)}`,
    { candidates: c.candidates, preferred: c.preferred, ambiguous: c.ambiguous, resolved: c.resolved }, inversion(r));
}

for (const c of V.inversionScope) {
  checkCase(`invert scope ${c.game} ${c.tid}/${c.lid}/${c.sid} on ${c.platformKey} ${c.family} ${JSON.stringify(c.states)}`, c,
    () => inversion(G.invert(DATA, c.game, c.tid, { lid: c.lid, sid: c.sid, platformKey: c.platformKey, family: c.family, states: c.states })));
}
for (const c of V.reachable) checkCase(`reachable ${c.game} ${JSON.stringify(c.state)}`, c, () => G.reachable(DATA, c.game, c.state));
for (const [game, states] of Object.entries(V.dmgIdenticalStates)) {
  check(`dmg hold-start == late-start states recorded (${game})`, states, DATA.rtc.dmg_identical_states);
  const engine = G.stateIds(DATA, game).filter((st) => G.resolveTable(DATA, `${game}/dmg/${st}`).key === G.resolveTable(DATA, `${game}/dmg-latestart/${st}`).key);
  check(`dmg hold-start == late-start states resolved by the engine (${game})`, states, engine);
}
check("dmg split states are the complement", G.stateIds(DATA, "gold").filter((st) => !(DATA.rtc.dmg_identical_states || []).includes(st)), DATA.rtc.dmg_split_states);

// ---- targets and verdicts ---------------------------------------------------------------------------
for (const c of V.targets) {
  const sets = G.targetSetsFor(DATA, c.game, c.sets);
  check(`targets ${c.game}/${c.platformKey}/${c.state}`, c.hits, G.targets(DATA, c.game, c.platformKey, c.state, sets));
}
for (const [key, c] of Object.entries(V.targetSets)) {
  const ts = G.makeTargetSet(key, DATA.target_sets[key]);
  const members = ts.kind === "tid-list" ? ts.tids.map((t) => G.hex(t, 4)) : ts.kind === "lid-list" ? ts.lids.map((t) => G.hex(t, 4)) : ts.pairs.map((p) => G.hex(p[0], 4) + "/" + G.hex(p[1], 4));
  check(`target set ${key}`, c, { kind: ts.kind, games: ts.games, members, singlePressHits: ts.singlePressHits.length });
  const all = G.targetsAllStates(DATA, ts.games[0], DATA.games[ts.games[0]].platform_keys[0], [ts]);
  check(`targetsAllStates ${key} agrees with the recorded hits on the first platform`, ts.singlePressHits.filter((h) => h.table.startsWith(ts.games[0] + "/" + DATA.games[ts.games[0]].platform_keys[0] + "/")).length, all.length);
}
for (const c of V.verdicts) {
  checkCase(`verdict ${c.game} ${c.tid}/${c.lid}/${c.sid} ${c.sets}`, c, () => G.verdictDetail(c.tid, c.lid, c.sid, G.targetSetsFor(DATA, c.game, c.sets)));
}
{
  const sets = G.targetSetsFor(DATA, "gold", ["psr-gs-any-09705"]);
  check("verdict string RUN", "RUN", G.verdict(0x25E9, null, null, sets));
  check("verdict string no", "no", G.verdict(0x25EA, null, null, sets));
  check("verdictText names the script protocol", true, /community multi-step script/.test(G.verdictText(0x25E9, null, null, sets)));
  check("setDescribe", "psr-gs-any-09705: TID $25E9 (9705)", G.setDescribe(sets[0]));
}

// ---- schedules --------------------------------------------------------------------------------------
for (const c of V.schedules) {
  checkCase(`schedule ${c.methodology} bin ${c.bin} ${c.anchor} corr ${c.correctionMs} beeps ${c.beeps} spacing ${c.spacingS}`, c,
    () => G.scheduleGen2(DATA, c.methodology, c.bin, c.correctionMs, { anchor: c.anchor, beeps: c.beeps, spacingS: c.spacingS, resetExtraS: c.resetExtraS }));
}

// ---- argument validation the JSON vectors cannot carry (NaN, infinities, wrong types) ---------------------
function throws(label, fn) {
  checks++;
  let threw = null;
  try { fn(); } catch (e) { threw = e; }
  if (!threw || threw.name !== "ValueError") mismatch(label, "ValueError", threw ? `${threw.name}: ${threw.message}` : "no throw");
}
throws("schedule NaN correction throws", () => G.scheduleGen2(DATA, "gold/gbp/hold-start-v1", 100, NaN));
throws("schedule -Infinity correction throws", () => G.scheduleGen2(DATA, "gold/gbp/hold-start-v1", 100, -Infinity));
throws("schedule string correction throws", () => G.scheduleGen2(DATA, "gold/gbp/hold-start-v1", 100, "100"));
throws("schedule NaN reset delay throws", () => G.scheduleGen2(DATA, "gold/gbp/hold-start-v1", 100, 100, { anchor: "reset", resetExtraS: NaN }));
throws("schedule NaN spacing throws", () => G.scheduleGen2(DATA, "gold/gbp/hold-start-v1", 100, 100, { spacingS: NaN }));
throws("schedule Infinity spacing throws", () => G.scheduleGen2(DATA, "gold/gbp/hold-start-v1", 100, 100, { spacingS: Infinity }));
throws("schedule NaN beeps throws", () => G.scheduleGen2(DATA, "gold/gbp/hold-start-v1", 100, 100, { beeps: NaN }));
check("schedule with finite arguments still works", true, Number.isFinite(G.scheduleGen2(DATA, "gold/gbp/hold-start-v1", 100, 100).tA));
throws("bin null throws", () => G.bin(DATA, "gold", null));
throws("bin 100.7 throws", () => G.bin(DATA, "gold", 100.7));
throws("bin '100' throws", () => G.bin(DATA, "gold", "100"));
throws("invert hex-string TID throws", () => G.invert(DATA, "gold", "E83B", {}));
throws("invert decimal-string TID throws", () => G.invert(DATA, "gold", "59451", {}));
throws("invert NaN TID throws", () => G.invert(DATA, "gold", NaN, {}));
throws("invert 1.5 TID throws", () => G.invert(DATA, "gold", 1.5, {}));
throws("verdict hex-string TID throws", () => G.verdict("25E9", null, null, G.targetSetsFor(DATA, "gold", ["psr-gs-any-09705"])));
throws("makeTargetSet invalid hex throws", () => G.makeTargetSet("x", { tids: ["ZZZZ"], games: ["gold"] }));
throws("makeTargetSet 5-digit hex throws", () => G.makeTargetSet("x", { tids: ["1E83B"], games: ["gold"] }));
throws("verify NaN measured time throws", () => G.verify(DATA, "gold", "gbp", 0xE83B, null, NaN));
throws("sampleFromHit NaN correction throws", () => G.sampleFromHit(DATA, "gold", "gbp", null, 0xE83B, null, 100, NaN));
throws("sampleFromHit aimed bin 599 throws", () => G.sampleFromHit(DATA, "gold", "gbp", null, 0xE83B, null, 599, 200));
check("sampleFromHit on Crystal with a bracket state uses its one table", G.sampleFromHit(DATA, "crystal", "gbp", null, 0xBE4B, null, 100, 200).nearestBin,
  G.sampleFromHit(DATA, "crystal", "gbp", "days512", 0xBE4B, null, 100, 200).nearestBin);
throws("sampleFromHit unknown state throws", () => G.sampleFromHit(DATA, "crystal", "gbp", "dayz0", 0xBE4B, null, 100, 200));

// ---- calibration ------------------------------------------------------------------------------------
for (const c of V.calibration) {
  const rule = G.binRule(DATA, c.game);
  check(`calibration ${c.game} used ${c.correctionUsedMs} hit ${c.hitBin} aimed ${c.aimedBin}`, c, {
    game: c.game, correctionUsedMs: c.correctionUsedMs, hitBin: c.hitBin, aimedBin: c.aimedBin,
    impliedMs: G.impliedCorrectionBins(rule, c.correctionUsedMs, c.hitBin, c.aimedBin), errorFrames: G.errorFramesBins(rule, c.hitBin, c.aimedBin), outlier: G.isOutlierBins(rule, c.hitBin, c.aimedBin)
  });
}
for (const c of V.sampleFromHit) {
  const r = G.sampleFromHit(DATA, c.game, c.platformKey, null, c.typedTid, c.typedLid, c.aimedBin, c.correctionUsedMs);
  check(`sampleFromHit ${c.game}/${c.platformKey} ${c.typedTid}/${c.typedLid} aimed ${c.aimedBin}`, { candidateBins: c.candidateBins, nearestBin: c.nearestBin, sample: c.sample },
    { candidateBins: r.candidateBins, nearestBin: r.nearestBin, sample: r.sample });
  if (r.sample) {
    // the Gen 1 calibration helpers accept the record: mean correction and the outlier / duplicate guards
    check(`sampleFromHit ${c.game} feeds gen1 meanCorrection`, r.sample.implied_ms, G1.meanCorrection([r.sample], 0));
    check(`sampleFromHit ${c.game} passes gen1 addSample`, 1, G1.addSample([], r.sample).length);
  }
}

// ---- verify -----------------------------------------------------------------------------------------
for (const c of V.verify) {
  const r = G.verify(DATA, c.game, c.platformKey, c.tid, c.lid, c.measuredS, { state: c.state });
  check(`verify ${c.game}/${c.platformKey} ${c.tid}/${c.lid} at ${c.measuredS}`, c, {
    game: c.game, platformKey: c.platformKey, state: c.state, tid: c.tid, lid: c.lid, measuredS: c.measuredS, predictedOffset: r.predictedOffset, predictedBin: r.predictedBin,
    bins: r.bins, nearest: r.nearest, differenceBins: r.differenceBins, inTable: r.inTable, consistent: r.consistent
  });
}

if (failures > 0) {
  console.error(`${failures} failure(s) in ${checks} checks`);
  process.exit(1);
}
console.log(`all gen2tid parity checks passed (${checks} checks over ${V.caseCount} reference cases)`);
