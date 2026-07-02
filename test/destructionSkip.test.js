import test from 'node:test'
import assert from 'node:assert/strict'
import { createDestructionSkipState, updateDestructionSkipVote } from '../server/destructionSkip.js'

test('destruction skip requires every non-AI player and excludes AI players from the total', () => {
  const state = createDestructionSkipState([
    { id: 'host', isAI: false },
    { id: 'guest', isAI: false },
    { id: 'bot', isAI: true },
  ], 7)

  assert.deepEqual(state.humanIds, ['host', 'guest'])
  assert.equal(updateDestructionSkipVote(state, 'bot', true), false)
  assert.equal(updateDestructionSkipVote(state, 'host', true), true)
  assert.equal(state.requested, false)
  assert.equal(updateDestructionSkipVote(state, 'guest', true), true)
  assert.equal(state.requested, true)
})

test('a human player can uncheck before the vote becomes unanimous', () => {
  const state = createDestructionSkipState([
    { id: 'host', isAI: false },
    { id: 'guest', isAI: false },
  ], 3)

  updateDestructionSkipVote(state, 'host', true)
  updateDestructionSkipVote(state, 'host', false)

  assert.deepEqual([...state.voters], [])
  assert.equal(state.requested, false)
})
