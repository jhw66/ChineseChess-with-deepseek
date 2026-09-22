/**
 * 生成 tests/fixtures/review-game.json 的内置复盘样本。
 *
 * 用法：
 *   node tools/build-review-fixture.mjs          # 打印到标准输出
 *   node tools/build-review-fixture.mjs --write  # 覆盖写入 fixture 文件
 *
 * 样本固定为 12 手：第 8 手实战即引擎首选（好棋），第 12 手红方漏着。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  START_FEN,
  applyMove,
  boardToFen,
  cloneBoard,
  isLegalMove,
  opposite,
  parseFen,
  uciToMove,
} from "../src/xiangqi.js";
import { formatMoveNotation } from "../src/xiangqi-notation.js";

// 第一步先走 炮二平五，制造一个"黑方先行"的开局，使第 12 手落在红方。
const opening = ["h2e2"];
const continuation = [
  "h9g7",
  "h0g2",
  "i9h9",
  "i0h0",
  "g6g5",
  "h0h6",
  "b9c7",
  "h6g6",
  "a9b9",
  "g6g7",
  "b7b3",
  "g7g6",
];

// 基准分析：每手给出 bestInfo / afterInfo 两组分值，供单测注入假引擎。
// 第 8 手实战即引擎首选（好棋），第 12 手红方损失 420cp（严重漏着）。
const baseline = [
  { bestMove: "h9g7", bestScore: 30, afterBestMove: "h0g2", afterScore: -15 },
  { bestMove: "h0g2", bestScore: 25, afterBestMove: "i9h9", afterScore: -13 },
  { bestMove: "i9h9", bestScore: 20, afterBestMove: "i0h0", afterScore: -12 },
  { bestMove: "i0h0", bestScore: 15, afterBestMove: "g6g5", afterScore: 30 },
  { bestMove: "g6g5", bestScore: 10, afterBestMove: "h0h6", afterScore: 10 },
  { bestMove: "h0h5", bestScore: 40, afterBestMove: "b9c7", afterScore: 110 },
  { bestMove: "b9c7", bestScore: 35, afterBestMove: "h6g6", afterScore: -25 },
  { bestMove: "h6g6", bestScore: 5, afterBestMove: "a9b9", afterScore: -1 },
  { bestMove: "a9b9", bestScore: 20, afterBestMove: "g6g7", afterScore: 40 },
  { bestMove: "g6g8", bestScore: 60, afterBestMove: "b7b3", afterScore: 160 },
  { bestMove: "b7b3", bestScore: 45, afterBestMove: "g7g6", afterScore: -20 },
  { bestMove: "g7g5", bestScore: 80, afterBestMove: "c3c4", afterScore: 340 },
];

let board = cloneBoard(parseFen(START_FEN).board);
let turn = parseFen(START_FEN).turn;

for (const uci of opening) {
  const move = uciToMove(uci);
  if (!isLegalMove(board, turn, move)) {
    throw new Error(`开局着法不合法：${uci}`);
  }
  board = applyMove(board, move);
  turn = opposite(turn);
}

const startFen = boardToFen(board, turn);
const moves = [];
for (const uci of continuation) {
  const move = uciToMove(uci);
  if (!isLegalMove(board, turn, move)) {
    throw new Error(`着法不合法：${uci}（行棋方 ${turn}）`);
  }
  const chinese = formatMoveNotation(board, move);
  board = applyMove(board, move);
  turn = opposite(turn);
  moves.push({ uci, chinese, side: turn === "w" ? "b" : "w", fen: boardToFen(board, turn) });
}

const payload = JSON.stringify(
  {
    version: 1,
    app: "中国象棋",
    gameId: "fixture-review-12",
    createdAt: "2026-09-20T00:00:00.000Z",
    startFen,
    moves,
    baseline,
  },
  null,
  2,
);

if (process.argv.includes("--write")) {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const target = path.join(root, "tests", "fixtures", "review-game.json");
  fs.writeFileSync(target, `${payload}\n`, "utf8");
  process.stdout.write(`已写入 ${target}\n`);
} else {
  process.stdout.write(`${payload}\n`);
}
