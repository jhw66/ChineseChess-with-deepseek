import test from "node:test";
import assert from "node:assert/strict";
import { START_FEN, boardToFen } from "../src/xiangqi.js";
import {
  DEFAULT_ENDPOINT,
  DEFAULT_MODEL,
  parseVisionResponse,
  recognizePositionFromImage,
} from "../src/vision.js";

const START_MATRIX = START_FEN.split(" ")[0]
  .split("/")
  .map((rank) =>
    rank
      .replace(/[1-9]/g, (value) => ".".repeat(Number(value)))
      .split(""),
  );

const IMAGE_ONE_MATRIX = [
  ".........",
  ".........",
  "..bak.c..",
  "....a....",
  "..n.b....",
  "....ncp..",
  "p...R...p",
  "..p.p.p..",
  "....b....",
  "..BAK...n",
].map((row) => row.split(""));

const IMAGE_ONE_FEN =
  "9/9/2bak1c2/4a4/2n1b4/4ncp2/p3R3p/2p1p1p2/4b4/2BAK3n w - - 0 1";

const IMAGE_TWO_MATRIX = [
  "..BAK.C..",
  "....A....",
  "..N.B....",
  "....NcP..",
  "P...R...P",
  "..p.p.p..",
  "p.......p",
  "....b....",
  "....a....",
  "..bak..n.",
].map((row) => row.split(""));

const IMAGE_TWO_FEN =
  "1n2kab2/4a4/4b4/p7p/2p1p1p2/P3R3P/2PcN4/4B1N2/4A4/2C1KAB2 w - - 0 1";

function rotateMatrix(matrix) {
  return Array.from({ length: 10 }, (_, row) =>
    Array.from({ length: 9 }, (_, col) => matrix[9 - row][8 - col]),
  );
}

function matrixToPieces(matrix) {
  const pieces = [];
  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const piece = matrix[row][col];
      if (piece === ".") continue;
      pieces.push({
        r: row,
        c: col,
        piece,
        color: piece === piece.toUpperCase() ? "red" : "black",
      });
    }
  }
  return pieces;
}

test("a strict 10 by 9 vision matrix becomes a standard FEN", () => {
  const result = parseVisionResponse(
    JSON.stringify({
      board: START_MATRIX,
      turn: "w",
      notes: "标准开局",
    }),
  );
  assert.equal(result.fen, START_FEN);
  assert.equal(result.turn, "w");
  assert.equal(result.autoRotated, false);
});

test("side-specific Chinese glyphs are normalized", () => {
  const matrix = START_MATRIX.map((row) => row.slice());
  matrix[9][4] = "帅";
  matrix[0][4] = "将";
  const result = parseVisionResponse(
    "```json\n" +
      JSON.stringify({ board: matrix, turn: "black" }) +
      "\n```",
  );
  assert.equal(result.board[9][4], "K");
  assert.equal(result.board[0][4], "k");
  assert.equal(result.turn, "b");
});

test("piece color overrides shared Chinese glyph variants", () => {
  const pieces = [
    { r: 9, c: 4, glyph: "帅", color: "red" },
    { r: 8, c: 4, glyph: "仕", color: "red" },
    { r: 7, c: 2, glyph: "馬", color: "red" },
    { r: 1, c: 4, glyph: "士", color: "black" },
    { r: 2, c: 2, glyph: "马", color: "black" },
    { r: 0, c: 4, glyph: "将", color: "black" },
  ];
  const result = parseVisionResponse(
    JSON.stringify({ orientation: "red-bottom", pieces, turn: "w" }),
  );
  assert.equal(result.board[7][2], "N");
  assert.equal(result.board[2][2], "n");
  assert.equal(result.autoRotated, false);
});

test("vision parsing repairs prefixed fenced JSON and common formatting", () => {
  const boardText = START_MATRIX.map((row) => `'${row.join("")}'`).join(
    ",\n",
  );
  const result = parseVisionResponse(
    `识别结果如下：
\`\`\`json
{
  orientation: 'red-bottom',
  board: [
${boardText},
  ],
  turn: 'w',
}
\`\`\`
请核对。`,
  );
  assert.equal(result.fen, START_FEN);
  assert.equal(result.orientation, "red-bottom");
});

test("vision parsing recovers a plain ten-row text board", () => {
  const result = parseVisionResponse(
    START_MATRIX.map((row, index) => `row ${index}: ${row.join("")}`).join(
      "\n",
    ),
  );
  assert.equal(result.fen, START_FEN);
});

test("a red-at-top image is automatically rotated to the standard side", () => {
  const rotated = rotateMatrix(START_MATRIX);
  const result = parseVisionResponse(
    JSON.stringify({
      orientation: "red-top",
      pieces: matrixToPieces(rotated),
      turn: "w",
    }),
  );
  assert.equal(result.autoRotated, true);
  assert.equal(result.orientation, "red-top");
  assert.equal(result.fen, START_FEN);
  assert.match(result.notes, /自动校正/);
});

test("a base-row FEN from a rotated screenshot is also corrected", () => {
  const rotated = rotateMatrix(START_MATRIX);
  const result = parseVisionResponse(
    JSON.stringify({
      fen: boardToFen(rotated, "w"),
      orientation: "red-top",
    }),
  );
  assert.equal(result.fen, START_FEN);
  assert.equal(result.autoRotated, true);
});

test("the first real screenshot is recognized in red-bottom coordinates", () => {
  const result = parseVisionResponse(
    JSON.stringify({
      orientation: "red-bottom",
      board: IMAGE_ONE_MATRIX.map((row) => row.join("")),
      turn: "w",
    }),
  );
  assert.equal(result.fen, IMAGE_ONE_FEN);
  assert.equal(result.orientation, "red-bottom");
  assert.equal(result.autoRotated, false);
  assert.deepEqual(result.board[9], "..BAK...n".split(""));
});

test("the second real screenshot uses image coordinates and auto-rotates", () => {
  const result = parseVisionResponse(
    JSON.stringify({
      orientation: "red-top",
      pieces: matrixToPieces(IMAGE_TWO_MATRIX),
      turn: "w",
    }),
  );
  assert.equal(result.fen, IMAGE_TWO_FEN);
  assert.equal(result.orientation, "red-top");
  assert.equal(result.autoRotated, true);
  assert.deepEqual(result.board[0], ".n..kab..".split(""));
  assert.deepEqual(result.board[9], "..C.KAB..".split(""));
  assert.match(result.notes, /红兵 0 枚已过河/);
  assert.match(result.notes, /黑卒 0 枚已过河/);
});

test("recognized pawns report river crossings after orientation correction", () => {
  const matrix = START_MATRIX.map((row) => row.slice());
  matrix[6][0] = ".";
  matrix[4][0] = "P";
  matrix[3][0] = ".";
  matrix[5][0] = "p";
  const result = parseVisionResponse(
    JSON.stringify({ board: matrix, turn: "w" }),
  );
  assert.match(result.notes, /红兵 1 枚已过河/);
  assert.match(result.notes, /黑卒 1 枚已过河/);
});

test("vision recognition sends a detailed cell-scan image request", async () => {
  let request = null;
  const result = await recognizePositionFromImage(
    {
      apiKey: "test-key",
      imageDataUrl: "data:image/png;base64,AAAA",
    },
    {
      fetchImpl: async (url, options) => {
        request = { url, options };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    orientation: "red-bottom",
                    pieces: matrixToPieces(START_MATRIX),
                    turn: "w",
                  }),
                },
              },
            ],
          }),
        };
      },
    },
  );

  assert.equal(request.url, DEFAULT_ENDPOINT);
  assert.equal(request.options.headers.Authorization, "Bearer test-key");
  const body = JSON.parse(request.options.body);
  assert.equal(body.model, DEFAULT_MODEL);
  assert.equal(DEFAULT_MODEL, "deepseek-flash");
  assert.equal(body.max_tokens, 8192);
  assert.equal(body.response_format.type, "json_object");
  assert.equal(body.messages[1].content[1].type, "image_url");
  assert.equal(
    body.messages[1].content[1].image_url.url,
    "data:image/png;base64,AAAA",
  );
  assert.match(body.messages[0].content, /不能由字形或上下位置决定/);
  assert.match(body.messages[0].content, /绝对不能省略上方或下方的空行/);
  assert.match(body.messages[0].content, /逐枚判断兵\/卒是否已经过河/);
  assert.match(body.messages[1].content[0].text, /row 0 到 row 9/);
  assert.equal(result.fen, START_FEN);
  assert.equal(result.passes, 1);
});

test("an unsupported JSON response format is retried without that option", async () => {
  const bodies = [];
  const result = await recognizePositionFromImage(
    {
      apiKey: "test-key",
      imageDataUrl: "data:image/png;base64,AAAA",
    },
    {
      fetchImpl: async (_url, options) => {
        bodies.push(JSON.parse(options.body));
        if (bodies.length === 1) {
          return {
            ok: false,
            status: 400,
            json: async () => ({
              error: { message: "response_format is not supported" },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    board: START_MATRIX,
                    turn: "w",
                  }),
                },
              },
            ],
          }),
        };
      },
    },
  );

  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].response_format.type, "json_object");
  assert.equal("response_format" in bodies[1], false);
  assert.equal(result.fen, START_FEN);
});

test("a non-JSON first answer is automatically regenerated", async () => {
  let calls = 0;
  const result = await recognizePositionFromImage(
    {
      apiKey: "test-key",
      imageDataUrl: "data:image/png;base64,AAAA",
    },
    {
      fetchImpl: async () => {
        calls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content:
                    calls === 1
                      ? "这是一张中国象棋棋盘图片，但我没有返回 JSON。"
                      : JSON.stringify({
                          board: START_MATRIX,
                          turn: "w",
                        }),
                },
              },
            ],
          }),
        };
      },
    },
  );

  assert.equal(calls, 2);
  assert.equal(result.fen, START_FEN);
  assert.equal(result.passes, 2);
  assert.match(result.notes, /重新生成 JSON/);
});

test("vision recognition accepts array and alternate text response shapes", async () => {
  const responses = [
    {
      choices: [
        {
          message: {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  orientation: "red-bottom",
                  pieces: matrixToPieces(START_MATRIX),
                  turn: "w",
                }),
              },
            ],
          },
        },
      ],
    },
    {
      choices: [
        {
          message: {
            text: JSON.stringify({
              orientation: "red-bottom",
              pieces: matrixToPieces(START_MATRIX),
              turn: "w",
            }),
          },
        },
      ],
    },
    {
      choices: [
        {
          text: JSON.stringify({
            orientation: "red-bottom",
            pieces: matrixToPieces(START_MATRIX),
            turn: "w",
          }),
        },
      ],
    },
  ];
  let calls = 0;
  const result = await recognizePositionFromImage(
    {
      apiKey: "test-key",
      model: "deepseek-vl2",
      imageDataUrl: "data:image/png;base64,AAAA",
    },
    {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => responses[calls++],
      }),
    },
  );

  assert.equal(calls, 1);
  assert.equal(result.fen, START_FEN);
});

test("an empty first response is retried once before failing", async () => {
  let calls = 0;
  const result = await recognizePositionFromImage(
    {
      apiKey: "test-key",
      model: "deepseek-vl2",
      imageDataUrl: "data:image/png;base64,AAAA",
    },
    {
      fetchImpl: async () => {
        calls += 1;
        return {
          ok: true,
          status: 200,
          json: async () =>
            calls === 1
              ? {
                  choices: [
                    { message: { content: "" }, finish_reason: "length" },
                  ],
                }
              : {
                  choices: [
                    {
                      message: {
                        content: JSON.stringify({
                          orientation: "red-bottom",
                          pieces: matrixToPieces(START_MATRIX),
                          turn: "w",
                        }),
                      },
                    },
                  ],
                },
        };
      },
    },
  );

  assert.equal(calls, 2);
  assert.equal(result.fen, START_FEN);
});

test("an empty response reports the model and finish reason", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      recognizePositionFromImage(
        {
          apiKey: "test-key",
          model: "deepseek-flash",
          imageDataUrl: "data:image/png;base64,AAAA",
        },
        {
          fetchImpl: async () => {
            calls += 1;
            return {
              ok: true,
              status: 200,
              json: async () => ({
                choices: [
                  { message: { content: "" }, finish_reason: "length" },
                ],
              }),
            };
          },
        },
      ),
    (error) =>
      error.statusCode === 502 &&
      /deepseek-flash/.test(error.message) &&
      /length/.test(error.message),
  );
  assert.equal(calls, 3);
});

test("truncated reasoning text is retried instead of being parsed as an answer", async () => {
  let calls = 0;
  const result = await recognizePositionFromImage(
    {
      apiKey: "test-key",
      model: "deepseek-flash",
      imageDataUrl: "data:image/png;base64,AAAA",
    },
    {
      fetchImpl: async () => {
        calls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message:
                  calls === 1
                    ? {
                        content: "",
                        reasoning_content:
                          '{"orientation":"red-top","board":["..BAK.C..',
                      }
                    : {
                        content: JSON.stringify({
                          orientation: "red-bottom",
                          board: START_MATRIX,
                          turn: "w",
                        }),
                      },
                finish_reason: calls === 1 ? "length" : "stop",
              },
            ],
          }),
        };
      },
    },
  );

  assert.equal(calls, 2);
  assert.equal(result.fen, START_FEN);
});

test("a valid board matrix remains authoritative when optional pieces differ", () => {
  const pieces = matrixToPieces(START_MATRIX);
  const movedPawn = pieces.find((piece) => piece.r === 6 && piece.c === 0);
  movedPawn.r = 5;
  const result = parseVisionResponse(
    JSON.stringify({
      orientation: "red-bottom",
      board: START_MATRIX,
      pieces,
      turn: "w",
    }),
  );

  assert.equal(result.fen, START_FEN);
  assert.match(result.notes, /完整 10×9 矩阵/);
});

test("refine mode performs an independent second pass and uses its correction", async () => {
  let calls = 0;
  let secondBody = null;

  const result = await recognizePositionFromImage(
    {
      apiKey: "test-key",
      model: "deepseek-vl2",
      imageDataUrl: "data:image/png;base64,AAAA",
      refine: true,
    },
    {
      fetchImpl: async (_url, options) => {
        calls += 1;
        const body = JSON.parse(options.body);
        if (calls === 2) secondBody = body;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    board: START_MATRIX,
                    turn: "w",
                  }),
                },
              },
            ],
          }),
        };
      },
    },
  );

  assert.equal(calls, 2);
  assert.equal(result.passes, 2);
  assert.equal(result.fen, START_FEN);
  assert.match(secondBody.messages[1].content[0].text, /第二次独立复核/);
  assert.match(secondBody.messages[1].content[0].text, /第一轮原图坐标候选结果/);
});

test("red-top refine candidates remain in original image coordinates", async () => {
  let calls = 0;
  let secondBody = null;
  const result = await recognizePositionFromImage(
    {
      apiKey: "test-key",
      model: "deepseek-vl2",
      imageDataUrl: "data:image/png;base64,AAAA",
      refine: true,
    },
    {
      fetchImpl: async (_url, options) => {
        calls += 1;
        const body = JSON.parse(options.body);
        if (calls === 2) secondBody = body;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    orientation: "red-top",
                    pieces: matrixToPieces(IMAGE_TWO_MATRIX),
                    turn: "w",
                  }),
                },
              },
            ],
          }),
        };
      },
    },
  );

  const prompt = secondBody.messages[1].content[0].text;
  const candidate = JSON.parse(prompt.slice(prompt.indexOf("{")));
  assert.equal(calls, 2);
  assert.equal(result.fen, IMAGE_TWO_FEN);
  assert.equal(candidate.coordinateSystem, "original-image");
  assert.equal(candidate.orientation, "red-top");
  assert.deepEqual(
    candidate.pieces.find(
      (piece) => piece.r === 0 && piece.c === 2 && piece.piece === "B",
    ),
    { r: 0, c: 2, piece: "B" },
  );
  assert.equal(
    candidate.pieces.some(
      (piece) => piece.r === 9 && piece.c === 4 && piece.piece === "K",
    ),
    false,
  );
});

test("refine mode arbitrates when the two independent passes disagree", async () => {
  let calls = 0;
  let thirdBody = null;
  const result = await recognizePositionFromImage(
    {
      apiKey: "test-key",
      model: "deepseek-vl2",
      imageDataUrl: "data:image/png;base64,AAAA",
      refine: true,
    },
    {
      fetchImpl: async (_url, options) => {
        calls += 1;
        const body = JSON.parse(options.body);
        if (calls === 3) thirdBody = body;
        const matrix = calls === 2 ? IMAGE_TWO_MATRIX : IMAGE_ONE_MATRIX;
        const orientation = calls === 2 ? "red-top" : "red-bottom";
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    orientation,
                    pieces: matrixToPieces(matrix),
                    turn: "w",
                  }),
                },
              },
            ],
          }),
        };
      },
    },
  );

  assert.equal(calls, 3);
  assert.equal(result.passes, 3);
  assert.equal(result.fen, IMAGE_ONE_FEN);
  assert.match(thirdBody.messages[1].content[0].text, /前两次原图坐标候选结果/);
});

test("vision recognition rejects incomplete boards and missing keys", async () => {
  assert.throws(
    () =>
      parseVisionResponse(
        JSON.stringify({ board: START_MATRIX.slice(0, 9), turn: "w" }),
      ),
    (error) => error.statusCode === 502 && /10 行/.test(error.message),
  );

  await assert.rejects(
    () =>
      recognizePositionFromImage(
        { apiKey: "", imageDataUrl: "data:image/png;base64,AAAA" },
        {
          fetchImpl: async () => {
            throw new Error("network should not be reached");
          },
        },
      ),
    (error) => error.statusCode === 400,
  );
});

test("text-only DeepSeek models are rejected before a network request", async () => {
  await assert.rejects(
    () =>
      recognizePositionFromImage(
        {
          apiKey: "test-key",
          model: "deepseek-chat",
          imageDataUrl: "data:image/png;base64,AAAA",
        },
        {
          fetchImpl: async () => {
            throw new Error("network should not be reached");
          },
        },
      ),
    (error) => error.statusCode === 400 && /不能可靠识图/.test(error.message),
  );
});

test("vision recognition validates direct FEN and recognized board positions", () => {
  assert.throws(
    () =>
      parseVisionResponse(
        JSON.stringify({
          fen: "4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1",
        }),
      ),
    (error) =>
      error.statusCode === 422 &&
      /正被将军|对方帅将|上下方向/.test(error.message),
  );

  const invalidMatrix = START_MATRIX.map((row) => row.slice());
  invalidMatrix[9][3] = "K";
  assert.throws(
    () =>
      parseVisionResponse(
        JSON.stringify({ board: invalidMatrix, turn: "w" }),
      ),
    (error) => error.statusCode === 422,
  );
});
