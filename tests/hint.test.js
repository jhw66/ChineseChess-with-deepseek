import test from "node:test";
import assert from "node:assert/strict";
import { START_FEN, parseFen } from "../src/xiangqi.js";
import { selectHintMove } from "../src/hint.js";

test("the first principal variation move becomes the hint when legal", () => {
  const parsed = parseFen(START_FEN);
  const move = selectHintMove(parsed.board, parsed.turn, ["b2e2", "h9g7"]);
  assert.deepEqual(move, { from: [7, 1], to: [7, 4] });
});

test("an illegal or malformed principal variation does not become a hint", () => {
  const parsed = parseFen(START_FEN);
  assert.equal(selectHintMove(parsed.board, parsed.turn, ["a0b0"]), null);
  assert.equal(selectHintMove(parsed.board, parsed.turn, ["a0a3"]), null);
  assert.equal(selectHintMove(parsed.board, parsed.turn, ["not-a-move"]), null);
  assert.equal(selectHintMove(parsed.board, parsed.turn, []), null);
});
