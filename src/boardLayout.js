const ATLANTIC_COLUMNS = [6, 16.6, 26.4, 35.9, 45.3, 54.7, 64.1, 73.5, 83.1, 93.7]
const ATLANTIC_ROWS = [95.3, 86.8, 77.4, 67.6, 57.7, 47.5, 37.2, 26.8, 16.4, 5.9]
const GHOST_TOWN_COLUMNS = [8.41, 19.14, 28.67, 38.12, 47.53, 56.94, 66.27, 75.56, 84.93, 93.62]
const GHOST_TOWN_ROWS = [92.94, 83.81, 75.04, 66.07, 56.66, 47.09, 37.36, 27.51, 17.58, 7.58]
const QUIET_MANSION_SIZE = 1254
const QUIET_MANSION_X_BOUNDS = [
  [11, 129, 250, 374, 499, 622, 746, 869, 990, 1114, 1242],
  [11, 139, 252, 376, 502, 624, 744, 864, 983, 1108, 1242],
  [11, 132, 254, 372, 499, 620, 740, 865, 988, 1118, 1241],
  [11, 128, 254, 381, 508, 625, 752, 870, 994, 1119, 1242],
  [11, 124, 248, 374, 502, 630, 751, 870, 986, 1114, 1242],
  [11, 136, 266, 386, 515, 634, 754, 876, 994, 1110, 1242],
  [11, 136, 268, 389, 510, 636, 754, 876, 996, 1116, 1242],
  [11, 146, 262, 388, 516, 636, 754, 874, 991, 1116, 1242],
  [11, 154, 274, 394, 512, 634, 756, 876, 994, 1112, 1242],
  [9, 177, 296, 408, 525, 638, 754, 875, 990, 1119, 1244],
]
const QUIET_MANSION_Y_BOUNDS = [
  [1156, 1244], [1060, 1156], [945, 1060], [822, 945], [698, 822],
  [566, 698], [433, 566], [296, 433], [158, 296], [7, 158],
]

function quietMansionPercent(value) {
  return `${Number((value / QUIET_MANSION_SIZE * 100).toFixed(3))}%`
}

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
  if (quietMansion) {
    const xBounds = QUIET_MANSION_X_BOUNDS[row]
    const yBounds = QUIET_MANSION_Y_BOUNDS[row]
    return {
      left: quietMansionPercent((xBounds[column] + xBounds[column + 1]) / 2),
      top: quietMansionPercent((yBounds[0] + yBounds[1]) / 2),
    }
  }
  if (runAway) return { left: `${5 + column * 10}%`, top: `${95 - row * 10}%` }
  if (space === 100) return { left: `${volcano ? 11.1 : 8.8}%`, top: `${volcano ? 9 : 8.8}%` }
  return {
    left: `${volcano ? 11.1 + column * 8.65 : 9 + column * 9.2}%`,
    top: `${volcano ? 86 - row * 8.56 : 90.5 - row * 9.15}%`,
  }
}

export function getBoardSpaceBounds(board, space) {
  if (board?.name !== 'Quiet Mansion') return null
  const row = Math.floor((space - 1) / 10)
  const positionInRow = (space - 1) % 10
  const column = row % 2 === 0 ? positionInRow : 9 - positionInRow
  const xBounds = QUIET_MANSION_X_BOUNDS[row]
  const yBounds = QUIET_MANSION_Y_BOUNDS[row]
  return {
    x: quietMansionPercent(xBounds[column]),
    y: quietMansionPercent(yBounds[0]),
    width: quietMansionPercent(xBounds[column + 1] - xBounds[column]),
    height: quietMansionPercent(yBounds[1] - yBounds[0]),
  }
}
