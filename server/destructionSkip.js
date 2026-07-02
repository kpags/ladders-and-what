export function createDestructionSkipState(players, token) {
  return {
    token,
    humanIds: players.filter(player => !player.isAI).map(player => player.id),
    voters: new Set(),
    requested: false,
  }
}

export function updateDestructionSkipVote(state, playerId, checked) {
  if (!state || state.requested || !state.humanIds.includes(playerId)) return false
  if (checked) state.voters.add(playerId)
  else state.voters.delete(playerId)
  state.requested = state.humanIds.length > 0
    && state.humanIds.every(id => state.voters.has(id))
  return true
}
