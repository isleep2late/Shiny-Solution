"""Adversarial repro for the claim: loadCheckpoint can fire while the scripted
A press is still held, so the restored prompt is re-consumed by the stale press.

Uses the same harness as lua-sim.py. sim.keys is host-side state and is
deliberately NOT restored by loadStateSlot (matching mGBA: scripted addKey
injection survives a savestate load); sim mode/pending/party/rng ARE restored
(game-side state).

proc_delay=N means the game generates the result N frames after it first sees
A held (measured press-to-generation delta = N-1 advances).
"""
import importlib.util
import os
import sys

spec = importlib.util.spec_from_file_location(
    "luasim", os.path.join(os.path.dirname(__file__), "lua-sim.py"))
# lua-sim.py runs its tests on import; instead re-use its source pieces manually.
import lupa.lua54 as lua54

HARNESS = None
with open(os.path.join(os.path.dirname(__file__), "lua-sim.py")) as f:
    src = f.read()
# extract the HARNESS lua string verbatim
start = src.index('HARNESS = r"""') + len('HARNESS = r"""')
end = src.index('"""', start)
HARNESS = src[start:end]

SCRIPT = os.path.join(os.path.dirname(__file__), "..", "lua", "shiny-solution.lua")

MULT = 1103515245
ADD = 24691
MOD = 1 << 32


def step(s):
    return (MULT * s + ADD) % MOD


def hi(s):
    return s >> 16


def make_runtime(seed, mode, trainer=0, proc_delay=5):
    rt = lua54.LuaRuntime()
    rt.execute(HARNESS)
    rt.execute(f"sim.rng = {seed}")
    rt.execute(f'sim.mode = "{mode}"')
    rt.execute(f"sim.trainer = {trainer}")
    rt.execute(f"sim.procDelay = {proc_delay}")
    with open(SCRIPT) as f:
        rt.globals()["scriptSrc"] = f.read()
    rt.execute("assert(load(scriptSrc))()")
    return rt


def logs(rt):
    return [str(x) for x in rt.globals()["logLines"].values()]


def run_shiny(proc_delay, label):
    seed = 0x0BADF00D
    tid = 52001
    press_effect_guess = 500
    s = seed
    for _ in range(press_effect_guess):
        s = step(s)
    s1 = step(s)
    s2 = step(s1)
    sid = tid ^ hi(s2) ^ hi(s1)
    trainer = (sid << 16) | tid
    rt = make_runtime(seed=seed, mode="starterprompt", trainer=trainer,
                      proc_delay=proc_delay)
    rt.execute("runFrames(50)")
    rt.execute("shiny()")
    for _ in range(20):
        rt.execute("runFrames(2000)")
        L = logs(rt)
        if any("SUCCESS" in l for l in L) or any("stopped after miss" in l for l in L):
            break
    L = logs(rt)
    print(f"=== {label} (proc_delay={proc_delay}) ===")
    for line in L:
        print("  " + line)
    gens = int(rt.eval("sim.generations"))
    party = int(rt.eval("sim.party"))
    print(f"  [sim] generations={gens} party_pid={party:08X} "
          f"shiny={ (tid ^ sid ^ (party >> 16) ^ (party & 0xFFFF)) < 8 }")
    print()
    return L, gens


bad, bad_gens = run_shiny(1, "starter-like tight delay")
ok, ok_gens = run_shiny(5, "control slow delay")

fail = False
if not any("result not found near the press" in l for l in bad):
    print("REFUTED: tight-delay run did not show the 'not found near press' miss")
    fail = True
if not any("stopped after miss" in l for l in bad):
    print("REFUTED: tight-delay run did not hard-fail")
    fail = True
if not any("SUCCESS" in l for l in ok):
    print("CONTROL BROKEN: slow-delay run did not succeed")
    fail = True
if fail:
    sys.exit(1)
print("CONFIRMED: load-while-A-held corrupts the restored prompt "
      f"(tight run wasted {bad_gens} generations; control succeeded)")
