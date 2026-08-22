"""Adversarial verification: does target(n) crash the frame callback in the confirm path?

Mocks the mGBA scripting surface (emu/console/callbacks/C), loads
lua/shiny-solution.lua unmodified, detects as Ruby (AXVE), advances the RNG
one step per frame, occupies party slot 1, calls target(200), and drives the
registered frame callback to see what actually happens after the press.
"""
import os
import lupa

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "lua", "shiny-solution.lua")

MULT = 1103515245
ADD = 24691
MASK = 0xFFFFFFFF

RNG_ADDR = 0x03004818
SAVE2 = 0x02024EA4
PARTY = 0x03004360

class Sim:
    def __init__(self, party_pid):
        self.rng = 0x12345678
        self.party_pid = party_pid
        self.trainer_word = (0xABCD << 16) | 0x3039  # SID 0xABCD, TID 12345
        self.keys = set()
        self.logs = []

    def step_rng(self):
        self.rng = (self.rng * MULT + ADD) & MASK

def make_env(lua, sim):
    def read32(_self, addr):
        addr = int(addr)
        if addr == RNG_ADDR:
            return sim.rng
        if addr == SAVE2 + 0x0A:
            return sim.trainer_word
        if addr == PARTY:
            return sim.party_pid
        return 0

    def read_range(_self, addr, length):
        if int(addr) == 0x080000AC and int(length) == 4:
            return "AXVE"
        return "\0" * int(length)

    emu = lua.table(
        read32=read32,
        read8=lambda _self, addr: 0,
        readRange=read_range,
        addKey=lambda _self, k: sim.keys.add(int(k)),
        clearKey=lambda _self, k: sim.keys.discard(int(k)),
        # no saveStateSlot -> hasSavestates() False (irrelevant for target())
    )
    console = lua.table(log=lambda _self, msg: sim.logs.append(str(msg)))
    frame_cbs = []
    callbacks = lua.table(add=lambda _self, name, fn: frame_cbs.append(fn) if name == "frame" else None)
    g = lua.globals()
    g.emu = emu
    g.console = console
    g.callbacks = callbacks
    return frame_cbs

def run_case(party_pid, target_adv, max_frames):
    lua = lupa.LuaRuntime()
    sim = Sim(party_pid)
    frame_cbs = make_env(lua, sim)
    with open(SRC) as f:
        lua.execute(f.read())
    on_frame = frame_cbs[0]

    def frame():
        sim.step_rng()  # one RNG advance per frame
        on_frame(None)

    # establish anchor (S.last) before arming
    frame()
    frame()
    lua.globals().target(target_adv)
    print("arm log:", sim.logs[-1])

    errors = []
    press_frame = None
    for i in range(max_frames):
        try:
            frame()
        except lupa.LuaError as e:
            errors.append((i, str(e).splitlines()[0]))
        for msg in sim.logs:
            if "pressed A" in msg and press_frame is None:
                press_frame = i
        if len(errors) >= 5:
            break
    return sim, errors, press_frame

print("=== Case 1: party slot 1 occupied (pid nonzero), target(200) ===")
sim, errors, press_frame = run_case(party_pid=0xCAFEBABE, target_adv=200, max_frames=400)
for msg in sim.logs:
    print("  log:", msg)
print("  press seen at loop frame:", press_frame)
print("  errors raised:", len(errors))
for i, e in errors[:5]:
    print(f"  frame {i}: {e}")

print()
print("=== Case 2: party empty (pid 0), target(200), run past timeout ===")
sim2, errors2, _ = run_case(party_pid=0, target_adv=200, max_frames=7600)
print("  errors raised:", len(errors2))
print("  final logs:")
for msg in sim2.logs[-3:]:
    print("   ", msg)
