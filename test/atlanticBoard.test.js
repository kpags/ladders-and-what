import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getBoardSpaceBounds, getBoardSpacePosition } from '../src/boardLayout.js'
import { applyWhatEffects, clashMoveOptions, CLASH_BOARD_SPACES, CLASH_PLAYER_SPAWN_SPACES, createGameState, skipClashStunnedTurn, takeClashAttack, takeClashItem, takeClashMove } from '../src/gameRules.js'

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

test('No Man\'s Land uses guide-derived fifteen-by-fifteen cell centers', () => {
  const noMansLand = boards.find(board => board.name === "No Man's Land")

  assert.deepEqual(getBoardSpacePosition(noMansLand, 1), { left: '4.904%', top: '93.979%' })
  assert.deepEqual(getBoardSpacePosition(noMansLand, 15), { left: '95.016%', top: '93.979%' })
  assert.deepEqual(getBoardSpacePosition(noMansLand, 16), { left: '95.016%', top: '86.663%' })
  assert.deepEqual(getBoardSpacePosition(noMansLand, 30), { left: '4.904%', top: '86.663%' })
  assert.deepEqual(getBoardSpacePosition(noMansLand, 225), { left: '95.016%', top: '4.725%' })
  assert.deepEqual(getBoardSpaceBounds(noMansLand, 1), { x: '1.635%', y: '90.71%', width: '6.539%', height: '6.539%' })
})

test('No Man\'s Land spawns players uniquely in purple guide cells', () => {
  const noMansLand = boards.find(board => board.name === "No Man's Land")
  const state = createGameState(noMansLand, Array.from({ length: 6 }, (_, index) => ({
    id: `player-${index + 1}`,
    name: `Player ${index + 1}`,
  })), 0)
  const spawnSpaces = state.players.map(player => player.space)

  assert.equal(new Set(spawnSpaces).size, spawnSpaces.length)
  assert.equal(spawnSpaces.every(space => CLASH_PLAYER_SPAWN_SPACES.includes(space)), true)
  assert.equal(Math.max(...state.clashDrops.map(drop => drop.space)) <= CLASH_BOARD_SPACES, true)
})

test('Clash movement reaches two guide squares in every direction', () => {
  const noMansLand = boards.find(board => board.name === "No Man's Land")
  const state = createGameState(noMansLand, [
    { id: 'player-1', name: 'Player 1' },
    { id: 'player-2', name: 'Player 2' },
  ], 0)
  const player = state.players[0]
  player.space = 113

  assert.deepEqual(new Set(clashMoveOptions(state, player)), new Set([
    81, 82, 83, 84, 85,
    96, 97, 98, 99, 100,
    111, 112, 114, 115,
    126, 127, 128, 129, 130,
    141, 142, 143, 144, 145,
  ]))
})

test('Clash supply rounds replace board drops and spent weapons disappear', () => {
  const noMansLand = boards.find(board => board.name === "No Man's Land")
  const state = createGameState(noMansLand, [
    { id: 'player-1', name: 'Player 1' },
    { id: 'player-2', name: 'Player 2' },
  ], 0)
  const pistol = structuredClone(noMansLand.weapons.find(weapon => weapon.name === 'Glock 17'))
  pistol.ammoRemaining = 1
  state.players[0].space = 113
  state.players[1].space = 114
  state.players[0].clashInventory.weapons = [pistol]

  const attack = takeClashAttack(state, 'player-1', 'player-2', 'Glock 17', 'Burst Fire', () => 0)

  assert.equal(attack.ok, true)
  assert.equal(attack.attempts, 1)
  assert.equal(state.players[0].clashInventory.weapons.some(weapon => weapon.name === 'Glock 17'), false)

  const beforeDropIds = new Set(state.clashDrops.map(drop => drop.id))
  state.nextClashDropTurn = 2
  const destination = clashMoveOptions(state, state.players[1])[0]
  takeClashMove(state, 'player-2', destination)

  assert.equal(state.turn, 2)
  assert.equal(state.clashDrops.some(drop => beforeDropIds.has(drop.id)), false)
})

test('Clash melee attacks move the attacker in front of the target', () => {
  const noMansLand = boards.find(board => board.name === "No Man's Land")
  const state = createGameState(noMansLand, [
    { id: 'player-1', name: 'Player 1' },
    { id: 'player-2', name: 'Player 2' },
  ], 0)
  state.players[0].space = 111
  state.players[1].space = 113

  const attack = takeClashAttack(state, 'player-1', 'player-2', 'Combat Knife', 'Single Attack', () => 0, 1_000)

  assert.equal(attack.ok, true)
  assert.equal(attack.attackerFrom, 111)
  assert.equal(attack.attackerTo, 112)
  assert.equal(state.players[0].space, 112)
  assert.equal(state.players[0].clashMeleeCooldownUntil, 31_000)
  state.currentPlayerIndex = 0
  const blocked = takeClashAttack(state, 'player-1', 'player-2', 'Combat Knife', 'Single Attack', () => 0, 2_000)
  assert.equal(blocked.ok, false)
  assert.equal(blocked.message, 'Melee weapon is cooling down.')
})

test('Clash damage items affect players within one guide space of the thrown square', () => {
  const noMansLand = boards.find(board => board.name === "No Man's Land")
  const state = createGameState(noMansLand, [
    { id: 'player-1', name: 'Player 1' },
    { id: 'player-2', name: 'Player 2' },
    { id: 'player-3', name: 'Player 3' },
  ], 0)
  const grenade = { id: 'frag_grenade', ...structuredClone(noMansLand.items.find(item => item.name === 'Frag Grenade')), count: 1 }
  state.players[0].space = 113
  state.players[1].space = 98
  state.players[2].space = 80
  state.players[0].clashInventory.items = [grenade]

  const result = takeClashItem(state, 'player-1', 'frag_grenade', 112)

  assert.equal(result.ok, true)
  assert.equal(state.players[1].health, 75)
  assert.equal(state.players[2].health, 100)
})

test('Stun Grenade affects players within one guide space and blocks movement for one global turn', () => {
  const noMansLand = boards.find(board => board.name === "No Man's Land")
  const state = createGameState(noMansLand, [
    { id: 'player-1', name: 'Player 1' },
    { id: 'player-2', name: 'Player 2' },
    { id: 'player-3', name: 'Player 3' },
  ], 0)
  const stun = { id: 'stun_grenade', ...structuredClone(noMansLand.items.find(item => item.name === 'Stun Grenade')), count: 1 }
  state.players[0].space = 113
  state.players[1].space = 98
  state.players[2].space = 50
  state.players[0].clashInventory.items = [stun]

  const result = takeClashItem(state, 'player-1', 'stun_grenade', 112)

  assert.equal(result.ok, true)
  assert.equal(state.players[1].clashStunnedThroughTurn, 2)
  assert.equal(state.players[2].clashStunnedThroughTurn, null)
  const stunnedAttack = takeClashAttack(state, 'player-2', 'player-1', 'Combat Knife', 'Single Attack', () => 0, 1_000)
  assert.equal(stunnedAttack.ok, false)
  assert.equal(stunnedAttack.message, 'You are stunned and cannot act.')
  const stunnedItem = takeClashItem(state, 'player-2', 'bandage')
  assert.equal(stunnedItem.ok, false)
  assert.equal(stunnedItem.message, 'You are stunned and cannot act.')
  assert.equal(takeClashMove(state, 'player-2', clashMoveOptions(state, state.players[1])[0]).ok, false)
  const skipped = skipClashStunnedTurn(state)
  assert.equal(skipped.ok, true)
  assert.equal(state.players[state.currentPlayerIndex].id, 'player-3')
})

test('Molotov applies radius-one damage over configured global turns', () => {
  const noMansLand = boards.find(board => board.name === "No Man's Land")
  const state = createGameState(noMansLand, [
    { id: 'player-1', name: 'Player 1' },
    { id: 'player-2', name: 'Player 2' },
  ], 0)
  const molotov = { id: 'molotov', ...structuredClone(noMansLand.items.find(item => item.name === 'Molotov')), count: 1 }
  state.players[0].space = 113
  state.players[1].space = 112
  state.players[0].clashInventory.items = [molotov]

  const result = takeClashItem(state, 'player-1', 'molotov', 112)

  assert.equal(result.ok, true)
  assert.equal(state.players[1].health, 100)
  assert.equal(state.players[1].clashDotEffects.length, 1)

  const advanceToTurn = turn => {
    while (state.turn < turn) {
      const player = state.players[state.currentPlayerIndex]
      takeClashMove(state, player.id, clashMoveOptions(state, player)[0])
    }
  }

  for (let turn = 2; turn <= 6; turn++) {
    advanceToTurn(turn)
    assert.equal(state.turn, turn)
    assert.equal(state.players[1].health, 100 - (turn - 1) * 5)
  }
  advanceToTurn(7)
  assert.equal(state.turn, 7)
  assert.equal(state.players[1].health, 75)
  assert.equal(state.players[1].clashDotEffects.length, 0)
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
