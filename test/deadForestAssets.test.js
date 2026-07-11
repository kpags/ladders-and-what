import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const assets = [
  ['keys.gif', 12],
]

function graphicControlExtensions(buffer) {
  const extensions = []
  for (let index = 0; index < buffer.length - 7; index += 1) {
    if (buffer[index] === 0x21 && buffer[index + 1] === 0xf9 && buffer[index + 2] === 0x04) {
      const durationMs = buffer.readUInt16LE(index + 4) * 10
      if (durationMs > 5_000) continue
      extensions.push({
        transparent: Boolean(buffer[index + 3] & 0x01),
        durationMs,
      })
    }
  }
  return extensions
}

test('Dead Forest board objects preserve animation with transparent frames', () => {
  for (const [relativePath, expectedFrames] of assets) {
    const buffer = readFileSync(resolve(
      root,
      'assets/gifs/escape_from/dead_forest/transparent',
      relativePath,
    ))
    const frames = graphicControlExtensions(buffer)
    assert.ok(frames.length >= expectedFrames, relativePath)
    assert.ok(frames.every(frame => frame.transparent), relativePath)
  }
})

test('Dead Forest entity model removes only its connected background', () => {
  const path = resolve(root, 'assets/gifs/escape_from/dead_forest/entity_board_model.gif')
  const buffer = readFileSync(path)
  const frames = graphicControlExtensions(buffer)
  assert.equal(frames.length, 8)
  assert.ok(frames.every(frame => frame.transparent))
  assert.ok(frames.every(frame => frame.durationMs === 120))
})

test('Dead Forest Jean animation has a transparent background and keeps its timing', () => {
  const path = resolve(root, 'assets/gifs/escape_from/dead_forest/entities/jean/gif.gif')
  const frames = graphicControlExtensions(readFileSync(path))
  assert.equal(frames.length, 8)
  assert.ok(frames.every(frame => frame.transparent))
  assert.ok(frames.every(frame => frame.durationMs === 100))
})

test('Clash melee effect animations use transparent GIF frames', () => {
  const effects = [
    ['assets/gifs/clash_with/no_mans_land/weapons/slash_attack_effect.gif', 41, 1640],
    ['assets/gifs/clash_with/no_mans_land/weapons/melee_attacked_effect.gif', 41, 4100],
  ]
  for (const [path, expectedFrames, expectedDurationMs] of effects) {
    const frames = graphicControlExtensions(readFileSync(resolve(root, path)))
    assert.equal(frames.length, expectedFrames, path)
    assert.equal(frames.reduce((sum, frame) => sum + frame.durationMs, 0), expectedDurationMs, path)
    assert.ok(frames.some(frame => frame.transparent), path)
  }
})
