import test from 'node:test'
import assert from 'node:assert/strict'
import { assignShootTeam, normalizeShootTeams, shootAiNameTarget, shootLobbyName } from '../server/shootLobby.js'

test('Shoot lobby freezes generated names when teams and slots are first assigned', () => {
  const players = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  normalizeShootTeams(players)
  const names = Object.fromEntries(players.map(player => [player.id, shootLobbyName(player)]))

  assert.equal(assignShootTeam(players, 'a', 'B', 1), true)
  assert.equal(assignShootTeam(players, 'b', 'A', 0), true)
  assert.deepEqual(Object.fromEntries(players.map(player => [player.id, shootLobbyName(player)])), names)
})

test('Shoot lobby retains custom AI names through same-team and cross-team swaps', () => {
  const players = [
    { id: 'host', team: 'A', teamSlot: 0 },
    { id: 'bot-one', isAI: true, team: 'A', teamSlot: 1, customName: 'Target Ace' },
    { id: 'bot-two', isAI: true, team: 'B', teamSlot: 0, customName: 'Shield Pro' },
  ]
  normalizeShootTeams(players)

  assert.equal(assignShootTeam(players, 'bot-one', 'A', 0), true)
  assert.equal(assignShootTeam(players, 'bot-one', 'B', 0), true)
  assert.equal(shootLobbyName(players.find(player => player.id === 'bot-one')), 'Target Ace')
  assert.equal(shootLobbyName(players.find(player => player.id === 'bot-two')), 'Shield Pro')
})

test('Shoot lobby rejects invalid team assignments without changing player names', () => {
  const players = [{ id: 'bot', isAI: true, team: 'A', teamSlot: 0, customName: 'Stay Put' }]
  normalizeShootTeams(players)
  assert.equal(assignShootTeam(players, 'bot', 'C', 0), false)
  assert.equal(shootLobbyName(players[0]), 'Stay Put')
})

test('only the host can rename an AI in the Shoot lobby', () => {
  const bot = { id: 'bot', isAI: true }
  const room = { hostId: 'host', phase: 'lobby', modeKey: 'shoot_the_what', players: [bot, { id: 'human', isAI: false }] }

  assert.equal(shootAiNameTarget(room, 'guest', 'bot').error, 'Only the host can rename AI players.')
  assert.equal(shootAiNameTarget(room, 'host', 'human').error, 'AI player was not found.')
  assert.equal(shootAiNameTarget({ ...room, phase: 'playing' }, 'host', 'bot').error, 'AI names can only be changed in the Shoot the WHAT?! lobby.')
  assert.equal(shootAiNameTarget(room, 'host', 'bot').player, bot)
})
