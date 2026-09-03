#!/usr/bin/env python3
"""Re-verifies every decomp / PokeFinder / PKHeX line cited by docs/FACTS.md "Generators".

Each entry is (repo, file, line, text): the cited line (tolerance +-2 lines) must contain the text.
Exit 1 with a list of misses if any citation has drifted.

    python3 tools/check-generator-citations.py [--pret ~/AI/pret] [--pokefinder /tmp/PokeFinder] [--pkhex PATH]
"""
import argparse
import os
import sys

CITATIONS = [
    # --- LCRNG and Method 1
    ("pokeemerald", "src/random.c", 11, "gRngValue = ISO_RANDOMIZE1(gRngValue);"),
    ("pokeemerald", "include/random.h", 12, "#define Random32() (Random() | (Random() << 16))"),
    ("pokeplatinum", "src/math_util.c", 82, "sLCRNGState = sLCRNGState * LCRNG_MULTIPLIER + LCRNG_INCREMENT;"),
    ("pokeheartgold", "src/math_util.c", 71, "sLCRNG_State *= 1103515245;"),
    ("pokeemerald", "src/pokemon.c", 2218, "personality = Random32();"),
    ("pokeemerald", "src/pokemon.c", 2277, "value = Random();"),
    ("pokeemerald", "src/pokemon.c", 2286, "value = Random();"),
    ("pokeemerald", "src/pokemon.c", 2298, "if (gSpeciesInfo[species].abilities[1])"),
    ("pokeemerald", "src/main.c", 365, "if (!gMain.inBattle || !(gBattleTypeFlags & (BATTLE_TYPE_LINK | BATTLE_TYPE_FRONTIER | BATTLE_TYPE_RECORDED)))"),
    ("pokeemerald", "src/main.c", 366, "Random();"),
    ("pokeplatinum", "src/pokemon.c", 412, "monPersonality = (LCRNG_Next() | (LCRNG_Next() << 16));"),
    ("pokeplatinum", "src/pokemon.c", 452, "v1 = LCRNG_Next();"),
    ("pokeplatinum", "src/pokemon.c", 462, "v1 = LCRNG_Next();"),
    ("pokeplatinum", "src/pokemon.c", 475, "if (v2 != ABILITY_NONE) {"),
    ("pokeheartgold", "src/pokemon.c", 195, "fixedPersonality = (LCRandom() | (LCRandom() << 16));"),
    ("pokeheartgold", "src/pokemon.c", 226, "exp = LCRandom();"),
    # --- derived values
    ("pokeemerald", "src/pokemon.c", 3471, "u8 GetGenderFromSpeciesAndPersonality(u16 species, u32 personality)"),
    ("pokeemerald", "src/pokemon.c", 3480, "if (gSpeciesInfo[species].genderRatio > (personality & 0xFF))"),
    ("pokeemerald", "src/pokemon.c", 5498, "u8 GetNatureFromPersonality(u32 personality)"),
    ("pokeemerald", "src/pokemon.c", 5500, "return personality % NUM_NATURES;"),
    ("pokeemerald", "include/pokemon.h", 371, "#define GET_SHINY_VALUE(otId, personality) (HIHALF(otId) ^ LOHALF(otId) ^ HIHALF(personality) ^ LOHALF(personality))"),
    ("pokeplatinum", "src/pokemon.c", 2755, "^ ((monPersonality & 0xFFFF0000) >> 16) ^ (monPersonality & 0xFFFF)) < 8;"),
    ("pokeemerald", "src/battle_script_commands.c", 8905, "gDynamicBasePower = (40 * powerBits) / 63 + 30;"),
    ("pokeemerald", "src/battle_script_commands.c", 8909, "gBattleStruct->dynamicMoveType = ((NUMBER_OF_MON_TYPES - 3) * typeBits) / 63 + 1;"),
    ("pokeplatinum", "src/battle/battle_script.c", 6025, "battleCtx->movePower = battleCtx->movePower * 40 / 63 + 30;"),
    ("pokeplatinum", "src/battle/battle_script.c", 6026, "battleCtx->moveType = battleCtx->moveType * 15 / 63 + 1;"),
    ("pokeemerald", "include/pokemon.h", 364, "#define GET_UNOWN_LETTER(personality)"),
    ("pokefirered", "src/wild_encounter.c", 243, "static u32 GenerateUnownPersonalityByLetter(u8 letter)"),
    ("pokefirered", "src/wild_encounter.c", 248, "personality = (Random() << 16) | Random();"),
    # --- Gen 3 roamer IV bug and statics
    ("pokeruby", "src/pokemon_2.c", 938, "u32 ivs = *data; // Bug: Only the HP IV and the lower 3 bits of the Attack IV are read."),
    ("pokefirered", "src/pokemon.c", 3660, "u32 ivs = *data; // Bug: Only the HP IV and the lower 3 bits of the Attack IV are read."),
    ("pokeemerald", "src/pokemon.c", 4400, "u32 ivs = data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24);"),
    ("pokeruby", "src/roamer.c", 71, "roamer->ivs = GetMonData(&gEnemyParty[0], MON_DATA_IVS);"),
    ("pokefirered", "src/roamer.c", 108, "ROAMER->ivs = GetMonData(mon, MON_DATA_IVS);"),
    # --- Emerald wild
    ("pokeemerald", "src/wild_encounter.c", 182, "static u8 ChooseWildMonIndex_Land(void)"),
    ("pokeemerald", "src/wild_encounter.c", 184, "u8 rand = Random() % ENCOUNTER_CHANCE_LAND_MONS_TOTAL;"),
    ("pokeemerald", "src/wild_encounter.c", 213, "static u8 ChooseWildMonIndex_WaterRock(void)"),
    ("pokeemerald", "src/wild_encounter.c", 231, "static u8 ChooseWildMonIndex_Fishing(u8 rod)"),
    ("pokeemerald", "src/wild_encounter.c", 268, "static u8 ChooseWildMonLevel(const struct WildPokemon *wildPokemon)"),
    ("pokeemerald", "src/wild_encounter.c", 286, "rand = Random() % range;"),
    ("pokeemerald", "src/wild_encounter.c", 292, "if (ability == ABILITY_HUSTLE || ability == ABILITY_VITAL_SPIRIT || ability == ABILITY_PRESSURE)"),
    ("pokeemerald", "src/wild_encounter.c", 294, "if (Random() % 2 == 0)"),
    ("pokeemerald", "src/wild_encounter.c", 297, "if (rand != 0)"),
    ("pokeemerald", "src/wild_encounter.c", 341, "if (GetSafariZoneFlag() == TRUE && Random() % 100 < 80)"),
    ("pokeemerald", "src/wild_encounter.c", 371, "&& GetMonAbility(&gPlayerParty[0]) == ABILITY_SYNCHRONIZE"),
    ("pokeemerald", "src/wild_encounter.c", 372, "&& Random() % 2 == 0)"),
    ("pokeemerald", "src/wild_encounter.c", 378, "return Random() % NUM_NATURES;"),
    ("pokeemerald", "src/wild_encounter.c", 397, "&& GetMonAbility(&gPlayerParty[0]) == ABILITY_CUTE_CHARM"),
    ("pokeemerald", "src/wild_encounter.c", 398, "&& Random() % 3 != 0)"),
    ("pokeemerald", "src/wild_encounter.c", 410, "CreateMonWithGenderNatureLetter(&gEnemyParty[0], species, level, USE_RANDOM_IVS, gender, PickWildMonNature(), 0);"),
    ("pokeemerald", "src/wild_encounter.c", 414, "CreateMonWithNature(&gEnemyParty[0], species, level, USE_RANDOM_IVS, PickWildMonNature());"),
    ("pokeemerald", "src/wild_encounter.c", 432, "if (TRY_GET_ABILITY_INFLUENCED_WILD_MON_INDEX(wildMonInfo->wildPokemon, TYPE_STEEL, ABILITY_MAGNET_PULL, &wildMonIndex, NUM_LAND_MONS_ENCOUNTER_SLOTS))"),
    ("pokeemerald", "src/wild_encounter.c", 440, "if (TRY_GET_ABILITY_INFLUENCED_WILD_MON_INDEX(wildMonInfo->wildPokemon, TYPE_ELECTRIC, ABILITY_STATIC, &wildMonIndex, NUM_WATER_MONS_ENCOUNTER_SLOTS))"),
    ("pokeemerald", "src/wild_encounter.c", 445, "case WILD_AREA_ROCKS:"),
    ("pokeemerald", "src/wild_encounter.c", 446, "wildMonIndex = ChooseWildMonIndex_WaterRock();"),
    ("pokeemerald", "src/wild_encounter.c", 453, "if (gMapHeader.mapLayoutId != LAYOUT_BATTLE_FRONTIER_BATTLE_PIKE_ROOM_WILD_MONS && flags & WILD_CHECK_KEEN_EYE && !IsAbilityAllowingEncounter(level))"),
    ("pokeemerald", "src/wild_encounter.c", 487, "if (Random() % 100 < gSaveBlock1Ptr->outbreakPokemonProbability)"),
    ("pokeemerald", "src/wild_encounter.c", 493, "if (Random() % MAX_ENCOUNTER_RATE < encounterRate)"),
    ("pokeemerald", "src/wild_encounter.c", 502, "encounterRate *= 16;"),
    ("pokeemerald", "src/wild_encounter.c", 504, "encounterRate = encounterRate * 80 / 100;"),
    ("pokeemerald", "src/wild_encounter.c", 537, "if (Random() % 100 >= 60)"),
    ("pokeemerald", "src/wild_encounter.c", 604, "if (TryStartRoamerEncounter() == TRUE)"),
    ("pokeemerald", "src/wild_encounter.c", 615, "if (DoMassOutbreakEncounterTest() == TRUE && SetUpMassOutbreakEncounter(WILD_CHECK_REPEL | WILD_CHECK_KEEN_EYE) == TRUE)"),
    ("pokeemerald", "src/wild_encounter.c", 680, "else if (WildEncounterCheck(wildPokemonInfo->encounterRate, TRUE) == TRUE"),
    ("pokeemerald", "src/wild_encounter.c", 784, "if (CheckFeebas() == TRUE)"),
    ("pokeemerald", "src/wild_encounter.c", 137, "if (Random() % 100 > 49)"),
    ("pokeemerald", "src/wild_encounter.c", 67, "static const struct WildPokemon sWildFeebas = {20, 25, SPECIES_FEEBAS};"),
    ("pokeemerald", "src/wild_encounter.c", 906, "if (playerMonLevel > 5 && level <= playerMonLevel - 5 && !(Random() % 2))"),
    ("pokeemerald", "src/wild_encounter.c", 931, "if (validMonCount == 0 || validMonCount == numMon)"),
    ("pokeemerald", "src/wild_encounter.c", 934, "*monIndex = validIndexes[Random() % validMonCount];"),
    ("pokeemerald", "src/wild_encounter.c", 947, "else if (Random() % 2 != 0)"),
    ("pokeemerald", "src/wild_encounter.c", 953, "return TryGetRandomWildMonIndexByType(wildMon, type, NUM_LAND_MONS_ENCOUNTER_SLOTS, monIndex);"),
    ("pokeemerald", "src/roamer.c", 216, "if (IsRoamerAt(gSaveBlock1Ptr->location.mapGroup, gSaveBlock1Ptr->location.mapNum) == TRUE && (Random() % 4) == 0)"),
    ("pokeemerald", "src/pokemon.c", 2305, "void CreateMonWithNature(struct Pokemon *mon, u16 species, u8 level, u8 fixedIV, u8 nature)"),
    ("pokeemerald", "src/pokemon.c", 2311, "personality = Random32();"),
    ("pokeemerald", "src/pokemon.c", 2340, "personality = Random32();"),
    ("pokeemerald", "src/pokemon.c", 2343, "|| gender != GetGenderFromSpeciesAndPersonality(species, personality));"),
    # --- RS / FRLG wild
    ("pokeruby", "src/wild_encounter.c", 278, "if (GetSafariZoneFlag() == TRUE && Random() % 100 < 80)"),
    ("pokeruby", "src/wild_encounter.c", 305, "return Random() % 25;"),
    ("pokeruby", "src/wild_encounter.c", 311, "CreateMonWithNature(&gEnemyParty[0], species, b, 0x20, PickWildMonNature());"),
    ("pokeruby", "src/wild_encounter.c", 254, "rand = Random() % range;"),
    ("pokeruby", "src/wild_encounter.c", 379, "if (Random() % MAX_ENCOUNTER_RATE < encounterRate)"),
    ("pokeruby", "src/wild_encounter.c", 429, "if (Random() % 100 >= 60)"),
    ("pokeruby", "src/wild_encounter.c", 98, "if (Random() % 100 > 49) //50% chance of encountering Feebas"),
    ("pokeruby", "src/roamer.c", 183, "if (IsRoamerAt(gSaveBlock1.location.mapGroup, gSaveBlock1.location.mapNum) == TRUE && (Random() % 4) == 0)"),
    ("pokefirered", "src/wild_encounter.c", 232, "CreateMonWithNature(&gEnemyParty[0], species, level, USE_RANDOM_IVS, Random() % NUM_NATURES);"),
    ("pokefirered", "src/wild_encounter.c", 237, "personality = GenerateUnownPersonalityByLetter(sUnownLetterSlots[chamber][slot]);"),
    ("pokefirered", "src/wild_encounter.c", 172, "res = Random() % mod;"),
    ("pokefirered", "src/wild_encounter.c", 304, "if (WildEncounterRandom() % MAX_ENCOUNTER_RATE < encounterRate)"),
    ("pokefirered", "src/wild_encounter.c", 350, "if ((Random() % 100) >= 60)"),
    ("pokefirered", "src/wild_encounter.c", 669, "sWildEncounterData.rngState = ISO_RANDOMIZE2(sWildEncounterData.rngState);"),
    # --- Gen 3 eggs
    ("pokeemerald", "src/daycare.c", 439, "if (Random() >= USHRT_MAX / 2)"),
    ("pokeemerald", "src/daycare.c", 446, "if (GetBoxMonData(&daycare->mons[parent].mon, MON_DATA_HELD_ITEM) != ITEM_EVERSTONE"),
    ("pokeemerald", "src/daycare.c", 447, "|| Random() >= USHRT_MAX / 2)"),
    ("pokeemerald", "src/daycare.c", 459, "SeedRng2(gMain.vblankCounter2);"),
    ("pokeemerald", "src/daycare.c", 465, "daycare->offspringPersonality = (Random2() << 16) | ((Random() % 0xfffe) + 1);"),
    ("pokeemerald", "src/daycare.c", 476, "personality = (Random2() << 16) | (Random());"),
    ("pokeemerald", "src/daycare.c", 477, "if (wantedNature == GetNatureFromPersonality(personality) && personality != 0)"),
    ("pokeemerald", "src/daycare.c", 481, "} while (natureTries <= 2400);"),
    ("pokeemerald", "src/daycare.c", 549, "selectedIvs[i] = availableIVs[Random() % (NUM_STATS - i)];"),
    ("pokeemerald", "src/daycare.c", 550, "RemoveIVIndexFromList(availableIVs, i);"),
    ("pokeemerald", "src/daycare.c", 561, "whichParents[i] = Random() % DAYCARE_MON_COUNT;"),
    ("pokeemerald", "src/daycare.c", 813, "SetInitialEggData(&egg, species, daycare);"),
    ("pokeemerald", "src/daycare.c", 814, "InheritIVs(&egg, daycare);"),
    ("pokeemerald", "src/daycare.c", 862, "CreateMon(mon, species, EGG_HATCH_LEVEL, USE_RANDOM_IVS, TRUE, personality, OT_ID_PLAYER_ID, 0);"),
    ("pokeemerald", "src/daycare.c", 893, "if (compatibility > (Random() * 100u) / USHRT_MAX)"),
    ("pokeemerald", "src/daycare.c", 784, "if (eggSpecies == SPECIES_NIDORAN_F && daycare->offspringPersonality & EGG_GENDER_MALE)"),
    ("pokeruby", "src/daycare.c", 364, "daycare->misc.countersEtc.pendingEggPersonality = (Random() % 0xfffe) + 1;"),
    ("pokeruby", "src/daycare.c", 426, "selectedIvs[i] = availableIVs[Random() % (NUM_STATS - i)];"),
    ("pokeruby", "src/daycare.c", 429, "RemoveIVIndexFromList(availableIVs, selectedIvs[i]);"),
    ("pokeruby", "src/daycare.c", 435, "whichParent[i] = Random() % 2;"),
    ("pokeruby", "src/daycare.c", 675, "SetInitialEggData(&egg, species, daycare);"),
    ("pokeruby", "src/daycare.c", 676, "InheritIVs(&egg, daycare);"),
    ("pokeruby", "src/daycare.c", 721, "personality = daycare->misc.countersEtc.pendingEggPersonality | (Random() << 16);"),
    ("pokeruby", "src/daycare.c", 755, "GetDaycareCompatibilityScore(daycare) > (u32)(Random() * 100) / 0xffff)"),
    ("pokefirered", "src/daycare.c", 750, "daycare->offspringPersonality = ((Random()) % 0xFFFE) + 1;"),
    ("pokefirered", "src/daycare.c", 809, "selectedIvs[i] = availableIVs[Random() % (NUM_STATS - i)];"),
    ("pokefirered", "src/daycare.c", 810, "RemoveIVIndexFromList(availableIVs, selectedIvs[i]);"),
    ("pokefirered", "src/daycare.c", 1121, "personality = daycare->offspringPersonality | (Random() << 16);"),
    ("pokefirered", "src/daycare.c", 1152, "if (compatibility > (Random() * 100u) / USHRT_MAX)"),
    # --- Gen 4 DPPt wild
    ("pokeplatinum", "include/inlines.h", 156, "inline u16 LCRNG_RandMod(const u16 param)"),
    ("pokeplatinum", "include/inlines.h", 163, "u16 v0 = (0xffff / param) + 1;"),
    ("pokeplatinum", "include/inlines.h", 164, "u16 v1 = LCRNG_Next() / v0;"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 396, "if (LCRNG_RandMod(100) >= encounterRate) {"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 407, "if (MapHeader_HasFeebasTiles(fieldSystem->location->mapId) && PlayerAvatar_IsFacingFeebasTile(fieldSystem)) {"),
    ("pokeplatinum", "src/overlay006/feebas_fishing.c", 37, "if (LCRNG_RandMod(2) == 0) {"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 822, "u8 roll = LCRNG_RandMod(100);"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 853, "u8 roll = LCRNG_RandMod(100);"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 872, "u8 roll = LCRNG_RandMod(100);"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 944, "if (!encounterFieldParams->isFirstMonEgg && encounterFieldParams->firstMonAbility == ABILITY_SYNCHRONIZE && LCRNG_RandMod(2) == 0) {"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 949, "return LCRNG_RandMod(25);"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 967, "randRange = LCRNG_Next() % levelRange;"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 971, "if (LCRNG_RandMod(2) == 0) {"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 1003, "if (LCRNG_RandMod(3) > 0) {"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 1009, "if (LCRNG_RandMod(2) == 0) {"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 1016, "u32 newEncounterPersonality = Pokemon_FindShinyPersonality(param3);"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 1063, "if (hasRandomGender && !encounterFieldParams->isFirstMonEgg && encounterFieldParams->firstMonAbility == ABILITY_CUTE_CHARM && LCRNG_RandMod(3) > 0) {"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 1075, "sub_02074088(newEncounter, species, level, 32, gender, GetNatureForWildMon(firstPartyMon, encounterFieldParams), 0);"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 1083, "sub_02074044(newEncounter, species, level, 32, GetNatureForWildMon(firstPartyMon, encounterFieldParams));"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 1109, "encounterSlot = TryFindHigherLevelSlot(encounterTable, encounterFieldParams, encounterSlot);"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 1110, "level = encounterTable[encounterSlot].maxLevel;"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 1113, "// BUG: Magnet Pull doesn't function in water because its encounter slot gets overwritten when the Static check returns FALSE."),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 1115, "forcedSlot = TryGetSlotForTypeMatchAbility(firstPartyMon, encounterFieldParams, encounterTable, MAX_WATER_ENCOUNTERS, TYPE_ELECTRIC, ABILITY_STATIC, &encounterSlot);"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 1210, "u8 level = 5 + LCRNG_RandMod(levelVariance);"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 1213, "if (LCRNG_RandMod(2) == 0) {"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 1216, "level = 15;"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 1227, "void CreateWildMon_Scripted(FieldSystem *fieldSystem, u16 species, u8 level, FieldBattleDTO *battleParams)"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 1235, "CreateWildMon(species, level, 1, &encounterFieldParams, firstPartyMon, battleParams);"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 1308, "if (numMonsOfType == 0 || numMonsOfType == maxEncounters) {"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 1312, "*encounterSlot = typeMatchingSlots[LCRNG_Next() % numMonsOfType];"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 1319, "if (!encounterFieldParams->isFirstMonEgg && encounterFieldParams->firstMonAbility == ability && LCRNG_RandMod(2) == 0) {"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 1372, "if (wildLevel <= leadLevel - 5 && LCRNG_RandMod(2) == 0) {"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 1441, "} else if (LCRNG_RandMod(2) == 0) {"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 1446, "*encounteredRoamer = roamers[LCRNG_RandMod(numRoamersOnMap)];"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 1462, "Pokemon_GiveHeldItem(mon, battleParams->battleType, hasCompoundEyes);"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 1489, "form = WildEncounters_UnownTables[encounterFieldParams->unownTableID].forms[LCRNG_Next() % availableUnownForms];"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 1502, "if (LCRNG_RandMod(2) == 0) {"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 1503, "return encounterSlot;"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 1509, "if (encounterTable[i].species == encounterTable[newSlot].species && encounterTable[i].maxLevel > encounterTable[newSlot].maxLevel) {"),
    ("pokeplatinum", "src/overlay006/wild_encounters.c", 170, "static const UnownFormsGroup WildEncounters_UnownTables[] = {"),
    ("pokeplatinum", "src/pokemon.c", 498, "monPersonality = (LCRNG_Next() | (LCRNG_Next() << 16));"),
    ("pokeplatinum", "src/pokemon.c", 499, "} while (monNature != Pokemon_GetNatureOf(monPersonality));"),
    ("pokeplatinum", "src/pokemon.c", 516, "monPersonality = sub_02074128(monSpecies, gender, param5);"),
    ("pokeplatinum", "src/pokemon.c", 535, "result = 25 * ((monGenderChance / 25) + 1);"),
    ("pokeplatinum", "src/pokemon.c", 536, "result += param2;"),
    ("pokeplatinum", "src/pokemon.c", 2762, "u32 Pokemon_FindShinyPersonality(u32 monOTID)"),
    ("pokeplatinum", "src/pokemon.c", 2772, "u16 rndLow = LCRNG_Next() & 0x7;"),
    ("pokeplatinum", "src/pokemon.c", 2773, "u16 rndHigh = LCRNG_Next() & 0x7;"),
    ("pokeplatinum", "src/pokemon.c", 2781, "if (LCRNG_Next() & 1) {"),
    ("pokeplatinum", "src/pokemon.c", 2786, "} else if (LCRNG_Next() & 1) {"),
    ("pokeplatinum", "src/pokemon.c", 4681, "u32 rand = LCRNG_Next() % 100;"),
    ("pokeplatinum", "src/pokemon.c", 4694, "if (rand < sHeldItemChance[itemRates][0]) {"),
    ("pokeplatinum", "src/pokeradar.c", 473, "int rate = 8200 - (chainCount * 200);"),
    ("pokeplatinum", "src/pokeradar.c", 474, "if (rate < 200) {"),
    ("pokeplatinum", "src/pokeradar.c", 478, "if (!LCRNG_RandMod(rate)) {"),
    ("pokeplatinum", "src/encounter.c", 549, "void Encounter_NewVsSpeciesAtLevel(FieldTask *task, u16 species, u8 level, int *resultMaskPtr, BOOL isLegendary)"),
    ("pokeplatinum", "src/encounter.c", 558, "CreateWildMon_Scripted(fieldSystem, species, level, dto);"),
    ("pokeplatinum", "src/sound_chatot.c", 80, "u16 speedVariance = LCRNG_Next() % CHATOT_CRY_SPEED_VARIANCE;"),
    ("pokeplatinum", "src/math_util.c", 106, "return seed * MT19937_F + 1;"),
    # --- Gen 4 HGSS wild
    ("pokeheartgold", "include/math_util.h", 34, "u16 result = LCRandom() % maximum;"),
    ("pokeheartgold", "src/field/encounter_check.c", 341, "if (LCRandRange(100) >= encounterRate) {"),
    ("pokeheartgold", "src/field/encounter_check.c", 388, "if ((LCRandom() % 100) >= encounterRate) {"),
    ("pokeheartgold", "src/field/encounter_check.c", 632, "u8 rnd = LCRandRange(100);"),
    ("pokeheartgold", "src/field/encounter_check.c", 678, "u8 rnd = LCRandRange(100);"),
    ("pokeheartgold", "src/field/encounter_check.c", 694, "u8 rnd = LCRandRange(100);"),
    ("pokeheartgold", "src/field/encounter_check.c", 696, "return rnd >= 80 ? 1 : 0;"),
    ("pokeheartgold", "src/field/encounter_check.c", 700, "u8 rnd = LCRandRange(100);"),
    ("pokeheartgold", "src/field/encounter_check.c", 734, "if (!encounterGen->isEgg && encounterGen->ability == ABILITY_SYNCHRONIZE && LCRandRange(2) == 0) {"),
    ("pokeheartgold", "src/field/encounter_check.c", 737, "return LCRandRange(25);"),
    ("pokeheartgold", "src/field/encounter_check.c", 754, "u8 lvl = LCRandom() % range;"),
    ("pokeheartgold", "src/field/encounter_check.c", 756, "if (LCRandRange(2) == 0) {"),
    ("pokeheartgold", "src/field/encounter_check.c", 783, "if (LCRandRange(3) != 0) {"),
    ("pokeheartgold", "src/field/encounter_check.c", 790, "if (LCRandRange(2) == 0) {"),
    ("pokeheartgold", "src/field/encounter_check.c", 796, "personality = GenerateShinyPersonality(otid);"),
    ("pokeheartgold", "src/field/encounter_check.c", 837, "if (canCoerceGender && !encounterGen->isEgg && encounterGen->ability == ABILITY_CUTE_CHARM && LCRandRange(3) != 0) {"),
    ("pokeheartgold", "src/field/encounter_check.c", 846, "CreateMonWithGenderNatureLetter(wildMon, species, level, 0x20, monGender, getWildMonNature(leadMon, encounterGen), 0);"),
    ("pokeheartgold", "src/field/encounter_check.c", 856, "for (i = 0; i < 4; ++i) {"),
    ("pokeheartgold", "src/field/encounter_check.c", 857, "CreateMonWithNature(wildMon, species, level, 0x20, getWildMonNature(leadMon, encounterGen));"),
    ("pokeheartgold", "src/field/encounter_check.c", 859, "if (GetMonData(wildMon, MON_DATA_HP_IV + j, NULL) == 31) {"),
    ("pokeheartgold", "src/field/encounter_check.c", 869, "CreateMonWithNature(wildMon, species, level, 0x20, getWildMonNature(leadMon, encounterGen));"),
    ("pokeheartgold", "src/field/encounter_check.c", 886, "slot = ApplyAbilityEffectToSlotLevel(encSlots, NUM_ENCOUNTERS_LAND, encounterGen, slot);"),
    ("pokeheartgold", "src/field/encounter_check.c", 887, "level = encSlots[slot].maxLevel;"),
    ("pokeheartgold", "src/field/encounter_check.c", 893, "level = EncounterSlot_WildMonLevelRoll(&encSlots[slot], encounterGen);"),
    ("pokeheartgold", "src/field/encounter_check.c", 959, "slot = LCRandom() % NUM_ENCOUNTERS_SAFARI;"),
    ("pokeheartgold", "src/field/encounter_check.c", 961, "if (encType == ENCOUNTER_TYPE_LAND) {"),
    ("pokeheartgold", "src/field/encounter_check.c", 962, "slot = ApplyAbilityEffectToSlotLevel(encSlots, NUM_ENCOUNTERS_SAFARI, encounterGen, slot);"),
    ("pokeheartgold", "src/field/encounter_check.c", 965, "level = encSlots[slot].maxLevel;"),
    ("pokeheartgold", "src/field/encounter_check.c", 971, "generateWildNonShinyAndAddToParty(species, level, battler, TRUE, encounterGen, leadMon, battleSetup);"),
    ("pokeheartgold", "src/field/encounter_check.c", 983, "generateWildNonShinyAndAddToParty(encSlot->species, encSlot->maxLevel, battler, TRUE, encounterGen, leadMon, battleSetup);"),
    ("pokeheartgold", "src/field/encounter_check.c", 993, "generateWildShinyAndAddToParty(species, level, BATTLER_ENEMY, otid, &encounterGen, leadMon, battleSetup);"),
    ("pokeheartgold", "src/field/encounter_check.c", 1062, "ret += getFriendshipBoostToFishingBiteRate(GetMonData(GetFirstAliveMonInParty_CrashIfNone(SaveArray_Party_Get(fieldSystem->saveData)), MON_DATA_FRIENDSHIP, NULL));"),
    ("pokeheartgold", "src/field/encounter_check.c", 1104, "if (numFoundSlots == 0 || numFoundSlots == numEncSlots) {"),
    ("pokeheartgold", "src/field/encounter_check.c", 1107, "*slot = foundSlots[LCRandom() % numFoundSlots];"),
    ("pokeheartgold", "src/field/encounter_check.c", 1112, "if (!encounterGen->isEgg && encounterGen->ability == ability && LCRandRange(2) == 0) {"),
    ("pokeheartgold", "src/field/encounter_check.c", 1124, "if (encounterGen->ability == ABILITY_STICKY_HOLD || encounterGen->ability == ABILITY_SUCTION_CUPS) {"),
    ("pokeheartgold", "src/field/encounter_check.c", 1127, "} else if (encounterGen->ability == ABILITY_ARENA_TRAP || encounterGen->ability == ABILITY_NO_GUARD || encounterGen->ability == ABILITY_ILLUMINATE) {"),
    ("pokeheartgold", "src/field/encounter_check.c", 1136, "if (ret > 100) {"),
    ("pokeheartgold", "src/field/encounter_check.c", 1153, "} else if (level <= leadMonLevel - 5 && LCRandRange(2) == 0) {"),
    ("pokeheartgold", "src/field/encounter_check.c", 1230, "if (LCRandRange(2) == 0) {"),
    ("pokeheartgold", "src/field/encounter_check.c", 1234, "u16 chosenRoamer = LCRandRange(nRoamers);"),
    ("pokeheartgold", "src/field/encounter_check.c", 1312, "return sUnlockedUnown[4].letters[LCRandom() % 2];"),
    ("pokeheartgold", "src/field/encounter_check.c", 1339, "if (isUnownSounds && numUncaughtUnown > 0 && (LCRandom() % 100) < 50) {"),
    ("pokeheartgold", "src/field/encounter_check.c", 1340, "ret = availableUncaughtUnown[LCRandom() % numUncaughtUnown];"),
    ("pokeheartgold", "src/field/encounter_check.c", 1342, "ret = availableUnown[LCRandom() % numAvailableUnown];"),
    ("pokeheartgold", "src/field/encounter_check.c", 1350, "WildMonSetRandomHeldItem(pokemon, battleSetup->battleType, !encounterGen->isEgg && encounterGen->ability == ABILITY_COMPOUNDEYES ? 1 : 0);"),
    ("pokeheartgold", "src/field/encounter_check.c", 1360, "if (LCRandRange(2) == 0) {"),
    ("pokeheartgold", "src/field/encounter_check.c", 1361, "return chosenSlot;"),
    ("pokeheartgold", "src/field/encounter_check.c", 1388, "encounterGen->isSinjohMap = fieldSystem->location->mapId == MAP_RUINS_OF_ALPH_HALL_ENTRANCE_SINJOH_EVENT;"),
    ("pokeheartgold", "include/constants/maps.h", 495, "#define MAP_RUINS_OF_ALPH_HALL_ENTRANCE_SINJOH_EVENT      491 // MAP_D24R0217"),
    ("pokeheartgold", "include/encounter_tables_narc.h", 31, "#define ENCDATA_D24R0217   ENCDATA(_00000013)"),
    ("pokeheartgold", "src/overlay_bug_contest.c", 178, "roll = LCRandom() % 100;"),
    ("pokeheartgold", "src/overlay_bug_contest.c", 180, "if ((int)roll >= bugContest->encounters[i].rate) {"),
    ("pokeheartgold", "src/overlay_bug_contest.c", 186, "slot->maxLevel = (LCRandom() % modulo) + bugContest->encounters[i].lvlmin;"),
    ("pokeheartgold", "src/pokemon.c", 261, "personality = (u32)(LCRandom() | (LCRandom() << 16));"),
    ("pokeheartgold", "src/pokemon.c", 262, "} while (nature != GetNatureFromPersonality(personality));"),
    ("pokeheartgold", "src/pokemon.c", 275, "pid = GenPersonalityByGenderAndNature(species, gender, nature);"),
    ("pokeheartgold", "src/pokemon.c", 292, "pid = 25 * ((ratio / 25) + 1);"),
    ("pokeheartgold", "src/pokemon.c", 2137, "r6 = (u16)(LCRandom() & 7);"),
    ("pokeheartgold", "src/pokemon.c", 2141, "if (LCRandom() & 1) {"),
    ("pokeheartgold", "src/pokemon.c", 3748, "chance = (u32)(LCRandom() % 100);"),
    ("pokeheartgold", "src/choose_starter.c", 55, "for (i = 0; i < (int)NELEMS(species); i++) {"),
    ("pokeheartgold", "src/choose_starter.c", 59, "CreateMon(mon, species[i], 5, 32, FALSE, 0, OT_ID_PLAYER_ID, 0);"),
    ("pokeheartgold", "src/sound_chatot.c", 59, "u16 r4 = (LCRandom() % 8192);"),
    ("pokeheartgold", "src/application/pokegear/phone/scripts/phone_scripts_prof_elm.c", 84, "return PHONE_SCRIPT_020 + (LCRandom() % 3);"),
    ("pokeheartgold", "src/math_util.c", 77, "return seed * 1812433253 + 1;"),
    # --- Gen 4 eggs
    ("pokeplatinum", "src/overlay005/daycare.c", 327, "if (LCRNG_Next() >= (0xffff / 2)) {"),
    ("pokeplatinum", "src/overlay005/daycare.c", 336, "if (LCRNG_Next() >= (0xffff / 2)) {"),
    ("pokeplatinum", "src/overlay005/daycare.c", 353, "Daycare_SetOffspringPersonality(daycare, MTRNG_Next());"),
    ("pokeplatinum", "src/overlay005/daycare.c", 361, "newPersonality = MTRNG_Next();"),
    ("pokeplatinum", "src/overlay005/daycare.c", 363, "if ((nature == Pokemon_GetNatureOf(newPersonality)) && (newPersonality != 0)) {"),
    ("pokeplatinum", "src/overlay005/daycare.c", 367, "if (++natureTries > 2400) {"),
    ("pokeplatinum", "src/overlay005/daycare.c", 405, "selectedIVs[i] = availableIVs[LCRNG_Next() % (STAT_MAX - i)];"),
    ("pokeplatinum", "src/overlay005/daycare.c", 406, "RemoveIVIndexFromList(availableIVs, i);"),
    ("pokeplatinum", "src/overlay005/daycare.c", 410, "slots[i] = LCRNG_Next() % NUM_DAYCARE_MONS;"),
    ("pokeplatinum", "src/overlay005/daycare.c", 722, "if (Pokemon_IsPersonalityShiny(monOTID, personality) == FALSE) {"),
    ("pokeplatinum", "src/overlay005/daycare.c", 724, "personality = ARNG_Next(personality);"),
    ("pokeplatinum", "src/overlay005/daycare.c", 734, "Pokemon_InitWith(mon, species, EGG_POKEMON_LEVEL, INIT_IVS_RANDOM, TRUE, personality, OTID_NOT_SET, 0);"),
    ("pokeplatinum", "src/overlay005/daycare.c", 764, "Egg_SetInitialData(mon, species, daycare, monOTID, form);"),
    ("pokeplatinum", "src/overlay005/daycare.c", 766, "Egg_InheritIVs(mon, daycare);"),
    ("pokeplatinum", "src/overlay005/daycare.c", 1130, "while (Pokemon_IsPersonalityShiny(otID, personality)) {"),
    ("pokeplatinum", "src/overlay005/daycare.c", 1131, "personality = ARNG_Next(personality);"),
    ("pokeheartgold", "src/get_egg.c", 235, "if (LCRandom() % 2 == 0) { // everstone_idx is set to the opposite value for some reason."),
    ("pokeheartgold", "src/get_egg.c", 240, "if (LCRandom() >= 0x7FFF) { // This is probably supposed to be 50%, but is actually ~50.0015%."),
    ("pokeheartgold", "src/get_egg.c", 262, "Save_Daycare_SetEggPID(dayCare, MTRandom());"),
    ("pokeheartgold", "src/get_egg.c", 266, "pid = MTRandom();"),
    ("pokeheartgold", "src/get_egg.c", 267, "if (nature == GetNatureFromPersonality(pid) && pid != 0) {"),
    ("pokeheartgold", "src/get_egg.c", 308, "if (Daycare_TryGetForcedInheritedIV(dayCare, &powerItemStat, &daycareSlot)) {"),
    ("pokeheartgold", "src/get_egg.c", 317, "u8 statToInherit = (LCRandom() % (NUM_STATS - i));"),
    ("pokeheartgold", "src/get_egg.c", 319, "_IVList_Remove(statList, statToInherit);"),
    ("pokeheartgold", "src/get_egg.c", 325, "monToInheritFrom[i] = LCRandom() % 2;"),
    ("pokeheartgold", "src/get_egg.c", 601, "if (Save_Daycare_MasudaCheck(dayCare)) {"),
    ("pokeheartgold", "src/get_egg.c", 604, "pid = PRandom(pid);"),
    ("pokeheartgold", "src/get_egg.c", 611, "CreateMon(mon, species, 1, 32, TRUE, pid, OT_ID_PLAYER_ID, 0);"),
    ("pokeheartgold", "src/get_egg.c", 631, "SetBreedEggStats(mon, species, dayCare, otId, mom_form);"),
    ("pokeheartgold", "src/get_egg.c", 632, "InheritIVs(mon, dayCare);"),
    ("pokeheartgold", "src/get_egg.c", 1011, "if (LCRandom() % 2 != 0) {"),
]

POKEFINDER = [
    ("Core/Gen3/Generators/StaticGenerator3.cpp", "u16 iv1 = staticTemplate.getBuggedRoamer() ? go.nextUShort() & 0xff : go.nextUShort();"),
    ("Core/Gen3/Generators/WildGenerator3.cpp", "if (method == Method::Method2)"),
    ("Core/Gen3/Generators/WildGenerator3.cpp", "if (method == Method::Method4)"),
    ("Core/Gen3/Generators/WildGenerator3.cpp", "// Safari zone in RSE takes an extra RNG call to determine shuffling of pokeblocks"),
    ("Core/Gen3/Generators/EggGenerator3.cpp", "// VBlank at 17 from starting PID generation"),
    ("Core/Gen3/Generators/EggGenerator3.cpp", "PokeRNG trng((val - offset) & 0xffff);"),
    ("Core/Gen3/Generators/EggGenerator3.cpp", "bool flag = everstone ? (go.nextUShort() >> 15) == 0 : false;"),
    ("Core/Gen4/Generators/WildGenerator4.cpp", "// DP uses 4 advances to create the information that determine if quick claw will proc"),
    ("Core/Gen4/Generators/WildGenerator4.cpp", "// Advance used to determine the random ball position when thrown out"),
    ("Core/Gen4/Generators/WildGenerator4.cpp", "// Fishing uses an advance to determine the visual frames range in which you have to press A"),
    ("Core/Gen4/Generators/EggGenerator4.cpp", "u32 pid = mt.next();"),
    ("Core/Gen4/EncounterArea4.hpp", "u8 rand = rng.nextUShort<!honey>(range, battleAdvances);"),
    ("Core/Gen4/EncounterArea4.hpp", "if (force && rng.nextUShort<mod>(2, battleAdvances) != 0)"),
    ("Core/Gen4/States/State4.hpp", "call(prng % 3), chatot(((prng % 8192) * 100) >> 13)"),
    ("Core/RNG/LCRNG.hpp", "static u32 distance(u32 start, u32 end)"),
    ("Core/Resources/EncounterTables/Gen4/hgss.py", "# Ruins of Alpha interior all share the same table"),
    ("Core/Gen4/Generators/WildGenerator4.cpp", "form = 26 + go.nextUShort(2, &battleAdvances);"),
    ("Core/Gen4/Generators/WildGenerator4.cpp", "if (area.getEncounter() == Encounter::Grass || safari)"),
    ("Core/Gen4/Generators/WildGenerator4.cpp", "level = area.calculateLevel<true, true>(encounterSlot, go, &battleAdvances, lead == Lead::Pressure);"),
    ("Core/Gen4/Generators/WildGenerator4.cpp", "if ((lead == Lead::MagnetPull || lead == Lead::Static) && go.nextUShort<false>(2, &battleAdvances) == 0"),
    ("Core/Gen3/Generators/WildGenerator3.cpp", "if ((lead == Lead::MagnetPull || lead == Lead::Static) && go.nextUShort(2) == 0 && !modifiedSlots.empty())"),
]

PKHEX = [
    ("PKHeX.Core/Legality/RNG/Algorithms/LCRNGReversal.cs", "public static int GetSeedsIVs(Span<uint> result, uint first, uint second)"),
    ("PKHeX.Core/Legality/RNG/Algorithms/LCRNGReversal.cs", "private const uint Lag0 = 0x67D3; // 26579"),
    ("PKHeX.Core/Legality/RNG/Algorithms/LCRNGReversal.cs", "result[ctr++] = seed ^ 0x80000000;"),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pret", default=os.path.expanduser("~/AI/pret"))
    ap.add_argument("--pokefinder", default="/tmp/PokeFinder")
    ap.add_argument("--pkhex", default=os.path.expanduser("~/AI/Games/PKHaX/Un-Nerf-Compendium/PKHaX"))
    a = ap.parse_args()
    misses = []
    cache = {}

    def lines(path):
        if path not in cache:
            with open(path, encoding="utf-8", errors="replace") as f:
                cache[path] = f.read().split("\n")
        return cache[path]

    for repo, file, line, text in CITATIONS:
        path = os.path.join(a.pret, repo, file)
        try:
            ls = lines(path)
        except OSError:
            misses.append(f"{repo}/{file}: missing file")
            continue
        found = any(text in ls[i] for i in range(max(0, line - 3), min(len(ls), line + 2)))
        if not found:
            misses.append(f"{repo}/{file}:{line} does not contain: {text}")
    for file, text in POKEFINDER:
        path = os.path.join(a.pokefinder, file)
        try:
            ok = any(text in l for l in lines(path))
        except OSError:
            ok = False
        if not ok:
            misses.append(f"PokeFinder {file}: {text}")
    for file, text in PKHEX:
        path = os.path.join(a.pkhex, file)
        try:
            ok = any(text in l for l in lines(path))
        except OSError:
            ok = False
        if not ok:
            misses.append(f"PKHeX {file}: {text}")
    total = len(CITATIONS) + len(POKEFINDER) + len(PKHEX)
    if misses:
        print(f"{len(misses)} of {total} citations drifted:")
        for m in misses:
            print("  " + m)
        sys.exit(1)
    print(f"all {total} citations verified ({len(CITATIONS)} decomp lines, {len(POKEFINDER)} PokeFinder, {len(PKHEX)} PKHeX)")


if __name__ == "__main__":
    main()
