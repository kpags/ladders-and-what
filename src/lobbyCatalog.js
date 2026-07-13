export const UNAVAILABLE_BOARD_NAMES = new Set()

export function gameModeIsActive(mode) {
  return mode?.is_active === true
}

export function activeGameModes(gameModes) {
  return gameModes.filter(gameModeIsActive)
}

export function characterIsActive(character) {
  return character?.is_active === true
}

export function characterIndicesForMode(characters, modeKey) {
  return characters
    .map((character, index) => ({ character, index }))
    .filter(({ character }) => characterIsActive(character) && Array.isArray(character.modes) && character.modes.includes(modeKey))
    .map(({ index }) => index)
}

export function normalizeCharacterIndex(characters, modeKey, requestedIndex, fallbackOffset = 0) {
  const available = characterIndicesForMode(characters, modeKey)
  if (!available.length) return null

  const numericIndex = Number(requestedIndex)
  if (Number.isInteger(numericIndex) && available.includes(numericIndex)) return numericIndex
  return available[((fallbackOffset % available.length) + available.length) % available.length]
}

export function boardIsAvailable(board) {
  return Boolean(board) && !UNAVAILABLE_BOARD_NAMES.has(board.name)
}

export function boardIndicesForMode(boards, modeKey) {
  return boards
    .map((board, index) => ({ board, index }))
    .filter(({ board }) => board.type === modeKey && boardIsAvailable(board))
    .map(({ index }) => index)
}
