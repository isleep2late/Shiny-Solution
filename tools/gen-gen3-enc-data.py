#!/usr/bin/env python3
"""Build gen3-enc.json: Ruby/Sapphire wild-encounter data for the TID Helper's encounter mode.

Ruby and Sapphire ONLY, and that is a property of the games. See seed_model below: R/S seed the RNG
once at boot from the RTC and never reseed on the New Game or Continue path, so the state at a given
frame is arithmetic. Emerald boots with seed 0 but its advance count is not the frame count, and
FireRed/LeafGreen reseed at the TITLE SCREEN on every boot from a sub-frame hardware timer, so they
cannot be aimed at all.

What this file does NOT contain, and what the page says plainly: the number of RNG advances between a
press a person can see and the frame the encounter is generated. That is per game, map and save, and
only an emulator can measure it. The mode ships it as a calibration the runner resolves from one
attempt, exactly as the existing R/S Trainer ID page resolves its own offset.

Usage: python3 tools/gen-gen3-enc-data.py [out.json]
"""
import json, os, sys, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'core', 'data', 'gen3-enc.json')
ENC = json.load(open(os.path.join(ROOT, 'core', 'data', 'encounters-gen3.json')))
SPE = json.load(open(os.path.join(ROOT, 'core', 'data', 'species-gen3.json')))
GAMES = ['ruby', 'sapphire']
# exactly the fields core/generators.js reads off a species record, plus name/constant for display
SPECIES_FIELDS = ['dex', 'name', 'constant', 'gender_ratio', 'ability_ids', 'abilities', 'type_ids', 'types', 'base_stats']

by_dex = {s['dex']: s for s in SPE['species']}
used, out_games = set(), {}
for g in GAMES:
    src = ENC['games'][g]
    maps = []
    for m in src['maps']:
        entry = {'map': m['map'], 'name': m['name'], 'index': m['index']}
        for kind in ('land', 'water', 'rock_smash'):
            if kind in m:
                entry[kind] = {'rate': m[kind]['rate'],
                               'slots': [{'species': s['species'], 'min_level': s['min_level'], 'max_level': s['max_level']} for s in m[kind]['slots']]}
                used.update(s['species'] for s in m[kind]['slots'])
        if 'fishing' in m:
            f = {'rate': m['fishing']['rate']}
            for rod in ('old_rod', 'good_rod', 'super_rod'):
                if rod in m['fishing']:
                    f[rod] = [{'species': s['species'], 'min_level': s['min_level'], 'max_level': s['max_level']} for s in m['fishing'][rod]]
                    used.update(s['species'] for s in m['fishing'][rod])
            entry['fishing'] = f
        maps.append(entry)
    out_games[g] = {'commit': src['commit'], 'source': src['source'], 'maps': maps,
                    'map_count': len(maps), 'feebas': src.get('feebas')}

species = {str(d): {k: by_dex[d][k] for k in SPECIES_FIELDS if k in by_dex[d]} for d in sorted(used)}

out = {
 'source': 'tools/gen-gen3-enc-data.py, trimmed from encounters-gen3.json and species-gen3.json; do not edit by hand',
 'generation': 3, 'date': '2026-09-19',
 'games_note': ('Ruby and Sapphire only. This is a property of the games, not a gap - see seed_model. '
                'Emerald and FireRed/LeafGreen are deliberately absent and the page says why.'),
 'lcrng': 'x = 0x41C64E6D * x + 0x6073 mod 2^32; a call returns the high 16 bits. Identical across Gen 3.',
 'seed_model': {
   'ruby-sapphire': {
     'boot_seed': 'fold(RtcGetMinuteCount()): seed = (mc >> 16) ^ (mc & 0xFFFF)',
     'dead_battery_seed': 0x5A0,
     'dead_battery_note': ('A dead RTC battery returns the dummy clock (2000-01-01, day 1 = 1440 minutes), so '
                           'fold(1440) = 1440 = 0x5A0 on EVERY boot. That constant is what makes the manipulation '
                           'repeatable without reading the in-game clock.'),
     'reseeded_on_continue': False,
     'citations': ['pokeruby src/main.c:115 SeedRngWithRtc() called unconditionally in AgbMain; the fold is at :201-206',
                   'pokeruby src/rtc.c:13 sRtcDummy (2000-01-01) and :134-139, returned whenever the RTC error flag is set',
                   'pokeruby src/main.c:328 Random() in VBlankIntr, unconditional - one advance per frame',
                   'pokeruby has no SeedRngAndSetTrainerId and no TM1CNT anywhere in src/, so nothing reseeds later']},
   'emerald': {'offered': False,
     'why': ('Boots with seed 0 (the SeedRngWithRtc call is inside #ifdef BUGFIX, pokeemerald src/main.c:108-110) and '
             'a Continue does not reseed (src/naming_screen.c:701 is the only call site). But the advance count is NOT '
             'the frame count: other Random() callers fire on the boot path (src/intro.c:3119 and :1172, '
             'src/load_save.c:74 and :129), measured at about 10,093 advances over 10,000 idle frames. Offering it '
             'would need those counts measured on an emulator first.')},
   'firered-leafgreen': {'offered': False,
     'why': ('NOT targetable at all. SeedRngAndSetTrainerId() runs at the TITLE SCREEN on every boot that reaches the '
             'main menu, a Continue included (pokefirered src/title_screen.c:735, before LoadGameSave at :739 and '
             'SetMainCallback2(CB2_InitMainMenu) at :744). The seed is REG_TM1CNT_L (src/main.c:264-270) from a timer '
             'started at src/title_screen.c:351 running at about 16.78 MHz, so it wraps roughly every 3.9 ms - '
             'sub-frame, and no press timed to any frame can choose it.')}},
 'not_derived': [
   ('THE ADVANCE COUNT. How many LCRNG advances separate a press a person can see from the frame the encounter is '
    'generated is NOT in this file and has not been measured. It is one number per game, boot path, map and save: '
    'wandering NPCs and the ambient-cry task consume the RNG in the overworld. Only an emulator can produce it. The '
    'mode therefore treats it as a calibration the runner resolves from a single attempt, and says so.'),
   'Nothing here has been run on hardware, or performed by a person.',
   'Emerald and FireRed/LeafGreen: see seed_model - deliberately not offered, for two different reasons.',
   'Only land, water, rock smash and the three fishing rods are carried; no static or gift encounters.'],
 'credits': [
   {'who': 'the pret project', 'role': 'the mechanics',
    'what': ('pokeruby, pokeemerald and pokefirered. Every seed and encounter claim above is read from those '
             'disassemblies, and the encounter tables themselves come from the pokeruby commit named per game.'),
    'url': 'https://github.com/pret'},
   {'who': 'PokeFinder (Admiral-Fish)', 'role': 'the tool conventions this engine matches',
    'what': ('The Gen 3 wild generator in core/generators.js follows PokeFinder for frame convention, slot array '
             'order and the empirical call positions (WildGenerator3.cpp, StaticGenerator3.cpp), and this project '
             'treats it as the oracle for those conventions throughout. GPL-3.0.'),
    'url': 'https://github.com/Admiral-Fish/PokeFinder'},
   {'who': 'PKHeX', 'role': 'the LCRNG reversal',
    'what': 'The reverse-multiplier constants and the reversal algorithm follow PKHeX (LCRNG.rMult and related).',
    'url': 'https://github.com/kwsch/PKHeX'},
   {'who': 'ConstructiveCynicism', 'role': 'pointed at the technique',
    'what': ('Said plainly that encounter manipulation - hard reset plus specific held inputs on an existing file - '
             'is the Gen 3 RNG work speedruns actually use, and that the Trainer ID is reseeded when naming the '
             'player. Both were right and both shaped what this does and does not offer. Their FRLG-StarterTool '
             'documents the FireRed/LeafGreen side, and its scanned tables were offered to this project; nothing '
             'here is copied from them, and they are the right thing to check our own derivation against.'),
    'url': 'https://github.com/ConstructiveCynicism/FRLG-StarterTool'},
   {'who': 'CasualPokePlayer', 'role': 'corrected the scope',
    'what': ('Established that Emerald and FireRed/LeafGreen are practically impossible to manipulate for TID/SID '
             'and that Ruby/Sapphire pair manipulation does have Any% use - which is why R/S is the family this '
             'starts with.')}],
 'credit_note': ('These credits name whose work this rests on or came from. None of them endorse this tool, have '
                 'checked it, or agree with what it says.'),
 'inputs_sha1': {f: hashlib.sha1(open(os.path.join(ROOT,'core','data',f),'rb').read()).hexdigest()
                 for f in ('encounters-gen3.json', 'species-gen3.json')},
 'species': species, 'species_count': len(species), 'games': out_games}
json.dump(out, open(OUT, 'w'), separators=(',', ':'), sort_keys=False)
print('species carried: %d' % len(species))
for g in GAMES: print('  %-9s %d maps' % (g, len(out_games[g]['maps'])))
print('written: %s (%.2f MB)' % (OUT, os.path.getsize(OUT)/1048576))
