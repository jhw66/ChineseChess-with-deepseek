import {
  applyMove,
  boardToFen,
  cloneBoard,
  opposite,
  parseFen,
  uciToMove,
} from "./xiangqi.js";
import { formatMoveNotation } from "./xiangqi-notation.js";

/**
 * 复盘与专项训练共用的核心算法。
 *
 * 该模块只依赖象棋规则本身，不依赖引擎实现，因此可以在 Node 单测和浏览器里
 * 复用同一份逻辑。
 */

export const MOVE_GRADES = {
  GOOD: "good",
  NEUTRAL: "neutral",
  INACCURACY: "inaccuracy",
  BLUNDER: "blunder",
};

export const MOVE_GRADE_LABELS = {
  good: "好棋",
  neutral: "无标注",
  inaccuracy: "轻微失误",
  blunder: "严重漏着",
};

export const MOVE_GRADE_COLORS = {
  good: "#2f9e44",
  neutral: "#8a9099",
  inaccuracy: "#e0a100",
  blunder: "#d64545",
};

export const REVIEW_MOVETIME_MS = 3000;

const LOSS_LIMITS = {
  good: 30,
  inaccuracy: 100,
  blunder: 300,
};

/**
 * 将引擎分值统一换算成一个可比较的原始数字。
 *
 * 这个函数只用于界面排序/展示等需要数值兜底的场景。复盘失误计算必须使用
 * calculateMoveLoss：那里遇到 mate 会返回 null，不能把 mate 伪造成普通 cp。
 */
const MATE_BASE = 100000;

export function toNumericScore(score) {
  if (score == null) return 0;
  if (typeof score === "number") {
    return Number.isFinite(score) ? score : 0;
  }
  if (typeof score !== "object") return 0;
  const value = Number(score.value);
  if (!Number.isFinite(value)) return 0;
  if (score.type === "mate") {
    // mate 0 表示"当前即被将死"，用正负基数表达。
    if (value === 0) return -MATE_BASE;
    return value > 0 ? MATE_BASE - value : -MATE_BASE - value;
  }
  return value;
}

export function isMateScore(score) {
  return Boolean(score) && typeof score === "object" && score.type === "mate";
}

function parseScore(score) {
  if (score == null) return null;
  if (typeof score === "number") {
    return Number.isFinite(score) ? { type: "cp", value: score } : null;
  }
  if (typeof score !== "object") return null;
  const value = Number(score.value);
  if (!Number.isFinite(value)) return null;
  return {
    type: score.type === "mate" ? "mate" : "cp",
    value,
  };
}

/**
 * 失误判定核心公式。
 *
 * bestScore  = fenBefore 最优着法评分（原始值，走子方视角）
 * afterScore = 实战着法走后局面的最优评分（原始值，新行棋方视角）
 *
 * 视角翻转已经内置在公式里：两边的行棋方不同，直接相加即为损失。
 * 严禁在调用处手动取反或做归一化。
 *
 * 只要一侧是 mate（或者分值缺失），就返回 null。mate 不是普通 cp，
 * 不能折算成 100000 一类的假分值，否则会污染平均损失、错题排序和训练判定。
 */
export function calculateMoveLoss(bestScore, afterScore) {
  const best = parseScore(bestScore);
  const after = parseScore(afterScore);
  if (!best || !after) return null;
  if (best.type !== "cp" || after.type !== "cp") return null;
  return best.value + after.value;
}

function moveText(move) {
  if (move == null) return "";
  if (typeof move === "string") return move.trim().toLowerCase();
  if (typeof move === "object" && typeof move.uci === "string") {
    return move.uci.trim().toLowerCase();
  }
  return "";
}

export function isTerminalWin(info) {
  const bestmove = moveText(info?.bestmove ?? info?.move);
  return bestmove === "(none)" || bestmove === "0000" || bestmove === "none";
}

function sideHasMate(info) {
  const score = info?.score;
  return isMateScore(score) && Number(score.value) > 0;
}

/**
 * 给一手棋分级。
 *
 * 返回 { grade, label, loss, reason }。grade 取值见 MOVE_GRADES。
 */
export function classifyMove(
  loss,
  bestInfo,
  afterInfo,
  actualMove,
  bestMove,
) {
  const actual = moveText(actualMove);
  const best = moveText(bestMove ?? bestInfo?.bestmove ?? bestInfo?.move);
  const normalizedLoss =
    typeof loss === "number" && Number.isFinite(loss)
      ? Math.max(0, loss)
      : null;
  const danger = sideHasMate(afterInfo) ? "opponent-mate" : null;

  const result = (
    grade,
    reason,
    finalLoss = normalizedLoss,
    finalDanger = danger,
  ) => ({
    grade,
    label: MOVE_GRADE_LABELS[grade],
    color: MOVE_GRADE_COLORS[grade],
    loss: finalLoss,
    danger: finalDanger,
    reason,
  });

  // 终局特例：实战着法直接把对方将死或困毙，视为走子方必胜，损失为 0。
  if (isTerminalWin(afterInfo)) {
    return result(MOVE_GRADES.GOOD, "terminal", 0, null);
  }

  // 实战即是引擎首选：永远先判好棋。对方仍有杀说明问题发生在更早的着法，
  // 不能把这一步倒着记成漏着；同时保留 danger 提示局面危险。
  if (actual && best && actual === best) {
    return result(MOVE_GRADES.GOOD, "best");
  }

  // 走子前已经处于被杀局面：避免把同一盘败局在每一步重复记成漏着。
  if (isMateScore(bestInfo?.score) && Number(bestInfo.score.value) < 0) {
    return result(MOVE_GRADES.NEUTRAL, "already-lost");
  }

  // 走子方本来有 N 步杀却走错。
  if (sideHasMate(bestInfo)) {
    return result(MOVE_GRADES.BLUNDER, "missed-mate");
  }

  // 走完后轮到对手且对手有成杀：这才是实战造成的严重漏着。
  if (sideHasMate(afterInfo)) {
    return result(MOVE_GRADES.BLUNDER, "allowed-mate");
  }

  // 涉及 mate 或分值缺失时不能按 cp 阈值硬判。
  if (normalizedLoss === null) {
    return result(MOVE_GRADES.NEUTRAL, "score-unavailable", null, danger);
  }

  if (normalizedLoss < LOSS_LIMITS.good) {
    return result(MOVE_GRADES.GOOD, "accurate");
  }
  if (normalizedLoss < LOSS_LIMITS.inaccuracy) {
    return result(MOVE_GRADES.NEUTRAL, "acceptable");
  }
  if (normalizedLoss < LOSS_LIMITS.blunder) {
    return result(MOVE_GRADES.INACCURACY, "inaccuracy");
  }
  return result(MOVE_GRADES.BLUNDER, "blunder");
}

export function gradeLabel(grade) {
  return MOVE_GRADE_LABELS[grade] ?? MOVE_GRADE_LABELS.neutral;
}

export function gradeColor(grade) {
  return MOVE_GRADE_COLORS[grade] ?? MOVE_GRADE_COLORS.neutral;
}

function safeNotation(board, move) {
  try {
    return formatMoveNotation(board, move);
  } catch {
    return "";
  }
}

/**
 * 自动复盘分析驱动器。
 *
 * 严格串行：每一手都先对 fenBefore 做一次 go movetime，等 bestmove 回来后，
 * 落下实战着法，再对 fenAfter 做第二次 go movetime。两次分析之间不会并发，
 * 且从不使用 go infinite。
 *
 * analyze({ startFen, moves, movetimeMs }) 由调用方注入，返回
 * { bestmove, score, ... }。isCancelled() 返回 true 时，本轮在两次分析之间
 * 立即停止，已完成的记录保留在返回值里。
 */
export async function runReviewAnalysis({
  startFen,
  moves,
  analyze,
  movetimeMs = REVIEW_MOVETIME_MS,
  onProgress = () => {},
  onMove = () => {},
  isCancelled = () => false,
}) {
  if (typeof analyze !== "function") {
    throw new Error("复盘分析缺少引擎回调。");
  }
  const parsed = parseFen(startFen);
  const played = [];
  const results = [];
  let board = cloneBoard(parsed.board);
  let turn = parsed.turn;
  let cancelled = false;

  for (let index = 0; index < moves.length; index += 1) {
    if (isCancelled()) {
      cancelled = true;
      break;
    }

    const uci = moves[index];
    const actualMove = uciToMove(uci);
    const fenBefore = boardToFen(board, turn);
    const playedBefore = played.slice();

    onProgress({
      index,
      ply: index + 1,
      total: moves.length,
      phase: "best",
    });
    const bestInfo = await analyze({
      startFen,
      moves: playedBefore,
      positionFen: fenBefore,
      movetimeMs,
      phase: "best",
    });

    if (isCancelled()) {
      cancelled = true;
      break;
    }

    const boardAfter = applyMove(board, actualMove);
    const afterTurn = opposite(turn);
    const fenAfter = boardToFen(boardAfter, afterTurn);
    const movesAfter = [...playedBefore, uci];

    onProgress({
      index,
      ply: index + 1,
      total: moves.length,
      phase: "after",
    });
    const afterInfo = await analyze({
      startFen,
      moves: movesAfter,
      positionFen: fenAfter,
      movetimeMs,
      phase: "after",
    });

    const terminal = isTerminalWin(afterInfo);
    const loss = terminal
      ? 0
      : calculateMoveLoss(bestInfo?.score, afterInfo?.score);
    const classification = classifyMove(
      loss,
      bestInfo,
      afterInfo,
      uci,
      bestInfo?.bestmove,
    );

    const bestUci = moveText(bestInfo?.bestmove);
    const record = {
      index,
      ply: index + 1,
      moveNumber: Math.floor(index / 2) + 1,
      side: turn,
      fenBefore,
      fenAfter,
      uci,
      chinese: safeNotation(board, actualMove),
      bestMove: /^[a-i][0-9][a-i][0-9]$/.test(bestUci) ? bestUci : "",
      bestChinese:
        /^[a-i][0-9][a-i][0-9]$/.test(bestUci)
          ? safeNotation(board, uciToMove(bestUci))
          : "",
      bestScore: bestInfo?.score ?? null,
      bestScoreCp: toNumericScore(bestInfo?.score),
      afterScore: afterInfo?.score ?? null,
      afterScoreCp: toNumericScore(afterInfo?.score),
      loss: classification.loss,
      rawLoss: loss,
      danger: classification.danger,
      grade: classification.grade,
      label: classification.label,
      reason: classification.reason,
      bestDepth: bestInfo?.depth ?? null,
      afterDepth: afterInfo?.depth ?? null,
    };
    results.push(record);
    onMove(record);

    board = boardAfter;
    turn = afterTurn;
    played.push(uci);
  }

  return {
    results,
    cancelled,
    completed: results.length,
    total: moves.length,
  };
}

/**
 * 复盘结果摘要：给对局树和错题本使用。
 */
export function summarizeReview(results = []) {
  const summary = {
    total: results.length,
    good: 0,
    neutral: 0,
    inaccuracy: 0,
    blunder: 0,
  };
  for (const item of results) {
    if (Object.prototype.hasOwnProperty.call(summary, item.grade)) {
      summary[item.grade] += 1;
    }
  }
  return summary;
}
