export const GUESS_WHAT_DIFFICULTY_WEIGHTS = Object.freeze({
  easy: 20,
  medium: 50,
  hard: 30,
})

export function chooseGuessWhatDifficulty(counts, random = Math.random) {
  const available = Object.entries(GUESS_WHAT_DIFFICULTY_WEIGHTS)
    .filter(([difficulty]) => Number(counts?.[difficulty]) > 0)

  if (!available.length) return null

  const totalWeight = available.reduce((sum, [, weight]) => sum + weight, 0)
  const randomValue = Math.min(Math.max(Number(random()) || 0, 0), 0.999999999999)
  let selection = randomValue * totalWeight

  for (const [difficulty, weight] of available) {
    if (selection < weight) return difficulty
    selection -= weight
  }

  return available.at(-1)[0]
}
