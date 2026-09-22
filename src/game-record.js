import {
  BLACK,
  RED,
  START_FEN,
  applyMove,
  boardToFen,
  cloneBoard,
  gameStatus,
  isLegalMove,
  opposite,
  parseFen,
  uciToMove,
} from "./xiangqi.js";
import { formatMoveNotation } from "./xiangqi-notation.js";

export const GAME_RECORD_FORMAT = "xiangqi-studio-text";
export const FREE_PLAY_RECORD_FORMAT = "xiangqi-studio-freeplay";
export const LEGACY_GAME_RECORD_FORMAT = "xiangqi-studio-record";
export const GAME_RECORD_VERSION = 1;

const MAX_RECORDED_MOVES = 5000;
const RECORD_TITLE = "中国象棋对局棋谱";
const NOTATION_HEADER = "[传统记谱]";

function normalizeSide(side, fallback = null) {
  if (side === RED || side === "red" || side === "红方" || side === "红") {
    return RED;
  }
  if (
    side === BLACK ||
    side === "black" ||
    side === "黑方" ||
    side === "黑"
  ) {
    return BLACK;
  }
  return fallback;
}

function normalizeRecordedResult(result) {
  if (typeof result !== "string") return "";
  const text = result.trim();
  if (
    text === "playing" ||
    text === "red_win" ||
    text === "black_win"
  ) {
    return text;
  }
  if (text === "对局进行中" || text === "进行中") return "playing";
  if (text === "红方胜") return "red_win";
  if (text === "黑方胜") return "black_win";
  return text;
}

function moveToUciString(entry, index) {
  const value =
    typeof entry === "string"
      ? entry
      : entry && typeof entry === "object"
        ? entry.uci
        : "";
  const uci = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[a-i][0-9][a-i][0-9]$/.test(uci)) {
    throw new Error(`棋谱第 ${index + 1} 步不是有效的象棋坐标。`);
  }
  return uci;
}

function replayRecord(initialFen, moves, expectations = []) {
  const parsed = parseFen(initialFen);
  if (!Array.isArray(moves)) throw new Error("棋谱走法必须是列表。");
  if (moves.length > MAX_RECORDED_MOVES) {
    throw new Error(`棋谱步数不能超过 ${MAX_RECORDED_MOVES} 步。`);
  }

  let board = cloneBoard(parsed.board);
  let turn = parsed.turn;
  const moveRecords = [];

  for (let index = 0; index < moves.length; index += 1) {
    const uci = moveToUciString(moves[index], index);
    const move = uciToMove(uci);
    if (!isLegalMove(board, turn, move)) {
      throw new Error(`棋谱第 ${index + 1} 步不符合走棋规则。`);
    }

    const notation = formatMoveNotation(board, move);
    const expected = expectations[index];
    if (expected?.side && expected.side !== turn) {
      throw new Error(`棋谱第 ${index + 1} 步行棋方与坐标不一致。`);
    }
    if (expected?.notation && expected.notation !== notation) {
      throw new Error(`棋谱第 ${index + 1} 步传统记谱与坐标不一致。`);
    }

    moveRecords.push({
      number: Math.floor(index / 2) + 1,
      ply: index + 1,
      side: turn,
      uci,
      notation,
      description: notation,
    });
    board = applyMove(board, move);
    turn = opposite(turn);
  }

  const status = gameStatus(board, turn);
  return {
    initialFen: parsed.fen,
    initialBoard: cloneBoard(parsed.board),
    initialTurn: parsed.turn,
    board,
    turn,
    finalFen: boardToFen(board, turn),
    status,
    moves: moveRecords.map((move) => move.uci),
    moveRecords,
  };
}

/**
 * 自由行棋允许同一方连走，标准 replayRecord 会因行棋方不交替一律拒绝。
 * 这里按记录中标注的行棋方重放，只校验走法本身是否合法。
 */
function replayFreePlayRecord(initialFen, moves, expectations = []) {
  const parsed = parseFen(initialFen);
  if (!Array.isArray(moves)) throw new Error("棋谱走法必须是列表。");
  if (moves.length > MAX_RECORDED_MOVES) {
    throw new Error(`棋谱步数不能超过 ${MAX_RECORDED_MOVES} 步。`);
  }

  let board = cloneBoard(parsed.board);
  let turn = parsed.turn;
  const moveRecords = [];

  for (let index = 0; index < moves.length; index += 1) {
    const expected = expectations[index];
    if (expected?.side) turn = expected.side;
    const uci = moveToUciString(moves[index], index);
    const move = uciToMove(uci);
    if (!isLegalMove(board, turn, move)) {
      throw new Error(`棋谱第 ${index + 1} 步不符合走棋规则。`);
    }
    const notation = formatMoveNotation(board, move);
    if (expected?.notation && expected.notation !== notation) {
      throw new Error(`棋谱第 ${index + 1} 步传统记谱与坐标不一致。`);
    }
    moveRecords.push({
      number: index + 1,
      ply: index + 1,
      side: turn,
      uci,
      notation,
      description: notation,
    });
    board = applyMove(board, move);
  }

  const status = gameStatus(board, turn);
  return {
    initialFen: parsed.fen,
    initialBoard: cloneBoard(parsed.board),
    initialTurn: parsed.turn,
    board,
    turn,
    finalFen: boardToFen(board, turn),
    status,
    moves: moveRecords.map((move) => move.uci),
    moveRecords,
  };
}

function normalizeRecord(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("棋谱内容格式不正确。");
  }
  if (
    raw.format &&
    raw.format !== GAME_RECORD_FORMAT &&
    raw.format !== LEGACY_GAME_RECORD_FORMAT
  ) {
    throw new Error("这不是中国象棋软件支持的棋谱格式。");
  }
  if (
    raw.version != null &&
    (!Number.isFinite(Number(raw.version)) ||
      Number(raw.version) > GAME_RECORD_VERSION)
  ) {
    throw new Error("棋谱版本过新，请更新软件后再导入。");
  }

  const initialFen =
    typeof raw.initialFen === "string" && raw.initialFen.trim()
      ? raw.initialFen.trim()
      : typeof raw.startFen === "string" && raw.startFen.trim()
        ? raw.startFen.trim()
        : START_FEN;
  const rawMoves = Array.isArray(raw.moves) ? raw.moves : [];
  const expectations = rawMoves.map((entry) =>
    entry && typeof entry === "object"
      ? {
          side: normalizeSide(entry.side),
          notation: entry.notation ?? entry.chinese,
        }
      : null,
  );
  const replay = replayRecord(initialFen, rawMoves, expectations);

  if (typeof raw.finalFen === "string" && raw.finalFen.trim()) {
    const recordedFinalFen = parseFen(raw.finalFen).fen;
    if (recordedFinalFen !== replay.finalFen) {
      throw new Error("棋谱记录的最终局面与走法不一致。");
    }
  }
  const recordedResult = normalizeRecordedResult(raw.result);
  const resultMismatch = Boolean(
    recordedResult && recordedResult !== replay.status.state,
  );

  return {
    format: GAME_RECORD_FORMAT,
    version: Number(raw.version) || GAME_RECORD_VERSION,
    app: typeof raw.app === "string" ? raw.app : "中国象棋",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    humanSide: normalizeSide(raw.humanSide, BLACK),
    initialFen: replay.initialFen,
    initialBoard: replay.initialBoard,
    initialTurn: replay.initialTurn,
    finalFen: replay.finalFen,
    board: replay.board,
    turn: replay.turn,
    status: replay.status.state,
    result: replay.status.state,
    resultReason: replay.status.reason,
    recordedResult,
    resultMismatch,
    moves: replay.moves,
    moveRecords: replay.moveRecords,
  };
}

export function createGameRecord({
  initialFen = START_FEN,
  humanSide = BLACK,
  moves = [],
  createdAt = new Date().toISOString(),
} = {}) {
  const replay = replayRecord(initialFen, moves);
  return {
    format: GAME_RECORD_FORMAT,
    version: GAME_RECORD_VERSION,
    app: "中国象棋",
    createdAt,
    humanSide: normalizeSide(humanSide, BLACK),
    initialFen: replay.initialFen,
    finalFen: replay.finalFen,
    result: replay.status.state,
    resultReason: replay.status.reason,
    moves: replay.moveRecords,
  };
}

export function serializeGameRecord(record) {
  const normalized = normalizeRecord(record);
  const lines = [
    RECORD_TITLE,
    `格式: ${GAME_RECORD_FORMAT}`,
    `版本: ${GAME_RECORD_VERSION}`,
    `保存时间: ${normalized.createdAt || new Date().toISOString()}`,
    `我方执子: ${normalized.humanSide}`,
    `起始局面: ${normalized.initialFen}`,
    `最终局面: ${normalized.finalFen}`,
    `结果: ${normalized.status}`,
    `结果说明: ${normalized.resultReason || ""}`,
    "",
    NOTATION_HEADER,
  ];

  for (const move of normalized.moveRecords) {
    const sideText = move.side === RED ? "红方" : "黑方";
    lines.push(`${move.ply}. ${sideText} ${move.notation} (${move.uci})`);
  }

  lines.push(
    "",
    "[说明]",
    "传统记谱用于阅读，括号内坐标用于逐步精确还原。",
  );
  return `${lines.join("\r\n")}\r\n`;
}

function parseHeaderFields(lines) {
  const fields = new Map();
  for (const line of lines) {
    const match = /^\s*([^:：]+)[:：]\s*(.*)$/.exec(line);
    if (match) fields.set(match[1].trim(), match[2].trim());
  }
  return fields;
}

const NOTATION_MOVE_PATTERN =
  /^\s*(\d+)[.、]\s*(红方|黑方)\s+([^\s()（）]+)\s*[（(]\s*([a-iA-I][0-9][a-iA-I][0-9])\s*[)）]\s*$/;

/**
 * 解析 [传统记谱] 段落，返回每步的行棋方、传统记谱与 UCI 坐标。
 * 标准棋谱与自由行棋棋谱共用同一行格式。
 */
function parseNotationMoves(lines, notationIndex) {
  const expectations = [];
  const moves = [];
  for (let index = notationIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    if (line.startsWith("[")) break;

    const match = NOTATION_MOVE_PATTERN.exec(line);
    if (!match) {
      throw new Error(`棋谱第 ${expectations.length + 1} 步格式不正确。`);
    }
    const expectedPly = expectations.length + 1;
    if (Number(match[1]) !== expectedPly) {
      throw new Error(`棋谱第 ${expectedPly} 步序号不连续。`);
    }
    expectations.push({
      side: normalizeSide(match[2]),
      notation: match[3],
    });
    moves.push(match[4].toLowerCase());
  }
  return { expectations, moves };
}

/**
 * 解析“自由行棋”棋谱：允许同一方连走，按记录中的行棋方逐步还原。
 */
function parseFreePlayTextRecord(fields, lines) {
  const initialFen = fields.get("起始局面");
  if (!initialFen) throw new Error("棋谱缺少起始局面。");

  const notationIndex = lines.findIndex((line) => line.trim() === NOTATION_HEADER);
  if (notationIndex < 0) throw new Error("棋谱缺少传统记谱部分。");

  const { expectations, moves } = parseNotationMoves(lines, notationIndex);
  const replay = replayFreePlayRecord(initialFen, moves, expectations);

  // 自由行棋允许同一方连走，走法序列无法推导出“下一手由谁走”——
  // 该状态完全由用户手动切换，因此以棋谱头部的“最终局面”为准，
  // 只校验棋盘子力是否与走法一致（行棋方字段可能被用户指定成任意一方）。
  let turn = replay.turn;
  let finalFen = replay.finalFen;
  const recordedFinalFen = fields.get("最终局面");
  if (recordedFinalFen) {
    const parsedFinal = parseFen(recordedFinalFen);
    const recordedBoard = parsedFinal.fen.split(" ")[0];
    const replayedBoard = replay.finalFen.split(" ")[0];
    if (recordedBoard !== replayedBoard) {
      throw new Error("棋谱记录的最终局面与走法不一致。");
    }
    turn = parsedFinal.turn;
    finalFen = parsedFinal.fen;
  }

  const status = gameStatus(replay.board, turn);
  const recordedResult = normalizeRecordedResult(fields.get("结果"));

  return {
    format: FREE_PLAY_RECORD_FORMAT,
    version: 1,
    app: "中国象棋",
    createdAt: fields.get("保存时间") || "",
    humanSide: BLACK,
    freePlay: true,
    initialFen: replay.initialFen,
    initialBoard: replay.initialBoard,
    initialTurn: replay.initialTurn,
    finalFen,
    board: replay.board,
    turn,
    status: status.state,
    result: status.state,
    resultReason: status.reason,
    recordedResult,
    resultMismatch: Boolean(
      recordedResult && recordedResult !== status.state,
    ),
    moves: replay.moves,
    moveRecords: replay.moveRecords,
  };
}

function parseTextRecord(source) {
  const text = source.replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("棋谱文件是空的。");
  if (!text.includes(RECORD_TITLE)) {
    throw new Error("棋谱文件格式不正确，请选择本软件保存的 TXT 棋谱。");
  }

  const lines = text.split(/\r?\n/);
  const fields = parseHeaderFields(lines);
  const recordFormat = fields.get("格式");
  if (recordFormat === FREE_PLAY_RECORD_FORMAT) {
    return parseFreePlayTextRecord(fields, lines);
  }
  if (recordFormat !== GAME_RECORD_FORMAT) {
    throw new Error("棋谱格式标识不正确，请选择本软件保存的 TXT 棋谱。");
  }
  const rawVersion = Number(fields.get("版本") ?? 1);
  if (!Number.isInteger(rawVersion) || rawVersion > GAME_RECORD_VERSION) {
    throw new Error("棋谱版本过新，请更新软件后再导入。");
  }

  const initialFen = fields.get("起始局面");
  if (!initialFen) throw new Error("棋谱缺少起始局面。");

  const notationIndex = lines.findIndex((line) => line.trim() === NOTATION_HEADER);
  if (notationIndex < 0) throw new Error("棋谱缺少传统记谱部分。");

  const { expectations, moves } = parseNotationMoves(lines, notationIndex);

  const replay = replayRecord(initialFen, moves, expectations);
  const recordedFinalFen = fields.get("最终局面");
  if (recordedFinalFen && parseFen(recordedFinalFen).fen !== replay.finalFen) {
    throw new Error("棋谱记录的最终局面与走法不一致。");
  }
  const recordedResult = normalizeRecordedResult(fields.get("结果"));

  return {
    format: GAME_RECORD_FORMAT,
    version: rawVersion,
    app: "中国象棋",
    createdAt: fields.get("保存时间") || "",
    humanSide: normalizeSide(fields.get("我方执子"), BLACK),
    initialFen: replay.initialFen,
    initialBoard: replay.initialBoard,
    initialTurn: replay.initialTurn,
    finalFen: replay.finalFen,
    board: replay.board,
    turn: replay.turn,
    status: replay.status.state,
    result: replay.status.state,
    resultReason: replay.status.reason,
    recordedResult,
    resultMismatch: Boolean(
      recordedResult && recordedResult !== replay.status.state,
    ),
    moves: replay.moves,
    moveRecords: replay.moveRecords,
  };
}

export function parseGameRecord(source) {
  if (typeof source !== "string") return normalizeRecord(source);

  const text = source.trim();
  if (!text) throw new Error("棋谱文件是空的。");
  if (text.startsWith("{") || text.startsWith("[")) {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error("棋谱文件格式不正确，请选择 TXT、旧版 XQ 或 JSON 棋谱。");
    }
    return normalizeRecord(raw);
  }
  return parseTextRecord(text);
}
