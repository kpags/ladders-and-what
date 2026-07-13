import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { activeGameModes, boardIndicesForMode, boardIsAvailable, characterIndicesForMode, gameModeIsActive, normalizeCharacterIndex } from '../src/lobbyCatalog.js'
import { getBoardSpaceBounds, getBoardSpacePosition } from '../src/boardLayout.js'

const root = resolve(import.meta.dirname, '..')
const characters = JSON.parse(readFileSync(resolve(root, 'data/characters.json'), 'utf8'))
const boards = JSON.parse(readFileSync(resolve(root, 'data/boards.json'), 'utf8'))
const gameModes = JSON.parse(readFileSync(resolve(root, 'data/game_modes.json'), 'utf8'))

test('only explicitly active game modes are selectable', () => {
  assert.equal(gameModeIsActive({ is_active: true }), true)
  assert.equal(gameModeIsActive({ is_active: false }), false)
  assert.equal(gameModeIsActive({}), false)
  assert.equal(gameModeIsActive({ is_active: 'true' }), false)
  assert.deepEqual(activeGameModes(gameModes).map(mode => mode.key), [
    'standard',
    'run_away',
    'guess_what',
    'escape_from',
    'clash_with',
  ])
})

test('character modes define the playable roster', () => {
  assert.deepEqual(characterIndicesForMode(characters, 'standard'), [0, 1, 2, 3, 4, 5, 6, 7, 8])
  assert.deepEqual(characterIndicesForMode(characters, 'run_away'), [0, 1, 2, 3, 4, 5, 6, 7, 8])
  assert.deepEqual(characterIndicesForMode(characters, 'guess_what'), [0, 1, 2, 3, 4, 5, 6, 7, 8])
  assert.deepEqual(characterIndicesForMode(characters, 'escape_from'), [9, 10, 11, 12])
})

test('incompatible and invalid character indices normalize deterministically', () => {
  assert.equal(normalizeCharacterIndex(characters, 'escape_from', 0), 9)
  assert.equal(normalizeCharacterIndex(characters, 'escape_from', 99, 2), 11)
  assert.equal(normalizeCharacterIndex(characters, 'escape_from', 12), 12)
  assert.equal(normalizeCharacterIndex(characters, 'guess_what', 0), 0)
})

test('only explicitly active characters are selectable', () => {
  const roster = [
    { name: 'Missing Active', modes: ['standard'] },
    { name: 'Inactive', is_active: false, modes: ['standard'] },
    { name: 'Truthish', is_active: 'true', modes: ['standard'] },
    { name: 'Active', is_active: true, modes: ['standard'] },
    { name: 'Other Mode', is_active: true, modes: ['escape_from'] },
  ]
  assert.deepEqual(characterIndicesForMode(roster, 'standard'), [3])
  assert.equal(normalizeCharacterIndex(roster, 'standard', 0), 3)
  assert.equal(normalizeCharacterIndex(roster, 'standard', 3), 3)
})

test('Quiet Mansion is available for Escape From', () => {
  const quietMansion = boards.find(board => board.name === 'Quiet Mansion')
  const deadForest = boards.find(board => board.name === 'Dead Forest')
  assert.equal(boardIsAvailable(quietMansion), true)
  assert.equal(boardIsAvailable(deadForest), true)
  assert.deepEqual(boardIndicesForMode(boards, 'escape_from'), [
    boards.indexOf(quietMansion),
    boards.indexOf(deadForest),
  ])
})

test('Guess What boards are available and use their centered grid positions', () => {
  const horizon = boards.find(board => board.name === 'Horizon')
  const mathemagician = boards.find(board => board.name === 'Mathemagician')
  const reminiscing = boards.find(board => board.name === 'Reminiscing')
  const throwbackPh = boards.find(board => board.name === 'Throwback PH')
  assert.equal(boardIsAvailable(mathemagician), true)
  assert.equal(boardIsAvailable(reminiscing), true)
  assert.equal(boardIsAvailable(throwbackPh), true)
  assert.deepEqual(boardIndicesForMode(boards, 'guess_what'), [
    boards.indexOf(horizon),
    boards.indexOf(mathemagician),
    boards.indexOf(reminiscing),
    boards.indexOf(throwbackPh),
  ])
  assert.deepEqual(getBoardSpacePosition(mathemagician, 1), getBoardSpacePosition(horizon, 1))
  assert.deepEqual(getBoardSpacePosition(mathemagician, 100), getBoardSpacePosition(horizon, 100))
  assert.deepEqual(getBoardSpacePosition(throwbackPh, 1), { left: '8.054%', top: '92.963%' })
  assert.deepEqual(getBoardSpacePosition(throwbackPh, 100), { left: '8.054%', top: '7.337%' })
})

test('Dead Forest exposes its Square 100 bounds for the fog reveal', () => {
  const deadForest = boards.find(board => board.name === 'Dead Forest')
  assert.deepEqual(getBoardSpaceBounds(deadForest, 100), {
    x: '3.748%',
    y: '3.868%',
    width: '9.888%',
    height: '9.888%',
  })
})

test('Quiet Mansion exposes the exact Square 100 bounds for its darkness reveal', () => {
  const quietMansion = boards.find(board => board.name === 'Quiet Mansion')
  assert.deepEqual(getBoardSpaceBounds(quietMansion, 100), {
    x: '0.718%',
    y: '0.558%',
    width: '13.397%',
    height: '12.041%',
  })
})
