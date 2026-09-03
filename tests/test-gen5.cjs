// Checks core/gen5.js bit-for-bit against tests/gen5-vectors.json (PokeFinder's own test
// vectors, the RNGWriteups worked seed, and independent Python oracles; see
// tests/build-gen5-vectors.py) and, when given, against the random inputs the C# engine
// emitted with `--emit-gen5-random` (tests/gen5-random.json), which proves JS/C# parity.
const fs = require("fs");
const path = require("path");
const gen5 = require(path.join(__dirname, "..", "core", "gen5.js"));

const vectorsPath = process.argv[2] || path.join(__dirname, "gen5-vectors.json");
const randomPath = process.argv[3];
const v = JSON.parse(fs.readFileSync(vectorsPath, "utf8"));

let failures = 0;
let checks = 0;

function check(label, actual, expected) {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
  }
}

const dec = (x) => gen5.dec64(x);
const u32 = (x) => (typeof x === "string" ? Number(BigInt(x)) : x) >>> 0;

for (const c of v.lcrng64.next) {
  check(`lcrng64 next ${c.name}`, dec(gen5.next64(c.seed)), dec(c.forward));
  check(`lcrng64 prev ${c.name}`, dec(gen5.prev64(c.seed)), dec(c.reverse));
}
for (const c of v.lcrng64.advance) {
  check(`lcrng64 advance ${c.name}`, dec(gen5.jump64(c.seed, c.advances)), dec(c.forward));
  let s = gen5.u64(c.seed);
  for (let i = 0; i < c.advances; i++) s = gen5.next64(s);
  check(`lcrng64 advance by steps ${c.name}`, dec(s), dec(c.forward));
  check(`lcrng64 reverse advance ${c.name}`, dec(gen5.jumpReverse64(c.seed, c.advances)), dec(c.reverse));
}
for (const c of v.lcrng64.jump) {
  check(`lcrng64 jump ${c.name}`, dec(gen5.jump64(c.seed, c.advances)), dec(c.forward));
  check(`lcrng64 reverse jump ${c.name}`, dec(gen5.jumpReverse64(c.seed, c.advances)), dec(c.reverse));
}

for (const c of v.nazoWords) {
  check(`nazo ${c.language} ${c.game} ${c.dsType}`, gen5.nazo(c.game, c.language, c.dsType), c.words);
}

for (const c of v.keypress) {
  check(`keypress value ${c.buttons}`, gen5.keypressValue(c.mask), u32(c.value));
  check(`keypress parse ${c.buttons}`, gen5.parseButtons(c.buttons), c.mask);
  check(`keypress names ${c.buttons}`, gen5.buttonNames(c.mask), c.buttons);
}
{
  const all = gen5.keypressCombos([true, true, true, true, true, true, true, true, true], false);
  check("keypress combos: none first", all[0], { buttons: 0, value: gen5.KEYPRESS_BASE });
  check("keypress combos: Up+Down excluded", all.some((k) => (k.buttons & 0xc00) === 0xc00), false);
  check("keypress combos: Left+Right excluded", all.some((k) => (k.buttons & 0x300) === 0x300), false);
  check("keypress combos: soft reset excluded", all.some((k) => (k.buttons & 0xc3) === 0xc3), false);
  check("keypress combos: skipLR drops L and R", gen5.keypressCombos([true, true, false, false, false, false, false, false, false], true).length, 1 + 10);
}

for (const c of v.dateWords) check(`dateWord ${c.year}-${c.month}-${c.day}`, gen5.dateWord(c.year, c.month, c.day), u32(c.word));
for (const c of v.timeWords) check(`timeWord ${c.hour}:${c.minute}:${c.second} ${c.dsType}`, gen5.timeWord(c.hour, c.minute, c.second, c.dsType), u32(c.word));
{
  const jd = gen5.julianDay(2000, 1, 1);
  check("julianDay 2000-01-01", jd, 2451545);
  check("dateFromJulianDay roundtrip", gen5.dateFromJulianDay(gen5.julianDay(2024, 2, 29)), { year: 2024, month: 2, day: 29 });
}

for (const c of v.sha1) {
  const combos = gen5.keypressCombos(c.keypressCounts, c.skipLR);
  check(`sha1 ${c.name} first combo is None`, combos[0].buttons, c.buttons);
  const seed = gen5.initialSeed({
    game: c.game, language: c.language, dsType: c.dsType, mac: c.mac, vframe: c.vframe, gxstat: c.gxstat,
    timer0: c.timer0, vcount: c.vcount, year: c.year, month: c.month, day: c.day, hour: c.hour, minute: c.minute,
    second: c.second, keypress: combos[0].value
  });
  check(`sha1 ${c.name}`, dec(seed), dec(c.seed));
}

{
  const w = v.writeup;
  const words = gen5.message(w.input);
  check("writeup message words", words.map((x) => "0x" + x.toString(16).padStart(8, "0")), w.message);
  const h = gen5.sha1(words);
  check("writeup h0", "0x" + h[0].toString(16).padStart(8, "0"), w.h0);
  check("writeup h1", "0x" + h[1].toString(16).padStart(8, "0"), w.h1);
  check("writeup raw seed", gen5.hex64(gen5.sha1Seed(words)), w.rawSeed);
  check("writeup initial seed", gen5.hex64(gen5.initialSeed(w.input)), w.seed);
  check("writeup soft reset flips word 6", gen5.message(Object.assign({}, w.input, { softReset: true }))[6], u32(w.message[6]) ^ 0x01000000);
}

for (const c of v.ids) {
  check(`ids ${c.name}`, gen5.idRows(c.seed, c.game, c.initialAdvances, c.maxAdvances), c.rows);
  check(`ids ${c.name} tidSid(no=0)`, gen5.tidSid(c.seed, c.game, 0), c.rows[0]);
  check(`ids ${c.name} tidSid(no=3)`, gen5.tidSid(c.seed, c.game, 3), c.rows[3]);
}

function hitToObject(h) {
  return { seed: dec(h.seed), timer0: h.timer0, vcount: h.vcount, vframe: h.vframe, gxstat: h.gxstat, second: h.second };
}
function profileHitRecomputes(label, p, h) {
  const seed = gen5.initialSeed({
    game: p.game, language: p.language, dsType: p.dsType, mac: p.mac, vframe: h.vframe, gxstat: h.gxstat, timer0: h.timer0,
    vcount: h.vcount, year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: h.second, buttons: p.buttons
  });
  check(`${label} hit recomputes`, dec(seed), dec(h.seed));
}
for (const c of v.profileIvs) {
  const r = gen5.profileSearchIvs(c, c.minIvs, c.maxIvs);
  check(`profile ivs ${c.name} count`, r.length, 1);
  if (r.length === 1) {
    check(`profile ivs ${c.name} seed`, dec(r[0].seed), dec(c.result));
    check(`profile ivs ${c.name} ivsFromSeed`, gen5.ivsFromSeed(c.result, c.game), c.minIvs);
    profileHitRecomputes(`profile ivs ${c.name}`, c, r[0]);
  }
}
for (const c of v.profileNeedles) {
  const r = gen5.profileSearchNeedles(c, c.needles, c.unovaLink, c.memoryLink);
  check(`profile needles ${c.name} count`, r.length, 1);
  if (r.length === 1) {
    check(`profile needles ${c.name} seed`, dec(r[0].seed), dec(c.result));
    check(`profile needles ${c.name} needlesFromSeed`, gen5.needlesFromSeed(c.result, c.game, c.needles.length, c.unovaLink, c.memoryLink), c.needles);
    profileHitRecomputes(`profile needles ${c.name}`, c, r[0]);
  }
}
for (const c of v.profileSeed) {
  const r = gen5.profileSearchSeed(c, c.seed);
  check(`profile seed ${c.name} count`, r.length, 1);
  if (r.length === 1) check(`profile seed ${c.name}`, dec(r[0].seed), dec(c.result));
}

if (randomPath) {
  const r = JSON.parse(fs.readFileSync(randomPath, "utf8"));
  let n = 0;
  for (const c of r.cases) {
    n++;
    const i = c.input;
    const label = `random #${n}`;
    check(`${label} keypressValid`, gen5.keypressValid(i.buttons, i.skipLR), c.keypressValid);
    check(`${label} keypressValue`, gen5.keypressValue(i.buttons), u32(c.keypress));
    check(`${label} nazo`, gen5.nazo(i.game, i.language, i.dsType), c.nazo);
    check(`${label} dateWord`, gen5.dateWord(i.year, i.month, i.day), u32(c.dateWord));
    check(`${label} timeWord`, gen5.timeWord(i.hour, i.minute, i.second, i.dsType), u32(c.timeWord));
    const p = Object.assign({}, i, { keypress: u32(c.keypress) });
    check(`${label} message`, gen5.message(p), c.message.map(u32));
    const seed = gen5.initialSeed(p);
    check(`${label} seed`, dec(seed), dec(c.seed));
    check(`${label} rawSeed`, dec(gen5.sha1Seed(gen5.message(p))), dec(c.rawSeed));
    check(`${label} prev`, dec(gen5.prev64(seed)), dec(c.prev));
    check(`${label} jump`, dec(gen5.jump64(seed, c.jumpN)), dec(c.jumped));
    check(`${label} high32`, gen5.high32(seed), u32(c.high32));
    check(`${label} bounded`, gen5.bounded(seed, u32(c.boundedMax)), u32(c.bounded));
    check(`${label} advancesBW`, gen5.initialAdvancesBW(seed), c.advancesBW);
    check(`${label} advancesBW2`, gen5.initialAdvancesBW2(seed, false), c.advancesBW2);
    check(`${label} advancesBW2 memory`, gen5.initialAdvancesBW2(seed, true), c.advancesBW2Memory);
    check(`${label} advancesBWID`, gen5.initialAdvancesBWID(seed), c.advancesBWID);
    check(`${label} advancesBW2ID`, gen5.initialAdvancesBW2ID(seed), c.advancesBW2ID);
    check(`${label} idRows`, gen5.idRows(seed, i.game, c.idExtra, 2), c.idRows);
    check(`${label} ivs`, gen5.ivsFromSeed(seed, i.game), c.ivs);
    check(`${label} needles`, gen5.needlesFromSeed(seed, i.game, 4, c.unovaLink, c.memoryLink), c.needles);
  }
  for (const c of r.tidSearches) {
    const hits = gen5.searchTid(c.profile, c.year, c.month, c.day, c.hour, c.minute, c.minSecond, c.maxSecond,
      c.targetTid, c.targetSid === null ? undefined : c.targetSid, c.maxAdvances, c.limit).map((h) => ({
        year: h.year, month: h.month, day: h.day, hour: h.hour, minute: h.minute, second: h.second, seed: dec(h.seed),
        buttons: h.buttons, keypress: h.keypress, timer0: h.timer0, advances: h.advances, noCount: h.noCount, tid: h.tid, sid: h.sid, tsv: h.tsv
      }));
    check(`random searchTid ${c.name} (${hits.length} hits)`, hits, c.hits.map((h) => Object.assign({}, h, { seed: dec(h.seed), keypress: u32(h.keypress) })));
  }
  for (const c of r.profileSearches) {
    const hits = gen5.profileSearchIvs(c.range, c.minIvs, c.maxIvs).map(hitToObject);
    check(`random profileSearchIvs ${c.name} (${hits.length} hits)`, hits, c.hits.map((h) => Object.assign({}, h, { seed: dec(h.seed) })));
  }
  console.log(`gen5 random cross-check: ${r.cases.length} inputs, ${r.tidSearches.length} TID searches, ${r.profileSearches.length} profile searches`);
}

if (failures > 0) {
  console.error(`${failures} failure(s) in ${checks} checks`);
  process.exit(1);
}
console.log(`all gen5 checks passed (${checks} checks)`);
