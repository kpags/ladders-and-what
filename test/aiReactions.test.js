import test from 'node:test'
import assert from 'node:assert/strict'
import { aiReactionOptions, chooseAiReactions } from '../server/aiReactions.js'

const players = [
  { id: 'human', isAI: false },
  { id: 'ai-1', isAI: true },
  { id: 'ai-2', isAI: true },
]

test('AI reaction pools match self and other player outcomes', () => {
  assert.deepEqual(aiReactionOptions(true, 'negative').map(item => item.value), ['😐', '😭'])
  assert.deepEqual(aiReactionOptions(false, 'positive').map(item => item.value), ['😐', 'boo'])
  assert.deepEqual(aiReactionOptions(false, 'finish'), [{ type: 'sound', value: 'boo' }])
  assert.deepEqual(aiReactionOptions(true, 'finish').map(item => item.value), ['😂', '😎', '😛', 'laugh'])
})

test('each eligible AI independently receives a 50 percent reaction roll', () => {
  const rolls = [0.49, 0, 0.5]
  const reactions = chooseAiReactions(players, 'human', 'positive', () => rolls.shift())

  assert.deepEqual(reactions, [{ playerId: 'ai-1', type: 'emoji', value: '😐' }])
})
