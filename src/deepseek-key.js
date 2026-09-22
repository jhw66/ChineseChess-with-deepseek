/**
 * DeepSeek API Key 的归一化与前置校验。
 *
 * 为什么需要这一步：密钥最终会进入 HTTP 请求头（Authorization: Bearer <key>），
 * 而 HTTP 头在规范里只能承载 Latin-1（WHATWG 的 ByteString）。只要密钥里混进
 * 中文、全角字符或换行，浏览器与 Node 的 fetch 就会抛出
 *
 *   Cannot convert argument to a ByteString because the character at
 *   index 75 has a value of 39034 which is greater than 255.
 *
 * 这条报错既看不出是密钥的问题，也看不出该改哪里。与其把原始异常抛给用户，
 * 不如在这里提前拦住，换成一句能照着修的提示。
 */

const MAX_API_KEY_LENGTH = 512;
// 可见 ASCII：字母、数字，以及密钥常见的 - _ . : 等符号；空格与换行一律不接受。
const API_KEY_PATTERN = /^[\x21-\x7e]+$/;

export function normalizeApiKey(
  value,
  { message = "请先填写 DeepSeek API Key。" } = {},
) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  }
  if (raw.length > MAX_API_KEY_LENGTH) {
    const error = new Error(
      "DeepSeek API Key 过长，请确认没有把说明文字一起粘进输入框。",
    );
    error.statusCode = 400;
    throw error;
  }
  if (!API_KEY_PATTERN.test(raw)) {
    const error = new Error(
      "DeepSeek API Key 内含中文、全角字符或空格，请只粘贴密钥本身（通常以 sk- 开头）。",
    );
    error.statusCode = 400;
    throw error;
  }
  return raw;
}

export { MAX_API_KEY_LENGTH, API_KEY_PATTERN };
