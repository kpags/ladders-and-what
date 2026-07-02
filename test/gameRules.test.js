import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyDestroyedSquareEffect,
  applyWhatEffects,
  activateSkill,
  createGameState,
  describeRunAwayRoll,
  destroySpace,
  endTurnAfterSkill,
  hiddenMineOptions,
  minePushDestination,
  planRunAwayDestruction,
  takeTurn,
} from '../src/gameRules.js'

const board = {
  name: 'Test Run Away',
  type: 'run_away',
  ladders: [],
  question_marks: [],
  whats: [],
}

function createState(spaces = [1, 1, 1]) {
  const state = createGameState(
    board,
    spaces.map((space, index) => ({
      id: `player-${index + 1}`,
      name: `Player ${index + 1}`,
    })),
    0,
  )
  state.players.forEach((player, index) => {
    player.space = spaces[index]
  })
  return state
}

test('Ghost Town destroyed-square effects use the last destroyed square without rescheduling destruction', () => {
  const state = createState([30, 50])
  state.destroyedSpaces = [1, 2, 3, 4, 5]
  state.nextExplosionTurn = 9

  const removed = applyDestroyedSquareEffect(state, {
    effect: 'decrease_destroyed_square',
    spaces: 2,
  })
  assert.deepEqual(removed.removed, [5, 4])
  assert.deepEqual(state.destroyedSpaces, [1, 2, 3])

  const added = applyDestroyedSquareEffect(state, {
    effect: 'increase_destroyed_square',
    spaces: 2,
  })
  assert.deepEqual(added.added, [4, 5])
  assert.deepEqual(state.destroyedSpaces, [1, 2, 3, 4, 5])
  assert.equal(state.nextExplosionTurn, 9)
})

test('uses the normal wave below the 15-space catch-up threshold', () => {
  const state = createState([24, 40])
  state.destroyedSpaces = Array.from({ length: 10 }, (_, index) => index + 1)

  assert.deepEqual(planRunAwayDestruction(state, 4), [11, 12, 13, 14])
})

test('a 15-space gap destroys through a five-space safety gap', () => {
  const state = createState([25, 50])
  state.destroyedSpaces = Array.from({ length: 10 }, (_, index) => index + 1)

  assert.deepEqual(
    planRunAwayDestruction(state, 4),
    [11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
  )
})

test('a gap larger than 15 catches up to five spaces behind the closest player', () => {
  const state = createState([36, 60])
  state.destroyedSpaces = Array.from({ length: 20 }, (_, index) => index + 1)

  const spaces = planRunAwayDestruction(state, 4)

  assert.equal(spaces.at(-1), 31)
  assert.equal(state.players[0].space - spaces.at(-1), 5)
})

test('takeTurn schedules the catch-up count in lastExplosion', () => {
  const state = createState([25, 50])
  state.destroyedSpaces = Array.from({ length: 10 }, (_, index) => index + 1)
  state.nextExplosionTurn = 1

  takeTurn(state, 0)
  assert.equal(state.lastExplosion, null)
  takeTurn(state, 0)

  assert.equal(state.lastExplosion.spaces.length, 10)
  assert.equal(state.lastExplosion.spaces.at(-1), 20)
})

test('Run Away destruction starts only after every player completes the scheduled global turn', () => {
  const state = createState([10, 20, 30])
  state.nextExplosionTurn = 3

  for (let action = 0; action < 8; action += 1) {
    takeTurn(state, 0)
    assert.equal(state.lastExplosion, null)
  }

  assert.equal(state.turn, 3)
  takeTurn(state, 0)
  assert.equal(state.turn, 4)
  assert.ok(state.lastExplosion?.spaces.length)
})

test('Hidden Mine allows the whole board except endpoints, question marks, and ladder-connected squares', () => {
  const state = createState([20, 25])
  state.board.question_marks = [18]
  state.board.ladders = [{ from: 22, to: 40 }]

  const options = hiddenMineOptions(state)
  assert.equal(options[0], 2)
  assert.equal(options.at(-1), 99)
  assert.equal(options.includes(18), false)
  assert.equal(options.includes(22), false)
  assert.equal(options.includes(40), false)
  assert.equal(options.includes(11), false)
  assert.equal(options.includes(20), false)
  assert.equal(options.includes(23), true)
})

test('Hidden Mine pushes another player back without crossing the row edge', () => {
  const state = createState([15, 11])
  state.players[0].specialSkill = { name: 'Hidden Mine' }
  state.players[0].skillCooldownUntil = 0
  const placed = activateSkill(state, 1, 12)
  assert.equal(placed.ok, true)

  state.currentPlayerIndex = 1
  state.nextExplosionTurn = 99
  takeTurn(state, 1)

  assert.equal(state.players[1].space, 11)
  assert.equal(state.lastMineExplosion.landedSpace, 12)
  assert.equal(state.lastMineExplosion.destination, 11)
  assert.deepEqual(state.hiddenMines, [])
})

test('Hidden Mine applies a WHAT after blowing a player onto a question square', () => {
  const state = createState([15, 11])
  state.board.question_marks = [11]
  state.board.whats = [{
    name: 'Mine Surprise',
    spawn_locations: { start: 1, end: 99 },
    effects: [{ effect: 'lose_turn', turns: 1, description: 'Lose a turn.' }],
  }]
  state.hiddenMines = [{ ownerId: 'player-1', space: 12 }]
  state.currentPlayerIndex = 1
  state.nextExplosionTurn = 99

  takeTurn(state, 1)

  assert.equal(state.players[1].space, 11)
  assert.equal(state.players[1].skipTurns, 1)
  assert.equal(state.lastQuestionChain[0].kind, 'mine')
  assert.equal(state.lastQuestionChain[1].what.name, 'Mine Surprise')
})

test('Hidden Mine placement excludes occupied squares and keeps the newest two mines', () => {
  const state = createState([15, 24, 35])
  state.players[0].specialSkill = { name: 'Hidden Mine' }
  state.players[0].skillCooldownUntil = 0

  assert.equal(hiddenMineOptions(state).includes(24), false)
  assert.equal(hiddenMineOptions(state).includes(35), false)

  activateSkill(state, 1, 22)
  state.players[0].skillCooldownUntil = 0
  activateSkill(state, 2, 23)
  state.players[0].skillCooldownUntil = 0
  activateSkill(state, 3, 25)

  assert.deepEqual(state.hiddenMines, [
    { ownerId: 'player-1', space: 23 },
    { ownerId: 'player-1', space: 25 },
  ])
})

test('movement skills resolve question squares in skill-user-first order', () => {
  const state = createState([12, 18])
  state.board.question_marks = [12, 15, 18]
  state.board.whats = [{
    name: 'Ordered Surprise',
    spawn_locations: { start: 1, end: 99 },
    effects: [{ effect: 'lose_turn', turns: 1, description: 'Lose a turn.' }],
  }]
  state.players[0].skillCooldownUntil = 0
  state.players[0].specialSkill = { name: 'Switcheroo' }

  const switchResult = activateSkill(state, 1)
  assert.deepEqual(switchResult.landingResolutions.map(item => item.playerId), ['player-1', 'player-2'])
  assert.equal(state.players[0].skipTurns, 1)
  assert.equal(state.players[1].skipTurns, 1)

  state.players[0].skillCooldownUntil = 0
  state.players[0].specialSkill = { name: 'Intersect' }
  state.players[0].space = 12
  state.players[1].space = 18
  const intersectResult = activateSkill(state, 2)
  assert.deepEqual(intersectResult.landingResolutions.map(item => item.playerId), ['player-1', 'player-2'])

  state.players[0].skillCooldownUntil = 0
  state.players[0].specialSkill = { name: 'Magnet' }
  state.players[0].space = 12
  state.players[1].space = 18
  const magnetResult = activateSkill(state, 3)
  assert.deepEqual(magnetResult.landingResolutions.map(item => item.playerId), ['player-2'])
})

test('Hidden Mine clamps to the correct visual edge on alternating rows', () => {
  assert.deepEqual(minePushDestination(3, 4), { destination: 1, edge: 'left' })
  assert.deepEqual(minePushDestination(13, 4), { destination: 11, edge: 'right' })
  assert.deepEqual(minePushDestination(26, 2), { destination: 24, edge: 'left' })
  assert.deepEqual(minePushDestination(36, 2), { destination: 34, edge: 'right' })
})

test('Exact Move for S100 bounces excess movement backward', () => {
  const state = createState([96, 20])
  state.exactMoveFor100 = true
  state.nextExplosionTurn = 99

  takeTurn(state, 6)

  assert.equal(state.players[0].space, 98)
  assert.equal(state.players[0].finished, false)
  assert.deepEqual(state.lastExactBounce, {
    playerId: 'player-1',
    from: 96,
    destination: 98,
    extra: 2,
  })
})

test('Exact Move records the bounce before resolving a WHAT at its destination', () => {
  const exactBoard = {
    ...board,
    question_marks: [98],
    whats: [{
      name: 'Bounce Surprise',
      spawn_locations: { start: 1, end: 99 },
      effects: [{ effect: 'lose_turn', turns: 1, description: 'Lose a turn.' }],
    }],
  }
  const state = createGameState(exactBoard, [
    { id: 'player-1', name: 'Player 1' },
    { id: 'player-2', name: 'Player 2' },
  ], 0, { exactMoveFor100: true })
  state.players[0].space = 96
  state.nextExplosionTurn = 99

  takeTurn(state, 6)

  assert.equal(state.lastExactBounce.destination, 98)
  assert.equal(state.lastQuestionChain[0].space, 98)
  assert.equal(state.players[0].skipTurns, 1)
})

test('Exact Move also bounces movement caused by a WHAT effect', () => {
  const state = createState([98, 20])
  state.exactMoveFor100 = true
  state.nextExplosionTurn = 99
  const player = state.players[0]

  const steps = applyWhatEffects(state, player, {
    name: 'Launch',
    effects: [{ effect: 'move_forward', spaces: 5 }],
  })

  assert.equal(player.space, 97)
  assert.equal(state.lastExactBounce, null)
  assert.deepEqual(steps[0].exactBounce, {
    playerId: 'player-1',
    from: 98,
    destination: 97,
    extra: 3,
  })
})

test('default movement still finishes when a roll exceeds Square 100', () => {
  const state = createState([96, 20])
  state.nextExplosionTurn = 99

  takeTurn(state, 6)

  assert.equal(state.players[0].space, 100)
  assert.equal(state.players[0].finished, true)
})

test('Run Away exact-move bounce traverses the return path', () => {
  const state = createState([96, 20])
  state.exactMoveFor100 = true
  state.destroyedSpaces = [99]
  state.nextExplosionTurn = 99

  takeTurn(state, 6)

  assert.equal(state.players[0].space, 99)
  assert.equal(state.players[0].eliminated, true)
})

test('finished, eliminated, and forfeited players do not control destruction', () => {
  const state = createState([25, 30, 45, 60])
  state.destroyedSpaces = Array.from({ length: 10 }, (_, index) => index + 1)
  state.players[0].finished = true
  state.players[1].eliminated = true
  state.players[2].forfeited = true
  state.players[2].finished = true

  const spaces = planRunAwayDestruction(state, 4)

  assert.equal(spaces.at(-1), 55)
})

test('destruction never includes Square 100', () => {
  const state = createState([100, 100])
  state.destroyedSpaces = Array.from({ length: 80 }, (_, index) => index + 1)

  assert.equal(planRunAwayDestruction(state, 7).at(-1), 95)
  state.destroyedSpaces = Array.from({ length: 90 }, (_, index) => index + 1)
  state.players.forEach(player => {
    player.finished = true
  })
  assert.equal(planRunAwayDestruction(state, 20).at(-1), 99)
})

test('negative Run Away results at Square 1 report that the player stays', () => {
  for (const result of [-1, -2, -3]) {
    const description = describeRunAwayRoll('Ava', 1, result)

    assert.equal(description.resultLabel, 'Ava stays on Square 1')
    assert.deepEqual(description.movement, {
      spaces: 0,
      signedSpaces: 0,
      direction: 'stay',
      message: 'Ava stays on Square 1',
    })
  }
})

test('a negative turn at Square 1 keeps position and records the stay', () => {
  const state = createState([1, 20])
  state.nextExplosionTurn = 99

  takeTurn(state, -4)

  assert.equal(state.players[0].space, 1)
  assert.equal(state.lastEvent, 'Player 1 rolled -4 and stays on Square 1.')
})

test('ordinary Run Away roll descriptions are unchanged', () => {
  assert.equal(describeRunAwayRoll('Ava', 12, 3).resultLabel, 'Move 3 spaces forward')
  assert.equal(describeRunAwayRoll('Ava', 12, -2).resultLabel, 'Move 2 spaces backward')
  assert.equal(describeRunAwayRoll('Ava', 12, 0).resultLabel, 'Stay on this square')
})

test('standard mode never plans Run Away destruction', () => {
  const state = createState([40, 60])
  state.mode = 'standard'

  assert.deepEqual(planRunAwayDestruction(state, 7), [])
})

test('simultaneous destruction of every player ends with no winner', () => {
  const state = createState([12, 12, 12])

  const result = destroySpace(state, 12)

  assert.equal(result.players.length, 3)
  assert.equal(state.gameOver, true)
  assert.equal(state.winner, null)
  assert.equal(state.loser, null)
  assert.equal(state.players.every(player => player.eliminated && !player.won), true)
  assert.equal(state.lastEvent, 'Every player was eliminated by the destruction. Nobody wins.')
})

test('destruction is planned from positions after a skill resolves', () => {
  const state = createState([25, 15])
  state.currentPlayerIndex = 1
  state.turn = 1
  state.nextExplosionTurn = 1
  state.players[1].specialSkill = { name: 'Intersect' }
  state.players[1].skillCooldownUntil = 0

  const result = activateSkill(state, 1)

  assert.equal(result.ok, true)
  assert.deepEqual(state.players.map(player => player.space), [20, 20])
  assert.equal(state.lastExplosion, null)

  endTurnAfterSkill(state)

  assert.equal(state.turn, 2)
  assert.equal(state.lastExplosion.spaces.at(-1), 15)
})

test('Water Well defers cooldown removal until the affected player next turn', () => {
  const waterWellBoard = {
    ...board,
    question_marks: [2],
    whats: [{
      name: 'Water Well',
      spawn_locations: { start: 1, end: 99 },
      effects: [{ type: 'skill', effect: 'activate_skill', description: 'Refresh next turn.' }],
    }],
  }
  const state = createGameState(waterWellBoard, [
    { id: 'player-1', name: 'Player 1' },
    { id: 'player-2', name: 'Player 2' },
  ], 0)
  state.nextExplosionTurn = 99
  const activeCooldown = Date.now() + 120_000
  state.players[0].skillCooldownUntil = activeCooldown

  takeTurn(state, 1)

  assert.equal(state.currentPlayerIndex, 1)
  assert.equal(state.players[0].skillCooldownUntil, activeCooldown)
  assert.equal(state.players[0].skillRefreshPending, true)

  takeTurn(state, 0)

  assert.equal(state.currentPlayerIndex, 0)
  assert.equal(state.players[0].skillCooldownUntil, 0)
  assert.equal(state.players[0].skillRefreshPending, false)
})

test('Water Well refresh survives a skipped next turn without clearing skill blocks', () => {
  const state = createState([1, 1])
  const refreshedPlayer = state.players[0]
  refreshedPlayer.skillCooldownUntil = 120_000
  refreshedPlayer.skillRefreshPending = true
  refreshedPlayer.skillBlockedTurns = 2
  refreshedPlayer.skipTurns = 1
  state.currentPlayerIndex = 1
  state.nextExplosionTurn = 99

  takeTurn(state, 0)

  assert.equal(state.currentPlayerIndex, 0)
  assert.equal(refreshedPlayer.skillCooldownUntil, 0)
  assert.equal(refreshedPlayer.skillRefreshPending, false)
  assert.equal(refreshedPlayer.skillBlockedTurns, 2)

  takeTurn(state)

  assert.equal(refreshedPlayer.skipTurns, 0)
  assert.equal(refreshedPlayer.skillBlockedTurns, 1)
  assert.equal(refreshedPlayer.skillCooldownUntil, 0)
})

test('Water Well does nothing when the skill is already ready', () => {
  const waterWellBoard = {
    ...board,
    question_marks: [2],
    whats: [{
      name: 'Water Well',
      spawn_locations: { start: 1, end: 99 },
      effects: [{ type: 'skill', effect: 'activate_skill', description: 'Refresh next turn.' }],
    }],
  }
  const state = createGameState(waterWellBoard, [
    { id: 'player-1', name: 'Player 1' },
    { id: 'player-2', name: 'Player 2' },
  ], 0)
  state.nextExplosionTurn = 99
  state.players[0].skillCooldownUntil = 0

  takeTurn(state, 1)

  assert.equal(state.players[0].skillRefreshPending, false)
  assert.equal(state.players[0].skillCooldownUntil, 0)
})

test('WHAT effects are applied and recorded in array order', () => {
  const state = createState([10, 40])
  const player = state.players[0]
  const what = {
    name: 'Ordered WHAT',
    effects: [
      { type: 'move', effect: 'move_forward', spaces: 4, description: 'Forward.' },
      { type: 'move', effect: 'move_back', spaces: 1, description: 'Backward.' },
      { type: 'stop', effect: 'lose_turn', turns: 2, description: 'Stop.' },
      { type: 'skill', effect: 'lose_skill', turns: 3, description: 'Blocked.' },
    ],
  }

  const effects = applyWhatEffects(state, player, what)

  assert.equal(player.space, 13)
  assert.equal(player.skipTurns, 2)
  assert.equal(player.skillBlockedTurns, 3)
  assert.deepEqual(
    effects.map(step => [step.definition.effect, step.from, step.destination]),
    [
      ['move_forward', 10, 14],
      ['move_back', 14, 13],
      ['lose_turn', 13, 13],
      ['lose_skill', 13, 13],
    ],
  )
})

test('question resolution preserves ordered WHAT effect steps', () => {
  const orderedBoard = {
    ...board,
    question_marks: [2],
    whats: [{
      name: 'Two Moves',
      spawn_locations: { start: 1, end: 99 },
      effects: [
        { type: 'move', effect: 'move_forward', spaces: 4, description: 'Forward four.' },
        { type: 'move', effect: 'move_back', spaces: 2, description: 'Back two.' },
      ],
    }],
  }
  const state = createGameState(orderedBoard, [
    { id: 'player-1', name: 'Player 1' },
    { id: 'player-2', name: 'Player 2' },
  ], 0)
  state.nextExplosionTurn = 99

  takeTurn(state, 1)

  assert.equal(state.players[0].space, 4)
  assert.deepEqual(
    state.lastQuestionChain[0].effects.map(step => step.destination),
    [6, 4],
  )
  assert.match(state.log[0], /Forward four\. Back two\./)
})

test('a multi-effect WHAT completes before resolving a chained WHAT landing', () => {
  const chainedBoard = {
    ...board,
    question_marks: [73, 98],
    whats: [
      {
        name: 'Kraken',
        spawn_locations: { start: 98, end: 98 },
        effects: [
          { type: 'move', effect: 'move_back', spaces: 25, description: 'Back twenty-five.' },
          { type: 'stop', effect: 'lose_turn', turns: 2, description: 'Lose two turns.' },
        ],
      },
      {
        name: 'Chained WHAT',
        spawn_locations: { start: 73, end: 73 },
        effects: [
          { type: 'skill', effect: 'lose_skill', turns: 1, description: 'Skill blocked.' },
        ],
      },
    ],
  }
  const state = createGameState(chainedBoard, [
    { id: 'player-1', name: 'Player 1' },
    { id: 'player-2', name: 'Player 2' },
  ], 0)
  state.players[0].space = 97

  takeTurn(state, 1)

  assert.deepEqual(state.lastQuestionChain.map(item => item.what.name), ['Kraken', 'Chained WHAT'])
  assert.deepEqual(state.lastQuestionChain[0].effects.map(step => step.definition.effect), ['move_back', 'lose_turn'])
  assert.equal(state.lastQuestionChain[0].destination, 73)
  assert.equal(state.lastQuestionChain[1].space, 73)
  assert.equal(state.lastQuestionChain[1].effects[0].definition.effect, 'lose_skill')
  assert.equal(state.players[0].skipTurns, 2)
})
