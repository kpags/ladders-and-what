const ALL_EMOJIS = ['😭', '😂', '😐', '😛', '😎']

function option(type, value) {
  return { type, value }
}

export function aiReactionOptions(self, outcome) {
  if (outcome === 'negative') {
    return self
      ? [option('emoji', '😐'), option('emoji', '😭')]
      : [...ALL_EMOJIS.map(emoji => option('emoji', emoji)), option('sound', 'laugh')]
  }
  if (outcome === 'positive' || outcome === 'ladder') {
    return self ? [] : [option('emoji', '😐'), option('sound', 'boo')]
  }
  if (outcome === 'finish') {
    return self
      ? [option('emoji', '😂'), option('emoji', '😎'), option('emoji', '😛'), option('sound', 'laugh')]
      : [option('sound', 'boo')]
  }
  return []
}

export function chooseAiReactions(players, actorId, outcome, rng = Math.random) {
  const reactions = []
  for (const player of players.filter(item => item.isAI && !item.eliminated)) {
    const options = aiReactionOptions(player.id === actorId, outcome)
    if (!options.length || rng() >= 0.5) continue
    reactions.push({
      playerId: player.id,
      ...options[Math.floor(rng() * options.length)],
    })
  }
  return reactions
}
