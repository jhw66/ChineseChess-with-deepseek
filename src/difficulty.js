/**
 * 自由难度模式：9 个内置难度档位各自保存一份自定义引擎参数。
 *
 * 设计约定：
 *  1. 只有被用户显式改过的档位才会写进 localStorage；没写过的档位完全
 *     等同于内置人格设置，这样升级、切换档位、重置都能干净回到默认。
 *  2. 自定义覆盖的是"引擎参数层"：思考深度、候选着法数、随机温度、思考
 *     时间，以及叠加性格 / 动态最优解调节器。走子分类、胜负判定等核心
 *     规则一律沿用 persona.js，避免出现两套会漂移的逻辑。
 *  3. 自定义档位的思考时间不再被内置人格的 movetimeMs 截断
 *     （freeThinkTime=true），1ms~30 分钟都会原样下发给引擎。
 *
 * 这个模块同时被浏览器（/src/difficulty.js）和 Node 服务端 import，
 * 保证"界面显示的值"和"引擎真正拿到的值"来自同一套归一化逻辑。
 */
import {
  PERSONA_LIST,
  getPersona,
  normalizeController,
  normalizePersonaTraits,
} from "./persona.js";

export const DIFFICULTY_LIMITS = Object.freeze({
  depth: Object.freeze({ min: 1, max: 128, fallback: 12 }),
  topK: Object.freeze({ min: 1, max: 16, fallback: 8 }),
  temperature: Object.freeze({ min: 0, max: 200, fallback: 50 }),
  movetimeMs: Object.freeze({ min: 1, max: 1800000, fallback: 3000 }),
});

export const FREE_MODE_STORAGE_KEY = "xiangqi.difficulty.freeMode";
export const CUSTOM_MAP_STORAGE_KEY = "xiangqi.difficulty.custom.v1";
export const THINK_SLIDER_MAX = 1000;

/** 9 个难度档位，就是内置的 9 种 AI 人格，顺序即难度递增。 */
export const DIFFICULTY_SLOT_IDS = Object.freeze(
  PERSONA_LIST.map((persona) => persona.id),
);

function clampInteger(value, limits) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return limits.fallback;
  return Math.max(limits.min, Math.min(limits.max, number));
}

/**
 * 和 clampInteger 一样收敛，但非法值回落到"调用方给的默认值"。
 * 归一化用户存档时必须用它：损坏的字段应回到该档内置人格的参数，
 * 而不是所有档位共用的 DIFFICULTY_LIMITS.fallback。
 */
function clampValue(value, limits, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(limits.min, Math.min(limits.max, number));
}

/**
 * 1ms ~ 30 分钟跨了六个数量级，线性滑杆会把 1 秒以下压缩到不足一个像素。
 * 滑杆使用对数刻度；两端精确回到 1ms 和 30 分钟。
 */
export function thinkMsToSlider(milliseconds) {
  const value = clampInteger(
    milliseconds,
    DIFFICULTY_LIMITS.movetimeMs,
  );
  const { min, max } = DIFFICULTY_LIMITS.movetimeMs;
  const ratio = Math.log(value / min) / Math.log(max / min);
  return Math.round(ratio * THINK_SLIDER_MAX);
}

export function sliderToThinkMs(sliderValue) {
  const { min, max } = DIFFICULTY_LIMITS.movetimeMs;
  const position = clampInteger(
    sliderValue,
    { min: 0, max: THINK_SLIDER_MAX, fallback: 0 },
  );
  if (position <= 0) return min;
  if (position >= THINK_SLIDER_MAX) return max;
  const ratio = position / THINK_SLIDER_MAX;
  return clampInteger(
    Math.round(min * Math.pow(max / min, ratio)),
    DIFFICULTY_LIMITS.movetimeMs,
  );
}

export function isDifficultySlot(personaId) {
  return DIFFICULTY_SLOT_IDS.includes(String(personaId ?? ""));
}

export function difficultySlotName(personaId) {
  return getPersona(personaId).name;
}

/** 某一档位的默认自定义值＝该档内置人格的原始参数。 */
export function defaultCustomization(personaId) {
  const persona = getPersona(personaId);
  return {
    depth: clampInteger(persona.depth, DIFFICULTY_LIMITS.depth),
    topK: clampInteger(persona.topK, DIFFICULTY_LIMITS.topK),
    temperature: clampInteger(
      persona.temperature,
      DIFFICULTY_LIMITS.temperature,
    ),
    movetimeMs: clampInteger(
      persona.movetimeMs,
      DIFFICULTY_LIMITS.movetimeMs,
    ),
    traits: [],
    controller: normalizeController(persona.controller),
  };
}

export function normalizeDifficultyCustomization(raw, personaId) {
  const defaults = defaultCustomization(personaId);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;
  return {
    depth: clampValue(
      raw.depth ?? defaults.depth,
      DIFFICULTY_LIMITS.depth,
      defaults.depth,
    ),
    topK: clampValue(
      raw.topK ?? defaults.topK,
      DIFFICULTY_LIMITS.topK,
      defaults.topK,
    ),
    temperature: clampValue(
      raw.temperature ?? defaults.temperature,
      DIFFICULTY_LIMITS.temperature,
      defaults.temperature,
    ),
    movetimeMs: clampValue(
      raw.movetimeMs ?? defaults.movetimeMs,
      DIFFICULTY_LIMITS.movetimeMs,
      defaults.movetimeMs,
    ),
    traits: normalizePersonaTraits(raw.traits),
    controller: normalizeController({
      ...defaults.controller,
      ...(raw.controller && typeof raw.controller === "object"
        ? raw.controller
        : {}),
    }),
  };
}

/**
 * 归一化整张"档位 → 自定义"映射表。
 * 只保留合法档位；未知档位不会污染存储，损坏的条目回落到默认值。
 */
export function normalizeCustomizationMap(rawMap) {
  const result = {};
  if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) {
    return result;
  }
  for (const personaId of DIFFICULTY_SLOT_IDS) {
    if (!Object.prototype.hasOwnProperty.call(rawMap, personaId)) continue;
    // 空条目视为"没有自定义"，不要写进映射：写进去会覆盖内置默认值，
    // 让"重置当前难度"失去意义。
    const entry = rawMap[personaId];
    if (entry === null || entry === undefined) continue;
    result[personaId] = normalizeDifficultyCustomization(
      entry,
      personaId,
    );
  }
  return result;
}

export function hasCustomization(customMap, personaId) {
  return Boolean(
    customMap && Object.prototype.hasOwnProperty.call(customMap, personaId),
  );
}

/**
 * 把一份自定义参数叠加到内置人格上，得到可以直接交给 resolvePersona /
 * choosePersonaMove 使用的人格对象。
 *
 * overridden=true 是给 persona.js 的标记：说明这个对象已经是完整的人格
 * 配置，不要再按 id 回表查询、把自定义的 depth / movetimeMs 覆盖掉。
 */
export function applyPersonaOverrides(basePersona, overrides) {
  if (!basePersona) return null;
  if (!overrides) return basePersona;
  const normalized = normalizeDifficultyCustomization(
    overrides,
    basePersona.id,
  );
  return Object.freeze({
    ...basePersona,
    ...normalized,
    overridden: true,
    freeThinkTime: true,
    customization: normalized,
  });
}
