import test from 'node:test'
import assert from 'node:assert/strict'
import { chooseGuessWhatDifficulty, GUESS_WHAT_DIFFICULTY_WEIGHTS } from '../src/guessWhatWheel.js'

const allAvailable = { easy: 4, medium: 4, hard: 4 }

test('Guess What wheel uses the authored 20/50/30 probability boundaries', () => {
  assert.deepEqual(GUESS_WHAT_DIFFICULTY_WEIGHTS, { easy: 20, medium: 50, hard: 30 })
  assert.equal(chooseGuessWhatDifficulty(allAvailable, () => 0), 'easy')
  assert.equal(chooseGuessWhatDifficulty(allAvailable, () => 0.199999), 'easy')
  assert.equal(chooseGuessWhatDifficulty(allAvailable, () => 0.2), 'medium')
  assert.equal(chooseGuessWhatDifficulty(allAvailable, () => 0.699999), 'medium')
  assert.equal(chooseGuessWhatDifficulty(allAvailable, () => 0.7), 'hard')
  assert.equal(chooseGuessWhatDifficulty(allAvailable, () => 0.999999), 'hard')
})

test('Guess What wheel excludes exhausted difficulties and reweights the rest', () => {
  assert.equal(chooseGuessWhatDifficulty({ easy: 0, medium: 2, hard: 1 }, () => 0), 'medium')
  assert.equal(chooseGuessWhatDifficulty({ easy: 0, medium: 2, hard: 1 }, () => 0.6249), 'medium')
  assert.equal(chooseGuessWhatDifficulty({ easy: 0, medium: 2, hard: 1 }, () => 0.625), 'hard')
  assert.equal(chooseGuessWhatDifficulty({ easy: 0, medium: 0, hard: 1 }, () => 0), 'hard')
  assert.equal(chooseGuessWhatDifficulty({ easy: 0, medium: 0, hard: 0 }, () => 0), null)
})
