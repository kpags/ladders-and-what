const ATLANTIC_COLUMNS = [6, 16.6, 26.4, 35.9, 45.3, 54.7, 64.1, 73.5, 83.1, 93.7]
const ATLANTIC_ROWS = [95.3, 86.8, 77.4, 67.6, 57.7, 47.5, 37.2, 26.8, 16.4, 5.9]
const GHOST_TOWN_COLUMNS = [8.41, 19.14, 28.67, 38.12, 47.53, 56.94, 66.27, 75.56, 84.93, 93.62]
const GHOST_TOWN_ROWS = [92.94, 83.81, 75.04, 66.07, 56.66, 47.09, 37.36, 27.51, 17.58, 7.58]

export function getBoardSpacePosition(board, space) {
  const volcano = board?.name === 'Volcano'
  const atlantic = board?.name === 'Atlantic'
  const ghostTown = board?.name === 'Ghost Town'
  const quietMansion = board?.name === 'Quiet Mansion'
  const runAway = board?.type === 'run_away'
  const row = Math.floor((space - 1) / 10)
  const positionInRow = (space - 1) % 10
  const column = row % 2 === 0 ? positionInRow : 9 - positionInRow

  if (atlantic) {
    return {
      left: `${ATLANTIC_COLUMNS[column]}%`,
      top: `${ATLANTIC_ROWS[row]}%`,
    }
  }
  if (ghostTown) {
    return {
      left: `${GHOST_TOWN_COLUMNS[column]}%`,
      top: `${GHOST_TOWN_ROWS[row]}%`,
    }
  }
  if (quietMansion) return { left: `${5 + column * 10}%`, top: `${95 - row * 10}%` }
  if (runAway) return { left: `${5 + column * 10}%`, top: `${95 - row * 10}%` }
  if (space === 100) return { left: `${volcano ? 11.1 : 8.8}%`, top: `${volcano ? 9 : 8.8}%` }
  return {
    left: `${volcano ? 11.1 + column * 8.65 : 9 + column * 9.2}%`,
    top: `${volcano ? 86 - row * 8.56 : 90.5 - row * 9.15}%`,
  }
}
