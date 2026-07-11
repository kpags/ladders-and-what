<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import characters from '../data/characters.json'
import boards from '../data/boards.json'
import gameModes from '../data/game_modes.json'
import explosionGif from '../assets/gifs/run_away/explosion.gif'
import zombieGif from '../assets/gifs/run_away/zombie.gif'
import escapeMedkitGif from '../assets/gifs/escape_from/medkit.gif'
import escapeKeyGif from '../assets/gifs/escape_from/quiet_mansion/transparent/keys.gif'
import escapeEntityGif from '../assets/gifs/escape_from/quiet_mansion/transparent/entity_board_model.gif'
import escapeAttackedGif from '../assets/gifs/escape_from/quiet_mansion/transparent/attacked/gif.gif'
import escapeDefendedGif from '../assets/gifs/escape_from/quiet_mansion/defended/gif.gif'
import escapeExitGif from '../assets/gifs/escape_from/quiet_mansion/exit.gif'
import escapeExitLastFrame from '../assets/gifs/escape_from/quiet_mansion/exit_last_frame.png'
import escapeFlightGif from '../assets/gifs/escape_from/quiet_mansion/flight.gif'
import escapeConcentrateGif from '../assets/gifs/escape_from/quiet_mansion/concentrate.gif'
import escapeLightSourceGif from '../assets/gifs/escape_from/quiet_mansion/light_source.gif'
import oldWomanGif from '../assets/gifs/escape_from/quiet_mansion/entities/old_woman/gif.gif'
import redEyesGif from '../assets/gifs/escape_from/quiet_mansion/entities/red_eyes/gif.gif'
import whiteFaceGif from '../assets/gifs/escape_from/quiet_mansion/entities/white_face/gif.gif'
import oldWomanLastGif from '../assets/gifs/escape_from/quiet_mansion/entities/old_woman/last_frame.png'
import redEyesLastGif from '../assets/gifs/escape_from/quiet_mansion/entities/red_eyes/last_frame.png'
import whiteFaceLastGif from '../assets/gifs/escape_from/quiet_mansion/entities/white_face/last_frame.png'
import deadForestKeyGif from '../assets/gifs/escape_from/dead_forest/transparent/keys.gif'
import deadForestEntityGif from '../assets/gifs/escape_from/dead_forest/entity_board_model.gif'
import deadForestAttackedGif from '../assets/gifs/escape_from/dead_forest/attacked/gif.gif'
import deadForestDefendedGif from '../assets/gifs/escape_from/dead_forest/defended/gif.gif'
import deadForestExitGif from '../assets/gifs/escape_from/dead_forest/exit.gif'
import deadForestExitLastFrame from '../assets/gifs/escape_from/dead_forest/exit_last_frame.png'
import deadForestFlightGif from '../assets/gifs/escape_from/dead_forest/flight.gif'
import deadForestConcentrateGif from '../assets/gifs/escape_from/dead_forest/concentrate.gif'
import deadForestLightSourceGif from '../assets/gifs/escape_from/dead_forest/light_source.gif'
import jeanGif from '../assets/gifs/escape_from/dead_forest/entities/jean/gif.gif'
import baldGif from '../assets/gifs/escape_from/dead_forest/entities/bald/gif.gif'
import uncleGif from '../assets/gifs/escape_from/dead_forest/entities/uncle/gif.gif'
import jeanLastGif from '../assets/gifs/escape_from/dead_forest/entities/jean/last_frame.png'
import baldLastGif from '../assets/gifs/escape_from/dead_forest/entities/bald/last_frame.png'
import uncleLastGif from '../assets/gifs/escape_from/dead_forest/entities/uncle/last_frame.png'
import { audioManager } from './audioManager'
import { getBoardSpaceBounds, getBoardSpacePosition, getVisualSurroundingSpaces } from './boardLayout'
import { CLASH_BOARD_COLUMNS, CLASH_BOARD_SPACES } from './gameRules'
import { boardIsAvailable, characterIndicesForMode } from './lobbyCatalog'

const boardImages = import.meta.glob('../assets/boards/**/template.{png,jpg,jpeg,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
})
const clashMediaFiles = import.meta.glob('../assets/gifs/clash_with/**/*.{gif,png,webp}', {
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

const superscriptCharacters = new Set('⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁽⁾ⁿ')

function notationParts(value) {
  const text = String(value ?? '')
  const parts = []
  let index = 0

  while (index < text.length) {
    const character = text[index]
    if (character === '^' && index + 1 < text.length) {
      let end = index + 1
      while (end < text.length && /[A-Za-z0-9+\-()]/.test(text[end])) end += 1
      if (end > index + 1) {
        parts.push({ text: text.slice(index + 1, end), exponent: true })
        index = end
        continue
      }
    }
    if (superscriptCharacters.has(character)) {
      let end = index + 1
      while (end < text.length && superscriptCharacters.has(text[end])) end += 1
      parts.push({ text: text.slice(index, end), exponent: true })
      index = end
      continue
    }

    let end = index + 1
    while (end < text.length && text[end] !== '^' && !superscriptCharacters.has(text[end])) end += 1
    parts.push({ text: text.slice(index, end), exponent: false })
    index = end
  }

  return parts.length ? parts : [{ text: '', exponent: false }]
}

const page = ref('home')
const sfx = ref(70)
const music = ref(20)
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
const playNowPrompt = ref(false)
const roomExitConfirm = ref(false)
const roomList = ref([])
const roomListLoading = ref(false)
const isSpectating = ref(false)
const settingsReturnPage = ref('home')
const settingsModalOpen = ref(false)
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
const emojiPickerPlacement = ref('board')
const activeEmojis = ref({})
const activeReactions = ref({})
const activeLobbyMessages = ref({})
const lobbyMessageTargetId = ref(null)
const lobbyMessageDraft = ref('')
const lobbyMessageTimeouts = new Map()
const turnDeadline = ref(null)
const penaltyOverlay = ref(null)
const destructionOverlay = ref(null)
const destructionSpace = ref(null)
const destructionSkipState = ref(null)
const escapeBriefing = ref(null)
const sighOverlay = ref(null)
const ripOverlay = ref(null)
const minePlacement = ref(null)
const mineExplosionSpace = ref(null)
const blownPlayerId = ref(null)
const directionChoice = ref(null)
const escapeMoveChoice = ref(null)
const rollDeadline = ref(null)
const escapeOverlay = ref(null)
const weaponEquippedOverlay = ref(null)
const escapePassiveOverlay = ref(null)
const escapePassiveGifOverlay = ref(null)
const revealedEscapeEntities = ref(null)
const clashActionMode = ref(null)
const clashSelectedWeapon = ref('')
const clashSelectedWeaponMode = ref('')
const clashSelectedItem = ref('')
const clashItemTargeting = ref(null)
const clashKillFeed = ref(null)
const clashBulletTraces = ref([])
const clashThrownItems = ref([])
const clashItemEffects = ref([])
const clashDamageBlinkIds = ref({})
const clashStunBlinkIds = ref({})
const clashStunSkipOverlay = ref(null)
const clashShotOverlay = ref(null)
const clashMeleeOverlay = ref(null)
const clashRivalRevealUntil = ref(0)
const clashRivalRevealKey = ref('')
const healthBlinkPlayerId = ref(null)
const healthHealPlayerId = ref(null)
const displayedHealth = ref({})
const escapeEncounterSpace = ref(null)
const escapePickupNotice = ref(null)
const visionRevealProgress = ref({})
const guessWhatDifficulty = ref(null)
const guessWhatQuestion = ref(null)
const guessWhatResult = ref(null)
let clockTimer
let diceTimer
let operatorTimer

const defaultModeKey = gameModes[0]?.key || 'standard'
const CLASH_MELEE_EFFECT_MS = 2150
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
const exactMoveSettingAvailable = computed(() => selectedMode.value === 'standard' || selectedMode.value === 'run_away')
const availableRoomList = computed(() => roomList.value.filter(room => room.phase === 'lobby'))
const inGameRoomList = computed(() => roomList.value.filter(room => room.phase === 'playing'))
const rollSeconds = computed(() => rollDeadline.value ? Math.max(0, Math.ceil((rollDeadline.value - (now.value + serverClockOffset)) / 1000)) : 0)
const directionSeconds = computed(() => directionChoice.value ? Math.max(0, Math.ceil((directionChoice.value.expiresAt - (now.value + serverClockOffset)) / 1000)) : 0)
const escapeMoveSeconds = computed(() => escapeMoveChoice.value ? Math.max(0, Math.ceil((escapeMoveChoice.value.expiresAt - (now.value + serverClockOffset)) / 1000)) : 0)
const skillTargetSeconds = computed(() => skillTargetDeadline.value ? Math.max(0, Math.ceil((skillTargetDeadline.value - (now.value + serverClockOffset)) / 1000)) : 0)
const guessWhatSeconds = computed(() => guessWhatQuestion.value
  ? Math.max(0, Math.ceil((guessWhatQuestion.value.expiresAt - (now.value + serverClockOffset)) / 1000))
  : 0)
const clashViewPlayer = computed(() => {
  if (game.value?.mode !== 'clash_with') return null
  return controlledGamePlayer.value
    ? controlledGamePlayer.value
    : game.value.players[game.value.currentPlayerIndex]
})
const clashVisibleSpaces = computed(() => {
  const spaces = new Set()
  const player = clashViewPlayer.value
  if (!player) return spaces
  if (player.eliminated) {
    for (let space = 1; space <= CLASH_BOARD_SPACES; space++) spaces.add(space)
    return spaces
  }
  const row = Math.floor((player.space - 1) / CLASH_BOARD_COLUMNS)
  const position = (player.space - 1) % CLASH_BOARD_COLUMNS
  const column = row % 2 === 0 ? position : CLASH_BOARD_COLUMNS - 1 - position
  for (let rowOffset = -2; rowOffset <= 2; rowOffset++) {
    for (let columnOffset = -2; columnOffset <= 2; columnOffset++) {
      const nextRow = row + rowOffset
      const nextColumn = column + columnOffset
      if (nextRow < 0 || nextRow >= CLASH_BOARD_COLUMNS || nextColumn < 0 || nextColumn >= CLASH_BOARD_COLUMNS) continue
      const nextPosition = nextRow % 2 === 0 ? nextColumn : CLASH_BOARD_COLUMNS - 1 - nextColumn
      spaces.add(nextRow * CLASH_BOARD_COLUMNS + nextPosition + 1)
    }
  }
  return spaces
})
const clashMoveOptions = computed(() => {
  const player = controlledGamePlayer.value
  if (game.value?.mode !== 'clash_with' || !player || player.eliminated) return []
  const spaces = []
  const row = Math.floor((player.space - 1) / CLASH_BOARD_COLUMNS)
  const position = (player.space - 1) % CLASH_BOARD_COLUMNS
  const column = row % 2 === 0 ? position : CLASH_BOARD_COLUMNS - 1 - position
  for (let rowOffset = -2; rowOffset <= 2; rowOffset++) {
    for (let columnOffset = -2; columnOffset <= 2; columnOffset++) {
      if (!rowOffset && !columnOffset) continue
      const nextRow = row + rowOffset
      const nextColumn = column + columnOffset
      if (nextRow < 0 || nextRow >= CLASH_BOARD_COLUMNS || nextColumn < 0 || nextColumn >= CLASH_BOARD_COLUMNS) continue
      const nextPosition = nextRow % 2 === 0 ? nextColumn : CLASH_BOARD_COLUMNS - 1 - nextColumn
      spaces.push(nextRow * CLASH_BOARD_COLUMNS + nextPosition + 1)
    }
  }
  return spaces
})
const visibleClashTargets = computed(() => {
  const player = controlledGamePlayer.value
  if (game.value?.mode !== 'clash_with' || !player) return []
  return game.value.players.filter(other =>
    other.id !== player.id
    && !other.eliminated
    && !other.finished
    && clashVisibleSpaces.value.has(other.space))
})
const clashRivalRevealActive = computed(() => {
  if (game.value?.mode !== 'clash_with') return false
  const player = controlledGamePlayer.value
  if (!player || player.eliminated) return false
  const living = game.value.players.filter(other => !other.eliminated && !other.finished)
  return living.length === 2 && game.value.clashRivalRevealTurn === game.value.turn && now.value < clashRivalRevealUntil.value
})
const selectedClashWeapon = computed(() => controlledGamePlayer.value?.clashInventory?.weapons.find(weapon => weapon.name === clashSelectedWeapon.value) || controlledGamePlayer.value?.clashInventory?.weapons[0])
const selectedClashItemEntry = computed(() => controlledGamePlayer.value?.clashInventory?.items.find(item => item.id === clashSelectedItem.value))
const controlledClashWeapons = computed(() => controlledGamePlayer.value?.clashInventory?.weapons || [])
const controlledClashItems = computed(() => controlledGamePlayer.value?.clashInventory?.items || [])
const clashWeaponSlots = computed(() => {
  const weapons = controlledClashWeapons.value
  return [
    {
      key: 'primary',
      label: 'Primary Weapon',
      placeholder: 'Primary',
      weapon: weapons.find(weapon => ['smg', 'assault_rifle', 'sniper'].includes(weapon.class)),
    },
    {
      key: 'secondary',
      label: 'Secondary Weapon',
      placeholder: 'Pistol',
      weapon: weapons.find(weapon => weapon.class === 'pistol'),
    },
    {
      key: 'knife',
      label: 'Knife (Default Weapon)',
      placeholder: 'Knife',
      weapon: weapons.find(weapon => weapon.class === 'melee') || game.value?.board?.weapons?.find(weapon => weapon.class === 'melee'),
      locked: !weapons.some(weapon => weapon.class === 'melee'),
    },
  ]
})
const clashItemSlots = computed(() => {
  const throwables = controlledClashItems.value.filter(item => ['damage', 'damage_over_time', 'stun'].includes(item.effect))
  const medkit = controlledClashItems.value.find(item => String(item.id || item.name).toLowerCase().includes('medkit'))
  const bandage = controlledClashItems.value.find(item => String(item.id || item.name).toLowerCase().includes('bandage'))
  return [
    { key: 'throwable-1', label: 'Throwable 1', placeholder: 'Throwable', item: throwables[0] },
    { key: 'throwable-2', label: 'Throwable 2', placeholder: 'Throwable', item: throwables[1] },
    { key: 'throwable-3', label: 'Throwable 3', placeholder: 'Throwable', item: throwables[2] },
    { key: 'medkit', label: 'Medkit', placeholder: 'Medkit', item: medkit },
    { key: 'bandage', label: 'Bandage', placeholder: 'Bandage', item: bandage },
  ]
})
const clashMeleeCooldownRemainingMs = computed(() => Math.max(0, Number(controlledGamePlayer.value?.clashMeleeCooldownUntil || 0) - (now.value + serverClockOffset)))
const clashMeleeCooldownSeconds = computed(() => Math.ceil(clashMeleeCooldownRemainingMs.value / 1000))
const clashMeleeCooldownProgress = computed(() => Math.min(100, Math.max(0, (clashMeleeCooldownRemainingMs.value / 30_000) * 100)))
const clashVisionBlurred = computed(() => {
  const player = controlledGamePlayer.value
  return game.value?.mode === 'clash_with'
    && player?.clashStunnedThroughTurn != null
    && game.value.turn <= player.clashStunnedThroughTurn
})
const controlledClashStunned = computed(() => clashVisionBlurred.value)
const escapeVisiblePlayers = computed(() => game.value?.mode === 'escape_from'
  ? game.value.players.filter(player => !player.eliminated && !player.finished)
  : [])
const boostedVisionSpaces = computed(() => {
  const spaces = new Set()
  if (game.value?.mode !== 'escape_from') return spaces
  for (const progress of Object.values(visionRevealProgress.value)) {
    for (const space of progress.spaces) spaces.add(space)
  }
  for (const player of escapeVisiblePlayers.value) {
    if (player.visionBoostThroughTurn == null || game.value.turn > player.visionBoostThroughTurn) continue
    const visible = visionRevealProgress.value[player.id]?.spaces || getVisualSurroundingSpaces(visualSpace(player))
    for (const space of visible) spaces.add(space)
  }
  return spaces
})
const escapeCollectedKeys = computed(() => game.value?.keys?.filter(key => key.holderId).length || 0)
const dangerDistance = computed(() => {
  if (game.value?.mode !== 'escape_from' || !controlledGamePlayer.value || controlledGamePlayer.value.eliminated) return null
  const distances = (game.value.entities || []).map(entity => Math.abs(entity.space - controlledGamePlayer.value.space))
  return distances.length ? Math.min(...distances) : null
})
const escapeMedia = {
  'Quiet Mansion': {
    key: escapeKeyGif,
    entity: escapeEntityGif,
    attacked: escapeAttackedGif,
    defended: escapeDefendedGif,
    exit: escapeExitGif,
    exitLast: escapeExitLastFrame,
    flight: escapeFlightGif,
    concentrate: escapeConcentrateGif,
    lightSource: escapeLightSourceGif,
    ghosts: { old_woman: oldWomanGif, red_eyes: redEyesGif, white_face: whiteFaceGif },
    ghostLast: { old_woman: oldWomanLastGif, red_eyes: redEyesLastGif, white_face: whiteFaceLastGif },
  },
  'Dead Forest': {
    key: deadForestKeyGif,
    entity: deadForestEntityGif,
    attacked: deadForestAttackedGif,
    defended: deadForestDefendedGif,
    exit: deadForestExitGif,
    exitLast: deadForestExitLastFrame,
    flight: deadForestFlightGif,
    concentrate: deadForestConcentrateGif,
    lightSource: deadForestLightSourceGif,
    ghosts: { jean: jeanGif, bald: baldGif, uncle: uncleGif },
    ghostLast: { jean: jeanLastGif, bald: baldLastGif, uncle: uncleLastGif },
    ghostAnimationMs: { jean: 800, bald: 560, uncle: 560 },
  },
}
const currentEscapeMedia = computed(() => escapeMedia[game.value?.board?.name] || escapeMedia['Quiet Mansion'])
const escapeKeyName = computed(() => game.value?.board?.key_name || game.value?.board?.keys_name || 'Keys')

watch([sfx, music, muted], ([nextSfx, nextMusic, nextMuted]) => {
  audioManager.configure({ sfx: nextSfx, music: nextMusic, muted: nextMuted })
}, { immediate: true })

watch([page, () => game.value?.board?.music || game.value?.board?.name], ([nextPage, boardMusic]) => {
  audioManager.setScene(nextPage === 'game' ? 'game' : 'menu', boardMusic)
}, { immediate: true })

watch([dangerDistance, () => game.value?.board?.music], ([distance, board]) => {
  if (distance != null && distance <= 4) audioManager.escapeDanger(distance, board)
  else audioManager.stopEscapeDanger()
})

watch(() => [
  game.value?.mode,
  game.value?.turn,
  game.value?.clashRivalRevealTurn,
  game.value?.players?.filter(player => !player.eliminated && !player.finished).length,
].join(':'), () => {
  const living = game.value?.players?.filter(player => !player.eliminated && !player.finished) || []
  const isRevealTurn = game.value?.mode === 'clash_with'
    && living.length === 2
    && game.value.clashRivalRevealTurn === game.value.turn
  if (!isRevealTurn) {
    clashRivalRevealUntil.value = 0
    return
  }
  const key = `${onlineRoom.value?.code || 'local'}:${game.value.turn}`
  if (clashRivalRevealKey.value === key) return
  clashRivalRevealKey.value = key
  clashRivalRevealUntil.value = Date.now() + 2600
}, { immediate: true })

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
  emojiPickerPlacement.value = 'board'
  activeEmojis.value = {}
  activeReactions.value = {}
  activeLobbyMessages.value = {}
  lobbyMessageTimeouts.forEach(timeoutId => window.clearTimeout(timeoutId))
  lobbyMessageTimeouts.clear()
  lobbyMessageTargetId.value = null
  lobbyMessageDraft.value = ''
  skipOverlay.value = null
  penaltyOverlay.value = null
  destructionOverlay.value = null
  destructionSpace.value = null
  destructionSkipState.value = null
  escapeBriefing.value = null
  sighOverlay.value = null
  ripOverlay.value = null
  minePlacement.value = null
  mineExplosionSpace.value = null
  blownPlayerId.value = null
  directionChoice.value = null
  escapeMoveChoice.value = null
  rollDeadline.value = null
  escapeOverlay.value = null
  weaponEquippedOverlay.value = null
  escapePassiveOverlay.value = null
  escapePassiveGifOverlay.value = null
  revealedEscapeEntities.value = null
  clashActionMode.value = null
  clashSelectedWeapon.value = ''
  clashSelectedWeaponMode.value = ''
  clashSelectedItem.value = ''
  clashItemTargeting.value = null
  clashKillFeed.value = null
  clashBulletTraces.value = []
  clashThrownItems.value = []
  clashItemEffects.value = []
  clashDamageBlinkIds.value = {}
  clashStunBlinkIds.value = {}
  clashStunSkipOverlay.value = null
  clashShotOverlay.value = null
  clashMeleeOverlay.value = null
  clashRivalRevealUntil.value = 0
  clashRivalRevealKey.value = ''
  settingsModalOpen.value = false
  healthBlinkPlayerId.value = null
  healthHealPlayerId.value = null
  escapeEncounterSpace.value = null
  escapePickupNotice.value = null
  visionRevealProgress.value = {}
  guessWhatDifficulty.value = null
  guessWhatQuestion.value = null
  guessWhatResult.value = null
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
    const faces = event.data.specialRoll ? [7, 8, 9, 10, '🐝', '💩', '↯', '🦵'] : event.data.faces || [1, 2, 3, 4, 5, 6]
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
  } else if (event.type === 'guess_what_difficulty') {
    guessWhatQuestion.value = null
    guessWhatResult.value = null
    guessWhatDifficulty.value = { ...event.data, eventId: event.id }
    audioManager.guessWhatQuestion()
  } else if (event.type === 'guess_what_question') {
    guessWhatDifficulty.value = null
    guessWhatResult.value = null
    guessWhatQuestion.value = { ...event.data, eventId: event.id }
  } else if (event.type === 'guess_what_answer_selected') {
    guessWhatDifficulty.value = null
    guessWhatResult.value = null
    guessWhatQuestion.value = {
      ...event.data,
      eventId: event.id,
      locked: true,
      expiresAt: event.startedAt,
    }
  } else if (event.type === 'guess_what_answer') {
    guessWhatDifficulty.value = null
    guessWhatQuestion.value = null
    guessWhatResult.value = { ...event.data, eventId: event.id }
    audioManager.guessWhatAnswer(event.data.correct)
    window.setTimeout(() => {
      if (guessWhatResult.value?.eventId === event.id) guessWhatResult.value = null
    }, remaining)
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
  } else if (event.type === 'ragebait_consequence') {
    skillOverlay.value = {
      ...event.data,
      name: 'Ragebait Consequence',
      description: event.data.message,
      consequence: true,
      result: false,
    }
    window.setTimeout(() => {
      if (skillOverlay.value?.consequence && skillOverlay.value.playerId === event.data.playerId) skillOverlay.value = null
    }, remaining)
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
  } else if (event.type === 'clash_move') {
    audioManager.movement(remaining)
    visualSpaces.value[event.data.playerId] = event.data.to
    if (event.data.pickup) audioManager.clashPickup(event.data.pickup.dropKind)
  } else if (event.type === 'clash_attack') {
    audioManager.clashWeapon(event.data.weaponName, event.data.modeName, clashListenerVolume(event.data.sourceSpace))
    showClashBulletTraces(event.data)
    showClashShotOverlay(event.data)
    showClashMeleeOverlay(event.data)
    showClashKills(event.data.kills)
    if (event.data.attackerTo != null) visualSpaces.value[event.data.playerId] = event.data.attackerTo
    displayedHealth.value[event.data.targetId] = event.data.healthBefore
    healthBlinkPlayerId.value = event.data.targetId
    window.setTimeout(() => {
      displayedHealth.value[event.data.targetId] = event.data.healthAfter
      if (healthBlinkPlayerId.value === event.data.targetId) healthBlinkPlayerId.value = null
    }, Math.min(900, remaining))
  } else if (event.type === 'clash_item') {
    audioManager.clashItem(event.data.itemName, clashListenerVolume(event.data.sourceSpace || event.data.targetSpace))
    showClashItemThrow(event.data)
    showClashKills(event.data.kills)
    const stunnedPlayers = []
    const damagedPlayers = []
    for (const affected of event.data.affected || []) {
      displayedHealth.value[affected.playerId] = affected.before
      if (affected.stunnedThroughTurn) stunnedPlayers.push(affected.playerId)
      if (affected.damage || affected.damageOverTime) damagedPlayers.push(affected.playerId)
      if (affected.damage && !['damage', 'damage_over_time', 'stun'].includes(event.data.effect)) healthBlinkPlayerId.value = affected.playerId
      if (affected.healed) healthHealPlayerId.value = affected.playerId
      window.setTimeout(() => {
        displayedHealth.value[affected.playerId] = affected.after
        if (healthBlinkPlayerId.value === affected.playerId) healthBlinkPlayerId.value = null
        if (healthHealPlayerId.value === affected.playerId) healthHealPlayerId.value = null
      }, Math.min(900, remaining))
    }
    flashClashMap(clashStunBlinkIds, stunnedPlayers, 1100)
    flashClashMap(clashDamageBlinkIds, damagedPlayers, 1000)
  } else if (event.type === 'clash_stun_skip') {
    clashStunSkipOverlay.value = { ...event.data, eventId: event.id }
    window.setTimeout(() => {
      if (clashStunSkipOverlay.value?.eventId === event.id) clashStunSkipOverlay.value = null
    }, remaining)
  } else if (event.type === 'escape_move_choice') {
    escapeMoveChoice.value = { ...event.data, eventId: event.id }
    window.setTimeout(() => {
      if (escapeMoveChoice.value?.eventId === event.id) escapeMoveChoice.value = null
    }, remaining)
  } else if (event.type === 'escape_direction_choice') {
    escapeMoveChoice.value = null
    window.clearInterval(diceTimer)
    diceRolling.value = false
    rollDeadline.value = null
    displayedDice.value = event.data.roll
    directionChoice.value = { ...event.data, eventId: event.id }
    window.setTimeout(() => {
      if (directionChoice.value?.eventId === event.id) directionChoice.value = null
    }, remaining)
  } else if (event.type === 'escape_weapon_armed') {
    const armedPlayer = game.value?.players.find(player => player.id === event.data.playerId)
    if (armedPlayer) {
      armedPlayer.weaponProtectFromTurn = event.data.protectFromTurn
      armedPlayer.weaponProtectThroughTurn = event.data.protectThroughTurn
    }
    weaponEquippedOverlay.value = { ...event.data, eventId: event.id }
    window.setTimeout(() => {
      if (weaponEquippedOverlay.value?.eventId === event.id) weaponEquippedOverlay.value = null
    }, remaining)
  } else if (event.type === 'escape_passive_triggered') {
    escapePassiveOverlay.value = { ...event.data, eventId: event.id }
    window.setTimeout(() => {
      if (escapePassiveOverlay.value?.eventId === event.id) escapePassiveOverlay.value = null
    }, remaining)
  } else if (event.type === 'escape_passive_gif') {
    escapePassiveGifOverlay.value = {
      eventId: event.id,
      kind: event.data.kind,
      src: event.data.kind === 'flight' ? currentEscapeMedia.value.flight : currentEscapeMedia.value.concentrate,
    }
    window.setTimeout(() => {
      if (escapePassiveGifOverlay.value?.eventId === event.id) escapePassiveGifOverlay.value = null
    }, remaining)
  } else if (event.type === 'escape_entities_revealed') {
    revealedEscapeEntities.value = { ids: event.data.entityIds || [], eventId: event.id }
    window.setTimeout(() => {
      if (revealedEscapeEntities.value?.eventId === event.id) revealedEscapeEntities.value = null
    }, remaining)
  } else if (event.type === 'escape_entity_revealed') {
    audioManager.stopEscapeCharacterSounds()
    escapeEncounterSpace.value = event.data.space
    window.setTimeout(() => {
      if (escapeEncounterSpace.value === event.data.space) escapeEncounterSpace.value = null
    }, remaining)
  } else if (event.type === 'escape_entity_encounter') {
    escapeEncounterSpace.value = null
    audioManager.escapeVoice(event.data.ghost, game.value?.board?.music)
    escapeOverlay.value = { type: 'ghost', src: currentEscapeMedia.value.ghosts[event.data.ghost], eventId: event.id }
    const animationMs = currentEscapeMedia.value.ghostAnimationMs?.[event.data.ghost] || 1000
    window.setTimeout(() => {
      const lastFrame = currentEscapeMedia.value.ghostLast[event.data.ghost]
      if (escapeOverlay.value?.eventId === event.id && lastFrame) escapeOverlay.value.src = lastFrame
    }, Math.min(animationMs, remaining))
    window.setTimeout(() => {
      if (escapeOverlay.value?.eventId === event.id) escapeOverlay.value = null
    }, remaining + 1000)
  } else if (event.type === 'escape_defended' || event.type === 'escape_attacked') {
    const type = event.type === 'escape_defended' ? 'defended' : 'attacked'
    audioManager.escapeOutcome(type, game.value?.board?.music)
    escapeOverlay.value = { type, src: type === 'defended' ? currentEscapeMedia.value.defended : currentEscapeMedia.value.attacked, eventId: event.id }
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
  } else if (event.type === 'escape_exit_unlocked') {
    audioManager.escapeUnlock(game.value?.board?.music)
  } else if (event.type === 'escape_exit_opening') {
    escapeOverlay.value = { type: 'exit', src: currentEscapeMedia.value.exit, eventId: event.id }
    window.setTimeout(() => {
      if (escapeOverlay.value?.eventId === event.id && currentEscapeMedia.value.exitLast) {
        escapeOverlay.value.src = currentEscapeMedia.value.exitLast
      }
    }, Math.min(event.data.animationMs || 2250, remaining))
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
  for (const [playerId, progress] of Object.entries(visionRevealProgress.value)) {
    const player = message.game?.players.find(item => item.id === playerId)
    if (progress.complete && player?.visionBoostThroughTurn != null) delete visionRevealProgress.value[playerId]
  }
  const currentPlayerState = message.game?.players.find(player => player.id === clientId)
  const outcomeVariant = message.game?.mode === 'clash_with' ? 'clash_ost' : null
  if (currentPlayerState?.finished && !currentPlayerState.eliminated && !currentPlayerState.forfeited && !previousPlayer?.finished) {
    audioManager.playOutcome('winner', true, outcomeVariant)
  }
  if (message.game?.winner?.id === clientId && previousWinnerId !== clientId) {
    audioManager.playOutcome('winner', false, outcomeVariant)
  }
  if (message.game?.gameOver && !wasGameOver && message.game?.loser?.id === clientId) {
    audioManager.playOutcome('loser', false, outcomeVariant)
  }
  turnDeadline.value = message.turnDeadline
  escapeBriefing.value = message.escapeBriefing
  visibleLog.value = [...(message.game?.log || [])]
  for (const player of message.game?.players || []) {
    if (visualSpaces.value[player.id] == null || !message.currentEvent) visualSpaces.value[player.id] = player.space
    if (healthBlinkPlayerId.value !== player.id && player.health != null) displayedHealth.value[player.id] = player.health
  }
  page.value = 'game'
  turnBusy.value = Boolean(message.currentEvent || message.escapeBriefing?.active)
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
  isSpectating.value = false
  page.value = 'home'
}

function handleSocketMessage(event) {
  const message = JSON.parse(event.data)
  if (message.serverNow) serverClockOffset = message.serverNow - Date.now()

  // Emotes are short-lived social events, not authoritative game state. Handle
  // them independently so an intervening snapshot cannot make another client
  // discard the emote as stale.
  if (message.type === 'player_emote') {
    activeEmojis.value[message.playerId] = { emoji: message.emoji, startedAt: message.startedAt }
    const expiresIn = Math.max(0, message.duration - ((Date.now() + serverClockOffset) - message.startedAt))
    window.setTimeout(() => {
      if (activeEmojis.value[message.playerId]?.startedAt === message.startedAt) delete activeEmojis.value[message.playerId]
    }, expiresIn)
    return
  }
  if (message.type === 'player_reaction') {
    if (message.characterId) audioManager.escapeSocial(message.characterId, message.reaction)
    else audioManager.characterReaction(message.reaction)
    activeReactions.value[message.playerId] = { text: message.text, startedAt: message.startedAt }
    const expiresIn = Math.max(0, message.duration - ((Date.now() + serverClockOffset) - message.startedAt))
    window.setTimeout(() => {
      if (activeReactions.value[message.playerId]?.startedAt === message.startedAt) delete activeReactions.value[message.playerId]
    }, expiresIn)
    return
  }
  if (message.type === 'lobby_message') {
    const messageId = message.messageId ?? `${message.startedAt}-${message.senderId || ''}`
    const previousTimeout = lobbyMessageTimeouts.get(message.playerId)
    if (previousTimeout) window.clearTimeout(previousTimeout)
    activeLobbyMessages.value[message.playerId] = { text: message.text, startedAt: message.startedAt, messageId }
    const expiresIn = Math.max(0, message.duration - ((Date.now() + serverClockOffset) - message.startedAt))
    const timeoutId = window.setTimeout(() => {
      if (activeLobbyMessages.value[message.playerId]?.messageId === messageId) delete activeLobbyMessages.value[message.playerId]
      lobbyMessageTimeouts.delete(message.playerId)
    }, expiresIn)
    lobbyMessageTimeouts.set(message.playerId, timeoutId)
    return
  }
  if (message.type === 'escape_key_collected') {
    audioManager.escapeKeyCollected(message.characterId)
    return
  }
  if (message.type === 'escape_pickup_spawned') {
    escapePickupNotice.value = {
      text: message.text,
      pickupType: message.pickupType,
      startedAt: message.startedAt,
    }
    const expiresIn = Math.max(0, message.duration - ((Date.now() + serverClockOffset) - message.startedAt))
    window.setTimeout(() => {
      if (escapePickupNotice.value?.startedAt === message.startedAt) escapePickupNotice.value = null
    }, expiresIn)
    return
  }
  if (message.type === 'escape_pickup_collected') {
    audioManager.escapePickup(message.pickupType)
    if (message.pickupType === 'medkit') {
      healthHealPlayerId.value = message.playerId
      displayedHealth.value[message.playerId] = message.healthAfter
      window.setTimeout(() => {
        if (healthHealPlayerId.value === message.playerId) healthHealPlayerId.value = null
      }, message.duration)
    } else if (message.pickupType === 'light_source') {
      const player = game.value?.players.find(item => item.id === message.playerId)
      const spaces = player ? getVisualSurroundingSpaces(visualSpace(player)) : []
      visionRevealProgress.value[message.playerId] = { spaces: [], complete: false }
      spaces.forEach((space, index) => {
        window.setTimeout(() => {
          if (!visionRevealProgress.value[message.playerId]) return
          visionRevealProgress.value[message.playerId].spaces = [
            ...visionRevealProgress.value[message.playerId].spaces,
            space,
          ]
        }, 120 * (index + 1))
      })
      window.setTimeout(() => {
        const progress = visionRevealProgress.value[message.playerId]
        if (!progress) return
        progress.complete = true
        const syncedPlayer = game.value?.players.find(item => item.id === message.playerId)
        if (syncedPlayer?.visionBoostThroughTurn != null) delete visionRevealProgress.value[message.playerId]
      }, message.duration)
    }
    return
  }
  if (message.type === 'clash_ghost_move') {
    onlineRoom.value = message.room
    roomCode.value = message.room.code
    selectedBoard.value = message.room.boardIndex
    selectedMode.value = message.room.modeKey || boards[message.room.boardIndex]?.type || gameModes[0]?.key
    game.value = message.game
    visibleLog.value = [...(message.game?.log || [])]
    visualSpaces.value[message.playerId] = message.to
    for (const player of message.game?.players || []) {
      if (player.id !== message.playerId && visualSpaces.value[player.id] == null) visualSpaces.value[player.id] = player.space
      if (healthBlinkPlayerId.value !== player.id && player.health != null) displayedHealth.value[player.id] = player.health
    }
    return
  }
  if (message.type === 'room_list') {
    roomList.value = message.rooms || []
    roomListLoading.value = false
    return
  }

  if (message.revision && message.revision < lastRevision) return
  if (message.revision) lastRevision = message.revision

  if (message.type === 'room_state') {
    isSpectating.value = false
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
    isSpectating.value = Boolean(message.spectator)
    applyGameSnapshot(message)
  } else if (message.type === 'game_event') {
    handleServerEvent(message.event)
  } else if (message.type === 'destruction_skip_state') {
    destructionSkipState.value = message.active ? {
      total: message.total,
      voterIds: message.voterIds || [],
    } : null
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
  playNowPrompt.value = false
  isSpectating.value = false
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

async function openRoomListPage() {
  playNowPrompt.value = false
  page.value = 'room-list'
  await refreshRoomList()
}

async function refreshRoomList() {
  roomListLoading.value = true
  onlineError.value = ''
  try {
    await connectLobby()
    sendLobby({ type: 'list_rooms' })
  } catch {
    roomListLoading.value = false
  }
}

async function joinListedRoom(code) {
  joinCode.value = code
  await joinOnlineLobby()
}

async function spectateRoom(code) {
  onlineError.value = ''
  isSpectating.value = true
  try {
    await connectLobby()
    sendLobby({ type: 'spectate', code })
  } catch {
    isSpectating.value = false
  }
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

function changeLobbySlotCharacter(player, direction) {
  if (player.id === clientId) {
    changeLobbyCharacter(direction)
    return
  }
  if (!isLobbyHost.value || !player.isAI || !lobbyCharacterIndices.value.length) return
  const available = lobbyCharacterIndices.value
  const current = available.indexOf(player.characterIndex)
  const characterIndex = available[(Math.max(0, current) + direction + available.length) % available.length]
  sendLobby({ type: 'ai_character', playerId: player.id, characterIndex })
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

function changePrivateRoom(event) {
  if (!isLobbyHost.value) return
  sendLobby({ type: 'private_room', privateRoom: event.target.checked })
}

function toggleDestructionSkip(event) {
  sendLobby({ type: 'destruction_skip', checked: event.target.checked })
}

function closeEscapeBriefing() {
  if (!escapeBriefing.value?.voterIds.includes(clientId)) {
    sendLobby({ type: 'close_escape_briefing' })
  }
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

function leaveOnlineRoom(skipConfirmation = false) {
  if (!skipConfirmation) {
    roomExitConfirm.value = true
    return
  }
  sendLobby({ type: 'leave_room' })
  resetOnlineRoom('You left the room.')
}

function cancelRoomExit() {
  roomExitConfirm.value = false
}

function confirmRoomExit() {
  roomExitConfirm.value = false
  leaveOnlineRoom(true)
}

function goSettings(from = page.value) {
  settingsReturnPage.value = from
  page.value = 'settings'
}

function leaveSettings() {
  if (settingsReturnPage.value === 'game' && onlineRoom.value?.phase === 'playing' && game.value) {
    page.value = 'game'
    return
  }
  page.value = settingsReturnPage.value === 'lobby' && onlineRoom.value?.phase === 'lobby' ? 'lobby' : 'home'
}

function openGameSettings() {
  settingsModalOpen.value = true
}

function boardSpacePosition(space) {
  return getBoardSpacePosition(game.value?.board, space)
}

function boardSpaceBounds(space) {
  return getBoardSpaceBounds(game.value?.board, space)
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
  const deadForest = game.value?.board?.name === 'Dead Forest'
  const guessWhat = game.value?.mode === 'guess_what'
  const clashWith = game.value?.mode === 'clash_with'
  const safePlayerIndex = Math.max(0, playerIndex)
  const offsetScale = clashWith ? 0.28 : volcano ? 0.72 : ghostTown ? 0.55 : guessWhat ? 0.45 : (quietMansion || deadForest) ? 0.35 : 1
  const [rawOffsetX, rawOffsetY] = offsets[safePlayerIndex % offsets.length]
  const offsetX = rawOffsetX * offsetScale
  const offsetY = rawOffsetY * offsetScale
  const position = boardSpacePosition(space)
  return {
    left: `calc(${position.left} + ${offsetX}%)`,
    top: `calc(${position.top} + ${offsetY}%)`,
    '--token-color': game.value.players[safePlayerIndex]?.color || '#ffffff',
  }
}

function boardPickerClasses(player) {
  const position = boardSpacePosition(visualSpace(player))
  const x = Number.parseFloat(position.left)
  const y = Number.parseFloat(position.top)
  return {
    'edge-picker': x <= 24 || x >= 76 || y <= 30 || y >= 82,
    'edge-left': x <= 24,
    'edge-right': x >= 76,
    'edge-top': y <= 30,
    'edge-bottom': y >= 82,
  }
}

function gridDistance(spaceA, spaceB) {
  const columns = game.value?.mode === 'clash_with' ? CLASH_BOARD_COLUMNS : 10
  const rowA = Math.floor((spaceA - 1) / columns)
  const posA = (spaceA - 1) % columns
  const colA = rowA % 2 === 0 ? posA : columns - 1 - posA
  const rowB = Math.floor((spaceB - 1) / columns)
  const posB = (spaceB - 1) % columns
  const colB = rowB % 2 === 0 ? posB : columns - 1 - posB
  return Math.max(Math.abs(rowA - rowB), Math.abs(colA - colB))
}

function clashListenerVolume(sourceSpace) {
  const listener = controlledGamePlayer.value || game.value?.players[game.value.currentPlayerIndex]
  if (!listener || !sourceSpace) return 0.8
  const distance = gridDistance(listener.space, sourceSpace)
  return Math.max(0.12, Math.min(1, 1 - distance * 0.09))
}

function showClashKills(kills = []) {
  if (!kills.length) return
  const text = kills.map(kill => `${kill.killerName} kills ${kill.targetName} with ${kill.sourceName}`).join(' · ')
  const startedAt = Date.now()
  clashKillFeed.value = { text, startedAt }
  window.setTimeout(() => {
    if (clashKillFeed.value?.startedAt === startedAt) clashKillFeed.value = null
  }, 3000)
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
  if (player.delayedSkillCooldownStartTurn != null) return 1
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
  if (game.value.mode === 'clash_with') {
    if (controlledClashStunned.value) return
    clashActionMode.value = clashActionMode.value === 'move' ? null : 'move'
    clashItemTargeting.value = null
    return
  }
  sendLobby({ type: 'start_roll' })
}

function useSkill(targetId = null) {
  if (!game.value || page.value !== 'game' || turnBusy.value || game.value.gameOver) return
  if (game.value.mode === 'guess_what' || game.value.mode === 'clash_with') return
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

function toggleEmojiPicker(player, placement = 'board') {
  if (game.value?.mode === 'clash_with') return
  if (player.id !== clientId || player.eliminated || player.finished) return
  if (emojiPickerPlayerId.value === player.id && emojiPickerPlacement.value === placement) {
    emojiPickerPlayerId.value = null
    return
  }
  emojiPickerPlayerId.value = player.id
  emojiPickerPlacement.value = placement
}

function sendPlayerEmoji(playerId, emoji) {
  if (playerId !== clientId) return
  emojiPickerPlayerId.value = null
  sendLobby({ type: 'player_emote', emoji })
}

function sendPlayerReaction(playerId, reaction) {
  if (playerId !== clientId) return
  emojiPickerPlayerId.value = null
  sendLobby({ type: 'player_reaction', reaction })
}

function toggleLobbyMessageBox(playerId) {
  if (lobbyMessageTargetId.value === playerId) {
    lobbyMessageTargetId.value = null
    lobbyMessageDraft.value = ''
    return
  }
  lobbyMessageTargetId.value = playerId
  lobbyMessageDraft.value = ''
}

function submitLobbyMessage(playerId) {
  const text = lobbyMessageDraft.value.trim().slice(0, 50)
  if (!text) return
  sendLobby({ type: 'lobby_message', playerId, text })
  lobbyMessageTargetId.value = null
  lobbyMessageDraft.value = ''
}

function socialReactionsForMode() {
  return game.value?.mode === 'escape_from'
    ? [
        { key: 'lets_go', label: "Let's Go" },
        { key: 'im_coming', label: 'Coming' },
        { key: 'careful', label: 'Careful' },
      ]
    : [
        { key: 'aww', label: 'Aww' },
        { key: 'boo', label: 'Boo!' },
        { key: 'laugh', label: 'Haha!' },
      ]
}

function placeMine(space) {
  if (!minePlacement.value) return
  minePlacement.value = null
  sendLobby({ type: 'place_mine', space })
}

function chooseGuessWhatDifficulty(difficulty) {
  if (guessWhatDifficulty.value?.playerId !== clientId) return
  sendLobby({ type: 'choose_guess_what_difficulty', difficulty })
}

function answerGuessWhat(answer) {
  if (guessWhatQuestion.value?.playerId !== clientId || guessWhatQuestion.value.locked) return
  sendLobby({ type: 'answer_guess_what', answer })
}

function handleGameKey(event) {
  const targetTag = event.target?.tagName?.toLowerCase()
  if (['input', 'textarea', 'select'].includes(targetTag)) return
  const key = event.key.toLowerCase()
  if (['w', 'a', 's', 'd'].includes(key) && sendClashGhostMove(key)) {
    event.preventDefault()
    return
  }
  if (key === 'g' && !event.repeat && game.value?.mode !== 'clash_with') useSkill()
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
  if (!directionChoice.value || directionChoice.value.playerId !== clientId) return
  directionChoice.value = null
  sendLobby({ type: 'choose_direction', direction })
}

function chooseEscapeMove(roll) {
  if (escapeMoveChoice.value?.playerId !== clientId) return
  escapeMoveChoice.value = null
  sendLobby({ type: 'choose_escape_move', roll })
}

function skipEscapeMove() {
  if (!escapeMoveChoice.value?.canSkip || escapeMoveChoice.value.playerId !== clientId) return
  escapeMoveChoice.value = null
  sendLobby({ type: 'skip_escape_move' })
}

function normalizeAssetFolder(value) {
  return String(value || '').replace(/^assets\//, '../assets/')
}

function clashMedia(path, kind = 'gif') {
  const normalized = normalizeAssetFolder(path)
  return clashMediaFiles[`${normalized}.${kind === 'image' ? 'png' : 'gif'}`]
    || clashMediaFiles[`${normalized}.gif`]
    || clashMediaFiles[`${normalized}.png`]
}

function clashInventoryImage(entry) {
  return clashMedia(entry?.image, 'image')
}

function clashWeaponCapacity(weapon) {
  if (!weapon) return ''
  if (weapon.class === 'melee') return clashMeleeCooldownSeconds.value > 0 ? `${clashMeleeCooldownSeconds.value}s` : '∞'
  return `${weapon.ammoRemaining ?? weapon.max_capacity}/${weapon.max_capacity}`
}

function clashItemCapacity(item) {
  return item ? `×${item.count}` : ''
}

function clashWeaponDisabled(weapon, locked = false) {
  return locked
    || !weapon
    || !isControlledTurn.value
    || turnBusy.value
    || controlledClashStunned.value
    || (weapon.class !== 'melee' && weapon.ammoRemaining <= 0)
    || (weapon.class === 'melee' && clashMeleeCooldownSeconds.value > 0)
}

function clashItemDisabled(item) {
  return !item
    || !isControlledTurn.value
    || turnBusy.value
    || controlledClashStunned.value
    || (item.effect === 'heal' && controlledGamePlayer.value?.health >= 100)
}

function clashItemDefinition(name) {
  return game.value?.board?.items?.find(item => item.name === name)
}

function clashItemEffectMedia(item) {
  if (!item?.gif) return null
  return clashMedia(String(item.gif).replace(/\/gif$/, '/effect'))
}

function clashItemEffectDuration(itemName) {
  const name = String(itemName || '').toLowerCase()
  if (name.includes('frag')) return 1800
  if (name.includes('molotov')) return 1200
  if (name.includes('stun')) return 640
  return 900
}

function clashShotEffectMedia() {
  return clashMedia('assets/gifs/clash_with/no_mans_land/weapons/shot_effect')
}

function clashMeleeEffectMedia(kind) {
  return clashMedia(`assets/gifs/clash_with/no_mans_land/weapons/${kind === 'attacked' ? 'melee_attacked_effect' : 'slash_attack_effect'}`, 'gif')
}

function positionPercent(space) {
  const position = boardSpacePosition(space)
  return {
    left: Number.parseFloat(position.left),
    top: Number.parseFloat(position.top),
  }
}

function scheduleClashOverlay(collection, entry, duration = 900) {
  collection.value = [...collection.value, entry]
  window.setTimeout(() => {
    collection.value = collection.value.filter(item => item.id !== entry.id)
  }, duration)
}

function flashClashMap(mapRef, playerIds, duration = 900) {
  if (!playerIds.length) return
  const next = { ...mapRef.value }
  for (const playerId of playerIds) next[playerId] = true
  mapRef.value = next
  window.setTimeout(() => {
    const current = { ...mapRef.value }
    for (const playerId of playerIds) delete current[playerId]
    mapRef.value = current
  }, duration)
}

function weaponTraceCount(modeName, attempts = 1) {
  const mode = String(modeName || '').toLowerCase()
  if (mode.includes('full')) return 5
  if (mode.includes('burst')) return 3
  if (mode.includes('single')) return 1
  return Math.max(1, Number(attempts) || 1)
}

function showClashBulletTraces(eventData) {
  if (!eventData?.sourceSpace || !eventData?.targetSpace || eventData.attackerTo != null) return
  const from = positionPercent(eventData.sourceSpace)
  const to = positionPercent(eventData.targetSpace)
  const dx = to.left - from.left
  const dy = to.top - from.top
  const length = Math.hypot(dx, dy)
  if (!length) return
  const angle = Math.atan2(dy, dx) * 180 / Math.PI
  const count = weaponTraceCount(eventData.modeName, eventData.attempts)
  const normalX = -dy / length
  const normalY = dx / length
  const startedAt = Date.now()
  for (let index = 0; index < count; index++) {
    const offset = (index - (count - 1) / 2) * 0.55
    scheduleClashOverlay(clashBulletTraces, {
      id: `trace-${startedAt}-${index}`,
      style: {
        left: `${from.left + normalX * offset}%`,
        top: `${from.top + normalY * offset}%`,
        width: `${length}%`,
        '--trace-angle': `${angle}deg`,
        '--trace-delay': `${index * 55}ms`,
      },
    }, 620)
  }
}

function showClashShotOverlay(eventData) {
  if (eventData?.targetId !== clientId || eventData.attackerTo != null) return
  const src = clashShotEffectMedia()
  if (!src) return
  const id = `shot-${eventData.targetId}-${Date.now()}`
  clashShotOverlay.value = { id, src }
  window.setTimeout(() => {
    if (clashShotOverlay.value?.id === id) clashShotOverlay.value = null
  }, 980)
}

function showClashMeleeOverlay(eventData) {
  const isMelee = eventData?.isMelee === true
    || eventData?.weaponClass === 'melee'
    || eventData?.attackerTo != null
  if (!isMelee) return
  const kind = eventData.playerId === clientId ? 'slash' : eventData.targetId === clientId ? 'attacked' : null
  if (!kind) return
  const src = clashMeleeEffectMedia(kind)
  if (!src && import.meta.env.DEV) console.warn(`Missing Clash melee ${kind} GIF asset. Restart Vite if the asset was added while dev server was running.`)
  if (!src) return
  const id = `melee-${kind}-${Date.now()}`
  clashMeleeOverlay.value = { id, src, kind }
  window.setTimeout(() => {
    if (clashMeleeOverlay.value?.id === id) clashMeleeOverlay.value = null
  }, CLASH_MELEE_EFFECT_MS)
}

function showClashItemThrow(eventData) {
  if (!eventData?.sourceSpace || !eventData?.targetSpace) return
  const projectileDuration = 430
  const item = clashItemDefinition(eventData.itemName)
  const from = positionPercent(eventData.sourceSpace)
  const to = positionPercent(eventData.targetSpace)
  const id = `throw-${eventData.itemId}-${Date.now()}`
  const image = clashMedia(item?.image, 'image')
  if (image) {
    scheduleClashOverlay(clashThrownItems, {
      id,
      src: image,
      alt: item?.name || eventData.itemName,
      style: {
        '--throw-start-left': `${from.left}%`,
        '--throw-start-top': `${from.top}%`,
        '--throw-end-left': `${to.left}%`,
        '--throw-end-top': `${to.top}%`,
      },
    }, projectileDuration + 40)
  }
  const effect = clashItemEffectMedia(item)
  if (effect) {
    window.setTimeout(() => {
      scheduleClashOverlay(clashItemEffects, {
        id: `effect-${eventData.itemId}-${Date.now()}`,
        src: effect,
        alt: '',
        style: boardSpacePosition(eventData.targetSpace),
      }, clashItemEffectDuration(eventData.itemName))
    }, image ? projectileDuration : 0)
  }
}

function clashDropVisible(drop) {
  return game.value?.mode !== 'clash_with' || clashVisibleSpaces.value.has(drop.space)
}

function clashPlayerVisible(player) {
  if (game.value?.mode !== 'clash_with') return true
  if (player.eliminated) return player.id === clientId
  return player.id === clientId || clashVisibleSpaces.value.has(player.space) || clashRivalRevealActive.value
}

function clashRivalRevealed(player) {
  return game.value?.mode === 'clash_with'
    && clashRivalRevealActive.value
    && player.id !== clientId
    && !player.eliminated
    && !player.finished
    && !clashVisibleSpaces.value.has(player.space)
}

function selectClashAction(mode) {
  if (!isControlledTurn.value || turnBusy.value || game.value?.mode !== 'clash_with') return
  clashActionMode.value = clashActionMode.value === mode ? null : mode
  if (mode === 'attack' && selectedClashWeapon.value) {
    clashSelectedWeapon.value ||= selectedClashWeapon.value.name
    clashSelectedWeaponMode.value ||= selectedClashWeapon.value.modes?.[0]?.name || ''
  }
}

function selectClashWeaponAction(weapon) {
  if (!isControlledTurn.value || turnBusy.value || controlledClashStunned.value || game.value?.mode !== 'clash_with' || !weapon) return
  clashItemTargeting.value = null
  clashSelectedWeapon.value = weapon.name
  clashSelectedWeaponMode.value = weapon.modes?.[0]?.name || ''
  clashActionMode.value = 'attack'
}

function setClashWeaponMode(weapon, modeName) {
  if (!weapon || clashSelectedWeapon.value !== weapon.name) return
  clashSelectedWeaponMode.value = modeName
}

function selectClashItemAction(item) {
  if (!isControlledTurn.value || turnBusy.value || controlledClashStunned.value || game.value?.mode !== 'clash_with' || !item) return
  clashSelectedItem.value = item.id
  if (item.effect === 'heal') {
    sendClashUseHeal(item.id)
    return
  }
  clashActionMode.value = 'item'
  clashItemTargeting.value = item.id
}

function sendClashMove(destination) {
  if (!isControlledTurn.value || controlledClashStunned.value || clashActionMode.value !== 'move') return
  clashActionMode.value = null
  sendLobby({ type: 'clash_move', destination })
}

function sendClashAttack(targetId) {
  const weapon = selectedClashWeapon.value
  const mode = weapon?.modes?.find(item => item.name === clashSelectedWeaponMode.value) || weapon?.modes?.[0]
  if (!isControlledTurn.value || controlledClashStunned.value || !weapon || !mode) return
  clashActionMode.value = null
  sendLobby({ type: 'clash_attack', targetId, weaponName: weapon.name, modeName: mode.name })
}

function sendClashUseHeal(itemId = null) {
  const item = itemId
    ? controlledGamePlayer.value?.clashInventory?.items.find(entry => entry.id === itemId)
    : selectedClashItemEntry.value
  if (!isControlledTurn.value || controlledClashStunned.value || !item || item.effect !== 'heal') return
  if ((controlledGamePlayer.value?.health ?? 0) >= 100) return
  clashActionMode.value = null
  clashItemTargeting.value = null
  sendLobby({ type: 'clash_use_item', itemId: item.id })
}

function startClashItemTargeting() {
  const item = selectedClashItemEntry.value
  if (!isControlledTurn.value || controlledClashStunned.value || !item || item.effect === 'heal') return
  clashItemTargeting.value = item.id
}

function sendClashUseTargetedItem(space) {
  if (!isControlledTurn.value || controlledClashStunned.value || !clashItemTargeting.value) return
  const itemId = clashItemTargeting.value
  clashItemTargeting.value = null
  clashActionMode.value = null
  sendLobby({ type: 'clash_use_item', itemId, targetSpace: space })
}

function clashGhostDestination(key) {
  const player = controlledGamePlayer.value
  if (game.value?.mode !== 'clash_with' || !player?.eliminated) return null
  const row = Math.floor((player.space - 1) / CLASH_BOARD_COLUMNS)
  const position = (player.space - 1) % CLASH_BOARD_COLUMNS
  const column = row % 2 === 0 ? position : CLASH_BOARD_COLUMNS - 1 - position
  const deltas = { w: [1, 0], a: [0, -1], s: [-1, 0], d: [0, 1] }
  const delta = deltas[key]
  if (!delta) return null
  const nextRow = row + delta[0]
  const nextColumn = column + delta[1]
  if (nextRow < 0 || nextRow >= CLASH_BOARD_COLUMNS || nextColumn < 0 || nextColumn >= CLASH_BOARD_COLUMNS) return null
  const nextPosition = nextRow % 2 === 0 ? nextColumn : CLASH_BOARD_COLUMNS - 1 - nextColumn
  return nextRow * CLASH_BOARD_COLUMNS + nextPosition + 1
}

function sendClashGhostMove(key) {
  const destination = clashGhostDestination(key)
  if (!destination) return false
  visualSpaces.value[clientId] = destination
  sendLobby({ type: 'clash_ghost_move', destination })
  return true
}

function resolveClashPickup(replace) {
  sendLobby({ type: 'clash_resolve_pickup', replace })
}

function clashItemTargetSpaces() {
  const player = controlledGamePlayer.value
  if (!player) return []
  const row = Math.floor((player.space - 1) / CLASH_BOARD_COLUMNS)
  const position = (player.space - 1) % CLASH_BOARD_COLUMNS
  const column = row % 2 === 0 ? position : CLASH_BOARD_COLUMNS - 1 - position
  const spaces = []
  for (let rowOffset = -5; rowOffset <= 5; rowOffset++) {
    for (let columnOffset = -5; columnOffset <= 5; columnOffset++) {
      const nextRow = row + rowOffset
      const nextColumn = column + columnOffset
      if (nextRow < 0 || nextRow >= CLASH_BOARD_COLUMNS || nextColumn < 0 || nextColumn >= CLASH_BOARD_COLUMNS) continue
      const nextPosition = nextRow % 2 === 0 ? nextColumn : CLASH_BOARD_COLUMNS - 1 - nextColumn
      spaces.push(nextRow * CLASH_BOARD_COLUMNS + nextPosition + 1)
    }
  }
  return spaces
}

function escapeObjectVisible(space) {
  return game.value?.mode !== 'escape_from'
    || escapeVisiblePlayers.value.some(player => visualSpace(player) === space)
    || boostedVisionSpaces.value.has(space)
}

function escapeEntityVisible(entity) {
  return Boolean(revealedEscapeEntities.value?.ids.includes(entity.id)) || escapeObjectVisible(entity.space)
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
        health: player.health,
        visionBoostThroughTurn: player.visionBoostThroughTurn,
        finished: player.finished,
        eliminated: player.eliminated,
      })),
      destroyedSpaces: game.value.destroyedSpaces,
      keys: game.value.keys,
      entities: game.value.mode === 'escape_from' ? game.value.entities : undefined,
      medkits: game.value.mode === 'escape_from' ? game.value.medkits : undefined,
      lightSources: game.value.mode === 'escape_from' ? game.value.lightSources : undefined,
      pickupNotice: escapePickupNotice.value?.text || null,
      revealingVisionSpaces: [...boostedVisionSpaces.value],
      exitRevealed: game.value.exitRevealed,
      exitUnlocked: game.value.exitUnlocked,
      winners: game.value.winners.map(player => player.name),
      winner: game.value.winner?.name || null,
      loser: game.value.loser?.name || null,
      gameOver: game.value.gameOver,
      spectating: isSpectating.value,
    } : null,
    roomList: page.value === 'room-list' ? roomList.value : undefined,
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
  lobbyMessageTimeouts.forEach(timeoutId => window.clearTimeout(timeoutId))
  lobbyMessageTimeouts.clear()
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
    <div
      v-if="roomExitConfirm"
      class="confirm-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="room-exit-title"
      aria-describedby="room-exit-message"
      tabindex="-1"
      @click.self="cancelRoomExit"
      @keydown.esc.prevent="cancelRoomExit"
    >
      <section class="confirm-card">
        <button class="confirm-close" type="button" aria-label="Close confirmation" @click="cancelRoomExit">×</button>
        <h2 id="room-exit-title">Confirmation</h2>
        <div class="confirm-message">
          <span class="confirm-icon" aria-hidden="true">!</span>
          <p id="room-exit-message">This will exit the room. Continue?</p>
        </div>
        <div class="confirm-actions">
          <button class="confirm-cancel" type="button" @click="cancelRoomExit">No</button>
          <button class="confirm-save" type="button" autofocus @click="confirmRoomExit">Yes</button>
        </div>
      </section>
    </div>

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
          <button class="game-button yellow" @click="playNowPrompt = true"><span class="icon">▶</span> Play now</button>
          <button class="game-button green" @click="page = 'characters'"><span class="icon">♟</span> Characters</button>
          <button class="game-button blue" @click="goSettings('home')"><span class="icon">⚙</span> Settings</button>
        </nav>
        <div v-if="playNowPrompt" class="play-now-modal" role="dialog" aria-modal="true" aria-labelledby="play-now-title">
          <section>
            <button class="modal-close" type="button" @click="playNowPrompt = false" aria-label="Close">×</button>
            <small>Choose your chaos</small>
            <h2 id="play-now-title">Play Now</h2>
            <button class="game-button yellow" type="button" @click="createOnlineLobby"><span class="icon">＋</span> Create Room</button>
            <button class="game-button blue" type="button" @click="openRoomListPage"><span class="icon">☰</span> Room List</button>
          </section>
        </div>
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
          <button class="lobby-back" @click="leaveOnlineRoom()" aria-label="Exit room">←</button>
          <div class="brand brand-lobby">
            <span class="crown">♛</span>
            <span class="brand-top">LADDERS...</span>
            <span class="brand-bottom"><i>AND</i> WHAT?!</span>
          </div>
          <div class="lobby-title">Lobby</div>
          <div class="lobby-tools">
            <button @click="goSettings('lobby')">⚙ <span>Settings</span></button>
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
                  <span v-if="activeLobbyMessages[lobbyPlayers[slot - 1].id]" class="lobby-message-bubble">
                    {{ activeLobbyMessages[lobbyPlayers[slot - 1].id].text }}
                  </span>
                  <button
                    type="button"
                    class="lobby-message-toggle"
                    :class="{ open: lobbyMessageTargetId === lobbyPlayers[slot - 1].id }"
                    @click.stop="toggleLobbyMessageBox(lobbyPlayers[slot - 1].id)"
                    :aria-expanded="lobbyMessageTargetId === lobbyPlayers[slot - 1].id"
                    :aria-controls="`lobby-message-box-${slot}`"
                    :aria-label="`Send message above ${lobbyPlayers[slot - 1].customName || lobbyPlayers[slot - 1].character.name}`"
                  ><span></span></button>
                  <form
                    v-if="lobbyMessageTargetId === lobbyPlayers[slot - 1].id"
                    :id="`lobby-message-box-${slot}`"
                    class="lobby-message-box"
                    @submit.prevent="submitLobbyMessage(lobbyPlayers[slot - 1].id)"
                  >
                    <textarea
                      v-model="lobbyMessageDraft"
                      maxlength="50"
                      rows="3"
                      placeholder="Say something..."
                      @click.stop
                      @keydown.stop
                    ></textarea>
                    <small>{{ lobbyMessageDraft.length }}/50</small>
                    <button type="submit" :disabled="!lobbyMessageDraft.trim()">Send</button>
                  </form>
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
                  <button v-if="(lobbyPlayers[slot - 1].id === clientId || (isLobbyHost && lobbyPlayers[slot - 1].isAI)) && lobbyCharacterIndices.length" type="button" class="lobby-char-arrow left" @click.stop.prevent="changeLobbySlotCharacter(lobbyPlayers[slot - 1], -1)">‹</button>
                  <div
                    class="lobby-pawn"
                    :class="{
                      owned: lobbyPlayers[slot - 1].id === clientId,
                      'has-tooltip': lobbyPlayers[slot - 1].id === clientId || Boolean(lobbyPlayers[slot - 1].character.passiveSkill),
                    }"
                    :tabindex="lobbyPlayers[slot - 1].id === clientId || lobbyPlayers[slot - 1].character.passiveSkill ? 0 : null"
                    :role="lobbyPlayers[slot - 1].character.passiveSkill ? 'button' : null"
                    :aria-label="lobbyPlayers[slot - 1].character.passiveSkill ? `Show ${lobbyPlayers[slot - 1].character.name} passive skill` : null"
                    :aria-describedby="lobbyPlayers[slot - 1].id === clientId || lobbyPlayers[slot - 1].character.passiveSkill ? `lobby-character-tip-${slot}` : null"
                  ><span>{{ lobbyPlayers[slot - 1].character.face }}</span></div>
                  <button v-if="(lobbyPlayers[slot - 1].id === clientId || (isLobbyHost && lobbyPlayers[slot - 1].isAI)) && lobbyCharacterIndices.length" type="button" class="lobby-char-arrow right" @click.stop.prevent="changeLobbySlotCharacter(lobbyPlayers[slot - 1], 1)">›</button>
                  <div
                    v-if="lobbyPlayers[slot - 1].id === clientId || lobbyPlayers[slot - 1].character.passiveSkill"
                    :id="`lobby-character-tip-${slot}`"
                    class="lobby-character-tooltip"
                    role="tooltip"
                  >
                    <strong>{{ lobbyPlayers[slot - 1].character.passiveSkill ? lobbyPlayers[slot - 1].character.name : (lobbyPlayers[slot - 1].customName || lobbyPlayers[slot - 1].character.name) }}</strong>
                    <template v-if="lobbyPlayers[slot - 1].character.specialSkill">
                      <small>{{ lobbyPlayers[slot - 1].character.specialSkill.name }}</small>
                      <p>{{ lobbyPlayers[slot - 1].character.specialSkill.description }}</p>
                    </template>
                    <template v-else-if="lobbyPlayers[slot - 1].character.passiveSkill">
                      <small>Passive · {{ lobbyPlayers[slot - 1].character.passiveSkill.name }}</small>
                      <p>{{ lobbyPlayers[slot - 1].character.passiveSkill.description }}</p>
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
              <button class="game-button exit" @click="leaveOnlineRoom()">↪ Exit room</button>
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
            <div class="room-settings-row">
              <label
                v-if="exactMoveSettingAvailable"
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
              <label class="exact-move-setting private-room-setting">
                <input
                  type="checkbox"
                  :checked="Boolean(onlineRoom?.privateRoom)"
                  :disabled="!isLobbyHost"
                  @change="changePrivateRoom"
                >
                <span>Private Room</span>
              </label>
            </div>
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

    <template v-else-if="page === 'room-list'">
      <section class="room-list-screen">
        <header class="room-list-topbar">
          <button class="lobby-back" @click="page = 'home'" aria-label="Back to home">←</button>
          <div class="brand brand-lobby">
            <span class="crown">♛</span>
            <span class="brand-top">LADDERS...</span>
            <span class="brand-bottom"><i>AND</i> WHAT?!</span>
          </div>
          <div class="lobby-title">Room List</div>
          <div class="room-list-controls">
            <button class="create-room-list" type="button" @click="createOnlineLobby">
              Create Room
            </button>
            <button class="refresh-rooms" type="button" :disabled="roomListLoading" @click="refreshRoomList">
              {{ roomListLoading ? 'Loading...' : 'Refresh' }}
            </button>
          </div>
        </header>
        <div class="room-list-grid">
          <section class="room-list-panel">
            <h2>Available Rooms</h2>
            <article v-if="!availableRoomList.length" class="room-list-empty">No available rooms</article>
            <article v-for="room in availableRoomList" :key="room.code" class="room-list-card">
              <div>
                <small>{{ room.modeName }} · {{ room.boardName }}</small>
                <span>{{ room.playerCount }}/{{ room.maxPlayers }} players</span>
              </div>
              <button v-if="room.canJoin" type="button" @click="joinListedRoom(room.code)">Join</button>
              <b v-else>Full</b>
            </article>
          </section>
          <section class="room-list-panel in-game">
            <h2>In Game</h2>
            <article v-if="!inGameRoomList.length" class="room-list-empty">No games yet</article>
            <article v-for="room in inGameRoomList" :key="room.code" class="room-list-card">
              <div>
                <small>{{ room.modeName }} · {{ room.boardName }}</small>
                <span>{{ room.playerCount }}/{{ room.maxPlayers }} players · {{ room.spectatorCount }}/{{ room.maxSpectators }} watching</span>
              </div>
              <button v-if="room.canSpectate" type="button" @click="spectateRoom(room.code)">Spectate</button>
              <b v-else>Full</b>
            </article>
          </section>
        </div>
        <p v-if="onlineError" class="room-list-error">{{ onlineError }}</p>
      </section>
    </template>

    <template v-else-if="page === 'game' && game">
      <section class="game-screen">
        <div v-if="escapeBriefing?.active" class="escape-briefing-overlay" role="dialog" aria-modal="true" aria-labelledby="escape-briefing-title">
          <article class="escape-briefing-card">
            <div class="escape-briefing-count">
              Ready {{ escapeBriefing.voterIds.length }} / {{ escapeBriefing.total }}
            </div>
            <button
              type="button"
              class="escape-briefing-close"
              :class="{ voted: escapeBriefing.voterIds.includes(clientId) }"
              :disabled="escapeBriefing.voterIds.includes(clientId)"
              :aria-label="escapeBriefing.voterIds.includes(clientId) ? 'Waiting for other players' : 'Close instructions'"
              @click="closeEscapeBriefing"
            >{{ escapeBriefing.voterIds.includes(clientId) ? '✓' : '×' }}</button>
            <small>{{ game.board.name }}</small>
            <h2 id="escape-briefing-title">Escape Instructions</h2>
            <ol>
              <li>Work together to collect all <b>{{ game.board.keys_count }} {{ escapeKeyName.toLowerCase() }}</b> scattered on the board. Each player can collect two. If killed, all collected items will be dropped.</li>
              <li>Once all {{ escapeKeyName.toLowerCase() }} are collected, head to <b>Square 100</b> to unlock and escape the place. It can only be unlocked if all holders are on Square 100, and everyone can only escape if all living players are there.</li>
              <li>Entities are scattered on the board, ready to pounce and attack. Prepare your weapon with the <b>Arm Weapon</b> button or <kbd>G</kbd>. It protects you for the next two turns, so use it wisely!</li>
              <li>A blinking red at the edges of the screen indicates an entity is nearby to any of the players.</li>
              <li>Every failed prevention costs <b>1 health point</b>. If all health points are gone, you die. If everyone dies or only one survivor remains, you lose the game.</li>
            </ol>
            <footer>Good luck and survive!</footer>
          </article>
        </div>
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
        <div v-if="escapeMoveChoice" class="escape-move-choice-overlay" role="dialog" aria-modal="true">
          <small>{{ escapeMoveSeconds }}s remaining</small>
          <strong>Pick Moves</strong>
          <div class="escape-move-options">
            <button
              v-for="roll in escapeMoveChoice.options"
              :key="roll"
              class="large-dice"
              :disabled="escapeMoveChoice.playerId !== clientId"
              @click="chooseEscapeMove(roll)"
            >{{ roll }}</button>
          </div>
          <button
            v-if="escapeMoveChoice.canSkip"
            type="button"
            class="escape-skip-move"
            :disabled="escapeMoveChoice.playerId !== clientId"
            @click="skipEscapeMove"
          >Skip turn · Stay on Square 100</button>
          <small v-if="escapeMoveChoice.playerId !== clientId">Waiting for the current player</small>
        </div>
        <div v-if="directionChoice" class="escape-direction-overlay" role="dialog" aria-modal="true">
          <div class="escape-roll-result">Picked <b>{{ directionChoice.roll }}</b></div>
          <small>{{ directionSeconds }}s remaining</small>
          <strong>Choose direction</strong>
          <div class="escape-direction-actions">
            <button :disabled="directionChoice.playerId !== clientId" @click="chooseDirection('backward')">← Backward</button>
            <button :disabled="directionChoice.playerId !== clientId" @click="chooseDirection('forward')">Forward →</button>
          </div>
          <small v-if="directionChoice.playerId !== clientId">Waiting for the current player</small>
        </div>
        <div v-if="penaltyOverlay" class="penalty-overlay" role="status">
          <strong>Penalty</strong>
          <small>{{ penaltyOverlay.message }}</small>
        </div>
        <div v-if="guessWhatDifficulty" class="guess-what-overlay" role="dialog" aria-modal="true" aria-labelledby="guess-difficulty-title">
          <section class="guess-what-card difficulty-card">
            <small>Question square</small>
            <h2 id="guess-difficulty-title">Choose a difficulty</h2>
            <p>{{ guessWhatDifficulty.playerId === clientId ? 'Pick your challenge.' : `Waiting for ${guessWhatDifficulty.playerName}.` }}</p>
            <div class="guess-difficulty-options">
              <button
                v-for="difficulty in ['easy', 'medium', 'hard']"
                :key="difficulty"
                type="button"
                :class="difficulty"
                :disabled="guessWhatDifficulty.playerId !== clientId || !guessWhatDifficulty.counts[difficulty]"
                @click="chooseGuessWhatDifficulty(difficulty)"
              >
                <strong>{{ difficulty }}</strong>
                <span>{{ guessWhatDifficulty.counts[difficulty] }} available</span>
                <small>{{ guessWhatDifficulty.timers?.[difficulty] || (difficulty === 'easy' ? 7 : difficulty === 'medium' ? 10 : 15) }}s · {{ difficulty === 'easy' ? '3+' : difficulty === 'medium' ? '5+' : '7+' }} moves</small>
              </button>
            </div>
          </section>
        </div>
        <div v-if="guessWhatQuestion" class="guess-what-overlay" role="dialog" aria-modal="true" aria-labelledby="guess-question-title">
          <section class="guess-what-card question-card" :class="guessWhatQuestion.difficulty">
            <header>
              <span>{{ guessWhatQuestion.difficulty }}</span>
              <strong v-if="!guessWhatQuestion.locked" :class="{ urgent: guessWhatSeconds <= 3 }">{{ guessWhatSeconds }}s</strong>
              <strong v-else class="answer-locked">Locked</strong>
            </header>
            <h2 id="guess-question-title">
              <template
                v-for="(part, index) in notationParts(guessWhatQuestion.question)"
                :key="`${part.text}-${index}`"
              ><span :class="{ 'math-exponent': part.exponent }">{{ part.text }}</span></template>
            </h2>
            <div class="guess-answer-options">
              <button
                v-for="choice in guessWhatQuestion.choices"
                :key="choice"
                type="button"
                :class="{ selected: guessWhatQuestion.locked && guessWhatQuestion.selectedAnswer === choice }"
                :disabled="guessWhatQuestion.playerId !== clientId || guessWhatQuestion.locked"
                @click="answerGuessWhat(choice)"
              >
                <template
                  v-for="(part, index) in notationParts(choice)"
                  :key="`${choice}-${index}`"
                ><span :class="{ 'math-exponent': part.exponent }">{{ part.text }}</span></template>
              </button>
            </div>
            <small v-if="guessWhatQuestion.locked">
              {{ guessWhatQuestion.timedOut ? `${guessWhatQuestion.playerName} did not answer.` : `${guessWhatQuestion.playerName} chose “${guessWhatQuestion.selectedAnswer}”.` }}
            </small>
            <small v-else-if="guessWhatQuestion.playerId !== clientId">Waiting for {{ guessWhatQuestion.playerName }} to answer</small>
          </section>
        </div>
        <div v-if="guessWhatResult" class="guess-what-result" :class="{ correct: guessWhatResult.correct, wrong: !guessWhatResult.correct }" role="status">
          <strong>{{ guessWhatResult.correct ? 'Correct!' : guessWhatResult.timedOut ? 'Time’s up!' : 'Wrong answer!' }}</strong>
          <span v-if="guessWhatResult.correct">Move forward {{ guessWhatResult.movement }} spaces</span>
          <span v-else>Move back {{ Math.abs(guessWhatResult.movement) }} spaces</span>
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
        <div v-if="weaponEquippedOverlay" class="weapon-equipped-overlay" role="status" aria-live="assertive">
          <small>Weapon ready</small>
          <strong>{{ weaponEquippedOverlay.playerName }} equipped their weapon</strong>
        </div>
        <div v-if="escapePassiveOverlay" class="escape-passive-overlay" role="status" aria-live="assertive">
          <small>{{ escapePassiveOverlay.playerName }}'s passive skill</small>
          <strong>{{ escapePassiveOverlay.name }}</strong>
        </div>
        <div v-if="escapePassiveGifOverlay" class="escape-passive-gif-overlay" :class="escapePassiveGifOverlay.kind" role="status">
          <img :src="escapePassiveGifOverlay.src" :alt="`${escapePassiveGifOverlay.kind} passive skill`">
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
        <div v-if="clashStunSkipOverlay" class="skip-overlay clash-stun-skip-overlay" role="status">
          <small :style="{ color: clashStunSkipOverlay.color }">{{ clashStunSkipOverlay.playerName }}</small>
          <strong>Stunned</strong>
          <p>Turn skipped automatically.</p>
        </div>
        <div v-if="skillOverlay" class="skill-overlay" role="status">
          <small>
            <b :style="{ color: skillOverlay.color }">{{ skillOverlay.playerName }}</b>
            {{ skillOverlay.consequence ? ' consequence' : skillOverlay.result ? ' skill result' : ' is using' }}
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
          <button class="game-exit" @click="leaveOnlineRoom()">← {{ isSpectating ? 'Stop watching' : 'Exit' }}</button>
          <button class="game-settings-button" type="button" @click="openGameSettings" aria-label="Open settings">⚙ Settings</button>
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
            <small>{{ escapeKeyName }}</small>
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
              <strong>{{ game.mode === 'escape_from' && escapeMoveChoice ? escapeMoveSeconds : game.mode === 'escape_from' && directionChoice ? directionSeconds : turnSeconds }}s</strong>
          </div>
          <div class="hud-dice-panel">
            <button
              v-if="!game.gameOver"
              class="game-button yellow"
              :disabled="turnBusy || !isControlledTurn || (game.mode === 'clash_with' && controlledClashStunned)"
              @click="playTurn"
            >
              {{
                isControlledTurn
                  ? (game.mode === 'clash_with' ? 'Move' : game.mode === 'escape_from' ? 'Pick Moves' : controlledGamePlayer?.specialRollPending ? 'Parkour Roll' : controlledGamePlayer?.rerollPending ? 'Reroll' : 'Roll dice')
                  : `${game.players[game.currentPlayerIndex].name}'s turn`
              }}
            </button>
            <button v-else class="game-button green" @click="leaveOnlineRoom()">Exit game</button>
          </div>
        </header>
        <div v-if="clashKillFeed" class="clash-kill-feed" role="status">{{ clashKillFeed.text }}</div>
        <div v-if="clashShotOverlay" class="clash-shot-overlay" role="presentation" aria-hidden="true">
          <img :src="clashShotOverlay.src" alt="">
        </div>
        <div v-if="clashMeleeOverlay" class="clash-melee-overlay" :class="clashMeleeOverlay.kind" role="presentation" aria-hidden="true">
          <img :src="clashMeleeOverlay.src" alt="">
        </div>
        <div v-if="settingsModalOpen" class="game-settings-modal" role="dialog" aria-modal="true" aria-labelledby="game-settings-title" @click.self="settingsModalOpen = false">
          <div class="game-settings-card">
            <button class="game-settings-close" type="button" aria-label="Close settings" @click="settingsModalOpen = false">×</button>
            <div class="ribbon" id="game-settings-title">Settings</div>
            <div class="setting-row">
              <div class="round-icon">🔊</div>
              <div class="setting-control">
                <label for="game-sfx">SFX volume <output>{{ muted ? 0 : sfx }}</output></label>
                <input id="game-sfx" v-model="sfx" type="range" min="0" max="100" :disabled="muted">
                <p>Adjust the <b>sound effects</b> volume.</p>
              </div>
            </div>
            <div class="setting-row">
              <div class="round-icon">♫</div>
              <div class="setting-control">
                <label for="game-music">Music volume <output>{{ muted ? 0 : music }}</output></label>
                <input id="game-music" v-model="music" type="range" min="0" max="100" :disabled="muted">
                <p>Adjust the <b>background music</b> volume.</p>
              </div>
            </div>
            <label class="mute-row">
              <span class="mute-icon">🔇</span><span><b>Mute all</b><small>Silence everything. Finally.</small></span>
              <input v-model="muted" type="checkbox"><i></i>
            </label>
          </div>
        </div>

        <div class="game-layout">
          <div
            class="game-board-wrap"
          >
            <div class="game-board" :class="{ 'escape-board': game.mode === 'escape_from', 'clash-board': game.mode === 'clash_with', 'clash-stunned-view': clashVisionBlurred, 'dead-forest-board': game.board.name === 'Dead Forest', 'encounter-active': escapeOverlay && escapeOverlay.type !== 'exit' }">
              <img :src="boardPicture(game.board)" :alt="`${game.board.name} gameplay board`">
              <div v-if="escapePickupNotice" class="escape-pickup-notice" :class="escapePickupNotice.pickupType" role="status">
                {{ escapePickupNotice.text }}
              </div>
              <svg v-if="game.mode === 'escape_from'" class="escape-darkness" :class="{ 'dead-forest-fog': game.board.name === 'Dead Forest' }" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <filter id="escape-lamp-soften" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="1.4"/>
                  </filter>
                  <filter id="dead-forest-fog-texture" x="-15%" y="-15%" width="130%" height="130%">
                    <feTurbulence type="fractalNoise" baseFrequency=".025 .04" numOctaves="4" seed="17"/>
                    <feColorMatrix type="matrix" values=".62 0 0 0 .28  0 .68 0 0 .34  0 0 .62 0 .3  0 0 0 .8 0"/>
                    <feGaussianBlur stdDeviation=".8"/>
                  </filter>
                  <filter id="dead-forest-reveal-smudge" x="-20%" y="-20%" width="140%" height="140%">
                    <feTurbulence type="fractalNoise" baseFrequency=".18" numOctaves="3" seed="29" result="edgeNoise"/>
                    <feDisplacementMap in="SourceGraphic" in2="edgeNoise" scale="1.35" xChannelSelector="R" yChannelSelector="B" result="roughOpening"/>
                    <feGaussianBlur in="roughOpening" stdDeviation=".42"/>
                  </filter>
                  <mask id="escape-shared-vision">
                    <rect width="100" height="100" fill="white"/>
                    <g v-if="game.board.name !== 'Dead Forest'" filter="url(#escape-lamp-soften)">
                      <circle
                        v-for="player in escapeVisiblePlayers"
                        :key="`lamp-${player.id}`"
                        :cx="parseFloat(boardSpacePosition(visualSpace(player)).left)"
                        :cy="parseFloat(boardSpacePosition(visualSpace(player)).top)"
                        r="6.5"
                        fill="black"
                      />
                    </g>
                    <g v-else>
                      <rect
                        v-for="player in escapeVisiblePlayers"
                        :key="`fog-square-${player.id}`"
                        v-bind="boardSpaceBounds(visualSpace(player))"
                        fill="black"
                        filter="url(#dead-forest-reveal-smudge)"
                      />
                    </g>
                    <rect
                      v-for="space in boostedVisionSpaces"
                      :key="`boosted-vision-${space}`"
                      class="boosted-vision-cell"
                      v-bind="boardSpaceBounds(space)"
                      fill="black"
                    />
                    <rect
                      v-if="game.exitRevealed"
                      v-bind="boardSpaceBounds(100)"
                      fill="black"
                    />
                  </mask>
                </defs>
                <rect v-if="game.board.name !== 'Dead Forest'" width="100" height="100" fill="black" mask="url(#escape-shared-vision)"/>
                <g v-else mask="url(#escape-shared-vision)">
                  <rect width="100" height="100" fill="#526159" opacity=".98"/>
                  <rect class="fog-clouds" x="-4" y="-4" width="108" height="108" filter="url(#dead-forest-fog-texture)" opacity=".96"/>
                  <rect width="100" height="100" fill="#c4cec5" opacity=".24"/>
                </g>
              </svg>
              <svg v-if="game.mode === 'clash_with'" class="clash-darkness" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <filter id="clash-vision-smudge" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation=".65"/>
                  </filter>
                  <mask id="clash-vision-mask">
                    <rect width="100" height="100" fill="white"/>
                    <rect
                      v-for="space in clashVisibleSpaces"
                      :key="`clash-vision-${space}`"
                      v-bind="boardSpaceBounds(space) || { x: `${((space - 1) % 10) * 10}%`, y: `${90 - Math.floor((space - 1) / 10) * 10}%`, width: '10%', height: '10%' }"
                      fill="black"
                      filter="url(#clash-vision-smudge)"
                    />
                  </mask>
                </defs>
                <rect width="100" height="100" fill="black" opacity=".92" mask="url(#clash-vision-mask)"/>
              </svg>
              <img
                v-for="drop in game.mode === 'clash_with' ? (game.clashDrops || []).filter(clashDropVisible) : []"
                :key="drop.id"
                class="clash-board-object"
                :class="`clash-${drop.kind}`"
                :src="clashMedia(drop.definition.gif)"
                :style="boardSpacePosition(drop.space)"
                :alt="drop.definition.name"
              >
              <span
                v-for="trace in clashBulletTraces"
                :key="trace.id"
                class="clash-bullet-trace"
                :style="trace.style"
                aria-hidden="true"
              ></span>
              <img
                v-for="thrown in clashThrownItems"
                :key="thrown.id"
                class="clash-thrown-item"
                :src="thrown.src"
                :style="thrown.style"
                :alt="thrown.alt"
              >
              <div
                v-for="effect in clashItemEffects"
                :key="effect.id"
                class="clash-item-effect"
                :style="effect.style"
                aria-hidden="true"
              >
                <img :src="effect.src" :alt="effect.alt">
              </div>
              <button
                v-for="space in game.mode === 'clash_with' && clashActionMode === 'move' ? clashMoveOptions : []"
                :key="`clash-move-${space}`"
                class="clash-space-option move"
                type="button"
                :style="boardSpacePosition(space)"
                @click="sendClashMove(space)"
              ></button>
              <button
                v-for="space in game.mode === 'clash_with' && clashItemTargeting ? clashItemTargetSpaces() : []"
                :key="`clash-item-${space}`"
                class="clash-space-option item"
                type="button"
                :style="boardSpacePosition(space)"
                @click="sendClashUseTargetedItem(space)"
              ></button>
              <img
                v-for="key in game.mode === 'escape_from' ? game.keys.filter(item => !item.holderId && item.space != null && escapeObjectVisible(item.space)) : []"
                :key="key.id"
                class="escape-board-object escape-key"
                :src="currentEscapeMedia.key"
                :style="boardSpacePosition(key.space)"
                :alt="escapeKeyName"
              >
              <img
                v-for="medkit in game.mode === 'escape_from' ? game.medkits.filter(item => escapeObjectVisible(item.space)) : []"
                :key="medkit.id"
                class="escape-board-object escape-pickup escape-medkit"
                :src="escapeMedkitGif"
                :style="boardSpacePosition(medkit.space)"
                alt="Medkit"
              >
              <img
                v-for="light in game.mode === 'escape_from' ? game.lightSources.filter(item => escapeObjectVisible(item.space)) : []"
                :key="light.id"
                class="escape-board-object escape-pickup escape-light-source"
                :src="currentEscapeMedia.lightSource"
                :style="boardSpacePosition(light.space)"
                alt="Light Source"
              >
              <img
                v-for="entity in game.mode === 'escape_from' ? game.entities.filter(escapeEntityVisible) : []"
                :key="entity.id"
                class="escape-board-object escape-entity"
                :class="{ encountered: escapeEncounterSpace === entity.space, revealed: revealedEscapeEntities?.ids.includes(entity.id) }"
                :src="currentEscapeMedia.entity"
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
                v-for="player in game.players.filter(player => game.mode !== 'clash_with' || clashPlayerVisible(player))"
                :key="player.id"
                class="board-token"
                :class="{
                  active: game.players.findIndex(item => item.id === player.id) === game.currentPlayerIndex && !game.gameOver,
                  owned: player.id === clientId,
                  moving: movingPlayerId === player.id,
                  climbing: climbingPlayerId === player.id,
                  blown: blownPlayerId === player.id,
                  finished: player.finished && resolvingPlayerId !== player.id,
                  eliminated: player.eliminated,
                  ghost: game.mode === 'clash_with' && player.eliminated,
                  'health-hit': healthBlinkPlayerId === player.id,
                  'clash-damage-hit': clashDamageBlinkIds[player.id],
                  'clash-stun-hit': clashStunBlinkIds[player.id],
                  'clash-stunned': game.mode === 'clash_with' && player.clashStunnedThroughTurn != null && game.turn <= player.clashStunnedThroughTurn,
                  'clash-rival-revealed': clashRivalRevealed(player),
                  'clash-targetable': game.mode === 'clash_with' && clashActionMode === 'attack' && visibleClashTargets.some(target => target.id === player.id),
                  'sound-picker-open': emojiPickerPlayerId === player.id && emojiPickerPlacement === 'board',
                  'social-active': game.mode === 'escape_from' && Boolean(activeReactions[player.id])
                }"
                :style="tokenPosition(visualSpace(player), game.players.findIndex(item => item.id === player.id))"
                :title="`${player.name}: space ${player.space}`"
                @click.stop="game.mode === 'clash_with' && clashActionMode === 'attack' && visibleClashTargets.some(target => target.id === player.id) ? sendClashAttack(player.id) : toggleEmojiPicker(player, 'board')"
              >
                <div v-if="game.mode !== 'clash_with' && emojiPickerPlayerId === player.id && emojiPickerPlacement === 'board'" class="emoji-picker" :class="boardPickerClasses(player)" @click.stop>
                  <div v-if="game.mode !== 'escape_from'" class="emoji-row"><button v-for="emoji in ['😭','😂','😐','😛','😎']" :key="emoji" type="button" @click="sendPlayerEmoji(player.id, emoji)">{{ emoji }}</button></div>
                  <div class="reaction-row"><button v-for="reaction in socialReactionsForMode()" :key="reaction.key" type="button" @click="sendPlayerReaction(player.id, reaction.key)">{{ reaction.label }}</button></div>
                </div>
                <span v-if="activeEmojis[player.id]" class="player-emote">{{ activeEmojis[player.id].emoji }}</span>
                <span v-if="activeReactions[player.id]" class="player-reaction">{{ activeReactions[player.id].text }}</span>
                <span v-if="game.mode === 'clash_with' && player.clashStunnedThroughTurn != null && game.turn <= player.clashStunnedThroughTurn" class="clash-stun-marker" aria-hidden="true"></span>
                <span>{{ player.face }}</span>
                <small>{{ game.players.findIndex(item => item.id === player.id) + 1 }}</small>
              </div>
            </div>
          </div>

          <aside class="game-console" :class="{ 'clash-console': game.mode === 'clash_with' }">
            <div class="player-order">
              <article
                v-for="(player, index) in game.players"
                :key="player.id"
                :class="{ current: index === game.currentPlayerIndex && !game.gameOver, finished: player.finished && resolvingPlayerId !== player.id, loser: game.loser?.id === player.id && resolvingPlayerId !== player.id, 'health-hit': healthBlinkPlayerId === player.id, 'health-heal': healthHealPlayerId === player.id, 'weapon-armed': game.mode === 'escape_from' && player.weaponProtectFromTurn != null, 'mode-eliminated': player.eliminated && ['escape_from','run_away','clash_with'].includes(game.mode), owned: player.id === clientId, 'picker-open': emojiPickerPlayerId === player.id && emojiPickerPlacement === 'console' }"
                :style="{ '--player-color': player.color }"
                @click="toggleEmojiPicker(player, 'console')"
              >
                <div v-if="game.mode !== 'clash_with' && emojiPickerPlayerId === player.id && emojiPickerPlacement === 'console'" class="emoji-picker console-emoji-picker" @click.stop>
                  <div v-if="game.mode !== 'escape_from'" class="emoji-row"><button v-for="emoji in ['😭','😂','😐','😛','😎']" :key="emoji" type="button" @click="sendPlayerEmoji(player.id, emoji)">{{ emoji }}</button></div>
                  <div class="reaction-row"><button v-for="reaction in socialReactionsForMode()" :key="reaction.key" type="button" @click="sendPlayerReaction(player.id, reaction.key)">{{ reaction.label }}</button></div>
                </div>
                <span class="console-pawn">{{ player.face }}</span>
                <div>
                  <strong>{{ player.name }}</strong>
                  <small v-if="game.mode !== 'clash_with'">{{ player.won ? 'Winner · Last standing' : player.eliminated ? 'Spectating · Eliminated' : player.finished && resolvingPlayerId !== player.id ? `Finished #${player.rank}` : `Space ${visualSpace(player)}` }}</small>
                  <small v-if="game.mode === 'escape_from'" class="escape-vitals">
                    <span aria-label="Health">{{ '♥'.repeat(shownHealth(player)) }}</span>
                    <b>🔑 {{ player.heldKeys.length }}/2</b>
                  </small>
                  <small v-if="game.mode === 'clash_with' && player.id === clientId" class="clash-vitals">
                    <span aria-label="Health">♥ {{ shownHealth(player) }}/100</span>
                  </small>
                </div>
                <div v-if="resolvingPlayerId !== player.id" class="statuses">
                  <i v-if="player.skipTurns">⏳ {{ player.skipTurns }}</i>
                  <i v-if="player.skillBlockedTurns">🚫 Skill {{ player.skillBlockedTurns }}</i>
                </div>
              </article>
            </div>

            <div v-if="!game.gameOver && controlledGamePlayer && game.mode !== 'guess_what' && (game.mode !== 'clash_with' || controlledGamePlayer.clashPendingPickup)" class="skill-panel">
              <template v-if="game.mode === 'clash_with'">
                <div v-if="controlledGamePlayer.clashPendingPickup" class="clash-pickup-choice">
                  <strong>Found {{ controlledGamePlayer.clashPendingPickup.weapon.name }}</strong>
                  <span>Replace your {{ controlledGamePlayer.clashPendingPickup.slot === 'pistol' ? 'pistol' : 'primary weapon' }}?</span>
                  <button type="button" @click="resolveClashPickup(true)">Replace</button>
                  <button type="button" @click="resolveClashPickup(false)">Keep current</button>
                </div>
              </template>
              <template v-else-if="game.mode === 'escape_from'">
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
                <template v-else-if="controlledGamePlayer.delayedSkillCooldownStartTurn != null">
                  Cooldown starts turn {{ controlledGamePlayer.delayedSkillCooldownStartTurn }}
                </template>
                <template v-else-if="skillCooldown(controlledGamePlayer)">
                  Cooldown {{ skillCooldown(controlledGamePlayer) }}s
                </template>
                <template v-else>Use skill · Tap or press G</template>
              </button>
              <small v-if="skillNotice">{{ skillNotice }}</small>
              </template>
            </div>

            <div v-if="game.mode === 'clash_with' && controlledGamePlayer" class="event-log clash-inventory-panel">
              <div class="skill-title">
                <span>Your Loadout</span>
                <strong>{{ controlledClashStunned ? 'Stunned' : isControlledTurn ? 'Tap to act' : 'Private' }}</strong>
              </div>
              <div class="clash-loadout-slots">
                <section class="clash-slot-section">
                  <small>Weapons</small>
                  <div class="clash-slot-grid weapon-slots">
                    <article
                      v-for="slot in clashWeaponSlots"
                      :key="slot.key"
                      class="clash-slot"
                      :class="{ empty: !slot.weapon, active: slot.weapon && clashActionMode === 'attack' && clashSelectedWeapon === slot.weapon.name, cooling: slot.weapon?.class === 'melee' && clashMeleeCooldownSeconds > 0 }"
                    >
                      <span class="clash-slot-label">{{ slot.label }}</span>
                      <button
                        type="button"
                        class="clash-slot-button"
                        :disabled="clashWeaponDisabled(slot.weapon, slot.locked)"
                        @click="selectClashWeaponAction(slot.weapon)"
                      >
                        <img v-if="slot.weapon && clashInventoryImage(slot.weapon)" :src="clashInventoryImage(slot.weapon)" :alt="slot.weapon.name">
                        <span v-else class="clash-slot-placeholder" :data-kind="slot.key">{{ slot.placeholder }}</span>
                        <span v-if="slot.weapon" class="clash-slot-name">{{ slot.weapon.name }}</span>
                        <b v-if="slot.weapon" class="clash-slot-capacity">{{ clashWeaponCapacity(slot.weapon) }}</b>
                        <i
                          v-if="slot.weapon?.class === 'melee' && clashMeleeCooldownSeconds > 0"
                          class="melee-cooldown-bar"
                          :style="{ '--cooldown-progress': `${clashMeleeCooldownProgress}%` }"
                          aria-hidden="true"
                        ></i>
                      </button>
                      <div v-if="slot.weapon && clashActionMode === 'attack' && clashSelectedWeapon === slot.weapon.name && slot.weapon.modes?.length > 1" class="clash-slot-actions">
                        <button
                          v-for="mode in slot.weapon.modes"
                          :key="mode.name"
                          type="button"
                          :class="{ active: clashSelectedWeaponMode === mode.name }"
                          @click.stop="setClashWeaponMode(slot.weapon, mode.name)"
                        >
                          {{ mode.name }} · {{ mode.accuracy }}% accuracy
                        </button>
                      </div>
                    </article>
                  </div>
                </section>

                <section class="clash-slot-section">
                  <small>Items</small>
                  <div class="clash-slot-grid item-slots">
                    <article
                      v-for="slot in clashItemSlots"
                      :key="slot.key"
                      class="clash-slot"
                      :class="{ empty: !slot.item, active: slot.item && clashItemTargeting === slot.item.id }"
                    >
                      <span class="clash-slot-label">{{ slot.label }}</span>
                      <button
                        type="button"
                        class="clash-slot-button"
                        :disabled="clashItemDisabled(slot.item)"
                        @click="selectClashItemAction(slot.item)"
                      >
                        <img v-if="slot.item && clashInventoryImage(slot.item)" :src="clashInventoryImage(slot.item)" :alt="slot.item.name">
                        <span v-else class="clash-slot-placeholder" :data-kind="slot.key">{{ slot.placeholder }}</span>
                        <span v-if="slot.item" class="clash-slot-name">{{ slot.item.name }}</span>
                        <b v-if="slot.item" class="clash-slot-capacity">{{ clashItemCapacity(slot.item) }}</b>
                      </button>
                    </article>
                  </div>
                </section>
                <em v-if="clashActionMode === 'attack'">Click a red-outlined visible player.</em>
                <em v-else-if="clashItemTargeting">Choose a yellow square.</em>
              </div>
              <section class="clash-loadout-list">
                <small>Weapons</small>
                <button
                  v-for="weapon in controlledClashWeapons"
                  :key="weapon.name"
                  type="button"
                  class="clash-inventory-entry weapon-entry"
                  :class="{ active: clashActionMode === 'attack' && clashSelectedWeapon === weapon.name, cooling: weapon.class === 'melee' && clashMeleeCooldownSeconds > 0 }"
                  :disabled="!isControlledTurn || turnBusy || controlledClashStunned || (weapon.class !== 'melee' && weapon.ammoRemaining <= 0) || (weapon.class === 'melee' && clashMeleeCooldownSeconds > 0)"
                  @click="selectClashWeaponAction(weapon)"
                >
                  <span>{{ weapon.name }}</span>
                  <b>{{ weapon.class === 'melee' ? (clashMeleeCooldownSeconds > 0 ? `${clashMeleeCooldownSeconds}s` : '∞') : `${weapon.ammoRemaining ?? weapon.max_capacity}/${weapon.max_capacity}` }}</b>
                  <i
                    v-if="weapon.class === 'melee' && clashMeleeCooldownSeconds > 0"
                    class="melee-cooldown-bar"
                    :style="{ '--cooldown-progress': `${clashMeleeCooldownProgress}%` }"
                    aria-hidden="true"
                  ></i>
                </button>
                <label v-if="clashActionMode === 'attack' && selectedClashWeapon?.modes?.length > 1" class="clash-mode-picker">
                  Mode
                  <select :value="clashSelectedWeaponMode" @change="setClashWeaponMode(selectedClashWeapon, $event.target.value)">
                    <option v-for="mode in selectedClashWeapon.modes" :key="mode.name" :value="mode.name">{{ mode.name }} · {{ mode.accuracy }}% accuracy</option>
                  </select>
                </label>
                <em v-if="clashActionMode === 'attack'">Click a red-outlined visible player.</em>
              </section>
              <section class="clash-loadout-list">
                <small>Items</small>
                <button
                  v-for="item in controlledClashItems"
                  :key="item.id"
                  type="button"
                  class="clash-inventory-entry item-entry"
                  :class="{ active: clashItemTargeting === item.id }"
                  :disabled="!isControlledTurn || turnBusy || controlledClashStunned || (item.effect === 'heal' && controlledGamePlayer.health >= 100)"
                  @click="selectClashItemAction(item)"
                >
                  <span>{{ item.name }}</span>
                  <b>×{{ item.count }}</b>
                </button>
                <em v-if="!controlledClashItems.length">No items</em>
                <em v-else-if="clashItemTargeting">Choose a yellow square.</em>
              </section>
            </div>
            <div v-else class="event-log">
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
            <button class="game-button yellow" :class="{ active: page === 'settings' }" @click="goSettings(page)"><span class="icon">⚙</span> Settings</button>
          </nav>
          <div class="note">MORE CHAOS<br>COMING SOON...<br><b>MAYBE.</b></div>
        </aside>

        <section class="content">
          <button class="back" @click="page === 'settings' ? leaveSettings() : page = 'home'">← BACK</button>

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
