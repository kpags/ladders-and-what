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
  let candidates = whats.map((_, index) => index).filter(index => !history.includes(index))

  if (!candidates.length) {
    const previous = history.at(-1)
    candidates = whats.map((_, index) => index).filter(index => index !== previous)
    if (!candidates.length) candidates = [0]
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
  if (state.board.question_marks.includes(player.space)) {
    const questionSpace = player.space
    if (player.skillArmed === 'ignore-question') {
      player.skillArmed = null
      addLog(state, `${player.name}'s Nope skill cancelled the question mark on space ${questionSpace}.`)
    } else if (player.skillArmed === 'reroll-question') {
      player.skillArmed = null
      const reroll = Math.floor(Math.random() * 6) + 1
      player.space = Math.min(100, player.space + reroll)
      state.lastRoll = reroll
      addLog(state, `${player.name}'s Rage Reroll rolled ${reroll} and escaped space ${questionSpace}!`)
    } else {
      const what = chooseWhat(state, questionSpace)
      if (what) {
        state.lastWhat = { ...what, space: questionSpace }
        applyWhat(player, what)
        addLog(state, `${player.name} found ${what.name} on space ${questionSpace}. ${affectedDescription(what.effect.description, player.name)}`)
      }
    }
  }

  const ladder = state.board.ladders.find(item => item.from === player.space)
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

export function takeTurn(state, forcedRoll) {
  if (state.gameOver) return
  const player = state.players[state.currentPlayerIndex]
  if (player.skipTurns > 0) {
    player.skipTurns--
    if (player.skillBlockedTurns > 0) player.skillBlockedTurns--
    state.lastRoll = null
    state.lastWhat = null
    addLog(state, `${player.name} cannot move due to ${player.skipReason || 'a what'}. ${player.skipTurns} skipped turn(s) remain.`)
    if (player.skipTurns === 0) player.skipReason = null
    advanceTurn(state)
    return
  }

  const roll = forcedRoll || Math.floor(Math.random() * 6) + 1
  state.lastRoll = roll
  player.space = Math.min(100, player.space + roll)
  addLog(state, `${player.name} rolled ${roll} and moved to space ${player.space}.`)
  resolveLanding(state, player)
  if (player.skillBlockedTurns > 0) player.skillBlockedTurns--
  advanceTurn(state)
}

export function penalizeTurn(state) {
  if (state.gameOver) return null
  const player = state.players[state.currentPlayerIndex]
  const from = player.space
  let destination = Math.max(1, from - 1)
  while (destination > 1 && state.board.question_marks.includes(destination)) destination--
  player.space = destination
  state.lastRoll = null
  state.lastWhat = null
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

export function activateSkill(state, now = Date.now()) {
  if (state.gameOver) return { ok: false, message: 'The game is over.' }
  const player = state.players[state.currentPlayerIndex]
  if (player.skillBlockedTurns > 0) return { ok: false, message: `Skill blocked for ${player.skillBlockedTurns} more turn(s).` }
  if (player.skillCooldownUntil > now) return { ok: false, message: 'Skill is still cooling down.' }

  const skill = player.specialSkill?.name
  const target = closestOpponent(state, player)
  let message

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
    const middle = Math.round((player.space + target.space) / 2)
    player.space = middle
    target.space = middle
    message = `${player.name} used Intersect. Both players meet on space ${middle}.`
  } else if (skill === 'Peek-a-Boo') {
    if (!target) return { ok: false, message: 'No player is within 10 spaces.' }
    const question = state.board.question_marks.find(space => space > target.space && space - target.space <= 10)
    if (!question) return { ok: false, message: 'No question mark is within 10 spaces of a player.' }
    target.space = question
    resolveLanding(state, target)
    message = `${player.name} used Peek-a-Boo on ${target.name}, moving them to question space ${question}.`
  } else if (skill === 'Nope') {
    player.skillArmed = 'ignore-question'
    message = `${player.name} activated Nope. Their next question mark will be ignored.`
  } else if (skill === 'Rage Reroll') {
    player.skillArmed = 'reroll-question'
    message = `${player.name} armed Rage Reroll for their next question mark.`
  } else {
    return { ok: false, message: 'This skill is not available.' }
  }

  player.skillCooldownUntil = now + SKILL_COOLDOWN_MS
  addLog(state, message)
  return { ok: true, message }
}
