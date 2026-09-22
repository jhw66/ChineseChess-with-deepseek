import { BLACK, RED, boardToFen } from "./xiangqi.js";

/**
 * 自由行棋与识图纠错共用的局面工具。
 *
 * 这些函数不依赖 DOM 或引擎，可以在浏览器和 Node 单测里复用。
 */

const PIECE_TOKENS = new Set([
  "K",
  "A",
  "B",
  "N",
  "R",
  "C",
  "P",
  "k",
  "a",
  "b",
  "n",
  "r",
  "c",
  "p",
]);

const EMPTY_TOKENS = new Set([
  "",
  ".",
  "0",
  "-",
  "_",
  "null",
  "none",
  "empty",
  "空",
  "空位",
]);

export function normalizeTurn(value, fallback = RED) {
  if (value === BLACK || value === "B" || value === "black" || value === "黑") {
    return BLACK;
  }
  if (value === RED || value === "W" || value === "red" || value === "红") {
    return RED;
  }
  return fallback;
}

/**
 * 生成发送给引擎的 position 参数。
 *
 * 普通模式沿用"起始局面 + 完整走法序列"，让引擎保留连续行棋历史。
 * 自由行棋模式下改走"自由快照"：直接使用当前 FEN、走法列表清空，
 * 引擎会把当前局面当成一盘全新的棋重新分析，行棋方完全由 UI 状态决定。
 */
export function enginePositionForState({
  freePlay = false,
  board,
  turn,
  playStartFen,
  moveHistory = [],
} = {}) {
  if (freePlay) {
    return { startFen: boardToFen(board, turn), moves: [] };
  }
  return {
    startFen: playStartFen,
    moves: Array.isArray(moveHistory) ? moveHistory.slice() : [],
    freePlay: false,
  };
}

export function normalizeVisionToken(token) {
  if (typeof token !== "string") return ".";
  const value = token.trim();
  if (EMPTY_TOKENS.has(value.toLowerCase())) return ".";
  if (value.length === 1 && PIECE_TOKENS.has(value)) return value;
  return ".";
}

/**
 * 把视觉模型返回的 10×9 矩阵统一成 board[row][col] 字符数组。
 */
export function normalizeVisionMatrix(matrix) {
  if (!Array.isArray(matrix) || matrix.length !== 10) {
    throw new Error("识图矩阵必须正好 10 行。");
  }
  return matrix.map((rawRow, rowIndex) => {
    const cells = Array.isArray(rawRow)
      ? rawRow
      : typeof rawRow === "string"
        ? rawRow.split("")
        : null;
    if (!cells || cells.length !== 9) {
      throw new Error(`识图矩阵第 ${rowIndex + 1} 行必须正好 9 格。`);
    }
    return cells.map(normalizeVisionToken);
  });
}

export function visionMatrixToFen(matrix, turn = RED) {
  const rows = normalizeVisionMatrix(matrix);
  return boardToFen(rows, normalizeTurn(turn, RED));
}

function isPalaceCell(row, col, side) {
  if (col < 3 || col > 5) return false;
  return side === RED ? row >= 7 && row <= 9 : row >= 0 && row <= 2;
}

/**
 * 对识图矩阵做启发式自检，供纠错面板高亮可疑格子。
 *
 * 返回 { flagged, messages }：flagged 是需要用户重点核对的 [row, col] 列表，
 * messages 是给用户看的中文提示。
 */
export function assessVisionMatrix(matrix) {
  const rows = normalizeVisionMatrix(matrix);
  const messages = [];
  const flagged = new Map();
  const flag = (row, col, reason) => {
    const key = `${row},${col}`;
    if (!flagged.has(key)) flagged.set(key, { row, col, reason });
  };

  const generals = { K: [], k: [] };
  const counts = { red: 0, black: 0 };
  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const piece = rows[row][col];
      if (piece === ".") continue;
      if (piece === "K" || piece === "k") generals[piece].push([row, col]);
      if (piece === piece.toUpperCase()) counts.red += 1;
      else counts.black += 1;
    }
  }

  if (generals.K.length !== 1) {
    messages.push(
      generals.K.length === 0 ? "没有识别到红方帅。" : "红方帅出现多枚。",
    );
    for (const [row, col] of generals.K) flag(row, col, "红方帅位置异常");
  } else if (!isPalaceCell(generals.K[0][0], generals.K[0][1], RED)) {
    messages.push("红方帅不在九宫内。");
    flag(generals.K[0][0], generals.K[0][1], "红方帅不在九宫");
  }

  if (generals.k.length !== 1) {
    messages.push(
      generals.k.length === 0 ? "没有识别到黑方将。" : "黑方将出现多枚。",
    );
    for (const [row, col] of generals.k) flag(row, col, "黑方将位置异常");
  } else if (!isPalaceCell(generals.k[0][0], generals.k[0][1], BLACK)) {
    messages.push("黑方将不在九宫内。");
    flag(generals.k[0][0], generals.k[0][1], "黑方将不在九宫");
  }

  if (counts.red > 16) messages.push("红方棋子数量明显偏多，请核对。");
  if (counts.black > 16) messages.push("黑方棋子数量明显偏多，请核对。");

  return {
    flagged: [...flagged.values()],
    messages,
    counts,
  };
}

export function setFenSideToMove(fen, side) {
  if (typeof fen !== "string") throw new Error("FEN 必须是字符串。");
  const fields = fen.trim().split(/\s+/);
  if (fields.length !== 6) throw new Error("FEN 必须是 6 个字段。");
  fields[1] = normalizeTurn(side, RED) === BLACK ? "b" : "w";
  fields[4] = "0";
  fields[5] = "1";
  return fields.join(" ");
}
