import test from 'node:test'
import assert from 'node:assert/strict'
import boards from '../data/boards.json' with { type: 'json' }
import questions from '../data/guess_what_questions.json' with { type: 'json' }
import { createGameState, resolveGuessWhatAnswer, takeGuessWhatTurn } from '../src/gameRules.js'

const horizon = boards.find(board => board.name === 'Horizon')
const mathemagician = boards.find(board => board.name === 'Mathemagician')
const players = [
  { id: 'one', name: 'One', color: '#fff' },
  { id: 'two', name: 'Two', color: '#000' },
]

test('Horizon preserves its authored question squares and initializes 40 questions per difficulty', () => {
  const state = createGameState(horizon, players, 0, {
    exactMoveFor100: true,
    questionnaire: questions.space,
  })
  assert.deepEqual(state.board.question_marks, horizon.question_marks)
  assert.deepEqual(
    Object.fromEntries(Object.entries(state.remainingQuestionIds).map(([key, ids]) => [key, ids.length])),
    { easy: 40, medium: 40, hard: 40 },
  )
  assert.equal(state.exactMoveFor100, false)
})

test('Mathemagician initializes the math questionnaire from the nested questionnaire object', () => {
  const state = createGameState(mathemagician, players, 0, {
    questionnaire: questions.math,
  })
  assert.equal(state.board.questionnaire, 'math')
  assert.deepEqual(state.board.question_marks, mathemagician.question_marks)
  assert.deepEqual(
    Object.fromEntries(Object.entries(state.remainingQuestionIds).map(([key, ids]) => [key, ids.length])),
    { easy: 40, medium: 40, hard: 40 },
  )
})

test('Guess What rolls use faces 1 through 6 and pause on a question square', () => {
  const state = createGameState(horizon, players, 0, { questionnaire: questions.space })
  state.players[0].space = 3
  const result = takeGuessWhatTurn(state, 1)
  assert.equal(result.roll, 1)
  assert.equal(result.destination, 4)
  assert.equal(result.needsQuestion, true)
  assert.equal(state.currentPlayerIndex, 0)
})

test('a wrong answer landing on another question square starts another question', () => {
  const state = createGameState(horizon, players, 0, { questionnaire: questions.space })
  state.players[0].space = 8
  const result = resolveGuessWhatAnswer(state, 'one', {
    questionId: 1,
    correct: false,
    movement: -4,
  })

  assert.equal(result.destination, 4)
  assert.equal(result.needsQuestion, true)
  assert.equal(state.currentPlayerIndex, 0)
  assert.equal(state.remainingQuestionIds.easy.includes(1), true)
})

test('correct questions are removed while wrong questions remain available', () => {
  const correctState = createGameState(horizon, players, 0, { questionnaire: questions.space })
  correctState.players[0].space = 4
  const correct = resolveGuessWhatAnswer(correctState, 'one', {
    questionId: 1,
    correct: true,
    movement: 6,
  })
  assert.equal(correct.destination, 10)
  assert.equal(correctState.remainingQuestionIds.easy.includes(1), false)

  const wrongState = createGameState(horizon, players, 0, { questionnaire: questions.space })
  wrongState.players[0].space = 4
  const wrong = resolveGuessWhatAnswer(wrongState, 'one', {
    questionId: 1,
    correct: false,
    movement: -4,
  })
  assert.equal(wrong.destination, 1)
  assert.equal(wrongState.remainingQuestionIds.easy.includes(1), true)
})

test('Guess What ignores exact-move settings and finishes overshooting Square 100', () => {
  const state = createGameState(horizon, players, 0, {
    exactMoveFor100: true,
    questionnaire: questions.space,
  })
  state.players[0].space = 98
  const result = takeGuessWhatTurn(state, 4)
  assert.equal(result.destination, 100)
  assert.equal(result.exactBounce, null)
  assert.equal(result.player.finished, true)
})
