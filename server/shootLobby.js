const SHOOT_TEAM_NAMES = {
  A: ['AlmostFree', 'CatchMeLoL', 'ImOuttaHere'],
  B: ['DoorDenied', 'StayInside', 'GotchaBro'],
}

export function shootPlayerName(player) {
  return SHOOT_TEAM_NAMES[player.team]?.[player.teamSlot] || `Team ${player.team} Player ${Number(player.teamSlot || 0) + 1}`
}

export function shootLobbyName(player) {
  return player.customName || player.shootName || shootPlayerName(player)
}

export function normalizeShootTeams(players) {
  const counts = () => ({ A: players.filter(player => player.team === 'A').length, B: players.filter(player => player.team === 'B').length })
  for (const player of players) {
    if (player.team === 'A' || player.team === 'B') continue
    const current = counts()
    player.team = current.A <= current.B ? 'A' : 'B'
  }
  for (const team of ['A', 'B']) {
    const used = new Set()
    const members = players.filter(player => player.team === team).sort((a, b) => (a.teamSlot ?? 99) - (b.teamSlot ?? 99))
    for (const player of members) {
      let slot = Number(player.teamSlot)
      if (!Number.isInteger(slot) || slot < 0 || used.has(slot)) {
        slot = 0
        while (used.has(slot)) slot++
      }
      player.teamSlot = slot
      used.add(slot)
    }
  }
  for (const player of players) {
    if (!player.shootName) player.shootName = shootPlayerName(player)
  }
}

export function assignShootTeam(players, playerId, team, slot) {
  const player = players.find(item => item.id === playerId)
  if (!player || !['A', 'B'].includes(team)) return false

  normalizeShootTeams(players)
  const sourceTeam = player.team
  const sourceSlot = player.teamSlot
  const targetSlot = Number(slot)
  const validSlot = Number.isInteger(targetSlot) && targetSlot >= 0 ? targetSlot : 0
  const displaced = players.find(item => item.id !== player.id && item.team === team && item.teamSlot === validSlot)
  player.team = team
  player.teamSlot = validSlot
  if (displaced) {
    displaced.team = sourceTeam
    displaced.teamSlot = sourceSlot
  }
  normalizeShootTeams(players)
  return true
}

export function shootAiNameTarget(room, clientId, playerId) {
  if (room.hostId !== clientId) return { error: 'Only the host can rename AI players.' }
  if (room.phase !== 'lobby' || room.modeKey !== 'shoot_the_what') return { error: 'AI names can only be changed in the Shoot the WHAT?! lobby.' }
  const player = room.players.find(item => item.id === playerId && item.isAI)
  return player ? { player } : { error: 'AI player was not found.' }
}
