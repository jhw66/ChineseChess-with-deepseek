function rotatePoint([row, col]) {
  return [9 - row, 8 - col];
}

export function boardPointToDisplay(point, flipped) {
  return flipped ? rotatePoint(point) : [point[0], point[1]];
}

export function displayPointToBoard(point, flipped) {
  return flipped ? rotatePoint(point) : [point[0], point[1]];
}
