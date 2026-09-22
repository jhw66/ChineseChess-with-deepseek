import assert from "node:assert/strict";
import test from "node:test";
import {
  FREE_PLAY_RECORD_FORMAT,
  GAME_RECORD_FORMAT,
  createGameRecord,
  parseGameRecord,
  serializeGameRecord,
} from "../src/game-record.js";
import {
  BLACK,
  RED,
  START_FEN,
  applyMove,
  boardToFen,
  cloneBoard,
  parseFen,
  uciToMove,
} from "../src/xiangqi.js";
import { formatMoveNotation } from "../src/xiangqi-notation.js";

test("traditional notation uses readable red and black file numbers", () => {
  const parsed = parseFen(START_FEN);
  assert.equal(
    formatMoveNotation(parsed.board, uciToMove("h2e2")),
    "炮二平五",
  );
  assert.equal(
    formatMoveNotation(parsed.board, uciToMove("h9g7")),
    "马8进7",
  );
  assert.equal(
    formatMoveNotation(parsed.board, uciToMove("a6a5")),
    "卒1进1",
  );
});

test("traditional notation disambiguates pieces on the same file", () => {
  const parsed = parseFen("4k4/9/9/9/9/4R4/9/4R4/9/4K4 w - - 0 1");
  assert.equal(
    formatMoveNotation(parsed.board, uciToMove("e4e5")),
    "前车进一",
  );
  assert.equal(
    formatMoveNotation(parsed.board, uciToMove("e2e3")),
    "后车进一",
  );
});

test("TXT game records round-trip every move and its notation", () => {
  const record = createGameRecord({
    initialFen: START_FEN,
    humanSide: BLACK,
    moves: ["h2e2", "h9g7"],
    createdAt: "2026-09-19T00:00:00.000Z",
  });

  assert.equal(record.format, GAME_RECORD_FORMAT);
  assert.equal(record.moves.length, 2);
  assert.equal(record.moves[0].notation, "炮二平五");
  assert.equal(record.moves[1].side, BLACK);

  const text = serializeGameRecord(record);
  assert.match(text, /^中国象棋对局棋谱\r?\n/);
  assert.match(text, /1\. 红方 炮二平五 \(h2e2\)/);
  assert.match(text, /2\. 黑方 马8进7 \(h9g7\)/);

  const imported = parseGameRecord(text);
  assert.deepEqual(imported.moves, ["h2e2", "h9g7"]);
  assert.deepEqual(
    imported.moveRecords.map((move) => move.notation),
    ["炮二平五", "马8进7"],
  );
  assert.equal(imported.humanSide, BLACK);
  assert.equal(imported.finalFen, record.finalFen);
  assert.equal(imported.status, "playing");
});

test("game records support a custom starting turn", () => {
  const record = createGameRecord({
    initialFen: "4k4/9/9/4p4/9/9/9/9/9/4K4 b - - 0 1",
    moves: ["e6e5"],
  });
  const text = serializeGameRecord(record);
  assert.match(text, /1\. 黑方 卒5进1 \(e6e5\)/);
  assert.deepEqual(parseGameRecord(text).moves, ["e6e5"]);
});

test("TXT import repairs a stale result field written by older versions", () => {
  const record = createGameRecord({
    initialFen: "4k4/1N7/2N6/9/9/9/9/9/3R5/5K3 w - - 0 1",
    moves: ["d1d9"],
  });
  assert.equal(record.result, "red_win");

  const legacyText = serializeGameRecord(record).replace(
    "结果: red_win",
    "结果: playing",
  );
  const imported = parseGameRecord(legacyText);

  assert.equal(imported.status, "red_win");
  assert.equal(imported.resultReason, "绝杀");
  assert.equal(imported.recordedResult, "playing");
  assert.equal(imported.resultMismatch, true);
  assert.deepEqual(imported.moves, ["d1d9"]);
});

test("general record import accepts review JSON with startFen and chinese", () => {
  const payload = {
    version: 1,
    app: "中国象棋",
    startFen: "4k4/1N7/2N6/9/9/9/9/9/3R5/5K3 w - - 0 1",
    createdAt: "2026-09-22T00:00:00.000Z",
    moves: [{ uci: "d1d9", chinese: "车六进八" }],
  };

  const imported = parseGameRecord(JSON.stringify(payload));
  assert.equal(imported.initialFen, payload.startFen);
  assert.deepEqual(imported.moves, ["d1d9"]);
  assert.equal(imported.moveRecords[0].notation, "车六进八");
  assert.equal(imported.status, "red_win");
});

test("game records reject an illegal move", () => {
  assert.throws(
    () =>
      createGameRecord({
        initialFen: START_FEN,
        moves: ["h2e5"],
      }),
    /第 1 步不符合走棋规则/,
  );
});

test("TXT import rejects traditional notation that disagrees with coordinates", () => {
  const record = createGameRecord({
    initialFen: START_FEN,
    moves: ["h2e2", "h9g7"],
  });
  const tampered = serializeGameRecord(record).replace("炮二平五", "炮二进一");
  assert.throws(
    () => parseGameRecord(tampered),
    /第 1 步传统记谱与坐标不一致/,
  );
});

test("game records reject a tampered final position", () => {
  const record = createGameRecord({
    initialFen: START_FEN,
    moves: ["h2e2"],
  });
  record.finalFen = boardToFen(parseFen(START_FEN).board, RED);

  assert.throws(() => parseGameRecord(record), /最终局面与走法不一致/);
});

test("legacy JSON and XQ records remain importable", () => {
  const current = createGameRecord({
    initialFen: START_FEN,
    humanSide: BLACK,
    moves: ["h2e2", "h9g7"],
  });
  const legacy = JSON.stringify({
    format: "xiangqi-studio-record",
    version: 1,
    humanSide: "b",
    initialFen: START_FEN,
    finalFen: current.finalFen,
    moves: ["h2e2", "h9g7"],
  });

  const imported = parseGameRecord(legacy);
  assert.deepEqual(imported.moves, ["h2e2", "h9g7"]);
  assert.equal(imported.humanSide, BLACK);
  assert.equal(imported.finalFen, current.finalFen);
  assert.equal(imported.format, GAME_RECORD_FORMAT);
});

/**
 * 构造一份自由行棋 TXT 棋谱，用于校验同一方连走与手动行棋方能否精确还原。
 * 走法用 (红方/黑方, notation, uci) 描述，最终局面单独指定行棋方。
 */
function buildFreePlayText({ moves, finalTurn, result = "playing" }) {
  const parsed = parseFen(START_FEN);
  let board = cloneBoard(parsed.board);
  const lines = [];
  moves.forEach((entry, index) => {
    const move = uciToMove(entry.uci);
    const notation = formatMoveNotation(board, move);
    if (entry.notation && entry.notation !== notation) {
      throw new Error(`测试用例第 ${index + 1} 步记谱不一致`);
    }
    lines.push(
      `${index + 1}. ${entry.side === RED ? "红方" : "黑方"} ${notation} (${entry.uci})`,
    );
    board = applyMove(board, move);
  });

  return {
    board,
    text: [
      "中国象棋对局棋谱",
      `格式: ${FREE_PLAY_RECORD_FORMAT}`,
      "版本: 1",
      "保存时间: 2026-09-19T00:00:00.000Z",
      "对局模式: 自由行棋",
      `起始局面: ${START_FEN}`,
      `最终局面: ${boardToFen(board, finalTurn)}`,
      `结果: ${result}`,
      "结果说明: ",
      "",
      "[传统记谱]",
      ...lines,
      "",
      "[说明]",
      "自由行棋模式允许同一方连续走棋，记谱按实际落子顺序排列。",
      "传统记谱用于阅读，括号内坐标用于逐步精确还原。",
      "",
    ].join("\r\n"),
  };
}

test("free-play TXT records allow the same side to move twice", () => {
  const { board, text } = buildFreePlayText({
    moves: [
      { side: RED, uci: "h2e2", notation: "炮二平五" },
      { side: RED, uci: "b0c2", notation: "马八进七" },
    ],
    finalTurn: RED,
  });

  const record = parseGameRecord(text);
  assert.equal(record.freePlay, true);
  assert.equal(record.format, FREE_PLAY_RECORD_FORMAT);
  assert.deepEqual(record.moves, ["h2e2", "b0c2"]);
  assert.deepEqual(
    record.moveRecords.map((move) => move.side),
    [RED, RED],
  );
  assert.deepEqual(
    record.moveRecords.map((move) => move.notation),
    ["炮二平五", "马八进七"],
  );
  assert.equal(record.turn, RED);
  assert.equal(record.initialTurn, RED);
  assert.equal(record.finalFen, boardToFen(board, RED));
  assert.equal(record.status, "playing");

  // 逐步重放：每一步的行棋方都必须与记录一致。
  let replayBoard = cloneBoard(record.initialBoard);
  for (const moveRecord of record.moveRecords) {
    replayBoard = applyMove(replayBoard, uciToMove(moveRecord.uci));
  }
  assert.equal(boardToFen(replayBoard, record.turn), record.finalFen);
});

test("free-play TXT records keep a manually selected side to move", () => {
  // 黑方先走一手，但用户在界面上把行棋方切回红方后保存。
  const { board, text } = buildFreePlayText({
    moves: [{ side: BLACK, uci: "a6a5", notation: "卒1进1" }],
    finalTurn: RED,
  });

  const record = parseGameRecord(text);
  assert.equal(record.turn, RED, "行棋方应沿用棋谱里的最终局面");
  assert.equal(record.finalFen, boardToFen(board, RED));
  assert.equal(
    record.finalFen.split(" ")[1],
    "w",
    "最终局面应保留手动切换出的红方行棋",
  );
  assert.equal(record.moveRecords[0].side, BLACK);
});

test("free-play TXT import rejects a wrong side or notation", () => {
  const { text } = buildFreePlayText({
    moves: [
      { side: RED, uci: "h2e2", notation: "炮二平五" },
      { side: RED, uci: "b0c2", notation: "马八进七" },
    ],
    finalTurn: RED,
  });

  const wrongSide = text.replace("2. 红方 马八进七", "2. 黑方 马八进七");
  assert.throws(() => parseGameRecord(wrongSide), /第 2 步不符合走棋规则/);

  const wrongNotation = text.replace("2. 红方 马八进七", "2. 红方 马八进六");
  assert.throws(
    () => parseGameRecord(wrongNotation),
    /第 2 步传统记谱与坐标不一致/,
  );
});

test("free-play TXT import rejects a tampered final board", () => {
  const { board, text } = buildFreePlayText({
    moves: [{ side: RED, uci: "h2e2", notation: "炮二平五" }],
    finalTurn: RED,
  });
  const tampered = text.replace(
    `最终局面: ${boardToFen(board, RED)}`,
    `最终局面: ${START_FEN}`,
  );
  assert.throws(() => parseGameRecord(tampered), /最终局面与走法不一致/);
});
