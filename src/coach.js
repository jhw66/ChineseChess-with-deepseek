import { normalizeApiKey } from "./deepseek-key.js";

const DEFAULT_ENDPOINT = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "deepseek-flash";
const MAX_REPORT_CHARS = 1200;

export const COACH_SYSTEM_PROMPT =
  "你是一位专业的中国象棋教练。请结合提供的 FEN 局面、上一手棋，以及引擎推荐的最优解，用通俗易懂的语言分析：为什么引擎推荐的这一步是最优的？上一手棋是失误还是好棋？接下来的战术意图是什么？用中文回答，分成三小段，每段两三句话，总共不超过 300 字。不要编造不存在的走法，不要输出 Markdown 标题、代码块或表情。";

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function sanitizeModel(value) {
  const model = cleanText(value, 64) || DEFAULT_MODEL;
  if (!/^[a-zA-Z0-9._:-]+$/.test(model)) {
    const error = new Error("DeepSeek 模型名称格式不正确。");
    error.statusCode = 400;
    throw error;
  }
  return model;
}

function requestThinkingOptions(model) {
  // deepseek-flash is a hybrid/reasoning model. For short commentary and
  // tactical summaries, reasoning tokens can consume the whole max_tokens
  // budget and leave an empty content field. Disable thinking only for the
  // model that supports this option; chat models reject unknown arguments.
  return /^deepseek-flash(?:$|[-.])/i.test(model)
    ? { thinking: { type: "disabled" } }
    : {};
}

function describeLastMove(lastMove) {
  if (!lastMove) return "无（当前是开局或刚载入的局面）";
  const side =
    lastMove.side === "w" ? "红方" : lastMove.side === "b" ? "黑方" : "";
  const notation = cleanText(lastMove.notation, 32);
  const description = cleanText(lastMove.description, 80);
  const parts = [side, notation, description].filter(Boolean);
  return parts.length ? parts.join(" ") : "无";
}

export function formatCoachContext(context = {}) {
  const engine = context.engine ?? {};
  return [
    `当前 FEN：${cleanText(context.fen, 160) || "未知"}`,
    `行棋方：${context.turn === "b" ? "黑方" : "红方"}`,
    `上一手棋：${describeLastMove(context.lastMove)}`,
    `引擎推荐最优着法：${cleanText(engine.bestMove, 24) || "暂无"}${
      engine.bestChinese ? `（${cleanText(engine.bestChinese, 32)}）` : ""
    }`,
    `引擎评分：${cleanText(engine.score, 24) || "暂无"}`,
    `搜索深度：${cleanText(engine.depth, 24) || "暂无"}`,
    `主要变化：${cleanText(engine.principalVariation, 400) || "暂无"}`,
    `当前第几手：${Number(context.moveCount) || 0}`,
    `局面状态：${cleanText(context.gameState, 40) || "进行中"}`,
  ].join("\n");
}

export async function generateCoachAnalysis(
  { apiKey, model, context } = {},
  { endpoint = DEFAULT_ENDPOINT, fetchImpl = fetch, timeoutMs = 60000 } = {},
) {
  // 密钥会进入 Authorization 请求头，必须先拦下中文/全角字符，见 deepseek-key.js。
  const key = normalizeApiKey(apiKey);

  const selectedModel = sanitizeModel(model);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: "system", content: COACH_SYSTEM_PROMPT },
          { role: "user", content: formatCoachContext(context) },
        ],
        temperature: 0.6,
        max_tokens: 700,
        stream: false,
        ...requestThinkingOptions(selectedModel),
      }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = cleanText(payload?.error?.message, 180);
      const error = new Error(
        response.status === 401
          ? "DeepSeek API Key 无效或已过期。"
          : detail || `DeepSeek 请求失败（${response.status}）。`,
      );
      error.statusCode =
        response.status >= 400 && response.status < 500 ? response.status : 502;
      throw error;
    }

    const text = cleanText(
      payload?.choices?.[0]?.message?.content,
      MAX_REPORT_CHARS,
    );
    if (!text) {
      const error = new Error("DeepSeek 没有返回战术分析内容。");
      error.statusCode = 502;
      throw error;
    }
    return { text, model: selectedModel };
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("DeepSeek 战术分析超时，请稍后重试。");
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export { DEFAULT_ENDPOINT, DEFAULT_MODEL, MAX_REPORT_CHARS };
