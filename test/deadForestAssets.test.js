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
      extensions.push({ transparent: Boolean(buffer[index + 3] & 0x01) })
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
