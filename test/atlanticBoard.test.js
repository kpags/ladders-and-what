import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getBoardSpacePosition } from '../src/boardLayout.js'
import { applyWhatEffects, createGameState } from '../src/gameRules.js'

const root = resolve(import.meta.dirname, '..')
const boards = JSON.parse(readFileSync(resolve(root, 'data/boards.json'), 'utf8'))
const atlantic = boards.find(board => board.name === 'Atlantic')

test('Atlantic is registered as a Standard board with valid assets', () => {
  assert.ok(atlantic)
  assert.equal(atlantic.type, 'standard')
  assert.equal(atlantic.music, 'atlantic')
  assert.equal(existsSync(resolve(root, atlantic.picture)), true)

  const tracks = readdirSync(resolve(root, 'assets/musics/in_game/atlantic'))
    .filter(file => file.toLowerCase().endsWith('.mp3'))
  assert.deepEqual(tracks.sort(), ['ost_one.mp3', 'ost_three.mp3', 'ost_two.mp3'])
})

test('Atlantic uses its measured serpentine cell centers', () => {
  assert.deepEqual(getBoardSpacePosition(atlantic, 1), { left: '6%', top: '95.3%' })
  assert.deepEqual(getBoardSpacePosition(atlantic, 10), { left: '93.7%', top: '95.3%' })
  assert.deepEqual(getBoardSpacePosition(atlantic, 11), { left: '93.7%', top: '86.8%' })
  assert.deepEqual(getBoardSpacePosition(atlantic, 20), { left: '6%', top: '86.8%' })
  assert.deepEqual(getBoardSpacePosition(atlantic, 100), { left: '6%', top: '5.9%' })
})

test('Ghost Town uses its measured serpentine cell centers', () => {
  const ghostTown = { name: 'Ghost Town', type: 'run_away' }

  assert.deepEqual(getBoardSpacePosition(ghostTown, 1), { left: '8.41%', top: '92.94%' })
  assert.deepEqual(getBoardSpacePosition(ghostTown, 10), { left: '93.62%', top: '92.94%' })
  assert.deepEqual(getBoardSpacePosition(ghostTown, 11), { left: '93.62%', top: '83.81%' })
  assert.deepEqual(getBoardSpacePosition(ghostTown, 100), { left: '8.41%', top: '7.58%' })
})

test('Atlantic Kraken moves the player back before applying lost turns', () => {
  const kraken = atlantic.whats.find(what => what.name === 'Kraken')
  const state = createGameState(atlantic, [
    { id: 'player-1', name: 'Player 1' },
    { id: 'player-2', name: 'Player 2' },
  ], 0)
  const player = state.players[0]
  player.space = 90

  const effects = applyWhatEffects(state, player, kraken)

  assert.deepEqual(kraken.effects.map(effect => effect.effect), ['move_back', 'lose_turn'])
  assert.deepEqual(effects.map(step => step.destination), [65, 65])
  assert.equal(player.space, 65)
  assert.equal(player.skipTurns, 2)
  assert.equal(player.skipReason, 'Kraken')
})
