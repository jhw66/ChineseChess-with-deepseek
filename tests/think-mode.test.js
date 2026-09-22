import assert from "node:assert/strict";
import test from "node:test";

import {
  ENGINE_THINK_MODES,
  LOW_POWER_SETTINGS,
  collectResourceWarnings,
  normalizeEngineThinkMode,
  normalizeResourceSettings,
  thinkModePolicy,
} from "../src/think-mode.js";

test("think mode normalization defaults unknown values to focus", () => {
  assert.equal(normalizeEngineThinkMode("distracted"), "distracted");
  assert.equal(normalizeEngineThinkMode("focus"), "focus");
  assert.equal(normalizeEngineThinkMode(""), "focus");
  assert.equal(normalizeEngineThinkMode(undefined), "focus");
});

test("focus keeps forecasting while distracted releases the CPU on human turn", () => {
  assert.deepEqual(thinkModePolicy(ENGINE_THINK_MODES.focus), {
    mode: "focus",
    continuousThinking: true,
    allowForecast: true,
    releaseWhileHumanTurn: false,
  });
  assert.deepEqual(thinkModePolicy(ENGINE_THINK_MODES.distracted), {
    mode: "distracted",
    continuousThinking: false,
    allowForecast: false,
    releaseWhileHumanTurn: true,
  });
});

test("resource settings clamp to engine-supported ranges", () => {
  assert.deepEqual(
    normalizeResourceSettings(
      { threads: 999, hash: 1, multiPV: 99 },
      { logicalProcessors: 14, freeMemoryGB: 16 },
    ),
    { threads: 64, hash: 16, multiPV: 16 },
  );
  assert.deepEqual(LOW_POWER_SETTINGS, {
    threads: 2,
    hash: 256,
    multiPV: 1,
  });
});

test("resource warnings only fire above meaningful thresholds", () => {
  assert.deepEqual(
    collectResourceWarnings({
      threads: 8,
      hash: 1024,
      multiPV: 1,
      logicalProcessors: 14,
      continuousThinking: false,
    }),
    [],
  );
  const warnings = collectResourceWarnings({
    threads: 14,
    hash: 4096,
    multiPV: 8,
    logicalProcessors: 14,
    continuousThinking: true,
  });
  assert.equal(warnings.length, 3);
  assert.match(warnings[0], /持续思考/);
  assert.match(warnings[1], /4096 MB/);
  assert.match(warnings[2], /8 路/);
});

test("thread counts above the logical CPU count always warn", () => {
  const warnings = collectResourceWarnings({
    threads: 20,
    hash: 1024,
    multiPV: 1,
    logicalProcessors: 14,
    continuousThinking: false,
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /超过本机 14 个逻辑线程/);
});
