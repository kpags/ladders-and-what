import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CLASH_MOVE_EVENT_MS, CLASH_MOVE_PUFF_MS } from '../src/gameRules.js'

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

function pngHasAlpha(buffer) {
  assert.equal(buffer.toString('ascii', 1, 4), 'PNG')
  const colorType = buffer[25]
  return colorType === 4 || colorType === 6
}

function graphicSize(buffer, path) {
  if (buffer.toString('ascii', 1, 4) === 'PNG') {
    return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)]
  }
  if (buffer.toString('ascii', 0, 3) === 'GIF') {
    return [buffer.readUInt16LE(6), buffer.readUInt16LE(8)]
  }
  throw new Error(`Unsupported graphic: ${path}`)
}

function clashModelAssetPaths() {
  const characterRoot = resolve(root, 'assets/gifs/clash_with/characters')
  const pathsByCharacter = new Map()
  for (const character of readdirSync(characterRoot, { withFileTypes: true })) {
    if (!character.isDirectory()) continue
    const characterPath = resolve(characterRoot, character.name)
    const pending = [characterPath]
    const assets = []
    while (pending.length) {
      const current = pending.pop()
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const path = resolve(current, entry.name)
        if (entry.isDirectory()) pending.push(path)
        else if (
          entry.isFile()
          && /\.(gif|png)$/i.test(entry.name)
          && !entry.name.includes('.bak')
          && entry.name !== 'image.png'
        ) {
          assets.push(path)
        }
      }
    }
    if (assets.length) pathsByCharacter.set(character.name, assets)
  }
  return pathsByCharacter
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

test('Angel Clash character assets use the canonical directional folder structure', () => {
  const directions = [
    'north',
    'south',
    'east',
    'west',
    'north_east',
    'north_west',
    'south_east',
    'south_west',
  ]
  const pngActions = ['idle', 'primary_fire', 'secondary_fire', 'throw']
  for (const action of pngActions) {
    for (const direction of directions) {
      const path = resolve(root, 'assets/gifs/clash_with/characters/angel', action, `${direction}.png`)
      assert.equal(existsSync(path), true, path)
      assert.equal(pngHasAlpha(readFileSync(path)), true, path)
      assert.notDeepEqual(graphicSize(readFileSync(path), path), [768, 1376], path)
    }
  }
})

test('every Clash melee asset directory provides the four cardinal GIFs', () => {
  const characterRoot = resolve(root, 'assets/gifs/clash_with/characters')
  const meleeDirectories = readdirSync(characterRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => resolve(characterRoot, entry.name, 'melee'))
    .filter(path => existsSync(path))

  assert.ok(meleeDirectories.length > 0)
  for (const directory of meleeDirectories) {
    for (const direction of ['north', 'south', 'east', 'west']) {
      const path = resolve(directory, `${direction}.gif`)
      assert.equal(existsSync(path), true, path)
      const buffer = readFileSync(path)
      const frames = graphicControlExtensions(buffer)
      assert.ok(frames.length > 0, path)
      assert.ok(frames.every(frame => frame.transparent), path)
      assert.deepEqual(graphicSize(buffer, path), [512, 512], path)
      assert.equal(buffer.includes(Buffer.from('NETSCAPE2.0')), false, path)
    }
  }
})

test('Clash movement puff has transparent frames after background cleanup', () => {
  const puffGif = resolve(root, 'assets/gifs/clash_with/characters/move_puff.gif')
  const frames = graphicControlExtensions(readFileSync(puffGif))
  assert.ok(frames.length > 0, puffGif)
  assert.equal(frames.reduce((sum, frame) => sum + frame.durationMs, 0), CLASH_MOVE_PUFF_MS)
  assert.ok(frames.every(frame => frame.transparent), puffGif)
})

test('legacy Clash sprint GIFs have transparent frames after background cleanup', () => {
  const sprintGifs = []
  for (const assets of clashModelAssetPaths().values()) {
    for (const path of assets) {
      const parts = path.split(/[\\/]/)
      if (path.endsWith('.gif') && (parts.includes('sprint') || parts.at(-1).startsWith('sprint'))) {
        sprintGifs.push(path)
      }
    }
  }
  assert.ok(sprintGifs.length > 0)
  for (const path of sprintGifs) {
    const frames = graphicControlExtensions(readFileSync(path))
    assert.ok(frames.length > 0, path)
    assert.ok(frames.every(frame => frame.transparent), path)
  }
})

test('Clash puff movement leaves time for vanish and reappear puffs', () => {
  assert.equal(CLASH_MOVE_EVENT_MS, 1100)
  assert.equal(CLASH_MOVE_EVENT_MS - CLASH_MOVE_PUFF_MS, 500)
})

test('Clash in-game character model graphics are readable', () => {
  for (const [character, assets] of clashModelAssetPaths()) {
    for (const path of assets) {
      const [width, height] = graphicSize(readFileSync(path), path)
      assert.ok(width > 0, `${character}: ${path}`)
      assert.ok(height > 0, `${character}: ${path}`)
    }
  }
})
