local config = {
  trigger = "A",
  watch = "enemy",
  target = "shiny",
  custom_dvs = "",
  wait_start = 0,
  wait_step = 1,
  settle_frames = 60,
  timeout_frames = 900,
  hold_frames = 2,
  state_slot = 9,
  net_port = 8357,
  report_every = 25,
  log_prefix = "[Shiny-Solution GB] "
}

-- codes = the accepted 4-char game IDs at ROM 0x013F (rgbfix -i), used to reject Japanese and
-- other localized carts whose WRAM layouts differ from these verified English/Australian
-- addresses. Gen 1 predates the game-ID field, so those games are gated on the destination
-- byte 0x014A instead (0x00 = Japan).
local GAMES = {
  { match = "POKEMON RED", name = "Red", gen = 1, enemyDvs = 0xCFF1, party1Dvs = 0xD186, partyCount = 0xD163, stride = 0x2C, battleFlag = 0xD057, playerId = 0xD359 },
  { match = "POKEMON BLUE", name = "Blue", gen = 1, enemyDvs = 0xCFF1, party1Dvs = 0xD186, partyCount = 0xD163, stride = 0x2C, battleFlag = 0xD057, playerId = 0xD359 },
  { match = "POKEMON YEL", name = "Yellow", gen = 1, enemyDvs = 0xCFF0, party1Dvs = 0xD185, partyCount = 0xD162, stride = 0x2C, battleFlag = 0xD056, playerId = 0xD358 },
  { match = "POKEMON_GLD", name = "Gold", gen = 2, codes = { AAUE = true }, enemyDvs = 0xD0F5, party1Dvs = 0xDA3F, partyCount = 0xDA22, stride = 0x30, battleFlag = 0xD116, playerId = 0xD1A1 },
  { match = "POKEMON_SLV", name = "Silver", gen = 2, codes = { AAXE = true }, enemyDvs = 0xD0F5, party1Dvs = 0xDA3F, partyCount = 0xDA22, stride = 0x30, battleFlag = 0xD116, playerId = 0xD1A1 },
  { match = "PM_CRYSTAL", name = "Crystal", gen = 2, codes = { BYTE = true, BYTU = true }, enemyDvs = 0xD20C, party1Dvs = 0xDCF4, partyCount = 0xDCD7, stride = 0x30, battleFlag = 0xD22D, playerId = 0xD47B }
}
local SVBK = 0xFF70 -- CGB WRAM bank select; D000-DFFF addresses are only valid when bank <= 1

local KEYS = { A = 0, B = 1, SELECT = 2, START = 3, RIGHT = 4, LEFT = 5, UP = 6, DOWN = 7 }
pcall(function()
  for name, value in pairs(C.GB_KEY) do
    KEYS[name] = value
  end
end)

local S = {
  game = nil,
  frame = 0,
  phase = "idle",
  active = false,
  attempt = 0,
  wait = 0,
  counter = 0,
  baseline = nil,
  partyBase = 0,
  dvAddr = nil,
  lastVal = nil,
  stable = 0,
  holdLeft = 0,
  holdThroughWatch = false,
  lastRead = nil,
  gen1party = false
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

local function triggerKey()
  return KEYS[string.upper(config.trigger)] or KEYS.A
end

local function triggerIsDirection()
  local t = string.upper(config.trigger)
  return t == "UP" or t == "DOWN" or t == "LEFT" or t == "RIGHT"
end

local function clearAllKeys()
  local ok = pcall(function() emu:clearKeys(0x3FF) end)
  if not ok then
    for _, v in pairs(KEYS) do
      pcall(function() emu:clearKey(v) end)
    end
  end
end

local function watchAddr()
  local g = S.game
  if not g then return nil end
  local addr
  if config.watch == "enemy" then addr = g.enemyDvs
  elseif config.watch == "party" then addr = g.party1Dvs
  elseif config.watch == "tid" then addr = g.playerId
  end
  if addr == nil or addr == 0 then return nil end
  return addr
end

-- Crystal keeps party/enemy/ID data in WRAM bank 1 (0xD000-0xDFFF). emu:read8 goes through
-- the bus and returns whatever bank rSVBK currently selects, and game code briefly holds
-- other banks. Only trust D000-DFFF reads while the selected bank is 0 or 1. On DMG games
-- (Red/Blue/Yellow/Gold/Silver on a DMG) rSVBK reads back with the low bits set the same way,
-- but their addresses are not banked; we only gate Crystal, whose data genuinely lives in
-- bank 1 that the CPU maps at D000.
local function bankSafe(addr)
  if not S.game or S.game.name ~= "Crystal" then return true end
  if addr < 0xD000 or addr > 0xDFFF then return true end
  local ok, b = pcall(function() return emu:read8(SVBK) end)
  if not ok then return true end
  return (b & 7) <= 1
end

local function read16be(addr)
  if not bankSafe(addr) then return nil end
  local ok, hi = pcall(function() return emu:read8(addr) end)
  if not ok then return nil end
  local ok2, lo = pcall(function() return emu:read8(addr + 1) end)
  if not ok2 then return nil end
  return (hi << 8) | lo
end

local function isShinyDvs(val)
  local atk = (val >> 12) & 0xF
  local def = (val >> 8) & 0xF
  local spe = (val >> 4) & 0xF
  local spc = val & 0xF
  if def ~= 10 or spe ~= 10 or spc ~= 10 then return false end
  return atk == 2 or atk == 3 or atk == 6 or atk == 7 or atk == 10 or atk == 11 or atk == 14 or atk == 15
end

local function matchesCustom(val)
  local pattern = string.upper(config.custom_dvs)
  if #pattern ~= 4 then return false end
  local hex = string.format("%04X", val)
  for i = 1, 4 do
    local p = pattern:sub(i, i)
    if p ~= "?" and p ~= hex:sub(i, i) then return false end
  end
  return true
end

local function matches(val)
  if config.target == "shiny" then return isShinyDvs(val) end
  return matchesCustom(val)
end

local function describe(val)
  return string.format("%04X (Atk %d / Def %d / Spe %d / Spc %d)%s",
    val, (val >> 12) & 0xF, (val >> 8) & 0xF, (val >> 4) & 0xF, val & 0xF,
    isShinyDvs(val) and "  SHINY" or "")
end

local function hasSavestates()
  local ok, t = pcall(function() return type(emu.saveStateSlot) end)
  return ok and t == "function"
end

local function stopHunt(msg)
  clearAllKeys()
  S.active = false
  S.phase = "idle"
  if msg then say(msg) end
end

local function nextAttempt()
  clearAllKeys()
  S.attempt = S.attempt + 1
  S.wait = S.wait + config.wait_step
  if S.attempt % config.report_every == 0 then
    say(string.format("attempt %d (wait %d): last roll %s", S.attempt,
      S.wait, S.lastRead and describe(S.lastRead) or "none"))
  end
  S.phase = "load"
end

local function onFound(val)
  stopHunt(string.format("FOUND on attempt %d (wait %d): %s -- take over and save your game!",
    S.attempt, S.wait, describe(val)))
end

local function read8at(addr)
  if not bankSafe(addr) then return nil end
  local ok, v = pcall(function() return emu:read8(addr) end)
  if ok then return v end
  return nil
end

local function evaluateRead(cur)
  S.lastRead = cur
  clearAllKeys()
  if matches(cur) then
    onFound(cur)
  else
    nextAttempt()
  end
end

local function stableRead()
  S.counter = S.counter - 1
  if S.counter <= 0 then
    nextAttempt()
    return
  end
  local cur = read16be(S.dvAddr)
  if cur == nil then
    stopHunt("memory read failed; hunt stopped")
    return
  end
  if cur == S.lastVal then
    S.stable = S.stable + 1
  else
    S.lastVal = cur
    S.stable = 0
  end
  if S.stable >= 2 then
    evaluateRead(cur)
  end
end

local function huntTick()
  if not S.holdThroughWatch and S.holdLeft > 0 then
    S.holdLeft = S.holdLeft - 1
    if S.holdLeft == 0 then
      pcall(function() emu:clearKey(triggerKey()) end)
    end
  end
  if S.phase == "load" then
    clearAllKeys()
    S.holdLeft = 0
    local ok, ret = pcall(function() return emu:loadStateSlot(config.state_slot) end)
    if not ok or ret == false then
      stopHunt("savestate reload failed; hunt stopped")
      return
    end
    -- Advance the checkpoint one frame and re-save, so each attempt shifts the timing by one
    -- frame at constant cost instead of waiting an ever-growing number of frames (which made
    -- total hunt time quadratic).
    S.counter = math.max(1, config.wait_step)
    S.phase = "resave"
  elseif S.phase == "resave" then
    S.counter = S.counter - 1
    if S.counter <= 0 then
      pcall(function() return emu:saveStateSlot(config.state_slot) end)
      S.counter = config.settle_frames
      S.phase = "settle"
    end
  elseif S.phase == "settle" then
    S.counter = S.counter - 1
    if S.counter <= 0 then
      S.gen1party = false
      if config.watch == "tid" then
        S.baseline = read16be(S.game.playerId)
        if S.baseline == nil then S.counter = 1; return end -- bank window; retry next frame
      elseif config.watch == "party" then
        local count = read8at(S.game.partyCount)
        if count == nil then S.counter = 1; return end
        if S.game.gen == 1 then
          -- Gen 1: the nickname prompt runs BEFORE the DV roll (AskName inside _AddPartyMon,
          -- pokered add_mon.asm), so the mon's slot already exists (count incremented) but its
          -- DVs are stale until naming ends. Savestate ON the "give a nickname?" box, trigger B
          -- to decline; we then watch that slot's DV bytes change as the roll writes them.
          if count < 1 then
            stopHunt("Gen 1 gift hunt: stand ON the \"Do you want to give a nickname?\" box (the mon is already in your party there), set trigger B, and try again")
            return
          end
          S.dvAddr = S.game.party1Dvs + S.game.stride * (count - 1)
          S.baseline = read16be(S.dvAddr)
          if S.baseline == nil then S.counter = 1; return end
          S.gen1party = true
        else
          if count >= 6 then
            stopHunt("the party is full; gifts go to the box and the hunt cannot see them -- make room first")
            return
          end
          S.partyBase = count
        end
      end
      S.lastVal = nil
      S.stable = 0
      S.counter = 1 -- checkpoint-advance shifts timing; press at a fixed small offset
      S.phase = "waitk"
    end
  elseif S.phase == "waitk" then
    S.counter = S.counter - 1
    if S.counter <= 0 then
      emu:addKey(triggerKey())
      S.holdLeft = config.hold_frames
      S.holdThroughWatch = triggerIsDirection()
      S.counter = config.timeout_frames
      S.phase = "watch"
    end
  elseif S.phase == "watch" then
    S.counter = S.counter - 1
    if S.counter <= 0 then
      nextAttempt()
      return
    end
    if config.watch == "enemy" then
      local flag = read8at(S.game.battleFlag)
      if flag ~= nil and flag ~= 0 then
        S.counter = 30
        S.phase = "battle_settle"
      end
    elseif config.watch == "party" and S.gen1party then
      -- watch the new slot's DV bytes change from the pre-roll baseline
      local cur = read16be(S.dvAddr)
      if cur ~= nil and cur ~= S.baseline then
        if cur == S.lastVal then
          S.stable = S.stable + 1
        else
          S.lastVal = cur
          S.stable = 0
        end
        if S.stable >= 2 then
          evaluateRead(cur)
        end
      end
    elseif config.watch == "party" then
      local cur = read8at(S.game.partyCount)
      if cur ~= nil and cur == S.partyBase + 1 and cur >= 1 and cur <= 6 then
        S.dvAddr = S.game.party1Dvs + S.game.stride * (cur - 1)
        S.lastVal = nil
        S.stable = 0
        S.counter = 180
        S.phase = "read_stable"
      end
    else
      local cur = read16be(S.game.playerId)
      if cur ~= nil and cur ~= S.baseline then
        if cur == S.lastVal then
          S.stable = S.stable + 1
        else
          S.lastVal = cur
          S.stable = 0
        end
        if S.stable >= 2 then
          evaluateRead(cur)
        end
      end
    end
  elseif S.phase == "battle_settle" then
    S.counter = S.counter - 1
    if S.counter <= 0 then
      S.dvAddr = S.game.enemyDvs
      S.lastVal = nil
      S.stable = 0
      S.counter = 180
      S.phase = "read_stable"
    end
  elseif S.phase == "read_stable" then
    stableRead()
  end
end

local function onFrame()
  S.frame = S.frame + 1
  if S.active then huntTick() end
  if next(net.clients) ~= nil and S.frame % 30 == 0 then
    sockBroadcast(string.format("STATE game=%s mode=%s attempt=%d wait=%d last=%s shiny=%d",
      S.game and S.game.name or "-", S.phase, S.attempt, S.wait,
      S.lastRead and string.format("%04X", S.lastRead) or "-",
      (S.lastRead and isShinyDvs(S.lastRead)) and 1 or 0))
  end
end

function status()
  if not S.game then
    say("no supported game detected")
    return
  end
  say(string.format("%s | phase %s | attempt %d | wait %d | watch %s @ %s | last %s",
    S.game.name, S.phase, S.attempt, S.wait, config.watch,
    watchAddr() and string.format("0x%04X", watchAddr()) or "unsupported",
    S.lastRead and describe(S.lastRead) or "none"))
end

function hunt()
  if not S.game then
    say("no supported game detected")
    return
  end
  if S.active then
    say("already hunting; stop() first")
    return
  end
  if not watchAddr() then
    say(string.format("watch target %q has no verified address for %s yet", config.watch, S.game.name))
    return
  end
  if not KEYS[string.upper(config.trigger)] then
    say(string.format("unknown trigger %q; use A, Start, Up, Down, Left or Right", config.trigger))
    return
  end
  if not hasSavestates() then
    say("this mGBA build exposes no savestate API; hunt cannot run")
    return
  end
  local ok, ret = pcall(function() return emu:saveStateSlot(config.state_slot) end)
  if not ok or ret == false then
    say("could not save the checkpoint to slot " .. config.state_slot)
    return
  end
  S.active = true
  S.attempt = 1
  S.wait = config.wait_start
  S.lastRead = nil
  S.lastVal = nil
  S.stable = 0
  S.counter = config.settle_frames
  S.phase = "settle"
  say(string.format("hunting: trigger %s, watch %s, target %s (checkpoint in slot %d; hold fast-forward!)",
    config.trigger, config.watch, config.target, config.state_slot))
end

function stop()
  stopHunt("hunt stopped at attempt " .. S.attempt)
end

local function applySetting(key, value)
  if S.active then
    say("cannot change settings mid-hunt; stop() first")
    return
  end
  if key == "trigger" then
    if KEYS[string.upper(value)] then
      config.trigger = value
    else
      say(string.format("unknown trigger %q", value))
      return
    end
  elseif key == "watch" then config.watch = value
  elseif key == "target" then config.target = value
  elseif key == "custom_dvs" then config.custom_dvs = value
  elseif key == "wait_step" then config.wait_step = math.max(1, tonumber(value) or config.wait_step)
  elseif key == "wait_start" then config.wait_start = tonumber(value) or config.wait_start
  elseif key == "timeout_frames" then config.timeout_frames = tonumber(value) or config.timeout_frames
  elseif key == "settle_frames" then config.settle_frames = tonumber(value) or config.settle_frames
  else
    say("unknown setting " .. tostring(key))
    return
  end
  say(string.format("%s = %s", key, tostring(value)))
end

function setopt(key, value)
  applySetting(key, value)
end

function help()
  say("commands: hunt() | stop() | status() | setopt(key, value) | help()")
  say("settings: trigger, watch (enemy/party/tid), target (shiny/custom), custom_dvs, wait_step, timeout_frames")
end

local function handleNetCommand(line)
  line = line:gsub("%s+$", "")
  local cmd, rest = line:match("^(%S+)%s*(.*)$")
  if not cmd then return end
  if cmd == "ping" then
    sockBroadcast("PONG")
  elseif cmd == "hunt" then
    hunt()
  elseif cmd == "stop" then
    stop()
  elseif cmd == "status" then
    status()
  elseif cmd == "set" then
    local key, value = rest:match("^(%S+)%s+(%S+)$")
    if key then
      applySetting(key, value)
    else
      say("net: set needs a key and a value")
    end
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
  pcall(function() c:send("HELLO shiny-solution gb 1\n") end)
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

local function detect()
  if S.active then
    stopHunt("hunt stopped: ROM changed or restarted")
  end
  local ok, raw = pcall(function() return emu:readRange(0x0134, 16) end)
  if not ok or type(raw) ~= "string" then return end
  local title = raw:gsub("%z.*$", "")
  S.game = nil
  for _, g in ipairs(GAMES) do
    if title:sub(1, #g.match) == g.match then
      S.game = g
      break
    end
  end
  if S.game then
    -- Reject Japanese/other localized carts: their WRAM layouts differ from these verified
    -- English/Australian addresses, so hunting them would read unrelated memory.
    if S.game.codes then
      local code = nil
      local okc, craw = pcall(function() return emu:readRange(0x013F, 4) end)
      if okc and type(craw) == "string" and #craw == 4 then code = craw end
      if code and not S.game.codes[code] then
        say(string.format("detected a %s-titled cart but its game code is %q, not the verified English/Australian code(s); addresses are unverified for this region -- hunting disabled", S.game.name, code))
        S.game = nil
        return
      end
    else
      -- Gen 1 predates the game-ID field; gate on the destination byte (0x00 = Japan).
      local okd, dest = pcall(function() return emu:read8(0x014A) end)
      if okd and dest == 0 then
        say(string.format("detected Japanese %s; its WRAM layout differs from the verified English addresses -- hunting disabled", S.game.name))
        S.game = nil
        return
      end
    end
    say(string.format("detected %s (gen %d)", S.game.name, S.game.gen))
    if S.game.enemyDvs == 0 then
      say("addresses for this game are not verified yet; hunting is disabled")
    else
      say("type help() for commands, or connect the Shiny-Solution app")
    end
  else
    say(string.format("unrecognized ROM title %q", title))
  end
end

if emu then
  detect()
else
  say("waiting for a ROM to load")
end

callbacks:add("frame", onFrame)
pcall(function() callbacks:add("start", detect) end)
startServer()
