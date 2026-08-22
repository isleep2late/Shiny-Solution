import os
import sys

import lupa.lua54 as lua54

SCRIPT = os.environ.get("SHINY_SCRIPT") or os.path.join(os.path.dirname(__file__), "..", "lua", "shiny-solution.lua")

MULT = 1103515245
ADD = 24691
MOD = 1 << 32

HARNESS = r"""
logLines = {}
console = {
  log = function(self, msg)
    logLines[#logLines + 1] = msg
  end
}
C = { GBA_KEY = { A = 0 } }
callbacks = {
  cbs = {},
  add = function(self, name, fn)
    self.cbs[name] = fn
  end
}
sim = {
  rng = 0,
  trainer = 0,
  gender = 0,
  enemy = 0,
  enemyOt = 0,
  keys = 0,
  mode = "tidprompt",
  pending = nil,
  procDelay = 5,
  procDelayAfterFirst = nil,
  generations = 0,
  rolls = {},
  rollCount = 0,
  states = {},
  -- party modelled as 6 slots of {pid, ot}; new mons fill the first empty slot, like the game
  slotPid = { 0, 0, 0, 0, 0, 0 },
  slotOt = { 0, 0, 0, 0, 0, 0 }
}
local PARTY_BASE = 0x03004360
local MON = 100
local function firstEmptySlot()
  for i = 1, 6 do
    if sim.slotPid[i] == 0 then return i end
  end
  return nil
end
local function stepRng()
  sim.rng = (sim.rng * 1103515245 + 24691) & 0xFFFFFFFF
end
local function rand16()
  stepRng()
  return (sim.rng >> 16) & 0xFFFF
end
-- Byte-accurate model of the words the script reads, so the stub can reproduce mGBA's bus
-- semantics: GBALoad32 masks the address to a 4-byte boundary and rotates the word by
-- (addr & 3) * 8 bits; GBALoad16 masks to 2 bytes. (The original stub returned the trainer
-- word for an unaligned read32 and thereby hid the SID bug.)
local SB2 = 0x02024EA4
local function byteAt(addr)
  local function b(v, i) return (v >> (8 * i)) & 0xFF end
  if addr >= SB2 + 0x08 and addr < SB2 + 0x10 then
    local bytes = { sim.gender, 0, b(sim.trainer, 0), b(sim.trainer, 1), b(sim.trainer, 2), b(sim.trainer, 3), 0, 0 }
    return bytes[addr - (SB2 + 0x08) + 1]
  end
  if addr >= 0x03004818 and addr < 0x0300481C then return b(sim.rng, addr - 0x03004818) end
  if addr >= PARTY_BASE and addr < PARTY_BASE + 6 * MON then
    local off = addr - PARTY_BASE
    local slot = (off // MON) + 1
    local within = off % MON
    if within < 4 then return b(sim.slotPid[slot], within) end
    if within < 8 then return b(sim.slotOt[slot], within - 4) end
    return 0
  end
  if addr >= 0x030045C0 and addr < 0x030045C4 then return b(sim.enemy, addr - 0x030045C0) end
  if addr >= 0x030045C4 and addr < 0x030045C8 then return b(sim.enemyOt, addr - 0x030045C4) end
  return 0
end
local function ror32(v, n)
  if n == 0 then return v end
  return ((v >> n) | (v << (32 - n))) & 0xFFFFFFFF
end
emu = {
  read8 = function(self, addr)
    return byteAt(addr)
  end,
  read16 = function(self, addr)
    local a = addr & ~1
    local v = byteAt(a) | (byteAt(a + 1) << 8)
    return ror32(v, (addr & 1) * 8) & 0xFFFF
  end,
  read32 = function(self, addr)
    local a = addr & ~3
    local v = byteAt(a) | (byteAt(a + 1) << 8) | (byteAt(a + 2) << 16) | (byteAt(a + 3) << 24)
    return ror32(v, (addr & 3) * 8)
  end,
  readRange = function(self, addr, len)
    if addr == 0x080000AC and len == 4 then return "AXVE" end
    return string.rep("\0", len)
  end,
  addKey = function(self, k)
    sim.keys = sim.keys | (1 << k)
  end,
  clearKey = function(self, k)
    sim.keys = sim.keys & ~(1 << k)
  end,
  saveStateSlot = function(self, slot)
    local sp, so = {}, {}
    for i = 1, 6 do sp[i] = sim.slotPid[i]; so[i] = sim.slotOt[i] end
    sim.states[slot] = { rng = sim.rng, trainer = sim.trainer, slotPid = sp, slotOt = so,
      enemy = sim.enemy, enemyOt = sim.enemyOt, mode = sim.mode, pending = sim.pending }
    return true
  end,
  loadStateSlot = function(self, slot)
    local st = sim.states[slot]
    if not st then return false end
    sim.rng = st.rng
    sim.trainer = st.trainer
    for i = 1, 6 do sim.slotPid[i] = st.slotPid[i]; sim.slotOt[i] = st.slotOt[i] end
    sim.enemy = st.enemy
    sim.enemyOt = st.enemyOt
    sim.mode = st.mode
    sim.pending = st.pending
    return true
  end
}
function simFrame()
  if (sim.keys & 1) == 1 and sim.pending == nil and sim.mode ~= "done" then
    sim.pending = sim.procDelay
  end
  if sim.pending then
    sim.pending = sim.pending - 1
    if sim.pending == 0 then
      if sim.mode == "tidprompt" then
        local sid = rand16()
        local tid = rand16()
        sim.trainer = (sid << 16) | tid
      elseif sim.mode == "enemystatic" then
        local lo = rand16()
        local hi = rand16()
        rand16()
        rand16()
        sim.enemy = (hi << 16) | lo
        sim.enemyOt = sim.trainer
      elseif sim.mode == "huntlist" then
        sim.rollCount = sim.rollCount + 1
        sim.enemy = sim.rolls[sim.rollCount] or 0x13571357
        sim.enemyOt = sim.trainer
      else
        local lo = rand16()
        local hi = rand16()
        rand16()
        rand16()
        -- CreateBoxMon writes the mon (PID, then OT ID from the save block) into the first
        -- empty party slot.
        local slot = firstEmptySlot() or 1
        sim.slotPid[slot] = (hi << 16) | lo
        sim.slotOt[slot] = sim.trainer
      end
      sim.pending = nil
      sim.mode = "done"
      sim.generations = sim.generations + 1
      if sim.generations == 1 and sim.procDelayAfterFirst then
        sim.procDelay = sim.procDelayAfterFirst
      end
    end
  end
  stepRng()
  callbacks.cbs.frame()
end
function runFrames(n)
  for _ = 1, n do
    simFrame()
  end
end
"""


def step(s):
    return (MULT * s + ADD) % MOD


def hi(s):
    return s >> 16


def make_runtime(seed, mode, trainer=0, proc_delay=5, proc_delay_after_first=None, enemy=0, rolls=None):
    rt = lua54.LuaRuntime()
    rt.execute(HARNESS)
    rt.execute(f"sim.rng = {seed}")
    rt.execute(f'sim.mode = "{mode}"')
    rt.execute(f"sim.trainer = {trainer}")
    rt.execute(f"sim.procDelay = {proc_delay}")
    rt.execute(f"sim.enemy = {enemy}")
    if proc_delay_after_first is not None:
        rt.execute(f"sim.procDelayAfterFirst = {proc_delay_after_first}")
    for i, v in enumerate(rolls or []):
        rt.execute(f"sim.rolls[{i + 1}] = {v}")
    with open(SCRIPT) as f:
        rt.globals()["scriptSrc"] = f.read()
    rt.execute("assert(load(scriptSrc))()")
    return rt


def logs(rt):
    return [str(x) for x in rt.globals()["logLines"].values()]


def run_until(rt, needle, cap_frames, chunk=200):
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
            for line in logs(rt)[-12:]:
                print(f"     | {line}")


def test_detection_and_tracking():
    rt = make_runtime(seed=0x1234ABCD, mode="tidprompt")
    expect("detects Ruby", any("detected Ruby" in l for l in logs(rt)), rt)
    rt.execute("runFrames(101)")
    rt.execute("status()")
    expect("advance tracks one per frame", any("advance 100 " in l for l in logs(rt)), rt)


def test_tid_flow():
    rt = make_runtime(seed=0x00C0FFEE, mode="tidprompt")
    rt.execute("runFrames(50)")
    rt.execute("tid(1337)")
    ok = run_until(rt, "SUCCESS: TID 1337", 400000)
    expect("tid flow hits exact target TID", ok, rt)
    expect("tid flow calibrated", any("calibrated: press-to-generation delta" in l for l in logs(rt)), rt)


def test_shiny_flow():
    seed = 0x0BADF00D
    tid = 52001
    press_effect_guess = 500
    s = seed
    for _ in range(press_effect_guess):
        s = step(s)
    s1 = step(s)
    s2 = step(s1)
    pid_lo = hi(s1)
    pid_hi = hi(s2)
    sid = tid ^ pid_hi ^ pid_lo
    trainer = (sid << 16) | tid
    rt = make_runtime(seed=seed, mode="starterprompt", trainer=trainer)
    rt.execute("runFrames(50)")
    rt.execute("status()")
    expect("status reads the real SID through aligned 16-bit reads", any(f"TID {tid} SID {sid}" in l for l in logs(rt)), rt)
    rt.execute("shiny()")
    ok = run_until(rt, "SUCCESS", 200000)
    expect("shiny flow completes", ok, rt)
    if ok:
        pid = int(rt.eval("sim.slotPid[1]"))
        expect("delivered PID is truly shiny", (tid ^ sid ^ (pid >> 16) ^ (pid & 0xFFFF)) < 8, rt)
        expect("script reports the shiny", any("SUCCESS" in l and "SHINY" in l for l in logs(rt)), rt)
        expect("success is verified against the mon's own OT ID", any(f"verified against OT ID {tid}/{sid}" in l for l in logs(rt)), rt)


def test_user_checkpoint_regression():
    """The exact situation from the 2026-08-21 Ruby run (player LANDON, boy):
    TID 53559 / SID 56406, checkpoint RNG state ED720F6A. The buggy unaligned read
    saw SID 0 and pressed for advance 618 (PID B90F683F), which is not shiny."""
    tid, sid, seed = 53559, 56406, 0xED720F6A
    trainer = (sid << 16) | tid
    rt = make_runtime(seed=seed, mode="starterprompt", trainer=trainer)
    rt.execute("runFrames(20)")
    rt.execute("selfcheck()")
    expect("selfcheck reports TID 53559 / SID 56406", any("TID 53559 / SID 56406" in l for l in logs(rt)), rt)
    rt.execute("shiny()")
    ok = run_until(rt, "SUCCESS", 400000)
    expect("LANDON's checkpoint now yields a shiny", ok, rt)
    if ok:
        pid = int(rt.eval("sim.slotPid[1]"))
        expect("delivered Torchic PID is shiny for 53559/56406", (tid ^ sid ^ (pid >> 16) ^ (pid & 0xFFFF)) < 8, rt)
        expect("it is NOT the SID-0 false target B90F683F", pid != 0xB90F683F, rt)


def test_otid_mismatch_is_adopted():
    """If the save-block address were wrong for a ROM (hack), the OT ID the game writes into
    the mon is the truth; the script must target that and still deliver a real shiny."""
    tid, sid, seed = 4242, 31337, 0x600D5EED
    rt = make_runtime(seed=seed, mode="starterprompt", trainer=(sid << 16) | tid)
    # the save block lies (reports a different SID) but the mon gets the real OT ID
    rt.execute("""
      local oldRead16 = emu.read16
      emu.read16 = function(self, addr)
        if addr == 0x02024EA4 + 0x0C then return 1234 end
        return oldRead16(self, addr)
      end
    """)
    rt.execute("runFrames(20)")
    rt.execute("shiny()")
    ok = run_until(rt, "SUCCESS", 400000)
    expect("flow with a lying save block still completes", ok, rt)
    if ok:
        pid = int(rt.eval("sim.slotPid[1]"))
        expect("warned about the OT ID mismatch", any("WARNING (calibration)" in l for l in logs(rt)), rt)
        expect("delivered PID is shiny for the REAL OT ID", (tid ^ sid ^ (pid >> 16) ^ (pid & 0xFFFF)) < 8, rt)


def test_gift_with_existing_party():
    """A later gift: party already has two members; the new mon must land in slot 3, and the
    flow must watch slot 3 (the old script only ever watched slot 1 and would hang here)."""
    tid, sid, seed = 100, 200, 0x1234ABCD
    rt = make_runtime(seed=seed, mode="starterprompt", trainer=(sid << 16) | tid)
    rt.execute("sim.slotPid[1] = 0xAAAAAAAA; sim.slotOt[1] = sim.trainer")
    rt.execute("sim.slotPid[2] = 0xBBBBBBBB; sim.slotOt[2] = sim.trainer")
    rt.execute("runFrames(20)")
    rt.execute("shiny()")
    expect("watches slot 3 when two mons are in the party", any("watching party slot 3" in l for l in logs(rt)), rt)
    ok = run_until(rt, "SUCCESS", 400000)
    expect("gift into a non-empty party completes", ok, rt)
    if ok:
        pid = int(rt.eval("sim.slotPid[3]"))
        expect("gift PID is shiny", (tid ^ sid ^ (pid >> 16) ^ (pid & 0xFFFF)) < 8, rt)
        expect("slots 1 and 2 are untouched", int(rt.eval("sim.slotPid[1]")) == 0xAAAAAAAA, rt)


def test_miss_and_retry():
    rt = make_runtime(seed=0x13572468, mode="tidprompt", proc_delay=5, proc_delay_after_first=7)
    rt.execute("runFrames(50)")
    rt.execute("tid(777)")
    ok = run_until(rt, "SUCCESS: TID 777", 800000)
    expect("tid flow recovers from calibration drift", ok, rt)
    expect("a miss was detected and corrected", any("miss:" in l for l in logs(rt)), rt)
    expect("a retry was attempted", any("retrying with corrected calibration" in l for l in logs(rt)), rt)


def test_raw_target():
    rt = make_runtime(seed=0x22334455, mode="done")
    rt.execute("sim.slotPid[1] = 12345")
    rt.execute("runFrames(50)")
    rt.execute("target(300)")
    ok = run_until(rt, "raw press fired at advance 300", 2000)
    expect("raw target completes cleanly", ok, rt)


def test_busy_guard():
    rt = make_runtime(seed=0x00C0FFEE, mode="tidprompt")
    rt.execute("runFrames(50)")
    rt.execute("tid(1337)")
    rt.execute("target(99999)")
    expect("target() during a flow reports busy", any("busy; call cancel() first" in l for l in logs(rt)), rt)
    ok = run_until(rt, "SUCCESS: TID 1337", 400000)
    expect("flow still completes after rejected target()", ok, rt)


def test_tight_delta_shiny():
    seed = 0x600DCAFE
    tid = 11111
    press_effect_guess = 300
    s = seed
    for _ in range(press_effect_guess):
        s = step(s)
    s1 = step(s)
    s2 = step(s1)
    sid = tid ^ hi(s2) ^ hi(s1)
    trainer = (sid << 16) | tid
    rt = make_runtime(seed=seed, mode="starterprompt", trainer=trainer, proc_delay=1)
    rt.execute("runFrames(50)")
    rt.execute("shiny()")
    ok = run_until(rt, "SUCCESS", 200000)
    expect("shiny flow survives generation 1 frame after press", ok, rt)
    if ok:
        pid = int(rt.eval("sim.slotPid[1]"))
        expect("tight-delta PID is truly shiny", (tid ^ sid ^ (pid >> 16) ^ (pid & 0xFFFF)) < 8, rt)


def test_static_enemy_flow():
    seed = 0x51A71C00
    tid = 42424
    press_effect_guess = 420
    s = seed
    for _ in range(press_effect_guess):
        s = step(s)
    s1 = step(s)
    s2 = step(s1)
    sid = tid ^ hi(s2) ^ hi(s1)
    trainer = (sid << 16) | tid
    rt = make_runtime(seed=seed, mode="enemystatic", trainer=trainer, enemy=0x11223344)
    rt.execute("sim.slotPid[1] = 99999")
    rt.execute("runFrames(50)")
    rt.execute('shiny("enemy")')
    ok = run_until(rt, "SUCCESS", 200000)
    expect("static enemy flow completes", ok, rt)
    if ok:
        pid = int(rt.eval("sim.enemy"))
        expect("static enemy PID is truly shiny", (tid ^ sid ^ (pid >> 16) ^ (pid & 0xFFFF)) < 8, rt)


def test_hunt_brute_force():
    tid = 31337
    sid = 4242
    trainer = (sid << 16) | tid
    shiny_pid = (sid << 16) | tid
    rolls = [0x12345678, 0x9ABCDEF0, 0x0F1E2D3C, 0x55AA55AA, shiny_pid, 0x77777777]
    rt = make_runtime(seed=0x00112233, mode="huntlist", trainer=trainer, enemy=0x11223344, rolls=rolls)
    rt.execute("runFrames(50)")
    rt.execute("hunt()")
    ok = run_until(rt, "FOUND on attempt 5", 300000)
    expect("hunt finds planted shiny on attempt 5", ok, rt)
    if ok:
        expect("hunt announces SHINY", any("SHINY" in l and "FOUND" in l for l in logs(rt)), rt)
        expect("keys released after hunt", int(rt.eval("sim.keys")) == 0, rt)


def test_hunt_cancel_and_guards():
    rt = make_runtime(seed=0x00112233, mode="huntlist", trainer=0x00010001, rolls=[0x11111111])
    rt.execute("runFrames(50)")
    rt.execute("hunt()")
    rt.execute("shiny()")
    expect("flows blocked while hunting", any("busy" in l or "already" in l for l in logs(rt)), rt)
    rt.execute("cancel()")
    expect("cancel stops the hunt", any("hunt cancelled" in l for l in logs(rt)), rt)


test_detection_and_tracking()
test_tid_flow()
test_shiny_flow()
test_user_checkpoint_regression()
test_otid_mismatch_is_adopted()
test_gift_with_existing_party()
test_miss_and_retry()
test_raw_target()
test_busy_guard()
test_tight_delta_shiny()
test_static_enemy_flow()
test_hunt_brute_force()
test_hunt_cancel_and_guards()

if failures:
    print(f"{failures} failure(s)")
    sys.exit(1)
print("all lua simulation tests passed")
