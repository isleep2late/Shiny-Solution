// Generator checks: PokeFinder oracle vectors (tests/generators-vectors.json), the decomp-vs-PokeFinder
// disagreement pins, rarity/reachability math, and the JS<->C# cross-check file when present.
//
//   node tests/test-generators.cjs [tests/generators-vectors.json] [tests/generators-cross.json]
//   GEN_TEST_NEGATIVE=1 node tests/test-generators.cjs   # negative control: one oracle PID corrupted on purpose
"use strict";
const fs = require("fs");
const path = require("path");
const core = require(path.join(__dirname, "..", "core", "rng.js"));
const gen4 = require(path.join(__dirname, "..", "core", "gen4.js"));
const G = require(path.join(__dirname, "..", "core", "generators.js"));

const vectorsPath = process.argv[2] || path.join(__dirname, "generators-vectors.json");
const crossPath = process.argv[3] || path.join(__dirname, "generators-cross.json");
const negative = process.env.GEN_TEST_NEGATIVE === "1";
const V = JSON.parse(fs.readFileSync(vectorsPath, "utf8"));
const TID = V.meta.tid, SID = V.meta.sid, N = V.meta.frameCount;

let failures = 0, checks = 0;
function check(label, actual, expected) {
  checks++;
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`); }
}

if (negative) V.wild3[0].results[0].pid ^= 0x10000; // negative control

// ---------------------------------------------------------------- oracle comparison
const FIELDS = {
  pid: (r) => r.pid, ivs: (r) => r.ivArray, stats: (r) => r.stats, ability: (r) => r.abilityBit, abilityIndex: (r) => r.abilityId,
  gender: (r) => r.gender, hiddenPower: (r) => r.hiddenPower, hiddenPowerStrength: (r) => r.hiddenPowerPower, level: (r) => r.level,
  nature: (r) => r.nature, shiny: (r) => r.shinyType, advances: (r) => (r.advances !== undefined ? r.advances : r.frame),
  specie: (r) => r.species, encounterSlot: (r) => r.encounterSlot, form: (r) => r.form, valid: (r) => r.valid,
  battleAdvances: (r) => r.battleAdvances, call: (r) => r.call, chatot: (r) => r.chatot, inheritance: (r) => r.inheritanceArray,
  pickupAdvances: (r) => r.pickupAdvances, redraws: (r) => r.redraws,
};
function compareResults(label, ours, expected) {
  check(`${label} count`, ours.length, expected.length);
  const n = Math.min(ours.length, expected.length);
  for (let i = 0; i < n; i++) {
    const got = {}, exp = {};
    for (const k of Object.keys(expected[i])) { got[k] = FIELDS[k](ours[i]); exp[k] = expected[i][k]; }
    check(`${label} [${i}]`, got, exp);
  }
}
let vectorCases = 0;

for (const c of V.static3) {
  vectorCases++;
  const r = G.gen3Static(c.seed, { frameCount: N, method: c.method, species: c.species, level: c.level, buggedRoamer: c.buggedRoamer, tid: TID, sid: SID });
  compareResults(`static3 ${c.name}`, r, c.results);
}
for (const c of V.wild3) {
  vectorCases++;
  const r = G.gen3Wild(c.seed, { game: c.game, method: c.method, encounter: c.encounter, slots: c.slots, rate: c.rate, lead: c.lead,
    options: c.options, tid: TID, sid: SID, frameCount: N }).filter((x) => x.valid !== false);
  compareResults(`wild3 ${c.name}`, r, c.results);
}
for (const c of V.egg3) {
  vectorCases++;
  const args = { seed: c.seed, seedPickup: c.seedPickup, method: c.method, calibration: c.calibration, minRedraw: c.minRedraw, maxRedraw: c.maxRedraw,
    compatibility: c.compatibility, species: c.species, speciesMale: c.speciesMale, parentIvs: c.parentIvs, parentGenders: c.parentGenders,
    parentItems: c.parentItems, parentNatures: c.parentNatures, frameCount: N, pickupCount: N, tid: TID, sid: SID };
  const r = c.emerald ? G.gen3EggEmerald(args) : G.gen3EggRSFRLG(args);
  compareResults(`egg3 ${c.name}`, r, c.results);
}
for (const c of V.static4) {
  vectorCases++;
  const r = G.gen4Static(c.seed, { frameCount: N, method: c.method, species: c.species, level: c.level, shiny: c.shiny, lead: c.lead, tid: TID, sid: SID });
  compareResults(`static4 ${c.method} ${c.name}`, r, c.results);
}
for (const c of V.wild4) {
  vectorCases++;
  const r = G.gen4Wild(c.seed, { game: c.game, method: c.method, encounter: c.encounter, slots: c.slots, rate: c.rate, lead: c.lead,
    options: c.options, tid: TID, sid: SID, frameCount: N });
  compareResults(`wild4 ${c.category} ${c.name}`, r, c.results);
}
for (const c of V.egg4) {
  vectorCases++;
  const r = G.gen4Egg({ seed: c.seed, seedPickup: c.seedPickup, game: c.game, species: c.species, speciesMale: c.speciesMale, parentIvs: c.parentIvs,
    masuda: c.masuda, everstoneNature: null, frameCount: N, pickupCount: N, tid: TID, sid: SID });
  compareResults(`egg4 ${c.name}`, r, c.results);
}

// ---------------------------------------------------------------- decomp-vs-PokeFinder pins
const mk = (dex, ratio, abil, types, base) => ({ dex, gender_ratio: ratio, ability_ids: abil, type_ids: types, base_stats: base });
const BASE = { hp: 50, atk: 50, def: 50, spe: 50, spa: 50, spd: 50 };
const ELEC = mk(81, 255, [42, 0], [13, 8], BASE);   // Magnemite: Electric/Steel
const ROCK = mk(74, 127, [69, 0], [5, 4], BASE);    // Geodude
const WATER = mk(129, 127, [33, 0], [11, 11], BASE); // Magikarp
const BUG = mk(10, 127, [19, 0], [6, 6], BASE);

{
  // D1: Emerald Static/Magnet Pull typed slots do not apply to Rock Smash (pokeemerald/src/wild_encounter.c:429-446).
  const slots = [ROCK, ELEC, ROCK, ROCK, ROCK].map((s) => ({ species: s, minLevel: 10, maxLevel: 10, form: 0 }));
  const a = G.gen3Wild(0, { game: "emerald", encounter: "rock_smash", slots, rate: 100, lead: { ability: "STATIC" }, frameCount: 50, options: {} });
  const b = G.gen3Wild(0, { game: "emerald", encounter: "rock_smash", slots, rate: 100, lead: null, frameCount: 50, options: {} });
  check("pin D1: Emerald rock smash ignores Static", a.map((r) => [r.valid, r.encounterSlot, r.pid]), b.map((r) => [r.valid, r.encounterSlot, r.pid]));
  // and Magnet Pull is land only: surfing with a Magnet Pull lead spends no call
  const w = [WATER, ELEC, WATER, WATER, WATER].map((s) => ({ species: s, minLevel: 10, maxLevel: 10, form: 0 }));
  const c1 = G.gen3Wild(0, { game: "emerald", encounter: "surf", slots: w, rate: 4, lead: { ability: "MAGNET_PULL" }, frameCount: 50 });
  const c2 = G.gen3Wild(0, { game: "emerald", encounter: "surf", slots: w, rate: 4, lead: null, frameCount: 50 });
  check("pin D1: Emerald surf ignores Magnet Pull", c1.map((r) => r.pid), c2.map((r) => r.pid));
  const c3 = G.gen3Wild(0, { game: "emerald", encounter: "surf", slots: w, rate: 4, lead: { ability: "STATIC" }, frameCount: 50 });
  check("pin D1: Emerald surf honours Static (differs from no lead)", c3.some((r, i) => r.pid !== c2[i].pid), true);
}
{
  // D2: Emerald Everstone roll is Random() >= 0x7fff -> no inheritance (pokeemerald/src/daycare.c:446-447):
  // an output of exactly 0x7fff must NOT inherit. Build a frame whose everstone call returns 0x7fff.
  // The held loop consumes one call for compatibility, then the everstone call: pick state X with
  // hi16(next(X)) = 0x7fff and set the seed so that frame 0's compatibility call passes.
  let found = null;
  for (let t = 0; t < 0x10000 && !found; t++) {
    const st = (0x7fff << 16 | t) >>> 0; // state whose hi16 is 0x7fff: the everstone output
    const compatState = G.prev(st);       // compatibility output state
    const seed = G.prev(compatState);
    if (Math.floor((compatState >>> 16) * 100 / 0xffff) < 70) found = seed;
  }
  const args = { seed: found, method: "EBred", calibration: 18, compatibility: 70, species: ELEC, parentIvs: [[31, 31, 31, 31, 31, 31], [0, 0, 0, 0, 0, 0]],
    parentGenders: [0, 1], parentItems: [0, 1], parentNatures: [0, 3], frameCount: 1, pickupCount: 1, tid: TID, sid: SID };
  const r = G.gen3EggEmerald(args);
  check("pin D2: everstone output 0x7fff does not inherit", r.map((x) => x.everstoneInherited), [false]);
  // with the roll at 0x7ffe the nature IS inherited
  let found2 = null;
  for (let t = 0; t < 0x10000 && !found2; t++) {
    const st = (0x7ffe << 16 | t) >>> 0;
    const compatState = G.prev(st);
    if (Math.floor((compatState >>> 16) * 100 / 0xffff) < 70) found2 = G.prev(compatState);
  }
  const r2 = G.gen3EggEmerald(Object.assign({}, args, { seed: found2, maxNatureTries: 2400 }));
  check("pin D2: everstone output 0x7ffe inherits the nature", r2.map((x) => [x.everstoneInherited, x.nature]), [[true, 3]]);
}
{
  // D3: HGSS Bug Catching Contest rolls slot and level only (overlay_bug_contest.c:178-186); a Pressure lead adds no roll.
  const slots = Array.from({ length: 10 }, (_, i) => ({ species: BUG, minLevel: 7, maxLevel: 18, form: 0, rate: [80, 60, 50, 40, 30, 20, 15, 10, 5, 0][i] }));
  const a = G.gen4Wild(0, { game: "heartgold", method: "K", encounter: "bug_contest", slots, lead: { ability: "PRESSURE" }, frameCount: 30, tid: TID, sid: SID });
  const b = G.gen4Wild(0, { game: "heartgold", method: "K", encounter: "bug_contest", slots, lead: null, frameCount: 30, tid: TID, sid: SID });
  check("pin D3: bug contest Pressure lead changes nothing", a.map((r) => [r.pid, r.level]), b.map((r) => [r.pid, r.level]));
  // FieldSystem_GenerateBugContestEncounter_Internal (encounter_check.c:976-986) never calls DoesAbilitySuppressEncounter
  // (regular :920 and Safari :966 paths only): a Keen Eye/Intimidate lead above level 5 must not add the suppress roll
  const ke = G.gen4Wild(0, { game: "heartgold", method: "K", encounter: "bug_contest", slots, lead: { ability: "KEEN_EYE", level: 40 }, frameCount: 30, tid: TID, sid: SID });
  check("pin D3: bug contest Keen Eye lead adds no suppress roll", ke.map((r) => [r.valid, r.pid, r.level, r.callsUsed]), b.map((r) => [r.valid, r.pid, r.level, r.callsUsed]));
  // Safari/Bug Contest 4x one-31 retry (encounter_check.c:854-868): perfectIvTries is 1..4 and perfectIvFound is
  // exactly "the final creation has a 31" (t == 4 exits the loop with no 31; JS used to report 5 there)
  check("bug contest perfectIvTries within 1..4", b.every((r) => r.perfectIvTries >= 1 && r.perfectIvTries <= 4), true);
  check("bug contest perfectIvFound iff an IV is 31", b.map((r) => r.perfectIvFound), b.map((r) => r.ivArray.indexOf(31) >= 0));
  check("bug contest some frame misses all four tries", b.some((r) => r.perfectIvTries === 4 && !r.perfectIvFound), true);
}
{
  // D4: HGSS Safari water: no Pressure slot swap (ApplyAbilityEffectToSlotLevel is land only, encounter_check.c:951-953)
  const slots = Array.from({ length: 10 }, (_, i) => ({ species: WATER, minLevel: 20 + (i % 3), maxLevel: 20 + (i % 3), form: 0 }));
  const a = G.gen4Wild(0, { game: "heartgold", method: "K", encounter: "surf", slots, lead: { ability: "PRESSURE" }, options: { safari: true }, frameCount: 30, tid: TID, sid: SID });
  const b = G.gen4Wild(0, { game: "heartgold", method: "K", encounter: "surf", slots, lead: null, options: { safari: true }, frameCount: 30, tid: TID, sid: SID });
  check("pin D4: safari surf ignores Pressure", a.map((r) => [r.pid, r.level]), b.map((r) => [r.pid, r.level]));
}
{
  // D5: DPPt surf/fishing Magnet Pull is overwritten by the Static check (wild_encounters.c:1112-1120): the typed roll is
  // spent but the water slot roll still decides.
  const slots = [WATER, ELEC, WATER, WATER, WATER].map((s) => ({ species: s, minLevel: 10, maxLevel: 10, form: 0 }));
  const a = G.gen4Wild(0, { game: "platinum", method: "J", encounter: "surf", slots, rate: 10, lead: { ability: "MAGNET_PULL" }, frameCount: 60, tid: TID, sid: SID });
  // frame f: call f+1 is the Magnet Pull RandMod(2); if 0 the typed pick spends call f+2 and the water roll is call f+3,
  // else the water roll is call f+2. PokeFinder would report slot 1 whenever the first roll is 0.
  const div = (s, n) => Math.floor((s >>> 16) / (Math.floor(0xffff / n) + 1));
  const expectSlots = a.map((r) => {
    const roll = div(core.jump(0, r.frame + 1), 2);
    return G.jSlot(div(core.jump(0, r.frame + (roll === 0 ? 3 : 2)), 100), "surf");
  });
  check("pin D5: DPPt surf Magnet Pull spends the typed roll but the water roll decides", a.map((r) => r.encounterSlot), expectSlots);
  check("pin D5: the discarded typed pick happened at least once in 60 frames", a.some((r) => div(core.jump(0, r.frame + 1), 2) === 0), true);
  const s2 = G.gen4Wild(0, { game: "platinum", method: "J", encounter: "surf", slots, rate: 10, lead: { ability: "STATIC" }, frameCount: 60, tid: TID, sid: SID });
  check("pin D5: DPPt surf Static does force the Electric slot", s2.some((r) => r.encounterSlot === 1), true);
}
{
  // D6: Gen 4 Everstone (pokeplatinum/src/overlay005/daycare.c:353-367): the MT PID is the first output with the parent's nature.
  const held = G.gen4EggHeld(0, { frameCount: 5, everstoneNature: 7, species: ELEC, tid: TID, sid: SID });
  check("pin D6: everstone egg PIDs carry the nature", held.map((h) => h.pid % 25), [7, 7, 7, 7, 7]);
  const plain = G.gen4EggHeld(0, { frameCount: 5, species: ELEC, tid: TID, sid: SID });
  check("pin D6: without Everstone the PID is the frame's MT output", plain.map((h) => h.pid), (() => { const mt = new gen4.Mt19937(0); return [1, 2, 3, 4, 5].map(() => mt.next()); })());
  // The Everstone check is an LCRNG roll at trigger: LCRNG_Next() >= 0xffff/2 -> no inheritance (daycare.c:336-341;
  // HGSS LCRandom() >= 0x7FFF, get_egg.c:241,247). everstoneProc: false is that branch: plain MT PIDs, not inherited.
  const failed = G.gen4EggHeld(0, { frameCount: 5, everstoneNature: 7, everstoneProc: false, species: ELEC, tid: TID, sid: SID });
  check("pin D6: failed Everstone roll gives the plain MT PIDs", failed.map((h) => h.pid), plain.map((h) => h.pid));
  check("pin D6: everstoneInherited flags", [held.map((h) => h.everstoneInherited), failed.map((h) => h.everstoneInherited)], [[true, true, true, true, true], [false, false, false, false, false]]);
  check("pin D6: inherit chance is 32767/65536", G.GEN4_EVERSTONE_INHERIT_CHANCE, 32767 / 65536);
  const pick = G.gen4Egg({ seed: 0, seedPickup: 0, game: "platinum", frameCount: 2, pickupCount: 1, everstoneNature: 7, species: ELEC, parentIvs: [[31, 31, 31, 31, 31, 31], [0, 0, 0, 0, 0, 0]], tid: TID, sid: SID });
  check("pin D6: pickup results carry everstoneInherited", pick.map((r) => [r.everstoneInherited, r.nature]), [[true, 7], [true, 7]]);
}
{
  // D7: Feebas map. CheckFeebas rolls Random()%100 right after the Route 119 map check and BEFORE the spot comparison
  // (pokeemerald/src/wild_encounter.c:121-122,137; pokeruby :84-85,98); DPPt's RandMod(2) is the first statement of
  // PlayerAvatar_IsFacingFeebasTile (feebas_fishing.c:37), reached on every Mt. Coronet B1F cast (wild_encounters.c:407).
  // PokeFinder spends the roll only with feebasTile; feebasMap spends it off the tile too and never yields Feebas.
  const FEEBAS = V.wild3.find((c) => c.name === "Emerald Route 119 Feebas");
  const args3 = { game: "emerald", method: "M1", encounter: FEEBAS.encounter, slots: FEEBAS.slots, rate: FEEBAS.rate, frameCount: 40, tid: TID, sid: SID };
  const off = G.gen3Wild(FEEBAS.seed, Object.assign({}, args3, { options: {} }));
  const map = G.gen3Wild(FEEBAS.seed, Object.assign({}, args3, { options: { feebasMap: true } }));
  const tile = G.gen3Wild(FEEBAS.seed, Object.assign({}, args3, { options: { feebasTile: true } }));
  // nothing precedes the Feebas roll in the Gen 3 script, so frame f with feebasMap is frame f+1 without it, one call longer
  const proj = (r) => [r.pid, r.ivArray, r.level, r.encounterSlot, r.callsUsed];
  check("pin D7: Emerald feebasMap frame f is plain frame f+1 plus one call", map.slice(0, 39).map(proj), off.slice(1).map((r) => [r.pid, r.ivArray, r.level, r.encounterSlot, r.callsUsed + 1]));
  check("pin D7: Emerald feebasMap never yields Feebas", map.every((r) => !r.feebas && r.encounterSlot < 2), true);
  check("pin D7: Emerald feebasMap differs from the no-roll run", map.some((r, i) => r.pid !== off[i].pid), true);
  // the tile hits exactly when call f+1 is <= 49 mod 100 (:137) and otherwise equals the feebasMap frame
  check("pin D7: Emerald feebasTile hits iff Random()%100 <= 49", tile.map((r) => r.feebas), tile.map((r) => (core.jump(FEEBAS.seed, r.frame + 1) >>> 16) % 100 <= 49));
  check("pin D7: Emerald feebasTile hits on some frames", tile.some((r) => r.feebas), true);
  check("pin D7: Emerald off-tile results equal the tile's non-Feebas frames", map.filter((r, i) => !tile[i].feebas).map(proj), tile.filter((r) => !r.feebas).map(proj));
  const CORONET = V.wild4.find((c) => c.name === "Mt Coronet Feebas");
  const args4 = { game: "platinum", method: "J", encounter: CORONET.encounter, slots: CORONET.slots, rate: CORONET.rate, frameCount: 40, tid: TID, sid: SID };
  const off4 = G.gen4Wild(CORONET.seed, Object.assign({}, args4, { options: {} }));
  const map4 = G.gen4Wild(CORONET.seed, Object.assign({}, args4, { options: { feebasMap: true } }));
  const tile4 = G.gen4Wild(CORONET.seed, Object.assign({}, args4, { options: { feebasTile: true } }));
  // J script: call f+1 nibble, then (feebasMap) call f+2 Feebas RandMod(2) and call f+3 slot RandMod(100); without it the slot is call f+2
  const div = (s, n) => Math.floor((s >>> 16) / (Math.floor(0xffff / n) + 1));
  check("pin D7: DPPt plain slot is RandMod(100) at call f+2", off4.map((r) => r.encounterSlot), off4.map((r) => G.jSlot(div(core.jump(CORONET.seed, r.frame + 2), 100), "super_rod")));
  check("pin D7: DPPt feebasMap slot is RandMod(100) at call f+3", map4.map((r) => r.encounterSlot), map4.map((r) => G.jSlot(div(core.jump(CORONET.seed, r.frame + 3), 100), "super_rod")));
  check("pin D7: DPPt feebasMap never yields Feebas", map4.every((r) => !r.feebas && r.encounterSlot < 5), true);
  check("pin D7: DPPt feebasTile hits iff RandMod(2) at call f+2 is nonzero", tile4.map((r) => r.feebas), tile4.map((r) => div(core.jump(CORONET.seed, r.frame + 2), 2) !== 0));
  check("pin D7: DPPt feebasTile hits on some frames", tile4.some((r) => r.feebas), true);
  check("pin D7: DPPt off-tile results equal the tile's non-Feebas frames", map4.filter((r, i) => !tile4[i].feebas).map(proj), tile4.filter((r) => !r.feebas).map(proj));
  // feebasTile without the appended Feebas slot is a precondition error naming the requirement, not "slot N missing"
  let msg3 = "", msg4 = "";
  try { G.gen3Wild(0, { game: "emerald", method: "M1", encounter: "old_rod", slots: FEEBAS.slots.slice(0, 2), rate: 30, options: { feebasTile: true } }); } catch (e) { msg3 = e.message; }
  try { G.gen4Wild(0, { game: "platinum", method: "J", encounter: "super_rod", slots: CORONET.slots.slice(0, 5), rate: 25, options: { feebasTile: true } }); } catch (e) { msg4 = e.message; }
  check("feebasTile precondition names the Feebas slot (gen3)", /feebasTile requires the Feebas slot \(species 349\) at index 2/.test(msg3), true);
  check("feebasTile precondition names the Feebas slot (gen4)", /feebasTile requires the Feebas slot \(species 349\) at index 5/.test(msg4), true);
}
{
  // Emerald egg redraw ranges collide on (advances, pickupAdvances) (cnt - 3*redraw); the order is pinned as
  // (advances, pickupAdvances, redraws) ascending so both engines and both sort algorithms agree
  const e = V.egg3.find((c) => c.emerald);
  const r = G.gen3EggEmerald({ seed: 0, method: e.method, calibration: 18, minRedraw: 0, maxRedraw: 2, compatibility: 70, species: e.species, parentIvs: e.parentIvs,
    parentGenders: e.parentGenders, parentItems: e.parentItems, parentNatures: e.parentNatures, frameCount: 10, pickupCount: 5, tid: TID, sid: SID });
  const keys = r.map((x) => [x.advances, x.pickupAdvances, x.redraws]);
  const ties = keys.filter((k, i) => keys.findIndex((q) => q[0] === k[0] && q[1] === k[1]) !== i).length;
  check("egg3 redraw range produces (advances, pickupAdvances) ties", ties > 0, true);
  const ordered = keys.every((k, i) => i === 0 || keys[i - 1][0] < k[0] || (keys[i - 1][0] === k[0] && (keys[i - 1][1] < k[1] || (keys[i - 1][1] === k[1] && keys[i - 1][2] < k[2]))));
  check("egg3 results ordered by (advances, pickupAdvances, redraws)", ordered, true);
}
{
  // RS/FRLG have no lead effects: the generator refuses a field ability rather than applying it
  let threw = false;
  try { G.gen3Wild(0, { game: "ruby", encounter: "grass", slots: [], lead: { ability: "SYNCHRONIZE", nature: 0 } }); } catch (e) { threw = true; }
  check("RS lead ability refused", threw, true);
}

// ---------------------------------------------------------------- derived values
check("hidden power flawless = Dark 70", [G.hiddenPower({ hp: 31, atk: 31, def: 31, spe: 31, spa: 31, spd: 31 }).type, G.hiddenPower({ hp: 31, atk: 31, def: 31, spe: 31, spa: 31, spd: 31 }).power], ["DARK", 70]);
check("hidden power all even = Fighting 30", [G.hiddenPower({ hp: 30, atk: 30, def: 30, spe: 30, spa: 30, spd: 30 }).type, G.hiddenPower({ hp: 0, atk: 0, def: 0, spe: 0, spa: 0, spd: 0 }).power], ["FIGHTING", 30]);
check("hidden power type id skips Mystery", G.hiddenPower({ hp: 31, atk: 31, def: 31, spe: 31, spa: 31, spd: 31 }).typeId, 17);
check("gender byte 31 female iff low byte < 31", [G.genderOf(30, 31), G.genderOf(31, 31), G.genderOf(0x1234ff, 254), G.genderOf(0, 255)], [1, 0, 1, 2]);
check("unown letter of pid 0", G.unownLetter(0), 0);
check("shiny type square/star/none", [G.shinyType((TID ^ SID) << 16 >>> 0, TID, SID), G.shinyType(((TID ^ SID) ^ 7) << 16 >>> 0, TID, SID), G.shinyType(((TID ^ SID) ^ 8) << 16 >>> 0, TID, SID)], [2, 1, 0]);

// ---------------------------------------------------------------- rarity and reachability
{
  const flawless1 = G.flawlessTable("M1");
  const flawless4 = G.flawlessTable("M4");
  check("flawless Method 1 states", flawless1.length, 6);
  check("flawless Method 4 states", flawless4.length, 4);
  check("countIvStates flawless M1", G.countIvStates({ minIv: 31 }, "M1").count, 6);
  check("countIvStates flawless M4", G.countIvStates({ minIv: 31 }, "M4").count, 4);
  check("countIvStates all >= 30 (M1)", G.countIvStates({ minIv: 30 }, "M1").count, 260);
  const five = G.fiveThirtyOneStates("M1");
  check("exactly five 31s (M1)", five.length, 738);
  const per100k = G.countIvStates({ minIv: 31 }, "M1").per100k;
  check("per-100k rate of flawless", Math.abs(per100k - 6 / 4294967296 * 1e5) < 1e-12, true);
  // brute-force cross-check of countIvStates on a loose word filter (the product method vs direct enumeration)
  const f = { ivMin: { hp: 29, atk: 29, def: 29, spe: 29, spa: 29, spd: 29 } };
  const direct = G.listIvStates(f, "M1").length;
  check("countIvStates == listIvStates on all >= 29", G.countIvStates(f, "M1").count, direct);
  // frame of the first flawless state from the two fixed Gen 3 seeds
  const framesE = flawless1.map((s) => G.frameForIvState(0, s.ivState, "M1")).sort((a, b) => a - b);
  const framesRS = flawless1.map((s) => G.frameForIvState(0x5a0, s.ivState, "M1")).sort((a, b) => a - b);
  check("first flawless frame from Emerald seed 0", framesE[0], 176562488);
  check("first flawless frame from RS seed 0x5A0", framesRS[0], 353872079);
  // the frame really produces that state (Method 1 from the seed)
  const m = G.gen3Static(0, { frameStart: framesE[0], frameCount: 1, species: ELEC, level: 5 })[0];
  check("flawless frame regenerates 6x31", m.ivArray, [31, 31, 31, 31, 31, 31]);
  // flawless natures and TID^SID blocks are per method: 4/3 (M1), 5/3 (M2), 4/2 (M4); the design doc's
  // "nine natures / eight blocks" is the union over Methods 1, 2 and 4, not a Method 1 fact
  const natureSet = (t) => [...new Set(t.map((s) => s.natureName))].sort();
  const blockSet = (t) => [...new Set(t.map((s) => (s.psv & 0xfff8).toString(16).toUpperCase()))].sort();
  const flawless2 = G.flawlessTable("M2");
  check("flawless Method 1 natures", natureSet(flawless1), ["Calm", "Docile", "Modest", "Timid"]);
  check("flawless Method 1 TID^SID blocks", blockSet(flawless1), ["79F8", "9630", "B378"]);
  check("flawless Method 2 natures", natureSet(flawless2), ["Careful", "Hardy", "Lax", "Naive", "Rash"]);
  check("flawless Method 2 TID^SID blocks", blockSet(flawless2), ["29E8", "6AA8", "8CD8"]);
  check("flawless Method 4 natures", natureSet(flawless4), ["Careful", "Modest", "Naive", "Timid"]);
  check("flawless Method 4 TID^SID blocks", blockSet(flawless4), ["25C8", "9400"]);
  check("flawless natures over M1/M2/M4 are the nine", natureSet(flawless1.concat(flawless2, flawless4)), ["Calm", "Careful", "Docile", "Hardy", "Lax", "Modest", "Naive", "Rash", "Timid"]);
  check("flawless blocks over M1/M2/M4 are the eight", blockSet(flawless1.concat(flawless2, flawless4)), ["25C8", "29E8", "6AA8", "79F8", "8CD8", "9400", "9630", "B378"]);
}
{
  // lcrngDistance: round trips against jump
  let ok = true;
  const seeds = [0, 0x5a0, 0xdeadbeef, 0x12345678];
  const ns = [0, 1, 2, 3, 1000, 123456789, 4294967295, 2147483648, 176562488];
  for (const s of seeds) for (const n of ns) if (G.lcrngDistance(s, core.jump(s, n)) !== n) { ok = false; console.error("distance fail", s, n); }
  check("lcrngDistance inverts jump", ok, true);
  check("prev inverts next", G.prev(core.next(0xdeadbeef)), 0xdeadbeef);
}
{
  // LCRNGReversal port: for random seeds, the IV pair of Method 1 frame 0 recovers jump(seed, 2)
  let ok = true, tested = 0;
  let x = 0x1234abcd;
  for (let i = 0; i < 300; i++) {
    x = core.next(x); const seed = core.next(x) ^ (x >>> 3);
    const mon = G.gen3Static(seed, { frameCount: 1, species: ELEC, level: 5 })[0];
    const origins = G.seedsForIvs(mon.ivs);
    if (origins.indexOf(core.jump(seed, 2)) < 0) { ok = false; console.error("reversal miss", seed.toString(16)); }
    tested++;
  }
  check("seedsForIvs recovers the PID-high state (300 seeds)", ok && tested === 300, true);
  // design-doc example: state 7FFF305A is frame 0 from seed 7B0448D1 (hour 4, delay 18641)
  const ivState = 0x7fff305a;
  const ivs = G.ivsFromWords(ivState >>> 16, core.next(ivState) >>> 16);
  const hits = G.gen4SeedsForTarget(ivs, { maxFrame: 0 });
  check("gen4SeedsForTarget finds 7B0448D1 at frame 0", hits.some((h) => h.seed === 0x7b0448d1 && h.frame === 0 && h.hour === 4 && h.delayPlusYear === 18641), true);
  check("jump(7B0448D1, 3) is the IV1 state 7FFF305A", core.jump(0x7b0448d1, 3), ivState);
  check("hour filter keeps only hour <= 23", hits.every((h) => h.hour <= 23), true);
}

// ---------------------------------------------------------------- JS <-> C# cross-check
if (fs.existsSync(crossPath)) {
  const X = JSON.parse(fs.readFileSync(crossPath, "utf8"));
  let n = 0;
  for (const c of X.cases) {
    n++;
    let r;
    const common = { frameStart: c.frameStart, frameCount: c.frameCount, tid: c.tid, sid: c.sid };
    if (c.kind === "static3") r = G.gen3Static(c.seed, Object.assign(common, { method: c.method, species: c.species, level: c.level, buggedRoamer: c.buggedRoamer }));
    else if (c.kind === "wild3") r = G.gen3Wild(c.seed, Object.assign(common, { game: c.game, method: c.method, encounter: c.encounter, slots: c.slots, rate: c.rate, lead: c.lead, options: c.options }));
    else if (c.kind === "static4") r = G.gen4Static(c.seed, Object.assign(common, { method: c.method, species: c.species, level: c.level, shiny: c.shiny, lead: c.lead }));
    else if (c.kind === "wild4") r = G.gen4Wild(c.seed, Object.assign(common, { game: c.game, method: c.method, encounter: c.encounter, slots: c.slots, rate: c.rate, lead: c.lead, options: c.options }));
    else if (c.kind === "egg4") r = G.gen4Egg(Object.assign(common, { seed: c.seed, seedPickup: c.seedPickup, game: c.game, species: c.species, parentIvs: c.parentIvs, masuda: c.masuda, everstoneNature: c.everstoneNature, everstoneProc: c.everstoneProc, pickupCount: c.frameCount }));
    else if (c.kind === "egg3e") r = G.gen3EggEmerald(Object.assign(common, { seed: c.seed, method: c.method, calibration: c.calibration, minRedraw: 0, maxRedraw: c.maxRedraw || 0, compatibility: c.compatibility, species: c.species, parentIvs: c.parentIvs, parentGenders: c.parentGenders, parentItems: c.parentItems, parentNatures: c.parentNatures, pickupCount: c.frameCount }));
    else if (c.kind === "egg3rs") r = G.gen3EggRSFRLG(Object.assign(common, { seed: c.seed, seedPickup: c.seedPickup, method: c.method, compatibility: c.compatibility, species: c.species, parentIvs: c.parentIvs, parentGenders: c.parentGenders, parentItems: c.parentItems, parentNatures: c.parentNatures, pickupCount: c.frameCount }));
    else continue;
    // tries/found/cc/item/redraws/ever are the fields the first cross-check omitted (the JS 5-vs-C# 4 perfectIvTries split hid there)
    const got = r.map((x) => x.valid === false ? { frame: x.frame, valid: false } : { frame: x.frame, pid: x.pid, ivs: x.ivArray, level: x.level, slot: x.encounterSlot === undefined ? -1 : x.encounterSlot, form: x.form === undefined ? 0 : x.form, adv: x.advances === undefined ? -1 : x.advances, pick: x.pickupAdvances === undefined ? -1 : x.pickupAdvances, inh: x.inheritanceArray || null,
      tries: x.perfectIvTries === undefined ? 0 : x.perfectIvTries, found: !!x.perfectIvFound, cc: !!x.cuteCharm, item: x.itemRoll === undefined ? -1 : x.itemRoll, redraws: x.redraws === undefined ? 0 : x.redraws, ever: !!x.everstoneInherited, valid: true });
    check(`cross ${c.kind} #${n}`, got, c.results);
  }
  check("cross-check case count", n >= 300, true);
  console.log(`cross-check: ${n} C# cases compared`);
} else {
  console.log("no C# cross-check file (" + path.basename(crossPath) + "); skipped");
}

if (failures) {
  console.error(`${failures} of ${checks} generator checks failed${negative ? " (negative control: expected)" : ""}`);
  process.exit(1);
}
console.log(`generator checks OK (${checks} assertions, ${vectorCases} PokeFinder vector cases)`);
