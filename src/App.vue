<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import characters from '../data/characters.json'
import boards from '../data/boards.json'
import gameModes from '../data/game_modes.json'
import explosionGif from '../assets/gifs/run_away/explosion.gif'
import zombieGif from '../assets/gifs/run_away/zombie.gif'
import escapeKeyGif from '../assets/gifs/escape_from/quiet_mansion/transparent/keys.gif'
import escapeEntityGif from '../assets/gifs/escape_from/quiet_mansion/transparent/entity_board_model.gif'
import escapeAttackedGif from '../assets/gifs/escape_from/quiet_mansion/transparent/attacked/gif.gif'
import escapeExorcisedGif from '../assets/gifs/escape_from/quiet_mansion/transparent/exorcised/gif.gif'
import oldWomanGif from '../assets/gifs/escape_from/quiet_mansion/transparent/ghosts/old_woman/gif.gif'
import redEyesGif from '../assets/gifs/escape_from/quiet_mansion/transparent/ghosts/red_eyes/gif.gif'
import whiteFaceGif from '../assets/gifs/escape_from/quiet_mansion/transparent/ghosts/white_face/gif.gif'
import oldWomanLastGif from '../assets/gifs/escape_from/quiet_mansion/transparent/ghosts/old_woman/last_frame.gif'
import redEyesLastGif from '../assets/gifs/escape_from/quiet_mansion/transparent/ghosts/red_eyes/last_frame.gif'
import whiteFaceLastGif from '../assets/gifs/escape_from/quiet_mansion/transparent/ghosts/white_face/last_frame.gif'
import { audioManager } from './audioManager'
import { getBoardSpacePosition } from './boardLayout'
import { boardIsAvailable, characterIndicesForMode } from './lobbyCatalog'

const boardImages = import.meta.glob('../assets/boards/**/template.{png,jpg,jpeg,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
})

function createClientId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const values = new Uint32Array(4)
    crypto.getRandomValues(values)
    return `client-${Array.from(values, value => value.toString(16).padStart(8, '0')).join('')}`
  }

  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

const page = ref('home')
const sfx = ref(70)
const music = ref(40)
const muted = ref(false)
const selected = ref(0)
const playerCharacter = ref(0)
const selectedBoard = ref(0)
const selectedMode = ref(gameModes[0]?.key || 'standard')
const playerNameDraft = ref('')
const editingPlayerName = ref(false)
const clientId = localStorage.getItem('ladders-client-id') || createClientId()
localStorage.setItem('ladders-client-id', clientId)
const roomCode = ref('')
const joinCode = ref('')
const onlineRoom = ref(null)
const onlineError = ref('')
const onlineStatus = ref('offline')
let lobbySocket
let reconnectTimer
let reconnectAttempts = 0
let shuttingDown = false
let serverClockOffset = 0
let lastRevision = 0
const seenEvents = new Set()
const game = ref(null)
const turnBusy = ref(false)
const diceRolling = ref(false)
const diceStopped = ref(false)
const diceSpecial = ref(false)
const diceDual = ref(false)
const displayedDice = ref(null)
const displayedDicePair = ref([1, 1])
const displayedOperator = ref('+')
const operatorSpinning = ref(false)
const diceResultLabel = ref('')
const movingPlayerId = ref(null)
const climbingPlayerId = ref(null)
const resolvingPlayerId = ref(null)
const visualSpaces = ref({})
const whatOverlay = ref(null)
const moveOverlay = ref(null)
const exactBounceOverlay = ref(null)
const skillOverlay = ref(null)
const skillActivatingOverlay = ref(null)
const skipOverlay = ref(null)
const visibleLog = ref([])
const now = ref(Date.now())
const skillNotice = ref('')
const skillTargetOptions = ref([])
const skillTargetMode = ref(null)
const skillTargetDeadline = ref(null)
const emojiPickerPlayerId = ref(null)
const activeEmojis = ref({})
const turnDeadline = ref(null)
const penaltyOverlay = ref(null)
const destructionOverlay = ref(null)
const destructionSpace = ref(null)
const destructionSkipState = ref(null)
const sighOverlay = ref(null)
const ripOverlay = ref(null)
const minePlacement = ref(null)
const mineExplosionSpace = ref(null)
const blownPlayerId = ref(null)
const directionChoice = ref(null)
const rollDeadline = ref(null)
const escapeOverlay = ref(null)
const healthBlinkPlayerId = ref(null)
const displayedHealth = ref({})
const escapeEncounterSpace = ref(null)
let clockTimer
let diceTimer
let operatorTimer

const defaultModeKey = gameModes[0]?.key || 'standard'
const homeCharacterIndices = computed(() => characterIndicesForMode(characters, defaultModeKey))
const lobbyCharacterIndices = computed(() => characterIndicesForMode(characters, selectedMode.value))
const hero = computed(() => characters[selected.value] || characters[homeCharacterIndices.value[0]])
const currentPlayer = computed(() => characters[playerCharacter.value])
const turnSeconds = computed(() => turnDeadline.value ? Math.max(0, Math.ceil((turnDeadline.value - (now.value + serverClockOffset)) / 1000)) : 0)
const controlledGamePlayer = computed(() => game.value?.players.find(player => player.id === clientId))
const isControlledTurn = computed(() => Boolean(game.value && controlledGamePlayer.value?.id === game.value.players[game.value.currentPlayerIndex]?.id))
const isLobbyHost = computed(() => onlineRoom.value?.hostId === clientId)
const selectedGameMode = computed(() => gameModes.find(mode => mode.key === selectedMode.value) || gameModes[0])
const bloodiedSpaces = computed(() => [...new Set(
  (game.value?.players || [])
    .filter(player => player.eliminated && player.space >= 1 && player.space <= 99)
    .map(player => player.space),
)].sort((a, b) => a - b))
const availableBoards = computed(() => boards
  .map((board, index) => ({ ...board, sourceIndex: index }))
  .filter(board => board.type === selectedMode.value && boardIsAvailable(board)))
const selectedLobbyBoard = computed(() => availableBoards.value.find(board => board.sourceIndex === selectedBoard.value) || availableBoards.value[0] || null)
const lobbyPlayers = computed(() => (onlineRoom.value?.players || []).map(player => ({
  ...player,
  character: characters[player.characterIndex % characters.length],
})))
const lobbySlotCount = computed(() => selectedMode.value === 'escape_from' ? 4 : 6)
const lobbyMaxPlayers = computed(() => lobbySlotCount.value)
const rollSeconds = computed(() => rollDeadline.value ? Math.max(0, Math.ceil((rollDeadline.value - (now.value + serverClockOffset)) / 1000)) : 0)
const directionSeconds = computed(() => directionChoice.value ? Math.max(0, Math.ceil((directionChoice.value.expiresAt - (now.value + serverClockOffset)) / 1000)) : 0)
const skillTargetSeconds = computed(() => skillTargetDeadline.value ? Math.max(0, Math.ceil((skillTargetDeadline.value - (now.value + serverClockOffset)) / 1000)) : 0)
const escapeVisiblePlayers = computed(() => game.value?.mode === 'escape_from'
  ? game.value.players.filter(player => !player.eliminated && !player.finished)
  : [])
const escapeCollectedKeys = computed(() => game.value?.keys?.filter(key => key.holderId).length || 0)
const dangerDistance = computed(() => {
  if (game.value?.mode !== 'escape_from' || !controlledGamePlayer.value || controlledGamePlayer.value.eliminated) return null
  const distances = (game.value.entities || []).map(entity => Math.abs(entity.space - controlledGamePlayer.value.space))
  return distances.length ? Math.min(...distances) : null
})
const ghostGifs = { old_woman: oldWomanGif, red_eyes: redEyesGif, white_face: whiteFaceGif }
const ghostLastGifs = { old_woman: oldWomanLastGif, red_eyes: redEyesLastGif, white_face: whiteFaceLastGif }

watch([sfx, music, muted], ([nextSfx, nextMusic, nextMuted]) => {
  audioManager.configure({ sfx: nextSfx, music: nextMusic, muted: nextMuted })
}, { immediate: true })

watch([page, () => game.value?.board?.music || game.value?.board?.name], ([nextPage, boardMusic]) => {
  audioManager.setScene(nextPage === 'game' ? 'game' : 'menu', boardMusic)
}, { immediate: true })

watch(dangerDistance, distance => {
  if (distance != null && distance <= 4) audioManager.escapeDanger(distance)
  else audioManager.stopEscapeDanger()
})

function boardPicture(board) {
  return boardImages[`../${board.picture}`]
}

function addAiPlayer() {
  sendLobby({ type: 'add_ai' })
}

function removeAiPlayer(playerId) {
  sendLobby({ type: 'remove_ai', playerId })
}

function kickPlayer(playerId) {
  sendLobby({ type: 'kick_player', playerId })
}

function socketUrl() {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.hostname}:8787`
}

function eventRemaining(event) {
  return Math.max(0, event.duration - ((Date.now() + serverClockOffset) - event.startedAt))
}

function clearGamePresentation() {
  window.clearInterval(diceTimer)
  window.clearInterval(operatorTimer)
  diceRolling.value = false
  diceStopped.value = false
  diceSpecial.value = false
  diceDual.value = false
  operatorSpinning.value = false
  diceResultLabel.value = ''
  moveOverlay.value = null
  exactBounceOverlay.value = null
  whatOverlay.value = null
  skillOverlay.value = null
  skillActivatingOverlay.value = null
  skillTargetOptions.value = []
  skillTargetMode.value = null
  skillTargetDeadline.value = null
  emojiPickerPlayerId.value = null
  activeEmojis.value = {}
  skipOverlay.value = null
  penaltyOverlay.value = null
  destructionOverlay.value = null
  destructionSpace.value = null
  destructionSkipState.value = null
  sighOverlay.value = null
  ripOverlay.value = null
  minePlacement.value = null
  mineExplosionSpace.value = null
  blownPlayerId.value = null
  directionChoice.value = null
  rollDeadline.value = null
  escapeOverlay.value = null
  healthBlinkPlayerId.value = null
  escapeEncounterSpace.value = null
  movingPlayerId.value = null
  climbingPlayerId.value = null
}

async function handleServerEvent(event) {
  if (!event || seenEvents.has(event.id)) return
  seenEvents.add(event.id)
  const remaining = eventRemaining(event)
  if (remaining <= 0) return
  skillTargetOptions.value = []
  turnBusy.value = true
  turnDeadline.value = null

  if (event.type === 'dice_rolling') {
    audioManager.diceRoll()
    diceStopped.value = false
    diceRolling.value = true
    diceSpecial.value = Boolean(event.data.specialRoll)
    diceDual.value = Boolean(event.data.dual)
    diceResultLabel.value = ''
    rollDeadline.value = event.data.autoStopAt || (event.startedAt + event.duration)
    const faces = event.data.faces || [1, 2, 3, 4, 5, 6]
    window.clearInterval(diceTimer)
    diceTimer = window.setInterval(() => {
      if (diceDual.value) {
        displayedDicePair.value = [
          faces[Math.floor(Math.random() * faces.length)],
          faces[Math.floor(Math.random() * faces.length)],
        ]
      } else {
        displayedDice.value = faces[Math.floor(Math.random() * faces.length)]
      }
    }, 45)
    if (diceDual.value) displayedOperator.value = '±'
  } else if (event.type === 'run_away_dice_locked') {
    audioManager.diceResult()
    window.clearInterval(diceTimer)
    diceRolling.value = false
    diceStopped.value = true
    diceDual.value = true
    displayedDicePair.value = event.data.dice
    diceResultLabel.value = 'Calculating...'
    displayedOperator.value = '+'
    operatorSpinning.value = true
    window.clearInterval(operatorTimer)
    operatorTimer = window.setInterval(() => {
      displayedOperator.value = displayedOperator.value === '+' ? '−' : '+'
    }, 90)
  } else if (event.type === 'dice_stopped') {
    audioManager.diceResult()
    window.clearInterval(diceTimer)
    diceRolling.value = false
    diceStopped.value = true
    diceSpecial.value = Boolean(event.data.specialRoll)
    diceDual.value = Boolean(event.data.dual)
    operatorSpinning.value = false
    window.clearInterval(operatorTimer)
    if (event.data.dual) {
      displayedDicePair.value = event.data.dice
      displayedOperator.value = event.data.operator
    }
    displayedDice.value = event.data.result
    diceResultLabel.value = event.data.resultLabel || ''
    rollDeadline.value = null
    directionChoice.value = null
    window.setTimeout(() => {
      diceStopped.value = false
      diceSpecial.value = false
      diceDual.value = false
      diceResultLabel.value = ''
    }, remaining)
  } else if (event.type === 'move_announcement') {
    moveOverlay.value = event.data
    window.setTimeout(() => { moveOverlay.value = null }, remaining)
  } else if (event.type === 'exact_bounce') {
    exactBounceOverlay.value = { ...event.data, eventId: event.id }
    window.setTimeout(() => {
      if (exactBounceOverlay.value?.eventId === event.id) exactBounceOverlay.value = null
    }, remaining)
  } else if (event.type === 'destruction_warning') {
    if (event.data.variant === 'ghost_town') audioManager.ghostTownAlarm()
    else audioManager.runAwayWarning()
    destructionOverlay.value = { type: 'warning', count: event.data.count, eventId: event.id }
    window.setTimeout(() => {
      if (destructionOverlay.value?.eventId === event.id) destructionOverlay.value = null
    }, remaining)
  } else if (event.type === 'destruction_square') {
    destructionOverlay.value = null
    if (event.data.variant === 'ghost_town') audioManager.ghostTownZombie()
    else audioManager.runAwayExplosion()
    destructionSpace.value = event.data.space
    window.setTimeout(() => {
      if (destructionSpace.value === event.data.space) destructionSpace.value = null
    }, remaining)
  } else if (event.type === 'destruction_caught') {
    audioManager.pauseMusic()
    if (event.data.variant === 'ghost_town') audioManager.ghostTownDevoured()
    else audioManager.runAwayDeath()
    destructionOverlay.value = { type: 'caught', ...event.data, eventId: event.id }
    window.setTimeout(() => {
      if (destructionOverlay.value?.eventId === event.id) destructionOverlay.value = null
      audioManager.resumeMusic()
    }, remaining)
  } else if (event.type === 'what_missed') {
    destructionOverlay.value = { type: 'missed', eventId: event.id }
    window.setTimeout(() => {
      if (destructionOverlay.value?.eventId === event.id) destructionOverlay.value = null
    }, remaining)
  } else if (event.type === 'ghost_gunshot') {
    audioManager.ghostTownGunshot(event.data.weapon)
  } else if (event.type === 'destroyed_square_removed') {
    audioManager.ghostTownGunshot(event.data.weapon)
  } else if (event.type === 'mine_placement') {
    if (event.data.playerId === clientId) {
      minePlacement.value = { options: event.data.options, eventId: event.id }
      window.setTimeout(() => {
        if (minePlacement.value?.eventId === event.id) minePlacement.value = null
      }, remaining)
    }
  } else if (event.type === 'mine_explosion') {
    audioManager.runAwayExplosion()
    visualSpaces.value[event.data.playerId] = event.data.landedSpace
    mineExplosionSpace.value = event.data.landedSpace
    window.setTimeout(() => {
      if (mineExplosionSpace.value === event.data.landedSpace) mineExplosionSpace.value = null
    }, remaining)
  } else if (event.type === 'mine_push') {
    blownPlayerId.value = event.data.playerId
    visualSpaces.value[event.data.playerId] = event.data.destination
    window.setTimeout(() => {
      if (blownPlayerId.value === event.data.playerId) blownPlayerId.value = null
    }, remaining)
  } else if (event.type === 'safe') {
    audioManager.runAwaySafe()
  } else if (event.type === 'run_away_sigh') {
    audioManager.pauseMusic()
    audioManager.runAwaySigh()
    sighOverlay.value = { eventId: event.id }
    window.setTimeout(() => {
      if (sighOverlay.value?.eventId === event.id) sighOverlay.value = null
    }, remaining)
  } else if (event.type === 'rip_memorial') {
    ripOverlay.value = { ...event.data, eventId: event.id }
    window.setTimeout(() => {
      if (ripOverlay.value?.eventId === event.id) ripOverlay.value = null
    }, remaining)
  } else if (event.type === 'movement') {
    audioManager.movement(remaining)
    const player = game.value?.players.find(item => item.id === event.data.playerId)
    if (player) {
      resolvingPlayerId.value = player.id
      await animateSpaceBySpace(player.id, event.data.from, event.data.to)
      resolvingPlayerId.value = null
    }
  } else if (event.type === 'ladder') {
    audioManager.ladder()
    climbingPlayerId.value = event.data.playerId
    visualSpaces.value[event.data.playerId] = event.data.to
    window.setTimeout(() => { climbingPlayerId.value = null }, remaining)
  } else if (event.type === 'what_reveal') {
    audioManager.whatEncountered(event.data.effect)
    whatOverlay.value = {
      playerName: event.data.playerName,
      name: event.data.name,
      displayDescription: event.data.description,
      effectIndex: event.data.effectIndex,
      effectCount: event.data.effectCount,
      eventId: event.id,
    }
    window.setTimeout(() => {
      if (whatOverlay.value?.eventId === event.id) whatOverlay.value = null
    }, remaining)
  } else if (event.type === 'skill_target_selection') {
    if (event.data.playerId === clientId) {
      skillTargetOptions.value = event.data.targets || []
      skillTargetMode.value = event.data.skillName
      skillTargetDeadline.value = event.data.expiresAt
      window.setTimeout(() => {
        if (skillTargetDeadline.value === event.data.expiresAt) {
          skillTargetOptions.value = []
          skillTargetMode.value = null
          skillTargetDeadline.value = null
        }
      }, remaining)
    }
  } else if (event.type === 'skill_pending') {
    if (event.data.playerId === clientId) {
      skillActivatingOverlay.value = { eventId: event.id }
      window.setTimeout(() => {
        if (skillActivatingOverlay.value?.eventId === event.id) skillActivatingOverlay.value = null
      }, remaining)
    } else {
      skillOverlay.value = { ...event.data, result: false }
    }
  } else if (event.type === 'skill_result') {
    if (event.data.playerId !== clientId) {
      skillOverlay.value = { ...event.data, result: true }
      window.setTimeout(() => { skillOverlay.value = null }, remaining)
    } else {
      skillNotice.value = ''
    }
  } else if (event.type === 'skip_notice') {
    audioManager.loseTurn()
    skipOverlay.value = { ...event.data, eventId: event.id }
    window.setTimeout(() => {
      if (skipOverlay.value?.eventId === event.id) skipOverlay.value = null
    }, remaining)
  } else if (event.type === 'penalty') {
    audioManager.penalty()
    penaltyOverlay.value = {
      player: { name: event.data.playerName },
      from: event.data.from,
      destination: event.data.to,
      message: event.data.message,
      cooldownAddedMs: event.data.cooldownAddedMs,
    }
    visualSpaces.value[event.data.playerId] = event.data.to
    window.setTimeout(() => { penaltyOverlay.value = null }, remaining)
  } else if (event.type === 'escape_direction_choice') {
    window.clearInterval(diceTimer)
    diceRolling.value = false
    rollDeadline.value = null
    displayedDice.value = event.data.roll
    directionChoice.value = { ...event.data, eventId: event.id }
    window.setTimeout(() => {
      if (directionChoice.value?.eventId === event.id) directionChoice.value = null
    }, remaining)
  } else if (event.type === 'escape_entity_revealed') {
    escapeEncounterSpace.value = event.data.space
    window.setTimeout(() => {
      if (escapeEncounterSpace.value === event.data.space) escapeEncounterSpace.value = null
    }, remaining)
  } else if (event.type === 'escape_entity_encounter') {
    escapeEncounterSpace.value = null
    audioManager.escapeVoice(event.data.ghost)
    escapeOverlay.value = { type: 'ghost', src: ghostGifs[event.data.ghost], eventId: event.id }
    const animationMs = 1000
    window.setTimeout(() => {
      if (escapeOverlay.value?.eventId === event.id) escapeOverlay.value.src = ghostLastGifs[event.data.ghost]
    }, Math.min(animationMs, remaining))
    window.setTimeout(() => {
      if (escapeOverlay.value?.eventId === event.id) escapeOverlay.value = null
    }, remaining + 1000)
  } else if (event.type === 'escape_exorcised' || event.type === 'escape_attacked') {
    const type = event.type === 'escape_exorcised' ? 'exorcised' : 'attacked'
    audioManager.escapeOutcome(type)
    escapeOverlay.value = { type, src: type === 'exorcised' ? escapeExorcisedGif : escapeAttackedGif, eventId: event.id }
    if (type === 'attacked') {
      displayedHealth.value[event.data.playerId] = event.data.healthBefore
      healthBlinkPlayerId.value = event.data.playerId
      window.setTimeout(() => {
        displayedHealth.value[event.data.playerId] = event.data.healthAfter
        if (healthBlinkPlayerId.value === event.data.playerId) healthBlinkPlayerId.value = null
      }, Math.min(1200, remaining))
    }
    window.setTimeout(() => {
      if (escapeOverlay.value?.eventId === event.id) escapeOverlay.value = null
    }, remaining)
  }
}

function applyGameSnapshot(message) {
  serverClockOffset = message.serverNow - Date.now()
  onlineRoom.value = message.room
  roomCode.value = message.room.code
  localStorage.setItem('ladders-room-code', message.room.code)
  selectedBoard.value = message.room.boardIndex
  selectedMode.value = message.room.modeKey || boards[message.room.boardIndex]?.type || gameModes[0]?.key
  const previousPlayer = game.value?.players.find(player => player.id === clientId)
  const previousWinnerId = game.value?.winner?.id
  const wasGameOver = game.value?.gameOver
  game.value = message.game
  const currentPlayerState = message.game?.players.find(player => player.id === clientId)
  if (currentPlayerState?.finished && !currentPlayerState.eliminated && !currentPlayerState.forfeited && !previousPlayer?.finished) {
    audioManager.playOutcome('winner', true)
  }
  if (message.game?.winner?.id === clientId && previousWinnerId !== clientId) {
    audioManager.playOutcome('winner', false)
  }
  if (message.game?.gameOver && !wasGameOver && message.game?.loser?.id === clientId) {
    audioManager.playOutcome('loser', false)
  }
  turnDeadline.value = message.turnDeadline
  visibleLog.value = [...(message.game?.log || [])]
  for (const player of message.game?.players || []) {
    if (visualSpaces.value[player.id] == null || !message.currentEvent) visualSpaces.value[player.id] = player.space
    if (healthBlinkPlayerId.value !== player.id && player.health != null) displayedHealth.value[player.id] = player.health
  }
  page.value = 'game'
  turnBusy.value = Boolean(message.currentEvent)
  if (message.currentEvent) handleServerEvent(message.currentEvent)
}

function resetOnlineRoom(reason = '') {
  clearGamePresentation()
  onlineRoom.value = null
  game.value = null
  roomCode.value = ''
  editingPlayerName.value = false
  playerNameDraft.value = ''
  turnDeadline.value = null
  localStorage.removeItem('ladders-room-code')
  lastRevision = 0
  seenEvents.clear()
  onlineError.value = reason
  page.value = 'home'
}

function handleSocketMessage(event) {
  const message = JSON.parse(event.data)
  if (message.serverNow) serverClockOffset = message.serverNow - Date.now()
  if (message.revision && message.revision < lastRevision) return
  if (message.revision) lastRevision = message.revision

  if (message.type === 'room_state') {
    onlineRoom.value = message.room
    roomCode.value = message.room.code
    localStorage.setItem('ladders-room-code', message.room.code)
    selectedBoard.value = message.room.boardIndex
    selectedMode.value = message.room.modeKey || boards[message.room.boardIndex]?.type || gameModes[0]?.key
    const me = message.room.players.find(player => player.id === clientId)
    if (me) {
      playerCharacter.value = me.characterIndex
      if (!editingPlayerName.value) {
        playerNameDraft.value = me.customName || characters[me.characterIndex % characters.length].name
      }
    }
    if (message.room.phase === 'lobby') page.value = 'lobby'
    onlineError.value = ''
  } else if (message.type === 'game_started' || message.type === 'game_state') {
    applyGameSnapshot(message)
  } else if (message.type === 'game_event') {
    handleServerEvent(message.event)
  } else if (message.type === 'destruction_skip_state') {
    destructionSkipState.value = message.active ? {
      total: message.total,
      voterIds: message.voterIds || [],
    } : null
  } else if (message.type === 'player_emote') {
    activeEmojis.value[message.playerId] = { emoji: message.emoji, startedAt: message.startedAt }
    const expiresIn = Math.max(0, message.duration - ((Date.now() + serverClockOffset) - message.startedAt))
    window.setTimeout(() => {
      if (activeEmojis.value[message.playerId]?.startedAt === message.startedAt) delete activeEmojis.value[message.playerId]
    }, expiresIn)
  } else if (message.type === 'room_closed') {
    resetOnlineRoom(message.reason)
  } else if (message.type === 'player_forfeited') {
    onlineError.value = `${message.playerName || 'A player'} forfeited.`
  } else if (message.type === 'action_rejected' || message.type === 'error') {
    if (/room no longer exists|not part of this room/i.test(message.message)) {
      resetOnlineRoom(message.message)
      return
    }
    onlineError.value = message.message
    skillNotice.value = message.message
  }
}

function handleSocketClose() {
  onlineStatus.value = 'offline'
  if (shuttingDown || !roomCode.value) return
  window.clearTimeout(reconnectTimer)
  reconnectTimer = window.setTimeout(async () => {
    reconnectAttempts++
    try {
      await connectLobby()
      sendLobby({ type: 'reconnect', code: roomCode.value })
      reconnectAttempts = 0
    } catch {}
  }, Math.min(8000, 500 * 2 ** reconnectAttempts))
}

function connectLobby() {
  if (lobbySocket?.readyState === WebSocket.OPEN) return Promise.resolve()
  onlineStatus.value = 'connecting'
  return new Promise((resolve, reject) => {
    lobbySocket = new WebSocket(socketUrl())
    lobbySocket.addEventListener('open', () => {
      onlineStatus.value = 'online'
      resolve()
    }, { once: true })
    lobbySocket.addEventListener('error', () => {
      onlineStatus.value = 'offline'
      onlineError.value = 'Could not reach the lobby server.'
      reject(new Error('Lobby server unavailable'))
    }, { once: true })
    lobbySocket.addEventListener('message', handleSocketMessage)
    lobbySocket.addEventListener('close', handleSocketClose, { once: true })
  })
}

function sendLobby(payload) {
  if (lobbySocket?.readyState === WebSocket.OPEN) {
    lobbySocket.send(JSON.stringify({ ...payload, clientId }))
  }
}

async function createOnlineLobby() {
  if (onlineRoom.value) {
    page.value = 'lobby'
    return
  }
  onlineError.value = ''
  lastRevision = 0
  seenEvents.clear()
  try {
    await connectLobby()
    sendLobby({ type: 'create', characterIndex: playerCharacter.value })
  } catch {}
}

async function joinOnlineLobby() {
  const code = joinCode.value.trim().toUpperCase()
  if (!code) {
    onlineError.value = 'Enter a room code.'
    return
  }
  onlineError.value = ''
  try {
    await connectLobby()
    sendLobby({ type: 'join', code, characterIndex: playerCharacter.value })
  } catch {}
}

function changeLobbyCharacter(direction) {
  const available = lobbyCharacterIndices.value
  if (!available.length) return
  const current = available.indexOf(playerCharacter.value)
  const next = (Math.max(0, current) + direction + available.length) % available.length
  playerCharacter.value = available[next]
  sendLobby({ type: 'character', characterIndex: playerCharacter.value })
}

function updateLobbyPlayerName() {
  const name = playerNameDraft.value.trim().slice(0, 20)
  playerNameDraft.value = name
  editingPlayerName.value = false
  sendLobby({ type: 'player_name', name })
}

function selectLobbyBoard(index) {
  if (onlineRoom.value && !isLobbyHost.value) return
  selectedBoard.value = index
  sendLobby({ type: 'board', boardIndex: index })
}

function changeLobbyBoard(direction) {
  if (!isLobbyHost.value || availableBoards.value.length < 2) return
  const current = availableBoards.value.findIndex(board => board.sourceIndex === selectedBoard.value)
  const next = (Math.max(0, current) + direction + availableBoards.value.length) % availableBoards.value.length
  selectLobbyBoard(availableBoards.value[next].sourceIndex)
}

function changeGameMode(event) {
  if (!isLobbyHost.value) return
  sendLobby({ type: 'mode', modeKey: event.target.value })
}

function changeExactMoveFor100(event) {
  if (!isLobbyHost.value) return
  sendLobby({ type: 'exact_move_for_100', enabled: event.target.checked })
}

function toggleDestructionSkip(event) {
  sendLobby({ type: 'destruction_skip', checked: event.target.checked })
}

async function shareInvite() {
  const url = `${location.origin}${location.pathname}?room=${roomCode.value}`
  const text = `Join my Ladders... And What?! room: ${roomCode.value}`
  if (navigator.share) {
    try { await navigator.share({ title: 'Ladders... And What?!', text, url }); return } catch {}
  }
  await navigator.clipboard.writeText(`${text}\n${url}`)
}

function requestStartGame() {
  if (!isLobbyHost.value) return
  sendLobby({ type: 'start_game' })
}

function leaveOnlineRoom() {
  sendLobby({ type: 'leave_room' })
  resetOnlineRoom('You left the room.')
}

function boardSpacePosition(space) {
  return getBoardSpacePosition(game.value?.board, space)
}

function destructionCellPosition(space) {
  if (game.value?.board?.name === 'Ghost Town') {
    return {
      ...boardSpacePosition(space),
      '--destroyed-cell-width': '9.25%',
      '--destroyed-cell-height': '9.15%',
    }
  }
  const row = Math.floor((space - 1) / 10)
  const positionInRow = (space - 1) % 10
  const column = row % 2 === 0 ? positionInRow : 9 - positionInRow
  const imageHeight = 1217 / 1254 * 100
  const imageTop = (100 - imageHeight) / 2
  const cellHeight = imageHeight / 10
  return {
    left: `${5 + column * 10}%`,
    top: `${imageTop + imageHeight - (row + 0.5) * cellHeight}%`,
    '--destroyed-cell-height': `calc(${cellHeight}% + 1px)`,
  }
}

function bloodSplatPosition(space) {
  return {
    ...destructionCellPosition(space),
    '--splat-rotation': `${(space * 47) % 360 - 180}deg`,
  }
}

function tokenPosition(space, playerIndex) {
  const offsets = [[-.9, -.9], [.9, -.9], [-.9, .9], [.9, .9], [0, -1.25], [0, 1.25]]
  const volcano = game.value?.board?.name === 'Volcano'
  const ghostTown = game.value?.board?.name === 'Ghost Town'
  const quietMansion = game.value?.board?.name === 'Quiet Mansion'
  const offsetScale = volcano ? 0.72 : ghostTown ? 0.55 : quietMansion ? 0.35 : 1
  const [rawOffsetX, rawOffsetY] = offsets[playerIndex % offsets.length]
  const offsetX = rawOffsetX * offsetScale
  const offsetY = rawOffsetY * offsetScale
  const position = boardSpacePosition(space)
  return {
    left: `calc(${position.left} + ${offsetX}%)`,
    top: `calc(${position.top} + ${offsetY}%)`,
    '--token-color': game.value.players[playerIndex].color,
  }
}

function visualSpace(player) {
  return visualSpaces.value[player.id] ?? player.space
}

function wait(milliseconds) {
  return new Promise(resolve => window.setTimeout(resolve, milliseconds))
}

async function animateSpaceBySpace(playerId, from, to) {
  if (from === to) return
  movingPlayerId.value = playerId
  const direction = to > from ? 1 : -1
  for (let space = from + direction; direction > 0 ? space <= to : space >= to; space += direction) {
    visualSpaces.value[playerId] = space
    await wait(540)
  }
  movingPlayerId.value = null
}

function skillCooldown(player) {
  return Math.max(0, Math.ceil((player.skillCooldownUntil - (now.value + serverClockOffset)) / 1000))
}

function logParts(entry) {
  if (!game.value) return [{ text: entry }]
  const players = [...game.value.players].sort((a, b) => b.name.length - a.name.length)
  const names = players.map(player => player.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!names.length) return [{ text: entry }]
  const matcher = new RegExp(`(${names.join('|')})`, 'g')
  return entry.split(matcher).filter(Boolean).map(text => {
    const player = players.find(item => item.name === text)
    const color = player && ['#000', '#000000', 'black'].includes(player.color.toLowerCase()) ? '#ffffff' : player?.color
    return player ? { text, color } : { text }
  })
}

function stopDiceRoll() {
  if (isControlledTurn.value) sendLobby({ type: 'stop_roll' })
}

function playTurn() {
  if (!game.value || game.value.gameOver || !isControlledTurn.value || turnBusy.value) return
  sendLobby({ type: 'start_roll' })
}

function useSkill(targetId = null) {
  if (!game.value || page.value !== 'game' || turnBusy.value || game.value.gameOver) return
  const player = game.value.players[game.value.currentPlayerIndex]
  if (!isControlledTurn.value) {
    skillNotice.value = 'Skill can only be used during your turn.'
    return
  }
  if (game.value.mode === 'escape_from') {
    sendLobby({ type: 'arm_weapon' })
    return
  }
  if (player.skillBlockedTurns > 0) {
    skillNotice.value = `Skill blocked for ${player.skillBlockedTurns} more turn(s).`
    return
  }
  if (skillCooldown(player) > 0) {
    skillNotice.value = 'Skill is still cooling down.'
    return
  }
  if (player.specialSkill?.name === 'Peek-a-Boo' && !targetId) {
    const opponents = game.value.players
      .filter(other => !other.finished && other.id !== player.id && Math.abs(other.space - player.space) <= 10)
      .sort((a, b) => Math.abs(a.space - player.space) - Math.abs(b.space - player.space))
    const closest = opponents[0]
    const stackedClosest = closest ? opponents.filter(other => other.space === closest.space) : []
    if (stackedClosest.length > 1) {
      skillTargetOptions.value = stackedClosest
      return
    }
  }
  skillTargetOptions.value = []
  sendLobby({ type: 'use_skill', targetId })
}

function selectSkillTarget(targetId) {
  skillTargetOptions.value = []
  skillTargetMode.value = null
  skillTargetDeadline.value = null
  sendLobby({ type: 'use_skill', targetId })
}

function toggleEmojiPicker(player) {
  if (player.id !== clientId || player.eliminated || player.finished) return
  if (turnBusy.value || skillTargetOptions.value.length || skillOverlay.value || skillActivatingOverlay.value) return
  emojiPickerPlayerId.value = emojiPickerPlayerId.value === player.id ? null : player.id
}

function sendPlayerEmoji(playerId, emoji) {
  if (playerId !== clientId) return
  emojiPickerPlayerId.value = null
  sendLobby({ type: 'player_emote', emoji })
}

function placeMine(space) {
  if (!minePlacement.value) return
  minePlacement.value = null
  sendLobby({ type: 'place_mine', space })
}

function handleGameKey(event) {
  if (event.key.toLowerCase() === 'g' && !event.repeat) useSkill()
}

function handleAudioUnlock() {
  audioManager.unlock()
}

function handleButtonHover(event) {
  const button = event.target.closest?.('button')
  if (!button || button.contains(event.relatedTarget)) return
  audioManager.buttonHover()
}

function handleButtonClick(event) {
  if (event.target.closest?.('button')) audioManager.buttonClick()
}

function move(direction) {
  const available = homeCharacterIndices.value
  if (!available.length) return
  const current = available.indexOf(selected.value)
  const next = (Math.max(0, current) + direction + available.length) % available.length
  selected.value = available[next]
}

function chooseDirection(direction) {
  if (!directionChoice.value) return
  directionChoice.value = null
  sendLobby({ type: 'choose_direction', direction })
}

function escapeObjectVisible(space) {
  return game.value?.mode !== 'escape_from' || escapeVisiblePlayers.value.some(player => visualSpace(player) === space)
}

function shownHealth(player) {
  return displayedHealth.value[player.id] ?? player.health ?? 0
}

onMounted(() => {
  clockTimer = window.setInterval(() => {
    now.value = Date.now()
  }, 250)
  window.addEventListener('keydown', handleGameKey)
  document.addEventListener('pointerdown', handleAudioUnlock, { once: true, capture: true })
  document.addEventListener('pointerover', handleButtonHover)
  document.addEventListener('click', handleButtonClick)
  window.render_game_to_text = () => JSON.stringify({
    page: page.value,
    room: onlineRoom.value ? {
      code: onlineRoom.value.code,
      mode: selectedMode.value,
      board: selectedLobbyBoard.value?.name || null,
      availableBoards: availableBoards.value.map(board => board.name),
      exactMoveFor100: Boolean(onlineRoom.value.exactMoveFor100),
      players: lobbyPlayers.value.length,
      canStart: isLobbyHost.value && lobbyPlayers.value.length >= 2 && Boolean(selectedLobbyBoard.value),
    } : null,
    game: game.value ? {
      mode: game.value.mode,
      board: game.value.board.name,
      turn: game.value.turn,
      nextDestructionTurn: game.value.nextExplosionTurn,
      exactMoveFor100: Boolean(game.value.exactMoveFor100),
      destructionSkip: destructionSkipState.value ? {
        votes: destructionSkipState.value.voterIds.length,
        total: destructionSkipState.value.total,
        checked: destructionSkipState.value.voterIds.includes(clientId),
      } : null,
      currentPlayer: game.value.players[game.value.currentPlayerIndex]?.name,
      players: game.value.players.map(player => ({
        name: player.name,
        space: player.space,
        finished: player.finished,
        eliminated: player.eliminated,
      })),
      destroyedSpaces: game.value.destroyedSpaces,
      keys: game.value.keys,
      entities: game.value.mode === 'escape_from' ? game.value.entities : undefined,
      exitRevealed: game.value.exitRevealed,
      exitUnlocked: game.value.exitUnlocked,
      winners: game.value.winners.map(player => player.name),
      winner: game.value.winner?.name || null,
      loser: game.value.loser?.name || null,
      gameOver: game.value.gameOver,
    } : null,
    coordinates: 'Board squares ascend from 1 to 100 in alternating left-to-right and right-to-left rows.',
  })
  window.advanceTime = milliseconds => {
    now.value += Math.max(0, Number(milliseconds) || 0)
  }
  const invitedRoom = new URLSearchParams(location.search).get('room')
  if (invitedRoom) {
    joinCode.value = invitedRoom.toUpperCase()
    joinOnlineLobby()
  } else {
    const rememberedRoom = localStorage.getItem('ladders-room-code')
    if (rememberedRoom) {
      roomCode.value = rememberedRoom
      connectLobby().then(() => sendLobby({ type: 'reconnect', code: rememberedRoom })).catch(() => {})
    }
  }
})

onUnmounted(() => {
  shuttingDown = true
  window.clearInterval(clockTimer)
  window.clearInterval(diceTimer)
  window.clearInterval(operatorTimer)
  window.clearTimeout(reconnectTimer)
  lobbySocket?.close()
  window.removeEventListener('keydown', handleGameKey)
  document.removeEventListener('pointerover', handleButtonHover)
  document.removeEventListener('click', handleButtonClick)
  audioManager.destroy()
  delete window.render_game_to_text
  delete window.advanceTime
})
</script>

<template>
  <main class="app" :class="`page-${page}`">
    <div class="grain"></div>

    <template v-if="page === 'home'">
      <section class="home-screen">
        <div class="player-badge" :style="{ '--badge-color': currentPlayer.color }">
          <div class="mini-pawn"><span>{{ currentPlayer.face }}</span></div>
          <div><small>Playing as</small><strong>{{ currentPlayer.name }}</strong></div>
        </div>
        <header class="brand brand-large">
          <span class="crown">♛</span>
          <span class="brand-top">LADDERS...</span>
          <span class="brand-bottom"><i>AND</i> WHAT?!</span>
        </header>
        <p class="tagline">Because life is full of surprises. <b>Duh.</b></p>
        <nav class="home-actions" aria-label="Main menu">
          <button class="game-button yellow" @click="createOnlineLobby"><span class="icon">▶</span> Play now</button>
          <button class="game-button green" @click="page = 'characters'"><span class="icon">♟</span> Characters</button>
          <button class="game-button blue" @click="page = 'settings'"><span class="icon">⚙</span> Settings</button>
        </nav>
        <div class="join-room">
          <input v-model="joinCode" maxlength="5" placeholder="ROOM CODE" @keyup.enter="joinOnlineLobby">
          <button @click="joinOnlineLobby">Join room</button>
          <small v-if="onlineError">{{ onlineError }}</small>
        </div>
        <div class="pawn pawn-blue"><span>•‿•</span></div>
        <div class="pawn pawn-red"><span>ಠ_ಠ</span></div>
        <div class="sticker sticker-left">CLIMB UP...<br><b>IF YOU DARE.</b></div>
        <div class="sticker sticker-right">PREPARE FOR<br><b>THE UNEXPECTED.</b></div>
      </section>
    </template>

    <template v-else-if="page === 'lobby'">
      <section class="lobby-screen">
        <header class="lobby-topbar">
          <button class="lobby-back" @click="page = 'home'" aria-label="Back to home">←</button>
          <div class="brand brand-lobby">
            <span class="crown">♛</span>
            <span class="brand-top">LADDERS...</span>
            <span class="brand-bottom"><i>AND</i> WHAT?!</span>
          </div>
          <div class="lobby-title">Lobby</div>
          <div class="lobby-tools">
            <button @click="page = 'settings'">⚙ <span>Settings</span></button>
          </div>
        </header>

        <div class="lobby-grid">
          <section class="room-panel">
            <div class="room-meta">
              <button class="room-code" title="Share invite" @click="shareInvite"><small>Room code</small><strong>{{ roomCode || '-----' }}</strong></button>
              <button title="Share invite" @click="shareInvite">▣</button>
              <p>Waiting for <b>chaos</b> to begin...</p>
            </div>

            <div class="player-slots">
              <article
                v-for="slot in lobbySlotCount"
                :key="slot"
                class="lobby-player"
                :class="lobbyPlayers[slot - 1] ? 'occupied' : 'empty'"
                :style="lobbyPlayers[slot - 1] ? { '--player-color': lobbyPlayers[slot - 1].character.color } : null"
              >
                <template v-if="lobbyPlayers[slot - 1]">
                  <button v-if="lobbyPlayers[slot - 1].isAI && isLobbyHost" type="button" class="remove-ai" @click.stop="removeAiPlayer(lobbyPlayers[slot - 1].id)" aria-label="Remove AI player">×</button>
                  <button
                    v-if="isLobbyHost && !lobbyPlayers[slot - 1].isAI && lobbyPlayers[slot - 1].id !== clientId"
                    type="button"
                    class="kick-player"
                    @click.stop="kickPlayer(lobbyPlayers[slot - 1].id)"
                    :aria-label="`Kick ${lobbyPlayers[slot - 1].customName || lobbyPlayers[slot - 1].character.name}`"
                    title="Kick player"
                  >×</button>
                  <span v-if="lobbyPlayers[slot - 1].isAI" class="ai-label">AI</span>
                  <span v-if="lobbyPlayers[slot - 1].id === onlineRoom?.hostId" class="host-crown">♛</span>
                  <button v-if="lobbyPlayers[slot - 1].id === clientId && lobbyCharacterIndices.length" type="button" class="lobby-char-arrow left" @click.stop.prevent="changeLobbyCharacter(-1)">‹</button>
                  <div
                    class="lobby-pawn"
                    :class="{ owned: lobbyPlayers[slot - 1].id === clientId }"
                    :tabindex="lobbyPlayers[slot - 1].id === clientId ? 0 : null"
                    :aria-describedby="lobbyPlayers[slot - 1].id === clientId ? `lobby-character-tip-${slot}` : null"
                  ><span>{{ lobbyPlayers[slot - 1].character.face }}</span></div>
                  <button v-if="lobbyPlayers[slot - 1].id === clientId && lobbyCharacterIndices.length" type="button" class="lobby-char-arrow right" @click.stop.prevent="changeLobbyCharacter(1)">›</button>
                  <div
                    v-if="lobbyPlayers[slot - 1].id === clientId"
                    :id="`lobby-character-tip-${slot}`"
                    class="lobby-character-tooltip"
                    role="tooltip"
                  >
                    <strong>{{ lobbyPlayers[slot - 1].customName || lobbyPlayers[slot - 1].character.name }}</strong>
                    <template v-if="lobbyPlayers[slot - 1].character.specialSkill">
                      <small>{{ lobbyPlayers[slot - 1].character.specialSkill.name }}</small>
                      <p>{{ lobbyPlayers[slot - 1].character.specialSkill.description }}</p>
                    </template>
                  </div>
                  <input
                    v-if="lobbyPlayers[slot - 1].id === clientId"
                    class="lobby-player-name"
                    v-model="playerNameDraft"
                    maxlength="20"
                    aria-label="Edit your player name"
                    title="Edit your player name"
                    @focus="editingPlayerName = true"
                    @blur="updateLobbyPlayerName"
                    @keydown.enter="$event.currentTarget.blur()"
                  >
                  <strong v-else>{{ lobbyPlayers[slot - 1].customName || lobbyPlayers[slot - 1].character.name }}</strong>
                  <small>✓ Ready</small>
                </template>
                <template v-else>
                  <div class="empty-mark">?</div>
                  <strong>Empty slot</strong>
                  <small>Waiting...</small>
                </template>
              </article>
            </div>

            <div class="room-actions">
              <button class="game-button purple" @click="shareInvite">♟ Invite</button>
              <button class="game-button ai-button" :disabled="!isLobbyHost || lobbyPlayers.length >= lobbyMaxPlayers || !lobbyCharacterIndices.length" @click="addAiPlayer">＋ Add AI</button>
              <button class="game-button exit" @click="leaveOnlineRoom">↪ Exit room</button>
              <button class="game-button green" :disabled="!isLobbyHost || lobbyPlayers.length < 2 || lobbyPlayers.length > lobbyMaxPlayers || !selectedLobbyBoard" @click="requestStartGame">▶ Start game</button>
            </div>
          </section>

          <section class="board-panel">
            <label class="mode-heading">
              <span>Game mode</span>
              <select :value="selectedMode" :disabled="!isLobbyHost" @change="changeGameMode">
                <option v-for="mode in gameModes" :key="mode.key" :value="mode.key">{{ mode.name }}</option>
              </select>
            </label>
            <label
              v-if="selectedMode === 'standard' || selectedMode === 'run_away'"
              class="exact-move-setting"
            >
              <input
                type="checkbox"
                :checked="Boolean(onlineRoom?.exactMoveFor100)"
                :disabled="!isLobbyHost"
                @change="changeExactMoveFor100"
              >
              <span>Exact Move for S100</span>
            </label>
            <div v-if="selectedLobbyBoard" class="board-carousel">
              <button
                type="button"
                class="board-arrow left"
                :disabled="!isLobbyHost || availableBoards.length < 2"
                aria-label="Previous board"
                @click="changeLobbyBoard(-1)"
              >
                ‹
              </button>
              <article class="board-option chosen" :key="selectedLobbyBoard.name">
                <img :src="boardPicture(selectedLobbyBoard)" :alt="`${selectedLobbyBoard.name} board`">
                <span class="board-copy">
                  <strong>{{ selectedLobbyBoard.name }}</strong>
                  <small>{{ selectedLobbyBoard.question_marks?.length || 0 }} surprises · {{ selectedLobbyBoard.ladders?.length || 0 }} ladders</small>
                </span>
                <span class="board-radio">✓</span>
              </article>
              <button
                type="button"
                class="board-arrow right"
                :disabled="!isLobbyHost || availableBoards.length < 2"
                aria-label="Next board"
                @click="changeLobbyBoard(1)"
              >
                ›
              </button>
            </div>
            <div v-else class="no-boards">No boards yet</div>
            <small v-if="!isLobbyHost" class="board-host-note">Only the host can change the board</small>
            <div class="board-tip">{{ selectedGameMode.description }}</div>
          </section>
        </div>
      </section>
    </template>

    <template v-else-if="page === 'game' && game">
      <section class="game-screen">
        <label v-if="destructionSkipState" class="destruction-skip-vote">
          <input
            type="checkbox"
            :checked="destructionSkipState.voterIds.includes(clientId)"
            @change="toggleDestructionSkip"
          >
          <span>Skip?</span>
          <small>{{ destructionSkipState.voterIds.length }} / {{ destructionSkipState.total }}</small>
        </label>
        <div
          v-if="game.mode === 'escape_from' && dangerDistance != null && dangerDistance <= 4"
          class="escape-danger-edge"
          :style="{ '--danger-speed': `${0.45 + dangerDistance * 0.28}s` }"
          aria-hidden="true"
        ></div>
        <div v-if="directionChoice" class="escape-direction-overlay" role="dialog" aria-modal="true">
          <small>Rolled {{ directionChoice.roll }} · {{ directionSeconds }}s</small>
          <strong>Choose direction</strong>
          <div>
            <button @click="chooseDirection('backward')">← Backward</button>
            <button @click="chooseDirection('forward')">Forward →</button>
          </div>
        </div>
        <div v-if="penaltyOverlay" class="penalty-overlay" role="status">
          <strong>Penalty</strong>
          <small>{{ penaltyOverlay.message }}</small>
        </div>
        <div v-if="sighOverlay" class="sigh-overlay" role="status">
          <strong>*Sigh*</strong>
        </div>
        <div v-if="destructionOverlay" class="destruction-overlay" :class="destructionOverlay.type" role="alert">
          <template v-if="destructionOverlay.type === 'warning'">
            <strong>Destruction</strong>
            <small>Destroying {{ destructionOverlay.count }} squares</small>
          </template>
          <template v-else-if="destructionOverlay.type === 'caught'">
            <strong>{{ destructionOverlay.playerName }} has been caught in the destruction</strong>
            <small>Eliminated on square {{ destructionOverlay.space }}</small>
          </template>
          <template v-else>
            <strong>Missed!</strong>
          </template>
        </div>
        <div v-if="moveOverlay" class="move-overlay" role="status">
          <small>Dice result</small>
          <strong v-if="moveOverlay.message">{{ moveOverlay.message }}</strong>
          <strong v-else-if="moveOverlay.direction === 'forward'">
            Move {{ moveOverlay.spaces }} {{ moveOverlay.spaces === 1 ? 'space' : 'spaces' }} forward
          </strong>
          <strong v-else-if="moveOverlay.direction === 'backward'">
            Move {{ moveOverlay.spaces }} {{ moveOverlay.spaces === 1 ? 'space' : 'spaces' }} backward
          </strong>
          <strong v-else>Stay on this square</strong>
        </div>
        <div v-if="exactBounceOverlay" class="exact-bounce-overlay" role="status">
          <strong>Oops going {{ exactBounceOverlay.extra }} {{ exactBounceOverlay.extra === 1 ? 'space' : 'spaces' }} backwards</strong>
        </div>
        <div v-if="ripOverlay" class="rip-overlay" role="status">
          <strong>R.I.P</strong>
          <small>{{ ripOverlay.names.join(' · ') }}</small>
        </div>
        <div v-if="diceRolling || diceStopped" class="dice-roll-overlay" :class="{ stopped: diceStopped, special: diceSpecial }" role="status">
          <small v-if="diceSpecial">Parkour special die · 7–10</small>
          <small v-else-if="diceDual">Run Away dice · 1–4 each</small>
          <div v-if="diceDual" class="run-away-dice-row">
            <div class="large-dice">{{ displayedDicePair[0] }}</div>
            <div class="operator-die" :class="{ spinning: operatorSpinning }">{{ displayedOperator }}</div>
            <div class="large-dice">{{ displayedDicePair[1] }}</div>
          </div>
          <div v-else-if="diceRolling" class="large-dice">{{ displayedDice || '?' }}</div>
          <div v-else class="large-dice result-number" :aria-label="`Rolled ${displayedDice}`">{{ displayedDice }}</div>
          <strong>{{ diceStopped ? (diceResultLabel || `Rolled ${displayedDice}`) : 'Rolling...' }}</strong>
          <button
            v-if="diceRolling && isControlledTurn"
            class="stop-dice-button"
            @click="stopDiceRoll"
          >{{ diceDual ? 'Stop both' : 'Stop' }}</button>
        </div>
        <div v-if="skipOverlay" class="skip-overlay" role="status">
          <small :style="{ color: skipOverlay.color }">{{ skipOverlay.playerName }}</small>
          <strong>Cannot move for {{ skipOverlay.turns }} turn(s) yet</strong>
          <p>Due to “{{ skipOverlay.whatName }}”</p>
        </div>
        <div v-if="skillOverlay" class="skill-overlay" role="status">
          <small>
            <b :style="{ color: skillOverlay.color }">{{ skillOverlay.playerName }}</b>
            {{ skillOverlay.result ? ' skill result' : ' is using' }}
          </small>
          <strong>{{ skillOverlay.name }}</strong>
          <p>{{ skillOverlay.result ? skillOverlay.message : skillOverlay.description }}</p>
        </div>
        <div v-if="skillActivatingOverlay" class="skill-activating-overlay" role="status" aria-live="polite">
          <strong>Activating Skill</strong>
          <span class="skill-loading-spinner" aria-hidden="true"></span>
        </div>
        <div v-if="skillTargetOptions.length" class="skill-target-overlay" role="dialog" aria-modal="true" :aria-label="`Choose ${skillTargetMode || 'skill'} target`">
          <div class="skill-target-card">
            <small>{{ skillTargetMode || 'Peek-a-Boo' }}</small>
            <strong>Choose a player</strong>
            <p v-if="skillTargetMode === 'Ragebait'">Choose within {{ skillTargetSeconds }}s or the skill expires.</p>
            <p v-else>These closest players share space {{ skillTargetOptions[0].space }}.</p>
            <div>
              <button
                v-for="target in skillTargetOptions"
                :key="target.id"
                type="button"
                :style="{ '--target-color': target.color }"
                @click="selectSkillTarget(target.id)"
              >
                <span>{{ target.face }}</span>
                {{ target.name }}
              </button>
            </div>
            <button v-if="skillTargetMode !== 'Ragebait'" type="button" class="skill-target-cancel" @click="skillTargetOptions = []">Cancel</button>
          </div>
        </div>
        <div v-if="whatOverlay" class="what-overlay" role="status">
          <small>
            What?!
            <span v-if="whatOverlay.effectCount > 1">
              Effect {{ whatOverlay.effectIndex + 1 }} of {{ whatOverlay.effectCount }}
            </span>
          </small>
          <strong>{{ whatOverlay.name }}</strong>
          <p><b>{{ whatOverlay.playerName }}</b>: {{ whatOverlay.displayDescription }}</p>
        </div>
        <header class="game-hud" :class="{ 'escape-hud': game.mode === 'escape_from' }">
          <button class="game-exit" @click="leaveOnlineRoom">← Exit</button>
          <div class="board-status">
            <small>Board</small>
            <strong>{{ game.board.name }}</strong>
          </div>
          <div class="turn-banner" v-if="!game.gameOver">
            <small class="turn-count">Turn {{ game.turn }}</small>
            <strong :style="{ color: game.players[game.currentPlayerIndex].color }">
              {{ game.players[game.currentPlayerIndex].name }}
            </strong>
          </div>
          <div v-if="game.mode === 'escape_from'" class="escape-key-status">
            <small>Keys</small>
            <strong>🔑 {{ escapeCollectedKeys }}/{{ game.board.keys_count }}</strong>
            <em>{{ game.exitUnlocked ? 'Exit unlocked' : game.exitRevealed ? 'Exit revealed' : 'Exit hidden' }}</em>
          </div>
          <div class="turn-banner winner-banner" v-if="game.gameOver">
            <small>Game over · {{ game.loser ? 'Loser' : game.winner ? 'Winner' : 'Finished' }}</small>
            <strong :style="{ color: (game.loser || game.winner)?.color }">
              {{ game.loser?.name || game.winner?.name || 'Everyone' }}
            </strong>
          </div>
          <div v-if="!game.gameOver" class="turn-timer" :class="{ urgent: turnSeconds <= 5 }">
            <small>Time left</small>
              <strong>{{ diceRolling && game.mode === 'escape_from' ? rollSeconds : turnSeconds }}s</strong>
          </div>
          <div class="hud-dice-panel">
            <button
              v-if="!game.gameOver"
              class="game-button yellow"
              :disabled="turnBusy || !isControlledTurn"
              @click="playTurn"
            >
              {{
                isControlledTurn
                  ? (controlledGamePlayer?.specialRollPending ? 'Parkour Roll' : controlledGamePlayer?.rerollPending ? 'Reroll' : 'Roll dice')
                  : `${game.players[game.currentPlayerIndex].name}'s turn`
              }}
            </button>
            <button v-else class="game-button green" @click="leaveOnlineRoom">Exit game</button>
          </div>
        </header>

        <div class="game-layout">
          <div class="game-board-wrap">
            <div class="game-board" :class="{ 'escape-board': game.mode === 'escape_from', 'encounter-active': escapeOverlay }">
              <img :src="boardPicture(game.board)" :alt="`${game.board.name} gameplay board`">
              <svg v-if="game.mode === 'escape_from'" class="escape-darkness" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <filter id="escape-lamp-soften" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="1.4"/>
                  </filter>
                  <mask id="escape-shared-vision">
                    <rect width="100" height="100" fill="white"/>
                    <g filter="url(#escape-lamp-soften)">
                      <circle
                        v-for="player in escapeVisiblePlayers"
                        :key="`lamp-${player.id}`"
                        :cx="parseFloat(boardSpacePosition(visualSpace(player)).left)"
                        :cy="parseFloat(boardSpacePosition(visualSpace(player)).top)"
                        r="6.5"
                        fill="black"
                      />
                    </g>
                  </mask>
                </defs>
                <rect width="100" height="100" fill="black" mask="url(#escape-shared-vision)"/>
              </svg>
              <img
                v-for="key in game.mode === 'escape_from' ? game.keys.filter(item => !item.holderId && item.space != null && escapeObjectVisible(item.space)) : []"
                :key="key.id"
                class="escape-board-object escape-key"
                :src="escapeKeyGif"
                :style="boardSpacePosition(key.space)"
                alt="Key"
              >
              <img
                v-for="entity in game.mode === 'escape_from' ? game.entities.filter(item => escapeObjectVisible(item.space)) : []"
                :key="entity.id"
                class="escape-board-object escape-entity"
                :class="{ encountered: escapeEncounterSpace === entity.space }"
                :src="escapeEntityGif"
                :style="boardSpacePosition(entity.space)"
                alt="Entity"
              >
              <div v-if="escapeOverlay" class="escape-encounter-overlay" :class="escapeOverlay.type" role="alert">
                <img :src="escapeOverlay.src" alt="">
              </div>
              <span
                v-if="game.board.name !== 'Ghost Town'"
                v-for="space in game.destroyedSpaces || []"
                :key="`destroyed-${space}`"
                class="destroyed-space"
                :style="destructionCellPosition(space)"
                :title="`Destroyed square ${space}`"
              ></span>
              <span
                v-for="space in game.board.name === 'Ghost Town' ? (game.destroyedSpaces || []) : []"
                :key="`destroyed-zombie-${space}`"
                class="destroyed-zombie"
                :style="destructionCellPosition(space)"
                :title="`Zombie-occupied square ${space}`"
              >
                <img :src="zombieGif" alt="">
              </span>
              <span
                v-for="space in bloodiedSpaces"
                :key="`blood-${space}`"
                class="blood-splat"
                :style="bloodSplatPosition(space)"
                aria-hidden="true"
              ></span>
              <span
                v-for="mine in game.hiddenMines || []"
                :key="`mine-${mine.ownerId}-${mine.space}`"
                class="hidden-mine"
                :style="boardSpacePosition(mine.space)"
                aria-label="Your hidden mine"
              >💣</span>
              <button
                v-for="space in minePlacement?.options || []"
                :key="`mine-option-${space}`"
                type="button"
                class="mine-option"
                :style="boardSpacePosition(space)"
                :aria-label="`Place mine on square ${space}`"
                @click="placeMine(space)"
              ></button>
              <img
                v-if="mineExplosionSpace"
                class="mine-explosion"
                :src="explosionGif"
                alt=""
                :style="boardSpacePosition(mineExplosionSpace)"
              >
              <img
                v-if="destructionSpace"
                class="destruction-effect"
                :class="{ 'ghost-town-zombie': game.board.name === 'Ghost Town' }"
                :src="game.board.name === 'Ghost Town' ? zombieGif : explosionGif"
                alt=""
                :style="boardSpacePosition(destructionSpace)"
              >
              <div
                v-for="(player, index) in game.players"
                :key="player.id"
                class="board-token"
                :class="{
                  active: index === game.currentPlayerIndex && !game.gameOver,
                  owned: player.id === clientId,
                  moving: movingPlayerId === player.id,
                  climbing: climbingPlayerId === player.id,
                  blown: blownPlayerId === player.id,
                  finished: player.finished && resolvingPlayerId !== player.id,
                  eliminated: player.eliminated
                }"
                :style="tokenPosition(visualSpace(player), index)"
                :title="`${player.name}: space ${player.space}`"
                @click.stop="toggleEmojiPicker(player)"
              >
                <div v-if="emojiPickerPlayerId === player.id" class="emoji-picker" @click.stop>
                  <button v-for="emoji in ['😭','😂','😐','😛','😎']" :key="emoji" type="button" @click="sendPlayerEmoji(player.id, emoji)">{{ emoji }}</button>
                </div>
                <span v-if="activeEmojis[player.id]" class="player-emote">{{ activeEmojis[player.id].emoji }}</span>
                <span>{{ player.face }}</span>
                <small>{{ index + 1 }}</small>
              </div>
            </div>
          </div>

          <aside class="game-console">
            <div class="player-order">
              <article
                v-for="(player, index) in game.players"
                :key="player.id"
                :class="{ current: index === game.currentPlayerIndex && !game.gameOver, finished: player.finished && resolvingPlayerId !== player.id, loser: game.loser?.id === player.id && resolvingPlayerId !== player.id, 'health-hit': healthBlinkPlayerId === player.id, 'mode-eliminated': player.eliminated && ['escape_from','run_away'].includes(game.mode), owned: player.id === clientId }"
                :style="{ '--player-color': player.color }"
                @click="toggleEmojiPicker(player)"
              >
                <span class="console-pawn">{{ player.face }}</span>
                <div>
                  <strong>{{ player.name }}</strong>
                  <small>{{ player.won ? 'Winner · Last standing' : player.eliminated ? 'Spectating · Eliminated' : player.finished && resolvingPlayerId !== player.id ? `Finished #${player.rank}` : `Space ${visualSpace(player)}` }}</small>
                  <small v-if="game.mode === 'escape_from'" class="escape-vitals">
                    <span aria-label="Health">{{ '♥'.repeat(shownHealth(player)) }}</span>
                    <b>🔑 {{ player.heldKeys.length }}/2</b>
                  </small>
                </div>
                <div v-if="resolvingPlayerId !== player.id" class="statuses">
                  <i v-if="player.skipTurns">⏳ {{ player.skipTurns }}</i>
                  <i v-if="player.skillBlockedTurns">🚫 Skill {{ player.skillBlockedTurns }}</i>
                </div>
              </article>
            </div>

            <div v-if="!game.gameOver && controlledGamePlayer" class="skill-panel">
              <template v-if="game.mode === 'escape_from'">
                <div class="skill-title">
                  <span>Weapon · Press <kbd>G</kbd></span>
                  <strong>{{ game.board.default_weapon.name }}</strong>
                </div>
                <p>{{ game.board.default_weapon.description }}</p>
                <button
                  type="button"
                  class="skill-state"
                  :class="{ ready: isControlledTurn && !turnBusy && controlledGamePlayer.weaponProtectFromTurn == null && controlledGamePlayer.weaponCooldownUntil <= now + serverClockOffset }"
                  :disabled="!isControlledTurn || turnBusy || controlledGamePlayer.weaponProtectFromTurn != null || controlledGamePlayer.weaponCooldownUntil > now + serverClockOffset"
                  @click="useSkill()"
                >
                  <template v-if="controlledGamePlayer.weaponProtectFromTurn != null && game.turn < controlledGamePlayer.weaponProtectFromTurn">
                    Scheduled for turns {{ controlledGamePlayer.weaponProtectFromTurn }}–{{ controlledGamePlayer.weaponProtectThroughTurn }}
                  </template>
                  <template v-else-if="controlledGamePlayer.weaponProtectFromTurn != null">
                    Active through turn {{ controlledGamePlayer.weaponProtectThroughTurn }}
                  </template>
                  <template v-else-if="controlledGamePlayer.weaponCooldownUntil > now + serverClockOffset">
                    Cooldown {{ Math.ceil((controlledGamePlayer.weaponCooldownUntil - (now + serverClockOffset)) / 1000) }}s
                  </template>
                  <template v-else-if="!isControlledTurn">Wait for your turn</template>
                  <template v-else>Arm weapon · Ends turn</template>
                </button>
                <small v-if="controlledGamePlayer.weaponPendingPenaltyMs">Next cooldown +{{ controlledGamePlayer.weaponPendingPenaltyMs / 1000 }}s</small>
              </template>
              <template v-else>
              <div class="skill-title">
                <span>Skill · Press <kbd>G</kbd></span>
                <strong>{{ controlledGamePlayer.specialSkill.name }}</strong>
              </div>
              <p>{{ controlledGamePlayer.specialSkill.description }}</p>
              <button
                type="button"
                class="skill-state"
                :class="{ ready: isControlledTurn && !turnBusy && skillCooldown(controlledGamePlayer) === 0 && !controlledGamePlayer.skillBlockedTurns }"
                :disabled="!isControlledTurn || turnBusy || game.gameOver || controlledGamePlayer.skillBlockedTurns > 0 || skillCooldown(controlledGamePlayer) > 0"
                @click="useSkill()"
              >
                <template v-if="!isControlledTurn">
                  Wait for your turn
                </template>
                <template v-else-if="turnBusy">
                  Please wait
                </template>
                <template v-else-if="controlledGamePlayer.skillBlockedTurns">
                  Blocked for {{ controlledGamePlayer.skillBlockedTurns }} turn(s)
                </template>
                <template v-else-if="skillCooldown(controlledGamePlayer)">
                  Cooldown {{ skillCooldown(controlledGamePlayer) }}s
                </template>
                <template v-else>Use skill · Tap or press G</template>
              </button>
              <small v-if="skillNotice">{{ skillNotice }}</small>
              </template>
            </div>

            <div class="event-log">
              <strong>Chaos log</strong>
              <p v-for="(entry, index) in visibleLog" :key="`${index}-${entry}`">
                <span
                  v-for="(part, partIndex) in logParts(entry)"
                  :key="partIndex"
                  :class="{ 'log-player-name': part.color }"
                  :style="part.color ? { color: part.color } : null"
                >{{ part.text }}</span>
              </p>
            </div>
          </aside>
        </div>
      </section>
    </template>

    <template v-else>
      <div class="inner-layout">
        <aside class="sidebar">
          <header class="brand brand-small">
            <span class="crown">♛</span>
            <span class="brand-top">LADDERS...</span>
            <span class="brand-bottom"><i>AND</i> WHAT?!</span>
          </header>
          <nav class="side-actions">
            <button class="game-button blue" @click="createOnlineLobby"><span class="icon">▶</span> Play now</button>
            <button class="game-button purple" :class="{ active: page === 'characters' }" @click="page = 'characters'"><span class="icon">♟</span> Characters</button>
            <button class="game-button yellow" :class="{ active: page === 'settings' }" @click="page = 'settings'"><span class="icon">⚙</span> Settings</button>
          </nav>
          <div class="note">MORE CHAOS<br>COMING SOON...<br><b>MAYBE.</b></div>
        </aside>

        <section class="content">
          <button class="back" @click="page = 'home'">← BACK</button>

          <template v-if="page === 'characters'">
            <div class="ribbon">Characters</div>
            <p class="subtitle"><b>Pick your chaos.</b><br>Each one comes with a bad attitude.</p>
            <div class="character-stage">
              <button class="arrow" @click="move(-1)" aria-label="Previous character">‹</button>
              <div class="character-card">
                <div v-if="selected === playerCharacter" class="selected-check" aria-label="Currently selected">✓</div>
                <div class="glow" :style="{ '--hero': hero.color }"></div>
                <div class="pawn hero-pawn" :style="{ '--pawn': hero.color }"><span>{{ hero.face }}</span></div>
                <div class="plinth"></div>
              </div>
              <button class="arrow" @click="move(1)" aria-label="Next character">›</button>
            </div>
            <div class="dots">
              <button v-for="characterIndex in homeCharacterIndices" :key="characterIndex" :class="{ selected: selected === characterIndex }" @click="selected = characterIndex" :aria-label="`Select character ${characterIndex + 1}`"></button>
            </div>
            <article class="character-info">
              <div><h2>{{ hero.name }}</h2><p>{{ hero.description }}</p></div>
              <div v-if="hero.specialSkill" class="skill"><h3>{{ hero.specialSkill.name }}</h3><p>{{ hero.specialSkill.description }}</p></div>
            </article>
            <button class="select-button" :class="{ confirmed: selected === playerCharacter }" @click="playerCharacter = selected">
              {{ selected === playerCharacter ? 'Selected' : 'Select' }}
            </button>
          </template>

          <template v-if="page === 'settings'">
            <div class="player-badge settings-player" :style="{ '--badge-color': currentPlayer.color }">
              <div class="mini-pawn"><span>{{ currentPlayer.face }}</span></div>
              <div><small>Playing as</small><strong>{{ currentPlayer.name }}</strong></div>
            </div>
            <div class="paper-panel">
              <div class="ribbon">Settings</div>
              <div class="setting-row">
                <div class="round-icon">🔊</div>
                <div class="setting-control">
                  <label for="sfx">SFX volume <output>{{ muted ? 0 : sfx }}</output></label>
                  <input id="sfx" v-model="sfx" type="range" min="0" max="100" :disabled="muted">
                  <p>Adjust the <b>sound effects</b> volume.</p>
                </div>
              </div>
              <div class="setting-row">
                <div class="round-icon">♫</div>
                <div class="setting-control">
                  <label for="music">Music volume <output>{{ muted ? 0 : music }}</output></label>
                  <input id="music" v-model="music" type="range" min="0" max="100" :disabled="muted">
                  <p>Adjust the <b>background music</b> volume.</p>
                </div>
              </div>
              <label class="mute-row">
                <span class="mute-icon">🔇</span><span><b>Mute all</b><small>Silence everything. Finally.</small></span>
                <input v-model="muted" type="checkbox"><i></i>
              </label>
            </div>
          </template>
        </section>
      </div>
    </template>
  </main>
</template>
