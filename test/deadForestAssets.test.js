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
      extensions.push({
        transparent: Boolean(buffer[index + 3] & 0x01),
        durationMs: buffer.readUInt16LE(index + 4) * 10,
      })
    }
  }
  return extensions
}

function pngChunks(buffer) {
  const chunks = []
  let offset = 8
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    chunks.push({ type, data })
    offset += 12 + length
  }
  return chunks
}

function animatedPngFrames(buffer) {
  const chunks = pngChunks(buffer)
  const header = chunks.find(chunk => chunk.type === 'IHDR')
  const control = chunks.find(chunk => chunk.type === 'acTL')
  const frames = chunks
    .filter(chunk => chunk.type === 'fcTL')
    .map(chunk => {
      const numerator = chunk.data.readUInt16BE(20)
      const denominator = chunk.data.readUInt16BE(22) || 100
      return { durationMs: Math.round((numerator / denominator) * 1000) }
    })
  return {
    colorType: header?.data[9],
    declaredFrames: control?.data.readUInt32BE(0) ?? 0,
    frames,
  }
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

test('Clash melee effect animations use transparent APNG frames', () => {
  const effects = [
    ['assets/gifs/clash_with/no_mans_land/weapons/slash_attack_effect.png', 41, 820],
    ['assets/gifs/clash_with/no_mans_land/weapons/melee_attacked_effect.png', 64, 1920],
  ]
  for (const [path, expectedFrames, expectedDurationMs] of effects) {
    const animation = animatedPngFrames(readFileSync(resolve(root, path)))
    assert.equal(animation.colorType, 6, path)
    assert.equal(animation.declaredFrames, expectedFrames, path)
    assert.equal(animation.frames.length, expectedFrames, path)
    assert.equal(animation.frames.reduce((sum, frame) => sum + frame.durationMs, 0), expectedDurationMs, path)
  }
})
