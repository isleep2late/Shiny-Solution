#!/usr/bin/env node
// Builds tests/generators-vectors.json from PokeFinder's Test/Gen3 and Test/Gen4 JSON (the oracle)
// and core/data/*.json (our tables). Every PokeFinder case keeps its name; the inputs are resolved
// into the plain records core/generators.js consumes so the vector file is self-contained.
//
//   node tools/build-generator-vectors.cjs [/tmp/PokeFinder] [tests/generators-vectors.json]
"use strict";
const fs = require("fs");
const path = require("path");

const pfDir = process.argv[2] || "/tmp/PokeFinder";
const outPath = process.argv[3] || path.join(__dirname, "..", "tests", "generators-vectors.json");
const dataDir = path.join(__dirname, "..", "core", "data");

function load(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
const s3 = load(path.join(dataDir, "species-gen3.json"));
const s4 = load(path.join(dataDir, "species-gen4.json"));
const e3 = load(path.join(dataDir, "encounters-gen3.json"));
const e4 = load(path.join(dataDir, "encounters-gen4.json"));
const pfEnc3 = load(path.join(pfDir, "Core/Resources/EncounterTables/Gen3/encounters.json"));
const pfEnc4 = load(path.join(pfDir, "Core/Resources/EncounterTables/Gen4/encounters.json"));
const tests = {
  static3: load(path.join(pfDir, "Test/Gen3/static3.json")),
  wild3: load(path.join(pfDir, "Test/Gen3/wild3.json")),
  egg3: load(path.join(pfDir, "Test/Gen3/egg3.json")),
  static4: load(path.join(pfDir, "Test/Gen4/static4.json")),
  wild4: load(path.join(pfDir, "Test/Gen4/wild4.json")),
  egg4: load(path.join(pfDir, "Test/Gen4/egg4.json")),
};

const CATEGORIES = ["starters", "fossils", "gifts", "gameCorner", "stationary", "legends", "events", "roamers"];
const TID = 12345, SID = 54321; // every PokeFinder generator test uses Profile(..., 12345, 54321)

function speciesRecord(file, dex, form) {
  const s = file.species[dex - 1];
  if (!s || s.dex !== dex) throw new Error("species " + dex);
  const rec = { dex: s.dex, name: s.name, gender_ratio: s.gender_ratio, ability_ids: s.ability_ids, type_ids: s.type_ids, base_stats: s.base_stats };
  if (form) rec.form = form;
  // Giratina Origin Forme: pokeplatinum/res/pokemon/giratina/forms/origin/data.json (Levitate = 26)
  if (dex === 487 && form === 1) {
    rec.base_stats = { hp: 150, atk: 120, def: 100, spe: 90, spa: 120, spd: 100 };
    rec.ability_ids = [26, 0];
  }
  return rec;
}
const sp3 = (dex, form) => speciesRecord(s3, dex, form);
const sp4 = (dex, form) => speciesRecord(s4, dex, form);
const byConst4 = {};
for (const s of s4.species) byConst4[s.constant] = s.dex;

function leadOf(name) {
  switch (name) {
    case undefined: case "None": return null;
    case "Synchronize": return { ability: "SYNCHRONIZE", nature: 0 };
    case "CuteCharmF": return { ability: "CUTE_CHARM", gender: "F" };
    case "CuteCharmM": return { ability: "CUTE_CHARM", gender: "M" };
    case "MagnetPull": return { ability: "MAGNET_PULL" };
    case "Static": return { ability: "STATIC" };
    case "Pressure": return { ability: "PRESSURE" };
    case "CompoundEyes": return { ability: "COMPOUND_EYES" };
    case "SuctionCups": return { ability: "SUCTION_CUPS" };
    case "ArenaTrap": return { ability: "ARENA_TRAP" };
    default: throw new Error("lead " + name);
  }
}
const ENC3 = { Grass: "grass", Surfing: "surf", RockSmash: "rock_smash", OldRod: "old_rod", GoodRod: "good_rod", SuperRod: "super_rod" };
const ENC4 = { Grass: "grass", Surfing: "surf", RockSmash: "rock_smash", OldRod: "old_rod", GoodRod: "good_rod", SuperRod: "super_rod",
  BugCatchingContest: "bug_contest", Headbutt: "headbutt", HoneyTree: "honey_tree" };
const pick3 = (r) => ({ pid: r.pid, ivs: r.ivs, stats: r.stats, ability: r.ability, abilityIndex: r.abilityIndex, gender: r.gender,
  hiddenPower: r.hiddenPower, hiddenPowerStrength: r.hiddenPowerStrength, level: r.level, nature: r.nature, shiny: r.shiny, advances: r.advances });

const out = { meta: {
  source: "PokeFinder Test/Gen3 and Test/Gen4 JSON (commit " + gitHead(pfDir) + "), resolved against core/data/*.json",
  tid: TID, sid: SID, frameCount: 10,
  notCompared: ["item (core/data exports no held items)", "characteristic (display-only)"],
}, static3: [], wild3: [], egg3: [], static4: [], wild4: [], egg4: [] };

function gitHead(dir) {
  try { return fs.readFileSync(path.join(dir, ".git", "HEAD"), "utf8").trim().replace(/^ref: /, ""); } catch (e) { return "?"; }
}

// ------------------------------------------------------------ static3
for (const c of tests.static3.staticgenerator3.generate) {
  const t = pfEnc3[CATEGORIES[c.category]][c.pokemon];
  out.static3.push({
    name: c.name, seed: c.seed, game: c.version.toLowerCase(), method: c.method === "Method4" ? "M4" : c.method === "Method2" ? "M2" : "M1",
    species: sp3(t.specie, t.form || 0), level: t.level, buggedRoamer: !!t.buggedRoamer,
    results: c.results.map(pick3),
  });
}

// ------------------------------------------------------------ wild3
const SAFARI3 = { rs: [89, 90, 91, 92, 186, 187, 188, 189], e: [20, 72, 73, 74, 97, 98] };
function gen3Slots(game, map, enc, feebasTile) {
  const lvl = (s) => ({ species: sp3(s.species), minLevel: s.min_level, maxLevel: s.max_level, form: 0 });
  if (enc === "grass") {
    return { rate: map.land.rate, slots: map.land.slots.map((s, i) => Object.assign(lvl(s), { form: map.land.unown_letter_ids ? map.land.unown_letter_ids[i] : 0 })) };
  }
  if (enc === "surf") return { rate: map.water.rate, slots: map.water.slots.map(lvl) };
  if (enc === "rock_smash") return { rate: map.rock_smash.rate, slots: map.rock_smash.slots.map(lvl) };
  const rod = map.fishing[enc];
  const slots = rod.map(lvl);
  const feebasLoc = (game === "emerald" && map.index === 33) || ((game === "ruby" || game === "sapphire") && map.index === 73);
  if (feebasTile && feebasLoc) slots[{ old_rod: 2, good_rod: 3, super_rod: 5 }[enc]] = { species: sp3(349), minLevel: 20, maxLevel: 25, form: 0 };
  return { rate: map.fishing.rate, slots, feebasLoc };
}
for (const c of tests.wild3.wildgenerator3.generate) {
  const game = c.version.toLowerCase();
  const map = e3.games[game].maps[c.location];
  if (map.index !== c.location) throw new Error("gen3 map index mismatch " + c.location);
  const enc = ENC3[c.encounter];
  const tbl = gen3Slots(game, map, enc, !!c.feebasTile);
  const family = game === "emerald" ? "e" : (game === "ruby" || game === "sapphire") ? "rs" : "frlg";
  const options = {
    feebasTile: !!(c.feebasTile && tbl.feebasLoc),
    safari: family !== "frlg" && SAFARI3[family].indexOf(c.location) >= 0,
    tanoby: family === "frlg" && c.location <= 6,
    bike: !!c.bike, item: c.item ? c.item.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase() : null,
  };
  const results = c.results.map((r) => Object.assign(pick3(r), { specie: r.specie, encounterSlot: r.encounterSlot, form: r.form }));
  const slots = tbl.slots.map((s) => ({ species: s.species, minLevel: s.minLevel, maxLevel: s.maxLevel, form: s.form }));
  out.wild3.push({ name: c.name, seed: c.seed, game, method: c.method === "Method4" ? "M4" : c.method === "Method2" ? "M2" : "M1",
    encounter: enc, location: c.location, map: map.map, rate: tbl.rate, slots, lead: leadOf(c.lead), options, results });
}

// ------------------------------------------------------------ egg3
const MALE_FORM = { 29: 32, 314: 313 };
for (const c of tests.egg3.generate) {
  const emerald = c.version === "Emerald";
  out.egg3.push({
    name: c.name, game: c.version.toLowerCase(), method: c.method, seed: c.seed, seedPickup: c.seedPickup,
    calibration: c.calibration, minRedraw: c.minRedraw, maxRedraw: c.maxRedraw, compatibility: c.compatability,
    species: sp3(c.pokemon), speciesMale: MALE_FORM[c.pokemon] ? sp3(MALE_FORM[c.pokemon]) : null,
    parentIvs: c.parentIVs, parentAbilities: c.parentAbility, parentGenders: c.parentGender, parentItems: c.parentItem, parentNatures: c.parentNature,
    emerald,
    results: c.results.map((r) => Object.assign(pick3(r), { inheritance: r.inheritance, pickupAdvances: r.pickupAdvances, redraws: r.redraws })),
  });
}

// ------------------------------------------------------------ static4
const pick4 = (r) => Object.assign(pick3(r), { call: r.call, chatot: r.chatot });
for (const [cat, method] of [["generateMethod1", "M1"], ["generateMethodJ", "J"], ["generateMethodK", "K"]]) {
  for (const c of tests.static4.staticgenerator4[cat]) {
    const t = pfEnc4[CATEGORIES[c.category]][c.pokemon];
    out.static4.push({
      name: c.name, seed: c.seed, game: c.version.toLowerCase(), method, species: sp4(t.specie, t.form || 0), level: t.level,
      shiny: t.shiny === "Shiny::Always" ? "always" : t.shiny === "Shiny::Never" ? "never" : "random",
      lead: leadOf(c.lead), templateMethod: t.method, results: c.results.map(pick4),
    });
  }
}

// ------------------------------------------------------------ wild4
const HEADBUTT_LOCATIONS = [111, 112, 113, 114, 115, 116, 117, 118, 121, 92, 122, 123, 124, 125, 127, 129, 131, 103, 104, 105, 1, 3, 4, 8,
  17, 21, 22, 25, 26, 38, 39, 52, 57, 59, 67, 68, 95, 96, 147, 97, 98, 99, 100, 0, 2, 5, 146, 27, 58, 85, 128, 24, 20, 137, 71, 102, 148, 136, 125, 87];
const HONEY_TREE_MAPS = [145, 146, 147, 148, 149, 150, 156, 157, 159, 160, 161, 162, 163, 164, 167, 169, 170, 7, 8, 9, 183];
function speciesConst4(v, game) {
  if (typeof v === "object") v = v[game === "heartgold" ? "gold" : "silver"];
  return byConst4[v];
}
function gen4Slots(game, c, enc, opts) {
  const isPt = game === "platinum" || game === "diamond" || game === "pearl";
  const water = (sec) => ({ rate: sec.rate, slots: sec.slots.map((s) => ({ species: sp4(s.species), minLevel: s.min_level, maxLevel: s.max_level, form: 0 })) });
  if (isPt) {
    const t = e4.games[game].tables[c.location];
    if (t.index !== c.location) throw new Error("pt table index");
    if (enc === "honey_tree") {
      const ht = e4.games.platinum.extra.honey_tree;
      const treeId = HONEY_TREE_MAPS.indexOf(c.location);
      const munch = [(SID >> 8) % 21, (SID & 0xff) % 21, (TID >> 8) % 21, (TID & 0xff) % 21];
      for (let i = 1; i < 4; i++) for (let j = 0; j < i; j++) if (munch[j] === munch[i]) munch[i] = (munch[i] + 1) % 21;
      let list = ht.common.concat(ht.uncommon);
      if (munch.indexOf(treeId) >= 0) list = list.concat(ht.rare);
      const seen = [], slots = [];
      for (const k of list) { const d = byConst4[k]; if (seen.indexOf(d) < 0) { seen.push(d); slots.push({ species: sp4(d), minLevel: 5, maxLevel: 15, form: 0 }); } }
      return { rate: 0, slots, extra: { munchlaxTree: munch.indexOf(treeId) >= 0 } };
    }
    if (enc === "grass" || enc === "radar") {
      const slots = t.grass.slots.map((s) => ({ species: sp4(s.species), minLevel: s.level, maxLevel: s.level, form: 0 }));
      if (opts.radar && t.radar) [4, 5, 10, 11].forEach((i, k) => { slots[i].species = sp4(t.radar[k].species); });
      // Shellos/Gastrodon: form 1 (East) iff the table's first form rate is nonzero (wild_encounters.c:1467-1482)
      for (const s of slots) if (s.species.dex === 422 || s.species.dex === 423) s.form = t.form_rates && t.form_rates[s.species.dex - 422] ? 1 : 0;
      return { rate: t.grass.rate, slots, extra: { unownTable: t.unown_table || 0 } };
    }
    const sec = t[enc];
    const w = water(sec);
    if (opts.feebasTile && c.location === 22 && enc !== "surf") w.slots[5] = { species: sp4(349), minLevel: 10, maxLevel: 20, form: 0 };
    return w;
  }
  // HGSS
  if (enc === "bug_contest") {
    const slots = e4.hgss_shared.bug_contest.slots.slice(0, 10).map((s) => ({ species: sp4(s.species), minLevel: s.min_level, maxLevel: s.max_level, form: 0, rate: s.rate }));
    return { rate: 0, slots };
  }
  if (enc === "headbutt") {
    const i = HEADBUTT_LOCATIONS.indexOf(c.location);
    const tbl = e4.hgss_shared.headbutt.tables[i];
    const slots = tbl.CommonMons.map((m) => ({ species: sp4(speciesConst4(m.species, game)), minLevel: m.minLevel, maxLevel: m.maxLevel, form: 0 }));
    return { rate: 0, slots, extra: { headbuttMap: tbl.Map } };
  }
  if (c.location >= 149 && c.location <= 160) {
    const area = e4.hgss_shared.safari_zone.areas[c.location - 149];
    const key = { grass: "land", surf: "surf", old_rod: "oldrod", good_rod: "goodrod", super_rod: "superrod" }[enc];
    const slots = area[key].mons.morn.map((m) => ({ species: sp4(byConst4[m.species]), minLevel: m.level, maxLevel: m.level, form: 0 }));
    return { rate: { old_rod: 25, good_rod: 50, super_rod: 75 }[enc] || 0, slots, extra: { safari: true, area: area.area } };
  }
  const t = e4.games[game].tables[c.location];
  if (t.index !== c.location) throw new Error("hgss table index");
  if (enc === "grass") {
    const slots = t.land.slots.map((s) => ({ species: sp4(s.morning.species), minLevel: s.level, maxLevel: s.level, form: 0 }));
    // PokeFinder folds the four Ruins of Alph interior banks (10..13) into one location and uses 10 for the
    // Sinjoh-event hall (decomp: bank 13, MAP_RUINS_OF_ALPH_HALL_ENTRANCE_SINJOH_EVENT) and 11 for the rest.
    return { rate: t.land.rate, slots, extra: { sinjoh: c.location === 10, maps: t.maps } };
  }
  return water(t[enc]);
}
for (const [cat, method] of [["generateMethodJ", "J"], ["generateMethodK", "K"], ["generateHoneyTree", "J"], ["generatePokeRadar", "J"]]) {
  for (const c of tests.wild4.wildgenerator4[cat]) {
    const game = c.version.toLowerCase();
    let enc = ENC4[c.encounter];
    if (cat === "generatePokeRadar") enc = "radar";
    const tbl = gen4Slots(game, c, enc, { radar: cat === "generatePokeRadar", feebasTile: !!c.feebasTile });
    const options = Object.assign({}, tbl.extra || {});
    if (c.feebasTile) options.feebasTile = true;
    if (cat === "generateHoneyTree" || cat === "generatePokeRadar") options.index = c.index;
    if (cat === "generatePokeRadar") { options.radarShiny = !!c.shiny; options.radarKeepChain = true; }
    if (method === "K" && (enc === "old_rod" || enc === "good_rod" || enc === "super_rod")) options.fishingBoost = 50; // PokeFinder test passes happiness 50
    if (game === "heartgold" && enc === "grass" && !options.safari) { options.unownPuzzles = [true, true, true, true]; options.unownRadio = false; }
    const results = c.results.map((r) => Object.assign(pick4(r), { specie: r.specie, encounterSlot: r.encounterSlot, form: r.form, valid: r.valid, battleAdvances: r.battleAdvances }));
    out.wild4.push({ name: c.name, category: cat, seed: c.seed, game, method, encounter: enc, location: c.location, rate: tbl.rate,
      slots: tbl.slots, lead: leadOf(c.lead), options, results });
  }
}

// ------------------------------------------------------------ egg4
for (const c of tests.egg4.generate) {
  out.egg4.push({
    name: c.name, game: c.version.toLowerCase(), seed: c.seed, seedPickup: c.seedPickup,
    species: sp4(c.pokemon), speciesMale: MALE_FORM[c.pokemon] ? sp4(MALE_FORM[c.pokemon]) : null,
    parentIvs: c.parentIVs, parentAbilities: c.parentAbility, parentGenders: c.parentGender, parentItems: c.parentItem, parentNatures: c.parentNature,
    masuda: !!c.masuda,
    results: c.results.map((r) => Object.assign(pick4(r), { inheritance: r.inheritance, pickupAdvances: r.pickupAdvances })),
  });
}

fs.writeFileSync(outPath, JSON.stringify(out, null, 1) + "\n");
const counts = Object.keys(out).filter((k) => k !== "meta").map((k) => k + "=" + out[k].length + "/" + out[k].reduce((a, c) => a + c.results.length, 0));
console.log("wrote " + outPath + " (" + counts.join(", ") + ")");
