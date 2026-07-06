import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  armEscapeWeapon,
  canSkipEscapeMove,
  chooseEscapeAiDirection,
  completeEscape,
  createGameState,
  isEscapeWeaponProtecting,
  skipEscapeTurn,
  spawnEscapePickups,
  takeEscapeTurn,
  visualAdjacentSpaces,
} from '../src/gameRules.js'

const root = resolve(import.meta.dirname, '..')
const boards = JSON.parse(readFileSync(resolve(root, 'data/boards.json'), 'utf8'))
const board = boards.find(item => item.name === 'Quiet Mansion')
const deadForest = boards.find(item => item.name === 'Dead Forest')
const players = [
  { id: 'p1', name: 'Brave Bob', color: '#fff' },
  { id: 'p2', name: 'Calm Alice', color: '#fea' },
]

test('Quiet Mansion initializes valid key, player, and entity positions', () => {
  const state = createGameState(board, players)
  const ladderSpaces = new Set(board.ladders.flatMap(ladder => [ladder.from, ladder.to]))
  assert.equal(state.keys.length, 3)
  assert.equal(state.entities.length, 5)
  assert.equal(new Set(state.keys.map(key => key.space)).size, 3)
  for (const key of state.keys) assert.equal(ladderSpaces.has(key.space), false)
  for (const player of state.players) {
    assert.equal(player.health, 5)
    assert.equal(player.weaponCooldownUntil, 0)
    assert.ok(state.keys.every(key => Math.abs(player.space - key.space) > 3))
  }
  for (const entity of state.entities) {
    assert.equal(ladderSpaces.has(entity.space), false)
    assert.ok(state.keys.every(key => Math.abs(entity.space - key.space) > 3))
    assert.ok(state.entities.filter(other => other.id !== entity.id).every(other => Math.abs(entity.space - other.space) > 5))
  }
})

test('weapon protection starts next round, lasts two rounds, then starts cooldown', () => {
  const startedAt = 10_000
  const state = createGameState(board, players, startedAt)
  const owner = state.players[0]
  assert.equal(armEscapeWeapon(state, owner, startedAt).ok, true)
  assert.equal(owner.weaponProtectFromTurn, 2)
  assert.equal(isEscapeWeaponProtecting(owner, 1), false)
  assert.equal(isEscapeWeaponProtecting(owner, 2), true)
  assert.equal(isEscapeWeaponProtecting(owner, 3), true)
  skipEscapeTurn(state, startedAt)
  skipEscapeTurn(state, startedAt)
  skipEscapeTurn(state, startedAt)
  skipEscapeTurn(state, startedAt)
  skipEscapeTurn(state, startedAt)
  assert.equal(state.turn, 4)
  assert.equal(owner.weaponProtectFromTurn, null)
  assert.equal(owner.weaponCooldownUntil, startedAt + 60_000)
})

test('Dead Forest uses the shared Escape setup with its four collectible Tires', () => {
  const state = createGameState(deadForest, players)

  assert.equal(state.mode, 'escape_from')
  assert.equal(state.keys.length, 4)
  assert.equal(state.entities.length, 5)
  assert.match(state.log[0], /tires/i)
  assert.equal(state.board.default_weapon.name, 'Crowbar')
})

test('Escape entities relocate only after two complete global turns', () => {
  const state = createGameState(deadForest, players)
  const initialRelocationTurn = state.nextEntityRelocationTurn

  skipEscapeTurn(state)
  assert.equal(state.turn, 1)
  assert.equal(state.nextEntityRelocationTurn, initialRelocationTurn)

  skipEscapeTurn(state)
  assert.equal(state.turn, 2)
  assert.equal(state.nextEntityRelocationTurn, initialRelocationTurn)

  skipEscapeTurn(state)
  assert.equal(state.turn, 2)
  assert.equal(state.nextEntityRelocationTurn, initialRelocationTurn)

  skipEscapeTurn(state)
  assert.equal(state.turn, 3)
  assert.equal(state.nextEntityRelocationTurn, 5)
})

test('Brave Bob can extend weapon protection to four turns', () => {
  const state = createGameState(board, [
    { id: 'bob', name: 'Brave Bob', passiveSkill: { name: 'Fighter Spirit' } },
    players[1],
  ])
  const result = armEscapeWeapon(state, state.players[0], 10_000, () => 0.1)

  assert.equal(result.passiveTrigger.name, 'Fighter Spirit')
  assert.equal(state.players[0].weaponProtectFromTurn, 2)
  assert.equal(state.players[0].weaponProtectThroughTurn, 5)
})

test('Crybaby Curl can retreat from an entity without starting an attack', () => {
  const state = createGameState(board, [
    { id: 'curl', name: 'Crybaby Curl', passiveSkill: { name: 'Fight or Flight' } },
    players[1],
  ])
  state.players[0].space = 50
  state.entities = [{ id: 'ghost', space: 51 }]
  state.keys.forEach((key, index) => { key.space = 80 + index })

  const result = takeEscapeTurn(state, 1, 'forward', () => 0.1)

  assert.equal(result.passiveTrigger.effect, 'retreat')
  assert.deepEqual(result.passiveMovement, { from: 51, to: 50 })
  assert.equal(result.encounter, null)
  assert.equal(state.players[0].health, 5)
})

test('Crybaby Curl can passively defend without consuming an active weapon', () => {
  const state = createGameState(board, [
    { id: 'curl', name: 'Crybaby Curl', passiveSkill: { name: 'Fight or Flight' } },
    players[1],
  ])
  state.players[0].space = 50
  state.players[0].weaponProtectFromTurn = 1
  state.players[0].weaponProtectThroughTurn = 2
  state.entities = [{ id: 'ghost', space: 51 }]
  state.keys.forEach((key, index) => { key.space = 80 + index })
  const rolls = [0.1, 0.9, 0.2]

  const result = takeEscapeTurn(state, 1, 'forward', () => rolls.shift() ?? 0.2)

  assert.equal(result.passiveTrigger.effect, 'defend')
  assert.equal(result.encounter.prevented, true)
  assert.equal(result.encounter.passiveDefended, true)
  assert.equal(state.players[0].health, 5)
  assert.equal(state.players[0].weaponProtectFromTurn, 1)
})

test('Energetic Sam can ignore an entity crossed before the final square', () => {
  const state = createGameState(board, [
    { id: 'sam', name: 'Energetic Sam', passiveSkill: { name: 'Optimistic Mind' } },
    players[1],
  ])
  state.players[0].space = 50
  state.entities = [{ id: 'ghost', space: 52 }]
  state.keys.forEach((key, index) => { key.space = 80 + index })

  const result = takeEscapeTurn(state, 4, 'forward', () => 0.1)

  assert.equal(result.movementPassive.name, 'Optimistic Mind')
  assert.equal(result.movementPassive.space, 52)
  assert.equal(result.rollLanding, 54)
  assert.equal(result.encounter, null)
})

test('Energetic Sam cannot ignore an entity on the final square', () => {
  const state = createGameState(board, [
    { id: 'sam', name: 'Energetic Sam', passiveSkill: { name: 'Optimistic Mind' } },
    players[1],
  ])
  state.players[0].space = 50
  state.entities = [{ id: 'ghost', space: 54 }]
  state.keys.forEach((key, index) => { key.space = 80 + index })

  const result = takeEscapeTurn(state, 4, 'forward', () => 0.1)

  assert.equal(result.movementPassive, null)
  assert.equal(result.encounter.entityId, 'ghost')
  assert.equal(state.players[0].health, 4)
})

test('Calm Alice can reveal every entity after completing a move', () => {
  const state = createGameState(board, [
    { id: 'alice', name: 'Calm Alice', passiveSkill: { name: 'Concentrate' } },
    players[1],
  ])
  state.players[0].space = 50
  state.entities = []
  state.keys.forEach((key, index) => { key.space = 80 + index })

  const result = takeEscapeTurn(state, 2, 'forward', () => 0.1)

  assert.equal(result.completionPassive.name, 'Concentrate')
  assert.equal(result.completionPassive.effect, 'reveal_entities')
})

test('two held keys drop on the death square and one visual neighbor', () => {
  const state = createGameState(board, players)
  const player = state.players[0]
  player.space = 50
  player.health = 1
  player.heldKeys = ['key-1', 'key-2']
  state.keys[0] = { id: 'key-1', space: null, holderId: player.id }
  state.keys[1] = { id: 'key-2', space: null, holderId: player.id }
  state.entities[0].space = 51
  takeEscapeTurn(state, 1, 'forward', () => 0)
  assert.equal(player.eliminated, true)
  assert.equal(state.keys[0].space, 51)
  assert.ok(visualAdjacentSpaces(51).includes(state.keys[1].space))
  assert.notEqual(state.keys[1].space, 100)
})

test('visual neighbors stay within their serpentine row and exclude square 100', () => {
  assert.deepEqual(visualAdjacentSpaces(1), [2])
  assert.deepEqual(visualAdjacentSpaces(10), [9])
  assert.deepEqual(visualAdjacentSpaces(99), [98])
})

test('Escape AI chooses the direction that approaches its current key target', () => {
  const state = createGameState(board, players)
  const player = state.players[0]
  player.space = 40
  state.keys = [
    { id: 'key-1', space: 30, holderId: null },
    { id: 'key-2', space: 80, holderId: null },
    { id: 'key-3', space: 90, holderId: null },
  ]
  assert.equal(chooseEscapeAiDirection(state, player, 4), 'backward')
  player.heldKeys = ['key-1', 'key-2']
  state.keys[0].holderId = player.id
  state.keys[0].space = null
  state.keys[1].holderId = player.id
  state.keys[1].space = null
  assert.equal(chooseEscapeAiDirection(state, player, 4), 'forward')
})

test('Escape movement separates rolled traversal from ladder travel', () => {
  const state = createGameState(board, players)
  state.players[0].space = 1
  state.entities = []
  state.keys.forEach((key, index) => { key.space = 80 + index })

  const result = takeEscapeTurn(state, 5, 'forward')

  assert.equal(result.from, 1)
  assert.equal(result.rollLanding, 6)
  assert.equal(result.destination, 27)
  assert.deepEqual(result.ladder, { from: 6, to: 27, direction: 'up' })
})

test('Escape movement reports newly collected items for synchronized character audio', () => {
  const state = createGameState(board, players)
  state.players[0].space = 40
  state.entities = []
  state.keys[0].space = 41
  state.keys.slice(1).forEach((key, index) => { key.space = 80 + index })

  const result = takeEscapeTurn(state, 1, 'forward')

  assert.deepEqual(result.collectedKeys, [state.keys[0].id])
})

test('Escape movement stops on the first entity crossed before the roll completes', () => {
  const state = createGameState(board, players)
  const player = state.players[0]
  player.space = 20
  state.entities = [
    { id: 'near', space: 23 },
    { id: 'far', space: 26 },
  ]
  state.keys.forEach((key, index) => { key.space = 80 + index })

  const result = takeEscapeTurn(state, 8, 'forward', () => 0)

  assert.equal(result.intendedLanding, 28)
  assert.equal(result.rollLanding, 23)
  assert.equal(result.destination, 23)
  assert.equal(result.interruptedByEntity, true)
  assert.equal(result.encounter.entityId, 'near')
  assert.equal(result.ladder, null)
  assert.notEqual(state.entities.find(entity => entity.id === 'near').space, 23)
})

test('Escape movement also detects entities while moving backward', () => {
  const state = createGameState(board, players)
  state.players[0].space = 40
  state.entities = [{ id: 'backward-ghost', space: 37 }]
  state.keys.forEach((key, index) => { key.space = 80 + index })

  const result = takeEscapeTurn(state, 6, 'backward', () => 0)

  assert.equal(result.intendedLanding, 34)
  assert.equal(result.rollLanding, 37)
  assert.equal(result.destination, 37)
  assert.equal(result.encounter.entityId, 'backward-ghost')
})

test('Quiet Mansion defers victory until the synchronized exit sequence completes', () => {
  const state = createGameState(board, players)
  state.entities = []
  state.keys.forEach((key, index) => {
    key.holderId = index < 2 ? 'p1' : 'p2'
    key.space = null
  })
  state.players[0].heldKeys = [state.keys[0].id, state.keys[1].id]
  state.players[1].heldKeys = [state.keys[2].id]
  state.players[0].space = 100
  state.players[1].space = 99
  state.currentPlayerIndex = 1
  state.exitRevealed = true

  takeEscapeTurn(state, 1, 'forward')

  assert.equal(state.exitUnlocked, true)
  assert.equal(state.exitUnlockPending, true)
  assert.equal(state.exitSequencePending, true)
  assert.equal(state.gameOver, false)
  assert.equal(completeEscape(state), true)
  assert.equal(state.gameOver, true)
  assert.equal(state.escapeOutcome, 'won')
  assert.equal(state.players.every(player => player.won), true)
})

test('Escape players can skip Pick Moves only while waiting on revealed Square 100', () => {
  const state = createGameState(board, players)
  const player = state.players[0]
  player.space = 100
  state.keys.forEach((key, index) => {
    key.space = null
    key.holderId = state.players[index % state.players.length].id
  })
  state.exitRevealed = true

  assert.equal(canSkipEscapeMove(state, player), true)
  state.exitRevealed = false
  assert.equal(canSkipEscapeMove(state, player), false)
  state.exitRevealed = true
  state.keys[0].holderId = null
  assert.equal(canSkipEscapeMove(state, player), false)
  state.keys[0].holderId = player.id
  player.space = 99
  assert.equal(canSkipEscapeMove(state, player), false)
})

test('Escape pickup spawning is mutually exclusive and respects blocked squares and cooldowns', () => {
  const state = createGameState(board, players)
  state.turn = 2
  const blocked = new Set([
    ...state.players.map(player => player.space),
    ...state.keys.map(key => key.space),
    ...state.entities.map(entity => entity.space),
    ...state.board.ladders.flatMap(ladder => [ladder.from, ladder.to]),
    100,
  ])
  const values = [0.1, 0.1, 0.9]
  const spawned = spawnEscapePickups(state, () => values.shift() ?? 0.5)

  assert.equal(spawned.type, 'light_sources')
  assert.equal(state.lightSources.length, 2)
  assert.equal(new Set(state.lightSources.map(item => item.space)).size, 2)
  assert.ok(state.lightSources.every(item => !blocked.has(item.space)))
  assert.equal(state.medkits.length, 0)
  assert.equal(state.nextLightSourceSpawnTurn, 5)
  assert.equal(state.nextMedkitSpawnTurn, 2)

  state.lightSources = []
  state.turn = 4
  assert.equal(spawnEscapePickups(state, () => 0.1)?.type, 'medkit')
  assert.equal(state.nextMedkitSpawnTurn, 8)
  state.medkits = []
  state.turn = 7
  assert.notEqual(spawnEscapePickups(state, () => 0.1)?.type, 'medkit')
})

test('Escape pickup spawn rounds relocate uncollected items without stacking', () => {
  const state = createGameState(board, players)
  state.turn = 5
  state.nextMedkitSpawnTurn = 5
  state.nextLightSourceSpawnTurn = 9
  state.medkits = [{ id: 'medkit-existing', space: 45 }]

  const medkitSpawn = spawnEscapePickups(state, () => 0.1)

  assert.equal(medkitSpawn.type, 'medkit')
  assert.equal(state.medkits.length, 1)
  assert.equal(state.medkits[0].id, 'medkit-existing')
  assert.notEqual(state.medkits[0].space, 45)

  const oldLightSpaces = [35, 36]
  state.turn = 9
  state.nextMedkitSpawnTurn = 20
  state.nextLightSourceSpawnTurn = 9
  state.lightSources = oldLightSpaces.map((space, index) => ({
    id: `light-existing-${index + 1}`,
    space,
  }))

  const lightSpawn = spawnEscapePickups(state, () => 0.1)
  const newLightSpaces = state.lightSources.map(item => item.space)

  assert.equal(lightSpawn.type, 'light_sources')
  assert.equal(state.lightSources.length, 2)
  assert.deepEqual(state.lightSources.map(item => item.id), ['light-existing-1', 'light-existing-2'])
  assert.equal(new Set(newLightSpaces).size, 2)
  assert.ok(newLightSpaces.every(space => !oldLightSpaces.includes(space)))
  assert.ok(!newLightSpaces.includes(state.medkits[0].space))
})

test('Escape pickups heal at the cap and grant a two-global-turn vision boost', () => {
  const healing = createGameState(board, players)
  const healingPlayer = healing.players[0]
  healingPlayer.space = 50
  healingPlayer.health = 4
  healing.medkits = [{ id: 'medkit-test', space: 50 }]
  const healed = takeEscapeTurn(healing, 0, 'forward')

  assert.deepEqual(healed.collectedPickups, ['medkit'])
  assert.equal(healingPlayer.health, 5)
  assert.equal(healing.medkits.length, 0)

  const capped = createGameState(board, players)
  capped.players[0].space = 50
  capped.players[0].health = 5
  capped.medkits = [{ id: 'medkit-cap', space: 50 }]
  takeEscapeTurn(capped, 0, 'forward')
  assert.equal(capped.players[0].health, 5)

  const lighting = createGameState(board, players)
  const lightPlayer = lighting.players[0]
  lightPlayer.space = 50
  lighting.lightSources = [{ id: 'light-test', space: 50 }]
  const lit = takeEscapeTurn(lighting, 0, 'forward')

  assert.deepEqual(lit.collectedPickups, ['light_source'])
  assert.equal(lightPlayer.visionBoostThroughTurn, 3)
  assert.equal(lighting.lightSources.length, 0)
  for (let action = 0; action < 5; action++) skipEscapeTurn(lighting)
  assert.equal(lighting.turn, 4)
  assert.equal(lightPlayer.visionBoostThroughTurn, null)
})
