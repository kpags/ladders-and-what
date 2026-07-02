export function createEscapeBriefingState(players) {
  return {
    active: true,
    humanIds: players.filter(player => !player.isAI).map(player => player.id),
    voters: new Set(),
  }
}

export function voteToCloseEscapeBriefing(state, playerId) {
  if (!state?.active || !state.humanIds.includes(playerId)) return false
  state.voters.add(playerId)
  state.active = !state.humanIds.length
    || !state.humanIds.every(id => state.voters.has(id))
  return true
}

export function syncEscapeBriefingPlayers(state, players) {
  if (!state?.active) return false
  state.humanIds = players.filter(player => !player.isAI).map(player => player.id)
  state.voters = new Set([...state.voters].filter(id => state.humanIds.includes(id)))
  state.active = !state.humanIds.length
    || !state.humanIds.every(id => state.voters.has(id))
  return !state.active
}

export function escapeBriefingView(state) {
  if (!state) return null
  return {
    active: state.active,
    voterIds: [...state.voters],
    total: state.humanIds.length,
  }
}
