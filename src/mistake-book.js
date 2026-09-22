import { MOVE_GRADES, calculateMoveLoss, toNumericScore } from "./review-core.js";

/**
 * 错题本与专项训练的数据结构 / 存储。
 *
 * 所有读写函数都通过一个 storage 适配器工作，浏览器里传 localStorage，
 * 单测里传 createMemoryStorage()，逻辑完全一致。
 */

export const MISTAKE_STORAGE_KEY = "xiangqi.review.mistakes.v1";
export const TRAINING_STATS_KEY = "xiangqi.review.trainingStats.v1";
export const MISTAKE_STATUS = {
  UNKNOWN: "未掌握",
  MASTERED: "已掌握",
};

export function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

function djb2(text) {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

export function mistakeId({ fen, actualMove, bestMove, source }) {
  const actual = typeof actualMove === "string" ? actualMove : actualMove?.uci;
  const best = typeof bestMove === "string" ? bestMove : bestMove?.uci;
  return `xq-${djb2(`${fen}|${actual}|${best}|${source}`)}`;
}

export function todayKey(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 把任意输入折成"有限数字或 null"，绝不用 Number(null) 把缺失折成 0。 */
function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * 仅供排序用的严重程度。mate 之类的非 cp 损失不写回 lossCp，
 * 而是用 toNumericScore 折成一个远离普通分值的大数，避免污染真实损失统计。
 */
function mistakeSeverity(entry) {
  if (!entry) return 0;
  let best = 0;
  for (const value of [
    entry.severityCp,
    entry.lossCp,
    Math.abs(toNumericScore(entry.bestScore)),
  ]) {
    const numeric = finiteOrNull(value);
    if (numeric !== null) best = Math.max(best, Math.abs(numeric));
  }
  return best;
}

/** 合并同一道错题的 cp 损失：两边都缺失时保持 null，不再用 0 顶替。 */
function maxLossCp(a, b) {
  const left = finiteOrNull(a);
  const right = finiteOrNull(b);
  if (left === null && right === null) return null;
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

export function createMistakeRecord({
  fen,
  sideToMove,
  actualMove,
  bestMove,
  bestScore,
  loss,
  source,
  startFen = "",
  ply = null,
  now = new Date().toISOString(),
} = {}) {
  if (!fen) throw new Error("错题记录缺少局面 FEN。");
  const actualUci =
    typeof actualMove === "string" ? actualMove : actualMove?.uci ?? "";
  const bestUci = typeof bestMove === "string" ? bestMove : bestMove?.uci ?? "";
  if (!actualUci || !bestUci) {
    throw new Error("错题记录缺少实战着法或最优着法。");
  }
  // loss 只有是有限数字时才落库；mate（loss 为 null）必须保持 null，
  // 否则 Number(null) === 0 会把"被将死"伪造成"零损失"，污染错题排序与训练判定。
  const numericLoss = finiteOrNull(loss);
  return {
    id: mistakeId({ fen, actualMove: actualUci, bestMove: bestUci, source }),
    fen,
    sideToMove: sideToMove === "b" ? "b" : "w",
    actualMove: {
      uci: actualUci,
      chinese:
        typeof actualMove === "object" ? actualMove?.chinese ?? "" : "",
    },
    bestMove: {
      uci: bestUci,
      chinese: typeof bestMove === "object" ? bestMove?.chinese ?? "" : "",
    },
    bestScoreCp: toNumericScore(bestScore),
    bestScore: bestScore ?? null,
    lossCp: numericLoss === null ? null : Math.max(0, numericLoss),
    severityCp:
      numericLoss === null
        ? Math.abs(toNumericScore(bestScore))
        : Math.max(0, numericLoss),
    status: MISTAKE_STATUS.UNKNOWN,
    source: source || "review",
    startFen: startFen || "",
    ply: ply ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 复盘结束后提取所有【严重漏着】局面。
 */
export function extractMistakesFromReview({
  gameId = "",
  startFen = "",
  results = [],
} = {}) {
  const mistakes = [];
  for (const record of results) {
    if (record.grade !== MOVE_GRADES.BLUNDER) continue;
    if (!record.bestMove) continue;
    mistakes.push(
      createMistakeRecord({
        fen: record.fenBefore,
        sideToMove: record.side,
        actualMove: { uci: record.uci, chinese: record.chinese },
        bestMove: { uci: record.bestMove, chinese: record.bestChinese },
        bestScore: record.bestScore,
        loss: record.loss,
        source: `review-${gameId || "local"}-move-${record.ply}`,
        startFen,
        ply: record.ply,
      }),
    );
  }
  return mistakes;
}

export function loadMistakeBook(storage) {
  if (!storage) return [];
  try {
    const raw = storage.getItem(MISTAKE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        typeof entry.id === "string" &&
        typeof entry.fen === "string",
    );
  } catch {
    return [];
  }
}

export function saveMistakeBook(storage, list) {
  if (!storage) return;
  try {
    storage.setItem(MISTAKE_STORAGE_KEY, JSON.stringify(list ?? []));
  } catch {
    // 存储不可用时静默降级，内存中的列表仍然可用。
  }
}

/**
 * 合并错题：按 id 去重，已掌握的记录不会被新记录重置为未掌握。
 */
export function mergeMistakes(existing, incoming, now = new Date().toISOString()) {
  const map = new Map();
  for (const entry of existing ?? []) map.set(entry.id, entry);
  let added = 0;
  for (const entry of incoming ?? []) {
    const current = map.get(entry.id);
    if (!current) {
      map.set(entry.id, entry);
      added += 1;
      continue;
    }
    map.set(entry.id, {
      ...current,
      bestScoreCp: entry.bestScoreCp,
      bestScore:
        entry.bestScore !== undefined && entry.bestScore !== null
          ? entry.bestScore
          : current.bestScore ?? null,
      lossCp: maxLossCp(current.lossCp, entry.lossCp),
      severityCp: Math.max(mistakeSeverity(current), mistakeSeverity(entry)),
      updatedAt: now,
    });
  }
  return { list: [...map.values()], added };
}

export function addMistakes(storage, incoming) {
  const existing = loadMistakeBook(storage);
  const { list, added } = mergeMistakes(existing, incoming);
  saveMistakeBook(storage, list);
  return { list, added };
}

export function updateMistakeStatus(storage, id, status, now = new Date().toISOString()) {
  const list = loadMistakeBook(storage);
  let changed = false;
  const next = list.map((entry) => {
    if (entry.id !== id) return entry;
    if (entry.status === status) return entry;
    changed = true;
    return { ...entry, status, updatedAt: now };
  });
  if (changed) saveMistakeBook(storage, next);
  return { list: next, changed };
}

export function markMistakeMastered(storage, id, now) {
  return updateMistakeStatus(storage, id, MISTAKE_STATUS.MASTERED, now);
}

export function removeMistake(storage, id) {
  const list = loadMistakeBook(storage);
  const next = list.filter((entry) => entry.id !== id);
  saveMistakeBook(storage, next);
  return next;
}

export function loadTrainingStats(storage) {
  const empty = { attempts: 0, passed: 0, masteredByDay: {} };
  if (!storage) return empty;
  try {
    const raw = storage.getItem(TRAINING_STATS_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    return {
      attempts: Number(parsed?.attempts) || 0,
      passed: Number(parsed?.passed) || 0,
      masteredByDay:
        parsed?.masteredByDay && typeof parsed.masteredByDay === "object"
          ? { ...parsed.masteredByDay }
          : {},
    };
  } catch {
    return empty;
  }
}

export function saveTrainingStats(storage, stats) {
  if (!storage) return;
  try {
    storage.setItem(TRAINING_STATS_KEY, JSON.stringify(stats ?? {}));
  } catch {
    // 忽略存储错误。
  }
}

export function recordTrainingAttempt(
  storage,
  { passed = false, mastered = false, now = new Date() } = {},
) {
  const stats = loadTrainingStats(storage);
  const next = {
    attempts: stats.attempts + 1,
    passed: stats.passed + (passed ? 1 : 0),
    masteredByDay: { ...stats.masteredByDay },
  };
  if (mastered) {
    const key = todayKey(now);
    next.masteredByDay[key] = (next.masteredByDay[key] ?? 0) + 1;
  }
  saveTrainingStats(storage, next);
  return next;
}

export function trainingAccuracy(stats) {
  if (!stats || !stats.attempts) return 0;
  return stats.passed / stats.attempts;
}

export function masteredToday(stats, now = new Date()) {
  if (!stats?.masteredByDay) return 0;
  return Number(stats.masteredByDay[todayKey(now)]) || 0;
}

export function pickTrainingQuestion(list, random = Math.random) {
  const pool = (list ?? []).filter(
    (entry) => entry.status === MISTAKE_STATUS.UNKNOWN,
  );
  if (!pool.length) return null;
  const index = Math.floor(random() * pool.length) % pool.length;
  return pool[Math.max(0, index)];
}

/**
 * 用户走出存储的最优解时零引擎开销直接通过。
 */
export function isTrainingSolution(record, uci) {
  const value = typeof uci === "string" ? uci.trim().toLowerCase() : "";
  return Boolean(value) && value === record?.bestMove?.uci;
}

/**
 * 走错时的判定：复用统一公式 loss = 记录最优分 + 走后局面评分（新行棋方视角）。
 */
export function judgeTrainingAnswer(record, afterScore) {
  // 优先用原始 bestScore 对象：mate 场景下 bestScoreCp 只是"排序用的大数"，
  // 直接喂进 calculateMoveLoss 会算出假的 cp 损失。旧记录回退到 bestScoreCp。
  const bestScore =
    record?.bestScore !== undefined && record?.bestScore !== null
      ? record.bestScore
      : record?.bestScoreCp;
  const loss = calculateMoveLoss(bestScore, afterScore);
  const passed = Number.isFinite(loss) && loss < 30;
  return { loss, passed };
}

/**
 * 训练判定入口。
 *
 * 用户走出存储的最优解时零引擎开销直接通过：`requestAfterScore` 完全不会被
 * 调用（引擎日志里不会出现任何 go）。只有走错时才请求走后局面评分。
 */
export async function evaluateTrainingAnswer({
  record,
  uci,
  requestAfterScore,
} = {}) {
  if (isTrainingSolution(record, uci)) {
    return {
      passed: true,
      reason: "best-move",
      loss: 0,
      engineUsed: false,
      afterScore: null,
    };
  }
  if (typeof requestAfterScore !== "function") {
    throw new Error("训练判定需要走后局面的评分回调。");
  }
  const afterScore = await requestAfterScore();
  const { loss, passed } = judgeTrainingAnswer(record, afterScore);
  return {
    passed,
    reason: passed ? "loss-within-limit" : "wrong",
    loss,
    engineUsed: true,
    afterScore,
  };
}
