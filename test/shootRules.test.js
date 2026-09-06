import test from 'node:test'
import assert from 'node:assert/strict'
import { createGameState, resolveShootBombs, selectShootTarget, shootRoundResult, shootTargetOptions, startShootRound, takeShootTurn } from '../src/gameRules.js'
import { getBoardGuideCellBounds, getBoardSpaceBounds, getBoardSpacePosition } from '../src/boardLayout.js'

const board = { type: 'shoot_the_what', name: 'Land of the Dead', ladders: [{ from: 4, to: 18 }], boosts: [{ square: 7, direction: 'right', boost: 2 }], question_marks: [], whats: [] }
const players = [{ id: 'a', name: 'A', team: 'A' }, { id: 'b', name: 'B', team: 'B' }]

test('Shoot mode has no character skills and follows the 2–2–1 role schedule', () => {
  const state = createGameState(board, players)
  startShootRound(state, 'A')
  assert.equal(state.shoot.bomberTeam, 'A')
  assert.equal(state.players[0].specialSkill, null)
  state.shoot.round = 3; startShootRound(state)
  assert.equal(state.shoot.bomberTeam, 'B')
  state.shoot.round = 5; startShootRound(state)
  assert.equal(state.shoot.bomberTeam, 'A')
})

test('Escapers use ladders and bombing eliminates exact target squares only', () => {
  const state = createGameState(board, players)
  startShootRound(state, 'A')
  takeShootTurn(state, 3)
  assert.equal(state.players[1].space, 18)
  state.shoot.bombingDue = true
  assert.equal(selectShootTarget(state, 'a', 18).ok, true)
  assert.equal(resolveShootBombs(state)[0].playerId, 'b')
})

test('bomb targets keep three numbered spaces clear and match wins end the game', () => {
  const state = createGameState(board, [...players, { id: 'a2', name: 'A2', team: 'A' }])
  startShootRound(state, 'A'); state.shoot.bombingDue = true
  assert.equal(selectShootTarget(state, 'a', 20).ok, true)
  assert.equal(selectShootTarget(state, 'a2', 23).ok, false)
  state.shoot.wins.A = 2
  assert.equal(shootRoundResult(state, 'A').complete, true)
  assert.equal(state.gameOver, true)
})

test('bomb targets exclude boosts, toggle off, and retain their selection order', () => {
  const state = createGameState(board, [...players, { id: 'a2', name: 'A2', team: 'A' }])
  startShootRound(state, 'A'); state.shoot.bombingDue = true
  assert.equal(shootTargetOptions(state, 'a').includes(7), false)
  assert.equal(selectShootTarget(state, 'a2', 20).ok, true)
  assert.equal(selectShootTarget(state, 'a', 30).ok, true)
  assert.deepEqual(state.shoot.targetOrder, ['a2', 'a'])
  assert.equal(selectShootTarget(state, 'a2', 20).deselected, true)
  assert.deepEqual(state.shoot.targetOrder, ['a'])
})

test('bombing begins after three complete Escaper-team global turns', () => {
  const state = createGameState(board, [...players, { id: 'b2', name: 'B2', team: 'B' }])
  startShootRound(state, 'A')
  for (let turn = 0; turn < 2; turn++) {
    takeShootTurn(state, 1)
    assert.equal(state.shoot.bombingDue, false)
    takeShootTurn(state, 1)
    assert.equal(state.shoot.bombingDue, false)
  }
  takeShootTurn(state, 1)
  assert.equal(state.shoot.bombingDue, false)
  takeShootTurn(state, 1)
  assert.equal(state.shoot.globalTurns, 3)
  assert.equal(state.shoot.bombingDue, true)
})

test('Land of the Dead exposes guide-aligned square centers and bounds', () => {
  const bounds = getBoardSpaceBounds(board, 1)
  const guideBounds = getBoardGuideCellBounds(board, 1)
  const position = getBoardSpacePosition(board, 1)
  assert.ok(bounds)
  assert.ok(guideBounds)
  assert.match(bounds.width, /%$/)
  assert.match(bounds.height, /%$/)
  assert.ok(Number.parseFloat(guideBounds.width) < Number.parseFloat(bounds.width))
  assert.ok(Number.parseFloat(guideBounds.height) < Number.parseFloat(bounds.height))
  assert.match(position.left, /%$/)
  assert.match(position.top, /%$/)
})
