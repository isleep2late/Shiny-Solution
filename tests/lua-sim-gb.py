import os
import sys

import lupa.lua54 as lua54

SCRIPT = os.path.join(os.path.dirname(__file__), "..", "lua", "shiny-solution-gb.lua")

HARNESS = r"""
logLines = {}
console = {
  log = function(self, msg)
    logLines[#logLines + 1] = msg
  end
}
C = { GB_KEY = { A = 0, B = 1, SELECT = 2, START = 3, RIGHT = 4, LEFT = 5, UP = 6, DOWN = 7 } }
callbacks = {
  cbs = {},
  add = function(self, name, fn)
    self.cbs[name] = fn
  end
}
sim = {
  mem = {},
  keys = 0,
  pending = nil,
  procDelay = 4,
  rollCount = 0,
  rolls = {},
  rollTarget = "enemy",
  states = {},
  title = "POKEMON RED",
  gameCode = "",
  gen1count = 1
}
emu = {
  read8 = function(self, addr)
    if addr == 0x014A then return sim.mem[0x014A] or 1 end -- destination: default non-Japan
    if addr == 0xFF70 then return sim.mem[0xFF70] or 1 end -- SVBK: default bank 1 (safe)
    return sim.mem[addr] or 0
  end,
  readRange = function(self, addr, len)
    if addr == 0x0134 then
      local t = sim.title
      while #t < len do t = t .. "\0" end
      return t
    end
    if addr == 0x013F and len == 4 then
      local c = sim.gameCode
      if #c == 0 then return string.rep("\0", 4) end
      while #c < 4 do c = c .. "\0" end
      return c:sub(1, 4)
    end
    return string.rep("\0", len)
  end,
  addKey = function(self, k)
    sim.keys = sim.keys | (1 << k)
  end,
  clearKey = function(self, k)
    sim.keys = sim.keys & ~(1 << k)
  end,
  clearKeys = function(self, mask)
    sim.keys = sim.keys & ~mask
  end,
  saveStateSlot = function(self, slot)
    local copy = {}
    for a, v in pairs(sim.mem) do copy[a] = v end
    sim.states[slot] = { mem = copy, pending = sim.pending }
    return true
  end,
  loadStateSlot = function(self, slot)
    local st = sim.states[slot]
    if not st then return false end
    sim.mem = {}
    for a, v in pairs(st.mem) do sim.mem[a] = v end
    sim.pending = st.pending
    return true
  end
}
function simFrame()
  if sim.keys ~= 0 and sim.pending == nil and sim.rollTarget ~= "none" then
    sim.pending = sim.procDelay
  end
  if sim.pending then
    sim.pending = sim.pending - 1
    if sim.pending <= 0 then
      sim.pending = nil
      sim.rollCount = sim.rollCount + 1
      local val = sim.rolls[sim.rollCount] or 0x1111
      if sim.rollTarget == "enemy" then
        sim.mem[0xD057] = 1
        sim.mem[0xCFF1] = (val >> 8) & 0xFF
        sim.mem[0xCFF2] = val & 0xFF
      elseif sim.rollTarget == "party" then
        -- Gen 2 model: DVs are rolled in GeneratePartyMonStats before naming, then the count
        -- is bumped; watcher sees count go up and reads the finished slot.
        local n = (sim.mem[0xDA22] or 0) + 1
        sim.mem[0xDA22] = n
        local base = 0xDA3F + 0x30 * (n - 1)
        sim.mem[base] = (val >> 8) & 0xFF
        sim.mem[base + 1] = val & 0xFF
      elseif sim.rollTarget == "party_gen1" then
        -- Gen 1 model: the mon's slot already exists (count pre-incremented) with stale DV
        -- bytes; the DV roll writes the slot only when naming ends (the B press). Count is
        -- NOT changed here.
        local count = sim.mem[0xD163] or sim.gen1count
        local base = 0xD186 + 0x2C * (count - 1)
        sim.mem[base] = (val >> 8) & 0xFF
        sim.mem[base + 1] = val & 0xFF
      elseif sim.rollTarget == "tid" then
        sim.mem[0xD359] = (val >> 8) & 0xFF
        sim.mem[0xD35A] = val & 0xFF
      end
    end
  end
  callbacks.cbs.frame()
end
function runFrames(n)
  for _ = 1, n do
    simFrame()
  end
end
"""


CODES = {"POKEMON_GLD": "AAUE", "POKEMON_SLV": "AAXE", "PM_CRYSTAL": "BYTE"}


def make_runtime(rolls, title="POKEMON RED", roll_target="enemy", game_code=None,
                 dest=1, gen1_count=None, gen1_baseline=None):
    rt = lua54.LuaRuntime()
    rt.execute(HARNESS)
    rt.execute(f'sim.title = "{title}"')
    rt.execute(f'sim.rollTarget = "{roll_target}"')
    code = game_code if game_code is not None else CODES.get(title, "")
    rt.execute(f'sim.gameCode = "{code}"')
    rt.execute(f"sim.mem[0x014A] = {dest}")
    if gen1_count is not None:
        rt.execute(f"sim.gen1count = {gen1_count}")
        rt.execute(f"sim.mem[0xD163] = {gen1_count}")
    if gen1_baseline is not None:
        base = 0xD186 + 0x2C * ((gen1_count or 1) - 1)
        rt.execute(f"sim.mem[{base}] = {(gen1_baseline >> 8) & 0xFF}")
        rt.execute(f"sim.mem[{base + 1}] = {gen1_baseline & 0xFF}")
    for i, v in enumerate(rolls):
        rt.execute(f"sim.rolls[{i + 1}] = {v}")
    with open(SCRIPT, encoding="utf-8") as f:
        rt.globals()["scriptSrc"] = f.read()
    rt.execute("assert(load(scriptSrc))()")
    return rt


def logs(rt):
    return [str(x) for x in rt.globals()["logLines"].values()]


def run_until(rt, needle, cap_frames, chunk=500):
    ran = 0
    while ran < cap_frames:
        rt.execute(f"runFrames({chunk})")
        ran += chunk
        for line in logs(rt):
            if needle in line:
                return True
    return False


failures = 0


def expect(label, ok, rt=None):
    global failures
    if ok:
        print(f"ok   {label}")
    else:
        failures += 1
        print(f"FAIL {label}")
        if rt is not None:
            for line in logs(rt)[-10:]:
                print(f"     | {line}")


def test_encounter_shiny():
    rolls = [0x1234, 0x5678, 0x9ABC, 0x4321, 0x8765, 0x2AAA, 0x1111]
    rt = make_runtime(rolls)
    expect("detects Red", any("detected Red" in l for l in logs(rt)), rt)
    rt.execute("runFrames(10)")
    rt.execute("hunt()")
    ok = run_until(rt, "FOUND on attempt 6", 400000)
    expect("encounter hunt finds planted shiny on attempt 6", ok, rt)
    if ok:
        expect("announces SHINY", any("SHINY" in l and "FOUND" in l for l in logs(rt)), rt)
        expect("keys released after find", int(rt.eval("sim.keys")) == 0, rt)


def test_gift_party_watch_gen2():
    # Gen 2 (Gold): DVs are rolled before naming, then the party count is bumped; the bot
    # watches the count rise and reads the finished slot.
    rolls = [0x5678, 0xF0F0, 0x0F0F, 0xBAAA]
    rt = make_runtime(rolls, title="POKEMON_GLD", roll_target="party")
    expect("detects Gold", any("detected Gold" in l for l in logs(rt)), rt)
    rt.execute("runFrames(10)")
    rt.execute('setopt("watch", "party")')
    rt.execute("hunt()")
    ok = run_until(rt, "FOUND on attempt 4", 300000)
    expect("gen2 gift hunt watches party count and finds shiny", ok, rt)


def test_gift_party_watch_gen1():
    # Gen 1 (Red): the nickname prompt precedes the DV roll, so the mon's slot exists with
    # stale DVs; the bot must decline the name (trigger B) and watch the slot's DVs change.
    # Baseline 0x1357 (non-shiny) is overwritten on each attempt; the shiny 0x2AAA is roll 3.
    rolls = [0x5678, 0x0F0F, 0x2AAA, 0x1111]
    rt = make_runtime(rolls, title="POKEMON RED", roll_target="party_gen1",
                      gen1_count=1, gen1_baseline=0x1357)
    rt.execute("runFrames(10)")
    rt.execute('setopt("watch", "party")')
    rt.execute('setopt("trigger", "B")')
    rt.execute("hunt()")
    ok = run_until(rt, "FOUND on attempt 3", 300000)
    expect("gen1 gift hunt declines name and finds shiny via DV change", ok, rt)
    if ok:
        expect("gen1 gift announces SHINY", any("SHINY" in l and "FOUND" in l for l in logs(rt)), rt)


def test_gen1_gift_wrong_spot():
    # If the user savestates before the mon is in the party (count 0), the bot must refuse with
    # guidance rather than hunt garbage.
    rt = make_runtime([0x2AAA], title="POKEMON RED", roll_target="party_gen1", gen1_count=0)
    rt.execute("runFrames(10)")
    rt.execute('setopt("watch", "party")')
    rt.execute('setopt("trigger", "B")')
    rt.execute("hunt()")
    ok = run_until(rt, "stand ON the", 60000)
    expect("gen1 gift hunt refuses when not on the nickname box", ok, rt)


def test_japanese_cart_refused():
    rt = make_runtime([], title="PM_CRYSTAL", game_code="AXQJ", dest=0)
    expect("Japanese/localized Crystal is refused (game code)",
           any("game code" in l and "unverified" in l for l in logs(rt)), rt)
    rt.execute("runFrames(10)")
    rt.execute("hunt()")
    expect("refuses to hunt a rejected cart", any("no supported game" in l for l in logs(rt)), rt)


def test_tid_custom():
    rolls = [0x5678, 0xABCD, 0x12F4]
    rt = make_runtime(rolls, roll_target="tid")
    rt.execute("runFrames(10)")
    rt.execute('setopt("watch", "tid")')
    rt.execute('setopt("target", "custom")')
    rt.execute('setopt("custom_dvs", "12?4")')
    rt.execute("hunt()")
    ok = run_until(rt, "FOUND on attempt 3", 200000)
    expect("tid hunt matches wildcard pattern", ok, rt)


def test_stop():
    rt = make_runtime([0x5678], roll_target="none")
    rt.execute("runFrames(10)")
    rt.execute("hunt()")
    rt.execute("stop()")
    expect("stop() works mid-hunt", any("hunt stopped" in l for l in logs(rt)), rt)


def test_timeout_advances_attempts():
    rt = make_runtime([], roll_target="none")
    rt.execute("runFrames(10)")
    rt.execute('setopt("timeout_frames", "120")')
    rt.execute("hunt()")
    ok = run_until(rt, "attempt 25", 300000)
    expect("timeouts advance attempts without a roll", ok, rt)
    expect("no false FOUND", not any("FOUND" in l for l in logs(rt)), rt)


def test_crystal_verified():
    rt = make_runtime([], title="PM_CRYSTAL")
    expect("detects Crystal with verified addresses",
        any("detected Crystal" in l for l in logs(rt)) and not any("disabled" in l for l in logs(rt)), rt)


def test_unknown_game_refuses():
    rt = make_runtime([], title="POKEMON PINBALL")
    expect("unknown ROM reported", any("unrecognized ROM title" in l for l in logs(rt)), rt)
    rt.execute("runFrames(10)")
    rt.execute("hunt()")
    expect("refuses hunt without a supported game", any("no supported game" in l for l in logs(rt)), rt)


test_encounter_shiny()
test_gift_party_watch_gen2()
test_gift_party_watch_gen1()
test_gen1_gift_wrong_spot()
test_japanese_cart_refused()
test_tid_custom()
test_stop()
test_timeout_advances_attempts()
test_crystal_verified()
test_unknown_game_refuses()

if failures:
    print(f"{failures} failure(s)")
    sys.exit(1)
print("all GB lua simulation tests passed")
