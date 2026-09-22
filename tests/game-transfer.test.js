import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GAME_EXPORT_VERSION,
  chineseToUci,
  createGameExport,
  parseCoordinateToken,
  parseGameTransfer,
  parseNotationText,
  replayGame,
  serializeGameExport,
} from "../src/game-transfer.js";
import { createGameRecord, serializeGameRecord } from "../src/game-record.js";
import { RED, START_FEN, cloneBoard, parseFen } from "../src/xiangqi.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURE = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "tests", "fixtures", "review-game.json"),
    "utf8",
  ),
);
const FIXTURE_MOVES = FIXTURE.moves.map((move) => move.uci);

test("export and import round-trips the whole FEN sequence", () => {
  const exported = createGameExport({
    startFen: FIXTURE.startFen,
    moves: FIXTURE_MOVES,
    createdAt: "2026-09-20T00:00:00.000Z",
  });
  assert.equal(exported.version, GAME_EXPORT_VERSION);
  assert.equal(exported.startFen, FIXTURE.startFen);
  assert.equal(exported.moves.length, FIXTURE_MOVES.length);
  assert.deepEqual(
    exported.moves.map((move) => move.uci),
    FIXTURE_MOVES,
  );
  for (const move of exported.moves) {
    assert.ok(move.chinese.length > 0, "导出必须包含传统记谱");
    assert.match(move.fen, /^[rnbakcpRNBAKCP1-9/]+ [wb] /);
  }

  const reloaded = parseGameTransfer(serializeGameExport(exported));
  assert.deepEqual(reloaded.moves, FIXTURE_MOVES);
  assert.equal(reloaded.startFen, FIXTURE.startFen);

  const originalFens = replayGame({
    startFen: FIXTURE.startFen,
    moves: FIXTURE_MOVES,
  }).records.map((record) => record.fen);
  const importedFens = replayGame({
    startFen: reloaded.startFen,
    moves: reloaded.moves,
  }).records.map((record) => record.fen);
  assert.deepEqual(importedFens, originalFens, "导入重放必须还原每一步 FEN");
});

test("the bundled fixture imports through the JSON dialect", () => {
  const imported = parseGameTransfer(JSON.stringify(FIXTURE));
  assert.deepEqual(imported.moves, FIXTURE_MOVES);
  assert.equal(
    imported.finalFen,
    replayGame({ startFen: FIXTURE.startFen, moves: FIXTURE_MOVES }).finalFen,
  );
  assert.equal(imported.records[11].chinese, "车三退一");
});

test("a JSON entry whose Chinese notation disagrees is rejected", () => {
  const broken = {
    version: 1,
    startFen: FIXTURE.startFen,
    moves: [
      { uci: "h9g7", chinese: "车三退一" },
      ...FIXTURE_MOVES.slice(1),
    ],
  };
  assert.throws(
    () => parseGameTransfer(JSON.stringify(broken)),
    /第 1 手非法/,
  );
});

test("parseCoordinateToken understands UCI, ICCS and dashed coordinates", () => {
  assert.equal(parseCoordinateToken("h2e2"), "h2e2");
  assert.equal(parseCoordinateToken("H2E2"), "h2e2");
  assert.equal(parseCoordinateToken("H2-E2"), "h2e2");
  assert.equal(parseCoordinateToken("h2-e2"), "h2e2");
  assert.equal(parseCoordinateToken("H2\u2013E2"), "h2e2");
  assert.equal(parseCoordinateToken("炮二平五"), "");
  assert.equal(parseCoordinateToken(""), "");
});

test("PGN import accepts UCI, ICCS and Chinese notation in one list", () => {
  const iccs = parseNotationText("H2E2 H9G7");
  assert.deepEqual(iccs.moves, ["h2e2", "h9g7"]);

  const dashed = parseNotationText("H2-E2 H9-G7");
  assert.deepEqual(dashed.moves, ["h2e2", "h9g7"]);

  const chinese = parseNotationText(
    "1. 炮二平五 马8进7 2. 马二进三 车9平8",
  );
  assert.deepEqual(chinese.moves, ["h2e2", "h9g7", "h0g2", "i9h9"]);
  assert.equal(chinese.startFen, START_FEN);

  // 记谱方言按 UCI > ICCS > 中文 的顺序混合解析。
  const mixed = parseNotationText("h2e2 马8进7 H0-G2 i9h9");
  assert.deepEqual(mixed.moves, ["h2e2", "h9g7", "h0g2", "i9h9"]);
});

test("PGN import reports the offending ply instead of failing silently", () => {
  // 无法解析的记谱。
  assert.throws(() => parseNotationText("h2e2 zz9z9"), /第 2 手非法/);
  // 可以解析成坐标，但不是合法着法。
  assert.throws(() => parseNotationText("h2e2 h2e3"), /第 2 手非法/);
  // 中文记谱在这一步不存在对应的合法着法。
  assert.throws(() => parseNotationText("h2e2 车三退一"), /第 2 手非法/);
  assert.throws(() => parseNotationText("   "), /没有可识别的走法/);
});

test("Chinese notation resolves 前 / 中 / 后 for three pieces on one file", () => {
  const fen = "3k5/9/9/4p4/9/R8/R8/R8/9/4K4 w - - 0 1";
  const board = cloneBoard(parseFen(fen).board);

  assert.equal(chineseToUci(board, RED, "前车进一"), "a4a5");
  assert.equal(chineseToUci(board, RED, "中车平四"), "a3f3");
  assert.equal(chineseToUci(board, RED, "后车退一"), "a2a1");

  // 同一纵线上只有一枚棋子时，用纵线数字记谱。
  const single = cloneBoard(parseFen(START_FEN).board);
  assert.equal(chineseToUci(single, RED, "炮二平五"), "h2e2");
  assert.equal(chineseToUci(single, RED, "马二进三"), "h0g2");

  // 与实际局面不符的记谱必须返回 null，交给上层报「第 N 手非法」。
  assert.equal(chineseToUci(board, RED, "车四平五"), null);
});

test("replay rejects an illegal ply with its number", () => {
  assert.throws(
    () => replayGame({ startFen: START_FEN, moves: ["h2e2", "h2e2"] }),
    /第 2 手非法/,
  );
  assert.throws(
    () => replayGame({ startFen: START_FEN, moves: ["h2e2", "zz"] }),
    /第 2 手非法/,
  );
});

test("plain notation text is promoted into the JSON transfer shape", () => {
  const imported = parseGameTransfer("1. 炮二平五 马8进7");
  assert.equal(imported.version, GAME_EXPORT_VERSION);
  assert.equal(imported.startFen, START_FEN);
  assert.deepEqual(imported.moves, ["h2e2", "h9g7"]);
});

test("studio TXT records import into the review transfer path", () => {
  const record = createGameRecord({
    initialFen: START_FEN,
    moves: ["h2e2", "h9g7"],
  });
  const imported = parseGameTransfer(serializeGameRecord(record));

  assert.equal(imported.startFen, START_FEN);
  assert.deepEqual(imported.moves, ["h2e2", "h9g7"]);
  assert.equal(imported.records[0].chinese, "炮二平五");
});
