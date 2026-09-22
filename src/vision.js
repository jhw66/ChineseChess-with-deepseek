import {
  boardToFen,
  createEmptyBoard,
  parseFen,
  validatePosition,
} from "./xiangqi.js";
import { normalizeApiKey } from "./deepseek-key.js";

const DEFAULT_ENDPOINT = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "deepseek-flash";
const MAX_IMAGE_DATA_URL_CHARS = 12 * 1024 * 1024;
const TEXT_ONLY_MODEL = /^deepseek-(?:chat|reasoner)$/i;
const PIECE_KINDS = new Set(["K", "A", "B", "N", "R", "C", "P"]);
const GLYPH_INFO = new Map([
  ["帅", { kind: "K", fixedSide: "w" }],
  ["帥", { kind: "K", fixedSide: "w" }],
  ["将", { kind: "K", fixedSide: "b" }],
  ["將", { kind: "K", fixedSide: "b" }],
  ["仕", { kind: "A", defaultSide: "w" }],
  ["士", { kind: "A", defaultSide: "b" }],
  ["相", { kind: "B", defaultSide: "w" }],
  ["象", { kind: "B", defaultSide: "b" }],
  ["马", { kind: "N", defaultSide: "w" }],
  ["馬", { kind: "N", defaultSide: "b" }],
  ["车", { kind: "R", defaultSide: "w" }],
  ["車", { kind: "R", defaultSide: "b" }],
  ["炮", { kind: "C", defaultSide: "w" }],
  ["砲", { kind: "C", defaultSide: "b" }],
  ["兵", { kind: "P", defaultSide: "w" }],
  ["卒", { kind: "P", defaultSide: "b" }],
]);

const SYSTEM_PROMPT = [
  "你是中国象棋残局识别器。你的任务是逐格读取图片，不要凭常见开局猜测，也不要假设红黑方向。",
  "先找到棋盘四角，以及 10 条横线和 9 条竖线。即使图片有缩放或轻微透视，也按横线、竖线的交点定位，不要按棋子看起来大致在哪一列来猜。",
  "坐标固定为：row 0 是图片最上方横线，row 9 是最下方横线；col 0 是最左方竖线，col 8 是最右方竖线。",
  "坐标永远按原图方向读取，禁止因为红方在上或在下而把 row、col 反过来填写。识别完成后可在 notes 说明方向，但 board 和 pieces 里的坐标不得旋转。",
  "先判断棋盘是否旋转：如果红方帅在图片上方，orientation 填 red-top；如果红方帅在图片下方，填 red-bottom。棋子位置比棋盘文字位置更可信。",
  "红黑优先由棋子文字的笔画颜色决定，不能由字形或上下位置决定。红方文字通常是暗红或朱红，黑方文字是黑色或灰黑色；木质棋子、阴影和棕色圆环不能单独判为黑方。",
  "马/馬、车/車、炮/砲两边都可能出现。以 color 字段决定阵营，不要因为看到繁体字就判为黑方。",
  "逐枚判断兵/卒是否已经过河：以河界和棋子颜色判断，不能只看棋子当前在图片的上半区还是下半区。红兵朝黑方前进并越过河界后为过河，黑卒朝红方前进并越过河界后为过河；过河后可以横走，但仍必须按原图实际交点记录位置。",
  "字形含义：帅/帥=K，将/將=k，仕/士=A/a，相/象=B/b，马/馬=N/n，车/車=R/r，炮/砲=C/c，兵/卒=P/p。胜负规则以 color 为准。",
  "必须返回 board：10 个字符串组成的数组，每个字符串严格 9 个字符；row 0 到 row 9 是原图最上方到最下方，col 0 到 col 8 是原图最左到最右。红方用大写 K/A/B/N/R/C/P，黑方用小写 k/a/b/n/r/c/p，空交点用句点。",
  "棋盘任何一条横线即使整行没有棋子也必须保留为空字符串行“.........”。绝对不能省略上方或下方的空行，也不能只返回有棋子的行。",
  "请从 row 0 到 row 9 逐行扫描，每行严格从 col 0 到 col 8 检查全部 90 个交点。每行扫描后先在内部核对该行数量，再读下一行。board 必须完整覆盖全部 10 行。",
  "再从上到下、从右到左复核一遍，重点检查颜色相同但字形不同的棋子、河道文字、光标、阴影和棋盘边框，不能把它们当成棋子。",
  "pieces 可选，但 board 必须始终存在。pieces 用于说明棋子字形和颜色；如果 board 与 pieces 表示同一个局面，两者必须一致。自定义残局可能超出常规数量，必须按图识别，不能自行删减棋子。",
  "返回前做自检：board 正好 10 行且每行正好 9 个字符；双方各有一个帅/将；帅/将要在自己的九宫内；红黑大小写与棋子颜色一致。",
  "看不清的棋子可以降低 confidence 并在 notes 说明，但不能凭空补齐不存在的棋子。",
  "只返回一个 JSON 对象，不要 Markdown、解释或代码围栏。",
  '格式：{"orientation":"red-top|red-bottom|unknown","board":[".........",".........",".........",".........",".........",".........",".........",".........",".........","........."],"turn":"w","notes":""}。',
  "也可以附带 pieces；每个棋子写 r、c、glyph、color、piece，其中 r、c 使用原图坐标且范围分别为 0 到 9、0 到 8；color 只能是 red 或 black。turn 用 w 或 b，无法判断时填 w。",
].join("\n");

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function sanitizeModel(value) {
  const model = cleanText(value, 64) || DEFAULT_MODEL;
  if (!/^[a-zA-Z0-9._:-]+$/.test(model)) {
    const error = new Error("识图模型名称格式不正确。");
    error.statusCode = 400;
    throw error;
  }
  if (TEXT_ONLY_MODEL.test(model)) {
    const error = new Error(
      "deepseek-chat 和 deepseek-reasoner 是文本模型，不能可靠识图。请使用默认的 deepseek-flash，或填写账号中兼容图片输入的模型。",
    );
    error.statusCode = 400;
    throw error;
  }
  return model;
}

function normalizeTurn(value, fallback = "w") {
  const token = cleanText(value, 16).toLowerCase();
  if (token === "w" || token === "red" || token === "r" || token === "红") {
    return "w";
  }
  if (token === "b" || token === "black" || token === "黑") {
    return "b";
  }
  return fallback;
}

function normalizeSide(value) {
  const token = cleanText(value, 16).toLowerCase();
  if (
    token === "w" ||
    token === "red" ||
    token === "r" ||
    token === "红" ||
    token === "紅"
  ) {
    return "w";
  }
  if (token === "b" || token === "black" || token === "黑") {
    return "b";
  }
  return "";
}

function pieceWithSide(kind, side) {
  return side === "b" ? kind.toLowerCase() : kind;
}

function normalizePiece(value, sideValue) {
  if (typeof value !== "string") return "";
  const token = value.trim();
  if (!token) return ".";
  if (token === "." || token === "空" || token === "无" || token === "0") {
    return ".";
  }

  let kind = token.toUpperCase();
  if (kind === "H") kind = "N";
  if (kind === "E") kind = "B";
  if (token.length === 1 && PIECE_KINDS.has(kind)) {
    const side = normalizeSide(sideValue) || (token === kind ? "w" : "b");
    return pieceWithSide(kind, side);
  }

  const info = GLYPH_INFO.get(token);
  if (!info) return "";
  const side =
    normalizeSide(sideValue) || info.fixedSide || info.defaultSide || "w";
  if (info.fixedSide && side !== info.fixedSide) return "";
  return pieceWithSide(info.kind, side);
}

function normalizeOrientation(value) {
  const token = cleanText(value, 32).toLowerCase().replace(/[\s_]+/g, "-");
  if (
    token === "red-top" ||
    token === "red-at-top" ||
    token === "black-bottom" ||
    token === "black-at-bottom"
  ) {
    return "red-top";
  }
  if (
    token === "red-bottom" ||
    token === "red-at-bottom" ||
    token === "black-top" ||
    token === "black-at-top"
  ) {
    return "red-bottom";
  }
  return "";
}

function cleanModelText(value) {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/[\u200B-\u200D\u2060]/g, "")
    .trim();
}

function balancedJsonCandidates(text) {
  const candidates = [];
  for (let start = 0; start < text.length; start += 1) {
    const opener = text[start];
    if (opener !== "{" && opener !== "[") continue;

    const stack = [];
    let quote = "";
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === quote) {
          quote = "";
        }
        continue;
      }

      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }
      if (character === "{") {
        stack.push("}");
        continue;
      }
      if (character === "[") {
        stack.push("]");
        continue;
      }
      if (character !== "}" && character !== "]") continue;
      if (stack[stack.length - 1] !== character) break;
      stack.pop();
      if (!stack.length) {
        candidates.push(text.slice(start, index + 1));
        break;
      }
    }
  }
  return candidates;
}

function repairJsonCandidate(value) {
  return value
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/^\s*(?:json|answer|result)\s*[:：]\s*/i, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\r\n]*/g, "")
    .replace(/\bNone\b/g, "null")
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)/g, '$1"$2"$3')
    .replace(/'((?:\\.|[^'\\])*)'/g, (_match, inner) =>
      JSON.stringify(inner.replace(/\\'/g, "'")),
    )
    .replace(/,\s*([}\]])/g, "$1")
    .trim();
}

function normalizePayloadShape(value) {
  if (Array.isArray(value)) {
    if (
      value.length === 10 &&
      value.every((row) => typeof row === "string")
    ) {
      return { board: value };
    }
    if (
      value.length &&
      value.every(
        (item) =>
          item &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          ("r" in item || "row" in item),
      )
    ) {
      return { pieces: value };
    }
    if (value.length === 1) return normalizePayloadShape(value[0]);
    return null;
  }
  if (!value || typeof value !== "object") return null;

  if (typeof value.json === "string") {
    try {
      return normalizePayloadShape(JSON.parse(value.json));
    } catch {
      // Continue with the normal object fields.
    }
  }

  const hasPositionField = ["board", "pieces", "fen"].some(
    (key) => key in value,
  );
  if (!hasPositionField) {
    for (const key of ["result", "data", "answer", "position"]) {
      if (key in value) {
        const nested = normalizePayloadShape(value[key]);
        if (nested) return nested;
      }
    }
  }
  return value;
}

function parseJsonCandidate(candidate) {
  const text = cleanModelText(candidate);
  if (!text) return null;

  const variants = [text, repairJsonCandidate(text)].filter(
    (value, index, values) => value && values.indexOf(value) === index,
  );
  for (const variant of variants) {
    try {
      const parsed = normalizePayloadShape(JSON.parse(variant));
      if (parsed) return parsed;
    } catch {
      // Try balanced JSON fragments and repairs below.
    }
    for (const fragment of balancedJsonCandidates(variant)) {
      try {
        const parsed = normalizePayloadShape(JSON.parse(fragment));
        if (parsed) return parsed;
      } catch {
        try {
          const repaired = normalizePayloadShape(
            JSON.parse(repairJsonCandidate(fragment)),
          );
          if (repaired) return repaired;
        } catch {
          // Keep looking through the remaining fragments.
        }
      }
    }
  }
  return null;
}

function boardFromTextLines(text) {
  const rows = [];
  for (const rawLine of cleanModelText(text).split(/\r?\n/)) {
    const line = rawLine
      .replace(
        /^\s*(?:row\s*\d+|第\s*\d+\s*行)\s*[:：-]?\s*/i,
        "",
      )
      .replace(/[`"'[\],]/g, "")
      .trim();
    const match = line.match(/[.KkAaBbNnRrCcPp]{9}/);
    if (match) rows.push(match[0].split(""));
  }
  return rows.length === 10 ? { board: rows.map((row) => row.join("")) } : null;
}

function extractJsonObject(content) {
  const text = typeof content === "string" ? cleanModelText(content) : "";
  if (!text) {
    const error = new Error("识图模型没有返回识别结果。");
    error.statusCode = 502;
    throw error;
  }

  const fenced = Array.from(
    text.matchAll(/```(?:json|json5)?\s*([\s\S]*?)```/gi),
    (match) => match[1],
  );
  for (const candidate of [...fenced, text]) {
    const parsed = parseJsonCandidate(candidate);
    if (parsed) return parsed;
  }

  const textBoard = boardFromTextLines(text);
  if (textBoard) return textBoard;

  const preview = cleanText(text.replace(/\s+/g, " "), 140);
  const error = new Error(
    `识图模型返回了文字而不是棋局 JSON。请确认 deepseek-flash 支持图片输入。返回内容开头：${preview}`,
  );
  error.statusCode = 502;
  throw error;
}

function contentToText(content) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => contentToText(part))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (!content || typeof content !== "object") return "";

  return [
    content.text,
    content.output_text,
    content.value,
    content.content,
  ]
    .map((value) => contentToText(value))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractAssistantText(payload) {
  const choice = payload?.choices?.[0];
  const finishReason = cleanText(
    choice?.finish_reason ?? choice?.finishReason ?? payload?.finish_reason,
    32,
  ).toLowerCase();
  const answerCandidates = [
    choice?.message?.content,
    choice?.message?.text,
    choice?.text,
    payload?.output_text,
    payload?.output,
  ];
  for (const candidate of answerCandidates) {
    const text = contentToText(candidate);
    if (text) return text;
  }

  // Reasoning text is not the final answer. When the response hit the output
  // limit, retrying is safer than treating a truncated thought as board data.
  if (finishReason !== "length") {
    for (const candidate of [
      choice?.message?.reasoning_content,
      choice?.reasoning_content,
    ]) {
      const text = contentToText(candidate);
      if (text) return text;
    }
  }
  return "";
}

function emptyModelResponseError(model, payload, attempt) {
  const finishReason = cleanText(
    payload?.choices?.[0]?.finish_reason ??
      payload?.choices?.[0]?.finishReason ??
      payload?.finish_reason,
    32,
  );
  const reason = finishReason ? `，结束原因为 ${finishReason}` : "";
  const error = new Error(
    `识图模型没有返回识别结果（模型：${model}${reason}，已尝试 ${attempt} 次）。请确认该模型支持图片输入；如果返回被截断，请减少图片复杂度或提高输出上限。`,
  );
  error.statusCode = 502;
  return error;
}

function normalizeIndex(value, max, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > max) {
    const error = new Error(`识图结果的${label}必须是 0 到 ${max} 的整数。`);
    error.statusCode = 502;
    throw error;
  }
  return number;
}

function boardFromPieces(pieces) {
  if (!Array.isArray(pieces) || !pieces.length) {
    const error = new Error("识图结果没有列出任何棋子。");
    error.statusCode = 502;
    throw error;
  }

  const board = createEmptyBoard();
  for (const [index, raw] of pieces.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      const error = new Error(`识图结果的第 ${index + 1} 个棋子格式不正确。`);
      error.statusCode = 502;
      throw error;
    }

    const row = normalizeIndex(raw.r ?? raw.row, 9, `行号（第 ${index + 1} 个棋子）`);
    const col = normalizeIndex(raw.c ?? raw.col, 8, `列号（第 ${index + 1} 个棋子）`);
    const side = normalizeSide(raw.color ?? raw.side ?? raw.camp);
    const piece =
      normalizePiece(raw.piece ?? raw.code, side) ||
      normalizePiece(raw.glyph ?? raw.character ?? raw.name, side);
    if (!piece || piece === ".") {
      const error = new Error(
        `识图结果的第 ${index + 1} 个棋子无法识别：${cleanText(
          raw.glyph ?? raw.character ?? raw.piece ?? "",
          24,
        )}`,
      );
      error.statusCode = 502;
      throw error;
    }
    if (board[row][col] !== ".") {
      const error = new Error(`识图结果在 row ${row}、col ${col} 重复放了棋子。`);
      error.statusCode = 502;
      throw error;
    }
    board[row][col] = piece;
  }
  return board;
}

function matrixToBoard(matrix, colorMatrix) {
  if (!Array.isArray(matrix) || matrix.length !== 10) {
    const error = new Error("识图结果必须包含 10 行棋盘。");
    error.statusCode = 502;
    throw error;
  }

  const board = [];
  for (let row = 0; row < 10; row += 1) {
    const rawRow = Array.isArray(matrix[row])
      ? matrix[row]
      : typeof matrix[row] === "string"
        ? matrix[row].split("")
        : null;
    if (!rawRow || rawRow.length !== 9) {
      const error = new Error(`识图结果的第 ${row + 1} 行不是 9 列。`);
      error.statusCode = 502;
      throw error;
    }
    const rawColorRow = colorMatrix?.[row];
    const normalized = [];
    for (let col = 0; col < 9; col += 1) {
      const rawColor = Array.isArray(rawColorRow)
        ? rawColorRow[col]
        : typeof rawColorRow === "string"
          ? rawColorRow[col]
          : "";
      const piece = normalizePiece(rawRow[col], rawColor);
      if (!piece) {
        const error = new Error(`识图结果含无法识别的棋子：${rawRow[col]}`);
        error.statusCode = 502;
        throw error;
      }
      normalized.push(piece);
    }
    board.push(normalized);
  }
  return board;
}

function findGeneral(board, piece) {
  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      if (board[row][col] === piece) return [row, col];
    }
  }
  return null;
}

function rotateBoard(board) {
  const rotated = createEmptyBoard();
  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      rotated[9 - row][8 - col] = board[row][col];
    }
  }
  return rotated;
}

function inferOrientation(board, statedOrientation) {
  const redGeneral = findGeneral(board, "K");
  const blackGeneral = findGeneral(board, "k");
  const redTop = redGeneral && redGeneral[0] <= 2;
  const redBottom = redGeneral && redGeneral[0] >= 7;
  const blackTop = blackGeneral && blackGeneral[0] <= 2;
  const blackBottom = blackGeneral && blackGeneral[0] >= 7;

  if ((redTop && blackBottom) || (redBottom && blackTop)) {
    return redTop ? "red-top" : "red-bottom";
  }
  if (redTop || blackBottom) return "red-top";
  if (redBottom || blackTop) return "red-bottom";
  return statedOrientation || "";
}

function canonicalizeBoardOrientation(board, statedOrientation) {
  const orientation = inferOrientation(board, statedOrientation);
  if (orientation === "red-top") {
    return { board: rotateBoard(board), autoRotated: true, orientation };
  }
  return { board, autoRotated: false, orientation: orientation || "unknown" };
}

function riverCrossingSummary(board) {
  let red = 0;
  let black = 0;
  for (let row = 0; row < 10; row += 1) {
    for (const piece of board[row]) {
      if (piece === "P" && row <= 4) red += 1;
      if (piece === "p" && row >= 5) black += 1;
    }
  }
  return `过河情况：红兵 ${red} 枚已过河，黑卒 ${black} 枚已过河。`;
}

function validateRecognizedPosition(board, turn) {
  const pieces = board.flat();
  const redGeneralCount = pieces.filter((piece) => piece === "K").length;
  const blackGeneralCount = pieces.filter((piece) => piece === "k").length;
  if (redGeneralCount !== 1 || blackGeneralCount !== 1) {
    const error = new Error("识图结果必须各有一个红方帅和黑方将。");
    error.statusCode = 422;
    throw error;
  }

  const redGeneral = findGeneral(board, "K");
  const blackGeneral = findGeneral(board, "k");

  const [redRow, redCol] = redGeneral;
  const [blackRow, blackCol] = blackGeneral;
  const redGeneralInPalace =
    redRow >= 7 && redRow <= 9 && redCol >= 3 && redCol <= 5;
  const blackGeneralInPalace =
    blackRow >= 0 && blackRow <= 2 && blackCol >= 3 && blackCol <= 5;
  if (!redGeneralInPalace || !blackGeneralInPalace) {
    const error = new Error(
      "无法确定棋盘上下方向，或帅将位置不完整。请换一张棋盘边框完整、方向清楚的图片。",
    );
    error.statusCode = 422;
    throw error;
  }

  const validation = validatePosition(board, turn);
  if (!validation.ok) {
    const error = new Error(
      `${validation.message} 请换一张更清晰的图片，或先在编辑器中修正局面。`,
    );
    error.statusCode = 422;
    throw error;
  }
  return boardToFen(board, turn);
}

function positionFromPayload(payload) {
  const rawTurn = payload.turn;
  const orientation = normalizeOrientation(payload.orientation);
  const matrixBoard = Array.isArray(payload.board)
    ? matrixToBoard(payload.board, payload.colors ?? payload.colorBoard)
    : null;
  const pieceBoard =
    Array.isArray(payload.pieces) && payload.pieces.length
      ? boardFromPieces(payload.pieces)
      : null;

  if (matrixBoard && pieceBoard) {
    const boardConflict =
      boardToFen(matrixBoard, "w") !== boardToFen(pieceBoard, "w");
    return {
      board: matrixBoard,
      fallbackBoards: boardConflict ? [pieceBoard] : [],
      boardConflict,
      turn: normalizeTurn(rawTurn),
      orientation,
    };
  }

  if (matrixBoard || pieceBoard) {
    return {
      board: matrixBoard || pieceBoard,
      turn: normalizeTurn(rawTurn),
      orientation,
    };
  }

  if (typeof payload.fen === "string" && payload.fen.trim()) {
    let parsed;
    try {
      parsed = parseFen(payload.fen);
    } catch (error) {
      const invalid = new Error(
        error instanceof Error ? error.message : String(error),
      );
      invalid.statusCode = 422;
      throw invalid;
    }
    return {
      board: parsed.board,
      turn: parsed.turn,
      orientation,
    };
  }

  return {
    board: matrixToBoard(payload.board, payload.colors ?? payload.colorBoard),
    turn: normalizeTurn(rawTurn),
    orientation,
  };
}

/**
 * 逐格比较棋盘矩阵与棋子列表，返回不一致的坐标，供纠错面板高亮。
 */
function boardCellConflicts(primary, secondary) {
  if (!Array.isArray(primary) || !Array.isArray(secondary)) return [];
  const conflicts = [];
  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const left = primary[row]?.[col] ?? ".";
      const right = secondary[row]?.[col] ?? ".";
      if (left !== right) {
        conflicts.push({ row, col, board: left, pieces: right });
      }
    }
  }
  return conflicts;
}

function parseVisionResponseDetails(content) {
  const payload = extractJsonObject(content);
  const source = positionFromPayload(payload);
  const boardCandidates = [source.board, ...(source.fallbackBoards || [])];
  let selectedBoard = null;
  let selectedIndex = -1;
  let canonical = null;
  let fen = "";
  let firstValidationError = null;

  for (const [index, board] of boardCandidates.entries()) {
    try {
      const candidateCanonical = canonicalizeBoardOrientation(
        board,
        source.orientation,
      );
      const candidateFen = validateRecognizedPosition(
        candidateCanonical.board,
        source.turn,
      );
      selectedBoard = board;
      selectedIndex = index;
      canonical = candidateCanonical;
      fen = candidateFen;
      break;
    } catch (error) {
      if (!firstValidationError) firstValidationError = error;
    }
  }

  if (!selectedBoard || !canonical) {
    throw firstValidationError || new Error("识图结果无法形成有效棋局。");
  }

  const notes = [
    cleanText(payload.notes || payload.description, 220),
    source.boardConflict
      ? selectedIndex === 0
        ? "棋盘矩阵与棋子列表有少量不一致，已按完整 10×9 矩阵载入。"
        : "棋盘矩阵无法独立成立，已按棋子列表载入。"
      : "",
    canonical.autoRotated ? "已自动校正棋盘上下方向。" : "",
    riverCrossingSummary(canonical.board),
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 300);

  const conflicts = source.boardConflict
    ? boardCellConflicts(source.board, source.fallbackBoards?.[0])
    : [];

  return {
    sourceBoard: selectedBoard,
    sourceOrientation: canonical.orientation,
    sourceTurn: source.turn,
    board: canonical.board,
    turn: source.turn,
    fen,
    notes,
    orientation: canonical.orientation,
    autoRotated: canonical.autoRotated,
    conflicts,
  };
}

export function parseVisionResponse(content) {
  const {
    sourceBoard: _sourceBoard,
    sourceOrientation: _sourceOrientation,
    sourceTurn: _sourceTurn,
    ...position
  } = parseVisionResponseDetails(content);
  return position;
}

function validateImageDataUrl(value) {
  const imageDataUrl = cleanText(value, MAX_IMAGE_DATA_URL_CHARS + 1);
  if (
    !imageDataUrl.startsWith("data:image/") ||
    !/^data:image\/(?:png|jpe?g|webp|bmp);base64,/i.test(imageDataUrl)
  ) {
    const error = new Error("请选择 PNG、JPG、WEBP 或 BMP 棋盘图片。");
    error.statusCode = 400;
    throw error;
  }
  if (imageDataUrl.length > MAX_IMAGE_DATA_URL_CHARS) {
    const error = new Error("图片处理后的数据仍然过大，请选择更小的图片。");
    error.statusCode = 413;
    throw error;
  }
  return imageDataUrl;
}

function modelError(response, payload) {
  const detail = cleanText(payload?.error?.message, 180);
  const error = new Error(
    response.status === 401
      ? "API Key 无效或已过期。"
      : detail || `视觉模型请求失败（${response.status}）。`,
  );
  error.statusCode =
    response.status >= 400 && response.status < 500 ? response.status : 502;
  return error;
}

async function requestVisionCompletion(
  {
    endpoint,
    apiKey,
    model,
    imageDataUrl,
    instruction,
    candidate,
    candidateLabel = "第一轮候选结果",
    fetchImpl,
    timeoutMs,
  },
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const userContent = [
    {
      type: "text",
      text: candidate
        ? `${instruction}\n\n${candidateLabel}如下。请重新独立检查原图，逐格核对颜色、字形、行列和遗漏，并返回修正后的完整结果：\n${candidate}`
        : instruction,
    },
    {
      type: "image_url",
      image_url: { url: imageDataUrl, detail: "high" },
    },
  ];

  try {
    let lastPayload = {};
    let useJsonResponseFormat = true;
    let responseAttempts = 0;
    let textAttempts = 0;
    while (textAttempts < 3 && responseAttempts < 4) {
      responseAttempts += 1;
      const retryInstruction =
        textAttempts > 0
          ? "\n\n上一条回答没有产生可用的最终 JSON。请不要再展开推理过程，直接返回最简合法 JSON；只保留 orientation、board、turn、notes，不要返回 pieces，也不要返回任何额外文字。"
          : "";
      const attemptContent = userContent.map((part) => {
        if (!retryInstruction || part.type !== "text") return part;
        return {
          ...part,
          text: `${part.text}${retryInstruction}`,
        };
      });
      const body = {
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: attemptContent },
        ],
        temperature: 0,
        top_p: 0.1,
        max_tokens: 8192,
        stream: false,
      };
      if (useJsonResponseFormat) {
        body.response_format = { type: "json_object" };
      }
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (
          useJsonResponseFormat &&
          (response.status === 400 || response.status === 422)
        ) {
          useJsonResponseFormat = false;
          continue;
        }
        throw modelError(response, payload);
      }
      lastPayload = payload;
      textAttempts += 1;
      const text = extractAssistantText(payload);
      if (text) return text;
    }
    throw emptyModelResponseError(model, lastPayload, textAttempts);
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("视觉模型请求超时，请稍后重试。");
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function candidatePayload(details) {
  return {
    coordinateSystem: "original-image",
    orientation: details.sourceOrientation || "unknown",
    board: details.sourceBoard.map((row) => row.join("")),
    pieces: details.sourceBoard
      .flatMap((row, r) => row.map((piece, c) => ({ r, c, piece })))
      .filter((item) => item.piece !== "."),
    turn: details.sourceTurn,
  };
}

function resultWithMetadata(details, model, passes, extraNotes = []) {
  const {
    sourceBoard: _sourceBoard,
    sourceOrientation: _sourceOrientation,
    sourceTurn: _sourceTurn,
    ...position
  } = details;
  return {
    ...position,
    model,
    passes,
    notes: [position.notes, ...extraNotes]
      .filter(Boolean)
      .join(" ")
      .slice(0, 300),
  };
}

export async function recognizePositionFromImage(
  { apiKey, model, imageDataUrl, refine = false } = {},
  {
    endpoint = DEFAULT_ENDPOINT,
    fetchImpl = fetch,
    timeoutMs = 60000,
  } = {},
) {
  // 密钥会进入 Authorization 请求头，必须先拦下中文/全角字符，见 deepseek-key.js。
  const key = normalizeApiKey(apiKey, { message: "请先填写 API Key。" });

  const selectedModel = sanitizeModel(model);
  const image = validateImageDataUrl(imageDataUrl);
  const requestContext = {
    endpoint,
    apiKey: key,
    model: selectedModel,
    imageDataUrl: image,
    instruction:
      "请识别这张中国象棋棋盘。严格按图片从上到下为 row 0 到 row 9、从左到右为 col 0 到 col 8，使用未经旋转的原图坐标，先判断红方在上还是在下，再逐枚列出全部棋子，并逐枚判断红兵、黑卒是否已经过河。",
    fetchImpl,
    timeoutMs,
  };

  let firstContent = await requestVisionCompletion(requestContext);
  let firstDetails = null;
  let firstError = null;
  let firstWasRepaired = false;
  try {
    firstDetails = parseVisionResponseDetails(firstContent);
  } catch (error) {
    firstError = error;
  }

  if (refine && !firstDetails) {
    try {
      const repairedContent = await requestVisionCompletion({
        ...requestContext,
        instruction:
          "上一条回答没有形成完整棋局 JSON。请重新查看原图，只返回一个合法 JSON 对象，并优先只返回 orientation、board、turn、notes；不要返回推理过程、pieces、Markdown 或额外文字。",
        candidate: cleanText(firstContent, 5000),
        candidateLabel: "上一次不完整输出",
      });
      firstDetails = parseVisionResponseDetails(repairedContent);
      firstContent = repairedContent;
      firstWasRepaired = true;
    } catch {
      // The independent second pass below still gets a chance to recover.
    }
  }

  if (!refine) {
    if (firstDetails) {
      return resultWithMetadata(firstDetails, selectedModel, 1);
    }
    try {
      const correctedContent = await requestVisionCompletion({
        ...requestContext,
        instruction:
          "上一条回答不是软件可解析的 JSON。请重新查看原图，并只返回一个合法 JSON 对象；不要返回分析过程、Markdown、代码围栏或额外说明。",
        candidate: cleanText(firstContent, 6000),
        candidateLabel: "上一次不合格输出",
      });
      const correctedDetails = parseVisionResponseDetails(correctedContent);
      return resultWithMetadata(correctedDetails, selectedModel, 2, [
        "首次输出格式不合格，已自动重新生成 JSON。",
      ]);
    } catch {
      throw firstError;
    }
  }

  const candidate = firstDetails
    ? JSON.stringify(candidatePayload(firstDetails))
    : cleanText(firstContent, 5000);
  let lastContent = firstContent;

  try {
    const secondContent = await requestVisionCompletion({
      ...requestContext,
      instruction:
        "请对这张中国象棋棋盘进行第二次独立复核。不要直接接受候选结果，必须重新查看原图并逐格比对。候选坐标和你的返回坐标都必须使用原图方向，绝对不要先旋转棋盘；发现任何颜色、字形、行列或遗漏错误都要改正。",
      candidate,
      candidateLabel: "第一轮原图坐标候选结果",
    });
    lastContent = secondContent;
    const secondDetails = parseVisionResponseDetails(secondContent);
    if (!firstDetails) {
      return resultWithMetadata(secondDetails, selectedModel, 2, [
        "第一轮结果无效，已采用第二次独立识别结果。",
      ]);
    }
    if (secondDetails.fen === firstDetails?.fen) {
      return resultWithMetadata(secondDetails, selectedModel, 2, [
        firstWasRepaired ? "第一轮已自动修复格式。" : "",
        "两次识别结果一致。",
      ].filter(Boolean));
    }

    try {
      const arbitrationContent = await requestVisionCompletion({
        ...requestContext,
        instruction:
          "请对这张中国象棋棋盘做最终仲裁识别。下面两次结果在部分棋子、颜色、方向或行列出入了不同答案。必须重新逐格查看原图，不要盲从任何一份候选；最终坐标继续使用原图方向，并返回你认为正确的完整结果。",
        candidate: JSON.stringify({
          first: candidatePayload(firstDetails),
          second: candidatePayload(secondDetails),
        }),
        candidateLabel: "前两次原图坐标候选结果",
      });
      const arbitrationDetails = parseVisionResponseDetails(arbitrationContent);
      const firstFen = firstDetails.fen;
      const secondFen = secondDetails.fen;
      const arbitrationFen = arbitrationDetails.fen;
      const matchingDetails =
        arbitrationFen === firstFen
          ? firstDetails
          : arbitrationFen === secondFen
            ? secondDetails
            : arbitrationDetails;
      return resultWithMetadata(matchingDetails, selectedModel, 3, [
        arbitrationFen === firstFen || arbitrationFen === secondFen
          ? "已完成第三次仲裁，最终结果与前两次中的一致结果相符。"
          : "已完成第三次仲裁，两次结果不一致，已采用仲裁结果。",
      ]);
    } catch (arbitrationError) {
      return resultWithMetadata(secondDetails, selectedModel, 2, [
        `两次结果不一致，追加仲裁未完成：${cleanText(
          arbitrationError instanceof Error
            ? arbitrationError.message
            : String(arbitrationError),
          80,
        )}`,
      ]);
    }
  } catch (error) {
    if (firstDetails) {
      return resultWithMetadata(firstDetails, selectedModel, 1, [
        firstWasRepaired ? "第一轮已自动修复格式。" : "",
        "智能复核未完成，已载入第一轮结果。",
      ].filter(Boolean));
    }
    try {
      const correctedContent = await requestVisionCompletion({
        ...requestContext,
        instruction:
          "前两次回答都没有形成可解析的棋局 JSON。请重新查看原图，只返回一个合法 JSON 对象；不要返回推理、解释、Markdown 或额外文本。",
        candidate: cleanText(lastContent, 6000),
        candidateLabel: "上一次不合格输出",
      });
      const correctedDetails = parseVisionResponseDetails(correctedContent);
      return resultWithMetadata(correctedDetails, selectedModel, 3, [
        "两次识别输出格式均不合格，已自动重新生成 JSON。",
      ]);
    } catch {
      throw error;
    }
  }
}

export { DEFAULT_ENDPOINT, DEFAULT_MODEL, MAX_IMAGE_DATA_URL_CHARS };
