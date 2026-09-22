import test from "node:test";
import assert from "node:assert/strict";
import { normalizeApiKey } from "../src/deepseek-key.js";
import { generateDeepSeekCommentary } from "../src/commentary.js";
import { generateCoachAnalysis } from "../src/coach.js";

test("normalizeApiKey keeps an ordinary ASCII key intact", () => {
  assert.equal(normalizeApiKey("  sk-abc123_DEF.456  "), "sk-abc123_DEF.456");
});

test("normalizeApiKey rejects a key polluted with Chinese characters", () => {
  // 这正是「Cannot convert argument to a ByteString ... index 75 ...
  // value of 39034」那条报错的来源：密钥里混进了中文，进入 Authorization
  // 请求头后被 fetch 拒绝。
  const polluted = `sk-${"a".repeat(64)}顺炮`;
  assert.throws(
    () => normalizeApiKey(polluted),
    (error) => error.statusCode === 400 && /中文|全角/.test(error.message),
  );
});

test("normalizeApiKey rejects keys containing spaces or newlines", () => {
  assert.throws(
    () => normalizeApiKey("sk-abc def"),
    (error) => error.statusCode === 400,
  );
  assert.throws(
    () => normalizeApiKey("sk-abc\ndef"),
    (error) => error.statusCode === 400,
  );
});

test("commentary fails fast on a polluted key instead of throwing a ByteString error", async () => {
  let reached = false;
  await assert.rejects(
    () =>
      generateDeepSeekCommentary(
        { apiKey: `sk-${"a".repeat(64)}顺`, context: {} },
        {
          fetchImpl: async () => {
            reached = true;
            throw new Error("network should not be reached");
          },
        },
      ),
    (error) => error.statusCode === 400 && !/ByteString/.test(error.message),
  );
  assert.equal(reached, false);
});

test("coach analysis fails fast on a polluted key", async () => {
  await assert.rejects(
    () =>
      generateCoachAnalysis(
        { apiKey: `sk-${"a".repeat(64)}顺`, context: {} },
        {
          fetchImpl: async () => {
            throw new Error("network should not be reached");
          },
        },
      ),
    (error) => error.statusCode === 400 && !/ByteString/.test(error.message),
  );
});
