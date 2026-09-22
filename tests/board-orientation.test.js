import assert from "node:assert/strict";
import test from "node:test";
import {
  boardPointToDisplay,
  displayPointToBoard,
} from "../src/board-orientation.js";

test("unflipped board coordinates stay unchanged", () => {
  assert.deepEqual(boardPointToDisplay([0, 0], false), [0, 0]);
  assert.deepEqual(displayPointToBoard([9, 8], false), [9, 8]);
});

test("flipped board coordinates rotate by 180 degrees", () => {
  assert.deepEqual(boardPointToDisplay([0, 0], true), [9, 8]);
  assert.deepEqual(displayPointToBoard([9, 8], true), [0, 0]);
});

test("display and board mappings are inverses while flipped", () => {
  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const display = boardPointToDisplay([row, col], true);
      assert.deepEqual(displayPointToBoard(display, true), [row, col]);
    }
  }
});
