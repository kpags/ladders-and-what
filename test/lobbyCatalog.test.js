import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { boardIndicesForMode, boardIsAvailable, characterIndicesForMode, normalizeCharacterIndex } from '../src/lobbyCatalog.js'

const root = resolve(import.meta.dirname, '..')
const characters = JSON.parse(readFileSync(resolve(root, 'data/characters.json'), 'utf8'))
const boards = JSON.parse(readFileSync(resolve(root, 'data/boards.json'), 'utf8'))

test('character modes define the playable roster', () => {
  assert.deepEqual(characterIndicesForMode(characters, 'standard'), [0, 1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(characterIndicesForMode(characters, 'run_away'), [0, 1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(characterIndicesForMode(characters, 'guess_what'), [])
  assert.deepEqual(characterIndicesForMode(characters, 'escape_from'), [8, 9, 10, 11])
})

test('incompatible and invalid character indices normalize deterministically', () => {
  assert.equal(normalizeCharacterIndex(characters, 'escape_from', 0), 8)
  assert.equal(normalizeCharacterIndex(characters, 'escape_from', 99, 2), 10)
  assert.equal(normalizeCharacterIndex(characters, 'escape_from', 11), 11)
  assert.equal(normalizeCharacterIndex(characters, 'guess_what', 0), null)
})

test('Quiet Mansion is available for Escape From', () => {
  const quietMansion = boards.find(board => board.name === 'Quiet Mansion')
  assert.equal(boardIsAvailable(quietMansion), true)
  assert.deepEqual(boardIndicesForMode(boards, 'escape_from'), [boards.indexOf(quietMansion)])
})
