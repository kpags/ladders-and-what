import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..', 'assets', 'gifs')
function gifs(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? gifs(join(directory, entry.name))
    : entry.name.endsWith('.gif') ? [join(directory, entry.name)] : [])
}
function transparencyFlags(buffer) {
  const flags = []
  for (let index = 0; index < buffer.length - 7; index++) {
    if (buffer[index] === 0x21 && buffer[index + 1] === 0xf9 && buffer[index + 2] === 0x04) flags.push(Boolean(buffer[index + 3] & 1))
  }
  return flags
}
test('all game GIF frames declare a transparent palette entry', () => {
  for (const file of gifs(root)) {
    const flags = transparencyFlags(readFileSync(file))
    assert.ok(flags.length, `${file} has no graphic control extension`)
    assert.ok(flags.every(Boolean), `${file} has an opaque frame`)
  }
})
