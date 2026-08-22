local config = {
  autorun = "",
  target_tid = nil,
  nature = "",
  gender = "",
  gender_threshold = 31,
  min_iv = 0,
  lead_frames = 90,
  hold_frames = 4,
  state_slot = 9,
  max_wait_hours = 5.0,
  dummy_timeout_frames = 7200,
  desync_step_cap = 5000,
  hunt_trigger = "A",
  hunt_wait_step = 1,
  hunt_settle_frames = 60,
  hunt_timeout_frames = 900,
  net_port = 8356,
  log_prefix = "[Shiny-Solution] "
}

local MULT = 1103515245
local ADD = 24691
local MASK = 0xFFFFFFFF
local GBA_FPS = 16777216 / 280896

local NATURES = {
  "Hardy", "Lonely", "Brave", "Adamant", "Naughty",
  "Bold", "Docile", "Relaxed", "Impish", "Lax",
  "Timid", "Hasty", "Serious", "Jolly", "Naive",
  "Modest", "Mild", "Quiet", "Bashful", "Rash",
  "Calm", "Gentle", "Sassy", "Careful", "Quirky"
}

-- tidModel: "rs" = TID/SID are two consecutive Random() outputs at InitPlayerTrainerId
-- (first=SID, second=TID), which the tid() pair search targets. Emerald/FRLG seed the RNG
-- from Timer1 at the naming-screen exit and derive the ID differently, so the pair model does
-- NOT hold there -- tid() refuses on those games. supported=false also means the IWRAM/EWRAM
-- addresses are derived, not decomp-proven, so shiny()/hunt() warn before running.
local GAMES = {
  AXVE = { name = "Ruby", rng = 0x03004818, save2 = 0x02024EA4, party = 0x03004360, eparty = 0x030045C0, supported = true, tidModel = "rs" },
  AXPE = { name = "Sapphire", rng = 0x03004818, save2 = 0x02024EA4, party = 0x03004360, eparty = 0x030045C0, supported = true, tidModel = "rs" },
  BPEE = { name = "Emerald", rng = 0x03005D80, save2ptr = 0x03005D90, party = 0x020244EC, eparty = 0x02024744, supported = false, tidModel = "efrlg" },
  BPRE = { name = "FireRed", rng = 0x03005000, save2ptr = 0x0300500C, party = 0x02024284, eparty = 0x0202402C, supported = false, tidModel = "efrlg" },
  BPGE = { name = "LeafGreen", rng = 0x03005000, save2ptr = 0x0300500C, party = 0x02024284, eparty = 0x0202402C, supported = false, tidModel = "efrlg" }
}
local MON_SIZE = 100 -- sizeof(struct Pokemon) in Gen 3

local KEY_A = 0
pcall(function() KEY_A = C.GBA_KEY.A end)

local S = {
  game = nil,
  code = nil,
  last = nil,
  adv = 0,
  frame = 0,
  holding = 0,
  mode = "idle",
  plan = nil,
  pressAdv = nil,
  pressVal = nil,
  pressAt = nil,
  goal = nil,
  delta = nil,
  saved = nil,
  watchBase = nil,
  watchVal = nil,
  watchStable = 0,
  watchFrames = 0,
  watchSlot = nil,
  retries = 0,
  scan = nil,
  framesOne = 0,
  framesBurst = 0,
  framesStill = 0
}

local net = { server = nil, clients = {}, bufs = {}, nextId = 1 }

local function sockBroadcast(line)
  for id, c in pairs(net.clients) do
    local ok = pcall(function() c:send(line .. "\n") end)
    if not ok then
      net.clients[id] = nil
      net.bufs[id] = nil
    end
  end
end

local function say(msg)
  console:log(config.log_prefix .. msg)
  sockBroadcast("LOG " .. msg)
end

local function step(s)
  return (s * MULT + ADD) & MASK
end

local function hi16(s)
  return (s >> 16) & 0xFFFF
end

local function stepN(s, n)
  for _ = 1, n do
    s = step(s)
  end
  return s
end

local function fmtEta(frames)
  local secs = frames / GBA_FPS
  local m = math.floor(secs / 60)
  local sec = secs - m * 60
  return string.format("%dm %04.1fs", m, sec)
end

local function natureIndex(name)
  if name == nil or name == "" then return nil end
  local lower = string.lower(name)
  for i, n in ipairs(NATURES) do
    if string.lower(n) == lower then return i - 1 end
  end
  return nil
end

local function method1(state)
  local s1 = step(state)
  local s2 = step(s1)
  local s3 = step(s2)
  local s4 = step(s3)
  local pid = (hi16(s2) << 16) | hi16(s1)
  local w1 = hi16(s3)
  local w2 = hi16(s4)
  return {
    pid = pid,
    nature = pid % 25,
    genderValue = pid & 255,
    hp = w1 & 31, atk = (w1 >> 5) & 31, def = (w1 >> 10) & 31,
    spe = w2 & 31, spa = (w2 >> 5) & 31, spd = (w2 >> 10) & 31
  }
end

local function isShiny(pid, tid, sid)
  return (tid ~ sid ~ hi16(pid) ~ (pid & 0xFFFF)) < 8
end

local function genderThreshold()
  return config.gender_threshold or 31
end

local function monText(mon, tid, sid)
  local gender = mon.genderValue < genderThreshold() and "F" or "M"
  return string.format("PID %08X  %s (%s)  IVs %d/%d/%d/%d/%d/%d%s",
    mon.pid, NATURES[mon.nature + 1], gender,
    mon.hp, mon.atk, mon.def, mon.spa, mon.spd, mon.spe,
    isShiny(mon.pid, tid, sid) and "  SHINY" or "")
end

local function save2Addr()
  local g = S.game
  if g.save2 then return g.save2 end
  local ok, p = pcall(function() return emu:read32(g.save2ptr) end)
  if not ok or p < 0x02000000 or p >= 0x02040000 then return nil end
  return p
end

-- playerTrainerId lives at SaveBlock2+0x0A, which is 2-byte aligned but NOT 4-byte
-- aligned. mGBA's emu:read32 goes through the CPU bus (GBALoad32): it masks the address
-- down to a 4-byte boundary and rotates the word, so a read32 at +0x0A returns the TID in
-- the low half and playerGender|specialSaveWarp<<8 (0 for a boy) in the high half instead
-- of the SID. That silently produced non-shiny "shinies". Always read the two halves with
-- aligned 16-bit reads and assemble the word ourselves: low 16 = TID, high 16 = SID.
local function readTrainerWord()
  local base = save2Addr()
  if not base then return nil end
  local ok, tid, sid = pcall(function() return emu:read16(base + 0x0A), emu:read16(base + 0x0C) end)
  if not ok or tid == nil or sid == nil then return nil end
  return ((sid & 0xFFFF) << 16) | (tid & 0xFFFF)
end

local function readPartyPid()
  local ok, v = pcall(function() return emu:read32(S.game.party) end)
  if ok then return v end
  return nil
end

local function readEnemyPid()
  local ok, v = pcall(function() return emu:read32(S.game.eparty) end)
  if ok then return v end
  return nil
end

-- struct BoxPokemon: personality @0, otId @4 (u32: TID low 16, SID high 16). The game's own
-- shiny test uses the OT ID stored IN the mon, so that word is the ground truth for the
-- TID/SID the shiny search must target. Both slots are 4-byte aligned.
local function readMonOtId(slotAddr)
  local ok, v = pcall(function() return emu:read32(slotAddr + 4) end)
  if ok then return v end
  return nil
end

local function readBytes(addr, n)
  local out = {}
  for i = 0, n - 1 do
    local ok, b = pcall(function() return emu:read8(addr + i) end)
    if not ok then return nil end
    out[#out + 1] = string.format("%02X", b)
  end
  return table.concat(out, " ")
end

local function readSlotPid(addr)
  local ok, v = pcall(function() return emu:read32(addr) end)
  if ok then return v end
  return nil
end

-- A new party member (starter or gift) lands in the first empty slot: CreateMon fills
-- gPlayerParty[n] where n is the current count. An empty slot has personality == 0. We watch
-- that slot's PID go non-zero rather than trusting a party-count address (the count byte is
-- not reliably updated on the frame the PID appears, and its address moves between ROMs).
-- Returns slotAddr, slotIndex  -- or nil, errorMessage.
local function partyWatchSlot()
  for i = 0, 5 do
    local addr = S.game.party + MON_SIZE * i
    local pid = readSlotPid(addr)
    if pid == nil then
      if i == 0 then return nil, "could not read party memory" end
      return addr, i
    end
    if pid == 0 then return addr, i end
  end
  return nil, "every party slot is occupied; a gift would go to the PC box where the script cannot watch it -- make room in your party first"
end

local function monSlotAddr()
  if S.plan and S.plan.watch == "enemy" then return S.game.eparty end
  return S.watchSlot or S.game.party
end

-- The game's shiny test (IsShinyOtIdPersonality) uses the OT ID stored in the mon, so that
-- is the ground truth for the TID/SID the search must target. Adopt it if it disagrees with
-- what we read from the save block, and say so loudly.
local function verifyOtId(plan, stage)
  local ot = readMonOtId(monSlotAddr())
  if ot == nil or ot == 0 then
    say(string.format("%s: could not read the generated mon's OT ID; relying on the save block's TID/SID", stage))
    return true
  end
  local tid, sid = ot & 0xFFFF, hi16(ot)
  if tid == plan.tid and sid == plan.sid then
    say(string.format("%s: the mon's OT ID (TID %d / SID %d) matches the save block", stage, tid, sid))
    return true
  end
  say(string.format("WARNING (%s): the mon's OT ID is TID %d / SID %d but the save block read TID %d / SID %d; using the mon's, which is what the game's shiny test uses",
    stage, tid, sid, plan.tid, plan.sid))
  plan.tid = tid
  plan.sid = sid
  return false
end

local function hasSavestates()
  local ok, t = pcall(function() return type(emu.saveStateSlot) end)
  return ok and t == "function"
end

local function findTidPair(fromVal, fromAdv, tid, sid, span)
  local s = fromVal
  for i = fromAdv, fromAdv + span do
    local s1 = step(s)
    local s2 = step(s1)
    if hi16(s1) == sid and hi16(s2) == tid then
      return i
    end
    s = s1
  end
  return nil
end

local function findPidPair(fromVal, fromAdv, pid, span)
  local lo = pid & 0xFFFF
  local hip = hi16(pid)
  local s = fromVal
  for i = fromAdv, fromAdv + span do
    local s1 = step(s)
    local s2 = step(s1)
    if hi16(s1) == lo and hi16(s2) == hip then
      return i
    end
    s = s1
  end
  return nil
end

local function searchTidTarget(fromVal, fromAdv, target, maxAdv)
  local s = fromVal
  for i = fromAdv, maxAdv do
    local s1 = step(s)
    local s2 = step(s1)
    if hi16(s2) == target then
      return i, hi16(s1)
    end
    s = s1
  end
  return nil
end

local function searchShinyTarget(fromVal, fromAdv, tid, sid, maxAdv)
  local wantNature = natureIndex(config.nature)
  local wantGender = config.gender ~= "" and string.upper(config.gender) or nil
  local minIv = config.min_iv or 0
  local s = fromVal
  for i = fromAdv, maxAdv do
    local s1 = step(s)
    local s2 = step(s1)
    local pid = (hi16(s2) << 16) | hi16(s1)
    if isShiny(pid, tid, sid) then
      local mon = method1(s)
      local ok = true
      if wantNature and mon.nature ~= wantNature then ok = false end
      if ok and wantGender then
        local g = mon.genderValue < genderThreshold() and "F" or "M"
        if g ~= wantGender then ok = false end
      end
      if ok and minIv > 0 then
        if mon.hp < minIv or mon.atk < minIv or mon.def < minIv or
           mon.spe < minIv or mon.spa < minIv or mon.spd < minIv then ok = false end
      end
      if ok then return i, mon end
    end
    s = s1
  end
  return nil
end

local function pressA()
  S.pressAdv = S.adv
  S.pressVal = S.last
  emu:addKey(KEY_A)
  S.holding = config.hold_frames
end

local function disarm(msg)
  S.mode = "idle"
  S.pressAt = nil
  S.goal = nil
  S.watchBase = nil
  S.watchVal = nil
  S.watchStable = 0
  S.watchFrames = 0
  if msg then say(msg) end
end

local function saveCheckpoint()
  if not hasSavestates() then return false end
  local ok, ret = pcall(function() return emu:saveStateSlot(config.state_slot) end)
  if ok and ret ~= false then
    S.saved = { adv = S.adv, val = S.last }
    return true
  end
  return false
end

local function loadCheckpoint()
  if not S.saved then return false end
  pcall(function() emu:clearKey(KEY_A) end)
  S.holding = 0
  local ok, ret = pcall(function() return emu:loadStateSlot(config.state_slot) end)
  if ok and ret ~= false then
    S.mode = "reanchor"
    return true
  end
  return false
end

local function maxSearchAdv()
  return S.adv + math.floor(config.max_wait_hours * 3600 * GBA_FPS)
end

local HKEYS = { A = 0, B = 1, SELECT = 2, START = 3, RIGHT = 4, LEFT = 5, UP = 6, DOWN = 7, R = 8, L = 9 }
pcall(function()
  for name, value in pairs(C.GBA_KEY) do
    HKEYS[name] = value
  end
end)

local H = {
  active = false,
  phase = "idle",
  attempt = 0,
  wait = 0,
  counter = 0,
  base = 0,
  tid = 0,
  sid = 0,
  lastVal = nil,
  stable = 0,
  holdLeft = 0,
  holdThrough = false,
  lastRead = nil
}

local function huntKey()
  return HKEYS[string.upper(config.hunt_trigger)] or HKEYS.A
end

local function huntKeyIsDirection()
  local t = string.upper(config.hunt_trigger)
  return t == "UP" or t == "DOWN" or t == "LEFT" or t == "RIGHT"
end

local function clearHuntKeys()
  local ok = pcall(function() emu:clearKeys(0x3FF) end)
  if not ok then
    pcall(function() emu:clearKey(huntKey()) end)
    pcall(function() emu:clearKey(KEY_A) end)
  end
end

local function stopHunt(msg)
  clearHuntKeys()
  H.active = false
  H.phase = "idle"
  if msg then say(msg) end
end

local function huntNext()
  clearHuntKeys()
  H.attempt = H.attempt + 1
  -- Each attempt shifts the timing by exactly one frame, but rather than waiting an
  -- ever-growing number of frames before pressing (which makes total hunt time quadratic and
  -- can add minutes to each late attempt), we advance the *checkpoint* itself by one frame
  -- and re-save it, then press at a fixed small offset. Attempts are then constant-time.
  H.wait = H.wait + config.hunt_wait_step
  if H.attempt % 25 == 0 then
    say(string.format("hunt attempt %d (shift %d): last PID %s", H.attempt, H.wait,
      H.lastRead and string.format("%08X", H.lastRead) or "none"))
  end
  H.phase = "load"
end

local function huntTick()
  if not H.holdThrough and H.holdLeft > 0 then
    H.holdLeft = H.holdLeft - 1
    if H.holdLeft == 0 then
      pcall(function() emu:clearKey(huntKey()) end)
    end
  end
  if H.phase == "load" then
    clearHuntKeys()
    H.holdLeft = 0
    local ok, ret = pcall(function() return emu:loadStateSlot(config.state_slot) end)
    if not ok or ret == false then
      stopHunt("savestate reload failed; hunt stopped")
      return
    end
    -- let one frame elapse, then re-save so the checkpoint marches forward 1 frame/attempt
    H.counter = config.hunt_wait_step
    H.phase = "resave"
  elseif H.phase == "resave" then
    H.counter = H.counter - 1
    if H.counter <= 0 then
      pcall(function() return emu:saveStateSlot(config.state_slot) end)
      H.counter = config.hunt_settle_frames
      H.phase = "settle"
    end
  elseif H.phase == "settle" then
    H.counter = H.counter - 1
    if H.counter <= 0 then
      H.base = readEnemyPid() or 0
      H.lastVal = nil
      H.stable = 0
      H.counter = 1
      H.phase = "waitk"
    end
  elseif H.phase == "waitk" then
    H.counter = H.counter - 1
    if H.counter <= 0 then
      emu:addKey(huntKey())
      H.holdLeft = config.hold_frames
      H.holdThrough = huntKeyIsDirection()
      H.counter = config.hunt_timeout_frames
      H.phase = "watch"
    end
  elseif H.phase == "watch" then
    H.counter = H.counter - 1
    if H.counter <= 0 then
      huntNext()
      return
    end
    local v = readEnemyPid()
    if v == nil then
      stopHunt("enemy memory read failed; hunt stopped")
      return
    end
    if v ~= 0 and v ~= H.base then
      if v == H.lastVal then
        H.stable = H.stable + 1
      else
        H.lastVal = v
        H.stable = 0
      end
      if H.stable >= 2 then
        H.lastRead = v
        clearHuntKeys()
        local ot = readMonOtId(S.game.eparty)
        if ot and ot ~= 0 and ((ot & 0xFFFF) ~= H.tid or hi16(ot) ~= H.sid) then
          say(string.format("note: the encounter's OT ID is TID %d / SID %d, not the save block's %d / %d; hunting against the mon's", ot & 0xFFFF, hi16(ot), H.tid, H.sid))
          H.tid = ot & 0xFFFF
          H.sid = hi16(ot)
        end
        if isShiny(v, H.tid, H.sid) then
          stopHunt(string.format("FOUND on attempt %d (wait %d): PID %08X is SHINY -- take over, catch it, save!", H.attempt, H.wait, v))
        else
          huntNext()
        end
      end
    end
  end
end

local function armPlan()
  local plan = S.plan
  if not plan or plan.kind == "raw" or not S.delta then
    disarm("nothing to arm")
    return
  end
  local fromAdv = S.adv + config.lead_frames + S.delta
  local fromVal = stepN(S.last, fromAdv - S.adv)
  if plan.kind == "tid" then
    local i, sid = searchTidTarget(fromVal, fromAdv, plan.target, maxSearchAdv())
    if not i then
      disarm(string.format("no advance yields TID %d within %.1f hours; raise max_wait_hours", plan.target, config.max_wait_hours))
      return
    end
    S.goal = i
    S.pressAt = i - S.delta
    say(string.format("armed: TID %d (SID will be %d) at advance %d, pressing in %s", plan.target, sid, i, fmtEta(S.pressAt - S.adv)))
  else
    local i, mon = searchShinyTarget(fromVal, fromAdv, plan.tid, plan.sid, maxSearchAdv())
    if not i then
      disarm(string.format("no shiny matching filters within %.1f hours; relax nature/gender/min_iv or raise max_wait_hours", config.max_wait_hours))
      return
    end
    S.goal = i
    S.pressAt = i - S.delta
    say(string.format("armed: shiny at advance %d [%s], pressing in %s", i, monText(mon, plan.tid, plan.sid), fmtEta(S.pressAt - S.adv)))
  end
  S.mode = "armed"
end

local function beginConfirmWatch()
  if S.plan.kind == "tid" then
    S.watchBase = readTrainerWord()
  elseif S.plan.watch == "enemy" then
    S.watchBase = readEnemyPid() or 0
  else
    S.watchBase = readSlotPid(S.watchSlot or S.game.party) or 0
  end
  S.watchVal = nil
  S.watchStable = 0
  S.watchFrames = 0
  S.mode = "confirm_wait"
end

local function onDummyResult(v)
  local plan = S.plan
  local n
  if plan.kind == "tid" then
    local tid = v & 0xFFFF
    local sid = hi16(v)
    n = findTidPair(S.pressVal, S.pressAdv, tid, sid, 30000)
  else
    n = findPidPair(S.pressVal, S.pressAdv, v, 30000)
  end
  if not n then
    disarm("calibration failed: could not locate the dummy result in the RNG stream; make sure you were at the exact prompt described in the README")
    return
  end
  S.delta = n - S.pressAdv
  say(string.format("calibrated: press-to-generation delta is %d advances", S.delta))
  if plan.kind == "shiny" then
    verifyOtId(plan, "calibration")
  end
  if S.saved then
    if not loadCheckpoint() then
      disarm("savestate reload failed; load your own pre-prompt state, then run rearm() (the calibration is kept)")
    end
  else
    disarm("no savestate support detected: load your pre-prompt state manually, then run rearm() (the calibration is kept)")
  end
end

local function onConfirmResult(v)
  local plan = S.plan
  if plan.kind == "tid" then
    local tid = v & 0xFFFF
    local sid = hi16(v)
    if tid == plan.target then
      disarm(string.format("SUCCESS: TID %d  SID %d  (write the SID down)", tid, sid))
      return
    end
    local n = findTidPair(S.pressVal, S.pressAdv, tid, sid, 30000)
    handleMiss(n, string.format("got TID %d instead of %d", tid, plan.target))
  else
    -- Final verdict uses the OT ID the game wrote into the mon itself (adopting it into the
    -- plan if the save block disagreed), so a SUCCESS here means the game's own shiny check
    -- passes -- never just our bookkeeping.
    verifyOtId(plan, "result")
    local shiny = isShiny(v, plan.tid, plan.sid)
    local n = findPidPair(S.pressVal, S.pressAdv, v, 30000)
    local mon = nil
    if n then
      local s = S.pressVal
      for i = S.pressAdv, n - 1 do s = step(s) end
      mon = method1(s)
    end
    if shiny then
      local tag = string.format("  [verified against OT ID %d/%d]", plan.tid, plan.sid)
      if mon then
        disarm("SUCCESS: " .. monText(mon, plan.tid, plan.sid) .. tag .. "  -- save your game!")
      else
        disarm(string.format("SUCCESS: shiny PID %08X%s -- save your game!", v, tag))
      end
      return
    end
    handleMiss(n, mon and ("got " .. monText(mon, plan.tid, plan.sid)) or string.format("got PID %08X", v))
  end
end

function handleMiss(observedN, gotText)
  if S.plan and S.plan.kind == "raw" then
    disarm("raw press missed: " .. gotText)
    return
  end
  if observedN then
    local newDelta = observedN - S.pressAdv
    say(string.format("miss: %s (landed at advance %d, predicted %d, delta drift %d)", gotText, observedN, S.goal, newDelta - S.delta))
    S.delta = newDelta
  else
    say("miss: " .. gotText .. " (result not found near the press; unexpected)")
  end
  if S.saved and S.retries < 2 then
    S.retries = S.retries + 1
    say(string.format("retrying with corrected calibration (attempt %d)", S.retries + 1))
    if loadCheckpoint() then return end
  end
  disarm("stopped after miss; reload your pre-prompt state and run rearm()")
end

local function beginFlow(plan)
  if H.active then
    say("busy hunting; stop() first")
    return
  end
  if S.mode ~= "idle" then
    say("busy; call cancel() first")
    return
  end
  local watchBase
  if plan.kind == "tid" then
    watchBase = readTrainerWord()
    if watchBase == nil then
      say("could not read the trainer id block; is a game running?")
      return
    end
  elseif plan.watch == "enemy" then
    watchBase = readEnemyPid()
    if watchBase == nil then
      say("could not read the enemy battle slot")
      return
    end
  else
    local slot, idx = partyWatchSlot()
    if not slot then
      say(idx)
      return
    end
    S.watchSlot = slot
    watchBase = readSlotPid(slot) or 0
    say(string.format("watching party slot %d for the new Pokemon", idx + 1))
  end
  S.plan = plan
  S.retries = 0
  if S.delta ~= nil and plan.reuseDelta then
    armPlan()
    return
  end
  S.delta = nil
  local checkpointed = saveCheckpoint()
  S.watchBase = watchBase
  S.watchVal = nil
  S.watchStable = 0
  S.watchFrames = 0
  if checkpointed then
    say("checkpoint saved to slot " .. config.state_slot .. "; firing calibration press")
  else
    say("WARNING: no savestate support; the calibration attempt will consume this prompt")
  end
  pressA()
  S.mode = "dummy_wait"
end

local function watchTick(kind)
  S.watchFrames = S.watchFrames + 1
  if S.watchFrames > config.dummy_timeout_frames then
    disarm("timed out waiting for the game to generate the result; were you at the right prompt?")
    return
  end
  local v
  if S.plan.kind == "tid" then
    v = readTrainerWord()
    if v == nil or v == S.watchBase then return end
  elseif S.plan.watch == "enemy" then
    v = readEnemyPid()
    if v == nil or v == 0 or v == S.watchBase then return end
  else
    v = readSlotPid(S.watchSlot or S.game.party)
    if v == nil or v == 0 or v == S.watchBase then return end
  end
  if v == S.watchVal then
    S.watchStable = S.watchStable + 1
  else
    S.watchVal = v
    S.watchStable = 0
  end
  if S.watchStable >= 2 then
    if kind == "dummy" then
      onDummyResult(v)
    else
      onConfirmResult(v)
    end
  end
end

local function scanTick()
  local sc = S.scan
  if sc.phase == 1 then
    sc.vals = {}
    for a = 0x03000000, 0x03007FFC, 4 do
      sc.vals[a] = emu:read32(a)
    end
    sc.phase = 2
    return
  end
  local nextVals = {}
  local count = 0
  for a, v in pairs(sc.vals) do
    local cur = emu:read32(a)
    if cur == step(v) then
      nextVals[a] = cur
      count = count + 1
    end
  end
  sc.vals = nextVals
  sc.phase = sc.phase + 1
  if sc.phase >= 5 then
    S.scan = nil
    if count == 0 then
      say("scan: no LCRNG-stepping address found in IWRAM")
    else
      local found = 0
      local only = nil
      for a in pairs(nextVals) do
        found = found + 1
        only = a
        say(string.format("scan: RNG state candidate at 0x%08X", a))
      end
      if found == 1 and not S.game then
        S.game = { name = "unknown (" .. tostring(S.code) .. ")", rng = only, supported = false }
        S.last = nil
        S.adv = 0
        say("adopted the found address: status() and target() now work; tid()/shiny() need a supported game")
      end
    end
  end
end

local function onFrame()
  S.frame = S.frame + 1
  if S.holding > 0 then
    S.holding = S.holding - 1
    if S.holding == 0 then
      pcall(function() emu:clearKey(KEY_A) end)
    end
  end
  if S.scan then
    scanTick()
    return
  end
  if not S.game then return end
  if H.active then
    huntTick()
    if next(net.clients) ~= nil and S.frame % 30 == 0 then
      sockBroadcast(string.format("STATE game=%s mode=hunt adv=- state=- tid=%d sid=%d delta=- attempt=%d wait=%d last=%s",
        S.game.name:gsub(" ", "_"), H.tid, H.sid, H.attempt, H.wait,
        H.lastRead and string.format("%08X", H.lastRead) or "-"))
    end
    return
  end
  if S.mode == "reanchor" then
    local v = emu:read32(S.game.rng)
    local s = S.saved.val
    for k = 0, 600 do
      if s == v then
        S.adv = S.saved.adv + k
        S.last = v
        say(string.format("checkpoint restored at advance %d", S.adv))
        armPlan()
        return
      end
      s = step(s)
    end
    S.last = v
    S.adv = 0
    disarm("could not re-anchor after state load; advance counter reset to 0")
    return
  end
  local v = emu:read32(S.game.rng)
  if S.last == nil then
    S.last = v
    S.adv = 0
    return
  end
  if v ~= S.last then
    local s = S.last
    local steps = 0
    while s ~= v and steps < config.desync_step_cap do
      s = step(s)
      steps = steps + 1
    end
    if s ~= v then
      S.last = v
      S.adv = 0
      if S.mode ~= "idle" then
        disarm("RNG desync (reset or state load?); advance counter reset, flow cancelled")
      end
      return
    end
    S.adv = S.adv + steps
    S.last = v
    if steps == 1 then S.framesOne = S.framesOne + 1 else S.framesBurst = S.framesBurst + 1 end
  else
    S.framesStill = S.framesStill + 1
  end
  if S.mode == "armed" then
    if S.adv == S.pressAt then
      pressA()
      say(string.format("pressed A at advance %d (goal %d)", S.adv, S.goal))
      if S.plan and S.plan.kind == "raw" then
        disarm(string.format("raw press fired at advance %d", S.adv))
      else
        beginConfirmWatch()
      end
    elseif S.adv > S.pressAt then
      handleMiss(nil, string.format("overshot the press frame (advance %d > %d); an advance burst happened while waiting", S.adv, S.pressAt))
    end
  elseif S.mode == "dummy_wait" then
    watchTick("dummy")
  elseif S.mode == "confirm_wait" then
    watchTick("confirm")
  end
  if next(net.clients) ~= nil and S.frame % 30 == 0 then
    local w = readTrainerWord()
    sockBroadcast(string.format("STATE game=%s mode=%s adv=%d state=%08X tid=%s sid=%s delta=%s",
      S.game.name:gsub(" ", "_"), S.mode, S.adv, S.last or 0,
      w and tostring(w & 0xFFFF) or "-", w and tostring(hi16(w)) or "-",
      S.delta and tostring(S.delta) or "-"))
  end
  if config.autorun ~= "" and S.frame == 60 then
    local mode = config.autorun
    config.autorun = ""
    if mode == "tid" and config.target_tid then
      tid(config.target_tid)
    elseif mode == "shiny" then
      shiny()
    end
  end
end

function status()
  if not S.game then
    say("no supported game detected; use scan() to hunt for the RNG address")
    return
  end
  local w = readTrainerWord()
  local tidStr = w and string.format("TID %d SID %d", w & 0xFFFF, hi16(w)) or "trainer id unreadable"
  say(string.format("%s | advance %d | state %08X | %s | delta %s | mode %s",
    S.game.name, S.adv, S.last or 0, tidStr, S.delta and tostring(S.delta) or "uncalibrated", S.mode))
end

-- Diagnostic: everything the flows depend on, read the safe way, so a wrong ROM/hack or a
-- bad address shows up BEFORE anyone trusts a SUCCESS line.
function selfcheck()
  if not S.game then
    say("no supported game detected; scan() can locate the RNG address")
    return
  end
  say(string.format("game %s (%s)%s | RNG @%08X = %08X | frames stepping exactly 1: %d, bursts: %d, no-step: %d",
    S.game.name, tostring(S.code), S.game.supported and "" or " [EXPERIMENTAL]", S.game.rng, S.last or 0,
    S.framesOne, S.framesBurst, S.framesStill))
  local base = save2Addr()
  if base then
    local w = readTrainerWord()
    say(string.format("save block @%08X: bytes +08..+0F = [%s] | TID %s / SID %s via aligned 16-bit reads",
      base, readBytes(base + 8, 8) or "?", w and tostring(w & 0xFFFF) or "?", w and tostring(hi16(w)) or "?"))
    if w == 0 then say("  TID/SID are zero: no save is loaded (new game not started yet?)") end
  else
    say("save block: unreadable (pointer out of range?)")
  end
  local slot, idx = partyWatchSlot()
  local pid = readPartyPid()
  local ot = readMonOtId(S.game.party)
  say(string.format("party: slot 1 PID %s, OT ID %s | first empty slot: %s",
    pid and string.format("%08X", pid) or "?", (ot and ot ~= 0) and string.format("%d/%d", ot & 0xFFFF, hi16(ot)) or "-",
    slot and tostring(idx + 1) or "none (party full)"))
  if S.game.eparty then
    local e = readEnemyPid()
    local eot = readMonOtId(S.game.eparty)
    say(string.format("enemy: slot 1 PID %s, OT ID %s", e and string.format("%08X", e) or "?",
      (eot and eot ~= 0) and string.format("%d/%d", eot & 0xFFFF, hi16(eot)) or "-"))
  end
  if S.framesStill > S.framesOne then
    say("WARNING: the RNG word is not advancing once per frame; this ROM may not use the expected memory layout (try scan())")
  end
  if ot and ot ~= 0 and base then
    local w = readTrainerWord()
    if w and w ~= ot then
      say(string.format("WARNING: party slot 1's OT ID (%d/%d) differs from the save block's TID/SID (%d/%d): traded mon, or the save-block address is wrong for this ROM",
        ot & 0xFFFF, hi16(ot), w & 0xFFFF, hi16(w)))
    end
  end
end

function tid(target)
  if not S.game then say("no game detected") return end
  if S.game.tidModel ~= "rs" then
    say(string.format("TID manip is not supported on %s: its trainer ID is seeded from Timer1 at the naming screen, not from the two consecutive Random() calls this flow targets (that model is Ruby/Sapphire only). See docs/FACTS.md.", S.game.name))
    return
  end
  target = math.floor(target or -1)
  if target < 0 or target > 65535 then
    say("usage: tid(n) with n in 0..65535; stand at Birch's final text box (Come see me in my POKeMON LAB.) first")
    return
  end
  beginFlow({ kind = "tid", target = target, reuseDelta = false })
end

function shiny(mode)
  if not S.game then say("no game detected") return end
  local watch = mode == "enemy" and "enemy" or "party"
  if watch == "enemy" and not S.game.eparty then
    say("no enemy-party address is known for this game")
    return
  end
  if not S.game.supported then
    say(string.format("EXPERIMENTAL: %s memory addresses are derived, not decomp-verified. The Method-1 model is correct for starters/gifts/statics, but if the addresses are wrong the result is garbage. Run selfcheck() first and confirm the TID/SID and the party's OT ID look right before trusting a SUCCESS.", S.game.name))
  end
  local w = readTrainerWord()
  if not w or w == 0 then
    say("could not read TID/SID from the save block; load your save first")
    return
  end
  beginFlow({ kind = "shiny", watch = watch, tid = w & 0xFFFF, sid = hi16(w), reuseDelta = false })
end

function rearm()
  if not S.plan or S.plan.kind == "raw" or not S.delta then
    say("nothing to re-arm; run tid(n) or shiny() first")
    return
  end
  S.plan.reuseDelta = true
  S.retries = 0
  beginFlow(S.plan)
end

function target(n)
  if not S.game then say("no game detected") return end
  if H.active then
    say("busy hunting; stop() first")
    return
  end
  if S.mode ~= "idle" then
    say("busy; call cancel() first")
    return
  end
  n = math.floor(n or -1)
  if n <= S.adv then
    say("usage: target(n) with n greater than the current advance shown by status()")
    return
  end
  S.plan = { kind = "raw" }
  S.goal = n
  S.pressAt = n
  S.mode = "armed"
  say(string.format("armed: raw press at advance %d in %s", n, fmtEta(n - S.adv)))
end

function hunt()
  if not S.game then say("no game detected") return end
  if not S.game.eparty then say("no enemy-party address is known for this game") return end
  if H.active then say("already hunting; stop() first") return end
  if S.mode ~= "idle" then say("a flow is armed; cancel() first") return end
  if not HKEYS[string.upper(config.hunt_trigger)] then
    say(string.format("unknown hunt_trigger %q; use A, Start, Up, Down, Left or Right", config.hunt_trigger))
    return
  end
  if not hasSavestates() then say("this mGBA build exposes no savestate API; hunt cannot run") return end
  local w = readTrainerWord()
  if not w or w == 0 then
    say("could not read TID/SID from the save block; load your save first")
    return
  end
  clearHuntKeys()
  S.holding = 0
  local ok, ret = pcall(function() return emu:saveStateSlot(config.state_slot) end)
  if not ok or ret == false then
    say("could not save the checkpoint to slot " .. config.state_slot)
    return
  end
  S.saved = nil
  H.active = true
  H.attempt = 1
  H.wait = 0
  H.tid = w & 0xFFFF
  H.sid = hi16(w)
  H.lastRead = nil
  H.base = readEnemyPid() or 0
  H.lastVal = nil
  H.stable = 0
  H.counter = config.hunt_settle_frames
  H.phase = "settle"
  say(string.format("hunting with trigger %s for TID %d / SID %d (checkpoint slot %d; hold fast-forward!)",
    config.hunt_trigger, H.tid, H.sid, config.state_slot))
end

function stop()
  if H.active then
    stopHunt("hunt stopped at attempt " .. H.attempt)
  else
    say("no hunt running")
  end
end

function cancel()
  if H.active then
    stopHunt("hunt cancelled")
  end
  pcall(function() emu:clearKey(KEY_A) end)
  S.holding = 0
  disarm("cancelled")
end

function scan()
  if H.active or S.mode ~= "idle" then
    say("busy; call cancel() first")
    return
  end
  S.scan = { phase = 1, vals = nil }
  say("scanning IWRAM for an LCRNG-stepping value over 4 frames...")
end

function help()
  say("commands: status() | selfcheck() | tid(n) | shiny() starter/gift | shiny(\"enemy\") static | hunt() brute-force | stop() | rearm() | target(n) | scan() | cancel() | help()")
  say("config (edit at top of script): nature, gender, gender_threshold, min_iv, target_tid, autorun, max_wait_hours, hunt_trigger")
end

local function detect()
  local ok, raw = pcall(function() return emu:readRange(0x080000AC, 4) end)
  local code = nil
  if ok and type(raw) == "string" and #raw == 4 then
    code = raw
  else
    local chars = {}
    for i = 0, 3 do
      local okb, b = pcall(function() return emu:read8(0x080000AC + i) end)
      if not okb then return end
      chars[#chars + 1] = string.char(b)
    end
    code = table.concat(chars)
  end
  S.code = code
  S.game = GAMES[code]
  if S.game then
    say(string.format("detected %s (%s)%s", S.game.name, code, S.game.supported and "" or " -- EXPERIMENTAL, addresses unverified"))
    say(string.format("RNG at 0x%08X | savestate support: %s", S.game.rng, hasSavestates() and "yes" or "NO (manual reloads needed)"))
    say("type help() for commands")
  else
    say(string.format("unrecognized game code %q; only Gen 3 GBA games are supported. scan() can locate the RNG address for monitoring", code))
  end
end

local function handleNetCommand(line)
  line = line:gsub("%s+$", "")
  local cmd, rest = line:match("^(%S+)%s*(.*)$")
  if not cmd then return end
  if cmd == "ping" then
    sockBroadcast("PONG")
  elseif cmd == "status" then
    status()
  elseif cmd == "selfcheck" then
    selfcheck()
  elseif cmd == "peek" then
    local a, n = rest:match("^(%S+)%s*(%S*)$")
    local addr = a and (tonumber(a) or tonumber(a, 16)) or nil
    n = tonumber(n) or 16
    if addr then
      say(string.format("peek %08X: %s", addr, readBytes(addr, math.max(1, math.min(n, 64))) or "unreadable"))
    else
      say("net: peek needs an address (hex)")
    end
  elseif cmd == "shiny" then
    if rest == "enemy" then shiny("enemy") else shiny() end
  elseif cmd == "hunt" then
    hunt()
  elseif cmd == "stop" then
    stop()
  elseif cmd == "tid" then
    local n = tonumber(rest)
    if n then tid(n) else say("net: tid needs a number") end
  elseif cmd == "target" then
    local n = tonumber(rest)
    if n then target(n) else say("net: target needs a number") end
  elseif cmd == "rearm" then
    rearm()
  elseif cmd == "cancel" then
    cancel()
  elseif cmd == "scan" then
    scan()
  elseif cmd == "set" then
    local key, value = rest:match("^(%S+)%s+(%S+)$")
    if key == "nature" then
      config.nature = value ~= "-" and value or ""
    elseif key == "gender" then
      config.gender = value ~= "-" and value or ""
    elseif key == "min_iv" then
      config.min_iv = tonumber(value) or 0
    elseif key == "gender_threshold" then
      config.gender_threshold = tonumber(value) or 31
    elseif key == "max_wait_hours" then
      config.max_wait_hours = tonumber(value) or config.max_wait_hours
    elseif key == "hunt_trigger" then
      if HKEYS[string.upper(value)] then
        config.hunt_trigger = value
      else
        say(string.format("unknown hunt_trigger %q", value))
        return
      end
    elseif key == "hunt_wait_step" then
      config.hunt_wait_step = math.max(1, tonumber(value) or config.hunt_wait_step)
    elseif key == "hunt_timeout_frames" then
      config.hunt_timeout_frames = tonumber(value) or config.hunt_timeout_frames
    else
      say("net: unknown setting " .. tostring(key))
      return
    end
    say(string.format("net: %s = %s", key, value))
  else
    say("net: unknown command " .. cmd)
  end
end

local function onNetReceived(id)
  local c = net.clients[id]
  if not c then return end
  local again = (socket and socket.ERRORS and socket.ERRORS.AGAIN) or "again"
  local dead = false
  while true do
    local data, err = c:receive(1024)
    if data then
      net.bufs[id] = (net.bufs[id] or "") .. data
    else
      if err ~= again then dead = true end
      break
    end
  end
  local buf = net.bufs[id] or ""
  while true do
    local line, restBuf = buf:match("^([^\n]*)\n(.*)$")
    if not line then break end
    buf = restBuf
    handleNetCommand(line)
  end
  if dead then
    net.clients[id] = nil
    net.bufs[id] = nil
  else
    net.bufs[id] = buf
  end
end

local function onNetAccept()
  local c = net.server:accept()
  if not c then return end
  local id = net.nextId
  net.nextId = id + 1
  net.clients[id] = c
  net.bufs[id] = ""
  pcall(function() c:add("received", function() onNetReceived(id) end) end)
  pcall(function()
    c:add("error", function()
      net.clients[id] = nil
      net.bufs[id] = nil
    end)
  end)
  pcall(function() c:send("HELLO shiny-solution gen3 1\n") end)
  say("net: app connected")
end

local function startServer()
  if not socket then return end
  for port = config.net_port, config.net_port + 4 do
    local s, err = socket.bind(nil, port)
    if s and not err then
      local _, lerr = s:listen()
      if not lerr then
        net.server = s
        config.net_port = port
        pcall(function() s:add("received", onNetAccept) end)
        say("net: listening on port " .. port)
        return
      end
      pcall(function() s:close() end)
    end
  end
  say("net: could not bind a port; app link disabled (console commands still work)")
end

if emu then
  detect()
else
  say("waiting for a ROM to load")
end

callbacks:add("frame", onFrame)
pcall(function() callbacks:add("start", detect) end)
startServer()

