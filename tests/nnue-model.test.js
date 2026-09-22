import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureNnueModel } from "../src/nnue-model.js";

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function temporaryEngineDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "xiangqi-nnue-"));
}

test("assembles verified NNUE parts and reuses the completed model", () => {
  const engineDir = temporaryEngineDir();
  const partsDir = path.join(engineDir, "nnue-parts");
  fs.mkdirSync(partsDir);
  fs.writeFileSync(path.join(partsDir, "pikafish.nnue.part001"), "abc");
  fs.writeFileSync(path.join(partsDir, "pikafish.nnue.part002"), "def");

  const options = {
    expectedSize: 6,
    expectedSha256: sha256("abcdef"),
    logger: { log() {} },
  };
  const first = ensureNnueModel(engineDir, options);
  assert.equal(first.assembled, true);
  assert.equal(fs.readFileSync(path.join(engineDir, "pikafish.nnue"), "utf8"), "abcdef");

  const second = ensureNnueModel(engineDir, options);
  assert.equal(second.assembled, false);
});

test("rejects missing or corrupted NNUE parts", () => {
  const missingDir = temporaryEngineDir();
  assert.throws(
    () =>
      ensureNnueModel(missingDir, {
        expectedSize: 1,
        expectedSha256: sha256("x"),
        logger: { log() {} },
      }),
    /model is missing/,
  );

  const corruptDir = temporaryEngineDir();
  const corruptPartsDir = path.join(corruptDir, "nnue-parts");
  fs.mkdirSync(corruptPartsDir);
  fs.writeFileSync(path.join(corruptPartsDir, "pikafish.nnue.part001"), "abc");
  assert.throws(
    () =>
      ensureNnueModel(corruptDir, {
        expectedSize: 3,
        expectedSha256: sha256("def"),
        logger: { log() {} },
      }),
    /failed SHA-256 verification/,
  );
});
