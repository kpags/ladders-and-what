import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  createWhatEffectExecutor,
  validateBoardWhats,
  validateEffectRegistry,
} from '../src/whatEffectRegistry.js'

const root = resolve(import.meta.dirname, '..')
const boards = JSON.parse(readFileSync(resolve(root, 'data/boards.json'), 'utf8'))

test('all authored WHAT effects pass registry validation', () => {
  assert.equal(validateBoardWhats(boards), true)
})

test('descriptions stay local to each board WHAT using the same effect', () => {
  const spider = boards.find(board => board.name === 'Nature').whats.find(what => what.name === 'Spider')
  const quicksand = boards.find(board => board.name === 'Desert').whats.find(what => what.name === 'Quicksand')

  assert.equal(spider.effects[0].effect, 'lose_turn')
  assert.equal(quicksand.effects[0].effect, 'lose_turn')
  assert.notEqual(spider.effects[0].description, quicksand.effects[0].description)
})

test('a new declarative effect runs without a JavaScript handler', () => {
  const registry = {
    version: 1,
    effects: {
      retreat_and_wait: {
        required: {
          spaces: 'positive_integer',
          turns: 'positive_integer',
        },
        operations: [
          { operation: 'move', amount_from: 'spaces', multiplier: -1 },
          { operation: 'add', target: 'skipTurns', amount_from: 'turns' },
          { operation: 'set', target: 'skipReason', context_value: 'what.name' },
        ],
      },
    },
  }
  const execute = createWhatEffectExecutor(registry)
  const player = {
    space: 30,
    skipTurns: 0,
    skipReason: null,
    skillBlockedTurns: 0,
    skillRefreshPending: false,
    skillCooldownUntil: 0,
  }
  const what = {
    name: 'Sandstorm',
    effects: [{
      effect: 'retreat_and_wait',
      spaces: 5,
      turns: 2,
      description: 'The storm pushes you back and stops you.',
    }],
  }

  const steps = execute({
    player,
    what,
    now: 0,
    move: destination => { player.space = destination },
  })

  assert.equal(player.space, 25)
  assert.equal(player.skipTurns, 2)
  assert.equal(player.skipReason, 'Sandstorm')
  assert.deepEqual(steps.map(step => step.destination), [25])
})

test('board validation reports unknown effects and invalid descriptions or parameters', () => {
  const board = effect => [{
    name: 'Validation Board',
    whats: [{ name: 'Broken WHAT', effects: [effect] }],
  }]

  assert.throws(
    () => validateBoardWhats(board({ effect: 'missing', description: 'Unknown.' })),
    /Board "Validation Board" WHAT "Broken WHAT" effect\[0\] references unknown effect "missing"/,
  )
  assert.throws(
    () => validateBoardWhats(board({ effect: 'move_back', spaces: 2 })),
    /requires a non-empty string description/,
  )
  assert.throws(
    () => validateBoardWhats(board({ effect: 'move_back', spaces: 0, description: 'No movement.' })),
    /spaces must be a positive integer/,
  )
})

test('registry validation rejects unsupported operations and unsafe targets', () => {
  assert.throws(
    () => validateEffectRegistry({
      version: 1,
      effects: {
        unsafe: {
          operations: [{ operation: 'set', target: 'id', value: 'changed' }],
        },
      },
    }),
    /writes unsafe target "id"/,
  )
  assert.throws(
    () => validateEffectRegistry({
      version: 1,
      effects: {
        unknown: {
          operations: [{ operation: 'delete_player' }],
        },
      },
    }),
    /unsupported operation "delete_player"/,
  )
  assert.throws(
    () => validateEffectRegistry({
      version: 1,
      effects: {
        misplaced_copy: {
          description: 'This belongs to a board WHAT.',
          operations: [{ operation: 'set', target: 'skipReason', value: 'stopped' }],
        },
      },
    }),
    /descriptions belong in boards\.json/,
  )
})
