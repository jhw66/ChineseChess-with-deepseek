import { normalizeApiKey } from "./deepseek-key.js";

const DEFAULT_ENDPOINT = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "deepseek-flash";
const MAX_COMMENTARY_CHARS = 42;

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
  // Keep the five-second voice budget predictable. Without this, flash may
  // spend the entire token allowance on hidden reasoning and return no text.
  return /^deepseek-flash(?:$|[-.])/i.test(model)
    ? { thinking: { type: "disabled" } }
    : {};
}

function formatContext(context = {}) {
  const lastMove = context.lastMove ?? {};
  return JSON.stringify(
    {
      lastMove: {
        side: cleanText(lastMove.side, 16),
        notation: cleanText(lastMove.notation, 32),
        description: cleanText(lastMove.description, 80),
      },
      fen: cleanText(context.fen, 160),
      turn: cleanText(context.turn, 16),
      moveCount: Number(context.moveCount) || 0,
      gameState: cleanText(context.gameState, 40),
      engineScore: cleanText(context.engineScore, 24),
      engineDepth: cleanText(context.engineDepth, 24),
      principalVariation: cleanText(context.principalVariation, 400),
    },
    null,
    2,
  );
}

export async function generateDeepSeekCommentary(
  { apiKey, model, context } = {},
  { endpoint = DEFAULT_ENDPOINT, fetchImpl = fetch, timeoutMs = 20000 } = {},
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
          {
            role: "system",
            content:
              "你是中国象棋直播间的短评员。只输出一句很短的中文吐槽，建议 12 到 28 个字，最多 32 个字，确保 1.5 倍速朗读能在 5 秒内说完。语气自然、幽默但不侮辱人；最后一步有记录时优先点评这一步，否则点评当前局势。不要编造走法，不要重复上一段，不要提及数据格式，不要输出 Markdown、引号、表情或解释。",
          },
          {
            role: "user",
            content: formatContext(context),
          },
        ],
        temperature: 1.1,
        max_tokens: 48,
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
      error.statusCode = response.status >= 400 && response.status < 500 ? response.status : 502;
      throw error;
    }

    const text = cleanText(
      payload?.choices?.[0]?.message?.content,
      MAX_COMMENTARY_CHARS,
    );
    if (!text) {
      const error = new Error("DeepSeek 没有返回可朗读的内容。");
      error.statusCode = 502;
      throw error;
    }
    return { text, model: selectedModel };
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("DeepSeek 请求超时，请稍后重试。");
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export { DEFAULT_ENDPOINT, DEFAULT_MODEL };
