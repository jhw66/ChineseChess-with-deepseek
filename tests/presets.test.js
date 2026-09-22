import test from "node:test";
import assert from "node:assert/strict";
import { ENDGAME_PRESETS } from "../src/presets.js";
import { parseFen, validatePosition } from "../src/xiangqi.js";

test("built-in endgame presets are valid positions", () => {
  for (const preset of ENDGAME_PRESETS) {
    const parsed = parseFen(preset.fen);
    const validation = validatePosition(parsed.board, parsed.turn);
    assert.equal(validation.ok, true, `${preset.name}: ${validation.message}`);
  }
});
