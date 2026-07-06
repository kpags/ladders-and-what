import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { boardIndicesForMode, boardIsAvailable, characterIndicesForMode, normalizeCharacterIndex } from '../src/lobbyCatalog.js'
import { getBoardSpaceBounds } from '../src/boardLayout.js'

const root = resolve(import.meta.dirname, '..')
const characters = JSON.parse(readFileSync(resolve(root, 'data/characters.json'), 'utf8'))
const boards = JSON.parse(readFileSync(resolve(root, 'data/boards.json'), 'utf8'))

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
