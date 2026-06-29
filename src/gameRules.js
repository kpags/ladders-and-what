export const SKILL_COOLDOWN_MS = 120_000

export function createGameState(board, players, startedAt = Date.now()) {
  return {
    board,
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
      rank: null,
    })),
    currentPlayerIndex: 0,
    winners: [],
    loser: null,
    gameOver: false,
    turn: 1,
    lastRoll: null,
    lastWhat: null,
    lastQuestionChain: [],
    lastEvent: 'The race to 100 is ready to begin.',
    log: ['Game started. Reach 100—and do not be the last player left!'],
    questionHistory: {},
  }
}

function addLog(state, message) {
  state.lastEvent = message
  state.log.unshift(message)
  state.log = state.log.slice(0, 8)
}

function activePlayers(state) {
  return state.players.filter(player => !player.finished)
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

function applyWhat(player, what) {
  const effect = what.effect
  if (effect.effect === 'move_back') player.space = Math.max(1, player.space - (effect.spaces || 0))
  else if (effect.effect === 'move_forward') player.space = Math.min(100, player.space + (effect.spaces || 0))
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

  const remaining = activePlayers(state)
  if (remaining.length === 1) {
    state.loser = remaining[0]
    state.gameOver = true
    addLog(state, `${state.loser.name} is the last player left and loses the game.`)
  } else if (remaining.length === 0) {
    state.gameOver = true
  }
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
        applyWhat(player, what)
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
    if (player.space === questionSpace) break
  }

  const ladder = !player.rerollPending && state.board.ladders.find(item => item.from === player.space)
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
  } while (state.players[nextIndex].finished)
  state.currentPlayerIndex = nextIndex
}

export function endTurnAfterSkill(state) {
  if (!state.gameOver) advanceTurn(state)
}

export function takeTurn(state, forcedRoll) {
  if (state.gameOver) return
  const player = state.players[state.currentPlayerIndex]
  if (player.skipTurns > 0) {
    player.skipTurns--
    if (player.skillBlockedTurns > 0) player.skillBlockedTurns--
    state.lastRoll = null
    state.lastWhat = null
    state.lastQuestionChain = []
    addLog(state, `${player.name} cannot move due to ${player.skipReason || 'a what'}. ${player.skipTurns} skipped turn(s) remain.`)
    if (player.skipTurns === 0) player.skipReason = null
    advanceTurn(state)
    return
  }

  const roll = forcedRoll || Math.floor(Math.random() * 6) + 1
  player.rerollPending = false
  player.specialRollPending = false
  state.lastRoll = roll
  player.space = Math.min(100, player.space + roll)
  addLog(state, `${player.name} rolled ${roll} and moved to space ${player.space}.`)
  resolveLanding(state, player)
  if (player.skillBlockedTurns > 0) player.skillBlockedTurns--
  if (!player.rerollPending) advanceTurn(state)
}

export function takeParkourWhat(state, what) {
  if (state.gameOver || !what) return null
  const player = state.players[state.currentPlayerIndex]
  const from = player.space
  player.specialRollPending = false
  state.lastRoll = null
  state.lastWhat = { ...what, space: from }
  state.lastQuestionChain = []
  applyWhat(player, what)
  const directDestination = player.space
  addLog(state, `${player.name}'s Parkour die landed on ${what.name}. ${affectedDescription(what.effect.description, player.name)}`)

  let questionChain = []
  let ladder = null
  if (directDestination !== from) {
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
  let destination = Math.max(1, from - 1)
  while (destination > 1 && state.board.question_marks.includes(destination)) destination--
  player.space = destination
  player.rerollPending = false
  player.specialRollPending = false
  state.lastRoll = null
  state.lastWhat = null
  state.lastQuestionChain = []
  const message = `${player.name} ran out of time and was moved back from space ${from} to normal space ${destination}.`
  addLog(state, message)
  advanceTurn(state)
  return { player, from, destination, message }
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
    state.loser = remaining[0] || null
    state.gameOver = true
    if (state.loser) addLog(state, `${state.loser.name} is the last player left and loses the game.`)
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
