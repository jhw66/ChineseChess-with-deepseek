import test from "node:test";
import assert from "node:assert/strict";
import { getPersona } from "../src/persona.js";
import {
  DEFAULT_THINK_MS,
  MAX_THINK_MS,
  clampThinkTime,
  isEngineBestPersona,
  ponderHitDecision,
  resolveForecastScoutMs,
  resolvePersonaThinkMs,
  supportsPonder,
} from "../src/think-time.js";

test("超级大师使用完整设置时间，不再被旧的 5 秒人格上限截断", () => {
  const grandmaster = getPersona("grandmaster");
  assert.equal(grandmaster.movetimeMs, 5000);

  assert.equal(
    resolvePersonaThinkMs({
      persona: grandmaster,
      requestedThinkMs: 60000,
    }),
    60000,
  );
  assert.equal(
    resolvePersonaThinkMs({
      persona: grandmaster,
      requestedThinkMs: MAX_THINK_MS + 1,
    }),
    MAX_THINK_MS,
  );
});

test("其他人格仍取用户设置与人格建议时间的较小值", () => {
  const persona = getPersona("expert-risky");
  assert.equal(persona.movetimeMs, 1500);

  assert.equal(
    resolvePersonaThinkMs({
      persona,
      requestedThinkMs: 10000,
    }),
    1500,
  );
  assert.equal(
    resolvePersonaThinkMs({
      persona,
      requestedThinkMs: 900,
    }),
    900,
  );
});

test("思考时间统一做边界收敛，非法值回落默认值", () => {
  assert.equal(clampThinkTime(undefined), DEFAULT_THINK_MS);
  assert.equal(clampThinkTime("not-a-number"), DEFAULT_THINK_MS);
  // 自由难度模式允许 1ms ~ 30 分钟，两端都原样保留。
  assert.equal(clampThinkTime(1), 1);
  assert.equal(clampThinkTime(0), 1);
  assert.equal(clampThinkTime(-500), 1);
  assert.equal(clampThinkTime(999999), 999999);
  assert.equal(clampThinkTime(MAX_THINK_MS), MAX_THINK_MS);
  assert.equal(clampThinkTime(MAX_THINK_MS + 1), MAX_THINK_MS);
});

test("预判续算只对超级大师开放", () => {
  assert.equal(isEngineBestPersona(getPersona("grandmaster")), true);
  assert.equal(supportsPonder(getPersona("grandmaster")), true);
  assert.equal(supportsPonder(getPersona("expert-risky")), false);
});

test("侦察预算固定在 0.3 到 1.5 秒之间", () => {
  assert.equal(resolveForecastScoutMs(100), 300);
  assert.equal(resolveForecastScoutMs(3000), 750);
  assert.equal(resolveForecastScoutMs(30000), 1500);
  assert.equal(resolveForecastScoutMs(MAX_THINK_MS), 1500);
});

test("预判命中判定区分命中、落空与无预判", () => {
  assert.equal(
    ponderHitDecision({
      ponderActive: true,
      ponderMove: "h2e2",
      playedUci: "h2e2",
      source: "human",
    }),
    "hit",
  );
  assert.equal(
    ponderHitDecision({
      ponderActive: true,
      ponderMove: "h2e2",
      playedUci: "b2e2",
      source: "human",
    }),
    "miss",
  );
  assert.equal(
    ponderHitDecision({
      ponderActive: false,
      ponderMove: "h2e2",
      playedUci: "h2e2",
      source: "human",
    }),
    "none",
  );
  assert.equal(
    ponderHitDecision({
      ponderActive: true,
      ponderMove: "h2e2",
      playedUci: "h2e2",
      source: "engine",
    }),
    "none",
  );
});
