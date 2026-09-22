import {
  BLACK,
  RED,
  START_FEN,
  applyMove,
  boardToFen,
  cloneBoard,
  gameStatus,
  generateLegalMoves,
  isLegalMove,
  moveToUci,
  opposite,
  parseFen,
  pieceSide,
  uciToMove,
} from "./xiangqi.js";
import { formatMoveNotation } from "./xiangqi-notation.js";
import { parseGameRecord } from "./game-record.js";

/**
 * 对局导出 / 导入（复盘的前置依赖）。
 *
 * 自家 JSON 格式：
 * {
 *   version: 1,
 *   startFen: "...",
 *   moves: [{ uci, chinese, fen }],
 *   createdAt: "..."
 * }
 *
 * 导入时逐步校验合法性，重放保持重复局面历史，失败时抛出带手数的错误。
 */

export const GAME_EXPORT_VERSION = 1;
export const GAME_EXPORT_APP = "中国象棋";

const MAX_MOVES = 5000;
const UCI_PATTERN = /^[a-i][0-9][a-i][0-9]$/;
// ICCS 与中国象棋坐标同源，区别只在大小写：ICCS 习惯写成 H2E2。
const ICCS_PATTERN = /^[A-I][0-9][A-I][0-9]$/;
// 允许 h2-e2 / H2-E2 这类带连字符的写法。
const DASHED_COORD_PATTERN = /^([a-iA-I][0-9])[-–—]([a-iA-I][0-9])$/;

/**
 * 把单个 token 尝试解析为坐标着法；识别 UCI（小写）与 ICCS（大写、可带连字符）。
 * 不是坐标写法时返回空串，交给中文记谱解析器处理。
 */
export function parseCoordinateToken(token) {
  if (typeof token !== "string") return "";
  const text = token.trim();
  if (!text) return "";
  if (UCI_PATTERN.test(text.toLowerCase())) return text.toLowerCase();
  if (ICCS_PATTERN.test(text)) return text.toLowerCase();
  const dashed = text.match(DASHED_COORD_PATTERN);
  if (dashed) return `${dashed[1]}${dashed[2]}`.toLowerCase();
  return "";
}

const PIECE_CHAR_TYPES = new Map([
  ["帅", "K"],
  ["将", "K"],
  ["仕", "A"],
  ["士", "A"],
  ["相", "B"],
  ["象", "B"],
  ["马", "N"],
  ["馬", "N"],
  ["车", "R"],
  ["車", "R"],
  ["炮", "C"],
  ["砲", "C"],
  ["兵", "P"],
  ["卒", "P"],
]);

const CHINESE_DIGITS = new Map([
  ["一", 1],
  ["二", 2],
  ["两", 2],
  ["三", 3],
  ["四", 4],
  ["五", 5],
  ["六", 6],
  ["七", 7],
  ["八", 8],
  ["九", 9],
]);

function charToDigit(ch) {
  if (!ch) return null;
  if (CHINESE_DIGITS.has(ch)) return CHINESE_DIGITS.get(ch);
  if (/^[0-9]$/.test(ch)) return Number(ch);
  const code = ch.codePointAt(0);
  // 全角 ０-９
  if (code >= 0xff10 && code <= 0xff19) return code - 0xff10;
  return null;
}

/**
 * 解析一条传统中文记谱，返回结构化描述；无法解析时返回 null。
 */
export function parseChineseMove(text) {
  if (typeof text !== "string") return null;
  const normalized = text
    .trim()
    .replace(/[進]/g, "进")
    .replace(/[退]/g, "退")
    .replace(/[平]/g, "平")
    .replace(/\s+/g, "");
  if (!normalized) return null;

  let cursor = 0;
  let prefix = "";

  const first = normalized[cursor];
  if (first === "前" || first === "中" || first === "后") {
    prefix = first;
    cursor += 1;
  } else {
    const digit = charToDigit(first);
    if (digit != null && PIECE_CHAR_TYPES.has(normalized[cursor + 1])) {
      prefix = String(digit);
      cursor += 1;
    }
  }

  const pieceChar = normalized[cursor];
  const type = PIECE_CHAR_TYPES.get(pieceChar);
  if (!type) return null;
  cursor += 1;

  let file = null;
  const fileDigit = charToDigit(normalized[cursor]);
  if (fileDigit != null) {
    file = fileDigit;
    cursor += 1;
  }

  const movement = normalized[cursor];
  if (movement !== "平" && movement !== "进" && movement !== "退") return null;
  cursor += 1;

  const amount = charToDigit(normalized[cursor]);
  if (amount == null) return null;
  cursor += 1;

  if (cursor !== normalized.length) return null;
  if (!prefix && file == null) return null;

  return { prefix, type, file, movement, amount };
}

function fileNumberOf(side, col) {
  return side === RED ? 9 - col : col + 1;
}

function columnOfFile(side, file) {
  return side === RED ? 9 - file : file - 1;
}

function positionsOnFile(board, side, type, col) {
  const positions = [];
  for (let row = 0; row < 10; row += 1) {
    const piece = board[row][col];
    if (
      piece !== "." &&
      pieceSide(piece) === side &&
      piece.toUpperCase() === type
    ) {
      positions.push(row);
    }
  }
  return positions.sort((left, right) =>
    side === RED ? left - right : right - left,
  );
}

function prefixForCount(count, index) {
  if (count === 2) return index === 0 ? "前" : "后";
  if (count === 3) return ["前", "中", "后"][index];
  if (index === 0) return "前";
  if (index === count - 1) return "后";
  return String(index + 1);
}

/**
 * uciToChinese 的逆运算：把传统纵线记谱还原成 UCI 坐标。
 *
 * 支持 前/中/后 消歧，以及同一纵线多于三个同类子时的序号消歧。
 * 无法唯一确定走法时返回 null。
 */
export function chineseToUci(board, side, text) {
  const parsed = parseChineseMove(text);
  if (!parsed) return null;

  const candidates = generateLegalMoves(board, side).filter((move) => {
    const piece = board[move.from[0]]?.[move.from[1]];
    return piece && piece !== "." && piece.toUpperCase() === parsed.type;
  });

  const matches = candidates.filter((move) => {
    const [fromRow, fromCol] = move.from;
    const [toRow, toCol] = move.to;

    if (parsed.prefix) {
      const positions = positionsOnFile(board, side, parsed.type, fromCol);
      if (positions.length < 2) return false;
      const index = positions.indexOf(fromRow);
      if (index < 0) return false;
      if (prefixForCount(positions.length, index) !== parsed.prefix) {
        return false;
      }
    } else if (fileNumberOf(side, fromCol) !== parsed.file) {
      return false;
    }

    const forward = side === RED ? toRow < fromRow : toRow > fromRow;
    const backward = side === RED ? toRow > fromRow : toRow < fromRow;

    if (parsed.movement === "平") {
      return fromRow === toRow && fileNumberOf(side, toCol) === parsed.amount;
    }

    if (parsed.movement === "进" && !forward) return false;
    if (parsed.movement === "退" && !backward) return false;

    if (parsed.type === "N" || parsed.type === "B" || parsed.type === "A") {
      return fileNumberOf(side, toCol) === parsed.amount;
    }
    return Math.abs(toRow - fromRow) === parsed.amount;
  });

  if (matches.length !== 1) return null;
  return moveToUci(matches[0]);
}

function moveToUciString(entry, index) {
  const value =
    typeof entry === "string"
      ? entry
      : entry && typeof entry === "object"
        ? entry.uci
        : "";
  const uci = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!UCI_PATTERN.test(uci)) {
    throw new Error(`第 ${index + 1} 手非法：不是有效的象棋坐标。`);
  }
  return uci;
}

/**
 * 逐步重放对局，返回完整局面轨迹。
 */
export function replayGame({ startFen = START_FEN, moves = [] } = {}) {
  const parsed = parseFen(startFen);
  if (!Array.isArray(moves)) throw new Error("对局走法必须是列表。");
  if (moves.length > MAX_MOVES) {
    throw new Error(`对局步数不能超过 ${MAX_MOVES} 步。`);
  }

  let board = cloneBoard(parsed.board);
  let turn = parsed.turn;
  const records = [];

  for (let index = 0; index < moves.length; index += 1) {
    const uci = moveToUciString(moves[index], index);
    const move = uciToMove(uci);
    if (!isLegalMove(board, turn, move)) {
      throw new Error(`第 ${index + 1} 手非法：该走法不符合象棋规则。`);
    }
    const chinese = formatMoveNotation(board, move);
    const next = applyMove(board, move);
    const nextTurn = opposite(turn);
    records.push({
      index,
      ply: index + 1,
      moveNumber: Math.floor(index / 2) + 1,
      side: turn,
      uci,
      chinese,
      fenBefore: boardToFen(board, turn),
      fen: boardToFen(next, nextTurn),
    });
    board = next;
    turn = nextTurn;
  }

  return {
    startFen: parsed.fen,
    records,
    board,
    turn,
    finalFen: boardToFen(board, turn),
    status: gameStatus(board, turn),
  };
}

export function createGameExport({
  startFen = START_FEN,
  moves = [],
  createdAt = new Date().toISOString(),
} = {}) {
  const replay = replayGame({ startFen, moves });
  return {
    version: GAME_EXPORT_VERSION,
    app: GAME_EXPORT_APP,
    startFen: replay.startFen,
    createdAt,
    moves: replay.records.map((record) => ({
      uci: record.uci,
      chinese: record.chinese,
      fen: record.fen,
    })),
  };
}

export function serializeGameExport(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function normalizeExport(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("对局文件格式不正确。");
  }
  const version = Number(raw.version ?? GAME_EXPORT_VERSION);
  if (!Number.isFinite(version) || version > GAME_EXPORT_VERSION) {
    throw new Error("对局文件版本过新，请更新软件后再导入。");
  }
  const startFen =
    typeof raw.startFen === "string" && raw.startFen.trim()
      ? raw.startFen.trim()
      : START_FEN;
  const rawMoves = Array.isArray(raw.moves) ? raw.moves : [];
  const replay = replayGame({ startFen, moves: rawMoves });

  // 校验每一步记录的中文记谱与 FEN 是否与实际走势一致。
  for (let index = 0; index < replay.records.length; index += 1) {
    const entry = rawMoves[index];
    if (!entry || typeof entry !== "object") continue;
    const record = replay.records[index];
    if (typeof entry.chinese === "string" && entry.chinese.trim()) {
      const expected = entry.chinese.trim();
      if (expected !== record.chinese) {
        throw new Error(`第 ${index + 1} 手非法：中文记谱与坐标不一致。`);
      }
    }
    if (typeof entry.fen === "string" && entry.fen.trim()) {
      const recorded = parseFen(entry.fen).fen;
      if (recorded !== record.fen) {
        throw new Error(`第 ${index + 1} 手非法：FEN 与走势不一致。`);
      }
    }
  }

  return {
    version,
    app: typeof raw.app === "string" ? raw.app : GAME_EXPORT_APP,
    startFen: replay.startFen,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    moves: replay.records.map((record) => record.uci),
    records: replay.records,
    finalFen: replay.finalFen,
    status: replay.status,
  };
}

/**
 * PGN / 纯记谱文本导入。
 *
 * 记谱方言按 UCI 坐标 > ICCS 坐标 > 中文纵线记谱的顺序支持。
 * 解析失败抛出「第 N 手非法」，绝不静默崩溃。
 */
export function parseNotationText(source, { startFen = START_FEN } = {}) {
  if (typeof source !== "string") throw new Error("对局文本不是字符串。");
  const parsedStart = parseFen(startFen);
  let board = cloneBoard(parsedStart.board);
  let turn = parsedStart.turn;

  const cleaned = source
    .replace(/\r\n?/g, "\n")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ");

  const rawTokens = cleaned
    .split(/[\s,，、;；|]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !/^\d+[.、:：]$/.test(token))
    .filter((token) => !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(token))
    .filter((token) => !/^\[.*\]$/.test(token));

  const moves = [];
  for (let index = 0; index < rawTokens.length; index += 1) {
    const token = rawTokens[index];
    const compact = token
      .replace(/^\d+[.、:：]+/, "")
      .replace(/^(?:uci|iccs)[:：]?/i, "")
      .trim();
    if (!compact) continue;

    // 记谱方言优先级：UCI 坐标 > ICCS 坐标 > 中文纵线记谱。
    let uci = parseCoordinateToken(compact);
    if (!uci) {
      const resolved = chineseToUci(board, turn, compact);
      if (!resolved) {
        throw new Error(`第 ${index + 1} 手非法：无法解析「${token}」。`);
      }
      uci = resolved;
    }

    const move = uciToMove(uci);
    if (!isLegalMove(board, turn, move)) {
      throw new Error(`第 ${index + 1} 手非法：该走法不符合象棋规则。`);
    }
    moves.push(uci);
    board = applyMove(board, move);
    turn = opposite(turn);
  }

  if (!moves.length) throw new Error("对局文本里没有可识别的走法。");
  return { startFen: parsedStart.fen, moves };
}

/**
 * 统一入口：自动识别自家 JSON / PGN 记谱。
 */
export function parseGameTransfer(source, { startFen = START_FEN } = {}) {
  if (typeof source !== "string") return normalizeExport(source);
  const text = source.replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("对局文件是空的。");
  if (text.startsWith("{")) {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error("对局 JSON 解析失败。");
    }
    return normalizeExport(raw);
  }
  if (text.includes("中国象棋对局棋谱")) {
    const record = parseGameRecord(text);
    if (record.freePlay) {
      throw new Error("自由行棋棋谱暂不支持复盘分析。");
    }
    return normalizeExport({
      version: GAME_EXPORT_VERSION,
      app: record.app,
      startFen: record.initialFen,
      createdAt: record.createdAt,
      moves: record.moves,
    });
  }
  const notation = parseNotationText(text, { startFen });
  return normalizeExport({
    version: GAME_EXPORT_VERSION,
    startFen: notation.startFen,
    moves: notation.moves,
  });
}

export function sideLabel(side) {
  return side === RED ? "红方" : BLACK === side ? "黑方" : "";
}
