import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createEscapeBriefingState,
  escapeBriefingView,
  syncEscapeBriefingPlayers,
  voteToCloseEscapeBriefing,
} from '../server/escapeBriefing.js'

const players = [
  { id: 'host', isAI: false },
  { id: 'guest', isAI: false },
  { id: 'bot', isAI: true },
]

test('Escape briefing closes only after every human player votes', () => {
  const state = createEscapeBriefingState(players)

  assert.equal(voteToCloseEscapeBriefing(state, 'bot'), false)
  assert.equal(voteToCloseEscapeBriefing(state, 'host'), true)
  assert.deepEqual(escapeBriefingView(state), {
    active: true,
    voterIds: ['host'],
    total: 2,
  })

  voteToCloseEscapeBriefing(state, 'guest')
  assert.equal(state.active, false)
})

test('Escape briefing removes a forfeited human from the required votes', () => {
  const state = createEscapeBriefingState(players)
  voteToCloseEscapeBriefing(state, 'host')

  const completed = syncEscapeBriefingPlayers(state, players.filter(player => player.id !== 'guest'))

  assert.equal(completed, true)
  assert.deepEqual(escapeBriefingView(state), {
    active: false,
    voterIds: ['host'],
    total: 1,
  })
})
