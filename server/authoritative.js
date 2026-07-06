import { readFileSync } from 'node:fs'
import { WebSocket, WebSocketServer } from 'ws'
import { activateSkill, applyDestroyedSquareEffect, armEscapeWeapon, canSkipEscapeMove, chooseEscapeAiDirection, completeEscape, createGameState, describeRunAwayRoll, destroySpace, endTurnAfterSkill, forfeitPlayer, hiddenMineOptions, penalizeTurn, planRunAwayDestruction, SKILL_COOLDOWN_MS, skipEscapeTurn, takeEscapeTurn, takeParkourWhat, takeTurn } from '../src/gameRules.js'
import { boardIndicesForMode, boardIsAvailable, characterIndicesForMode, normalizeCharacterIndex } from '../src/lobbyCatalog.js'
import { canStartRoll, unlockRoomForNextTurn } from './turnState.js'
import { createDestructionSkipState, updateDestructionSkipVote } from './destructionSkip.js'
import {
  createEscapeBriefingState,
  escapeBriefingView,
  syncEscapeBriefingPlayers,
  voteToCloseEscapeBriefing,
} from './escapeBriefing.js'
import { chooseAiReactions } from './aiReactions.js'

const PORT = Number(process.env.PORT || 8787)
const RECONNECT_GRACE_MS = 10_000
const TURN_MS = 15_000
const boards = JSON.parse(readFileSync(new URL('../data/boards.json', import.meta.url), 'utf8'))
const gameModes = JSON.parse(readFileSync(new URL('../data/game_modes.json', import.meta.url), 'utf8'))
const characters = JSON.parse(readFileSync(new URL('../data/characters.json', import.meta.url), 'utf8'))
const parkourWhats = boards.find(board => board.name === 'Nature')?.whats
  .filter(what => ['Bee Swarm', 'Dung'].includes(what.name)) || []
const rooms = new Map()
const sockets = new Map()
const ESCAPE_ROLL_MS = 10_000
const ESCAPE_DIRECTION_MS = 10_000
const ESCAPE_SOCIAL_SOUND_MS = 3_200

function firstBoardIndex(modeKey) {
  return boardIndicesForMode(boards, modeKey)[0] ?? -1
}

function roomMaxPlayers(room) {
  return room.modeKey === 'escape_from' ? 4 : 6
}

function normalizeRoomCharacter(room, requestedIndex, fallbackOffset = 0) {
  return normalizeCharacterIndex(characters, room.modeKey, requestedIndex, fallbackOffset)
}

function remapRoomCharacters(room) {
  room.players.forEach((player, index) => {
    const normalized = normalizeRoomCharacter(room, player.characterIndex, index)
    if (normalized != null) player.characterIndex = normalized
  })
}

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
    modeKey: room.modeKey,
    boardIndex: room.boardIndex,
    exactMoveFor100: Boolean(room.exactMoveFor100),
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
  const revision = revise(room)
  for (const player of room.players) {
    const socket = sockets.get(player.id)
    if (!socket) continue
    const game = structuredClone(room.game)
    game.hiddenMines = game.hiddenMines.filter(mine => mine.ownerId === player.id)
    send(socket, {
      type,
      revision,
      room: roomView(room),
      game,
      turnDeadline: room.turnDeadline,
      currentEvent: room.currentEvent,
      escapeBriefing: escapeBriefingView(room.escapeBriefing),
      serverNow: Date.now(),
    })
  }
  const allPlayersEliminated = room.game?.mode === 'run_away'
    && room.game.players.length > 0
    && room.game.players.every(player => player.eliminated)
  if (room.game?.gameOver && !allPlayersEliminated && !room.busy && !room.currentEvent && !room.memorialShown) {
    room.memorialShown = true
    const names = room.game.players.filter(player => player.eliminated).map(player => player.name)
    if (names.length) {
      const memorial = emitEvent(room, 'rip_memorial', { names }, 3000)
      setTimeout(() => {
        if (!rooms.has(room.code) || room.currentEvent?.id !== memorial.id) return
        room.currentEvent = null
        broadcastGame(room)
      }, 3000)
    }
  }
}

function allRunAwayPlayersEliminated(game) {
  return game?.mode === 'run_away'
    && game.players.length > 0
    && game.players.every(player => player.eliminated)
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

function clearEscapeSocialQueue(room) {
  for (const timer of room.escapeSocialTimers || []) clearTimer(timer)
  room.escapeSocialTimers?.clear()
  room.escapeSocialAvailableAt = 0
}

function clearRoomTimers(room) {
  clearTimer(room.turnTimer)
  clearTimer(room.rollTimer)
  clearTimer(room.directionTimer)
  room.directionChoice = null
  for (const timer of room.disconnectTimers.values()) clearTimer(timer)
  room.disconnectTimers.clear()
  clearTimer(room.pendingMine?.timer)
  room.pendingMine = null
  clearTimer(room.pendingSkillTarget?.timer)
  room.pendingSkillTarget = null
  clearEscapeSocialQueue(room)
  room.destructionSkip = null
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

function normalizePlayerName(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 20)
}

function destructionVariant(room) {
  return room.game?.board?.name === 'Ghost Town' ? 'ghost_town' : 'default'
}

async function showCaughtPlayer(room, player, space, token) {
  emitEvent(room, 'destruction_caught', {
    playerId: player.id,
    playerName: player.name,
    space,
    variant: destructionVariant(room),
  }, 3000)
  return wait(room, 3000, token)
}

function broadcastDestructionSkip(room, active) {
  const state = room.destructionSkip
  broadcast(room, {
    type: 'destruction_skip_state',
    revision: revise(room),
    active,
    voterIds: state ? [...state.voters] : [],
    total: state?.humanIds.length || 0,
  })
}

async function waitDestructionStep(room, milliseconds, token) {
  const deadline = Date.now() + milliseconds
  while (Date.now() < deadline) {
    if (!rooms.has(room.code) || room.sequenceToken !== token) return 'invalid'
    if (room.destructionSkip?.requested) return 'skip'
    const remaining = deadline - Date.now()
    if (!await wait(room, Math.min(75, remaining), token)) return 'invalid'
  }
  return room.destructionSkip?.requested ? 'skip' : 'complete'
}

async function finishSkippedDestruction(room, spaces, token) {
  const caught = []
  for (const space of spaces) {
    const result = destroySpace(room.game, space)
    caught.push(...result.players.map(player => ({ player, space })))
  }
  broadcastGame(room)
  broadcastDestructionSkip(room, false)
  room.destructionSkip = null
  for (const record of caught) {
    if (!await showCaughtPlayer(room, record.player, record.space, token)) return false
  }
  return true
}

async function runDestructionSequence(room, token) {
  const spaces = room.game.lastExplosion?.spaces || []
  if (!spaces.length) return true

  room.destructionSkip = createDestructionSkipState(room.players, token)
  broadcastDestructionSkip(room, true)
  emitEvent(room, 'destruction_warning', { count: spaces.length, variant: destructionVariant(room) }, 3000)
  const warningWait = await waitDestructionStep(room, 3000, token)
  if (warningWait === 'invalid') return false
  if (warningWait === 'skip') {
    if (!await finishSkippedDestruction(room, spaces, token)) return false
  } else {
    for (const [index, space] of spaces.entries()) {
      // Show the explosion first, then commit its darkened square. The next
      // iteration starts only after caught-player handling and the pause below.
      emitEvent(room, 'destruction_square', { space, variant: destructionVariant(room) }, 750)
      const squareWait = await waitDestructionStep(room, 750, token)
      if (squareWait === 'invalid') return false
      if (squareWait === 'skip') {
        if (!await finishSkippedDestruction(room, spaces.slice(index), token)) return false
        break
      }
      const result = destroySpace(room.game, space)
      broadcastGame(room)
      for (const player of result.players) {
        if (!await showCaughtPlayer(room, player, space, token)) return false
      }
      if (room.game.gameOver) break
      if (index < spaces.length - 1) {
        const pauseWait = await waitDestructionStep(room, 750, token)
        if (pauseWait === 'invalid') return false
        if (pauseWait === 'skip') {
          if (!await finishSkippedDestruction(room, spaces.slice(index + 1), token)) return false
          break
        }
      }
    }
  }

  if (room.destructionSkip) {
    broadcastDestructionSkip(room, false)
    room.destructionSkip = null
  }
  if (allRunAwayPlayersEliminated(room.game)) {
    emitEvent(room, 'run_away_sigh', {}, 3000)
    if (!await wait(room, 3000, token)) return false
  }
  room.game.lastExplosion = null
  return true
}

function finishSequenceAndBeginTurn(room) {
  clearTimer(room.turnTimer)
  clearTimer(room.rollTimer)
  clearTimer(room.directionTimer)
  room.turnTimer = null
  room.rollTimer = null
  room.directionTimer = null
  unlockRoomForNextTurn(room)
  broadcastEscapePickupSpawn(room)
  beginTurn(room)
}

function broadcastEscapePickupSpawn(room) {
  const spawn = room.game?.lastEscapePickupSpawn
  if (!spawn) return
  const key = `${spawn.turn}:${spawn.type}`
  if (room.lastEscapePickupSpawnKey === key) return
  room.lastEscapePickupSpawnKey = key
  const startedAt = Date.now()
  broadcast(room, {
    type: 'escape_pickup_spawned',
    pickupType: spawn.type,
    text: spawn.type === 'medkit'
      ? 'A Medkit has spawned and can heal 1 health point.'
      : '2 Light Sources spawned and expand vision.',
    duration: 2800,
    startedAt,
    serverNow: startedAt,
  })
}

async function showEscapePassive(room, passive, token) {
  if (!passive) return true
  emitEvent(room, 'escape_passive_triggered', passive, 1500)
  return wait(room, 1500, token)
}

async function showEscapePassiveGif(room, kind, duration, token) {
  emitEvent(room, 'escape_passive_gif', { kind }, duration)
  return wait(room, duration, token)
}

async function finishEscapeWeaponArm(room, result) {
  const token = ++room.sequenceToken
  if (!await showEscapePassive(room, result.passiveTrigger, token)) return
  emitEvent(room, 'escape_weapon_armed', {
    playerId: result.player.id,
    playerName: result.player.name,
    protectFromTurn: result.player.weaponProtectFromTurn,
    protectThroughTurn: result.player.weaponProtectThroughTurn,
  }, 3000)
  if (!await wait(room, 3000, token)) return
  broadcastGame(room)
  finishSequenceAndBeginTurn(room)
}

async function finishEscapeDirection(room, direction) {
  const choice = room.directionChoice
  if (!choice || room.game.gameOver) return
  clearTimer(room.directionTimer)
  room.directionTimer = null
  room.directionChoice = null
  room.currentEvent = null
  const token = ++room.sequenceToken
  if (!direction) {
    skipEscapeTurn(room.game)
    broadcastGame(room)
    finishSequenceAndBeginTurn(room)
    return
  }
  const exitWasRevealed = room.game.exitRevealed
  const result = takeEscapeTurn(room.game, choice.roll, direction)
  emitEvent(room, 'dice_stopped', {
    playerId: choice.playerId,
    result: choice.roll,
    resultLabel: `Move ${choice.roll} spaces ${direction}`,
  }, 500)
  if (!await wait(room, 500, token)) return
  if (result.movementPassive) {
    const firstDuration = Math.abs(result.movementPassive.space - result.from) * 540
    emitEvent(room, 'movement', {
      playerId: choice.playerId,
      from: result.from,
      to: result.movementPassive.space,
      kind: 'escape',
    }, firstDuration)
    if (!await wait(room, firstDuration, token)) return
    if (!await showEscapePassive(room, result.movementPassive, token)) return
    const remainingDuration = Math.abs(result.rollLanding - result.movementPassive.space) * 540
    if (remainingDuration) {
      emitEvent(room, 'movement', {
        playerId: choice.playerId,
        from: result.movementPassive.space,
        to: result.rollLanding,
        kind: 'escape',
      }, remainingDuration)
      if (!await wait(room, remainingDuration, token)) return
    }
  } else {
    const duration = Math.abs(result.rollLanding - result.from) * 540
    emitEvent(room, 'movement', { playerId: choice.playerId, from: result.from, to: result.rollLanding, kind: 'escape' }, duration)
    if (!await wait(room, duration, token)) return
  }
  if (result.ladder) {
    emitEvent(room, 'ladder', {
      playerId: choice.playerId,
      from: result.ladder.from,
      to: result.ladder.to,
    }, 1600)
    if (!await wait(room, 1600, token)) return
  }
  if (result.collectedKeys?.length) {
    broadcast(room, {
      type: 'escape_key_collected',
      playerId: result.player.id,
      characterId: result.player.characterId,
      count: result.collectedKeys.length,
      serverNow: Date.now(),
    })
  }
  for (const pickupType of result.collectedPickups || []) {
    const startedAt = Date.now()
    broadcast(room, {
      type: 'escape_pickup_collected',
      pickupType,
      playerId: result.player.id,
      healthAfter: result.player.health,
      duration: pickupType === 'light_source' ? 1400 : 1200,
      startedAt,
      serverNow: startedAt,
    })
  }
  if (!exitWasRevealed && room.game.exitRevealed) {
    triggerEscapeAiSocial(room, 'lets_go')
  }
  if (!await showEscapePassive(room, result.passiveTrigger, token)) return
  if (result.passiveTrigger?.effect === 'retreat') {
    if (!await showEscapePassiveGif(room, 'flight', 640, token)) return
  }
  if (result.passiveMovement) {
    const duration = Math.min(500, Math.max(180, Math.abs(result.passiveMovement.to - result.passiveMovement.from) * 60))
    emitEvent(room, 'movement', {
      playerId: choice.playerId,
      from: result.passiveMovement.from,
      to: result.passiveMovement.to,
      kind: 'escape',
    }, duration)
    if (!await wait(room, duration, token)) return
  }
  if (result.encounter) {
    clearEscapeSocialQueue(room)
    emitEvent(room, 'escape_entity_revealed', result.encounter, 1200)
    if (!await wait(room, 1200, token)) return
    emitEvent(room, 'escape_entity_encounter', {
      ...result.encounter,
      ghost: (room.game.board.name === 'Dead Forest'
        ? ['jean', 'bald', 'uncle']
        : ['old_woman', 'red_eyes', 'white_face'])[Math.floor(Math.random() * 3)],
    }, 4000)
    if (!await wait(room, 4000, token)) return
    emitEvent(room, result.encounter.prevented ? 'escape_defended' : 'escape_attacked', result.encounter, 3000)
    if (!await wait(room, 3000, token)) return
    if (!result.encounter.prevented && result.encounter.healthAfter > 0) {
      triggerEscapeAiSocial(room, 'careful', result.encounter.playerId)
    }
    broadcastGame(room)
  } else broadcastGame(room)
  if (result.completionPassive) {
    if (!await showEscapePassive(room, result.completionPassive, token)) return
    if (!await showEscapePassiveGif(room, 'concentrate', 800, token)) return
    emitEvent(room, 'escape_entities_revealed', {
      playerId: result.completionPassive.playerId,
      entityIds: room.game.entities.map(entity => entity.id),
    }, 2000)
    if (!await wait(room, 2000, token)) return
  }
  if (room.game.exitUnlockPending) {
    room.game.exitUnlockPending = false
    emitEvent(room, 'escape_exit_unlocked', {}, 1500)
    if (!await wait(room, 1500, token)) return
  }
  if (room.game.exitSequencePending) {
    const deadForest = room.game.board.name === 'Dead Forest'
    const animationMs = deadForest ? 3200 : 2250
    const duration = deadForest ? 4200 : 2400
    emitEvent(room, 'escape_exit_opening', { animationMs }, duration)
    if (!await wait(room, duration, token)) return
    completeEscape(room.game)
    broadcastGame(room)
  }
  finishSequenceAndBeginTurn(room)
}

function chooseEscapeDirection(room, requesterId, direction) {
  const choice = room.directionChoice
  if (!choice || choice.playerId !== requesterId) return reject(sockets.get(requesterId), 'There is no direction choice for this player.')
  if (!['forward', 'backward'].includes(direction)) return reject(sockets.get(requesterId), 'Choose forward or backward.')
  finishEscapeDirection(room, direction)
}

async function playWhatEffects(room, player, what, effects, resolvedSpace, token) {
  for (const [effectIndex, step] of effects.entries()) {
    emitEvent(room, 'what_reveal', {
      playerId: player.id,
      playerName: player.name,
      name: what.name,
      description: affectedDescription(step.definition.description, player.name),
      effect: step.definition.effect,
      effectIndex,
      effectCount: effects.length,
    }, 3000)
    if (!await wait(room, 3000, token)) return null
  }

  for (const step of effects) {
    if (step.definition.type === 'destroyed_square') {
      if (what.name === '1 Bullet Sniper' && Math.random() >= 0.5) {
        emitEvent(room, 'what_missed', {}, 1000)
        if (!await wait(room, 1000, token)) return null
        continue
      }

      const count = Math.max(0, Number(step.definition.spaces) || 0)
      for (let index = 0; index < count; index += 1) {
        if (step.definition.effect === 'decrease_destroyed_square') {
          const space = room.game.destroyedSpaces.at(-1)
          if (!space) break
          const weapon = what.name === 'Silenced Pistol' ? 'silenced_pistol' : 'sniper'
          emitEvent(room, 'destroyed_square_removed', { space, weapon }, 750)
          if (!await wait(room, 750, token)) return null
          applyDestroyedSquareEffect(room.game, { ...step.definition, spaces: 1 })
          broadcastGame(room)
          continue
        }

        const nextSpace = (room.game.destroyedSpaces.at(-1) || 0) + 1
        if (nextSpace > 99) break
        emitEvent(room, 'destruction_square', {
          space: nextSpace,
          variant: destructionVariant(room),
        }, 750)
        if (!await wait(room, 750, token)) return null
        const result = applyDestroyedSquareEffect(room.game, { ...step.definition, spaces: 1 })
        broadcastGame(room)
        for (const caughtPlayer of result.players) {
          if (!await showCaughtPlayer(room, caughtPlayer, nextSpace, token)) return null
        }
        if (room.game.gameOver) break
      }
    }

    if (step.exactBounce) {
      const outwardDuration = Math.abs(100 - resolvedSpace) * 540
      if (outwardDuration > 0) {
        emitEvent(room, 'movement', {
          playerId: player.id,
          from: resolvedSpace,
          to: 100,
          kind: 'effect',
        }, outwardDuration)
        if (!await wait(room, outwardDuration, token)) return null
      }
      emitEvent(room, 'exact_bounce', step.exactBounce, 3000)
      if (!await wait(room, 3000, token)) return null
      const backwardDuration = step.exactBounce.extra * 540
      emitEvent(room, 'movement', {
        playerId: player.id,
        from: 100,
        to: step.exactBounce.destination,
        kind: 'exact-bounce',
      }, backwardDuration)
      if (!await wait(room, backwardDuration, token)) return null
    } else if (step.destination !== resolvedSpace) {
      const duration = Math.abs(step.destination - resolvedSpace) * 540
      emitEvent(room, 'movement', {
        playerId: player.id,
        from: resolvedSpace,
        to: step.destination,
        kind: 'effect',
      }, duration)
      if (!await wait(room, duration, token)) return null
    }
    if (step.exactBounce || step.definition.effect === 'move_back' || step.definition.effect === 'lose_turn') {
      triggerAiReactions(room, player.id, 'negative')
    } else if (step.definition.effect === 'move_forward') {
      triggerAiReactions(room, player.id, 'positive')
    }
    resolvedSpace = step.destination
    if (room.game.gameOver) break
  }
  if (room.game.lastExplosion?.spaces?.length && !room.game.gameOver) {
    room.game.lastExplosion.spaces = planRunAwayDestruction(room.game, room.game.lastExplosion.spaces.length)
  }
  return resolvedSpace
}

async function runTurnSequence(room, player, startSpace, roll, token, specialRoll = false, diceAlreadyShown = false, movementOverride = null) {
  if (!diceAlreadyShown) {
    emitEvent(room, 'dice_stopped', { playerId: player.id, result: roll, specialRoll }, 2000)
    if (!await wait(room, 2000, token)) return
  }
  const movement = movementOverride || {
    spaces: Math.abs(roll),
    signedSpaces: roll,
    direction: roll > 0 ? 'forward' : roll < 0 ? 'backward' : 'stay',
  }
  emitEvent(room, 'move_announcement', {
    playerId: player.id,
    ...movement,
  }, 2000)
  if (!await wait(room, 2000, token)) return

  const traversal = room.game.lastTraversalElimination
  const rollLanding = traversal?.from === startSpace ? traversal.space : Math.max(1, Math.min(100, startSpace + roll))
  const rollDuration = Math.abs(rollLanding - startSpace) * 540
  if (rollDuration > 0) {
    emitEvent(room, 'movement', { playerId: player.id, from: startSpace, to: rollLanding, kind: 'roll' }, rollDuration)
    if (!await wait(room, rollDuration, token)) return
    triggerAiReactions(room, player.id, rollLanding < startSpace ? 'negative' : 'positive')
  }

  const questionChain = room.game.lastQuestionChain || []
  let resolvedSpace = rollLanding
  const exactBounce = room.game.lastExactBounce
  if (exactBounce?.playerId === player.id && !player.eliminated) {
    emitEvent(room, 'exact_bounce', exactBounce, 3000)
    if (!await wait(room, 3000, token)) return
    const duration = exactBounce.extra * 540
    emitEvent(room, 'movement', {
      playerId: player.id,
      from: 100,
      to: exactBounce.destination,
      kind: 'exact-bounce',
    }, duration)
    if (!await wait(room, duration, token)) return
    triggerAiReactions(room, player.id, 'negative')
    resolvedSpace = exactBounce.destination
  }

  for (const resolution of questionChain) {
    if (resolution.kind === 'mine') {
      emitEvent(room, 'mine_explosion', resolution, 1600)
      if (!await wait(room, 1600, token)) return
      emitEvent(room, 'mine_push', resolution, 900)
      if (!await wait(room, 900, token)) return
      triggerAiReactions(room, player.id, 'negative')
      const settleDelay = Math.floor(Math.random() * 501)
      if (settleDelay && !await wait(room, settleDelay, token)) return
      resolvedSpace = resolution.destination
      continue
    }
    if (resolution.kind === 'reroll_pending') {
      resolvedSpace = resolution.destination
      continue
    }
    if (resolution.kind === 'reroll') {
      const duration = Math.abs(resolution.destination - resolvedSpace) * 540
      if (duration > 0) {
        emitEvent(room, 'movement', {
          playerId: player.id,
          from: resolvedSpace,
          to: resolution.destination,
          kind: 'reroll',
        }, duration)
        if (!await wait(room, duration, token)) return
      }
      resolvedSpace = resolution.destination
      continue
    }

    const nextSpace = await playWhatEffects(room, player, resolution.what, resolution.effects, resolvedSpace, token)
    if (nextSpace == null) return
    resolvedSpace = nextSpace
  }

  const ladder = !player.eliminated && room.game.board.ladders.find(item => item.from === resolvedSpace)
  if (ladder) {
    emitEvent(room, 'ladder', { playerId: player.id, from: ladder.from, to: ladder.to }, 1600)
    if (!await wait(room, 1600, token)) return
    triggerAiReactions(room, player.id, 'ladder')
  } else if (resolvedSpace !== player.space && !room.game.lastMineExplosion) {
    const duration = Math.abs(player.space - resolvedSpace) * 540
    emitEvent(room, 'movement', { playerId: player.id, from: resolvedSpace, to: player.space, kind: 'skill' }, duration)
    if (!await wait(room, duration, token)) return
  }

  const mineExplosion = room.game.lastMineExplosion
  if (mineExplosion?.playerId === player.id && !questionChain.some(item => item.kind === 'mine')) {
    emitEvent(room, 'mine_explosion', mineExplosion, 1600)
    if (!await wait(room, 1600, token)) return
    emitEvent(room, 'mine_push', mineExplosion, 900)
    if (!await wait(room, 900, token)) return
    triggerAiReactions(room, player.id, 'negative')
    const settleDelay = Math.floor(Math.random() * 501)
    if (settleDelay && !await wait(room, settleDelay, token)) return
  }

  if (traversal && !await showCaughtPlayer(room, player, traversal.space, token)) return

  if (room.game.mode === 'run_away' && player.finished && !player.eliminated && player.space === 100) {
    emitEvent(room, 'safe', { playerId: player.id, playerName: player.name }, 1200)
    if (!await wait(room, 1200, token)) return
  }
  if (player.finished && !player.eliminated && player.space === 100) {
    triggerAiReactions(room, player.id, 'finish')
  }

  if (!await runDestructionSequence(room, token)) return

  finishSequenceAndBeginTurn(room)
}

async function runParkourWhatSequence(room, result, token) {
  const player = result.player
  const icon = result.what.name === 'Bee Swarm' ? '🐝' : '💩'
  emitEvent(room, 'dice_stopped', {
    playerId: player.id,
    result: icon,
    resultLabel: result.what.name,
    specialRoll: true,
  }, 2000)
  if (!await wait(room, 2000, token)) return

  let resolvedSpace = result.from
  const directSpace = await playWhatEffects(room, player, result.what, result.effects, resolvedSpace, token)
  if (directSpace == null) return
  resolvedSpace = directSpace

  for (const resolution of result.questionChain) {
    if (resolution.kind === 'reroll_pending') continue
    if (resolution.kind === 'what') {
      const nextSpace = await playWhatEffects(room, player, resolution.what, resolution.effects, resolvedSpace, token)
      if (nextSpace == null) return
      resolvedSpace = nextSpace
      continue
    }
    if (resolution.destination === resolvedSpace) continue
    const duration = Math.abs(resolution.destination - resolvedSpace) * 540
    emitEvent(room, 'movement', {
      playerId: player.id,
      from: resolvedSpace,
      to: resolution.destination,
      kind: 'reroll',
    }, duration)
    if (!await wait(room, duration, token)) return
    resolvedSpace = resolution.destination
  }

  if (result.ladder) {
    emitEvent(room, 'ladder', {
      playerId: player.id,
      from: result.ladder.from,
      to: result.ladder.to,
    }, 1600)
    if (!await wait(room, 1600, token)) return
    triggerAiReactions(room, player.id, 'ladder')
  }
  const traversal = room.game.lastTraversalElimination
  if (traversal && !await showCaughtPlayer(room, player, traversal.space, token)) return
  if (room.game.mode === 'run_away' && player.finished && !player.eliminated && player.space === 100) {
    emitEvent(room, 'safe', { playerId: player.id, playerName: player.name }, 1200)
    if (!await wait(room, 1200, token)) return
  }
  if (player.finished && !player.eliminated && player.space === 100) {
    triggerAiReactions(room, player.id, 'finish')
  }
  if (!await runDestructionSequence(room, token)) return

  finishSequenceAndBeginTurn(room)
}

async function runAwayRollSequence(room, player, startSpace, dice, token) {
  emitEvent(room, 'run_away_dice_locked', {
    playerId: player.id,
    dice,
  }, 2000)
  if (!await wait(room, 2000, token)) return

  const operator = Math.random() < 0.5 ? '+' : '−'
  const result = operator === '+' ? dice[0] + dice[1] : dice[0] - dice[1]
  const description = describeRunAwayRoll(player.name, startSpace, result)
  takeTurn(room.game, result)
  emitEvent(room, 'dice_stopped', {
    playerId: player.id,
    dual: true,
    dice,
    operator,
    result,
    resultLabel: description.resultLabel,
  }, 2000)
  if (!await wait(room, 2000, token)) return
  runTurnSequence(room, player, startSpace, result, token, false, true, description.movement)
}

function stopRoll(room, requesterId, automatic = false) {
  if (!room.rolling || room.phase !== 'playing') return
  const current = room.game.players[room.game.currentPlayerIndex]
  if (!automatic && current.id !== requesterId) return reject(sockets.get(requesterId), 'Only the active player can stop the dice.')

  clearTimer(room.rollTimer)
  if (room.game.mode === 'escape_from') {
    room.rolling = null
    room.currentEvent = null
    if (automatic && !current.isAI) {
      skipEscapeTurn(room.game)
      broadcastGame(room)
      finishSequenceAndBeginTurn(room)
      return
    }
    const roll = Math.floor(Math.random() * 6) + 1
    room.directionChoice = { playerId: current.id, roll, startedAt: Date.now() }
    if (current.isAI) {
      finishEscapeDirection(room, chooseEscapeAiDirection(room.game, current, roll))
      return
    }
    emitEvent(room, 'escape_direction_choice', {
      playerId: current.id,
      roll,
      expiresAt: Date.now() + ESCAPE_DIRECTION_MS,
    }, ESCAPE_DIRECTION_MS)
    room.directionTimer = setTimeout(() => finishEscapeDirection(room, null), ESCAPE_DIRECTION_MS)
    return
  }
  const elapsed = Date.now() - room.rolling.startedAt
  for (const player of room.game.players) {
    if (player.skillCooldownUntil > room.rolling.startedAt) player.skillCooldownUntil += elapsed
  }

  const specialRoll = current.specialRollPending
  const dualRoll = room.game.mode === 'run_away' && !specialRoll
  if (dualRoll) {
    const dice = [
      Math.floor(Math.random() * 4) + 1,
      Math.floor(Math.random() * 4) + 1,
    ]
    const startSpace = current.space
    room.rolling = null
    const token = ++room.sequenceToken
    runAwayRollSequence(room, current, startSpace, dice, token)
    return
  }
  if (specialRoll && parkourWhats.length && Math.random() < 0.15) {
    const what = parkourWhats[Math.floor(Math.random() * parkourWhats.length)]
    room.rolling = null
    const result = takeParkourWhat(room.game, what)
    const token = ++room.sequenceToken
    runParkourWhatSequence(room, result, token)
    return
  }
  const roll = specialRoll
    ? Math.floor(Math.random() * 4) + 7
    : Math.floor(Math.random() * 6) + 1
  const startSpace = current.space
  room.rolling = null
  takeTurn(room.game, roll)
  const token = ++room.sequenceToken
  runTurnSequence(room, current, startSpace, roll, token, specialRoll)
}

function chooseEscapeMove(room, requesterId, roll) {
  const choice = room.escapeMoveChoice
  if (!choice || choice.playerId !== requesterId) return reject(sockets.get(requesterId), 'There is no move choice for this player.')
  if (!choice.options.includes(Number(roll))) return reject(sockets.get(requesterId), 'Choose one of the available moves.')
  clearTimer(room.rollTimer)
  room.rollTimer = null
  room.escapeMoveChoice = null
  room.currentEvent = null
  const current = room.game.players[room.game.currentPlayerIndex]
  room.directionChoice = { playerId: current.id, roll: Number(roll), startedAt: Date.now() }
  if (current.isAI) {
    finishEscapeDirection(room, chooseEscapeAiDirection(room.game, current, Number(roll)))
    return
  }
  emitEvent(room, 'escape_direction_choice', {
    playerId: current.id,
    roll: Number(roll),
    expiresAt: Date.now() + ESCAPE_DIRECTION_MS,
  }, ESCAPE_DIRECTION_MS)
  room.directionTimer = setTimeout(() => finishEscapeDirection(room, null), ESCAPE_DIRECTION_MS)
}

function skipEscapeMoveChoice(room, requesterId) {
  const choice = room.escapeMoveChoice
  const current = room.game?.players[room.game.currentPlayerIndex]
  if (!choice || choice.playerId !== requesterId || current?.id !== requesterId) {
    return reject(sockets.get(requesterId), 'There is no move choice for this player.')
  }
  if (!choice.canSkip || !canSkipEscapeMove(room.game, current)) {
    return reject(sockets.get(requesterId), 'Skip turn is only available while waiting on Square 100.')
  }
  clearTimer(room.rollTimer)
  room.rollTimer = null
  room.escapeMoveChoice = null
  room.currentEvent = null
  skipEscapeTurn(room.game)
  broadcastGame(room)
  finishSequenceAndBeginTurn(room)
}

function expireEscapeMoveChoice(room) {
  if (!room.escapeMoveChoice) return
  room.escapeMoveChoice = null
  room.currentEvent = null
  skipEscapeTurn(room.game)
  broadcastGame(room)
  finishSequenceAndBeginTurn(room)
}

function startRoll(room, requesterId, automatic = false, continuingSequence = false) {
  if (!canStartRoll(room, requesterId, automatic, continuingSequence)) {
    if (!automatic && room.phase === 'playing' && !room.busy && !room.rolling && !room.game.gameOver) {
      reject(sockets.get(requesterId), 'It is not your turn.')
    }
    return
  }
  const current = room.game.players[room.game.currentPlayerIndex]

  clearTimer(room.turnTimer)
  room.turnDeadline = null
  room.busy = true
  if (room.game.mode === 'escape_from') {
    const options = []
    while (options.length < 3) {
      const value = Math.floor(Math.random() * 6) + 1
      if (!options.includes(value)) options.push(value)
    }
    const duration = current.isAI ? 900 : ESCAPE_ROLL_MS
    const canSkip = canSkipEscapeMove(room.game, current)
    room.escapeMoveChoice = { playerId: current.id, options, canSkip, startedAt: Date.now() }
    emitEvent(room, 'escape_move_choice', {
      playerId: current.id,
      options,
      canSkip,
      expiresAt: Date.now() + duration,
    }, duration)
    room.rollTimer = setTimeout(() => {
      if (current.isAI && canSkip) skipEscapeMoveChoice(room, current.id)
      else if (current.isAI) chooseEscapeMove(room, current.id, options[Math.floor(Math.random() * options.length)])
      else expireEscapeMoveChoice(room)
    }, duration)
    return
  }
  const specialRoll = current.specialRollPending
  const dualRoll = room.game.mode === 'run_away' && !specialRoll
  const rollDuration = dualRoll ? 3000 : current.isAI ? 900 : 5000
  room.rolling = { playerId: current.id, startedAt: Date.now(), specialRoll, dualRoll }
  emitEvent(room, 'dice_rolling', {
    playerId: current.id,
    autoStopAt: Date.now() + rollDuration,
    min: specialRoll ? 7 : 1,
    max: specialRoll ? 10 : dualRoll ? 4 : 6,
    specialRoll,
    dual: dualRoll,
    faces: specialRoll ? [7, 8, 9, 10, '🐝', '💩'] : dualRoll ? [1, 2, 3, 4] : [1, 2, 3, 4, 5, 6],
  }, rollDuration)
  room.rollTimer = setTimeout(() => stopRoll(room, current.id, true), rollDuration)
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
    cooldownAddedMs: result.cooldownAddedMs,
    message: result.message,
    ignoreLadder: true,
  }, 2000)
  wait(room, 2000, token).then(async valid => {
    if (!valid) return
    if (!await runDestructionSequence(room, token)) return
    finishSequenceAndBeginTurn(room)
  })
}

function beginTurn(room) {
  if (!rooms.has(room.code) || room.phase !== 'playing' || room.busy || room.game.gameOver) {
    room.turnDeadline = null
    if (room.game?.gameOver) broadcastGame(room)
    return
  }

  const current = room.game.players[room.game.currentPlayerIndex]
  if (room.game.mode === 'escape_from' && current.isAI && canSkipEscapeMove(room.game, current)) {
    triggerEscapeAiSocial(room, 'lets_go')
  }
  if (room.game.mode === 'escape_from' && current.isAI) {
    const nearEntity = room.game.entities.some(entity => Math.abs(entity.space - current.space) <= 4)
    const weaponReady = current.weaponProtectFromTurn == null && current.weaponCooldownUntil <= Date.now()
    if (nearEntity && weaponReady && Math.random() < 0.5) {
      room.busy = true
      const result = armEscapeWeapon(room.game, current)
      finishEscapeWeaponArm(room, result)
      return
    }
  }
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
    wait(room, 3000, token).then(async valid => {
      if (!valid) return
      takeTurn(room.game)
      if (!await runDestructionSequence(room, token)) return
      finishSequenceAndBeginTurn(room)
    })
    return
  }

  if (current.isAI) {
    room.turnDeadline = null
    room.turnTimer = setTimeout(() => {
      if (current.rerollPending || current.specialRollPending) {
        startRoll(room, current.id, true)
        return
      }
      if (current.specialSkill?.name === 'Hidden Mine' && current.skillCooldownUntil <= Date.now() && current.skillBlockedTurns === 0) {
        useSkill(room, current.id, null, true)
        return
      }
      if (current.specialSkill?.name === 'Ragebait' && current.skillCooldownUntil <= Date.now() && current.skillBlockedTurns === 0) {
        const targets = room.game.players.filter(player => player.id !== current.id && !player.finished && !player.eliminated)
        if (targets.length) {
          useSkill(room, current.id, targets[Math.floor(Math.random() * targets.length)].id, true)
          return
        }
      }
      const skill = activateSkill(structuredClone(room.game), Date.now())
      if (skill.ok) useSkill(room, current.id, null, true)
      else startRoll(room, current.id, true)
    }, 550)
  } else {
    room.turnDeadline = Date.now() + TURN_MS
    room.turnTimer = setTimeout(() => applyPenalty(room), TURN_MS)
  }
  broadcastGame(room)
}

async function finishHiddenMinePlacement(room, playerId, requestedSpace = null) {
  const pending = room.pendingMine
  if (!pending || pending.playerId !== playerId || !pending.ready) return
  clearTimer(pending.timer)
  room.pendingMine = null
  const space = pending.options.includes(Number(requestedSpace))
    ? Number(requestedSpace)
    : pending.options[Math.floor(Math.random() * pending.options.length)]
  const result = activateSkill(room.game, Date.now(), space)
  if (!result.ok) {
    finishSequenceAndBeginTurn(room)
    return
  }
  room.currentEvent = null
  broadcastGame(room)
  endTurnAfterSkill(room.game)
  if (!await runDestructionSequence(room, pending.token)) return
  finishSequenceAndBeginTurn(room)
}

function startHiddenMinePlacement(room, current) {
  const options = hiddenMineOptions(room.game, current)
  if (!options.length) return reject(sockets.get(current.id), 'No valid mine square is available.')
  clearTimer(room.turnTimer)
  room.turnDeadline = null
  room.busy = true
  room.skillUsedTurnKey = `${room.game.turn}:${room.game.currentPlayerIndex}`
  const token = ++room.sequenceToken
  emitEvent(room, 'skill_pending', {
    playerId: current.id,
    playerName: current.name,
    color: current.color,
    name: current.specialSkill.name,
    description: current.specialSkill.description,
  }, 2000)
  room.pendingMine = { playerId: current.id, options, token, timer: null, ready: false }
  wait(room, 2000, token).then(valid => {
    const pending = room.pendingMine
    if (!valid || !pending || pending.playerId !== current.id) return
    pending.ready = true
    emitEvent(room, 'mine_placement', {
      playerId: current.id,
      options,
    }, 5000)
    pending.timer = setTimeout(() => finishHiddenMinePlacement(room, current.id), 5000)
    if (current.isAI) setTimeout(() => finishHiddenMinePlacement(room, current.id), 600)
  })
}

function finishRagebaitSelection(room, playerId, targetId = null) {
  const pending = room.pendingSkillTarget
  if (!pending || pending.playerId !== playerId) return
  clearTimer(pending.timer)
  room.pendingSkillTarget = null
  room.currentEvent = null
  const activeTarget = room.game.players.some(player =>
    player.id === targetId && player.id !== playerId && !player.finished && !player.eliminated)
  if (targetId && pending.targetIds.includes(targetId) && activeTarget) {
    room.busy = false
    room.skillUsedTurnKey = null
    useSkill(room, playerId, targetId)
    return
  }

  const player = room.game.players.find(item => item.id === playerId)
  if (player) player.skillCooldownUntil = Date.now() + SKILL_COOLDOWN_MS
  endTurnAfterSkill(room.game)
  broadcastGame(room)
  runDestructionSequence(room, pending.token).then(valid => {
    if (valid) finishSequenceAndBeginTurn(room)
  })
}

function startRagebaitSelection(room, current) {
  const targets = room.game.players
    .filter(player => player.id !== current.id && !player.finished && !player.eliminated)
    .map(player => ({
      id: player.id,
      name: player.name,
      color: player.color,
      face: player.face,
      space: player.space,
    }))
  if (!targets.length) return reject(sockets.get(current.id), 'No active player can be targeted.')

  clearTimer(room.turnTimer)
  room.turnDeadline = null
  room.busy = true
  room.skillUsedTurnKey = `${room.game.turn}:${room.game.currentPlayerIndex}`
  const token = ++room.sequenceToken
  emitEvent(room, 'skill_target_selection', {
    playerId: current.id,
    playerName: current.name,
    skillName: 'Ragebait',
    targets,
    expiresAt: Date.now() + 10_000,
  }, 10_000)
  room.pendingSkillTarget = {
    playerId: current.id,
    targetIds: targets.map(target => target.id),
    token,
    timer: setTimeout(() => finishRagebaitSelection(room, current.id), 10_000),
  }
}

function voteToSkipDestruction(room, playerId, checked) {
  const state = room.destructionSkip
  if (!updateDestructionSkipVote(state, playerId, checked)) return
  broadcastDestructionSkip(room, true)
}

function closeEscapeBriefing(room, playerId) {
  if (room.game?.mode !== 'escape_from' || !voteToCloseEscapeBriefing(room.escapeBriefing, playerId)) return
  const completed = !room.escapeBriefing.active
  if (completed) room.busy = false
  broadcastGame(room)
  if (completed) beginTurn(room)
}

function sendPlayerEmote(room, playerId, emoji) {
  const allowed = new Set(['😭', '😂', '😐', '😛', '😎'])
  const player = room.game?.players.find(item => item.id === playerId && !item.eliminated && !item.finished)
  if (!player || !allowed.has(emoji)) return
  broadcast(room, {
    type: 'player_emote',
    playerId,
    emoji,
    duration: 2000,
    startedAt: Date.now(),
    serverNow: Date.now(),
  })
}

function sendPlayerReaction(room, playerId, reaction) {
  const escapeMode = room.game?.mode === 'escape_from'
  const labels = escapeMode
    ? { lets_go: "Let's Go!", im_coming: "I'm Coming!", careful: 'Careful!' }
    : { aww: 'Aww', boo: 'Boo!', laugh: 'Haha!' }
  const player = room.game?.players.find(item => item.id === playerId && !item.isAI)
  if (!player || !labels[reaction]) return
  broadcast(room, {
    type: 'player_reaction',
    playerId,
    reaction,
    text: labels[reaction],
    characterId: escapeMode ? player.characterId : undefined,
    duration: 2000,
    startedAt: Date.now(),
    serverNow: Date.now(),
  })
  if (escapeMode && reaction === 'lets_go') {
    room.escapeSocialAvailableAt = Math.max(room.escapeSocialAvailableAt || 0, Date.now() + ESCAPE_SOCIAL_SOUND_MS)
    triggerEscapeAiSocial(room, 'im_coming', playerId)
  }
}

function triggerEscapeAiSocial(room, reaction, excludedPlayerId = null) {
  if (room.game?.mode !== 'escape_from') return
  const labels = { lets_go: "Let's Go!", im_coming: "I'm Coming!", careful: 'Careful!' }
  if (!labels[reaction]) return
  for (const player of room.game.players) {
    if (!player.isAI || player.id === excludedPlayerId || player.eliminated || player.finished || Math.random() >= 0.5) continue
    const conversational = reaction === 'lets_go' || reaction === 'im_coming'
    const playAt = conversational ? Math.max(Date.now(), room.escapeSocialAvailableAt || 0) : Date.now()
    if (conversational) room.escapeSocialAvailableAt = playAt + ESCAPE_SOCIAL_SOUND_MS
    const play = () => {
      if (!rooms.has(room.code) || room.game?.gameOver) return
      const currentPlayer = room.game.players.find(item => item.id === player.id)
      if (!currentPlayer || currentPlayer.eliminated || currentPlayer.finished) return
      const startedAt = Date.now()
      broadcast(room, {
        type: 'player_reaction',
        playerId: player.id,
        reaction,
        text: labels[reaction],
        characterId: player.characterId,
        duration: 2000,
        startedAt,
        serverNow: startedAt,
      })
    }
    const delay = playAt - Date.now()
    if (delay <= 0) play()
    else {
      const timer = setTimeout(() => {
        room.escapeSocialTimers?.delete(timer)
        play()
      }, delay)
      room.escapeSocialTimers ||= new Set()
      room.escapeSocialTimers.add(timer)
    }
  }
}

function triggerAiReactions(room, actorId, outcome) {
  if (!['standard', 'run_away'].includes(room.game?.mode)) return
  for (const reaction of chooseAiReactions(room.game.players, actorId, outcome)) {
    const startedAt = Date.now()
    if (reaction.type === 'emoji') {
      broadcast(room, {
        type: 'player_emote',
        playerId: reaction.playerId,
        emoji: reaction.value,
        duration: 2000,
        startedAt,
        serverNow: startedAt,
      })
    } else {
      broadcast(room, {
        type: 'player_reaction',
        playerId: reaction.playerId,
        reaction: reaction.value,
        text: reaction.value === 'boo' ? 'Boo!' : 'Haha!',
        duration: 2000,
        startedAt,
        serverNow: startedAt,
      })
    }
  }
}

function useSkill(room, requesterId, targetId = null, automatic = false) {
  if (room.pendingSkillTarget?.playerId === requesterId) {
    finishRagebaitSelection(room, requesterId, targetId)
    return
  }
  if (room.phase !== 'playing' || room.busy || room.game.gameOver) return
  const current = room.game.players[room.game.currentPlayerIndex]
  if (current.id !== requesterId) return reject(sockets.get(requesterId), 'Skill can only be used during your turn.')
  if (automatic && !current.isAI) return
  if (!automatic && current.isAI) return reject(sockets.get(requesterId), 'AI skills are controlled by the server.')
  if (current.skillBlockedTurns > 0) return reject(sockets.get(requesterId), `Skill blocked for ${current.skillBlockedTurns} turn(s).`)
  if (current.skillCooldownUntil > Date.now()) return reject(sockets.get(requesterId), 'Skill is still cooling down.')
  const turnKey = `${room.game.turn}:${room.game.currentPlayerIndex}`
  if (room.skillUsedTurnKey === turnKey) return reject(sockets.get(requesterId), 'Skill can only be used once per turn.')
  if (current.specialSkill?.name === 'Hidden Mine' && targetId == null) {
    startHiddenMinePlacement(room, current)
    return
  }
  if (current.specialSkill?.name === 'Ragebait' && targetId == null) {
    startRagebaitSelection(room, current)
    return
  }
  const validation = activateSkill(structuredClone(room.game), Date.now(), targetId)
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
    const result = activateSkill(room.game, Date.now(), targetId)
    const playOneLandingResolution = async landingResolution => {
      let resolvedSpace = landingResolution.landingSpace ?? result.movement?.to
      for (const resolution of landingResolution.questionChain) {
        if (resolution.kind === 'what') {
          const landingPlayer = room.game.players.find(item => item.id === landingResolution.playerId)
          const nextSpace = await playWhatEffects(
            room,
            landingPlayer,
            resolution.what,
            resolution.effects,
            resolvedSpace,
            token,
          )
          if (nextSpace == null) return false
          resolvedSpace = nextSpace
          continue
        }
        if (resolution.destination === resolvedSpace) continue
        const duration = Math.abs(resolution.destination - resolvedSpace) * 540
        emitEvent(room, 'movement', {
          playerId: landingResolution.playerId,
          from: resolvedSpace,
          to: resolution.destination,
          kind: 'reroll',
        }, duration)
        if (!await wait(room, duration, token)) return false
        triggerAiReactions(
          room,
          landingResolution.playerId,
          resolution.destination < resolvedSpace ? 'negative' : 'positive',
        )
        resolvedSpace = resolution.destination
      }

      const ladder = landingResolution.ladder
      if (ladder) {
        emitEvent(room, 'ladder', {
          playerId: landingResolution.playerId,
          from: ladder.from,
          to: ladder.to,
        }, 1600)
        if (!await wait(room, 1600, token)) return false
        triggerAiReactions(room, landingResolution.playerId, 'ladder')
      }
      return true
    }
    const playLandingResolutions = async () => {
      const resolutions = result.landingResolutions?.length
        ? result.landingResolutions
        : result.landingResolution ? [result.landingResolution] : []
      for (const resolution of resolutions) {
        if (!await playOneLandingResolution(resolution)) return false
      }
      return true
    }
    const showResult = () => {
      emitEvent(room, 'skill_result', {
        playerId: current.id,
        playerName: current.name,
        color: current.color,
        name: current.specialSkill.name,
        message: result.message,
        ok: result.ok,
      }, 2000)
      wait(room, 2000, token).then(async resultVisible => {
        if (!resultVisible) return
        room.currentEvent = null
        if (result.requiresRoll) {
          startRoll(room, current.id, current.isAI, true)
        } else {
          endTurnAfterSkill(room.game)
          if (!await runDestructionSequence(room, token)) return
          finishSequenceAndBeginTurn(room)
        }
      })
    }

    if (result.movement) {
      const duration = Math.abs(result.movement.to - result.movement.from) * 540
      emitEvent(room, 'movement', { ...result.movement, kind: 'skill' }, duration)
      wait(room, duration, token).then(async moved => {
        if (!moved) return
        triggerAiReactions(
          room,
          result.movement.playerId,
          result.movement.to < result.movement.from ? 'negative' : 'positive',
        )
        if (current.specialSkill?.name === 'Ragebait') {
          emitEvent(room, 'ragebait_consequence', {
            playerId: current.id,
            playerName: current.name,
            color: current.color,
            message: `${current.name} cannot move for the next 2 turns.`,
          }, 3000)
          if (!await wait(room, 3000, token)) return
          triggerAiReactions(room, current.id, 'negative')
        }
        if (await playLandingResolutions()) showResult()
      })
    } else {
      playLandingResolutions().then(resolved => {
        if (resolved) showResult()
      })
    }
  })
}

function startGame(room, requesterId) {
  if (room.hostId !== requesterId) return reject(sockets.get(requesterId), 'Only the host can start the game.')
  if (room.phase !== 'lobby') return reject(sockets.get(requesterId), 'The game has already started.')
  if (room.players.length < 2) return reject(sockets.get(requesterId), 'Add at least one player or AI.')
  if (room.players.length > roomMaxPlayers(room)) return reject(sockets.get(requesterId), 'This game mode allows at most four players.')
  const board = boards[room.boardIndex]
  if (!board || board.type !== room.modeKey || !boardIsAvailable(board)) return reject(sockets.get(requesterId), 'Choose an available board for this game mode.')
  if (!characterIndicesForMode(characters, room.modeKey).length) return reject(sockets.get(requesterId), 'No characters are available for this game mode.')

  const definitions = room.players.map(player => {
    const character = characters[player.characterIndex % characters.length]
    return {
      ...character,
      id: player.id,
      characterId: character.id,
      name: player.isAI ? `${character.name} AI` : (player.customName || character.name),
      isAI: player.isAI,
    }
  })
  room.game = createGameState(board, definitions, Date.now(), {
    exactMoveFor100: room.exactMoveFor100,
  })
  room.phase = 'playing'
  room.escapeBriefing = room.game.mode === 'escape_from'
    ? createEscapeBriefingState(room.players)
    : null
  room.busy = Boolean(room.escapeBriefing?.active)
  room.currentEvent = null
  broadcastGame(room, 'game_started')
  if (!room.busy) beginTurn(room)
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
    if (syncEscapeBriefingPlayers(room.escapeBriefing, room.players)) room.busy = false
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
  if (room.phase === 'playing') {
    broadcastGame(room, 'game_started')
    if (room.destructionSkip) broadcastDestructionSkip(room, true)
  }
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
        modeKey: gameModes[0]?.key || 'standard',
        boardIndex: firstBoardIndex(gameModes[0]?.key || 'standard'),
        exactMoveFor100: false,
        players: [],
        revision: 0,
        eventId: 0,
        disconnectTimers: new Map(),
        escapeSocialTimers: new Set(),
        escapeSocialAvailableAt: 0,
        sequenceToken: 0,
        turnDeadline: null,
        busy: false,
        memorialShown: false,
      }
      room.players.push({
        id: clientId,
        characterIndex: normalizeRoomCharacter(room, message.characterIndex) ?? 0,
        isAI: false,
        connected: true,
      })
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
      if (room.players.length >= roomMaxPlayers(room)) return reject(socket, 'Room is full.')
      const characterIndex = normalizeRoomCharacter(room, message.characterIndex, room.players.length)
      if (characterIndex == null) return reject(socket, 'No characters are available for this game mode.')
      room.players.push({ id: clientId, characterIndex, isAI: false, connected: true })
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
      const characterIndex = normalizeRoomCharacter(room, message.characterIndex, room.players.indexOf(player))
      if (characterIndex == null) reject(socket, 'No characters are available for this game mode.')
      else {
        player.characterIndex = characterIndex
        broadcastRoom(room)
      }
    } else if (message.type === 'ai_character') {
      if (room.hostId !== clientId) reject(socket, 'Only the host can change AI characters.')
      else if (room.phase !== 'lobby') reject(socket, 'AI characters can only be changed in the lobby.')
      else {
        const player = room.players.find(item => item.id === message.playerId && item.isAI)
        if (!player) reject(socket, 'AI player was not found.')
        else {
          const characterIndex = normalizeRoomCharacter(room, message.characterIndex, room.players.indexOf(player))
          if (characterIndex == null) reject(socket, 'No characters are available for this game mode.')
          else {
            player.characterIndex = characterIndex
            broadcastRoom(room)
          }
        }
      }
    } else if (message.type === 'mode') {
      if (room.hostId !== clientId) reject(socket, 'Only the host can select the game mode.')
      else if (room.phase === 'lobby' && gameModes.some(mode => mode.key === message.modeKey)) {
        if (message.modeKey === 'escape_from' && room.players.length > 4) {
          reject(socket, 'Escape From supports at most four players. Remove players first.')
          return
        }
        room.modeKey = message.modeKey
        room.boardIndex = firstBoardIndex(room.modeKey)
        remapRoomCharacters(room)
        broadcastRoom(room)
      }
    } else if (message.type === 'exact_move_for_100') {
      if (room.hostId !== clientId) reject(socket, 'Only the host can change game settings.')
      else if (room.phase === 'lobby') {
        room.exactMoveFor100 = Boolean(message.enabled)
        broadcastRoom(room)
      }
    } else if (message.type === 'board') {
      if (room.hostId !== clientId) reject(socket, 'Only the host can select the board.')
      else if (room.phase === 'lobby') {
        const boardIndex = Number(message.boardIndex)
        if (boards[boardIndex]?.type === room.modeKey && boardIsAvailable(boards[boardIndex])) {
          room.boardIndex = boardIndex
          broadcastRoom(room)
        } else reject(socket, 'That board is not available for this game mode.')
      }
    } else if (message.type === 'player_name') {
      const player = room.players.find(item => item.id === clientId && !item.isAI)
      if (!player) reject(socket, 'Only human players can edit their name.')
      else if (room.phase !== 'lobby') reject(socket, 'Names can only be edited in the lobby.')
      else {
        player.customName = normalizePlayerName(message.name) || null
        broadcastRoom(room)
      }
    } else if (message.type === 'add_ai') {
      if (room.hostId !== clientId) reject(socket, 'Only the host can add AI players.')
      else if (room.phase === 'lobby' && room.players.length < roomMaxPlayers(room)) {
        const available = characterIndicesForMode(characters, room.modeKey)
        if (!available.length) reject(socket, 'No characters are available for this game mode.')
        else {
          const used = new Set(room.players.map(item => item.characterIndex))
          const characterIndex = available.find(index => !used.has(index)) ?? available[room.players.length % available.length]
          room.players.push({ id: `ai-${Date.now()}-${Math.random()}`, characterIndex, isAI: true, connected: true })
          broadcastRoom(room)
        }
      }
    } else if (message.type === 'remove_ai') {
      if (room.hostId !== clientId) reject(socket, 'Only the host can remove AI players.')
      else if (room.phase === 'lobby') {
        room.players = room.players.filter(item => item.id !== message.playerId || !item.isAI)
        broadcastRoom(room)
      }
    } else if (message.type === 'kick_player') {
      if (room.hostId !== clientId) reject(socket, 'Only the host can kick players.')
      else if (room.phase !== 'lobby') reject(socket, 'Players can only be kicked from the lobby.')
      else {
        const player = room.players.find(item => item.id === message.playerId && item.id !== room.hostId)
        if (!player) reject(socket, 'Player cannot be kicked.')
        else {
          clearTimer(room.disconnectTimers.get(player.id))
          room.disconnectTimers.delete(player.id)
          room.players = room.players.filter(item => item.id !== player.id)
          const kickedSocket = sockets.get(player.id)
          if (kickedSocket) send(kickedSocket, { type: 'room_closed', reason: 'The host removed you from the room.' })
          broadcastRoom(room)
        }
      }
    } else if (message.type === 'start_game') startGame(room, clientId)
    else if (message.type === 'start_roll') startRoll(room, clientId)
    else if (message.type === 'stop_roll') stopRoll(room, clientId)
    else if (message.type === 'choose_escape_move') chooseEscapeMove(room, clientId, message.roll)
    else if (message.type === 'skip_escape_move') skipEscapeMoveChoice(room, clientId)
    else if (message.type === 'use_skill') useSkill(room, clientId, message.targetId)
    else if (message.type === 'place_mine') finishHiddenMinePlacement(room, clientId, message.space)
    else if (message.type === 'destruction_skip') voteToSkipDestruction(room, clientId, Boolean(message.checked))
    else if (message.type === 'close_escape_briefing') closeEscapeBriefing(room, clientId)
    else if (message.type === 'choose_direction') chooseEscapeDirection(room, clientId, message.direction)
    else if (message.type === 'arm_weapon') {
      if (room.game?.mode !== 'escape_from' || room.phase !== 'playing') reject(socket, 'Weapon unavailable.')
      else if (room.busy || room.game.players[room.game.currentPlayerIndex]?.id !== clientId) reject(socket, 'It is not your turn.')
      else {
        const result = armEscapeWeapon(room.game)
        if (!result.ok) reject(socket, result.message)
        else {
          room.busy = true
          finishEscapeWeaponArm(room, result)
        }
      }
    }
    else if (message.type === 'player_emote') sendPlayerEmote(room, clientId, message.emoji)
    else if (message.type === 'player_reaction') sendPlayerReaction(room, clientId, message.reaction)
  })

  socket.on('close', () => {
    if (!clientId || sockets.get(clientId) !== socket) return
    sockets.delete(clientId)
    const room = roomForClient(clientId)
    if (room) markDisconnected(room, clientId)
  })
})

console.log(`Authoritative multiplayer server listening on 0.0.0.0:${PORT}`)
