/**
 * 思考时间与预判续算（ponder）的统一口径。
 *
 * 这个模块同时被浏览器（/src/think-time.js）和 Node 服务端 import，
 * 目的就是让"界面上显示的时间"和"引擎真正拿到的时间"永远一致。
 *
 * 约定：
 *  1. 超级大师（persona.mode === "engine_best"）直接使用用户在设置里填写的
 *     「最大思考时间」，不再被人格自带的 movetimeMs（旧版硬编码 5 秒）截断；
 *  2. 其他所有人格沿用原行为：取「用户设置」与「人格建议时间」中较小的那个。
 */

// Shortest 1ms, longest 30 minutes. 自由难度模式允许用户把这两个边界用到极致。
export const MIN_THINK_MS = 1;
export const MAX_THINK_MS = 1800000;
export const DEFAULT_THINK_MS = 3000;

export function clampThinkTime(value, fallback = DEFAULT_THINK_MS) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(MIN_THINK_MS, Math.min(MAX_THINK_MS, Math.round(number)));
}

export function isEngineBestPersona(persona) {
  return Boolean(persona) && persona.mode === "engine_best";
}

/**
 * 自由难度模式的自定义人格不按内置人格的"建议时间"截断：
 * 用户在 1ms~30 分钟之间填多少，就真正思考多少毫秒。
 */
export function isFreeThinkPersona(persona) {
  return Boolean(persona) && persona.freeThinkTime === true;
}

function hasUnrestrictedThinkTime(persona) {
  return isEngineBestPersona(persona) || isFreeThinkPersona(persona);
}

/**
 * 返回"这一步真正能思考多久"。
 *
 * 超级大师：完全按用户设置走（含预判续算时间），设置多少就是多少。
 * 其他人格：保持历史行为，仍是 min(用户设置, 人格建议时间)。
 */
export function resolvePersonaThinkMs({ persona, requestedThinkMs } = {}) {
  const requested = clampThinkTime(requestedThinkMs, DEFAULT_THINK_MS);
  if (hasUnrestrictedThinkTime(persona)) return requested;
  const cap = Number(persona?.movetimeMs);
  if (!Number.isFinite(cap) || cap <= 0) return requested;
  return Math.max(1, Math.min(requested, Math.round(cap)));
}

/**
 * 预判续算只对超级大师开放。
 *
 * 其他人格每步本来就只想几十毫秒到两秒，续算省下来的时间很有限，
 * 却要多下发一组 position + go ponder 指令，反而增加队列压力。
 */
export function supportsPonder(persona) {
  return isEngineBestPersona(persona);
}

/**
 * 预判续算的第一步是"侦察"：先用一次很短的搜索确认对手最可能走哪一步，
 * 再在那个子局面上开 go ponder。侦察只用来定位预判着法，不需要算得深，
 * 所以固定在 0.3~1.5 秒之间，避免白白吃掉预算。
 */
export const FORECAST_SCOUT_MIN_MS = 300;
export const FORECAST_SCOUT_MAX_MS = 1500;

export function resolveForecastScoutMs(budgetMs) {
  const budget = clampThinkTime(budgetMs, DEFAULT_THINK_MS);
  return Math.max(
    FORECAST_SCOUT_MIN_MS,
    Math.min(FORECAST_SCOUT_MAX_MS, Math.round(budget / 4)),
  );
}

/**
 * 玩家落子后如何处置正在进行的预判：
 *   hit  —— 走的就是预判着法，直接 ponderhit，沿用原有搜索树与深度；
 *   miss —— 走了别的着法，先 stop，再按常规流程重新计算；
 *   none —— 本来就没有预判在跑。
 */
export function ponderHitDecision({
  ponderActive,
  ponderMove,
  playedUci,
  source,
} = {}) {
  if (!ponderActive) return "none";
  if (source !== "human") return "none";
  if (!ponderMove) return "miss";
  return String(playedUci) === String(ponderMove) ? "hit" : "miss";
}
