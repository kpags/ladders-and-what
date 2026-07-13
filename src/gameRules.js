export const SKILL_COOLDOWN_MS = 120_000
export const WEAPON_COOLDOWN_MS = 60_000
export const CLASH_SKILL_COOLDOWN_MS = 60_000
export const CLASH_MAX_HEALTH = 100
export const CLASH_TURN_MS = 20_000
export const CLASH_MOVE_PUFF_MS = 600
export const CLASH_MOVE_REAPPEAR_DELAY_MS = 500
export const CLASH_MOVE_EVENT_MS = CLASH_MOVE_REAPPEAR_DELAY_MS + CLASH_MOVE_PUFF_MS
export const CLASH_BOARD_COLUMNS = 15
export const CLASH_BOARD_SPACES = CLASH_BOARD_COLUMNS * CLASH_BOARD_COLUMNS
export const CLASH_PLAYER_SPAWN_SPACES = [1, 15, 106, 120, 211, 225]

function normalizedCharacterSkill(skill) {
  if (!skill) return null
  return {
    ...skill,
    description: skill.description || skill.effect || '',
  }
}

function passiveSkillFromCharacter(player) {
  return normalizedCharacterSkill(player.passiveSkill || player.skills?.find(skill => skill.type === 'passive'))
}

function activeSkillFromCharacter(player) {
  return normalizedCharacterSkill(player.specialSkill || player.activeSkill || player.skills?.find(skill => skill.type === 'active') || player.skills?.find(skill => skill.type !== 'passive'))
}

function randomInteger(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function prepareBoard(board) {
  const prepared = structuredClone(board)
  prepared.ladders ||= []
  prepared.question_marks ||= []
  prepared.whats ||= []
  if (prepared.type === 'guess_what') {
    if (!prepared.question_marks.length) {
      const candidates = Array.from({ length: 94 }, (_, index) => index + 5)
      while (prepared.question_marks.length < Math.min(13, candidates.length)) {
        prepared.question_marks.push(candidates.splice(randomInteger(0, candidates.length - 1), 1)[0])
      }
      prepared.question_marks.sort((a, b) => a - b)
    }
    prepared.hiddenQuestionMarks = true
  }
  return prepared
}

export function createGameState(board, players, startedAt = Date.now(), options = {}) {
  const preparedBoard = prepareBoard(board)
  const questionnaire = Array.isArray(options.questionnaire)
    ? options.questionnaire
    : options.questionnaire?.questionnaire || []
  const state = {
    mode: preparedBoard.type || 'standard',
    board: preparedBoard,
    players: players.map((player, index) => ({
      ...player,
      id: player.id || `${player.isAI ? 'ai' : 'player'}-${index}`,
      space: 1,
      skipTurns: 0,
      skipReason: null,
      skillBlockedTurns: 0,
      passiveSkill: passiveSkillFromCharacter(player),
      specialSkill: activeSkillFromCharacter(player),
      skillCooldownUntil: preparedBoard.type === 'clash_with' ? 0 : startedAt + SKILL_COOLDOWN_MS,
      skillRefreshPending: false,
      delayedSkillCooldownStartTurn: null,
      skillArmed: null,
      rerollPending: false,
      specialRollPending: false,
      finished: false,
      eliminated: false,
      won: false,
      rank: null,
      health: preparedBoard.type === 'escape_from' ? (preparedBoard.max_player_lives || 5) : preparedBoard.type === 'clash_with' ? CLASH_MAX_HEALTH : null,
      heldKeys: [],
      weaponCooldownUntil: 0,
      weaponPendingPenaltyMs: 0,
      weaponProtectFromTurn: null,
      weaponProtectThroughTurn: null,
      visionBoostThroughTurn: null,
      clashStunnedThroughTurn: null,
      clashDeathSpace: null,
      clashDotEffects: [],
      clashMeleeCooldownUntil: 0,
      clashSkillArmed: null,
      clashMoveBoostThroughTurn: null,
      clashSkillNotice: null,
    })),
    currentPlayerIndex: 0,
    winners: [],
    winner: null,
    loser: null,
    gameOver: false,
    exactMoveFor100: Boolean(options.exactMoveFor100) && ['standard', 'run_away'].includes(preparedBoard.type),
    turn: 1,
    lastRoll: null,
    lastWhat: null,
    lastQuestionChain: [],
    lastEvent: 'The race to 100 is ready to begin.',
    log: ['Game started. Reach 100—and do not be the last player left!'],
    questionHistory: {},
    destroyedSpaces: [],
    hiddenMines: [],
    lastMineExplosion: null,
    lastExactBounce: null,
    nextExplosionTurn: preparedBoard.type === 'run_away' ? randomInteger(3, 5) : null,
    lastExplosion: null,
    lastTraversalElimination: null,
    remainingQuestionIds: preparedBoard.type === 'guess_what'
      ? Object.fromEntries(['easy', 'medium', 'hard'].map(difficulty => [
          difficulty,
          questionnaire.filter(question => question.difficulty === difficulty).map(question => question.id),
        ]))
      : null,
  }
  if (state.mode === 'escape_from') initializeEscapeState(state)
  if (state.mode === 'clash_with') initializeClashState(state)
  return state
}

function randomChoice(items, rng = Math.random) {
  return items[Math.floor(rng() * items.length)]
}

function ladderSpaces(board) {
  return new Set((board.ladders || []).flatMap(ladder => [ladder.from, ladder.to]))
}

function shuffled(items, rng = Math.random) {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(rng() * (index + 1))
    ;[result[index], result[swap]] = [result[swap], result[index]]
  }
  return result
}

function spaceToGrid(space) {
  const row = Math.floor((space - 1) / 10)
  const position = (space - 1) % 10
  const column = row % 2 === 0 ? position : 9 - position
  return { row, column }
}

function gridToSpace(row, column) {
  if (row < 0 || row > 9 || column < 0 || column > 9) return null
  const position = row % 2 === 0 ? column : 9 - column
  return row * 10 + position + 1
}

function clashSpaceToGrid(space) {
  const row = Math.floor((space - 1) / CLASH_BOARD_COLUMNS)
  const position = (space - 1) % CLASH_BOARD_COLUMNS
  const column = row % 2 === 0 ? position : CLASH_BOARD_COLUMNS - 1 - position
  return { row, column }
}

function clashGridToSpace(row, column) {
  if (row < 0 || row >= CLASH_BOARD_COLUMNS || column < 0 || column >= CLASH_BOARD_COLUMNS) return null
  const position = row % 2 === 0 ? column : CLASH_BOARD_COLUMNS - 1 - column
  return row * CLASH_BOARD_COLUMNS + position + 1
}

export function spacesWithinChebyshev(space, distance = 2) {
  const { row, column } = spaceToGrid(space)
  const spaces = []
  for (let rowOffset = -distance; rowOffset <= distance; rowOffset++) {
    for (let columnOffset = -distance; columnOffset <= distance; columnOffset++) {
      if (!rowOffset && !columnOffset) continue
      if (Math.max(Math.abs(rowOffset), Math.abs(columnOffset)) > distance) continue
      const next = gridToSpace(row + rowOffset, column + columnOffset)
      if (next != null) spaces.push(next)
    }
  }
  return spaces
}

function clashSpacesWithinChebyshev(space, distance = 2) {
  const { row, column } = clashSpaceToGrid(space)
  const spaces = []
  for (let rowOffset = -distance; rowOffset <= distance; rowOffset++) {
    for (let columnOffset = -distance; columnOffset <= distance; columnOffset++) {
      if (!rowOffset && !columnOffset) continue
      if (Math.max(Math.abs(rowOffset), Math.abs(columnOffset)) > distance) continue
      const next = clashGridToSpace(row + rowOffset, column + columnOffset)
      if (next != null) spaces.push(next)
    }
  }
  return spaces
}

function clashAffectedPlayers(state, sourceSpace, radius, ownerId) {
  const affectedSpaces = new Set([sourceSpace, ...clashSpacesWithinChebyshev(sourceSpace, radius)])
  return activePlayers(state).filter(player => player.id !== ownerId && affectedSpaces.has(player.space))
}

function clashMeleeDestination(attackerSpace, targetSpace) {
  const attacker = clashSpaceToGrid(attackerSpace)
  const target = clashSpaceToGrid(targetSpace)
  const rowDirection = Math.sign(target.row - attacker.row)
  const columnDirection = Math.sign(target.column - attacker.column)
  if (!rowDirection && !columnDirection) return null
  return clashGridToSpace(target.row - rowDirection, target.column - columnDirection)
}

function itemId(item) {
  return String(item.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function weaponDamage(weapon, mode, rng = Math.random) {
  const requested = mode.bullets_per_fire ?? mode.attacks_per_fire ?? 1
  const available = weapon.class === 'melee' ? requested : Math.max(0, Math.min(requested, Number(weapon.ammoRemaining ?? weapon.max_capacity ?? requested)))
  const base = weapon.damage_per_bullet ?? weapon.damage_per_attack ?? 0
  let hits = 0
  for (let index = 0; index < available; index++) {
    if (rng() * 100 < Number(mode.accuracy ?? 100)) hits++
  }
  return { hits, attempts: available, damage: hits * base }
}

function clashWeaponSlot(weapon) {
  if (weapon.class === 'melee') return 'melee'
  if (weapon.class === 'pistol') return 'pistol'
  return 'primary'
}

function prepareClashWeapon(weapon) {
  const prepared = structuredClone(weapon)
  if (prepared.class !== 'melee') prepared.ammoRemaining = Number(prepared.ammoRemaining ?? prepared.max_capacity ?? 0)
  return prepared
}

function clashAvailableDropSpaces(state) {
  const blocked = new Set()
  for (const player of state.players) if (!player.eliminated) blocked.add(player.space)
  for (const drop of state.clashDrops || []) blocked.add(drop.space)
  return Array.from({ length: CLASH_BOARD_SPACES }, (_, index) => index + 1).filter(space => !blocked.has(space))
}

function chooseWeightedByChance(definitions, rng = Math.random) {
  const weighted = definitions.filter(item => rng() * 100 < Number(item.drop_chance ?? 100))
  const source = weighted.length ? weighted : definitions
  return structuredClone(source[Math.floor(rng() * source.length)])
}

function clashSupplyDropCounts(state) {
  const playerCount = Math.max(0, state.players?.length || 0)
  const count = 4 + Math.max(0, playerCount - 3)
  return { weapons: count, items: count }
}

function spawnClashDrops(state, { pistols = 0, weapons = 0, items = 0 } = {}, rng = Math.random) {
  const spaces = shuffled(clashAvailableDropSpaces(state), rng)
  const drops = []
  const addDrop = (kind, definition) => {
    const space = spaces.shift()
    if (!space || !definition) return
    drops.push({
      id: `clash-drop-${state.turn}-${state.clashDropSerial++}`,
      kind,
      definition,
      space,
    })
  }
  const pistolDefinitions = (state.board.weapons || []).filter(weapon => weapon.class === 'pistol')
  const weaponDefinitions = (state.board.weapons || []).filter(weapon => weapon.class !== 'melee')
  for (let index = 0; index < pistols; index++) addDrop('weapon', chooseWeightedByChance(pistolDefinitions, rng))
  for (let index = 0; index < weapons; index++) addDrop('weapon', chooseWeightedByChance(weaponDefinitions, rng))
  for (let index = 0; index < items; index++) addDrop('item', chooseWeightedByChance(state.board.items || [], rng))
  const scavenger = state.players.find(player => !player.eliminated && !player.finished && player.passiveSkill?.name === 'Scavenger')
  if (scavenger && rng() < 0.2) {
    const occupied = new Set([
      ...state.players.filter(player => !player.eliminated).map(player => player.space),
      ...drops.map(drop => drop.space),
    ])
    const nudgeDrop = (drop, preferRows) => {
      if (!drop) return
      const from = clashSpaceToGrid(drop.space)
      const to = clashSpaceToGrid(scavenger.space)
      const rowStep = Math.sign(to.row - from.row)
      const columnStep = Math.sign(to.column - from.column)
      const candidates = preferRows
        ? [[from.row + rowStep, from.column], [from.row, from.column + columnStep]]
        : [[from.row, from.column + columnStep], [from.row + rowStep, from.column]]
      for (const [row, column] of candidates) {
        const next = clashGridToSpace(row, column)
        if (next && !occupied.has(next)) {
          occupied.delete(drop.space)
          drop.space = next
          occupied.add(next)
          return
        }
      }
    }
    nudgeDrop(drops.find(drop => drop.kind === 'weapon'), true)
    nudgeDrop(drops.find(drop => drop.kind === 'item'), false)
  }
  state.clashDrops.push(...drops)
  if (drops.length) {
    state.lastClashDrop = { turn: state.turn, count: drops.length }
    addLog(state, `${drops.length} Clash supply drop(s) landed on the board.`)
  }
  return drops
}

function clashInventorySnapshot(player) {
  return {
    weapons: player.clashInventory.weapons.map(weapon => weapon.name),
    items: player.clashInventory.items.map(item => ({ name: item.name, count: item.count })),
  }
}

export function initializeClashState(state, rng = Math.random) {
  const spawnSpaces = shuffled(CLASH_PLAYER_SPAWN_SPACES, rng)
  const fallbackSpaces = shuffled(
    Array.from({ length: CLASH_BOARD_SPACES }, (_, index) => index + 1)
      .filter(space => !CLASH_PLAYER_SPAWN_SPACES.includes(space)),
    rng,
  )
  const knife = prepareClashWeapon((state.board.weapons || []).find(weapon => weapon.class === 'melee') || {
    name: 'Combat Knife',
    class: 'melee',
    damage_per_attack: 20,
    modes: [{ name: 'Single Attack', attacks_per_fire: 1, accuracy: 100 }],
  })
  state.players.forEach((player, index) => {
    player.space = spawnSpaces[index] || fallbackSpaces[index - CLASH_PLAYER_SPAWN_SPACES.length] || index + 1
    player.health = CLASH_MAX_HEALTH
    player.clashInventory = {
      weapons: [prepareClashWeapon(knife)],
      items: [],
    }
    player.clashPendingPickup = null
  })
  state.clashDrops = []
  state.clashDropSerial = 1
  state.clashEffects = []
  state.lastClashAction = null
  state.nextClashDropTurn = 5
  state.clashRivalRevealTurn = null
  spawnClashDrops(state, { pistols: 7, ...clashSupplyDropCounts(state) }, rng)
  state.log = ['Clash begins. Loot fast, stay hidden, and be the last one standing.']
  state.lastEvent = state.log[0]
}

export function clashVisibleSpaces(player) {
  return new Set([player.space, ...clashSpacesWithinChebyshev(player.space, 2)])
}

export function clashAttackPresentation(state, viewerId, attack) {
  const viewer = state?.players?.find(player => player.id === viewerId)
  if (!viewer || state?.mode !== 'clash_with') return { kind: 'full' }
  if (viewer.eliminated) return { kind: 'full' }
  if (viewerId === attack?.playerId || viewerId === attack?.targetId) return { kind: 'full' }

  const visibleSpaces = clashVisibleSpaces(viewer)
  if (visibleSpaces.has(attack?.sourceSpace) || visibleSpaces.has(attack?.targetSpace)) return { kind: 'full' }

  const viewerGrid = clashSpaceToGrid(viewer.space)
  const sourceGrid = clashSpaceToGrid(attack?.sourceSpace || viewer.space)
  const targetGrid = clashSpaceToGrid(attack?.targetSpace || attack?.sourceSpace || viewer.space)
  const dx = ((sourceGrid.column + targetGrid.column) / 2) - viewerGrid.column
  const dy = viewerGrid.row - ((sourceGrid.row + targetGrid.row) / 2)
  const directionDegrees = Math.round(Math.atan2(dy, dx) * 180 / Math.PI / 45) * 45
  return { kind: 'direction', directionDegrees }
}

export function clashMoveOptions(state, player = state.players[state.currentPlayerIndex]) {
  if (state.mode !== 'clash_with' || !player || player.eliminated || player.finished) return []
  const boosted = player.clashMoveBoostThroughTurn != null && state.turn <= player.clashMoveBoostThroughTurn
  const adventurer = player.clashSkillArmed === 'adventurer-steps'
  return clashSpacesWithinChebyshev(player.space, adventurer ? 12 : boosted ? 4 : 2)
}

export function clashGhostMoveOptions(player) {
  if (!player) return []
  return clashSpacesWithinChebyshev(player.space, 1)
}

function canCarryClashItem(player, item) {
  const id = itemId(item)
  const existing = player.clashInventory.items.find(entry => entry.id === id)
  const throwables = player.clashInventory.items
    .filter(entry => ['damage', 'damage_over_time', 'stun'].includes(entry.effect))
    .reduce((sum, entry) => sum + entry.count, 0)
  const throwableLimit = player.passiveSkill?.name === 'Handy' ? 3 : 2
  if (['damage', 'damage_over_time', 'stun'].includes(item.effect) && throwables >= throwableLimit) return false
  if (item.effect === 'heal' && id.includes('medkit') && (existing?.count || 0) >= 1) return false
  if (item.effect === 'heal' && id.includes('bandage') && (existing?.count || 0) >= 2) return false
  return (existing?.count || 0) < Number(item.max_capacity || 1)
}

function applyPortableWorkbench(player, weapon, rng = Math.random) {
  if (!weapon) return { weapon, triggered: false }
  const prepared = prepareClashWeapon(weapon)
  if (player.passiveSkill?.name !== 'Portable Workbench' || rng() >= 0.15) return { weapon: prepared, triggered: false }
  if (prepared.class !== 'melee') {
    prepared.max_capacity = Math.max(1, Number(prepared.max_capacity || prepared.ammoRemaining || 0) * 2)
    prepared.ammoRemaining = prepared.max_capacity
  }
  return { weapon: prepared, triggered: true }
}

function pickupClashDrop(state, player, rng = Math.random) {
  const drop = state.clashDrops.find(item => item.space === player.space)
  if (!drop) return null
  if (drop.kind === 'weapon') {
    const slot = clashWeaponSlot(drop.definition)
    if (slot === 'melee') return null
    const existingIndex = player.clashInventory.weapons.findIndex(weapon => clashWeaponSlot(weapon) === slot)
    if (existingIndex >= 0) {
      player.clashPendingPickup = { dropId: drop.id, weapon: drop.definition, slot }
      addLog(state, `${player.name} found ${drop.definition.name}. Choose whether to replace your ${slot === 'pistol' ? 'pistol' : 'primary weapon'}.`)
      return { kind: 'weapon_pending', drop }
    }
    const prepared = applyPortableWorkbench(player, drop.definition, rng)
    player.clashInventory.weapons.push(prepared.weapon)
    state.clashDrops = state.clashDrops.filter(item => item.id !== drop.id)
    addLog(state, `${player.name} picked up ${drop.definition.name}${prepared.triggered ? ' with doubled ammo capacity' : ''}.`)
    return { kind: 'weapon', drop, passiveTrigger: prepared.triggered ? { name: player.passiveSkill.name, playerId: player.id, playerName: player.name } : null }
  }
  if (!canCarryClashItem(player, drop.definition)) {
    addLog(state, `${player.name} found ${drop.definition.name}, but cannot carry more.`)
    return { kind: 'full', drop }
  }
  const id = itemId(drop.definition)
  const existing = player.clashInventory.items.find(entry => entry.id === id)
  if (existing) existing.count++
  else player.clashInventory.items.push({ id, ...structuredClone(drop.definition), count: 1 })
  state.clashDrops = state.clashDrops.filter(item => item.id !== drop.id)
  addLog(state, `${player.name} picked up ${drop.definition.name}.`)
  return { kind: 'item', drop }
}

export function resolveClashPickup(state, playerId, replace) {
  if (state.mode !== 'clash_with') return null
  const player = state.players.find(item => item.id === playerId)
  const pending = player?.clashPendingPickup
  if (!player || !pending) return null
  const drop = state.clashDrops.find(item => item.id === pending.dropId)
  player.clashPendingPickup = null
  if (!drop) return null
  if (!replace) {
    addLog(state, `${player.name} left ${drop.definition.name} on the ground.`)
    return { player, picked: false, drop }
  }
  const existingIndex = player.clashInventory.weapons.findIndex(weapon => clashWeaponSlot(weapon) === pending.slot)
  const prepared = applyPortableWorkbench(player, drop.definition)
  if (existingIndex >= 0) player.clashInventory.weapons.splice(existingIndex, 1, prepared.weapon)
  else player.clashInventory.weapons.push(prepared.weapon)
  state.clashDrops = state.clashDrops.filter(item => item.id !== drop.id)
  addLog(state, `${player.name} equipped ${drop.definition.name}${prepared.triggered ? ' with doubled ammo capacity' : ''}.`)
  return { player, picked: true, drop, passiveTrigger: prepared.triggered ? { name: player.passiveSkill.name, playerId: player.id, playerName: player.name } : null }
}

function concludeClashIfOneRemains(state) {
  const alive = activePlayers(state)
  if (state.mode === 'clash_with' && alive.length <= 1) {
    const winner = alive[0] || null
    if (winner) {
      winner.won = true
      winner.finished = true
      state.winner = winner
      state.winners = [winner]
      addLog(state, `${winner.name} is the last one standing!`)
    }
    state.gameOver = true
  }
}

function startClashSkillCooldown(player, now = Date.now()) {
  player.skillCooldownUntil = now + CLASH_SKILL_COOLDOWN_MS
}

function applyClashDamage(state, target, amount, sourceText, rng = Math.random) {
  if (target.passiveSkill?.name === 'Braveheart' && target.health < 30) {
    amount = Math.max(0, Math.ceil(amount * 0.85))
  }
  const before = target.health
  target.health = Math.max(0, target.health - amount)
  if (target.health <= 0) {
    target.clashDeathSpace ??= target.space
    target.eliminated = true
    target.finished = true
    target.rank = null
    addLog(state, `${target.name} was eliminated by ${sourceText}.`)
  }
  concludeClashIfOneRemains(state)
  return { before, after: target.health, eliminated: target.eliminated }
}

export function takeClashMove(state, playerId, destination, now = Date.now()) {
  if (state.gameOver || state.mode !== 'clash_with') return { ok: false, message: 'Clash is unavailable.' }
  const player = state.players[state.currentPlayerIndex]
  if (!player || player.id !== playerId) return { ok: false, message: 'It is not your turn.' }
  if (player.clashStunnedThroughTurn != null && state.turn <= player.clashStunnedThroughTurn) return { ok: false, message: 'You are stunned and cannot move.' }
  const targetSpace = Number(destination)
  if (!clashMoveOptions(state, player).includes(targetSpace)) return { ok: false, message: 'That space is outside your movement range.' }
  const from = player.space
  player.space = targetSpace
  const pickup = pickupClashDrop(state, player)
  state.lastClashAction = { type: 'move', playerId, from, to: targetSpace, pickup }
  addLog(state, `${player.name} moved from ${from} to ${targetSpace}.`)
  if (player.clashSkillArmed === 'adventurer-steps') {
    player.clashSkillArmed = null
    startClashSkillCooldown(player, now)
  }
  advanceTurn(state)
  return { ok: true, player, from, to: targetSpace, pickup }
}

export function takeClashAttack(state, playerId, targetId, weaponName, modeName, rng = Math.random, now = Date.now()) {
  if (state.gameOver || state.mode !== 'clash_with') return { ok: false, message: 'Clash is unavailable.' }
  const player = state.players[state.currentPlayerIndex]
  if (!player || player.id !== playerId) return { ok: false, message: 'It is not your turn.' }
  if (player.clashStunnedThroughTurn != null && state.turn <= player.clashStunnedThroughTurn) return { ok: false, message: 'You are stunned and cannot act.' }
  const target = state.players.find(item => item.id === targetId && !item.eliminated && !item.finished && item.id !== player.id)
  if (!target) return { ok: false, message: 'Target unavailable.' }
  if (!clashVisibleSpaces(player).has(target.space)) return { ok: false, message: 'Target is not visible.' }
  const weapon = player.clashInventory.weapons.find(item => item.name === weaponName) || (!weaponName ? player.clashInventory.weapons[0] : null)
  const mode = weapon?.modes?.find(item => item.name === modeName) || weapon?.modes?.[0]
  if (!weapon || !mode) return { ok: false, message: 'Weapon mode unavailable.' }
  const attackerFrom = player.space
  if (weapon.class === 'melee' && Number(player.clashMeleeCooldownUntil || 0) > now) {
    return { ok: false, message: 'Melee weapon is cooling down.' }
  }
  if (weapon.class !== 'melee' && Number(weapon.ammoRemaining ?? 0) <= 0) return { ok: false, message: `${weapon.name} is out of ammo.` }
  let result = weaponDamage(weapon, mode, rng)
  if (result.attempts <= 0) return { ok: false, message: `${weapon.name} is out of ammo.` }
  if (weapon.class !== 'melee') {
    weapon.ammoRemaining = Math.max(0, Number(weapon.ammoRemaining ?? weapon.max_capacity ?? 0) - result.attempts)
  }
  const passiveTriggers = []
  if (target.passiveSkill?.name === 'Evasive Maneuver' && weapon.class !== 'sniper' && rng() < 0.2) {
    passiveTriggers.push({ name: target.passiveSkill.name, playerId: target.id, playerName: target.name })
    result = { ...result, hits: 0, damage: 0, dodged: true }
  }
  if (player.passiveSkill?.name === 'Lionheart' && player.health < 30 && result.damage > 0) {
    passiveTriggers.push({ name: player.passiveSkill.name, playerId: player.id, playerName: player.name })
    result = { ...result, damage: Math.ceil(result.damage * 1.1) }
  }
  if (weapon.class === 'melee' && player.clashSkillArmed === 'double-melee' && result.damage > 0) {
    result = { ...result, damage: result.damage * 2 }
    player.clashSkillArmed = null
    startClashSkillCooldown(player, now)
  }
  const powerStrike = weapon.class === 'melee' && player.clashSkillArmed === 'melee-stun'
  if (powerStrike) {
    player.clashSkillArmed = null
    startClashSkillCooldown(player, now)
  }
  const damage = applyClashDamage(state, target, result.damage, weapon.name, rng)
  if (target.passiveSkill?.name === 'Braveheart' && target.health < 30 && damage.before > damage.after) {
    passiveTriggers.push({ name: target.passiveSkill.name, playerId: target.id, playerName: target.name })
  }
  if (powerStrike && !target.eliminated) {
    const targetIndex = state.players.findIndex(item => item.id === target.id)
    const targetTurn = targetIndex > state.currentPlayerIndex ? state.turn : state.turn + 1
    target.clashStunnedThroughTurn = Math.max(target.clashStunnedThroughTurn || 0, targetTurn)
  }
  const kills = damage.eliminated
    ? [{ killerId: player.id, killerName: player.name, targetId: target.id, targetName: target.name, sourceName: weapon.name }]
    : []
  const weaponSpent = weapon.class !== 'melee' && weapon.ammoRemaining <= 0
  if (weaponSpent) player.clashInventory.weapons = player.clashInventory.weapons.filter(item => item !== weapon)
  const attackerTo = weapon.class === 'melee' ? clashMeleeDestination(attackerFrom, target.space) : null
  if (attackerTo != null) player.space = attackerTo
  if (weapon.class === 'melee') player.clashMeleeCooldownUntil = now + 30_000
  state.lastClashAction = { type: 'attack', playerId, targetId, weaponName: weapon.name, modeName: mode.name, weaponSpent, attackerFrom, attackerTo, kills, passiveTriggers, ...result, ...damage }
  addLog(state, `${player.name} attacked ${target.name} with ${weapon.name}: ${result.hits}/${result.attempts} hit for ${result.damage} damage.`)
  if (player.clashSkillArmed === 'adventurer-steps') player.clashSkillArmed = null
  if (!state.gameOver) advanceTurn(state)
  return { ok: true, player, target, weapon, mode, attackerFrom, attackerTo, kills, passiveTriggers, ...result, ...damage }
}

export function takeClashItem(state, playerId, itemIdValue, targetSpace = null) {
  if (state.gameOver || state.mode !== 'clash_with') return { ok: false, message: 'Clash is unavailable.' }
  const player = state.players[state.currentPlayerIndex]
  if (!player || player.id !== playerId) return { ok: false, message: 'It is not your turn.' }
  if (player.clashStunnedThroughTurn != null && state.turn <= player.clashStunnedThroughTurn) return { ok: false, message: 'You are stunned and cannot act.' }
  const item = player.clashInventory.items.find(entry => entry.id === itemIdValue)
  if (!item || item.count <= 0) return { ok: false, message: 'Item unavailable.' }
  const affected = []
  if (item.effect === 'heal') {
    if (player.health >= CLASH_MAX_HEALTH) return { ok: false, message: 'Health is already full.' }
    const before = player.health
    player.health = Math.min(CLASH_MAX_HEALTH, player.health + Number(item.heal_amount || 0))
    affected.push({ playerId: player.id, before, after: player.health, damage: 0, healed: player.health - before })
    addLog(state, `${player.name} used ${item.name} and healed to ${player.health} health.`)
  } else {
    const space = Number(targetSpace)
    if (![player.space, ...clashSpacesWithinChebyshev(player.space, 5)].includes(space)) return { ok: false, message: 'Target square is outside item range.' }
    if (item.effect === 'stun') {
      for (const target of clashAffectedPlayers(state, space, 1, player.id)) {
        const targetIndex = state.players.findIndex(entry => entry.id === target.id)
        const targetTurn = targetIndex > state.currentPlayerIndex ? state.turn : state.turn + 1
        target.clashStunnedThroughTurn = Math.max(target.clashStunnedThroughTurn || 0, targetTurn)
        affected.push({ playerId: target.id, before: target.health, after: target.health, stunnedThroughTurn: target.clashStunnedThroughTurn })
      }
    } else if (item.effect === 'damage_over_time') {
      const damagePerTurn = Number(item.damage_per_global_turn || 0)
      const throughTurn = state.turn + Number(item.duration_in_global_turns || 1)
      for (const target of clashAffectedPlayers(state, space, 1, player.id)) {
        target.clashDotEffects ||= []
        target.clashDotEffects.push({
          itemId: item.id,
          itemName: item.name,
          damagePerTurn,
          throughTurn,
          ownerId: player.id,
        })
        affected.push({ playerId: target.id, before: target.health, after: target.health, damageOverTime: damagePerTurn, throughTurn })
      }
    } else {
      const damageAmount = Number(item.damage_amount || 0)
      for (const target of clashAffectedPlayers(state, space, 1, player.id)) {
        const damage = applyClashDamage(state, target, damageAmount, item.name)
        affected.push({ playerId: target.id, before: damage.before, after: damage.after, damage: damageAmount, eliminated: damage.eliminated })
      }
    }
    addLog(state, `${player.name} used ${item.name} on square ${space}.`)
  }
  item.count--
  if (item.count <= 0) player.clashInventory.items = player.clashInventory.items.filter(entry => entry.id !== item.id)
  state.lastClashAction = { type: 'item', playerId, itemId: item.id, itemName: item.name, targetSpace, affected }
  if (player.clashSkillArmed === 'adventurer-steps') player.clashSkillArmed = null
  if (!state.gameOver) advanceTurn(state)
  const kills = affected
    .filter(entry => entry.eliminated)
    .map(entry => {
      const target = state.players.find(player => player.id === entry.playerId)
      return { killerId: player.id, killerName: player.name, targetId: entry.playerId, targetName: target?.name || 'Player', sourceName: item.name }
    })
  state.lastClashAction.kills = kills
  return { ok: true, player, item, affected, targetSpace, kills }
}

export function activateClashSkill(state, playerId, now = Date.now()) {
  if (state.gameOver || state.mode !== 'clash_with') return { ok: false, message: 'Clash skills are unavailable.' }
  const player = state.players[state.currentPlayerIndex]
  if (!player || player.id !== playerId) return { ok: false, message: 'Skill can only be used during your turn.' }
  if (player.eliminated || player.finished) return { ok: false, message: 'Eliminated players cannot use skills.' }
  if (player.clashStunnedThroughTurn != null && state.turn <= player.clashStunnedThroughTurn) return { ok: false, message: 'You are stunned and cannot use a skill.' }
  if (!player.specialSkill?.name) return { ok: false, message: 'This character has no active skill.' }
  if (player.skillCooldownUntil > now) return { ok: false, message: 'Skill is still cooling down.' }

  const skill = player.specialSkill.name
  if (skill === 'Girl Scout' && player.health >= CLASH_MAX_HEALTH) {
    return { ok: false, message: 'Health is already full.' }
  }
  let message = `${player.name} activated ${skill}.`
  let reveal = null
  if (skill === 'Dad Strength') {
    player.clashSkillArmed = 'double-melee'
    message = 'Dad Strength armed. Your next melee attack deals double damage.'
  } else if (skill === 'Girl Scout') {
    const before = player.health
    player.health = Math.min(CLASH_MAX_HEALTH, player.health + 30)
    message = `Girl Scout healed ${player.health - before} health.`
  } else if (skill === 'Survival Instinct') {
    const origin = clashSpaceToGrid(player.space)
    const targetIds = activePlayers(state)
      .filter(other => other.id !== player.id)
      .filter(other => {
        const target = clashSpaceToGrid(other.space)
        return Math.max(Math.abs(target.row - origin.row), Math.abs(target.column - origin.column)) <= 10
      })
      .map(other => other.id)
    reveal = { targetIds, duration: 3000 }
    message = targetIds.length ? 'Survival Instinct revealed nearby enemies.' : 'Survival Instinct found no nearby enemies.'
  } else if (skill === 'Power Strike') {
    player.clashSkillArmed = 'melee-stun'
    message = 'Power Strike armed. Your next melee attack stuns the target.'
  } else if (skill === 'Extra Steps') {
    player.clashMoveBoostThroughTurn = Math.max(player.clashMoveBoostThroughTurn || 0, state.turn + 1)
    message = 'Extra Steps active. Movement range is boosted through next global turn.'
  } else if (skill === "Adventurer's Spirit") {
    player.clashSkillArmed = 'adventurer-steps'
    message = "Adventurer's Spirit active. Your current movement can reach up to 12 spaces."
  } else {
    return { ok: false, message: 'This active skill is not available yet.' }
  }
  if (!player.clashSkillArmed) startClashSkillCooldown(player, now)
  player.clashSkillNotice = { message, turn: state.turn, at: now }
  addLog(state, `${player.name} activated ${skill}.`)
  return { ok: true, player, skill: player.specialSkill, message, reveal }
}

export function skipClashStunnedTurn(state) {
  if (state.gameOver || state.mode !== 'clash_with') return { ok: false, message: 'Clash is unavailable.' }
  const player = state.players[state.currentPlayerIndex]
  if (!player) return { ok: false, message: 'No active player.' }
  if (player.clashStunnedThroughTurn == null || state.turn > player.clashStunnedThroughTurn) return { ok: false, message: 'The active player is not stunned.' }
  addLog(state, `${player.name} is stunned and automatically skips this turn.`)
  advanceTurn(state)
  return { ok: true, player }
}

function resolveClashGlobalStatuses(state) {
  const affected = []
  for (const player of state.players) {
    if (player.clashStunnedThroughTurn != null && state.turn > player.clashStunnedThroughTurn) player.clashStunnedThroughTurn = null
    const effects = player.clashDotEffects || []
    if (!effects.length || player.eliminated || player.finished) {
      player.clashDotEffects = effects.filter(effect => state.turn <= effect.throughTurn)
      continue
    }
    const remaining = []
    for (const effect of effects) {
      if (state.turn > effect.throughTurn) continue
      const damage = applyClashDamage(state, player, Number(effect.damagePerTurn || 0), effect.itemName || 'damage over time')
      affected.push({ playerId: player.id, itemName: effect.itemName, before: damage.before, after: damage.after, damage: Number(effect.damagePerTurn || 0), eliminated: damage.eliminated })
      if (state.turn < effect.throughTurn && !player.eliminated && !player.finished) remaining.push(effect)
    }
    player.clashDotEffects = remaining
  }
  if (affected.length) {
    state.lastClashDot = { turn: state.turn, affected }
    addLog(state, `${affected.length} player(s) suffered ongoing Clash damage.`)
  }
  return affected
}

function normalizeClashCurrentPlayer(state) {
  if (state.gameOver || state.mode !== 'clash_with') return
  const current = state.players[state.currentPlayerIndex]
  if (current && !current.finished && !current.eliminated) return
  const nextIndex = state.players.findIndex(player => !player.finished && !player.eliminated)
  if (nextIndex >= 0) state.currentPlayerIndex = nextIndex
}

export function moveClashGhost(state, playerId, destination) {
  if (state.gameOver || state.mode !== 'clash_with') return { ok: false, message: 'Ghost movement unavailable.' }
  const player = state.players.find(item => item.id === playerId && item.eliminated)
  if (!player) return { ok: false, message: 'Only eliminated Clash players can move as ghosts.' }
  const targetSpace = Number(destination)
  if (!clashGhostMoveOptions(player).includes(targetSpace)) return { ok: false, message: 'Ghosts can only drift one square per move.' }
  const from = player.space
  player.space = targetSpace
  return { ok: true, player, from, to: targetSpace }
}

export function initializeEscapeState(state, rng = Math.random) {
  const blocked = ladderSpaces(state.board)
  const candidates = Array.from({ length: 99 }, (_, index) => index + 1).filter(space => !blocked.has(space))
  const keySpaces = shuffled(candidates, rng).slice(0, state.board.keys_count || 3)
  state.keys = keySpaces.map((space, index) => ({ id: `key-${index + 1}`, space, holderId: null }))
  const outsideKeys = candidates.filter(space => keySpaces.every(keySpace => Math.abs(space - keySpace) > 3))
  const playerSpaces = shuffled(outsideKeys, rng).slice(0, state.players.length)
  state.players.forEach((player, index) => {
    player.space = playerSpaces[index]
  })
  const occupied = new Set(playerSpaces)
  const entitySpaces = []
  for (const space of shuffled(outsideKeys, rng)) {
    if (occupied.has(space) || entitySpaces.some(other => Math.abs(other - space) <= 5)) continue
    entitySpaces.push(space)
    if (entitySpaces.length === 5) break
  }
  state.entities = entitySpaces.map((space, index) => ({ id: `entity-${index + 1}`, space }))
  state.medkits = []
  state.lightSources = []
  state.nextMedkitSpawnTurn = 2
  state.nextLightSourceSpawnTurn = 2
  state.lastEscapePickupSpawn = null
  state.exitRevealed = false
  state.exitUnlocked = false
  state.exitUnlockPending = false
  state.exitSequencePending = false
  state.escapeOutcome = null
  state.nextEntityRelocationTurn = 3
  state.lastEscapeEncounter = null
  const keyName = state.board.key_name || state.board.keys_name || 'Keys'
  state.log = [`Find every ${keyName.toLowerCase()}, unlock square 100, and escape together.`]
  state.lastEvent = state.log[0]
}

export function isEscapeWeaponProtecting(player, turn) {
  return player.weaponProtectFromTurn != null
    && turn >= player.weaponProtectFromTurn
    && turn <= player.weaponProtectThroughTurn
}

function beginWeaponCooldown(player, now = Date.now()) {
  player.weaponCooldownUntil = now + WEAPON_COOLDOWN_MS + player.weaponPendingPenaltyMs
  player.weaponPendingPenaltyMs = 0
  player.weaponProtectFromTurn = null
  player.weaponProtectThroughTurn = null
}

export function armEscapeWeapon(state, player = state.players[state.currentPlayerIndex], now = Date.now(), rng = Math.random) {
  if (state.mode !== 'escape_from' || !player || player.finished || player.eliminated) return { ok: false, message: 'Weapon unavailable.' }
  if (player.weaponProtectFromTurn != null) return { ok: false, message: 'Weapon is already scheduled or active.' }
  if (player.weaponCooldownUntil > now) return { ok: false, message: 'Weapon is still cooling down.' }
  const fighterSpirit = player.passiveSkill?.name === 'Fighter Spirit' && rng() < 0.3
  player.weaponProtectFromTurn = state.turn + 1
  player.weaponProtectThroughTurn = state.turn + (fighterSpirit ? 4 : 2)
  addLog(state, `${player.name} armed their ${state.board.default_weapon?.name || 'weapon'} for the next ${fighterSpirit ? 'four' : 'two'} global turns.`)
  advanceTurn(state, now)
  return {
    ok: true,
    player,
    passiveTrigger: fighterSpirit ? {
      name: player.passiveSkill.name,
      playerId: player.id,
      playerName: player.name,
    } : null,
  }
}

function relocateEntity(state, entity, rng = Math.random) {
  const blocked = ladderSpaces(state.board)
  const keySpaces = state.keys.map(key => key.space).filter(Boolean)
  const playerSpaces = new Set(activePlayers(state).map(player => player.space))
  const pickupSpaces = new Set([
    ...(state.medkits || []).map(item => item.space),
    ...(state.lightSources || []).map(item => item.space),
  ])
  const otherEntities = state.entities.filter(item => item.id !== entity.id)
  const candidates = Array.from({ length: 99 }, (_, index) => index + 1).filter(space =>
    !blocked.has(space)
    && !playerSpaces.has(space)
    && !pickupSpaces.has(space)
    && keySpaces.every(keySpace => Math.abs(space - keySpace) > 3)
    && otherEntities.every(other => Math.abs(space - other.space) > 5))
  if (candidates.length) entity.space = randomChoice(candidates, rng)
}

export function relocateEscapeEntities(state, rng = Math.random) {
  for (const entity of state.entities || []) relocateEntity(state, entity, rng)
}

function escapePickupCandidates(state) {
  const blocked = ladderSpaces(state.board)
  for (const player of state.players) blocked.add(player.space)
  for (const key of state.keys || []) if (key.space != null) blocked.add(key.space)
  for (const entity of state.entities || []) blocked.add(entity.space)
  for (const medkit of state.medkits || []) blocked.add(medkit.space)
  for (const light of state.lightSources || []) blocked.add(light.space)
  blocked.add(100)
  return Array.from({ length: 99 }, (_, index) => index + 1).filter(space => !blocked.has(space))
}

export function spawnEscapePickups(state, rng = Math.random) {
  if (state.mode !== 'escape_from' || state.gameOver) return null
  const medkitEligible = state.turn >= state.nextMedkitSpawnTurn
  const lightEligible = state.turn >= state.nextLightSourceSpawnTurn
  const medkitSucceeded = medkitEligible && rng() < 0.5
  const lightSucceeded = lightEligible && rng() < 0.5
  if (!medkitSucceeded && !lightSucceeded) return null

  const type = medkitSucceeded && lightSucceeded
    ? (rng() < 0.5 ? 'medkit' : 'light_sources')
    : medkitSucceeded ? 'medkit' : 'light_sources'
  const needed = type === 'medkit' ? 1 : 2
  const candidates = shuffled(escapePickupCandidates(state), rng)
  if (candidates.length < needed) return null
  const spaces = candidates.slice(0, needed)

  if (type === 'medkit') {
    const existing = state.medkits[0]
    state.medkits = [{ id: existing?.id || `medkit-${state.turn}`, space: spaces[0] }]
    state.nextMedkitSpawnTurn = state.turn + 4
  } else {
    state.lightSources = spaces.map((space, index) => ({
      id: state.lightSources[index]?.id || `light-${state.turn}-${index + 1}`,
      space,
    }))
    state.nextLightSourceSpawnTurn = state.turn + 3
  }
  state.lastEscapePickupSpawn = { type, spaces, turn: state.turn }
  return state.lastEscapePickupSpawn
}

function refreshEscapeExit(state) {
  const allHeld = state.keys.every(key => key.holderId)
  if (!state.exitUnlocked) state.exitRevealed = allHeld
  if (allHeld) {
    const holders = [...new Set(state.keys.map(key => key.holderId))]
    if (!state.exitUnlocked && holders.every(id => state.players.find(player => player.id === id)?.space === 100)) {
      state.exitUnlocked = true
      state.exitRevealed = true
      state.exitUnlockPending = true
      addLog(state, 'Square 100 has been unlocked!')
    }
  }
  if (state.exitUnlocked) {
    const living = activePlayers(state)
    if (living.length && living.every(player => player.space === 100)) {
      state.exitSequencePending = true
    }
  }
}

export function completeEscape(state) {
  if (state.mode !== 'escape_from' || state.gameOver || !state.exitSequencePending) return false
  const living = activePlayers(state)
  living.forEach(player => {
    player.won = true
    player.finished = true
  })
  state.winner = { name: 'The team' }
  state.gameOver = true
  state.escapeOutcome = 'won'
  state.exitSequencePending = false
  addLog(state, `Every surviving player escaped the ${state.board.name}!`)
  return true
}

export function visualAdjacentSpaces(space) {
  const rowStart = Math.floor((space - 1) / 10) * 10 + 1
  const rowEnd = Math.min(99, rowStart + 9)
  return [space - 1, space + 1].filter(candidate => candidate >= rowStart && candidate <= rowEnd && candidate !== 100)
}

export function minePushDestination(landedSpace, distance) {
  const rowIndex = Math.floor((landedSpace - 1) / 10)
  const rowStart = rowIndex * 10 + 1
  return {
    destination: Math.max(rowStart, landedSpace - Math.max(0, distance)),
    edge: rowIndex % 2 === 0 ? 'left' : 'right',
  }
}

export function mineForwardDestination(landedSpace, distance) {
  const rowIndex = Math.floor((landedSpace - 1) / 10)
  const rowEnd = Math.min(100, rowIndex * 10 + 10)
  return {
    destination: Math.min(rowEnd, landedSpace + Math.max(0, distance)),
    edge: rowIndex % 2 === 0 ? 'right' : 'left',
  }
}

function movementPath(from, intended, exactBounce = false) {
  if (from === intended && !exactBounce) return []
  if (exactBounce) {
    return [
      ...Array.from({ length: Math.max(0, 100 - from) }, (_, index) => from + index + 1),
      ...Array.from({ length: Math.max(0, 100 - intended) }, (_, index) => 99 - index),
    ]
  }
  return Array.from(
    { length: Math.abs(intended - from) },
    (_, index) => from + Math.sign(intended - from) * (index + 1),
  )
}

function hiddenMineIndexAt(state, space) {
  return state.hiddenMines.findIndex(mine => mine.space === space)
}

function triggerHiddenMine(state, player, {
  landedSpace = player.space,
  pushOrigin = landedSpace,
  maxBackwardDistance = 4,
  applyQuestionAfterPush = true,
  duringMove = false,
  ladder = null,
} = {}) {
  const mineIndex = hiddenMineIndexAt(state, landedSpace)
  if (mineIndex < 0 || player.eliminated || player.finished) return null
  const mine = state.hiddenMines.splice(mineIndex, 1)[0]
  const selfTriggered = mine.ownerId === player.id
  const distance = randomInteger(1, selfTriggered ? 2 : maxBackwardDistance)
  const push = selfTriggered
    ? mineForwardDestination(landedSpace, distance)
    : ladder
      ? { destination: pushOrigin, edge: minePushDestination(pushOrigin, 1).edge }
      : minePushDestination(pushOrigin, distance)
  player.space = push.destination
  state.lastMineExplosion = {
    ownerId: mine.ownerId,
    playerId: player.id,
    landedSpace,
    pushOrigin,
    destination: player.space,
    distance,
    direction: selfTriggered ? 'forward' : 'backward',
    selfTriggered,
    duringMove,
    ladder: ladder ? { ...ladder } : null,
    edge: push.edge,
  }
  addLog(state, selfTriggered
    ? `${player.name} triggered their own hidden mine and was blasted forward to space ${player.space}.`
    : `${player.name} landed on a hidden mine and was blown back to space ${player.space}.`)
  if (!selfTriggered && applyQuestionAfterPush && state.board.question_marks.includes(player.space)) {
    const precedingChain = [...state.lastQuestionChain]
    const mineResolution = { kind: 'mine', ...state.lastMineExplosion, destination: player.space }
    resolveLanding(state, player)
    state.lastQuestionChain = [...precedingChain, mineResolution, ...state.lastQuestionChain]
  }
  return state.lastMineExplosion
}

function dropEscapeKeys(state, player, rng = Math.random) {
  const held = [...player.heldKeys]
  held.forEach((keyId, index) => {
    const key = state.keys.find(item => item.id === keyId)
    if (!key) return
    key.holderId = null
    key.space = index === 0 ? player.space : randomChoice(visualAdjacentSpaces(player.space), rng) || player.space
  })
  player.heldKeys = []
  if (!state.exitUnlocked) state.exitRevealed = false
}

function concludeEscapeIfNeeded(state) {
  if (state.gameOver) return
  const living = activePlayers(state)
  if (!living.length || (living.length === 1 && !state.exitUnlocked)) {
    state.gameOver = true
    state.escapeOutcome = 'lost'
    state.winner = null
    addLog(state, living.length ? 'Only one player remains and the exit is still locked. The team loses.' : 'No players survived the mansion.')
  }
}

function collectEscapeKeys(state, player) {
  const collected = []
  for (const key of state.keys.filter(item => !item.holderId && item.space === player.space)) {
    if (player.heldKeys.length >= 2) break
    key.holderId = player.id
    key.space = null
    player.heldKeys.push(key.id)
    collected.push(key.id)
    addLog(state, `${player.name} collected a key (${player.heldKeys.length}/2 held).`)
  }
  return collected
}

function collectEscapePickups(state, player) {
  const collected = []
  const medkitIndex = state.medkits.findIndex(item => item.space === player.space)
  if (medkitIndex >= 0) {
    state.medkits.splice(medkitIndex, 1)
    player.health = Math.min(state.board.max_player_lives || 5, player.health + 1)
    collected.push('medkit')
  }
  const lightIndex = state.lightSources.findIndex(item => item.space === player.space)
  if (lightIndex >= 0) {
    state.lightSources.splice(lightIndex, 1)
    player.visionBoostThroughTurn = Math.max(player.visionBoostThroughTurn || 0, state.turn + 2)
    collected.push('light_source')
  }
  return collected
}

function resolveEscapeLanding(state, player, rng = Math.random, now = Date.now(), { skipLadder = false, previousSpace = player.space } = {}) {
  const ladder = skipLadder ? null : state.board.ladders.find(item => item.from === player.space)
  if (ladder) {
    player.space = ladder.to
    addLog(state, `${player.name} used a ladder from ${ladder.from} to ${ladder.to}.`)
  }
  const collectedKeys = collectEscapeKeys(state, player)
  const collectedPickups = collectEscapePickups(state, player)
  const entity = state.entities.find(item => item.space === player.space)
  let encounter = null
  let passiveTrigger = null
  let passiveMovement = null
  if (entity) {
    let passiveDefended = false
    if (player.passiveSkill?.name === 'Fight or Flight' && rng() < 0.15) {
      const retreat = rng() < 0.5
      passiveTrigger = {
        name: player.passiveSkill.name,
        playerId: player.id,
        playerName: player.name,
        effect: retreat ? 'retreat' : 'defend',
      }
      if (retreat) {
        const entitySpace = player.space
        player.space = ladder?.from ?? previousSpace
        passiveMovement = { from: entitySpace, to: player.space }
        addLog(state, `${player.name}'s Fight or Flight moved them back to space ${player.space}.`)
      } else {
        passiveDefended = true
        addLog(state, `${player.name}'s Fight or Flight defended the entity attack.`)
      }
    }
    if (passiveMovement) {
      refreshEscapeExit(state)
      concludeEscapeIfNeeded(state)
      state.lastEscapeEncounter = null
      return { ladder, encounter: null, passiveTrigger, passiveMovement, collectedKeys, collectedPickups }
    }
    const weaponPrevented = !passiveDefended && isEscapeWeaponProtecting(player, state.turn)
    const prevented = weaponPrevented || passiveDefended
    encounter = {
      entityId: entity.id,
      playerId: player.id,
      playerName: player.name,
      space: player.space,
      prevented,
      healthBefore: player.health,
      healthAfter: prevented ? player.health : Math.max(0, player.health - 1),
      passiveDefended,
    }
    if (prevented) {
      if (weaponPrevented) beginWeaponCooldown(player, now)
      relocateEntity(state, entity, rng)
      if (weaponPrevented) addLog(state, `${player.name}'s Crucifix prevented an entity attack.`)
    } else {
      player.health = Math.max(0, player.health - 1)
      addLog(state, `${player.name} was attacked and has ${player.health} health remaining.`)
      if (player.health === 0) {
        dropEscapeKeys(state, player, rng)
        player.eliminated = true
        player.finished = true
        addLog(state, `${player.name} was eliminated and is now spectating.`)
      }
      relocateEntity(state, entity, rng)
    }
  }
  refreshEscapeExit(state)
  concludeEscapeIfNeeded(state)
  state.lastEscapeEncounter = encounter
  return { ladder, encounter, passiveTrigger, passiveMovement, collectedKeys, collectedPickups }
}

export function takeEscapeTurn(state, roll, direction, rng = Math.random, now = Date.now()) {
  if (state.mode !== 'escape_from' || state.gameOver) return null
  const player = state.players[state.currentPlayerIndex]
  const from = player.space
  const signedRoll = direction === 'backward' ? -Math.abs(roll) : Math.abs(roll)
  const maximum = state.exitRevealed ? 100 : 99
  const intendedLanding = Math.max(1, Math.min(maximum, player.space + signedRoll))
  const step = Math.sign(intendedLanding - from)
  let rollLanding = intendedLanding
  let interruptedByEntity = false
  let movementPassive = null
  for (let space = from + step; step && (step > 0 ? space <= intendedLanding : space >= intendedLanding); space += step) {
    if (!state.entities.some(entity => entity.space === space)) continue
    const isFinalSpace = space === intendedLanding
    if (!isFinalSpace && player.passiveSkill?.name === 'Optimistic Mind' && rng() < 0.15) {
      movementPassive = {
        name: player.passiveSkill.name,
        playerId: player.id,
        playerName: player.name,
        effect: 'continue',
        space,
      }
      addLog(state, `${player.name}'s Optimistic Mind ignored the entity on space ${space}.`)
      continue
    }
    rollLanding = space
    interruptedByEntity = true
    break
  }
  player.space = rollLanding
  state.lastRoll = roll
  const movedSpaces = Math.abs(rollLanding - from)
  addLog(state, interruptedByEntity
    ? `${player.name} encountered an entity while moving and stopped on space ${rollLanding}.`
    : `${player.name} moved ${direction} ${movedSpaces} space(s) to ${player.space}.`)
  const previousSpace = rollLanding === from ? from : rollLanding - step
  const resolution = resolveEscapeLanding(state, player, rng, now, { skipLadder: interruptedByEntity, previousSpace })
  let completionPassive = null
  if (!state.gameOver && !player.eliminated && player.passiveSkill?.name === 'Concentrate' && rng() < 0.15) {
    completionPassive = {
      name: player.passiveSkill.name,
      playerId: player.id,
      playerName: player.name,
      effect: 'reveal_entities',
    }
    addLog(state, `${player.name}'s Concentrate revealed every entity.`)
  }
  if (!state.gameOver) advanceTurn(state, now)
  return {
    player,
    from,
    intendedLanding,
    rollLanding,
    destination: player.space,
    signedRoll,
    interruptedByEntity,
    movementPassive,
    completionPassive,
    ...resolution,
  }
}

export function skipEscapeTurn(state, now = Date.now()) {
  if (state.mode !== 'escape_from' || state.gameOver) return
  const player = state.players[state.currentPlayerIndex]
  addLog(state, `${player.name} did not complete their roll and stayed on square ${player.space}.`)
  advanceTurn(state, now)
}

export function canSkipEscapeMove(state, player = state?.players?.[state.currentPlayerIndex]) {
  return Boolean(
    state?.mode === 'escape_from'
    && state.exitRevealed
    && state.keys?.every(key => key.holderId)
    && player
    && !player.eliminated
    && !player.finished
    && player.space === 100
  )
}

export function escapeAiTarget(state, player) {
  if (state.keys.every(key => key.holderId)) return 100
  if (player.heldKeys.length >= 2) return 99
  const available = state.keys.filter(key => !key.holderId && key.space != null)
  return available.sort((a, b) => Math.abs(a.space - player.space) - Math.abs(b.space - player.space))[0]?.space ?? 99
}

export function chooseEscapeAiDirection(state, player, roll) {
  const target = escapeAiTarget(state, player)
  const maximum = state.exitRevealed ? 100 : 99
  const landing = direction => {
    const signed = direction === 'backward' ? -roll : roll
    let space = Math.max(1, Math.min(maximum, player.space + signed))
    const ladder = state.board.ladders.find(item => item.from === space)
    if (ladder) space = ladder.to
    return space
  }
  const forwardDistance = Math.abs(target - landing('forward'))
  const backwardDistance = Math.abs(target - landing('backward'))
  return backwardDistance < forwardDistance ? 'backward' : 'forward'
}

function addLog(state, message) {
  state.lastEvent = message
  state.log.unshift(message)
  state.log = state.log.slice(0, 8)
}

function activePlayers(state) {
  return state.players.filter(player => !player.finished && !player.eliminated)
}

export function planRunAwayDestruction(state, fallbackAmount = randomInteger(4, 7)) {
  if (state.mode !== 'run_away' || state.gameOver) return []

  const lastDestroyed = state.destroyedSpaces.at(-1) || 0
  const closestPlayer = activePlayers(state)
    .filter(player => !player.forfeited && player.space > lastDestroyed)
    .sort((a, b) => a.space - b.space)[0]
  const distance = closestPlayer ? closestPlayer.space - lastDestroyed : 0
  const finalSquare = distance >= 15
    ? Math.min(99, closestPlayer.space - 5)
    : Math.min(99, lastDestroyed + fallbackAmount)

  const spaces = []
  for (let square = lastDestroyed + 1; square <= finalSquare; square++) {
    if (!state.destroyedSpaces.includes(square)) spaces.push(square)
  }
  return spaces
}

export function describeRunAwayRoll(playerName, startSpace, result) {
  if (result < 0 && startSpace === 1) {
    const message = `${playerName} stays on Square 1`
    return {
      resultLabel: message,
      movement: {
        spaces: 0,
        signedSpaces: 0,
        direction: 'stay',
        message,
      },
    }
  }

  return {
    resultLabel: result > 0
      ? `Move ${result} space${result === 1 ? '' : 's'} forward`
      : result < 0
        ? `Move ${Math.abs(result)} spaces backward`
        : 'Stay on this square',
    movement: {
      spaces: Math.abs(result),
      signedSpaces: result,
      direction: result > 0 ? 'forward' : result < 0 ? 'backward' : 'stay',
    },
  }
}

function concludeIfOneRemains(state) {
  const remaining = activePlayers(state)
  if (remaining.length === 0) {
    state.winner = null
    state.loser = null
    state.players.forEach(player => {
      player.won = false
    })
    state.gameOver = true
    addLog(state, 'Every player was eliminated by the destruction. Nobody wins.')
    return
  }
  if (remaining.length !== 1) return

  const survivor = remaining[0]
  const eliminatedCount = state.players.filter(player => player.eliminated).length
  const forfeitedCount = state.players.filter(player => player.forfeited).length
  const allOthersEliminated = eliminatedCount === state.players.length - 1
  const allOthersFinished = state.winners.length === state.players.length - 1
  const allOthersForfeited = forfeitedCount === state.players.length - 1

  if (state.mode === 'run_away' && allOthersEliminated) {
    survivor.won = true
    state.winner = survivor
    state.gameOver = true
    addLog(state, `${survivor.name} is the last player standing and wins the game!`)
  } else if (allOthersFinished || allOthersForfeited) {
    state.loser = survivor
    state.gameOver = true
    addLog(state, `${survivor.name} is the last player left and loses the game.`)
  }
}

function eliminatePlayer(state, player, message) {
  if (player.finished || player.eliminated) return false
  player.eliminated = true
  player.finished = true
  player.rank = null
  addLog(state, message || `${player.name} was eliminated and is now spectating.`)
  concludeIfOneRemains(state)
  return true
}

function movePlayer(state, player, destination, allowExactBounce = false) {
  const from = player.space
  const exactBounce = allowExactBounce
    && state.exactMoveFor100
    && ['standard', 'run_away'].includes(state.mode)
    && destination > 100
  const intended = exactBounce
    ? Math.max(1, 100 - (destination - 100))
    : Math.max(1, Math.min(100, destination))
  const path = movementPath(from, intended, exactBounce)
  if (state.mode === 'run_away' && intended !== from) {
    for (const square of path) {
      if (state.destroyedSpaces.includes(square)) {
        player.space = square
        eliminatePlayer(state, player, `${player.name} traversed destroyed square ${square} and is now spectating.`)
        state.lastTraversalElimination = { playerId: player.id, playerName: player.name, from, intended, space: square }
        return square
      }
    }
  }
  if (!player.eliminated && !player.finished && path.length > 1) {
    for (const square of path.slice(0, -1)) {
      if (hiddenMineIndexAt(state, square) >= 0) {
        player.space = square
        triggerHiddenMine(state, player, {
          landedSpace: square,
          maxBackwardDistance: 2,
          applyQuestionAfterPush: false,
          duringMove: true,
        })
        return player.space
      }
    }
  }
  player.space = intended
  if (exactBounce) {
    state.lastExactBounce = {
      playerId: player.id,
      from,
      destination: intended,
      extra: destination - 100,
    }
  }
  return intended
}

function triggerExplosion(state) {
  state.lastExplosion = null
  if (state.mode !== 'run_away' || state.gameOver) return
  // `state.turn` advances when the final active player finishes a round.
  // Destruction scheduled for Turn N therefore starts only after Turn N has
  // fully completed, when the HUD is ready to advance to Turn N + 1.
  const completedTurn = state.turn - 1
  if (completedTurn < state.nextExplosionTurn) return

  state.lastExplosion = { spaces: planRunAwayDestruction(state) }
  state.nextExplosionTurn = completedTurn + randomInteger(3, 5)
}

export function destroySpace(state, space) {
  if (state.mode !== 'run_away' || space < 1 || space > 99 || state.destroyedSpaces.includes(space)) {
    return { space, players: [] }
  }
  state.destroyedSpaces.push(space)
  state.destroyedSpaces.sort((a, b) => a - b)
  addLog(state, `Square ${space} was destroyed.`)
  const caught = activePlayers(state).filter(player => player.space === space)
  for (const player of caught) {
    eliminatePlayer(state, player, `${player.name} was caught in the destruction on square ${space} and is now spectating.`)
  }
  if (!state.gameOver && (state.players[state.currentPlayerIndex].finished || state.players[state.currentPlayerIndex].eliminated)) {
    advanceTurn(state)
  }
  return { space, players: caught }
}

export function applyDestroyedSquareEffect(state, effect) {
  const count = Math.max(0, Number(effect?.spaces) || 0)
  const result = { added: [], removed: [], players: [] }
  if (state.mode !== 'run_away' || !count) return result

  if (effect.effect === 'decrease_destroyed_square') {
    for (let index = 0; index < count && state.destroyedSpaces.length; index += 1) {
      result.removed.push(state.destroyedSpaces.pop())
    }
    return result
  }

  if (effect.effect === 'increase_destroyed_square') {
    let nextSpace = (state.destroyedSpaces.at(-1) || 0) + 1
    while (result.added.length < count && nextSpace <= 99) {
      const destroyed = destroySpace(state, nextSpace)
      if (state.destroyedSpaces.includes(nextSpace)) result.added.push(nextSpace)
      result.players.push(...destroyed.players)
      nextSpace += 1
    }
  }
  return result
}

function chooseWhat(state, space) {
  const whats = state.board.whats
  if (!whats.length) return null
  const history = state.questionHistory[space] || []
  if (!state.questionHistory[space]) state.questionHistory[space] = history
  let eligible = whats
    .map((what, index) => ({ what, index }))
    .filter(({ what }) => {
      const start = what.spawn_locations?.start ?? 1
      const end = what.spawn_locations?.end ?? 100
      return space >= start && space <= end
    })
    .map(({ index }) => index)
  if (!eligible.length) return null

  let candidates = eligible.filter(index => !history.includes(index))

  if (!candidates.length) {
    const previous = history.at(-1)
    candidates = eligible.filter(index => index !== previous)
    if (!candidates.length) candidates = [eligible[0]]
    state.questionHistory[space] = []
  }

  const chosenIndex = candidates[Math.floor(Math.random() * candidates.length)]
  state.questionHistory[space].push(chosenIndex)
  return whats[chosenIndex]
}

export function applyWhatEffects(state, player, what, now = Date.now()) {
  const steps = []
  for (const effect of what.effects || []) {
    const from = player.space
    const previousExactBounce = state.lastExactBounce
    let exactBounce = null
    if (effect.effect === 'move_back') movePlayer(state, player, player.space - (effect.spaces || 0))
    else if (effect.effect === 'move_forward') {
      state.lastExactBounce = null
      movePlayer(state, player, player.space + (effect.spaces || 0), true)
      exactBounce = state.lastExactBounce
      state.lastExactBounce = previousExactBounce
    }
    else if (effect.effect === 'lose_turn') {
      player.skipTurns += effect.turns || 1
      player.skipReason = what.name
    }
    else if (effect.effect === 'lose_skill') player.skillBlockedTurns = Math.max(player.skillBlockedTurns, effect.spaces || effect.turns || 1)
    else if (effect.effect === 'activate_skill' && player.skillCooldownUntil > now) player.skillRefreshPending = true
    else if (effect.effect === 'delay_skill_cooldown') {
      player.delayedSkillCooldownStartTurn = state.turn + (effect.turns || 2)
      player.skillCooldownUntil = 0
    }

    steps.push({
      definition: { ...effect },
      from,
      destination: player.space,
      exactBounce,
    })
    if (player.eliminated) break
  }
  return steps
}

function affectedDescription(description, playerName) {
  return description
    .replace(/\byour\b/gi, `${playerName}'s`)
    .replace(/\byou\b/gi, playerName)
}

function finishPlayer(state, player) {
  if (player.finished) return
  player.space = 100
  player.finished = true
  player.rank = state.winners.length + 1
  state.winners.push(player)
  addLog(state, `${player.name} reached 100 and finished #${player.rank}!`)

  concludeIfOneRemains(state)
}

function resolveLanding(state, player) {
  state.lastWhat = null
  state.lastQuestionChain = []
  let chainCount = 0

  while (state.board.question_marks.includes(player.space) && chainCount < 10) {
    const questionSpace = player.space
    let returnedByExactBounce = false
    if (player.skillArmed === 'ignore-question') {
      player.skillArmed = null
      addLog(state, `${player.name}'s Nope skill cancelled the question mark on space ${questionSpace}.`)
      break
    } else if (player.skillArmed === 'reroll-question') {
      player.skillArmed = null
      player.rerollPending = true
      state.lastQuestionChain.push({
        kind: 'reroll_pending',
        space: questionSpace,
        destination: questionSpace,
      })
      addLog(state, `${player.name}'s Rage Reroll is ready on space ${questionSpace}.`)
    } else {
      const what = chooseWhat(state, questionSpace)
      if (what) {
        state.lastWhat = { ...what, space: questionSpace }
        const effects = applyWhatEffects(state, player, what)
        returnedByExactBounce = effects.some(step => step.exactBounce && step.destination === questionSpace)
        state.lastQuestionChain.push({
          kind: 'what',
          space: questionSpace,
          destination: player.space,
          what: { ...what },
          effects,
        })
        const descriptions = what.effects.map(effect => affectedDescription(effect.description, player.name)).join(' ')
        addLog(state, `${player.name} found ${what.name} on space ${questionSpace}. ${descriptions}`)
      }
    }
    chainCount++
    if (player.eliminated) break
    if (player.space === questionSpace && !returnedByExactBounce) break
  }

  if (!player.eliminated && !player.rerollPending) {
    triggerHiddenMine(state, player, { landedSpace: player.space })
  }
  const ladder = !player.eliminated
    && !player.rerollPending
    && !state.lastMineExplosion
    && state.board.ladders.find(item => item.from === player.space)
  if (ladder) {
    const start = player.space
    player.space = ladder.to
    addLog(state, `${player.name} climbed a ladder from ${start} to ${ladder.to}!`)
    triggerHiddenMine(state, player, {
      landedSpace: ladder.to,
      pushOrigin: ladder.from,
      applyQuestionAfterPush: false,
      ladder,
    })
  }
  if (player.space >= 100) finishPlayer(state, player)
}

export function hiddenMineOptions(state, player = state.players[state.currentPlayerIndex]) {
  if (!player) return []
  const blocked = new Set(state.board.question_marks)
  const ladderEndpoints = ladderSpaces(state.board)
  for (const occupant of state.players) {
    if (!occupant.finished && !occupant.eliminated) blocked.add(occupant.space)
  }
  return Array.from({ length: 98 }, (_, index) => index + 2)
    .filter(space => (ladderEndpoints.has(space) || (space % 10 !== 0 && space % 10 !== 1)) && !blocked.has(space))
}

function advanceTurn(state, now = Date.now()) {
  if (state.gameOver) return
  const previousTurn = state.turn
  let nextIndex = state.currentPlayerIndex
  do {
    nextIndex = (nextIndex + 1) % state.players.length
    if (nextIndex === 0) state.turn++
  } while (state.players[nextIndex].finished || state.players[nextIndex].eliminated)
  state.currentPlayerIndex = nextIndex
  if (state.mode === 'escape_from' && state.turn !== previousTurn) {
    for (const player of state.players) {
      if (player.weaponProtectThroughTurn != null && state.turn > player.weaponProtectThroughTurn) {
        beginWeaponCooldown(player, now)
      }
    }
    if (state.turn >= state.nextEntityRelocationTurn) {
      relocateEscapeEntities(state)
      state.nextEntityRelocationTurn = state.turn + 2
      addLog(state, 'The entities shifted to new locations.')
    }
    for (const player of state.players) {
      if (player.visionBoostThroughTurn != null && state.turn > player.visionBoostThroughTurn) {
        player.visionBoostThroughTurn = null
      }
    }
    spawnEscapePickups(state)
  }
  if (state.mode === 'clash_with' && state.turn !== previousTurn) {
    resolveClashGlobalStatuses(state)
    if (state.gameOver) return
    normalizeClashCurrentPlayer(state)
    for (const player of state.players) {
      if (player.clashMoveBoostThroughTurn != null && state.turn > player.clashMoveBoostThroughTurn) player.clashMoveBoostThroughTurn = null
    }
    if (state.turn >= state.nextClashDropTurn) {
      state.clashDrops = []
      for (const player of state.players) player.clashPendingPickup = null
      spawnClashDrops(state, clashSupplyDropCounts(state))
      state.nextClashDropTurn = state.turn + 4
    }
    const livingClashPlayers = activePlayers(state)
    state.clashRivalRevealTurn = livingClashPlayers.length === 2 && state.turn % 2 === 0 ? state.turn : null
  }
  if (state.turn !== previousTurn) {
    for (const player of state.players) {
      if (player.delayedSkillCooldownStartTurn != null && state.turn >= player.delayedSkillCooldownStartTurn) {
        player.delayedSkillCooldownStartTurn = null
        player.skillCooldownUntil = now + SKILL_COOLDOWN_MS
        addLog(state, `${player.name}'s weakened Parkour cooldown has started.`)
      }
    }
  }
  const nextPlayer = state.players[nextIndex]
  if (nextPlayer.skillRefreshPending) {
    nextPlayer.skillCooldownUntil = 0
    nextPlayer.skillRefreshPending = false
    addLog(state, `${nextPlayer.name}'s Water Well refresh is ready. Their skill cooldown was removed.`)
  }
}

export function endTurnAfterSkill(state) {
  if (!state.gameOver) advanceTurn(state)
  triggerExplosion(state)
}

export function takeGuessWhatTurn(state, forcedRoll) {
  if (state.gameOver || state.mode !== 'guess_what') return null
  const player = state.players[state.currentPlayerIndex]
  const requestedRoll = Number(forcedRoll)
  const roll = Number.isInteger(requestedRoll) && requestedRoll >= 1 && requestedRoll <= 6
    ? requestedRoll
    : randomInteger(1, 6)
  const from = player.space
  state.lastRoll = roll
  state.lastWhat = null
  state.lastQuestionChain = []
  state.lastExactBounce = null
  movePlayer(state, player, from + roll, true)
  if (player.space >= 100) finishPlayer(state, player)
  const needsQuestion = !player.finished && state.board.question_marks.includes(player.space)
  addLog(state, `${player.name} rolled ${roll} and moved to space ${player.space}.`)
  if (!needsQuestion && !state.gameOver) advanceTurn(state)
  return {
    player,
    from,
    roll,
    destination: player.space,
    exactBounce: state.lastExactBounce,
    needsQuestion,
  }
}

export function resolveGuessWhatAnswer(state, playerId, {
  questionId,
  correct,
  movement,
} = {}) {
  if (state.gameOver || state.mode !== 'guess_what') return null
  const player = state.players[state.currentPlayerIndex]
  if (!player || player.id !== playerId) return null

  if (correct) {
    for (const ids of Object.values(state.remainingQuestionIds || {})) {
      const index = ids.indexOf(questionId)
      if (index >= 0) ids.splice(index, 1)
    }
  }

  const from = player.space
  state.lastExactBounce = null
  movePlayer(state, player, from + Number(movement || 0), true)
  if (player.space >= 100) finishPlayer(state, player)
  const needsQuestion = !player.finished && state.board.question_marks.includes(player.space)
  addLog(state, correct
    ? `${player.name} answered correctly and moved forward ${movement} space(s) to space ${player.space}.`
    : `${player.name} answered incorrectly and moved back ${Math.abs(Number(movement || 0))} spaces to space ${player.space}.`)
  if (!needsQuestion && !state.gameOver) advanceTurn(state)
  return {
    player,
    from,
    destination: player.space,
    movement: Number(movement || 0),
    exactBounce: state.lastExactBounce,
    needsQuestion,
  }
}

export function takeTurn(state, forcedRoll) {
  if (state.gameOver) return
  const player = state.players[state.currentPlayerIndex]
  state.lastMineExplosion = null
  state.lastExactBounce = null
  state.lastTraversalElimination = null
  if (player.skipTurns > 0) {
    player.skipTurns--
    if (player.skillBlockedTurns > 0) player.skillBlockedTurns--
    state.lastRoll = null
    state.lastWhat = null
    state.lastQuestionChain = []
    addLog(state, `${player.name} cannot move due to ${player.skipReason || 'a what'}. ${player.skipTurns} skipped turn(s) remain.`)
    if (player.skipTurns === 0) player.skipReason = null
    advanceTurn(state)
    triggerExplosion(state)
    return
  }

  const roll = forcedRoll ?? Math.floor(Math.random() * 6) + 1
  player.rerollPending = false
  player.specialRollPending = false
  state.lastRoll = roll
  state.lastWhat = null
  state.lastQuestionChain = []
  const startSpace = player.space
  movePlayer(state, player, player.space + roll, true)
  if (state.mode === 'run_away' && roll < 0 && startSpace === 1 && player.space === 1) {
    addLog(state, `${player.name} rolled ${roll} and stays on Square 1.`)
  } else {
    const movementText = roll > 0
      ? `moved forward ${roll} space(s)`
      : roll < 0
        ? `moved backward ${Math.abs(roll)} space(s)`
        : 'stayed in place'
    addLog(state, `${player.name} rolled ${roll}, ${movementText}, and is on space ${player.space}.`)
  }
  if (!player.eliminated && roll !== 0 && !state.lastMineExplosion?.duringMove) resolveLanding(state, player)
  if (player.skillBlockedTurns > 0) player.skillBlockedTurns--
  if (!state.gameOver && !player.rerollPending) advanceTurn(state)
  triggerExplosion(state)
}

export function takeParkourWhat(state, what) {
  if (state.gameOver || !what) return null
  const player = state.players[state.currentPlayerIndex]
  const from = player.space
  player.specialRollPending = false
  state.lastRoll = null
  state.lastWhat = { ...what, space: from }
  state.lastQuestionChain = []
  state.lastTraversalElimination = null
  const effects = applyWhatEffects(state, player, what)
  const directDestination = player.space
  const descriptions = what.effects.map(effect => affectedDescription(effect.description, player.name)).join(' ')
  addLog(state, `${player.name}'s Parkour die landed on ${what.name}. ${descriptions}`)

  let questionChain = []
  let ladder = null
  if (directDestination !== from && !player.eliminated) {
    resolveLanding(state, player)
    questionChain = state.lastQuestionChain.map(item => ({
      ...item,
      what: item.what ? { ...item.what } : undefined,
    }))
    const afterQuestions = questionChain.at(-1)?.destination ?? directDestination
    const connectedLadder = state.board.ladders.find(item => item.from === afterQuestions)
    if (connectedLadder) ladder = { ...connectedLadder }
  }

  if (!state.gameOver) advanceTurn(state)
  triggerExplosion(state)
  return {
    player,
    what: { ...what },
    from,
    directDestination,
    effects,
    questionChain,
    ladder,
  }
}

export function penalizeTurn(state) {
  if (state.gameOver) return null
  const player = state.players[state.currentPlayerIndex]
  const from = player.space
  let destination = from
  let cooldownAddedMs = 0
  if (state.mode === 'run_away') {
    cooldownAddedMs = 30_000
    player.skillCooldownUntil = Math.max(player.skillCooldownUntil, Date.now()) + cooldownAddedMs
  } else if (state.mode === 'escape_from') {
    cooldownAddedMs = 30_000
    if (player.weaponCooldownUntil > Date.now()) player.weaponCooldownUntil += cooldownAddedMs
    else player.weaponPendingPenaltyMs += cooldownAddedMs
  } else if (state.mode === 'clash_with') {
    destination = from
  } else {
    destination = Math.max(1, from - 1)
    while (destination > 1 && state.board.question_marks.includes(destination)) destination--
    player.space = destination
  }
  player.rerollPending = false
  player.specialRollPending = false
  state.lastRoll = null
  state.lastWhat = null
  state.lastQuestionChain = []
  const message = state.mode === 'run_away'
    ? `${player.name} ran out of time, stayed on square ${from}, and gained 30 seconds of skill cooldown.`
    : state.mode === 'escape_from'
      ? `${player.name} ran out of time, stayed on square ${from}, and gained 30 seconds on their next weapon cooldown.`
      : state.mode === 'clash_with'
        ? `${player.name} ran out of time and stayed on square ${from}.`
        : `${player.name} ran out of time and was moved back from space ${from} to normal space ${destination}.`
  addLog(state, message)
  advanceTurn(state)
  triggerExplosion(state)
  return { player, from, destination, cooldownAddedMs, message }
}

export function forfeitPlayer(state, playerId) {
  if (state.gameOver) return null
  const player = state.players.find(item => item.id === playerId)
  if (!player || player.finished) return null
  const wasCurrent = state.players[state.currentPlayerIndex]?.id === playerId
  player.finished = true
  player.forfeited = true
  player.rank = null
  addLog(state, `${player.name} forfeited the game.`)

  const remaining = activePlayers(state)
  if (remaining.length <= 1) {
    concludeIfOneRemains(state)
  } else if (wasCurrent) {
    advanceTurn(state)
  }
  return player
}

function closestOpponent(state, player) {
  return activePlayers(state)
    .filter(other => other.id !== player.id && Math.abs(other.space - player.space) <= 10)
    .sort((a, b) => Math.abs(a.space - player.space) - Math.abs(b.space - player.space))[0]
}

function peekTarget(state, player, targetId) {
  const opponents = activePlayers(state)
    .filter(other => other.id !== player.id && Math.abs(other.space - player.space) <= 10)
    .sort((a, b) => Math.abs(a.space - player.space) - Math.abs(b.space - player.space))
  const closest = opponents[0]
  if (!closest || !targetId) return closest

  const selected = opponents.find(other => other.id === targetId)
  if (!selected || selected.space !== closest.space) return null
  return selected
}

export function activateSkill(state, now = Date.now(), targetId = null) {
  if (state.gameOver) return { ok: false, message: 'The game is over.' }
  if (['guess_what', 'clash_with'].includes(state.mode)) return { ok: false, message: 'Character skills are disabled in this mode.' }
  const player = state.players[state.currentPlayerIndex]
  if (player.skillBlockedTurns > 0) return { ok: false, message: `Skill blocked for ${player.skillBlockedTurns} more turn(s).` }
  if (player.delayedSkillCooldownStartTurn != null) return { ok: false, message: `Skill cooldown starts on turn ${player.delayedSkillCooldownStartTurn}.` }
  if (player.skillCooldownUntil > now) return { ok: false, message: 'Skill is still cooling down.' }

  const skill = player.specialSkill?.name
  const target = closestOpponent(state, player)
  let message
  let movement = null
  let landingResolution = null
  const landingResolutions = []
  const resolveSkillLanding = (landingPlayer, landingSpace) => {
    const isQuestion = state.board.question_marks.includes(landingPlayer.space)
    const isLadderBottom = state.board.ladders.some(ladder => ladder.from === landingPlayer.space)
    if (!isQuestion && !isLadderBottom) return
    resolveLanding(state, landingPlayer)
    const afterQuestions = state.lastQuestionChain.at(-1)?.destination ?? landingSpace
    const connectedLadder = state.board.ladders.find(item => item.from === afterQuestions)
    landingResolutions.push({
      playerId: landingPlayer.id,
      playerName: landingPlayer.name,
      landingSpace,
      questionChain: state.lastQuestionChain.map(item => ({
        ...item,
        what: item.what ? { ...item.what } : undefined,
      })),
      ladder: connectedLadder ? { ...connectedLadder } : null,
    })
  }

  if (skill === 'Magnet') {
    if (!target) return { ok: false, message: 'No player is within 10 spaces.' }
    target.space = player.space
    resolveSkillLanding(target, target.space)
    message = `${player.name} used Magnet and pulled ${target.name} to space ${player.space}.`
  } else if (skill === 'Switcheroo') {
    if (!target) return { ok: false, message: 'No player is within 10 spaces.' }
    const targetSpace = target.space
    target.space = player.space
    player.space = targetSpace
    resolveSkillLanding(player, player.space)
    resolveSkillLanding(target, target.space)
    message = `${player.name} used Switcheroo and swapped spaces with ${target.name}.`
  } else if (skill === 'Intersect') {
    if (!target) return { ok: false, message: 'No player is within 10 spaces.' }
    if (Math.abs(target.space - player.space) === 1) {
      return { ok: false, message: 'Intersect cannot be used when the closest player is only 1 space away.' }
    }
    const middle = Math.round((player.space + target.space) / 2)
    player.space = middle
    target.space = middle
    resolveSkillLanding(player, middle)
    resolveSkillLanding(target, middle)
    message = `${player.name} used Intersect and pulled themselves and ${target.name} to space ${middle}.`
  } else if (skill === 'Peek-a-Boo') {
    const peekPlayer = peekTarget(state, player, targetId)
    if (!peekPlayer) return { ok: false, message: 'Choose a closest player within 10 spaces.' }
    const question = [...state.board.question_marks]
      .sort((a, b) => a - b)
      .find(space => space > peekPlayer.space && space - peekPlayer.space <= 10)
    if (!question) return { ok: false, message: 'No question mark is within 10 spaces of a player.' }
    movement = { playerId: peekPlayer.id, from: peekPlayer.space, to: question }
    peekPlayer.space = question
    resolveLanding(state, peekPlayer)
    const questionChain = state.lastQuestionChain.map(item => ({
      ...item,
      what: item.what ? { ...item.what } : undefined,
    }))
    const afterQuestions = questionChain.at(-1)?.destination ?? question
    const ladder = state.board.ladders.find(item => item.from === afterQuestions)
    landingResolution = {
      playerId: peekPlayer.id,
      playerName: peekPlayer.name,
      questionChain,
      ladder: ladder ? { ...ladder } : null,
    }
    message = `${player.name} used Peek-a-Boo on ${peekPlayer.name}, moving them to question space ${question}.`
  } else if (skill === 'Ragebait') {
    const rageTarget = activePlayers(state).find(other => other.id === targetId && other.id !== player.id)
    if (!rageTarget) return { ok: false, message: 'Choose another active player anywhere on the board.' }
    const from = rageTarget.space
    movePlayer(state, rageTarget, rageTarget.space - 15)
    const landingSpace = rageTarget.space
    movement = { playerId: rageTarget.id, from, to: landingSpace }
    resolveSkillLanding(rageTarget, landingSpace)
    player.skipTurns += 2
    player.skipReason = 'Ragebait consequence'
    message = `${player.name} used Ragebait on ${rageTarget.name}, moving them 15 spaces backward, but cannot move for the next 2 turns.`
  } else if (skill === 'Nope') {
    player.skillArmed = 'ignore-question'
    message = `${player.name} activated Nope. Their next question mark will be ignored.`
  } else if (skill === 'Rage Reroll') {
    player.skillArmed = 'reroll-question'
    message = `${player.name} armed Rage Reroll for their next question mark.`
  } else if (skill === 'Parkour') {
    player.specialRollPending = true
    message = `${player.name} used Parkour and is ready to roll a special die.`
  } else if (skill === 'Hidden Mine') {
    const options = hiddenMineOptions(state, player)
    const space = Number(targetId)
    if (!options.includes(space)) return { ok: false, message: 'Choose an available square within 5 spaces.' }
    const ownerMines = state.hiddenMines.filter(mine => mine.ownerId === player.id)
    if (ownerMines.length >= 2) {
      const oldestMine = ownerMines[0]
      state.hiddenMines.splice(state.hiddenMines.indexOf(oldestMine), 1)
    }
    state.hiddenMines.push({ ownerId: player.id, space })
    message = `${player.name} placed a hidden mine.`
    player.skillCooldownUntil = now + SKILL_COOLDOWN_MS
    addLog(state, message)
    return { ok: true, message, movement: null, landingResolution: null, landingResolutions: [], requiresRoll: false }
    message = `${player.name} used Parkour and is ready to roll a special 7–10 die.`
  } else {
    return { ok: false, message: 'This skill is not available.' }
  }

  player.skillCooldownUntil = now + SKILL_COOLDOWN_MS
  addLog(state, message)
  return {
    ok: true,
    message,
    movement,
    landingResolution,
    landingResolutions,
    requiresRoll: skill === 'Parkour',
  }
}
