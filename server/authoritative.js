import { readFileSync } from 'node:fs'
import { WebSocket, WebSocketServer } from 'ws'
import { activateSkill, createGameState, forfeitPlayer, penalizeTurn, takeTurn } from '../src/gameRules.js'

const PORT = Number(process.env.PORT || 8787)
const RECONNECT_GRACE_MS = 10_000
const TURN_MS = 15_000
const boards = JSON.parse(readFileSync(new URL('../data/boards.json', import.meta.url), 'utf8'))
const characters = JSON.parse(readFileSync(new URL('../data/characters.json', import.meta.url), 'utf8'))
const rooms = new Map()
const sockets = new Map()

function createCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let value
  do value = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
  while (rooms.has(value))
  return value
}

function send(socket, payload) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload))
}

function roomForClient(clientId) {
  return [...rooms.values()].find(room => room.players.some(player => player.id === clientId))
}

function roomView(room) {
  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    boardIndex: room.boardIndex,
    players: room.players,
  }
}

function recipients(room) {
  return room.players.map(player => sockets.get(player.id)).filter(Boolean)
}

function broadcast(room, payload) {
  for (const socket of recipients(room)) send(socket, payload)
}

function revise(room) {
  room.revision++
  return room.revision
}

function broadcastRoom(room) {
  broadcast(room, { type: 'room_state', revision: revise(room), room: roomView(room) })
}

function broadcastGame(room, type = 'game_state') {
  broadcast(room, {
    type,
    revision: revise(room),
    room: roomView(room),
    game: room.game,
    turnDeadline: room.turnDeadline,
    currentEvent: room.currentEvent,
    serverNow: Date.now(),
  })
}

function emitEvent(room, eventType, data, duration) {
  const event = {
    id: ++room.eventId,
    type: eventType,
    data,
    duration,
    startedAt: Date.now(),
  }
  room.currentEvent = event
  broadcast(room, { type: 'game_event', revision: revise(room), event, serverNow: Date.now() })
  return event
}

function reject(socket, message) {
  send(socket, { type: 'action_rejected', message })
}

function clearTimer(timer) {
  if (timer) clearTimeout(timer)
}

function clearRoomTimers(room) {
  clearTimer(room.turnTimer)
  clearTimer(room.rollTimer)
  for (const timer of room.disconnectTimers.values()) clearTimer(timer)
  room.disconnectTimers.clear()
  room.sequenceToken++
}

function closeRoom(room, reason) {
  if (!rooms.has(room.code)) return
  clearRoomTimers(room)
  room.phase = 'closed'
  broadcast(room, { type: 'room_closed', reason })
  rooms.delete(room.code)
}

function wait(room, milliseconds, token) {
  return new Promise(resolve => setTimeout(() => resolve(rooms.has(room.code) && room.sequenceToken === token), milliseconds))
}

function affectedDescription(description, playerName) {
  return description.replace(/\byour\b/gi, `${playerName}'s`).replace(/\byou\b/gi, playerName)
}

function effectDestination(space, what) {
  if (!what) return space
  if (what.effect.effect === 'move_back') return Math.max(1, space - (what.effect.spaces || 0))
  if (what.effect.effect === 'move_forward') return Math.min(100, space + (what.effect.spaces || 0))
  return space
}

async function runTurnSequence(room, player, startSpace, roll, token) {
  emitEvent(room, 'dice_stopped', { playerId: player.id, result: roll }, 2000)
  if (!await wait(room, 2000, token)) return
  emitEvent(room, 'move_announcement', { playerId: player.id, spaces: roll }, 2000)
  if (!await wait(room, 2000, token)) return

  const rollLanding = Math.min(100, startSpace + roll)
  const rollDuration = Math.max(1, Math.abs(rollLanding - startSpace)) * 540
  emitEvent(room, 'movement', { playerId: player.id, from: startSpace, to: rollLanding, kind: 'roll' }, rollDuration)
  if (!await wait(room, rollDuration, token)) return

  const what = room.game.lastWhat
  let resolvedSpace = rollLanding
  if (what) {
    emitEvent(room, 'what_reveal', {
      playerId: player.id,
      playerName: player.name,
      name: what.name,
      description: affectedDescription(what.effect.description, player.name),
      effect: what.effect.effect,
    }, 3000)
    if (!await wait(room, 3000, token)) return
    const destination = effectDestination(rollLanding, what)
    if (destination !== rollLanding) {
      const duration = Math.abs(destination - rollLanding) * 540
      emitEvent(room, 'movement', { playerId: player.id, from: rollLanding, to: destination, kind: 'effect' }, duration)
      if (!await wait(room, duration, token)) return
    }
    resolvedSpace = destination
  }

  const ladder = room.game.board.ladders.find(item => item.from === resolvedSpace)
  if (ladder) {
    emitEvent(room, 'ladder', { playerId: player.id, from: ladder.from, to: ladder.to }, 1600)
    if (!await wait(room, 1600, token)) return
  } else if (resolvedSpace !== player.space) {
    const duration = Math.abs(player.space - resolvedSpace) * 540
    emitEvent(room, 'movement', { playerId: player.id, from: resolvedSpace, to: player.space, kind: 'skill' }, duration)
    if (!await wait(room, duration, token)) return
  }

  room.currentEvent = null
  room.busy = false
  broadcastGame(room)
  beginTurn(room)
}

function stopRoll(room, requesterId, automatic = false) {
  if (!room.rolling || room.phase !== 'playing') return
  const current = room.game.players[room.game.currentPlayerIndex]
  if (!automatic && current.id !== requesterId) return reject(sockets.get(requesterId), 'Only the active player can stop the dice.')

  clearTimer(room.rollTimer)
  const elapsed = Date.now() - room.rolling.startedAt
  for (const player of room.game.players) {
    if (player.skillCooldownUntil > room.rolling.startedAt) player.skillCooldownUntil += elapsed
  }

  const roll = Math.floor(Math.random() * 6) + 1
  const startSpace = current.space
  room.rolling = null
  takeTurn(room.game, roll)
  const token = ++room.sequenceToken
  runTurnSequence(room, current, startSpace, roll, token)
}

function startRoll(room, requesterId, automatic = false) {
  if (room.phase !== 'playing' || room.busy || room.rolling || room.game.gameOver) return
  const current = room.game.players[room.game.currentPlayerIndex]
  if (!automatic && current.id !== requesterId) return reject(sockets.get(requesterId), 'It is not your turn.')
  if (automatic && !current.isAI) return

  clearTimer(room.turnTimer)
  room.turnDeadline = null
  room.busy = true
  room.rolling = { playerId: current.id, startedAt: Date.now() }
  emitEvent(room, 'dice_rolling', { playerId: current.id, autoStopAt: Date.now() + (current.isAI ? 900 : 5000) }, current.isAI ? 900 : 5000)
  room.rollTimer = setTimeout(() => stopRoll(room, current.id, true), current.isAI ? 900 : 5000)
}

function applyPenalty(room) {
  if (room.phase !== 'playing' || room.busy || room.game.gameOver) return
  room.turnDeadline = null
  room.busy = true
  const result = penalizeTurn(room.game)
  if (!result) return
  const token = ++room.sequenceToken
  emitEvent(room, 'penalty', {
    playerId: result.player.id,
    playerName: result.player.name,
    from: result.from,
    to: result.destination,
    ignoreLadder: true,
  }, 2000)
  wait(room, 2000, token).then(valid => {
    if (!valid) return
    room.currentEvent = null
    room.busy = false
    broadcastGame(room)
    beginTurn(room)
  })
}

function beginTurn(room) {
  if (!rooms.has(room.code) || room.phase !== 'playing' || room.busy || room.game.gameOver) {
    room.turnDeadline = null
    if (room.game?.gameOver) broadcastGame(room)
    return
  }

  const current = room.game.players[room.game.currentPlayerIndex]
  if (current.skipTurns > 0) {
    room.busy = true
    const token = ++room.sequenceToken
    emitEvent(room, 'skip_notice', {
      playerId: current.id,
      playerName: current.name,
      color: current.color,
      turns: current.skipTurns,
      whatName: current.skipReason || 'unknown what',
    }, 3000)
    wait(room, 3000, token).then(valid => {
      if (!valid) return
      takeTurn(room.game)
      room.currentEvent = null
      room.busy = false
      broadcastGame(room)
      beginTurn(room)
    })
    return
  }

  if (current.isAI) {
    room.turnDeadline = null
    room.turnTimer = setTimeout(() => startRoll(room, current.id, true), 550)
  } else {
    room.turnDeadline = Date.now() + TURN_MS
    room.turnTimer = setTimeout(() => applyPenalty(room), TURN_MS)
  }
  broadcastGame(room)
}

function useSkill(room, requesterId) {
  if (room.phase !== 'playing' || room.busy || room.game.gameOver) return
  const current = room.game.players[room.game.currentPlayerIndex]
  if (current.id !== requesterId || current.isAI) return reject(sockets.get(requesterId), 'Skill can only be used during your turn.')
  if (current.skillBlockedTurns > 0) return reject(sockets.get(requesterId), `Skill blocked for ${current.skillBlockedTurns} turn(s).`)
  if (current.skillCooldownUntil > Date.now()) return reject(sockets.get(requesterId), 'Skill is still cooling down.')
  const turnKey = `${room.game.turn}:${room.game.currentPlayerIndex}`
  if (room.skillUsedTurnKey === turnKey) return reject(sockets.get(requesterId), 'Skill can only be used once per turn.')
  const validation = activateSkill(structuredClone(room.game), Date.now())
  if (!validation.ok) return reject(sockets.get(requesterId), validation.message)

  clearTimer(room.turnTimer)
  room.turnDeadline = null
  room.busy = true
  room.skillUsedTurnKey = turnKey
  const token = ++room.sequenceToken
  emitEvent(room, 'skill_pending', {
    playerId: current.id,
    playerName: current.name,
    color: current.color,
    name: current.specialSkill.name,
    description: current.specialSkill.description,
  }, 2000)
  wait(room, 2000, token).then(valid => {
    if (!valid) return
    const result = activateSkill(room.game, Date.now())
    emitEvent(room, 'skill_result', {
      playerId: current.id,
      playerName: current.name,
      color: current.color,
      name: current.specialSkill.name,
      message: result.message,
      ok: result.ok,
    }, 2000)
    wait(room, 2000, token).then(resultVisible => {
      if (!resultVisible) return
      room.currentEvent = null
      room.busy = false
      broadcastGame(room)
      beginTurn(room)
    })
  })
}

function startGame(room, requesterId) {
  if (room.hostId !== requesterId) return reject(sockets.get(requesterId), 'Only the host can start the game.')
  if (room.phase !== 'lobby') return reject(sockets.get(requesterId), 'The game has already started.')
  if (room.players.length < 2) return reject(sockets.get(requesterId), 'Add at least one player or AI.')

  const definitions = room.players.map(player => {
    const character = characters[player.characterIndex % characters.length]
    return {
      ...character,
      id: player.id,
      name: player.isAI ? `${character.name} AI` : character.name,
      isAI: player.isAI,
    }
  })
  room.game = createGameState(boards[room.boardIndex], definitions)
  room.phase = 'playing'
  room.busy = false
  room.currentEvent = null
  broadcastGame(room, 'game_started')
  beginTurn(room)
}

function forfeitDisconnected(room, clientId) {
  if (!rooms.has(room.code)) return
  const lobbyPlayer = room.players.find(player => player.id === clientId)
  if (!lobbyPlayer || lobbyPlayer.connected) return
  room.disconnectTimers.delete(clientId)

  if (clientId === room.hostId) {
    closeRoom(room, 'The host left the room.')
    return
  }

  if (room.phase === 'playing') {
    const currentId = room.game.players[room.game.currentPlayerIndex]?.id
    const interruptsTurn = currentId === clientId || room.rolling?.playerId === clientId
    if (interruptsTurn) {
      room.sequenceToken++
      clearTimer(room.turnTimer)
      clearTimer(room.rollTimer)
      room.rolling = null
      room.busy = false
      room.currentEvent = null
    }
    const forfeited = forfeitPlayer(room.game, clientId)
    room.players = room.players.filter(player => player.id !== clientId)
    broadcast(room, { type: 'player_forfeited', revision: revise(room), playerId: clientId, playerName: forfeited?.name })
    broadcastGame(room)
    if (interruptsTurn || !room.busy) beginTurn(room)
  } else {
    room.players = room.players.filter(player => player.id !== clientId)
    broadcastRoom(room)
  }
}

function markDisconnected(room, clientId) {
  const player = room.players.find(item => item.id === clientId)
  if (!player || player.isAI) return
  player.connected = false
  broadcastRoom(room)
  clearTimer(room.disconnectTimers.get(clientId))
  room.disconnectTimers.set(clientId, setTimeout(() => forfeitDisconnected(room, clientId), RECONNECT_GRACE_MS))
}

function reconnect(room, clientId, socket) {
  const player = room.players.find(item => item.id === clientId && !item.isAI)
  if (!player) return reject(socket, 'Player is not part of this room.')
  clearTimer(room.disconnectTimers.get(clientId))
  room.disconnectTimers.delete(clientId)
  player.connected = true
  sockets.set(clientId, socket)
  broadcastRoom(room)
  if (room.phase === 'playing') broadcastGame(room, 'game_started')
}

const wss = new WebSocketServer({ port: PORT, host: '0.0.0.0' })

wss.on('connection', socket => {
  let clientId

  socket.on('message', raw => {
    let message
    try { message = JSON.parse(raw) } catch { return reject(socket, 'Invalid message.') }
    clientId = message.clientId || clientId
    if (!clientId) return reject(socket, 'Missing client ID.')
    sockets.set(clientId, socket)

    if (message.type === 'create') {
      const existing = roomForClient(clientId)
      if (existing) {
        if (existing.hostId === clientId) closeRoom(existing, 'The host created a new room.')
        else {
          const player = existing.players.find(item => item.id === clientId)
          if (player) player.connected = false
          forfeitDisconnected(existing, clientId)
        }
      }
      const room = {
        code: createCode(),
        phase: 'lobby',
        hostId: clientId,
        boardIndex: 0,
        players: [{ id: clientId, characterIndex: message.characterIndex || 0, isAI: false, connected: true }],
        revision: 0,
        eventId: 0,
        disconnectTimers: new Map(),
        sequenceToken: 0,
        turnDeadline: null,
        busy: false,
      }
      rooms.set(room.code, room)
      broadcastRoom(room)
      return
    }

    if (message.type === 'join') {
      const room = rooms.get(String(message.code || '').toUpperCase())
      if (!room) return reject(socket, 'Room not found.')
      const existing = room.players.find(player => player.id === clientId)
      if (existing) return reconnect(room, clientId, socket)
      if (room.phase !== 'lobby') return reject(socket, 'The game has already started.')
      if (room.players.length >= 6) return reject(socket, 'Room is full.')
      room.players.push({ id: clientId, characterIndex: message.characterIndex || 0, isAI: false, connected: true })
      broadcastRoom(room)
      return
    }

    if (message.type === 'reconnect') {
      const room = rooms.get(String(message.code || '').toUpperCase())
      if (!room) return reject(socket, 'Room no longer exists.')
      reconnect(room, clientId, socket)
      return
    }

    const room = roomForClient(clientId)
    if (!room) return reject(socket, 'You are not in a room.')

    if (message.type === 'leave_room') {
      if (clientId === room.hostId) closeRoom(room, 'The host left the room.')
      else {
        const player = room.players.find(item => item.id === clientId)
        if (player) player.connected = false
        forfeitDisconnected(room, clientId)
        send(socket, { type: 'room_closed', reason: 'You left the room.' })
      }
      return
    }
    if (message.type === 'character' && room.phase === 'lobby') {
      const player = room.players.find(item => item.id === clientId)
      player.characterIndex = Math.max(0, Number(message.characterIndex) || 0)
      broadcastRoom(room)
    } else if (message.type === 'board') {
      if (room.hostId !== clientId) reject(socket, 'Only the host can select the board.')
      else if (room.phase === 'lobby') {
        room.boardIndex = Math.max(0, Math.min(boards.length - 1, Number(message.boardIndex) || 0))
        broadcastRoom(room)
      }
    } else if (message.type === 'add_ai') {
      if (room.hostId !== clientId) reject(socket, 'Only the host can add AI players.')
      else if (room.phase === 'lobby' && room.players.length < 6) {
        const used = room.players.map(item => item.characterIndex)
        let characterIndex = 0
        while (used.includes(characterIndex) && characterIndex < characters.length - 1) characterIndex++
        room.players.push({ id: `ai-${Date.now()}-${Math.random()}`, characterIndex, isAI: true, connected: true })
        broadcastRoom(room)
      }
    } else if (message.type === 'remove_ai') {
      if (room.hostId !== clientId) reject(socket, 'Only the host can remove AI players.')
      else if (room.phase === 'lobby') {
        room.players = room.players.filter(item => item.id !== message.playerId || !item.isAI)
        broadcastRoom(room)
      }
    } else if (message.type === 'start_game') startGame(room, clientId)
    else if (message.type === 'start_roll') startRoll(room, clientId)
    else if (message.type === 'stop_roll') stopRoll(room, clientId)
    else if (message.type === 'use_skill') useSkill(room, clientId)
  })

  socket.on('close', () => {
    if (!clientId || sockets.get(clientId) !== socket) return
    sockets.delete(clientId)
    const room = roomForClient(clientId)
    if (room) markDisconnected(room, clientId)
  })
})

console.log(`Authoritative multiplayer server listening on 0.0.0.0:${PORT}`)
