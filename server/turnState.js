export function canStartRoll(room, requesterId, automatic = false, continuingSequence = false) {
  if (room.phase !== 'playing' || room.game.gameOver || room.rolling) return false
  if (room.busy && !continuingSequence) return false

  const current = room.game.players[room.game.currentPlayerIndex]
  if (!current) return false
  if (automatic) return Boolean(current.isAI)
  return current.id === requesterId
}

export function unlockRoomForNextTurn(room) {
  room.currentEvent = null
  room.rolling = null
  room.turnDeadline = null
  room.busy = false
}
