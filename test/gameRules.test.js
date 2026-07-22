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
  takeParkourWhat,
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

function withMockRandom(value, fn) {
  const original = Math.random
  Math.random = () => value
  try {
    return fn()
  } finally {
    Math.random = original
  }
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

test('Hidden Mine allows the whole board except endpoints, question marks, and occupied squares', () => {
  const state = createState([20, 25])
  state.board.question_marks = [18]
  state.board.ladders = [{ from: 22, to: 40 }]

  const options = hiddenMineOptions(state)
  assert.equal(options[0], 2)
  assert.equal(options.at(-1), 99)
  assert.equal(options.includes(18), false)
  assert.equal(options.includes(22), true)
  assert.equal(options.includes(40), true)
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
  withMockRandom(0, () => takeTurn(state, 1))

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

  withMockRandom(0, () => takeTurn(state, 1))

  assert.equal(state.players[1].space, 11)
  assert.equal(state.players[1].skipTurns, 1)
  assert.equal(state.lastQuestionChain[0].kind, 'mine')
  assert.equal(state.lastQuestionChain[1].what.name, 'Mine Surprise')
})

test('Hidden Mine applies a WHAT after blasting its owner forward', () => {
  const state = createState([10, 30])
  state.board.question_marks = [14]
  state.board.whats = [{
    name: 'Owner Surprise',
    spawn_locations: { start: 1, end: 99 },
    effects: [{ effect: 'lose_turn', turns: 1, description: 'Lose a turn.' }],
  }]
  state.hiddenMines = [{ ownerId: 'player-1', space: 12 }]
  state.nextExplosionTurn = 99

  withMockRandom(0.99, () => takeTurn(state, 2))

  assert.equal(state.players[0].space, 14)
  assert.equal(state.players[0].skipTurns, 1)
  assert.equal(state.lastQuestionChain[0].kind, 'mine')
  assert.equal(state.lastQuestionChain[1].what.name, 'Owner Surprise')
})

test('Hidden Mine applies a WHAT after a mid-move pushback', () => {
  const state = createState([15, 10])
  state.board.question_marks = [11]
  state.board.whats = [{
    name: 'Interrupted Surprise',
    spawn_locations: { start: 1, end: 99 },
    effects: [{ effect: 'lose_turn', turns: 1, description: 'Lose a turn.' }],
  }]
  state.hiddenMines = [{ ownerId: 'player-1', space: 12 }]
  state.currentPlayerIndex = 1
  state.nextExplosionTurn = 99

  withMockRandom(0.99, () => takeTurn(state, 5))

  assert.equal(state.players[1].space, 11)
  assert.equal(state.players[1].skipTurns, 1)
  assert.equal(state.lastQuestionChain[0].kind, 'mine')
  assert.equal(state.lastQuestionChain[1].what.name, 'Interrupted Surprise')
})

test('movement skills trigger a mine when another player lands on it', () => {
  const state = createState([12, 18, 50])
  state.players[0].specialSkill = { name: 'Switcheroo' }
  state.players[0].skillCooldownUntil = 0
  state.hiddenMines = [{ ownerId: 'player-3', space: 12 }]

  const result = withMockRandom(0, () => activateSkill(state, 1))

  assert.equal(result.ok, true)
  assert.equal(state.players[1].space, 11)
  assert.deepEqual(state.hiddenMines, [])
  assert.equal(state.lastMineExplosion.playerId, 'player-2')
  const targetLanding = result.landingResolutions.find(item => item.playerId === 'player-2')
  assert.equal(targetLanding.questionChain[0].kind, 'mine')
  assert.equal(targetLanding.questionChain[0].landedSpace, 12)
})

test('Hidden Mine interrupts movement and limits mid-move pushback to two spaces', () => {
  const state = createState([15, 10])
  state.hiddenMines = [{ ownerId: 'player-1', space: 12 }]
  state.currentPlayerIndex = 1
  state.nextExplosionTurn = 99

  withMockRandom(0.99, () => takeTurn(state, 5))

  assert.equal(state.lastMineExplosion.duringMove, true)
  assert.equal(state.lastMineExplosion.landedSpace, 12)
  assert.equal(state.lastMineExplosion.distance, 2)
  assert.equal(state.players[1].space, 11)
  assert.equal(state.currentPlayerIndex, 0)
})

test('Hidden Mine pushes its owner forward and ends the turn immediately', () => {
  const state = createState([10, 30])
  state.hiddenMines = [{ ownerId: 'player-1', space: 12 }]
  state.nextExplosionTurn = 99

  withMockRandom(0.99, () => takeTurn(state, 5))

  assert.equal(state.lastMineExplosion.selfTriggered, true)
  assert.equal(state.lastMineExplosion.direction, 'forward')
  assert.equal(state.lastMineExplosion.landedSpace, 12)
  assert.equal(state.players[0].space, 14)
  assert.equal(state.currentPlayerIndex, 1)
})

test('Bomber Jack mine at ladder top pushes owner forward from the ladder top', () => {
  const state = createState([10, 30])
  state.board.ladders = [{ from: 14, to: 22 }]
  state.hiddenMines = [{ ownerId: 'player-1', space: 22 }]
  state.nextExplosionTurn = 99

  // player-1 at 10 rolls 4 → lands on 14 → climbs to 22 → own mine explodes
  // withMockRandom(0.99): randomInteger(1, 2) = 2
  // mineForwardDestination(22, 2): rowEnd=30, destination=24
  withMockRandom(0.99, () => takeTurn(state, 4))

  assert.equal(state.lastMineExplosion.selfTriggered, true)
  assert.equal(state.lastMineExplosion.landedSpace, 22)
  assert.equal(state.lastMineExplosion.pushOrigin, 14)
  assert.equal(state.players[0].space, 24)
  assert.equal(state.currentPlayerIndex, 1)
})

test('Hidden Mine on ladder bottom prevents climbing and pushes back', () => {
  const state = createState([15, 20])
  state.board.ladders = [{ from: 22, to: 40 }]
  state.hiddenMines = [{ ownerId: 'player-1', space: 22 }]
  state.currentPlayerIndex = 1
  state.nextExplosionTurn = 99

  withMockRandom(0, () => takeTurn(state, 2))

  assert.equal(state.lastMineExplosion.landedSpace, 22)
  assert.equal(state.lastMineExplosion.ladder, null)
  assert.equal(state.players[1].space, 21)
})

test('Hidden Mine on ladder top explodes after climbing and returns player to ladder bottom', () => {
  const state = createState([15, 20])
  state.board.ladders = [{ from: 22, to: 40 }]
  state.hiddenMines = [{ ownerId: 'player-1', space: 40 }]
  state.currentPlayerIndex = 1
  state.nextExplosionTurn = 99

  withMockRandom(0, () => takeTurn(state, 2))

  assert.deepEqual(state.lastMineExplosion.ladder, { from: 22, to: 40 })
  assert.equal(state.lastMineExplosion.landedSpace, 40)
  assert.equal(state.lastMineExplosion.pushOrigin, 22)
  assert.equal(state.players[1].space, 22)
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

test('Exact Move retriggers a random WHAT after an effect bounces back to the same question square', () => {
  const exactBoard = {
    ...board,
    question_marks: [98],
    whats: [
      {
        name: 'Over the Finish',
        spawn_locations: { start: 98, end: 98 },
        effects: [{ effect: 'move_forward', spaces: 4, description: 'Move forward four.' }],
      },
      {
        name: 'Bounce Follow-up',
        spawn_locations: { start: 98, end: 98 },
        effects: [{ effect: 'lose_turn', turns: 1, description: 'Lose a turn.' }],
      },
    ],
  }
  const state = createGameState(exactBoard, [
    { id: 'player-1', name: 'Player 1' },
    { id: 'player-2', name: 'Player 2' },
  ], 0, { exactMoveFor100: true })
  state.players[0].space = 97
  state.nextExplosionTurn = 99

  const originalRandom = Math.random
  Math.random = () => 0
  try {
    takeTurn(state, 1)
  } finally {
    Math.random = originalRandom
  }

  assert.equal(state.players[0].space, 98)
  assert.equal(state.players[0].skipTurns, 1)
  assert.deepEqual(
    state.lastQuestionChain.map(item => item.what.name),
    ['Over the Finish', 'Bounce Follow-up'],
  )
  assert.equal(state.lastQuestionChain[0].effects[0].exactBounce.destination, 98)
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

test('Parkour Misdirect moves back zero to three spaces', () => {
  for (const spaces of [0, 1, 2, 3]) {
    const state = createState([20, 40])
    state.nextExplosionTurn = 99
    state.players[0].specialRollPending = true
    const result = takeParkourWhat(state, {
      name: 'Misdirect',
      effects: [{
        type: 'move',
        effect: 'move_back',
        spaces,
        description: spaces ? `Back ${spaces}.` : 'Stay.',
      }],
    })

    assert.equal(result.from, 20)
    assert.equal(result.directDestination, 20 - spaces)
    assert.equal(state.players[0].space, 20 - spaces)
    assert.equal(state.players[0].specialRollPending, false)
  }
})

test('Parkour Weakened delays the cooldown start by two global turns', () => {
  const state = createState([10, 20])
  state.nextExplosionTurn = 99
  state.players[0].specialRollPending = true
  state.players[0].skillCooldownUntil = 120_000

  takeParkourWhat(state, {
    name: 'Weakened',
    effects: [{
      type: 'skill',
      effect: 'delay_skill_cooldown',
      turns: 2,
      description: 'Delayed.',
    }],
  })

  assert.equal(state.players[0].skillCooldownUntil, 0)
  assert.equal(state.players[0].delayedSkillCooldownStartTurn, 3)
  state.currentPlayerIndex = 0
  assert.equal(activateSkill(state, 1).ok, false)
  state.currentPlayerIndex = 1

  takeTurn(state, 0)

  assert.equal(state.turn, 2)
  assert.equal(state.players[0].delayedSkillCooldownStartTurn, 3)
  assert.equal(state.players[0].skillCooldownUntil, 0)

  takeTurn(state, 0)

  assert.equal(state.turn, 2)
  assert.equal(state.players[0].delayedSkillCooldownStartTurn, 3)
  assert.equal(state.players[0].skillCooldownUntil, 0)

  takeTurn(state, 0)

  assert.equal(state.turn, 3)
  assert.equal(state.players[0].delayedSkillCooldownStartTurn, null)
  assert.ok(state.players[0].skillCooldownUntil > 0)
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

test('Ragebait moves any selected player back, applies its consequence, and resolves a WHAT landing', () => {
  const rageBoard = {
    ...board,
    question_marks: [25],
    whats: [{
      name: 'Ragebait Landing',
      spawn_locations: { start: 25, end: 25 },
      effects: [{ type: 'stop', effect: 'lose_turn', turns: 1, description: 'Lose one turn.' }],
    }],
  }
  const state = createGameState(rageBoard, [
    { id: 'karen', name: 'Crab Karen', specialSkill: { name: 'Ragebait' } },
    { id: 'target', name: 'Target' },
    { id: 'other', name: 'Other' },
  ], 0)
  state.players[0].skillCooldownUntil = 0
  state.players[1].space = 40

  const result = activateSkill(state, 1, 'target')

  assert.equal(result.ok, true)
  assert.deepEqual(result.movement, { playerId: 'target', from: 40, to: 25 })
  assert.equal(state.players[0].skipTurns, 2)
  assert.equal(state.players[0].skipReason, 'Ragebait consequence')
  assert.equal(result.landingResolutions[0].landingSpace, 25)
  assert.equal(result.landingResolutions[0].questionChain[0].what.name, 'Ragebait Landing')
  assert.equal(state.players[1].skipTurns, 1)
})

test('Ragebait climbs a ladder when its target lands on the ladder bottom', () => {
  const state = createState([60, 40])
  state.board.ladders = [{ from: 25, to: 47 }]
  state.players[0].specialSkill = { name: 'Ragebait' }
  state.players[0].skillCooldownUntil = 0

  const result = activateSkill(state, 1, 'player-2')

  assert.equal(result.ok, true)
  assert.equal(result.movement.to, 25)
  assert.equal(state.players[1].space, 47)
  assert.deepEqual(result.landingResolutions[0].ladder, { from: 25, to: 47 })
})
