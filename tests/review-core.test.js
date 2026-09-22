import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MOVE_GRADES,
  REVIEW_MOVETIME_MS,
  calculateMoveLoss,
  classifyMove,
  runReviewAnalysis,
  summarizeReview,
  toNumericScore,
} from "../src/review-core.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURE = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "tests", "fixtures", "review-game.json"),
    "utf8",
  ),
);

test("calculateMoveLoss adds both sides' raw scores without sign flipping", () => {
  // 红方行棋：走前引擎最优 +120（红方领先），实战走后黑方视角 +80（黑方反先）。
  // 红方相当于从 +120 掉到 -80，损失 200 = 120 + 80。
  assert.equal(calculateMoveLoss({ type: "cp", value: 120 }, { type: "cp", value: 80 }), 200);
  // 红方走前 +120，走后黑方视角 +20（黑方仍占优）-> 红方损失 140。
  assert.equal(calculateMoveLoss({ type: "cp", value: 120 }, { type: "cp", value: 20 }), 140);

  // 黑方行棋：走前 -60（黑方落后 60），走后红方视角 +40（即黑方 -40）。
  // 黑方由 -60 变成 -40，实际赚了 20，故 loss = -20（负数代表比基准更好）。
  assert.equal(calculateMoveLoss({ type: "cp", value: -60 }, { type: "cp", value: 40 }), -20);
  // 黑方走前 -60，走后红方视角 -30（黑方反超 30）-> 黑方大赚，loss 更负。
  assert.equal(calculateMoveLoss({ type: "cp", value: -60 }, { type: "cp", value: -30 }), -90);

  // 公式是纯相加，调用处不得取反：-10 + 10 恰好抵消。
  assert.equal(
    calculateMoveLoss({ type: "cp", value: -10 }, { type: "cp", value: 10 }),
    0,
  );
  // 支持裸数字；涉及 mate 或分值缺失时必须返回 null，绝不能用 0 伪造"没有损失"。
  assert.equal(calculateMoveLoss(50, 25), 75);
  assert.equal(calculateMoveLoss(null, undefined), null);
  assert.equal(calculateMoveLoss(undefined, 30), null);
  assert.equal(
    calculateMoveLoss({ type: "mate", value: 3 }, { type: "cp", value: 0 }),
    null,
  );
  assert.equal(
    calculateMoveLoss({ type: "cp", value: 10 }, { type: "mate", value: -2 }),
    null,
  );
});

test("toNumericScore keeps mate scores far away from centipawn scores", () => {
  const normal = toNumericScore({ type: "cp", value: 900 });
  const mateIn3 = toNumericScore({ type: "mate", value: 3 });
  const gettingMatedIn3 = toNumericScore({ type: "mate", value: -3 });
  assert.ok(mateIn3 > normal, "有杀的分值必须高于任何普通分值");
  assert.ok(gettingMatedIn3 < -normal, "被杀的分值必须低于任何普通分值");
  assert.ok(
    toNumericScore({ type: "mate", value: 2 }) >
      toNumericScore({ type: "mate", value: 9 }),
    "步数更短的杀棋应更高",
  );
});

test("classifyMove maps loss thresholds to the four grades", () => {
  const best = { bestmove: "h2e2", score: { type: "cp", value: 30 } };
  const after = (value) => ({ bestmove: "h9g7", score: { type: "cp", value: value } });

  assert.equal(classifyMove(0, best, after(-30), "h2e2", "h0g2").grade, MOVE_GRADES.GOOD);
  assert.equal(classifyMove(29, best, after(0), "a0a1", "h0g2").grade, MOVE_GRADES.GOOD);
  assert.equal(classifyMove(30, best, after(0), "a0a1", "h0g2").grade, MOVE_GRADES.NEUTRAL);
  assert.equal(classifyMove(99, best, after(0), "a0a1", "h0g2").grade, MOVE_GRADES.NEUTRAL);
  assert.equal(
    classifyMove(100, best, after(0), "a0a1", "h0g2").grade,
    MOVE_GRADES.INACCURACY,
  );
  assert.equal(
    classifyMove(299, best, after(0), "a0a1", "h0g2").grade,
    MOVE_GRADES.INACCURACY,
  );
  assert.equal(
    classifyMove(300, best, after(0), "a0a1", "h0g2").grade,
    MOVE_GRADES.BLUNDER,
  );

  // 实战与引擎首选一致，无论分值多少都算好棋。
  assert.equal(
    classifyMove(500, best, after(0), "h2e2", "h2e2").grade,
    MOVE_GRADES.GOOD,
  );
});

test("classifyMove separates a missed mate from an already-lost position", () => {
  const mateThree = { bestmove: "h2e2", score: { type: "mate", value: 3 }, depth: 20 };
  const quietAfter = { bestmove: "h9g7", score: { type: "cp", value: 40 } };

  // 走子方本来有 3 步杀，却走了别的：直接判严重漏着，不看 cp 差。
  const missed = classifyMove(5, mateThree, quietAfter, "a0a1", "h2e2");
  assert.equal(missed.grade, MOVE_GRADES.BLUNDER);
  assert.equal(missed.label, "严重漏着");
  assert.equal(missed.reason, "missed-mate");
});

test("classifyMove never blames the engine best move for an existing mate", () => {
  // 走子前就已经是被杀局面：怎么走都算不上一手漏着，避免同一盘败局反复记录。
  const alreadyLost = classifyMove(
    5,
    { bestmove: "h2e2", score: { type: "mate", value: -4 } },
    { bestmove: "h9g7", score: { type: "cp", value: 40 } },
    "a0a1",
    "h2e2",
  );
  assert.equal(alreadyLost.grade, MOVE_GRADES.NEUTRAL);
  assert.equal(alreadyLost.reason, "already-lost");

  // 实战就是引擎首选：永远先判好棋；对方仍有杀只是"局面危险"提示（danger），
  // 真正的错误发生在更早的着法上，不该记在这一手。
  const bestButDanger = classifyMove(
    0,
    { bestmove: "h2e2", score: { type: "cp", value: 10 } },
    { bestmove: "h9g7", score: { type: "mate", value: 2 } },
    "h2e2",
    "h2e2",
  );
  assert.equal(bestButDanger.grade, MOVE_GRADES.GOOD);
  assert.equal(bestButDanger.reason, "best");
  assert.equal(bestButDanger.danger, "opponent-mate");

  // 不是引擎首选、走后被对方形成杀棋：这才是真正的严重漏着。
  const allowedMate = classifyMove(
    0,
    { bestmove: "h2e2", score: { type: "cp", value: 10 } },
    { bestmove: "h9g7", score: { type: "mate", value: 2 } },
    "a0a1",
    "h2e2",
  );
  assert.equal(allowedMate.grade, MOVE_GRADES.BLUNDER);
  assert.equal(allowedMate.reason, "allowed-mate");
});

test("classifyMove treats a mate delivered by the actual move as loss-free", () => {
  const result = classifyMove(
    400,
    { bestmove: "h2e2", score: { type: "cp", value: 20 } },
    { bestmove: "(none)", score: null },
    "c0c1",
    "h2e2",
  );
  assert.equal(result.grade, MOVE_GRADES.GOOD);
  assert.equal(result.loss, 0);
  assert.equal(result.reason, "terminal");
});

test("runReviewAnalysis grades the bundled fixture deterministically", async () => {
  const progress = [];
  const seen = [];
  let callIndex = 0;
  const analyze = async ({ movetimeMs, phase, positionFen }) => {
    const entry = FIXTURE.baseline[Math.floor(callIndex / 2)];
    const isBest = callIndex % 2 === 0;
    callIndex += 1;
    seen.push({ phase, movetimeMs, positionFen });
    return isBest
      ? { bestmove: entry.bestMove, score: { type: "cp", value: entry.bestScore }, depth: 18 }
      : {
          bestmove: entry.afterBestMove,
          score: { type: "cp", value: entry.afterScore },
          depth: 18,
        };
  };

  const outcome = await runReviewAnalysis({
    startFen: FIXTURE.startFen,
    moves: FIXTURE.moves.map((move) => move.uci),
    movetimeMs: REVIEW_MOVETIME_MS,
    analyze,
    onProgress: ({ ply, total, phase }) => progress.push({ ply, total, phase }),
  });

  assert.equal(outcome.cancelled, false);
  assert.equal(outcome.completed, 12);
  assert.equal(outcome.total, 12);
  assert.equal(callIndex, 24, "每一手必须恰好两次分析");
  assert.ok(seen.every((call) => call.movetimeMs === 3000));
  assert.equal(progress.length, 24);
  assert.deepEqual(progress[0], { ply: 1, total: 12, phase: "best" });
  assert.deepEqual(progress.at(-1), { ply: 12, total: 12, phase: "after" });

  const byPly = new Map(outcome.results.map((item) => [item.ply, item]));
  const eighth = byPly.get(8);
  assert.equal(eighth.uci, "h6g6");
  assert.equal(eighth.bestMove, "h6g6");
  assert.equal(eighth.side, "w");
  assert.equal(eighth.grade, MOVE_GRADES.GOOD, "第 8 手实战即最优解，应为好棋");

  const twelfth = byPly.get(12);
  assert.equal(twelfth.uci, "g7g6");
  assert.equal(twelfth.side, "w", "第 12 手必须是红方");
  assert.ok(twelfth.loss >= 300);
  assert.equal(twelfth.grade, MOVE_GRADES.BLUNDER, "第 12 手应为严重漏着");
  assert.equal(twelfth.chinese, "车三退一");
  assert.equal(twelfth.bestChinese, "车三退二");

  const summary = summarizeReview(outcome.results);
  // 第 4、9 手虽然损失超过 30，但实战与引擎首选一致，按契约仍算好棋，
  // 因此基准里没有中立着法。第 6、10 手为轻微失误，第 12 手为严重漏着。
  assert.deepEqual(summary, {
    total: 12,
    good: 9,
    neutral: 0,
    inaccuracy: 2,
    blunder: 1,
  });

  // 复盘记录必须携带可还原的 FEN 与中文记谱。
  for (const record of outcome.results) {
    assert.match(record.fenBefore, /^[rnbakcpRNBAKCP1-9/]+ [wb] /);
    assert.ok(record.chinese.length > 0);
  }
});

test("runReviewAnalysis stops between analyses when cancelled", async () => {
  let calls = 0;
  let cancelled = false;
  const analyze = async () => {
    calls += 1;
    if (calls === 3) cancelled = true;
    return { bestmove: "h9g7", score: { type: "cp", value: 0 } };
  };

  const outcome = await runReviewAnalysis({
    startFen: FIXTURE.startFen,
    moves: FIXTURE.moves.map((move) => move.uci),
    analyze,
    isCancelled: () => cancelled,
  });

  assert.equal(outcome.cancelled, true);
  assert.equal(calls, 3, "取消后不得再发起新的分析");
  assert.ok(outcome.completed < 12);
});
