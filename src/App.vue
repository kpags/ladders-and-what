<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import characters from '../data/characters.json'
import boards from '../data/boards.json'
import { audioManager } from './audioManager'

const boardImages = import.meta.glob('../assets/boards/**/*.{png,jpg,jpeg,webp}', {
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
const displayedDice = ref(null)
const movingPlayerId = ref(null)
const climbingPlayerId = ref(null)
const resolvingPlayerId = ref(null)
const visualSpaces = ref({})
const whatOverlay = ref(null)
const moveOverlay = ref(null)
const skillOverlay = ref(null)
const skipOverlay = ref(null)
const visibleLog = ref([])
const now = ref(Date.now())
const skillNotice = ref('')
const skillTargetOptions = ref([])
const turnDeadline = ref(null)
const penaltyOverlay = ref(null)
let clockTimer
let diceTimer

const hero = computed(() => characters[selected.value])
const currentPlayer = computed(() => characters[playerCharacter.value])
const turnSeconds = computed(() => turnDeadline.value ? Math.max(0, Math.ceil((turnDeadline.value - (now.value + serverClockOffset)) / 1000)) : 0)
const controlledGamePlayer = computed(() => game.value?.players.find(player => player.id === clientId))
const isControlledTurn = computed(() => Boolean(game.value && controlledGamePlayer.value?.id === game.value.players[game.value.currentPlayerIndex]?.id))
const isLobbyHost = computed(() => onlineRoom.value?.hostId === clientId)
const lobbyPlayers = computed(() => (onlineRoom.value?.players || []).map(player => ({
  ...player,
  character: characters[player.characterIndex % characters.length],
})))

watch([sfx, music, muted], ([nextSfx, nextMusic, nextMuted]) => {
  audioManager.configure({ sfx: nextSfx, music: nextMusic, muted: nextMuted })
}, { immediate: true })

watch(page, nextPage => {
  audioManager.setScene(nextPage === 'game' ? 'game' : 'menu')
}, { immediate: true })

function boardPicture(board) {
  return boardImages[`../${board.picture}`]
}

function boardGuide(board) {
  return boardPicture({ picture: board.picture.replace(/template\.[^.]+$/, 'guides.png') })
}

function addAiPlayer() {
  sendLobby({ type: 'add_ai' })
}

function removeAiPlayer(playerId) {
  sendLobby({ type: 'remove_ai', playerId })
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
  diceRolling.value = false
  diceStopped.value = false
  moveOverlay.value = null
  whatOverlay.value = null
  skillOverlay.value = null
  skillTargetOptions.value = []
  skipOverlay.value = null
  penaltyOverlay.value = null
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
    window.clearInterval(diceTimer)
    diceTimer = window.setInterval(() => {
      displayedDice.value = Math.floor(Math.random() * 6) + 1
    }, 45)
  } else if (event.type === 'dice_stopped') {
    audioManager.diceResult()
    window.clearInterval(diceTimer)
    diceRolling.value = false
    diceStopped.value = true
    displayedDice.value = event.data.result
    window.setTimeout(() => { diceStopped.value = false }, remaining)
  } else if (event.type === 'move_announcement') {
    moveOverlay.value = event.data.spaces
    window.setTimeout(() => { moveOverlay.value = null }, remaining)
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
    }
    window.setTimeout(() => { whatOverlay.value = null }, remaining)
  } else if (event.type === 'skill_pending') {
    if (event.data.playerId !== clientId) {
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
    skipOverlay.value = event.data
    window.setTimeout(() => { skipOverlay.value = null }, remaining)
  } else if (event.type === 'penalty') {
    audioManager.penalty()
    penaltyOverlay.value = {
      player: { name: event.data.playerName },
      from: event.data.from,
      destination: event.data.to,
    }
    visualSpaces.value[event.data.playerId] = event.data.to
    window.setTimeout(() => { penaltyOverlay.value = null }, remaining)
  }
}

function applyGameSnapshot(message) {
  serverClockOffset = message.serverNow - Date.now()
  onlineRoom.value = message.room
  roomCode.value = message.room.code
  localStorage.setItem('ladders-room-code', message.room.code)
  selectedBoard.value = message.room.boardIndex
  const previousPlayer = game.value?.players.find(player => player.id === clientId)
  const wasGameOver = game.value?.gameOver
  game.value = message.game
  const currentPlayerState = message.game?.players.find(player => player.id === clientId)
  if (currentPlayerState?.finished && !currentPlayerState.forfeited && !previousPlayer?.finished) {
    audioManager.playOutcome('winner', true)
  }
  if (message.game?.gameOver && !wasGameOver && message.game?.loser?.id === clientId) {
    audioManager.playOutcome('loser', false)
  }
  turnDeadline.value = message.turnDeadline
  visibleLog.value = [...(message.game?.log || [])]
  for (const player of message.game?.players || []) {
    if (visualSpaces.value[player.id] == null || !message.currentEvent) visualSpaces.value[player.id] = player.space
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
    const me = message.room.players.find(player => player.id === clientId)
    if (me) playerCharacter.value = me.characterIndex
    if (message.room.phase === 'lobby') page.value = 'lobby'
    onlineError.value = ''
  } else if (message.type === 'game_started' || message.type === 'game_state') {
    applyGameSnapshot(message)
  } else if (message.type === 'game_event') {
    handleServerEvent(message.event)
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
  playerCharacter.value = (playerCharacter.value + direction + characters.length) % characters.length
  sendLobby({ type: 'character', characterIndex: playerCharacter.value })
}

function updateLobbyPlayerName(event) {
  const name = event.currentTarget.value.trim().slice(0, 20)
  event.currentTarget.value = name
  sendLobby({ type: 'player_name', name })
}

function selectLobbyBoard(index) {
  if (onlineRoom.value && !isLobbyHost.value) return
  selectedBoard.value = index
  sendLobby({ type: 'board', boardIndex: index })
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

function tokenPosition(space, playerIndex) {
  const offsets = [[-1.15, -1.15], [1.15, -1.15], [-1.15, 1.15], [1.15, 1.15], [0, -1.65], [0, 1.65]]
  const [offsetX, offsetY] = offsets[playerIndex % offsets.length]
  if (space === 100) {
    return { left: `${8.8 + offsetX}%`, top: `${8.8 + offsetY}%`, '--token-color': game.value.players[playerIndex].color }
  }
  const row = Math.floor((space - 1) / 10)
  const positionInRow = (space - 1) % 10
  const column = row % 2 === 0 ? positionInRow : 9 - positionInRow
  return {
    left: `${9 + column * 9.2 + offsetX}%`,
    top: `${90.5 - row * 9.15 + offsetY}%`,
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
  selected.value = (selected.value + direction + characters.length) % characters.length
}

onMounted(() => {
  clockTimer = window.setInterval(() => {
    now.value = Date.now()
  }, 250)
  window.addEventListener('keydown', handleGameKey)
  document.addEventListener('pointerdown', handleAudioUnlock, { once: true, capture: true })
  document.addEventListener('pointerover', handleButtonHover)
  document.addEventListener('click', handleButtonClick)
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
  window.clearTimeout(reconnectTimer)
  lobbySocket?.close()
  window.removeEventListener('keydown', handleGameKey)
  document.removeEventListener('pointerover', handleButtonHover)
  document.removeEventListener('click', handleButtonClick)
  audioManager.destroy()
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
                v-for="slot in 6"
                :key="slot"
                class="lobby-player"
                :class="lobbyPlayers[slot - 1] ? 'occupied' : 'empty'"
                :style="lobbyPlayers[slot - 1] ? { '--player-color': lobbyPlayers[slot - 1].character.color } : null"
              >
                <template v-if="lobbyPlayers[slot - 1]">
                  <button v-if="lobbyPlayers[slot - 1].isAI && isLobbyHost" class="remove-ai" @click="removeAiPlayer(lobbyPlayers[slot - 1].id)" aria-label="Remove AI player">×</button>
                  <span v-if="lobbyPlayers[slot - 1].isAI" class="ai-label">AI</span>
                  <span v-if="lobbyPlayers[slot - 1].id === onlineRoom?.hostId" class="host-crown">♛</span>
                  <button v-if="lobbyPlayers[slot - 1].id === clientId" class="lobby-char-arrow left" @click="changeLobbyCharacter(-1)">‹</button>
                  <div
                    class="lobby-pawn"
                    :class="{ owned: lobbyPlayers[slot - 1].id === clientId }"
                    :tabindex="lobbyPlayers[slot - 1].id === clientId ? 0 : null"
                    :aria-describedby="lobbyPlayers[slot - 1].id === clientId ? `lobby-character-tip-${slot}` : null"
                  ><span>{{ lobbyPlayers[slot - 1].character.face }}</span></div>
                  <button v-if="lobbyPlayers[slot - 1].id === clientId" class="lobby-char-arrow right" @click="changeLobbyCharacter(1)">›</button>
                  <div
                    v-if="lobbyPlayers[slot - 1].id === clientId"
                    :id="`lobby-character-tip-${slot}`"
                    class="lobby-character-tooltip"
                    role="tooltip"
                  >
                    <strong>{{ lobbyPlayers[slot - 1].customName || lobbyPlayers[slot - 1].character.name }}</strong>
                    <small>{{ lobbyPlayers[slot - 1].character.specialSkill.name }}</small>
                    <p>{{ lobbyPlayers[slot - 1].character.specialSkill.description }}</p>
                  </div>
                  <input
                    v-if="lobbyPlayers[slot - 1].id === clientId"
                    class="lobby-player-name"
                    :value="lobbyPlayers[slot - 1].customName || lobbyPlayers[slot - 1].character.name"
                    maxlength="20"
                    aria-label="Edit your player name"
                    title="Edit your player name"
                    @change="updateLobbyPlayerName"
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
              <button class="game-button ai-button" :disabled="!isLobbyHost || lobbyPlayers.length >= 6" @click="addAiPlayer">＋ Add AI</button>
              <button class="game-button exit" @click="leaveOnlineRoom">↪ Exit room</button>
              <button class="game-button green" :disabled="!isLobbyHost || lobbyPlayers.length < 2" @click="requestStartGame">▶ Start game</button>
            </div>
          </section>

          <section class="board-panel">
            <div class="board-heading">Choose a board</div>
            <div class="board-list">
              <button
                v-for="(board, index) in boards"
                :key="board.name"
                class="board-option"
                :class="{ chosen: selectedBoard === index }"
                @click="selectLobbyBoard(index)"
              >
                <img :src="boardPicture(board)" :alt="`${board.name} board`">
                <span class="board-copy">
                  <strong>{{ board.name }}</strong>
                  <small>{{ board.question_marks.length }} surprises · {{ board.ladders.length }} ladders</small>
                </span>
                <span class="board-radio">{{ selectedBoard === index ? '✓' : '' }}</span>
              </button>
            </div>
            <div class="board-tip"><b>💡 Tip:</b> Land on a question mark? Who knows what will happen. That’s the point.</div>
          </section>
        </div>
      </section>
    </template>

    <template v-else-if="page === 'game' && game">
      <section class="game-screen">
        <div v-if="penaltyOverlay" class="penalty-overlay" role="status">
          <strong>Penalty</strong>
          <small>{{ penaltyOverlay.player.name }} moved from {{ penaltyOverlay.from }} to {{ penaltyOverlay.destination }}</small>
        </div>
        <div v-if="moveOverlay" class="move-overlay" role="status">
          <small>Dice result</small>
          <strong>Move for {{ moveOverlay }} {{ moveOverlay === 1 ? 'space' : 'spaces' }}</strong>
        </div>
        <div v-if="diceRolling || diceStopped" class="dice-roll-overlay" :class="{ stopped: diceStopped }" role="status">
          <div v-if="diceRolling" class="large-dice">{{ displayedDice || '?' }}</div>
          <div v-else class="large-dice result-number" :aria-label="`Rolled ${displayedDice}`">{{ displayedDice }}</div>
          <strong>{{ diceStopped ? `Rolled ${displayedDice}` : 'Rolling...' }}</strong>
          <button
            v-if="diceRolling && isControlledTurn"
            class="stop-dice-button"
            @click="stopDiceRoll"
          >Stop</button>
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
        <div v-if="skillTargetOptions.length" class="skill-target-overlay" role="dialog" aria-modal="true" aria-label="Choose Peek-a-Boo target">
          <div class="skill-target-card">
            <small>Peek-a-Boo</small>
            <strong>Choose a player</strong>
            <p>These closest players share space {{ skillTargetOptions[0].space }}.</p>
            <div>
              <button
                v-for="target in skillTargetOptions"
                :key="target.id"
                type="button"
                :style="{ '--target-color': target.color }"
                @click="useSkill(target.id)"
              >
                <span>{{ target.face }}</span>
                {{ target.name }}
              </button>
            </div>
            <button type="button" class="skill-target-cancel" @click="skillTargetOptions = []">Cancel</button>
          </div>
        </div>
        <div v-if="whatOverlay" class="what-overlay" role="status">
          <small>What?!</small>
          <strong>{{ whatOverlay.name }}</strong>
          <p><b>{{ whatOverlay.playerName }}</b>: {{ whatOverlay.displayDescription }}</p>
        </div>
        <header class="game-hud">
          <button class="game-exit" @click="leaveOnlineRoom">← Exit</button>
          <div>
            <small>Board</small>
            <strong>{{ game.board.name }}</strong>
          </div>
          <div class="turn-banner" v-if="!game.gameOver">
            <small class="turn-count">Turn {{ game.turn }}</small>
            <strong :style="{ color: game.players[game.currentPlayerIndex].color }">
              {{ game.players[game.currentPlayerIndex].name }}
            </strong>
          </div>
          <div class="turn-banner winner-banner" v-else>
            <small>Game over · Loser</small>
            <strong :style="{ color: game.loser?.color }">{{ game.loser?.name || 'Nobody' }}</strong>
          </div>
          <div v-if="!game.gameOver" class="turn-timer" :class="{ urgent: turnSeconds <= 5 }">
            <small>Time left</small>
            <strong>{{ turnSeconds }}s</strong>
          </div>
          <div class="hud-dice-panel">
            <button
              v-if="!game.gameOver"
              class="game-button yellow"
              :disabled="turnBusy || !isControlledTurn"
              @click="playTurn"
            >
              {{ isControlledTurn ? 'Roll dice' : `${game.players[game.currentPlayerIndex].name}'s turn` }}
            </button>
            <button v-else class="game-button green" @click="leaveOnlineRoom">Exit game</button>
          </div>
        </header>

        <div class="game-layout">
          <div class="game-board-wrap">
            <div class="game-board">
              <img :src="boardGuide(game.board)" :alt="`${game.board.name} gameplay board`">
              <div
                v-for="(player, index) in game.players"
                :key="player.id"
                class="board-token"
                :class="{
                  active: index === game.currentPlayerIndex && !game.gameOver,
                  moving: movingPlayerId === player.id,
                  climbing: climbingPlayerId === player.id,
                  finished: player.finished && resolvingPlayerId !== player.id
                }"
                :style="tokenPosition(visualSpace(player), index)"
                :title="`${player.name}: space ${player.space}`"
              >
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
                :class="{ current: index === game.currentPlayerIndex && !game.gameOver, finished: player.finished && resolvingPlayerId !== player.id, loser: game.loser?.id === player.id && resolvingPlayerId !== player.id }"
                :style="{ '--player-color': player.color }"
              >
                <span class="console-pawn">{{ player.face }}</span>
                <div>
                  <strong>{{ player.name }}</strong>
                  <small>{{ player.finished && resolvingPlayerId !== player.id ? `Finished #${player.rank}` : `Space ${visualSpace(player)}` }}</small>
                </div>
                <div v-if="resolvingPlayerId !== player.id" class="statuses">
                  <i v-if="player.skipTurns">⏳ {{ player.skipTurns }}</i>
                  <i v-if="player.skillBlockedTurns">🚫 Skill {{ player.skillBlockedTurns }}</i>
                </div>
              </article>
            </div>

            <div v-if="!game.gameOver && controlledGamePlayer" class="skill-panel">
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
              <button v-for="(_, i) in characters" :key="i" :class="{ selected: selected === i }" @click="selected = i" :aria-label="`Select character ${i + 1}`"></button>
            </div>
            <article class="character-info">
              <div><h2>{{ hero.name }}</h2><p>{{ hero.description }}</p></div>
              <div class="skill"><h3>{{ hero.specialSkill.name }}</h3><p>{{ hero.specialSkill.description }}</p></div>
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
