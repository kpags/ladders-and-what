export function createGameState(board, players) {
  return {
    board,
    players: players.map((player, index) => ({
      ...player,
      id: `${player.isAI ? 'ai' : 'player'}-${index}`,
      space: 1,
      skipTurns: 0,
      skillBlockedTurns: 0,
    })),
    currentPlayerIndex: 0,
    winner: null,
    turn: 1,
    lastRoll: null,
    lastWhat: null,
    lastEvent: 'The race to 100 is ready to begin.',
    log: ['Game started. First one to 100 wins!'],
    questionHistory: {},
  }
}

function addLog(state, message) {
  state.lastEvent = message
  state.log.unshift(message)
  state.log = state.log.slice(0, 8)
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

function applyWhat(state, player, what) {
  for (const effect of what.effects || []) {
    if (effect.effect === 'move_back') {
      player.space = Math.max(1, player.space - (effect.spaces || 0))
    } else if (effect.effect === 'move_forward') {
      player.space = Math.min(100, player.space + (effect.spaces || 0))
    } else if (effect.effect === 'lose_turn') {
      player.skipTurns += effect.turns || 1
    } else if (effect.effect === 'lose_skill') {
      player.skillBlockedTurns = Math.max(player.skillBlockedTurns, effect.spaces || effect.turns || 1)
    }
  }
}

function resolveLanding(state, player) {
  state.lastWhat = null

  if (state.board.question_marks.includes(player.space)) {
    const questionSpace = player.space
    const what = chooseWhat(state, questionSpace)
    if (what) {
      state.lastWhat = { ...what, space: questionSpace }
      applyWhat(state, player, what)
      addLog(state, `${player.name} found ${what.name} on space ${questionSpace}. ${what.effects.map(effect => effect.description).join(' ')}`)
    }
  }

  const ladder = state.board.ladders.find(item => item.from === player.space)
  if (ladder) {
    const start = player.space
    player.space = ladder.to
    addLog(state, `${player.name} climbed a ladder from ${start} to ${ladder.to}!`)
  }

  if (player.space >= 100) {
    player.space = 100
    state.winner = player
    addLog(state, `${player.name} reached space 100 and wins!`)
  }
}

function advanceTurn(state) {
  if (state.winner) return
  state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length
  if (state.currentPlayerIndex === 0) state.turn++
}

export function takeTurn(state, forcedRoll) {
  if (state.winner) return

  const player = state.players[state.currentPlayerIndex]

  if (player.skipTurns > 0) {
    player.skipTurns--
    if (player.skillBlockedTurns > 0) player.skillBlockedTurns--
    state.lastRoll = null
    state.lastWhat = null
    addLog(state, `${player.name} is stuck and loses this turn. ${player.skipTurns} skipped turn(s) remain.`)
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
