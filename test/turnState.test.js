import test from 'node:test'
import assert from 'node:assert/strict'
import { canStartRoll, unlockRoomForNextTurn } from '../server/turnState.js'

function createRoom() {
  return {
    phase: 'playing',
    busy: true,
    rolling: null,
    currentEvent: { type: 'destruction_square' },
    turnDeadline: null,
    game: {
      gameOver: false,
      currentPlayerIndex: 1,
      players: [
        { id: 'player-1', isAI: false },
        { id: 'player-2', isAI: false },
      ],
    },
  }
}

test('the next player stays locked until destruction is finalized', () => {
  const room = createRoom()

  assert.equal(canStartRoll(room, 'player-2'), false)

  unlockRoomForNextTurn(room)

  assert.equal(room.busy, false)
  assert.equal(room.rolling, null)
  assert.equal(room.currentEvent, null)
  assert.equal(canStartRoll(room, 'player-2'), true)
  assert.equal(canStartRoll(room, 'player-1'), false)
})

test('a skill continuation can start its required roll without releasing the room', () => {
  const room = createRoom()
  room.currentEvent = { type: 'skill_result' }
  room.game.currentPlayerIndex = 0

  assert.equal(canStartRoll(room, 'player-1'), false)
  assert.equal(canStartRoll(room, 'player-1', false, true), true)
})

test('game-over and stale rolling states cannot be unlocked into another roll', () => {
  const gameOverRoom = createRoom()
  gameOverRoom.game.gameOver = true
  unlockRoomForNextTurn(gameOverRoom)
  assert.equal(canStartRoll(gameOverRoom, 'player-2'), false)

  const rollingRoom = createRoom()
  rollingRoom.rolling = { playerId: 'player-2' }
  assert.equal(canStartRoll(rollingRoom, 'player-2', false, true), false)
})
