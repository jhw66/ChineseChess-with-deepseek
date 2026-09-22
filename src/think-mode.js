/**
 * 超级大师的两档思考策略与资源占用提示。
 *
 * focus（梁圣专注）：
 *   玩家行棋时也保持分析，并用 ponder 预判下一手，性能占用最高。
 *
 * distracted（梁子分心）：
 *   玩家行棋时停止搜索并释放 CPU，只有轮到引擎时才吃满设置的资源。
 */

export const ENGINE_THINK_MODES = Object.freeze({
  focus: "focus",
  distracted: "distracted",
});

export const LOW_POWER_SETTINGS = Object.freeze({
  threads: 2,
  hash: 256,
  multiPV: 1,
});

export function normalizeEngineThinkMode(value) {
  return value === ENGINE_THINK_MODES.distracted
    ? ENGINE_THINK_MODES.distracted
    : ENGINE_THINK_MODES.focus;
}

export function thinkModePolicy(value) {
  const mode = normalizeEngineThinkMode(value);
  return mode === ENGINE_THINK_MODES.distracted
    ? Object.freeze({
        mode,
        continuousThinking: false,
        allowForecast: false,
        releaseWhileHumanTurn: true,
      })
    : Object.freeze({
        mode,
        continuousThinking: true,
        allowForecast: true,
        releaseWhileHumanTurn: false,
      });
}

function normalizeInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
}

export function normalizeResourceSettings(
  value = {},
  { logicalProcessors = 14, freeMemoryGB = 16 } = {},
) {
  const logical = normalizeInteger(logicalProcessors, 14, 1, 256);
  const freeMemory = Number.isFinite(Number(freeMemoryGB))
    ? Math.max(0, Number(freeMemoryGB))
    : 16;
  const recommendedHash = Math.max(
    512,
    Math.min(2048, Math.floor((freeMemory * 1024) / 4 / 128) * 128),
  );
  return {
    threads: normalizeInteger(value.threads, logical, 1, 64),
    hash: normalizeInteger(value.hash, recommendedHash, 16, 65536),
    multiPV: normalizeInteger(value.multiPV, 1, 1, 16),
  };
}

/**
 * 返回面向用户的资源告警。只有真正可能拖慢系统时才显示，避免默认参数
 * 一打开就常驻红色警告。
 */
export function collectResourceWarnings({
  threads,
  hash,
  multiPV,
  logicalProcessors = 14,
  continuousThinking = false,
} = {}) {
  const logical = normalizeInteger(logicalProcessors, 14, 1, 256);
  const normalized = normalizeResourceSettings(
    { threads, hash, multiPV },
    { logicalProcessors: logical },
  );
  const warnings = [];
  const highThreadThreshold = Math.max(8, Math.ceil(logical * 0.75));

  if (normalized.threads > logical) {
    warnings.push(
      `线程数 ${normalized.threads} 已超过本机 ${logical} 个逻辑线程，` +
        "会造成线程争抢、明显卡顿和持续高温。",
    );
  } else if (
    continuousThinking &&
    normalized.threads >= highThreadThreshold
  ) {
    warnings.push(
      `持续思考时使用 ${normalized.threads}/${logical} 线程，` +
        "会占用大部分 CPU，可能发热、掉帧并影响其他程序。",
    );
  }

  if (normalized.hash >= 4096) {
    warnings.push(
      `哈希内存 ${normalized.hash} MB 偏高，` +
        "在多任务运行时可能挤压其他程序的内存。",
    );
  }

  if (normalized.multiPV >= 8) {
    warnings.push(
      `分析候选 ${normalized.multiPV} 路会重复消耗计算资源，` +
        "建议只在复盘或专项分析时临时使用。",
    );
  }

  return warnings;
}
