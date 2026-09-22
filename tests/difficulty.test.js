import test from "node:test";
import assert from "node:assert/strict";
import { getPersona } from "../src/persona.js";
import {
  DIFFICULTY_LIMITS,
  DIFFICULTY_SLOT_IDS,
  THINK_SLIDER_MAX,
  applyPersonaOverrides,
  defaultCustomization,
  difficultySlotName,
  hasCustomization,
  isDifficultySlot,
  normalizeCustomizationMap,
  normalizeDifficultyCustomization,
  sliderToThinkMs,
  thinkMsToSlider,
} from "../src/difficulty.js";

test("恰好 9 个难度档位，且都能查到名字", () => {
  assert.equal(DIFFICULTY_SLOT_IDS.length, 9);
  assert.equal(new Set(DIFFICULTY_SLOT_IDS).size, 9);
  for (const personaId of DIFFICULTY_SLOT_IDS) {
    assert.equal(isDifficultySlot(personaId), true);
    assert.equal(typeof difficultySlotName(personaId), "string");
    assert.ok(difficultySlotName(personaId).length > 0);
  }
  assert.equal(isDifficultySlot("conservative"), false);
  assert.equal(isDifficultySlot(""), false);
});

test("思考时间滑杆横跨 1ms ~ 30 分钟的对数刻度", () => {
  assert.equal(THINK_SLIDER_MAX, 1000);
  assert.equal(thinkMsToSlider(DIFFICULTY_LIMITS.movetimeMs.min), 0);
  assert.equal(thinkMsToSlider(DIFFICULTY_LIMITS.movetimeMs.max), 1000);
  assert.equal(sliderToThinkMs(0), 1);
  assert.equal(sliderToThinkMs(1000), 1800000);

  // 两端以外的非法输入要收敛到边界，而不是产生 NaN。
  assert.equal(thinkMsToSlider(-9999), 0);
  assert.equal(thinkMsToSlider(99999999), 1000);
  assert.equal(sliderToThinkMs(-5), 1);
  assert.equal(sliderToThinkMs(99999), 1800000);

  // 单调性：滑杆往右，思考时间只能变长或持平。
  let previous = 0;
  for (let position = 0; position <= THINK_SLIDER_MAX; position += 25) {
    const value = sliderToThinkMs(position);
    assert.ok(value >= previous, `位置 ${position} 应单调不减`);
    previous = value;
  }
});

test("默认自定义值等于内置人格参数", () => {
  for (const personaId of DIFFICULTY_SLOT_IDS) {
    const persona = getPersona(personaId);
    const defaults = defaultCustomization(personaId);
    assert.equal(defaults.depth, persona.depth);
    assert.equal(defaults.topK, persona.topK);
    assert.equal(defaults.temperature, persona.temperature);
    assert.equal(defaults.movetimeMs, persona.movetimeMs);
    assert.deepEqual(defaults.traits, []);
  }
  // 未知档位回落到中级人格，而不是抛错。
  assert.equal(defaultCustomization("conservative").depth, getPersona("conservative").depth);
});

test("自定义参数按 1~1800000 毫秒与其余边界收敛", () => {
  const clamped = normalizeDifficultyCustomization(
    {
      depth: 999,
      topK: 0,
      temperature: -5,
      movetimeMs: 5000000,
    },
    "grandmaster",
  );
  assert.equal(clamped.depth, DIFFICULTY_LIMITS.depth.max);
  assert.equal(clamped.topK, DIFFICULTY_LIMITS.topK.min);
  assert.equal(clamped.temperature, DIFFICULTY_LIMITS.temperature.min);
  assert.equal(clamped.movetimeMs, DIFFICULTY_LIMITS.movetimeMs.max);

  const tiny = normalizeDifficultyCustomization(
    { movetimeMs: 1, depth: 1, topK: 1 },
    "grandmaster",
  );
  assert.equal(tiny.movetimeMs, 1);
  assert.equal(tiny.depth, 1);

  // 非法值回落到该档位的默认值，而不是全局常量。
  const broken = normalizeDifficultyCustomization(
    { depth: "abc", movetimeMs: null },
    "low-conservative",
  );
  assert.equal(broken.depth, getPersona("low-conservative").depth);
  assert.equal(broken.movetimeMs, getPersona("low-conservative").movetimeMs);
});

test("9 个档位互不串写，未知档位不写进存储映射", () => {
  const map = normalizeCustomizationMap({
    "low-impulsive": { movetimeMs: 1 },
    grandmaster: { movetimeMs: 1800000, depth: 64 },
    "not-a-persona": { movetimeMs: 500 },
  });
  assert.deepEqual(Object.keys(map).sort(), ["grandmaster", "low-impulsive"]);
  assert.equal(map["low-impulsive"].movetimeMs, 1);
  assert.equal(map.grandmaster.movetimeMs, 1800000);
  assert.equal(map.grandmaster.depth, 64);
  // 没被改过的档位不应该出现在映射里，才能干净回落到内置值。
  assert.equal(hasCustomization(map, "expert-steady"), false);
  assert.equal(hasCustomization(map, "grandmaster"), true);
});

test("归一化映射会丢弃损坏条目但保留同批次的合法档位", () => {
  const map = normalizeCustomizationMap({
    "expert-risky": null,
    "expert-steady": { movetimeMs: 2500 },
  });
  // null 视为未自定义，直接不写入。
  assert.equal(hasCustomization(map, "expert-risky"), false);
  assert.equal(map["expert-steady"].movetimeMs, 2500);
  assert.deepEqual(normalizeCustomizationMap(null), {});
  assert.deepEqual(normalizeCustomizationMap([]), {});
});

test("applyPersonaOverrides 打上 overridden/freeThinkTime 且不改动原人格", () => {
  const base = getPersona("grandmaster");
  const overridden = applyPersonaOverrides(base, {
    depth: 30,
    topK: 4,
    temperature: 7,
    movetimeMs: 1,
  });
  assert.equal(overridden.overridden, true);
  assert.equal(overridden.freeThinkTime, true);
  assert.equal(overridden.depth, 30);
  assert.equal(overridden.movetimeMs, 1);
  assert.equal(overridden.temperature, 7);
  assert.equal(overridden.id, "grandmaster");
  // 原始人格保持冻结不变。
  assert.equal(base.depth, getPersona("grandmaster").depth);
  assert.equal(base.movetimeMs, 5000);
  assert.equal(applyPersonaOverrides(null, {}), null);
  assert.equal(applyPersonaOverrides(base, null), base);
});
