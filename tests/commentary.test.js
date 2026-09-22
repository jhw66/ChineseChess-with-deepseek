import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ENDPOINT,
  DEFAULT_MODEL,
  generateDeepSeekCommentary,
} from "../src/commentary.js";

test("DeepSeek commentary sends a compact OpenAI-compatible request", async () => {
  let request = null;
  const result = await generateDeepSeekCommentary(
    {
      apiKey: "test-key",
      model: "deepseek-flash",
      context: {
        lastMove: {
          side: "red",
          notation: "h2e2",
          description: "炮二平五",
        },
        fen: "test-fen",
        turn: "black",
        moveCount: 1,
      },
    },
    {
      fetchImpl: async (url, options) => {
        request = { url, options };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: "这一炮摆得挺有气势。" } }],
          }),
        };
      },
    },
  );

  assert.equal(request.url, DEFAULT_ENDPOINT);
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "Bearer test-key");
  const body = JSON.parse(request.options.body);
  assert.equal(body.model, DEFAULT_MODEL);
  assert.equal(body.stream, false);
  assert.equal(body.max_tokens, 48);
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.match(body.messages[1].content, /h2e2/);
  assert.match(body.messages[0].content, /5 秒|1\.5 倍速/);
  assert.equal(result.text, "这一炮摆得挺有气势。");
});

test("DeepSeek commentary does not send flash-only thinking options to chat", async () => {
  let request = null;
  await generateDeepSeekCommentary(
    {
      apiKey: "test-key",
      model: "deepseek-chat",
      context: {},
    },
    {
      fetchImpl: async (_url, options) => {
        request = options;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: "这一步很稳。" } }],
          }),
        };
      },
    },
  );

  assert.equal(Object.hasOwn(JSON.parse(request.body), "thinking"), false);
});

test("DeepSeek commentary rejects a missing API key before network access", async () => {
  await assert.rejects(
    () =>
      generateDeepSeekCommentary(
        { apiKey: "", context: {} },
        {
          fetchImpl: async () => {
            throw new Error("network should not be reached");
          },
        },
      ),
    (error) => error.statusCode === 400,
  );
});

test("DeepSeek commentary exposes a useful authorization error", async () => {
  await assert.rejects(
    () =>
      generateDeepSeekCommentary(
        { apiKey: "bad-key", context: {} },
        {
          fetchImpl: async () => ({
            ok: false,
            status: 401,
            json: async () => ({ error: { message: "Unauthorized" } }),
          }),
        },
      ),
    (error) => error.statusCode === 401 && /API Key/.test(error.message),
  );
});
