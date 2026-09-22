import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PikafishEngine } from "../src/engine.js";
import {
  RED,
  START_FEN,
  generateLegalMoves,
  moveToUci,
  parseFen,
  uciToMove,
} from "../src/xiangqi.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENGINE_PATH = path.join(
  ROOT,
  "engine",
  "Pikafish-Windows-x86-64-universal.exe",
);

test(
  "Pikafish returns a legal move with the configured search limit",
  { timeout: 45000 },
  async () => {
    const engine = new PikafishEngine(ENGINE_PATH, {
      workingDirectory: path.dirname(ENGINE_PATH),
    });
    try {
      await engine.initialize({
        threads: 4,
        hash: 128,
        multiPV: 1,
        moveOverhead: 20,
      });
      const result = await engine.go({
        startFen: START_FEN,
        moves: [],
        maxThinkMs: 1000,
      });
      assert.match(result.bestmove, /^[a-i][0-9][a-i][0-9]$/);
      const parsed = parseFen(START_FEN);
      const legalMoves = generateLegalMoves(parsed.board, RED);
      const engineMove = uciToMove(result.bestmove);
      assert.ok(
        legalMoves.some(
          (candidate) =>
            moveToUci(candidate) ===
            moveToUci({ from: engineMove.from, to: engineMove.to }),
        ),
      );
    } finally {
      await engine.quit();
    }
  },
);

test(
  "Pikafish can analyze continuously, stop, and search again",
  { timeout: 60000 },
  async () => {
    const engine = new PikafishEngine(ENGINE_PATH, {
      workingDirectory: path.dirname(ENGINE_PATH),
    });
    let infiniteBestmove = null;
    try {
      await engine.initialize({
        threads: 2,
        hash: 64,
        multiPV: 1,
        moveOverhead: 20,
      });
      const started = await engine.analyze({
        startFen: START_FEN,
        moves: [],
      });
      assert.equal(started.analysis, true);
      assert.equal(engine.searching, true);
      assert.equal(engine.searchMode, "infinite");

      engine.once("bestmove", (payload) => {
        if (payload.searchMode === "infinite") infiniteBestmove = payload;
      });
      await new Promise((resolve) => setTimeout(resolve, 350));
      const stopped = await engine.stop({ wait: true });
      assert.match(stopped.bestmove, /^[a-i][0-9][a-i][0-9]$/);
      assert.equal(engine.searching, false);
      assert.equal(infiniteBestmove?.searchMode, "infinite");

      const timed = await engine.go({
        startFen: START_FEN,
        moves: [stopped.bestmove],
        maxThinkMs: 500,
      });
      assert.match(timed.bestmove, /^[a-i][0-9][a-i][0-9]$/);
    } finally {
      await engine.quit();
    }
  },
);

test(
  "Pikafish can inherit a ponder search with ponderhit",
  { timeout: 60000 },
  async () => {
    const engine = new PikafishEngine(ENGINE_PATH, {
      workingDirectory: path.dirname(ENGINE_PATH),
    });
    try {
      await engine.initialize({
        threads: 2,
        hash: 64,
        multiPV: 1,
        moveOverhead: 20,
      });
      const started = await engine.startPonder({
        startFen: START_FEN,
        moves: [],
        budgetMs: 1200,
      });
      assert.equal(started.pondering, true);
      assert.equal(engine.searchMode, "ponder");

      await new Promise((resolve) => setTimeout(resolve, 250));
      const hit = await engine.ponderHit();
      assert.match(hit.bestmove, /^[a-i][0-9][a-i][0-9]$/);
      assert.equal(engine.searching, false);
      assert.equal(engine.searchMode, "idle");
    } finally {
      await engine.quit();
    }
  },
);
