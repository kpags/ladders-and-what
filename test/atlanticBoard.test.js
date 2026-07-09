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

test('Horizon uses its measured serpentine cell centers', () => {
  const horizon = boards.find(board => board.name === 'Horizon')

  assert.deepEqual(getBoardSpacePosition(horizon, 1), { left: '5.98%', top: '93.62%' })
  assert.deepEqual(getBoardSpacePosition(horizon, 10), { left: '93.94%', top: '93.62%' })
  assert.deepEqual(getBoardSpacePosition(horizon, 11), { left: '93.94%', top: '84.69%' })
  assert.deepEqual(getBoardSpacePosition(horizon, 20), { left: '5.98%', top: '84.69%' })
  assert.deepEqual(getBoardSpacePosition(horizon, 100), { left: '5.98%', top: '6.1%' })
})

test('Reminiscing uses its measured serpentine cell centers', () => {
  const reminiscing = boards.find(board => board.name === 'Reminiscing')

  assert.deepEqual(getBoardSpacePosition(reminiscing, 1), { left: '6.17%', top: '93.8%' })
  assert.deepEqual(getBoardSpacePosition(reminiscing, 10), { left: '93.69%', top: '93.8%' })
  assert.deepEqual(getBoardSpacePosition(reminiscing, 11), { left: '93.69%', top: '84.151%' })
  assert.deepEqual(getBoardSpacePosition(reminiscing, 20), { left: '6.17%', top: '84.151%' })
  assert.deepEqual(getBoardSpacePosition(reminiscing, 100), { left: '6.17%', top: '6.16%' })
})

test('Throwback PH uses its measured serpentine cell centers', () => {
  const throwbackPh = boards.find(board => board.name === 'Throwback PH')

  assert.deepEqual(getBoardSpacePosition(throwbackPh, 1), { left: '8.054%', top: '92.963%' })
  assert.deepEqual(getBoardSpacePosition(throwbackPh, 10), { left: '91.946%', top: '92.963%' })
  assert.deepEqual(getBoardSpacePosition(throwbackPh, 11), { left: '91.946%', top: '83.991%' })
  assert.deepEqual(getBoardSpacePosition(throwbackPh, 20), { left: '8.054%', top: '83.991%' })
  assert.deepEqual(getBoardSpacePosition(throwbackPh, 100), { left: '8.054%', top: '7.337%' })
})

test('Quiet Mansion uses exact ten-by-ten cell centers', () => {
  const quietMansion = boards.find(board => board.name === 'Quiet Mansion')

  assert.deepEqual(getBoardSpacePosition(quietMansion, 1), { left: '5.582%', top: '95.694%' })
  assert.deepEqual(getBoardSpacePosition(quietMansion, 10), { left: '93.939%', top: '95.694%' })
  assert.deepEqual(getBoardSpacePosition(quietMansion, 11), { left: '93.7%', top: '88.357%' })
  assert.deepEqual(getBoardSpacePosition(quietMansion, 100), { left: '7.416%', top: '6.579%' })
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
