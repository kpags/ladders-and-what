import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getVisualSurroundingSpaces } from '../src/boardLayout.js'

const root = resolve(import.meta.dirname, '..')
const assets = [
  'assets/gifs/escape_from/medkit.gif',
  'assets/gifs/escape_from/quiet_mansion/light_source.gif',
  'assets/gifs/escape_from/dead_forest/light_source.gif',
]

function transparencyFlags(buffer) {
  const flags = []
  for (let index = 0; index < buffer.length - 7; index++) {
    if (buffer[index] === 0x21 && buffer[index + 1] === 0xf9 && buffer[index + 2] === 0x04) {
      flags.push(Boolean(buffer[index + 3] & 0x01))
    }
  }
  return flags
}

test('Escape pickup GIFs preserve animation with transparent frames', () => {
  for (const path of assets) {
    const flags = transparencyFlags(readFileSync(resolve(root, path)))
    assert.ok(flags.length > 1, path)
    assert.ok(flags.every(Boolean), path)
  }
})

test('vision boost returns the eight visual neighbors without crossing board edges', () => {
  assert.deepEqual(new Set(getVisualSurroundingSpaces(55)), new Set([45, 46, 47, 54, 56, 65, 66, 67]))
  assert.deepEqual(new Set(getVisualSurroundingSpaces(1)), new Set([2, 19, 20]))
  assert.equal(getVisualSurroundingSpaces(10).includes(11), true)
  assert.equal(getVisualSurroundingSpaces(100).every(space => space >= 1 && space <= 100), true)
})
