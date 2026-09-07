import test from 'node:test'
import assert from 'node:assert/strict'
import { advanceShootEscaperTurn, createGameState, resolveShootBombs, selectShootTarget, shootEscaperWinTarget, shootRoundResult, shootRoundWinner, shootTargetOptions, startShootRound, takeShootTurn } from '../src/gameRules.js'
import { getBoardCellBounds, getBoardGuideCellBounds, getBoardSpaceBounds, getBoardSpacePosition } from '../src/boardLayout.js'

const board = { type: 'shoot_the_what', name: 'Land of the Dead', ladders: [{ from: 4, to: 18 }], boosts: [{ square: 7, direction: 'right', boost: 2 }], question_marks: [], whats: [] }
const players = [{ id: 'a', name: 'A', team: 'A' }, { id: 'b', name: 'B', team: 'B' }]

test('Shoot mode has no character skills and follows the 2–2–1 role schedule', () => {
  const state = createGameState(board, players)
  startShootRound(state, 'A')
  assert.equal(state.shoot.bomberTeam, 'A')
  assert.equal(state.players[0].specialSkill, null)
  state.shoot.round = 2; startShootRound(state)
  assert.equal(state.shoot.bomberTeam, 'B')
  state.shoot.round = 3; startShootRound(state)
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

test('each Escaper on a bombed square is reported for a separate death event', () => {
  const state = createGameState(board, [...players, { id: 'b2', name: 'B2', team: 'B' }])
  startShootRound(state, 'A')
  state.players.find(player => player.id === 'b').space = 18
  state.players.find(player => player.id === 'b2').space = 18
  state.shoot.bombingDue = true
  assert.equal(selectShootTarget(state, 'a', 18).ok, true)
  assert.deepEqual(resolveShootBombs(state).map(hit => hit.playerId), ['b', 'b2'])
})

test('every bomb target remains marked even when no Escaper is hit', () => {
  const state = createGameState(board, players)
  startShootRound(state, 'A')
  state.shoot.bombingDue = true
  assert.equal(selectShootTarget(state, 'a', 30).ok, true)
  assert.deepEqual(resolveShootBombs(state), [])
  assert.deepEqual(state.shoot.bloodiedSpaces, [30])
})

test('bomb targets keep three numbered spaces clear and match wins end the game', () => {
  const state = createGameState(board, [...players, { id: 'a2', name: 'A2', team: 'A' }])
  startShootRound(state, 'A'); state.shoot.bombingDue = true
  assert.equal(selectShootTarget(state, 'a', 20).ok, true)
  assert.equal(selectShootTarget(state, 'a2', 23).ok, false)
  state.shoot.wins.A = 2
  assert.equal(shootRoundResult(state, 'A').complete, true)
  assert.equal(state.gameOver, true)

  const finalRound = createGameState(board, players)
  startShootRound(finalRound, 'A')
  finalRound.shoot.round = 3
  assert.equal(shootRoundResult(finalRound, 'B').complete, true)
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

test('a 2v2 Shoot game resumes the fourth Escaper cycle after third-turn bombing', () => {
  const state = createGameState(board, [
    { id: 'a', name: 'A', team: 'A' },
    { id: 'a2', name: 'A2', team: 'A' },
    { id: 'b', name: 'B', team: 'B' },
    { id: 'b2', name: 'B2', team: 'B' },
  ])
  startShootRound(state, 'A')
  for (let index = 0; index < 6; index++) takeShootTurn(state, 1)
  assert.equal(state.shoot.globalTurns, 3)
  assert.equal(state.shoot.bombingDue, true)

  resolveShootBombs(state)
  advanceShootEscaperTurn(state)
  assert.equal(state.players[state.currentPlayerIndex].id, 'b')
  assert.equal(takeShootTurn(state, 1).bombingDue, false)
  assert.equal(state.players[state.currentPlayerIndex].id, 'b2')
  assert.equal(takeShootTurn(state, 1).bombingDue, false)
  assert.equal(state.shoot.globalTurns, 4)
  assert.equal(state.shoot.bombingDue, false)
})

test('Shoot boosts follow visual row direction and never leave their row', () => {
  const boostBoard = {
    ...board,
    ladders: [],
    boosts: [
      { square: 31, direction: 'left', boost: 3 },
      { square: 10, direction: 'right', boost: 3 },
      { square: 11, direction: 'right', boost: 3 },
    ],
  }
  const state = createGameState(boostBoard, players)
  startShootRound(state, 'A')

  state.players[1].space = 30
  assert.equal(takeShootTurn(state, 1).boost.to, 34)
  state.players[1].space = 9
  assert.equal(takeShootTurn(state, 1).boost.to, 10)
  state.players[1].space = 10
  assert.equal(takeShootTurn(state, 1).boost.to, 11)
})

test('third Escaper turn resolves a boost-to-ladder chain before bomber targeting is due', () => {
  const chainBoard = {
    ...board,
    ladders: [{ from: 29, to: 47 }],
    boosts: [{ square: 26, direction: 'right', boost: 3 }],
  }
  const state = createGameState(chainBoard, [...players, { id: 'b2', name: 'B2', team: 'B' }])
  startShootRound(state, 'A')
  for (let index = 0; index < 5; index++) takeShootTurn(state, 1)
  const lastEscaper = state.players.find(player => player.id === 'b2')
  lastEscaper.space = 25

  const result = takeShootTurn(state, 1)
  assert.deepEqual(result.landingEvents.map(event => [event.type, event.from, event.to]), [
    ['boost', 26, 29],
    ['ladder', 29, 47],
  ])
  assert.equal(lastEscaper.space, 47)
  assert.equal(result.bombingDue, true)
})

test('three Escapers need two S100 finishes, while Bombers win once two finishes are impossible', () => {
  const shootPlayers = [...players, { id: 'b2', name: 'B2', team: 'B' }, { id: 'b3', name: 'B3', team: 'B' }]
  const state = createGameState(board, shootPlayers)
  startShootRound(state, 'A')
  state.players.find(player => player.id === 'b').space = 99
  const firstFinish = takeShootTurn(state, 1)
  assert.equal(firstFinish.roundWinner, undefined)
  assert.equal(state.players.find(player => player.id === 'b').finished, true)
  assert.equal(state.players[state.currentPlayerIndex].id, 'b2')
  assert.equal(shootRoundWinner(state), null)

  state.players.find(player => player.id === 'b2').space = 99
  const secondFinish = takeShootTurn(state, 1)
  assert.equal(secondFinish.roundWinner, 'B')
  assert.equal(shootRoundWinner(state), 'B')

  const bomberState = createGameState(board, shootPlayers)
  startShootRound(bomberState, 'A')
  bomberState.players.find(player => player.id === 'b').eliminated = true
  bomberState.players.find(player => player.id === 'b2').eliminated = true
  assert.equal(shootRoundWinner(bomberState), 'A')
})

test('Land of the Dead exposes guide-aligned square centers and bounds', () => {
  for (const space of [1, 50, 100]) {
    const bounds = getBoardSpaceBounds(board, space)
    const guideBounds = getBoardGuideCellBounds(board, space)
    const position = getBoardSpacePosition(board, space)
    assert.ok(bounds)
    assert.ok(guideBounds)
    assert.match(bounds.width, /%$/)
    assert.match(bounds.height, /%$/)
    assert.ok(Number.parseFloat(guideBounds.width) < Number.parseFloat(bounds.width))
    assert.ok(Number.parseFloat(guideBounds.height) < Number.parseFloat(bounds.height))
    assert.match(position.left, /%$/)
    assert.match(position.top, /%$/)
  }
})

test('Land of the Dead exposes the full S100 board cell for a Bomber fog reveal', () => {
  const cell = getBoardCellBounds(board, 100)
  const tokenBounds = getBoardSpaceBounds(board, 100)
  assert.equal(cell.x, '0.797%')
  assert.equal(cell.y, '0.797%')
  assert.equal(cell.width, '10.606%')
  assert.equal(cell.height, '9.569%')
  assert.ok(Number.parseFloat(cell.width) > Number.parseFloat(tokenBounds.width))
  assert.equal(cell.height, tokenBounds.height)
})

test('one or two Escapers need one S100 finish and lose when that finish becomes impossible', () => {
  const loneEscaper = createGameState(board, players)
  startShootRound(loneEscaper, 'A')
  assert.equal(shootEscaperWinTarget(loneEscaper), 1)
  loneEscaper.players.find(player => player.id === 'b').space = 99
  assert.equal(takeShootTurn(loneEscaper, 1).roundWinner, 'B')

  const twoEscapers = createGameState(board, [...players, { id: 'b2', name: 'B2', team: 'B' }])
  startShootRound(twoEscapers, 'A')
  assert.equal(shootEscaperWinTarget(twoEscapers), 1)
  twoEscapers.players.find(player => player.id === 'b2').space = 99
  twoEscapers.currentPlayerIndex = twoEscapers.players.findIndex(player => player.id === 'b2')
  assert.equal(takeShootTurn(twoEscapers, 1).roundWinner, 'B')

  const impossible = createGameState(board, players)
  startShootRound(impossible, 'A')
  impossible.players.find(player => player.id === 'b').eliminated = true
  assert.equal(shootRoundWinner(impossible), 'A')
})

test('bombing resumes with the next non-finished, non-eliminated Escaper', () => {
  const state = createGameState(board, [...players, { id: 'b2', name: 'B2', team: 'B' }, { id: 'b3', name: 'B3', team: 'B' }])
  startShootRound(state, 'A')
  state.players.find(player => player.id === 'b').finished = true
  state.players.find(player => player.id === 'b2').eliminated = true
  state.currentPlayerIndex = state.players.findIndex(player => player.id === 'b2')
  assert.equal(advanceShootEscaperTurn(state)?.id, 'b3')
  assert.equal(state.players[state.currentPlayerIndex].id, 'b3')
})
