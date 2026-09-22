import test from "node:test";
import assert from "node:assert/strict";
import {
  MISTAKE_STATUS,
  addMistakes,
  createMistakeRecord,
  createMemoryStorage,
  evaluateTrainingAnswer,
  extractMistakesFromReview,
  judgeTrainingAnswer,
  loadMistakeBook,
  loadTrainingStats,
  markMistakeMastered,
  masteredToday,
  mergeMistakes,
  pickTrainingQuestion,
  recordTrainingAttempt,
  removeMistake,
  trainingAccuracy,
} from "../src/mistake-book.js";
import { MOVE_GRADES } from "../src/review-core.js";

function reviewResults() {
  return [
    {
      ply: 1,
      side: "w",
      fenBefore: "fen-1 w - - 0 1",
      uci: "h2e2",
      chinese: "炮二平五",
      bestMove: "h2e2",
      bestChinese: "炮二平五",
      bestScore: { type: "cp", value: 20 },
      loss: 0,
      grade: MOVE_GRADES.GOOD,
    },
    {
      ply: 12,
      side: "w",
      fenBefore: "fen-12 w - - 0 1",
      uci: "g7g6",
      chinese: "车三退一",
      bestMove: "g7g5",
      bestChinese: "车三退二",
      bestScore: { type: "cp", value: 80 },
      loss: 420,
      grade: MOVE_GRADES.BLUNDER,
    },
    {
      ply: 13,
      side: "b",
      fenBefore: "fen-13 b - - 0 1",
      uci: "c3c4",
      chinese: "兵七进一",
      bestMove: "",
      bestChinese: "",
      bestScore: null,
      loss: 400,
      grade: MOVE_GRADES.BLUNDER,
    },
  ];
}

test("extractMistakesFromReview keeps only blunders that have a best move", () => {
  const mistakes = extractMistakesFromReview({
    gameId: "fixture-review-12",
    startFen: "start-fen b - - 0 1",
    results: reviewResults(),
  });
  assert.equal(mistakes.length, 1);
  const [entry] = mistakes;
  assert.equal(entry.fen, "fen-12 w - - 0 1");
  assert.equal(entry.sideToMove, "w");
  assert.equal(entry.actualMove.uci, "g7g6");
  assert.equal(entry.actualMove.chinese, "车三退一");
  assert.equal(entry.bestMove.uci, "g7g5");
  assert.equal(entry.bestMove.chinese, "车三退二");
  assert.equal(entry.bestScoreCp, 80);
  assert.equal(entry.lossCp, 420);
  assert.equal(entry.status, MISTAKE_STATUS.UNKNOWN);
  assert.equal(entry.source, "review-fixture-review-12-move-12");
  assert.equal(entry.startFen, "start-fen b - - 0 1");
  assert.equal(entry.ply, 12);
  assert.ok(typeof entry.id === "string" && entry.id.startsWith("xq-"));
});

test("a mastered mistake is never reset back to 未掌握", () => {
  const storage = createMemoryStorage();
  const mistakes = extractMistakesFromReview({
    gameId: "g1",
    results: reviewResults(),
  });
  const first = addMistakes(storage, mistakes);
  assert.equal(first.added, 1);
  const id = first.list[0].id;

  markMistakeMastered(storage, id, "2026-09-20T00:00:00.000Z");
  assert.equal(loadMistakeBook(storage)[0].status, MISTAKE_STATUS.MASTERED);

  // 同一题再次从复盘里提取出来，状态必须保持「已掌握」，记录也不能丢。
  const second = addMistakes(storage, mistakes);
  assert.equal(second.added, 0);
  assert.equal(second.list.length, 1, "已掌握记录必须保留");
  assert.equal(second.list[0].status, MISTAKE_STATUS.MASTERED);
  assert.equal(second.list[0].createdAt, first.list[0].createdAt);
  assert.ok(second.list[0].updatedAt >= first.list[0].createdAt);

  // loss 只在变大时更新，不会因为重复导入而缩小。
  const { list } = mergeMistakes(second.list, [
    { ...mistakes[0], lossCp: 100 },
  ]);
  assert.equal(list[0].lossCp, 420);
});

test("training only draws questions that are still 未掌握", () => {
  const storage = createMemoryStorage();
  const { list } = addMistakes(
    storage,
    extractMistakesFromReview({ gameId: "g1", results: reviewResults() }),
  );
  assert.equal(pickTrainingQuestion(list).id, list[0].id);

  markMistakeMastered(storage, list[0].id);
  assert.equal(pickTrainingQuestion(loadMistakeBook(storage)), null);
});

test("playing the stored best move passes with zero engine calls", async () => {
  const storage = createMemoryStorage();
  const { list } = addMistakes(
    storage,
    extractMistakesFromReview({ gameId: "g1", results: reviewResults() }),
  );
  const record = list[0];

  let engineCalls = 0;
  const outcome = await evaluateTrainingAnswer({
    record,
    uci: record.bestMove.uci,
    requestAfterScore: async () => {
      engineCalls += 1;
      return { type: "cp", value: 0 };
    },
  });

  assert.equal(engineCalls, 0, "走出最优解时不得向引擎发出任何 go 指令");
  assert.equal(outcome.passed, true);
  assert.equal(outcome.engineUsed, false);
  assert.equal(outcome.reason, "best-move");
  assert.equal(loadMistakeBook(storage)[0].status, MISTAKE_STATUS.UNKNOWN);
});

test("a wrong training answer is scored with the shared loss formula", async () => {
  const storage = createMemoryStorage();
  const { list } = addMistakes(
    storage,
    extractMistakesFromReview({ gameId: "g1", results: reviewResults() }),
  );
  const record = list[0];

  // bestScoreCp = 80，走后新行棋方视角 +300 -> loss = 380，超过 30 判不通过。
  const wrong = await evaluateTrainingAnswer({
    record,
    uci: "g7g6",
    requestAfterScore: async () => ({ type: "cp", value: 300 }),
  });
  assert.equal(wrong.passed, false);
  assert.equal(wrong.engineUsed, true);
  assert.equal(wrong.loss, 380);
  assert.equal(loadMistakeBook(storage)[0].status, MISTAKE_STATUS.UNKNOWN);

  // loss < 30 时即使不是存储的最优解也算通过（等价着法）。
  const equivalent = await evaluateTrainingAnswer({
    record,
    uci: "g7g4",
    requestAfterScore: async () => ({ type: "cp", value: -60 }),
  });
  assert.equal(equivalent.loss, 20);
  assert.equal(equivalent.passed, true);
  assert.equal(equivalent.reason, "loss-within-limit");
});

test("training statistics track attempts, accuracy and mastered-today", () => {
  const storage = createMemoryStorage();
  assert.deepEqual(loadTrainingStats(storage), {
    attempts: 0,
    passed: 0,
    masteredByDay: {},
  });

  recordTrainingAttempt(storage, {
    passed: false,
    now: new Date("2026-09-21T10:00:00"),
  });
  recordTrainingAttempt(storage, {
    passed: true,
    mastered: true,
    now: new Date("2026-09-21T10:05:00"),
  });
  const stats = loadTrainingStats(storage);
  assert.equal(stats.attempts, 2);
  assert.equal(stats.passed, 1);
  assert.equal(trainingAccuracy(stats), 0.5);
  assert.equal(masteredToday(stats, new Date("2026-09-21T23:00:00")), 1);
  assert.equal(masteredToday(stats, new Date("2026-09-22T00:00:00")), 0);
});

test("a mistake can be removed explicitly but mastery keeps the record", () => {
  const storage = createMemoryStorage();
  const { list } = addMistakes(
    storage,
    extractMistakesFromReview({ gameId: "g1", results: reviewResults() }),
  );
  markMistakeMastered(storage, list[0].id);
  assert.equal(loadMistakeBook(storage).length, 1);
  removeMistake(storage, list[0].id);
  assert.equal(loadMistakeBook(storage).length, 0);
});

test("the mistake book survives a corrupt storage payload", () => {
  const storage = createMemoryStorage();
  storage.setItem("xiangqi.review.mistakes.v1", "{not json");
  assert.deepEqual(loadMistakeBook(storage), []);
  storage.setItem("xiangqi.review.mistakes.v1", JSON.stringify({ a: 1 }));
  assert.deepEqual(loadMistakeBook(storage), []);
});

test("a mate blunder keeps lossCp null instead of faking a zero loss", () => {
  // 复盘算 mate 相关的漏着时 loss 是 null：记录里绝不能写成 0。
  const mateBlunder = createMistakeRecord({
    fen: "mate-fen w - - 0 1",
    sideToMove: "w",
    actualMove: { uci: "a0a1", chinese: "帅五进一" },
    bestMove: { uci: "h2e2", chinese: "炮二平五" },
    bestScore: { type: "mate", value: 3 },
    loss: null,
    source: "review-mate-move-9",
  });
  assert.equal(mateBlunder.lossCp, null, "mate 损失必须保持 null");
  assert.notEqual(mateBlunder.lossCp, 0, "绝不能把 null 折成 0");
  assert.equal(mateBlunder.bestScore.type, "mate");
  assert.ok(
    mateBlunder.severityCp > 10000,
    "mate 损失用 severityCp 参与排序，且远高于普通损失",
  );

  // 合并同一题时也不能用 0 覆盖 null 语义。
  const { list } = mergeMistakes([mateBlunder], [mateBlunder]);
  assert.equal(list[0].lossCp, null);
  assert.ok(list[0].severityCp > 10000);
});

test("training a mate puzzle cannot pass through a cp threshold", async () => {
  const mateRecord = createMistakeRecord({
    fen: "mate-fen w - - 0 1",
    sideToMove: "w",
    actualMove: { uci: "a0a1", chinese: "帅五进一" },
    bestMove: { uci: "h2e2", chinese: "炮二平五" },
    bestScore: { type: "mate", value: 3 },
    loss: null,
    source: "review-mate-move-9",
  });

  // 走出存储的最优解：零引擎开销直接通过。
  const best = await evaluateTrainingAnswer({
    record: mateRecord,
    uci: "h2e2",
    requestAfterScore: async () => {
      throw new Error("走出最优解时不应请求引擎");
    },
  });
  assert.equal(best.passed, true);
  assert.equal(best.engineUsed, false);

  // 走错：即使走后引擎给出 -100（看似"大赚"），mate 局面也不能按 cp 阈值通过。
  const judged = judgeTrainingAnswer(mateRecord, { type: "cp", value: -100 });
  assert.equal(judged.loss, null);
  assert.equal(judged.passed, false);
});

test("training falls back to bestScoreCp when a legacy record has no bestScore", () => {
  const legacy = {
    bestMove: { uci: "h2e2" },
    bestScoreCp: 80,
    lossCp: 420,
  };
  // bestScoreCp = 80，走后新行棋方视角 +300 -> loss = 380，不通过。
  assert.deepEqual(judgeTrainingAnswer(legacy, { type: "cp", value: 300 }), {
    loss: 380,
    passed: false,
  });
  // 走后新行棋方视角 -60 -> loss = 20，等价着法算通过。
  assert.deepEqual(judgeTrainingAnswer(legacy, { type: "cp", value: -60 }), {
    loss: 20,
    passed: true,
  });
});
