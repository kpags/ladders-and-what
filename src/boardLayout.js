const ATLANTIC_COLUMNS = [6, 16.6, 26.4, 35.9, 45.3, 54.7, 64.1, 73.5, 83.1, 93.7]
const ATLANTIC_ROWS = [95.3, 86.8, 77.4, 67.6, 57.7, 47.5, 37.2, 26.8, 16.4, 5.9]
const GHOST_TOWN_COLUMNS = [8.41, 19.14, 28.67, 38.12, 47.53, 56.94, 66.27, 75.56, 84.93, 93.62]
const GHOST_TOWN_ROWS = [92.94, 83.81, 75.04, 66.07, 56.66, 47.09, 37.36, 27.51, 17.58, 7.58]
const HORIZON_COLUMNS = [5.98, 15.87, 25.68, 35.41, 45.18, 54.98, 64.75, 74.48, 84.21, 93.94]
const HORIZON_ROWS = [93.62, 84.69, 74.2, 64.63, 54.98, 45.22, 35.49, 25.72, 16.03, 6.1]
const REMINISCING_COLUMNS = [6.17, 16.447, 26.406, 36.035, 45.574, 55.084, 64.514, 73.943, 83.612, 93.69]
const REMINISCING_ROWS = [93.8, 84.151, 74.86, 65.331, 55.722, 46.043, 36.254, 26.406, 16.417, 6.16]
const THROWBACK_PH_COLUMNS = [8.054, 18.321, 27.632, 36.762, 45.694, 54.665, 63.676, 72.747, 81.878, 91.946]
const THROWBACK_PH_ROWS = [92.963, 83.991, 74.801, 65.311, 55.781, 46.212, 36.663, 27.093, 17.464, 7.337]
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
const DEAD_FOREST_X_BOUNDS = [47, 171, 284, 400, 516, 631, 746, 861, 976, 1092, 1208]
const DEAD_FOREST_Y_BOUNDS = [
  [1118, 1205], [1009, 1118], [897, 1009], [779, 897], [659, 779],
  [539, 659], [418, 539], [294, 418], [174, 294], [47, 174],
]

function quietMansionPercent(value) {
  return `${Number((value / QUIET_MANSION_SIZE * 100).toFixed(3))}%`
}

export function getBoardSpacePosition(board, space) {
  const volcano = board?.name === 'Volcano'
  const atlantic = board?.name === 'Atlantic'
  const ghostTown = board?.name === 'Ghost Town'
  const horizon = ['Horizon', 'Mathemagician'].includes(board?.name)
  const reminiscing = board?.name === 'Reminiscing'
  const throwbackPh = board?.name === 'Throwback PH'
  const quietMansion = board?.name === 'Quiet Mansion'
  const deadForest = board?.name === 'Dead Forest'
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
  if (horizon) {
    return {
      left: `${HORIZON_COLUMNS[column]}%`,
      top: `${HORIZON_ROWS[row]}%`,
    }
  }
  if (reminiscing) {
    return {
      left: `${REMINISCING_COLUMNS[column]}%`,
      top: `${REMINISCING_ROWS[row]}%`,
    }
  }
  if (throwbackPh) {
    return {
      left: `${THROWBACK_PH_COLUMNS[column]}%`,
      top: `${THROWBACK_PH_ROWS[row]}%`,
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
  if (deadForest) {
    const yBounds = DEAD_FOREST_Y_BOUNDS[row]
    return {
      left: quietMansionPercent((DEAD_FOREST_X_BOUNDS[column] + DEAD_FOREST_X_BOUNDS[column + 1]) / 2),
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
  if (!['Quiet Mansion', 'Dead Forest'].includes(board?.name)) return null
  const row = Math.floor((space - 1) / 10)
  const positionInRow = (space - 1) % 10
  const column = row % 2 === 0 ? positionInRow : 9 - positionInRow
  const xBounds = board.name === 'Dead Forest' ? DEAD_FOREST_X_BOUNDS : QUIET_MANSION_X_BOUNDS[row]
  const yBounds = board.name === 'Dead Forest' ? DEAD_FOREST_Y_BOUNDS[row] : QUIET_MANSION_Y_BOUNDS[row]
  if (board.name === 'Dead Forest') {
    const x = xBounds[column] / QUIET_MANSION_SIZE * 100
    const y = yBounds[0] / QUIET_MANSION_SIZE * 100
    const width = (xBounds[column + 1] - xBounds[column]) / QUIET_MANSION_SIZE * 100
    const height = (yBounds[1] - yBounds[0]) / QUIET_MANSION_SIZE * 100
    const size = Math.min(width, height)
    return {
      x: `${Number((x + (width - size) / 2).toFixed(3))}%`,
      y: `${Number((y + (height - size) / 2).toFixed(3))}%`,
      width: `${Number(size.toFixed(3))}%`,
      height: `${Number(size.toFixed(3))}%`,
    }
  }
  return {
    x: quietMansionPercent(xBounds[column]),
    y: quietMansionPercent(yBounds[0]),
    width: quietMansionPercent(xBounds[column + 1] - xBounds[column]),
    height: quietMansionPercent(yBounds[1] - yBounds[0]),
  }
}

export function getVisualSurroundingSpaces(space) {
  const row = Math.floor((space - 1) / 10)
  const position = (space - 1) % 10
  const column = row % 2 === 0 ? position : 9 - position
  const result = []
  for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
    for (let columnOffset = -1; columnOffset <= 1; columnOffset++) {
      if (!rowOffset && !columnOffset) continue
      const nextRow = row + rowOffset
      const nextColumn = column + columnOffset
      if (nextRow < 0 || nextRow > 9 || nextColumn < 0 || nextColumn > 9) continue
      const nextPosition = nextRow % 2 === 0 ? nextColumn : 9 - nextColumn
      result.push(nextRow * 10 + nextPosition + 1)
    }
  }
  return result
}
