export const SKILL_COOLDOWN_MS = 120_000

function randomInteger(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function prepareBoard(board) {
  const prepared = structuredClone(board)
  prepared.ladders ||= []
  prepared.question_marks ||= []
  prepared.whats ||= []
  if (prepared.type === 'guess_what') {
    const count = prepared.question_marks.length || 13
    const candidates = Array.from({ length: 94 }, (_, index) => index + 5)
    prepared.question_marks = []
    while (prepared.question_marks.length < Math.min(count, candidates.length)) {
      prepared.question_marks.push(candidates.splice(randomInteger(0, candidates.length - 1), 1)[0])
    }
    prepared.question_marks.sort((a, b) => a - b)
    prepared.hiddenQuestionMarks = true
  }
  return prepared
}

export function createGameState(board, players, startedAt = Date.now()) {
  const preparedBoard = prepareBoard(board)
  return {
    mode: preparedBoard.type || 'standard',
    board: preparedBoard,
    players: players.map((player, index) => ({
      ...player,
      id: player.id || `${player.isAI ? 'ai' : 'player'}-${index}`,
      space: 1,
      skipTurns: 0,
      skipReason: null,
      skillBlockedTurns: 0,
      skillCooldownUntil: startedAt + SKILL_COOLDOWN_MS,
      skillArmed: null,
      rerollPending: false,
      specialRollPending: false,
      finished: false,
      eliminated: false,
      won: false,
      rank: null,
    })),
    currentPlayerIndex: 0,
    winners: [],
    winner: null,
    loser: null,
    gameOver: false,
    turn: 1,
    lastRoll: null,
    lastWhat: null,
    lastQuestionChain: [],
    lastEvent: 'The race to 100 is ready to begin.',
    log: ['Game started. Reach 100—and do not be the last player left!'],
    questionHistory: {},
    destroyedSpaces: [],
    nextExplosionTurn: preparedBoard.type === 'run_away' ? randomInteger(3, 5) : null,
    lastExplosion: null,
    lastTraversalElimination: null,
  }
}

function addLog(state, message) {
  state.lastEvent = message
  state.log.unshift(message)
  state.log = state.log.slice(0, 8)
}

function activePlayers(state) {
  return state.players.filter(player => !player.finished && !player.eliminated)
}

export function planRunAwayDestruction(state, fallbackAmount = randomInteger(4, 7)) {
  if (state.mode !== 'run_away' || state.gameOver) return []

  const lastDestroyed = state.destroyedSpaces.at(-1) || 0
  const closestPlayer = activePlayers(state)
    .filter(player => !player.forfeited && player.space > lastDestroyed)
    .sort((a, b) => a.space - b.space)[0]
  const distance = closestPlayer ? closestPlayer.space - lastDestroyed : 0
  const finalSquare = distance >= 15
    ? Math.min(99, closestPlayer.space - 5)
    : Math.min(99, lastDestroyed + fallbackAmount)

  const spaces = []
  for (let square = lastDestroyed + 1; square <= finalSquare; square++) {
    if (!state.destroyedSpaces.includes(square)) spaces.push(square)
  }
  return spaces
}

export function describeRunAwayRoll(playerName, startSpace, result) {
  if (result < 0 && startSpace === 1) {
    const message = `${playerName} stays on Square 1`
    return {
      resultLabel: message,
      movement: {
        spaces: 0,
        signedSpaces: 0,
        direction: 'stay',
        message,
      },
    }
  }

  return {
    resultLabel: result > 0
      ? `Move ${result} space${result === 1 ? '' : 's'} forward`
      : result < 0
        ? `Move ${Math.abs(result)} spaces backward`
        : 'Stay on this square',
    movement: {
      spaces: Math.abs(result),
      signedSpaces: result,
      direction: result > 0 ? 'forward' : result < 0 ? 'backward' : 'stay',
    },
  }
}

function concludeIfOneRemains(state) {
  const remaining = activePlayers(state)
  if (remaining.length === 0) {
    state.winner = null
    state.loser = null
    state.players.forEach(player => {
      player.won = false
    })
    state.gameOver = true
    addLog(state, 'Every player was eliminated by the destruction. Nobody wins.')
    return
  }
  if (remaining.length !== 1) return

  const survivor = remaining[0]
  const eliminatedCount = state.players.filter(player => player.eliminated).length
  const forfeitedCount = state.players.filter(player => player.forfeited).length
  const allOthersEliminated = eliminatedCount === state.players.length - 1
  const allOthersFinished = state.winners.length === state.players.length - 1
  const allOthersForfeited = forfeitedCount === state.players.length - 1

  if (state.mode === 'run_away' && allOthersEliminated) {
    survivor.won = true
    state.winner = survivor
    state.gameOver = true
    addLog(state, `${survivor.name} is the last player standing and wins the game!`)
  } else if (allOthersFinished || allOthersForfeited) {
    state.loser = survivor
    state.gameOver = true
    addLog(state, `${survivor.name} is the last player left and loses the game.`)
  }
}

function eliminatePlayer(state, player, message) {
  if (player.finished || player.eliminated) return false
  player.eliminated = true
  player.finished = true
  player.rank = null
  addLog(state, message || `${player.name} was eliminated and is now spectating.`)
  concludeIfOneRemains(state)
  return true
}

function movePlayer(state, player, destination) {
  const from = player.space
  const intended = Math.max(1, Math.min(100, destination))
  if (state.mode === 'run_away' && intended !== from) {
    const direction = intended > from ? 1 : -1
    for (let square = from + direction; direction > 0 ? square <= intended : square >= intended; square += direction) {
      if (state.destroyedSpaces.includes(square)) {
        player.space = square
        eliminatePlayer(state, player, `${player.name} traversed destroyed square ${square} and is now spectating.`)
        state.lastTraversalElimination = { playerId: player.id, playerName: player.name, from, intended, space: square }
        return square
      }
    }
  }
  player.space = intended
  return intended
}

function triggerExplosion(state) {
  state.lastExplosion = null
  if (state.mode !== 'run_away' || state.gameOver) return
  if (state.turn < state.nextExplosionTurn) return

  state.lastExplosion = { spaces: planRunAwayDestruction(state) }
  state.nextExplosionTurn = state.turn + randomInteger(3, 5)
}

export function destroySpace(state, space) {
  if (state.mode !== 'run_away' || space < 1 || space > 99 || state.destroyedSpaces.includes(space)) {
    return { space, players: [] }
  }
  state.destroyedSpaces.push(space)
  state.destroyedSpaces.sort((a, b) => a - b)
  addLog(state, `Square ${space} was destroyed.`)
  const caught = activePlayers(state).filter(player => player.space === space)
  for (const player of caught) {
    eliminatePlayer(state, player, `${player.name} was caught in the destruction on square ${space} and is now spectating.`)
  }
  if (!state.gameOver && (state.players[state.currentPlayerIndex].finished || state.players[state.currentPlayerIndex].eliminated)) {
    advanceTurn(state)
  }
  return { space, players: caught }
}

function chooseWhat(state, space) {
  const whats = state.board.whats
  if (!whats.length) return null
  const history = state.questionHistory[space] || []
  if (!state.questionHistory[space]) state.questionHistory[space] = history
  let eligible = whats
    .map((what, index) => ({ what, index }))
    .filter(({ what }) => {
      const start = what.spawn_locations?.start ?? 1
      const end = what.spawn_locations?.end ?? 100
      return space >= start && space <= end
    })
    .map(({ index }) => index)
  if (!eligible.length) return null

  let candidates = eligible.filter(index => !history.includes(index))

  if (!candidates.length) {
    const previous = history.at(-1)
    candidates = eligible.filter(index => index !== previous)
    if (!candidates.length) candidates = [eligible[0]]
    state.questionHistory[space] = []
  }

  const chosenIndex = candidates[Math.floor(Math.random() * candidates.length)]
  state.questionHistory[space].push(chosenIndex)
  return whats[chosenIndex]
}

function applyWhat(state, player, what) {
  const effect = what.effect
  if (effect.effect === 'move_back') movePlayer(state, player, player.space - (effect.spaces || 0))
  else if (effect.effect === 'move_forward') movePlayer(state, player, player.space + (effect.spaces || 0))
  else if (effect.effect === 'lose_turn') {
    player.skipTurns += effect.turns || 1
    player.skipReason = what.name
  }
  else if (effect.effect === 'lose_skill') player.skillBlockedTurns = Math.max(player.skillBlockedTurns, effect.spaces || effect.turns || 1)
}

function affectedDescription(description, playerName) {
  return description
    .replace(/\byour\b/gi, `${playerName}'s`)
    .replace(/\byou\b/gi, playerName)
}

function finishPlayer(state, player) {
  if (player.finished) return
  player.space = 100
  player.finished = true
  player.rank = state.winners.length + 1
  state.winners.push(player)
  addLog(state, `${player.name} reached 100 and finished #${player.rank}!`)

  concludeIfOneRemains(state)
}

function resolveLanding(state, player) {
  state.lastWhat = null
  state.lastQuestionChain = []
  let chainCount = 0

  while (state.board.question_marks.includes(player.space) && chainCount < 10) {
    const questionSpace = player.space
    if (player.skillArmed === 'ignore-question') {
      player.skillArmed = null
      addLog(state, `${player.name}'s Nope skill cancelled the question mark on space ${questionSpace}.`)
      break
    } else if (player.skillArmed === 'reroll-question') {
      player.skillArmed = null
      player.rerollPending = true
      state.lastQuestionChain.push({
        kind: 'reroll_pending',
        space: questionSpace,
        destination: questionSpace,
      })
      addLog(state, `${player.name}'s Rage Reroll is ready on space ${questionSpace}.`)
    } else {
      const what = chooseWhat(state, questionSpace)
      if (what) {
        state.lastWhat = { ...what, space: questionSpace }
        applyWhat(state, player, what)
        state.lastQuestionChain.push({
          kind: 'what',
          space: questionSpace,
          destination: player.space,
          what: { ...what },
        })
        addLog(state, `${player.name} found ${what.name} on space ${questionSpace}. ${affectedDescription(what.effect.description, player.name)}`)
      }
    }
    chainCount++
    if (player.eliminated) break
    if (player.space === questionSpace) break
  }

  const ladder = !player.eliminated && !player.rerollPending && state.board.ladders.find(item => item.from === player.space)
  if (ladder) {
    const start = player.space
    player.space = ladder.to
    addLog(state, `${player.name} climbed a ladder from ${start} to ${ladder.to}!`)
  }
  if (player.space >= 100) finishPlayer(state, player)
}

function advanceTurn(state) {
  if (state.gameOver) return
  let nextIndex = state.currentPlayerIndex
  do {
    nextIndex = (nextIndex + 1) % state.players.length
    if (nextIndex === 0) state.turn++
  } while (state.players[nextIndex].finished || state.players[nextIndex].eliminated)
  state.currentPlayerIndex = nextIndex
}

export function endTurnAfterSkill(state) {
  if (!state.gameOver) advanceTurn(state)
  triggerExplosion(state)
}

export function takeTurn(state, forcedRoll) {
  if (state.gameOver) return
  const player = state.players[state.currentPlayerIndex]
  state.lastTraversalElimination = null
  if (player.skipTurns > 0) {
    player.skipTurns--
    if (player.skillBlockedTurns > 0) player.skillBlockedTurns--
    state.lastRoll = null
    state.lastWhat = null
    state.lastQuestionChain = []
    addLog(state, `${player.name} cannot move due to ${player.skipReason || 'a what'}. ${player.skipTurns} skipped turn(s) remain.`)
    if (player.skipTurns === 0) player.skipReason = null
    advanceTurn(state)
    triggerExplosion(state)
    return
  }

  const roll = forcedRoll ?? Math.floor(Math.random() * 6) + 1
  player.rerollPending = false
  player.specialRollPending = false
  state.lastRoll = roll
  state.lastWhat = null
  state.lastQuestionChain = []
  const startSpace = player.space
  movePlayer(state, player, player.space + roll)
  if (state.mode === 'run_away' && roll < 0 && startSpace === 1 && player.space === 1) {
    addLog(state, `${player.name} rolled ${roll} and stays on Square 1.`)
  } else {
    const movementText = roll > 0
      ? `moved forward ${roll} space(s)`
      : roll < 0
        ? `moved backward ${Math.abs(roll)} space(s)`
        : 'stayed in place'
    addLog(state, `${player.name} rolled ${roll}, ${movementText}, and is on space ${player.space}.`)
  }
  if (!player.eliminated && roll !== 0) resolveLanding(state, player)
  if (player.skillBlockedTurns > 0) player.skillBlockedTurns--
  if (!state.gameOver && !player.rerollPending) advanceTurn(state)
  triggerExplosion(state)
}

export function takeParkourWhat(state, what) {
  if (state.gameOver || !what) return null
  const player = state.players[state.currentPlayerIndex]
  const from = player.space
  player.specialRollPending = false
  state.lastRoll = null
  state.lastWhat = { ...what, space: from }
  state.lastQuestionChain = []
  state.lastTraversalElimination = null
  applyWhat(state, player, what)
  const directDestination = player.space
  addLog(state, `${player.name}'s Parkour die landed on ${what.name}. ${affectedDescription(what.effect.description, player.name)}`)

  let questionChain = []
  let ladder = null
  if (directDestination !== from && !player.eliminated) {
    resolveLanding(state, player)
    questionChain = state.lastQuestionChain.map(item => ({
      ...item,
      what: item.what ? { ...item.what } : undefined,
    }))
    const afterQuestions = questionChain.at(-1)?.destination ?? directDestination
    const connectedLadder = state.board.ladders.find(item => item.from === afterQuestions)
    if (connectedLadder) ladder = { ...connectedLadder }
  }

  if (!state.gameOver) advanceTurn(state)
  triggerExplosion(state)
  return {
    player,
    what: { ...what },
    from,
    directDestination,
    questionChain,
    ladder,
  }
}

export function penalizeTurn(state) {
  if (state.gameOver) return null
  const player = state.players[state.currentPlayerIndex]
  const from = player.space
  let destination = from
  let cooldownAddedMs = 0
  if (state.mode === 'run_away') {
    cooldownAddedMs = 30_000
    player.skillCooldownUntil = Math.max(player.skillCooldownUntil, Date.now()) + cooldownAddedMs
  } else {
    destination = Math.max(1, from - 1)
    while (destination > 1 && state.board.question_marks.includes(destination)) destination--
    player.space = destination
  }
  player.rerollPending = false
  player.specialRollPending = false
  state.lastRoll = null
  state.lastWhat = null
  state.lastQuestionChain = []
  const message = state.mode === 'run_away'
    ? `${player.name} ran out of time, stayed on square ${from}, and gained 30 seconds of skill cooldown.`
    : `${player.name} ran out of time and was moved back from space ${from} to normal space ${destination}.`
  addLog(state, message)
  advanceTurn(state)
  triggerExplosion(state)
  return { player, from, destination, cooldownAddedMs, message }
}

export function forfeitPlayer(state, playerId) {
  if (state.gameOver) return null
  const player = state.players.find(item => item.id === playerId)
  if (!player || player.finished) return null
  const wasCurrent = state.players[state.currentPlayerIndex]?.id === playerId
  player.finished = true
  player.forfeited = true
  player.rank = null
  addLog(state, `${player.name} forfeited the game.`)

  const remaining = activePlayers(state)
  if (remaining.length <= 1) {
    concludeIfOneRemains(state)
  } else if (wasCurrent) {
    advanceTurn(state)
  }
  return player
}

function closestOpponent(state, player) {
  return activePlayers(state)
    .filter(other => other.id !== player.id && Math.abs(other.space - player.space) <= 10)
    .sort((a, b) => Math.abs(a.space - player.space) - Math.abs(b.space - player.space))[0]
}

function peekTarget(state, player, targetId) {
  const opponents = activePlayers(state)
    .filter(other => other.id !== player.id && Math.abs(other.space - player.space) <= 10)
    .sort((a, b) => Math.abs(a.space - player.space) - Math.abs(b.space - player.space))
  const closest = opponents[0]
  if (!closest || !targetId) return closest

  const selected = opponents.find(other => other.id === targetId)
  if (!selected || selected.space !== closest.space) return null
  return selected
}

export function activateSkill(state, now = Date.now(), targetId = null) {
  if (state.gameOver) return { ok: false, message: 'The game is over.' }
  const player = state.players[state.currentPlayerIndex]
  if (player.skillBlockedTurns > 0) return { ok: false, message: `Skill blocked for ${player.skillBlockedTurns} more turn(s).` }
  if (player.skillCooldownUntil > now) return { ok: false, message: 'Skill is still cooling down.' }

  const skill = player.specialSkill?.name
  const target = closestOpponent(state, player)
  let message
  let movement = null
  let landingResolution = null

  if (skill === 'Magnet') {
    if (!target) return { ok: false, message: 'No player is within 10 spaces.' }
    target.space = player.space
    message = `${player.name} used Magnet and pulled ${target.name} to space ${player.space}.`
  } else if (skill === 'Switcheroo') {
    if (!target) return { ok: false, message: 'No player is within 10 spaces.' }
    const targetSpace = target.space
    target.space = player.space
    player.space = targetSpace
    message = `${player.name} used Switcheroo and swapped spaces with ${target.name}.`
  } else if (skill === 'Intersect') {
    if (!target) return { ok: false, message: 'No player is within 10 spaces.' }
    if (Math.abs(target.space - player.space) === 1) {
      return { ok: false, message: 'Intersect cannot be used when the closest player is only 1 space away.' }
    }
    const middle = Math.round((player.space + target.space) / 2)
    player.space = middle
    target.space = middle
    message = `${player.name} used Intersect and pulled themselves and ${target.name} to space ${middle}.`
  } else if (skill === 'Peek-a-Boo') {
    const peekPlayer = peekTarget(state, player, targetId)
    if (!peekPlayer) return { ok: false, message: 'Choose a closest player within 10 spaces.' }
    const question = [...state.board.question_marks]
      .sort((a, b) => a - b)
      .find(space => space > peekPlayer.space && space - peekPlayer.space <= 10)
    if (!question) return { ok: false, message: 'No question mark is within 10 spaces of a player.' }
    movement = { playerId: peekPlayer.id, from: peekPlayer.space, to: question }
    peekPlayer.space = question
    resolveLanding(state, peekPlayer)
    const questionChain = state.lastQuestionChain.map(item => ({
      ...item,
      what: item.what ? { ...item.what } : undefined,
    }))
    const afterQuestions = questionChain.at(-1)?.destination ?? question
    const ladder = state.board.ladders.find(item => item.from === afterQuestions)
    landingResolution = {
      playerId: peekPlayer.id,
      playerName: peekPlayer.name,
      questionChain,
      ladder: ladder ? { ...ladder } : null,
    }
    message = `${player.name} used Peek-a-Boo on ${peekPlayer.name}, moving them to question space ${question}.`
  } else if (skill === 'Nope') {
    player.skillArmed = 'ignore-question'
    message = `${player.name} activated Nope. Their next question mark will be ignored.`
  } else if (skill === 'Rage Reroll') {
    player.skillArmed = 'reroll-question'
    message = `${player.name} armed Rage Reroll for their next question mark.`
  } else if (skill === 'Parkour') {
    player.specialRollPending = true
    message = `${player.name} used Parkour and is ready to roll a special 7–10 die.`
  } else {
    return { ok: false, message: 'This skill is not available.' }
  }

  player.skillCooldownUntil = now + SKILL_COOLDOWN_MS
  addLog(state, message)
  return {
    ok: true,
    message,
    movement,
    landingResolution,
    requiresRoll: skill === 'Parkour',
  }
}
