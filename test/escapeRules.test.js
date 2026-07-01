import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  armEscapeWeapon,
  chooseEscapeAiDirection,
  createGameState,
  isEscapeWeaponProtecting,
  skipEscapeTurn,
  takeEscapeTurn,
  visualAdjacentSpaces,
} from '../src/gameRules.js'

const root = resolve(import.meta.dirname, '..')
const boards = JSON.parse(readFileSync(resolve(root, 'data/boards.json'), 'utf8'))
const board = boards.find(item => item.name === 'Quiet Mansion')
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
