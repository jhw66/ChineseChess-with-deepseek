import {
  applyMove,
  boardToFen,
  cloneBoard,
  findGeneral,
  gameStatus,
  generateLegalMoves,
  isGeneralInCheck,
  opposite,
  parseFen,
  pieceSide,
  uciToMove,
} from "./xiangqi.js";

export const CATEGORY_NAMES = Object.freeze({
  strong: "强招",
  normal: "普招",
  soft: "软招",
  blunder: "错招",
});

export const CATEGORY_ORDER = Object.freeze([
  "strong",
  "normal",
  "soft",
  "blunder",
]);

export const MOVE_INTENTS = Object.freeze({
  persona: "跟随人格",
  nonBest: "故意避开首选",
  capture: "优先吃子",
  check: "优先将军",
  evade: "优先躲避",
  preserveMaterial: "惜车炮退避",
});

const CATEGORY_INDEX = Object.freeze({
  strong: 0,
  normal: 1,
  soft: 2,
  blunder: 3,
});

const STYLE_WEIGHTS = Object.freeze({
  conservative: {
    check: 5,
    capture: 5,
    crossRiver: -10,
    sacrifice: -50,
    complex: -30,
    trade: 25,
    retreat: 15,
    guardGeneral: 30,
    simplify: 15,
    pawn: 10,
    coordinate: 15,
    repeat: -10,
  },
  steady: {
    check: 10,
    capture: 10,
    crossRiver: 5,
    sacrifice: -40,
    complex: -15,
    trade: 15,
    retreat: 10,
    guardGeneral: 10,
    simplify: 10,
    pawn: 15,
    coordinate: 20,
    repeat: -15,
  },
  balanced: {
    check: 0,
    capture: 0,
    crossRiver: 0,
    sacrifice: 0,
    complex: 0,
    trade: 0,
    retreat: 0,
    guardGeneral: 0,
    simplify: 0,
    pawn: 0,
    coordinate: 0,
    repeat: 0,
  },
  offensive: {
    check: 40,
    capture: 20,
    crossRiver: 25,
    sacrifice: 30,
    complex: 25,
    trade: -20,
    retreat: -30,
    guardGeneral: -10,
    simplify: -20,
    pawn: 5,
    coordinate: 5,
    repeat: -10,
  },
  risky: {
    check: 20,
    capture: 15,
    crossRiver: 20,
    sacrifice: 40,
    complex: 30,
    trade: -15,
    retreat: -20,
    guardGeneral: -20,
    simplify: -25,
    pawn: 0,
    coordinate: -5,
    repeat: -5,
  },
  impulsive: {
    check: 25,
    capture: 40,
    crossRiver: 25,
    sacrifice: 20,
    complex: 10,
    trade: -20,
    retreat: -20,
    guardGeneral: -30,
    simplify: -15,
    pawn: 0,
    coordinate: -10,
    repeat: 15,
  },
});

const DEFAULT_CONTROLLER = Object.freeze({
  mode: "cycle",
  cycleN: 20,
  bestCount: 11,
  avoidCount: 9,
  minStreakBest: 0,
  maxStreakAvoid: 3,
  shuffle: true,
});

const TRAIT_DEFINITIONS = Object.freeze({
  conservative: Object.freeze({
    id: "conservative",
    name: "保守",
    style: "conservative",
    probability: Object.freeze({
      opening: Object.freeze([0.2, 0.3, 0.28, 0.22]),
      middlegame: Object.freeze([0.16, 0.28, 0.3, 0.26]),
      endgame: Object.freeze([0.14, 0.26, 0.3, 0.3]),
    }),
    openingPreferences: Object.freeze({
      "飞相": 0.4,
      "上士": 0.25,
      "巡河": 0.2,
      "兑子": 0.15,
    }),
  }),
  steady: Object.freeze({
    id: "steady",
    name: "稳健",
    style: "steady",
    probability: Object.freeze({
      opening: Object.freeze([0.55, 0.3, 0.12, 0.03]),
      middlegame: Object.freeze([0.5, 0.31, 0.15, 0.04]),
      endgame: Object.freeze([0.52, 0.31, 0.14, 0.03]),
    }),
    openingPreferences: Object.freeze({
      "飞相": 0.35,
      "仙人指路": 0.3,
      "起马": 0.2,
      "士角炮": 0.15,
    }),
  }),
  balanced: Object.freeze({
    id: "balanced",
    name: "均衡",
    style: "balanced",
    probability: Object.freeze({
      opening: Object.freeze([0.42, 0.32, 0.21, 0.05]),
      middlegame: Object.freeze([0.4, 0.32, 0.22, 0.06]),
      endgame: Object.freeze([0.42, 0.32, 0.21, 0.05]),
    }),
    openingPreferences: Object.freeze({
      "仙人指路": 0.3,
      "起马": 0.3,
      "中炮": 0.2,
      "飞相": 0.2,
    }),
  }),
  offensive: Object.freeze({
    id: "offensive",
    name: "进攻",
    style: "offensive",
    probability: Object.freeze({
      opening: Object.freeze([0.38, 0.28, 0.25, 0.09]),
      middlegame: Object.freeze([0.33, 0.28, 0.27, 0.12]),
      endgame: Object.freeze([0.31, 0.28, 0.28, 0.13]),
    }),
    openingPreferences: Object.freeze({
      "中炮": 0.4,
      "过宫炮": 0.3,
      "仙人指路转中炮": 0.3,
    }),
  }),
  risky: Object.freeze({
    id: "risky",
    name: "冒险",
    style: "risky",
    probability: Object.freeze({
      opening: Object.freeze([0.34, 0.26, 0.25, 0.15]),
      middlegame: Object.freeze([0.28, 0.26, 0.28, 0.18]),
      endgame: Object.freeze([0.26, 0.25, 0.29, 0.2]),
    }),
    openingPreferences: Object.freeze({
      "中炮": 0.4,
      "弃马局": 0.3,
      "敢死炮": 0.3,
    }),
  }),
  impulsive: Object.freeze({
    id: "impulsive",
    name: "冲动",
    style: "impulsive",
    probability: Object.freeze({
      opening: Object.freeze([0.24, 0.26, 0.25, 0.25]),
      middlegame: Object.freeze([0.18, 0.24, 0.28, 0.3]),
      endgame: Object.freeze([0.16, 0.22, 0.29, 0.33]),
    }),
    openingPreferences: Object.freeze({
      "中炮": 0.4,
      "急进过河车": 0.3,
      "乱出子": 0.2,
      "贪吃": 0.1,
    }),
  }),
});

export const PERSONA_TRAITS = Object.freeze(
  Object.values(TRAIT_DEFINITIONS),
);

const PIECE_VALUES = Object.freeze({
  K: 100,
  R: 9,
  C: 4.5,
  N: 4,
  B: 2,
  A: 2,
  P: 1,
});

function persona(config) {
  const controller = {
    ...DEFAULT_CONTROLLER,
    ...(config.controller ?? {}),
  };
  return Object.freeze({
    seed: 12345,
    mode: "sampled",
    ...config,
    controller: Object.freeze(controller),
    probability: Object.freeze({
      opening: Object.freeze(config.probability.opening),
      middlegame: Object.freeze(config.probability.middlegame),
      endgame: Object.freeze(config.probability.endgame),
    }),
    errorBudget: Object.freeze(config.errorBudget),
    openingPreferences: Object.freeze(config.openingPreferences ?? []),
  });
}

export const PERSONAS = Object.freeze({
  "low-conservative": persona({
    id: "low-conservative",
    name: "低手保守",
    summary: "很少冒险，偏爱兑子和补防，但整体计算较浅。",
    depth: 2,
    topK: 6,
    temperature: 80,
    movetimeMs: 100,
    style: "conservative",
    probability: {
      opening: [0.1, 0.2, 0.3, 0.4],
      middlegame: [0.06, 0.16, 0.32, 0.46],
      endgame: [0.04, 0.14, 0.32, 0.5],
    },
    errorBudget: {
      softPer10: 3,
      blunderPer20: 1,
      maxBlunderPerGame: 1,
    },
    controller: {
      cycleN: 20,
      bestCount: 6,
      avoidCount: 14,
      minStreakBest: 0,
      maxStreakAvoid: 6,
    },
    openingPreferences: ["飞相", "上士", "巡河", "兑子"],
  }),
  "low-impulsive": persona({
    id: "low-impulsive",
    name: "低手冲动",
    summary: "贪吃、爱抢先手，重复和严重漏算也相对更多。",
    depth: 2,
    topK: 8,
    temperature: 100,
    movetimeMs: 80,
    style: "impulsive",
    probability: {
      opening: [0.06, 0.16, 0.3, 0.48],
      middlegame: [0.04, 0.12, 0.28, 0.56],
      endgame: [0.03, 0.1, 0.27, 0.6],
    },
    errorBudget: {
      softPer10: 4,
      blunderPer20: 2,
      maxBlunderPerGame: 2,
    },
    controller: {
      cycleN: 20,
      bestCount: 4,
      avoidCount: 16,
      minStreakBest: 0,
      maxStreakAvoid: 6,
    },
    openingPreferences: ["中炮", "急进过河车", "乱出子", "贪吃"],
  }),
  "intermediate-steady": persona({
    id: "intermediate-steady",
    name: "中级稳健",
    summary: "飞相、士角炮和兑子偏多，棋形稳定，偶尔走缓。",
    depth: 6,
    topK: 8,
    temperature: 60,
    movetimeMs: 500,
    style: "steady",
    probability: {
      opening: [0.45, 0.3, 0.2, 0.05],
      middlegame: [0.4, 0.3, 0.24, 0.06],
      endgame: [0.42, 0.32, 0.22, 0.04],
    },
    errorBudget: {
      softPer10: 2,
      blunderPer20: 0.5,
      maxBlunderPerGame: 0.5,
    },
    controller: {
      cycleN: 20,
      bestCount: 11,
      avoidCount: 9,
      minStreakBest: 1,
      maxStreakAvoid: 3,
    },
    openingPreferences: ["飞相", "士角炮", "兑子", "补士象"],
  }),
  "intermediate-balanced": persona({
    id: "intermediate-balanced",
    name: "中级均衡",
    summary: "开局选择均衡，不刻意保守或搏杀，适合日常对弈。",
    depth: 6,
    topK: 8,
    temperature: 55,
    movetimeMs: 500,
    style: "balanced",
    probability: {
      opening: [0.42, 0.32, 0.21, 0.05],
      middlegame: [0.38, 0.32, 0.24, 0.06],
      endgame: [0.4, 0.33, 0.22, 0.05],
    },
    errorBudget: {
      softPer10: 2,
      blunderPer20: 0.5,
      maxBlunderPerGame: 0.5,
    },
    controller: {
      cycleN: 20,
      bestCount: 11,
      avoidCount: 9,
      minStreakBest: 1,
      maxStreakAvoid: 3,
    },
    openingPreferences: ["仙人指路", "起马", "中炮", "飞相"],
  }),
  "intermediate-offensive": persona({
    id: "intermediate-offensive",
    name: "中级进攻",
    summary: "中炮和过宫炮为主，主动复杂化，愿意为攻势承担风险。",
    depth: 6,
    topK: 10,
    temperature: 70,
    movetimeMs: 500,
    style: "offensive",
    probability: {
      opening: [0.38, 0.28, 0.25, 0.09],
      middlegame: [0.32, 0.28, 0.28, 0.12],
      endgame: [0.3, 0.28, 0.3, 0.12],
    },
    errorBudget: {
      softPer10: 3,
      blunderPer20: 1,
      maxBlunderPerGame: 1,
    },
    controller: {
      cycleN: 20,
      bestCount: 10,
      avoidCount: 10,
      minStreakBest: 1,
      maxStreakAvoid: 3,
    },
    openingPreferences: ["中炮", "过宫炮", "仙人指路转中炮"],
  }),
  "expert-steady": persona({
    id: "expert-steady",
    name: "高手稳健",
    summary: "搜索更深，极少软招错招，偏好飞相、仙人指路和起马。",
    depth: 12,
    topK: 12,
    temperature: 25,
    movetimeMs: 2000,
    style: "steady",
    probability: {
      opening: [0.85, 0.12, 0.025, 0.005],
      middlegame: [0.8, 0.16, 0.035, 0.005],
      endgame: [0.84, 0.14, 0.018, 0.002],
    },
    errorBudget: {
      softPer10: 1,
      blunderPer20: 0.2,
      maxBlunderPerGame: 0.1,
    },
    controller: {
      cycleN: 20,
      bestCount: 17,
      avoidCount: 3,
      minStreakBest: 3,
      maxStreakAvoid: 1,
    },
    openingPreferences: ["飞相", "仙人指路", "起马", "士角炮"],
  }),
  "expert-offensive": persona({
    id: "expert-offensive",
    name: "高手进攻",
    summary: "强招为主，但会主动选择复杂、将军和过河的变化。",
    depth: 12,
    topK: 12,
    temperature: 35,
    movetimeMs: 2000,
    style: "offensive",
    probability: {
      opening: [0.76, 0.16, 0.06, 0.02],
      middlegame: [0.7, 0.18, 0.09, 0.03],
      endgame: [0.66, 0.2, 0.11, 0.03],
    },
    errorBudget: {
      softPer10: 2,
      blunderPer20: 0.5,
      maxBlunderPerGame: 0.3,
    },
    controller: {
      cycleN: 20,
      bestCount: 16,
      avoidCount: 4,
      minStreakBest: 0,
      maxStreakAvoid: 3,
    },
    openingPreferences: ["中炮", "过宫炮", "顺炮", "急进"],
  }),
  "expert-risky": persona({
    id: "expert-risky",
    name: "高手冒险",
    summary: "搜索很深，偏爱弃子抢攻、敢死炮和复杂对攻。",
    depth: 10,
    topK: 14,
    temperature: 50,
    movetimeMs: 1500,
    style: "risky",
    probability: {
      opening: [0.68, 0.18, 0.1, 0.04],
      middlegame: [0.58, 0.22, 0.14, 0.06],
      endgame: [0.54, 0.24, 0.15, 0.07],
    },
    errorBudget: {
      softPer10: 3,
      blunderPer20: 1,
      maxBlunderPerGame: 0.5,
    },
    controller: {
      cycleN: 20,
      bestCount: 15,
      avoidCount: 5,
      minStreakBest: 0,
      maxStreakAvoid: 3,
    },
    openingPreferences: ["中炮", "弃马局", "敢死炮", "复杂变例"],
  }),
  grandmaster: persona({
    id: "grandmaster",
    name: "超级大师",
    summary: "始终走引擎最优解，不采样、不加风格、不出错招。",
    mode: "engine_best",
    depth: 128,
    topK: 1,
    temperature: 0,
    movetimeMs: 5000,
    style: "balanced",
    probability: {
      opening: [1, 0, 0, 0],
      middlegame: [1, 0, 0, 0],
      endgame: [1, 0, 0, 0],
    },
    errorBudget: {
      softPer10: 0,
      blunderPer20: 0,
      maxBlunderPerGame: 0,
    },
    controller: {
      cycleN: 1,
      bestCount: 1,
      avoidCount: 0,
      minStreakBest: 1,
      maxStreakAvoid: 0,
      shuffle: false,
    },
    openingPreferences: [],
  }),
});

export const PERSONA_LIST = Object.freeze(Object.values(PERSONAS));

export function getPersona(idOrName) {
  if (idOrName && PERSONAS[idOrName]) return PERSONAS[idOrName];
  return (
    PERSONA_LIST.find((item) => item.name === idOrName) ??
    PERSONAS["intermediate-balanced"]
  );
}

function clampInteger(value, fallback, minimum, maximum) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

export function normalizeController(controller = {}) {
  const cycleN = clampInteger(
    controller.cycleN,
    DEFAULT_CONTROLLER.cycleN,
    1,
    200,
  );
  const bestCount = clampInteger(
    controller.bestCount,
    Math.min(DEFAULT_CONTROLLER.bestCount, cycleN),
    0,
    cycleN,
  );
  const requestedAvoidCount = clampInteger(
    controller.avoidCount,
    cycleN - bestCount,
    0,
    cycleN,
  );
  const avoidCount = Math.min(requestedAvoidCount, cycleN - bestCount);
  return {
    mode: controller.mode === "engine_best" ? "engine_best" : "cycle",
    cycleN,
    bestCount,
    avoidCount,
    minStreakBest: clampInteger(
      controller.minStreakBest,
      DEFAULT_CONTROLLER.minStreakBest,
      0,
      cycleN,
    ),
    maxStreakAvoid: clampInteger(
      controller.maxStreakAvoid,
      DEFAULT_CONTROLLER.maxStreakAvoid,
      1,
      cycleN,
    ),
    shuffle: controller.shuffle !== false,
  };
}

function longestRun(plan, value) {
  let longest = 0;
  let current = 0;
  for (const entry of plan) {
    if (entry === value) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function planSatisfiesStreaks(plan, controller) {
  const avoidRuns = [];
  let currentAvoid = 0;
  for (const isBest of plan) {
    if (isBest) {
      if (currentAvoid) avoidRuns.push(currentAvoid);
      currentAvoid = 0;
    } else {
      currentAvoid += 1;
    }
  }
  if (currentAvoid) avoidRuns.push(currentAvoid);
  if (avoidRuns.some((run) => run > controller.maxStreakAvoid)) return false;
  if (!avoidRuns.length) return true;
  if (controller.minStreakBest <= 0) return true;

  let currentBest = 0;
  for (const isBest of plan) {
    if (isBest) {
      currentBest += 1;
    } else {
      if (currentBest > 0 && currentBest < controller.minStreakBest) {
        return false;
      }
      currentBest = 0;
    }
  }
  return (
    currentBest === 0 ||
    currentBest >= controller.minStreakBest
  );
}

function fallbackControllerPlan(controller) {
  const {
    cycleN,
    bestCount,
    avoidCount,
    minStreakBest,
    maxStreakAvoid,
  } = controller;
  const rest = Math.max(0, cycleN - bestCount - avoidCount);
  if (avoidCount === 0) {
    return [
      ...Array.from({ length: bestCount }, () => true),
      ...Array.from({ length: rest }, (_, index) => index % 2 === 0),
    ];
  }
  if (bestCount === 0) {
    return [
      ...Array.from({ length: avoidCount }, () => false),
      ...Array.from({ length: rest }, () => false),
    ];
  }

  const avoidRuns = Math.ceil(avoidCount / maxStreakAvoid);
  const minimumBest = Math.max(
    1,
    Math.min(
      minStreakBest || 1,
      Math.floor(bestCount / avoidRuns) || 1,
    ),
  );
  const plan = [];
  let remainingBest = bestCount;
  let remainingAvoid = avoidCount;
  for (let run = 0; run < avoidRuns; run += 1) {
    const remainingRuns = avoidRuns - run;
    const bestForRun =
      run === avoidRuns - 1
        ? remainingBest
        : Math.max(
            Math.min(minimumBest, remainingBest),
            Math.floor(
              (remainingBest - minimumBest * (remainingRuns - 1)) /
                remainingRuns,
            ),
          );
    const takeBest = Math.max(0, Math.min(remainingBest, bestForRun));
    for (let count = 0; count < takeBest; count += 1) plan.push(true);
    remainingBest -= takeBest;

    const takeAvoid = Math.min(
      maxStreakAvoid,
      remainingAvoid - (remainingRuns - 1),
    );
    for (let count = 0; count < takeAvoid; count += 1) plan.push(false);
    remainingAvoid -= takeAvoid;
  }
  while (remainingBest > 0) {
    plan.push(true);
    remainingBest -= 1;
  }
  while (remainingAvoid > 0) {
    plan.push(false);
    remainingAvoid -= 1;
  }
  while (plan.length < cycleN) plan.push(false);
  return plan.slice(0, cycleN);
}

function shufflePlan(plan, rng) {
  const shuffled = [...plan];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }
  return shuffled;
}

export function buildControllerPlan(
  rawController = {},
  cycleIndex = 0,
  seedKey = "",
) {
  const controller = normalizeController(rawController);
  const cycle = clampInteger(cycleIndex, 0, 0, 1000000);
  const rest = Math.max(
    0,
    controller.cycleN - controller.bestCount - controller.avoidCount,
  );
  const rng = mulberry32(
    hashString(`${seedKey}|controller|${cycle}|${JSON.stringify(controller)}`),
  );
  for (let attempt = 0; attempt < 256; attempt += 1) {
    const plan = [
      ...Array.from({ length: controller.bestCount }, () => true),
      ...Array.from({ length: controller.avoidCount }, () => false),
      ...Array.from({ length: rest }, () => rng() < 0.5),
    ];
    const candidate = controller.shuffle ? shufflePlan(plan, rng) : plan;
    if (planSatisfiesStreaks(candidate, controller)) return candidate;
    if (!controller.shuffle && attempt === 0) break;
  }
  return fallbackControllerPlan(controller);
}

export function getControllerDecision(
  personaConfig,
  stepIndex = 0,
  seedKey = personaConfig?.id ?? "",
) {
  const controller = normalizeController(personaConfig?.controller);
  if (personaConfig?.mode === "engine_best") {
    return {
      ...controller,
      mode: "engine_best",
      stepIndex: Math.max(0, Number.parseInt(stepIndex, 10) || 0),
      cycleIndex: 0,
      cycleStep: 0,
      isBestStep: true,
      plan: [true],
    };
  }

  const safeStep = Math.max(0, Number.parseInt(stepIndex, 10) || 0);
  const cycleIndex = Math.floor(safeStep / controller.cycleN);
  const cycleStep = safeStep % controller.cycleN;
  const plan = buildControllerPlan(controller, cycleIndex, seedKey);
  return {
    ...controller,
    stepIndex: safeStep,
    cycleIndex,
    cycleStep,
    isBestStep: Boolean(plan[cycleStep]),
    plan,
  };
}

export function normalizePersonaTraits(rawTraits) {
  if (!Array.isArray(rawTraits)) return [];
  const merged = new Map();
  for (const entry of rawTraits) {
    const id = String(
      entry?.trait ?? entry?.id ?? entry?.style ?? "",
    ).trim();
    if (!TRAIT_DEFINITIONS[id]) continue;
    const weight = Math.max(0, Math.min(2, Number(entry?.weight) || 0));
    if (weight <= 0) continue;
    merged.set(id, Math.min(2, (merged.get(id) ?? 0) + weight));
  }
  return [...merged.entries()].map(([trait, weight]) => ({
    trait,
    weight: Number(weight.toFixed(2)),
  }));
}

function weightedAverage(entries, selector, fallback = 0) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return fallback;
  return (
    entries.reduce(
      (sum, entry) => sum + (Number(selector(entry)) || 0) * entry.weight,
      0,
    ) / total
  );
}

function averageProbability(entries, phase) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return [1, 0, 0, 0];
  return [0, 1, 2, 3].map((index) =>
    entries.reduce(
      (sum, entry) =>
        sum + (Number(entry.probability?.[phase]?.[index]) || 0) * entry.weight,
      0,
    ) / total,
  );
}

function mergeStyleWeights(entries) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0) || 1;
  const merged = {};
  for (const key of Object.keys(STYLE_WEIGHTS.balanced)) {
    merged[key] =
      entries.reduce(
        (sum, entry) =>
          sum + (STYLE_WEIGHTS[entry.style]?.[key] ?? 0) * entry.weight,
        0,
      ) / total;
  }
  return merged;
}

function mergeOpeningPreferences(entries) {
  const merged = new Map();
  for (const entry of entries) {
    const preferences = Object.entries(entry.openingPreferences ?? {});
    for (const [profile, value] of preferences) {
      const weight = Math.max(0, Number(value) || 0) * entry.weight;
      if (weight <= 0) continue;
      merged.set(profile, (merged.get(profile) ?? 0) + weight);
    }
  }
  const max = Math.max(0, ...merged.values());
  if (!max) return {};
  return Object.fromEntries(
    [...merged.entries()].map(([profile, value]) => [
      profile,
      Number((value / max).toFixed(4)),
    ]),
  );
}

function personaTraitEntry(personaConfig) {
  return {
    id: personaConfig.id,
    name: personaConfig.name,
    style: personaConfig.style,
    weight: 1,
    probability: personaConfig.probability,
    openingPreferences: Object.fromEntries(
      (personaConfig.openingPreferences ?? []).map((profile) => [
        profile,
        1,
      ]),
    ),
  };
}

export function resolvePersona(
  personaOrId,
  rawTraits = [],
  rawController = null,
) {
  // 自由难度模式会把自定义参数叠加成一份完整人格对象，并打上
  // overridden 标记。这种对象不能再按 id 回表查询，否则 depth /
  // movetimeMs / temperature 会被内置人格的默认值覆盖掉。
  const base =
    personaOrId && personaOrId.overridden === true
      ? personaOrId
      : getPersona(personaOrId?.id ?? personaOrId);
  const controller = normalizeController({
    ...(base.controller ?? {}),
    ...(rawController ?? personaOrId?.controller ?? {}),
  });
  if (base.mode === "engine_best") {
    return Object.freeze({
      ...base,
      controller: Object.freeze(controller),
      baseName: base.name,
      traits: Object.freeze([]),
      traitNames: Object.freeze([]),
      signature: base.id,
      styleMix: Object.freeze({ [base.style]: 1 }),
      styleWeights: STYLE_WEIGHTS[base.style],
      openingPreferenceWeights: Object.freeze({}),
    });
  }

  const overlays = normalizePersonaTraits(rawTraits);
  const entries = [
    personaTraitEntry(base),
    ...overlays.map((overlay) => ({
      ...TRAIT_DEFINITIONS[overlay.trait],
      weight: overlay.weight,
      temperature: base.temperature,
    })),
  ];
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0) || 1;
  const styleMix = {};
  for (const entry of entries) {
    styleMix[entry.style] =
      (styleMix[entry.style] ?? 0) + entry.weight / total;
  }
  const styleWeights = mergeStyleWeights(entries);
  const openingPreferenceWeights = mergeOpeningPreferences(entries);
  const openingPreferences = Object.keys(openingPreferenceWeights).sort(
    (left, right) =>
      openingPreferenceWeights[right] - openingPreferenceWeights[left] ||
      left.localeCompare(right),
  );
  const probability = {
    opening: averageProbability(entries, "opening"),
    middlegame: averageProbability(entries, "middlegame"),
    endgame: averageProbability(entries, "endgame"),
  };
  const traitDetails = overlays.map((overlay) => ({
    id: overlay.trait,
    name: TRAIT_DEFINITIONS[overlay.trait].name,
    weight: overlay.weight,
  }));
  const suffix = traitDetails
    .map((trait) => `${trait.name}${trait.weight.toFixed(1)}`)
    .join("+");

  return Object.freeze({
    ...base,
    controller: Object.freeze(controller),
    baseName: base.name,
    name: suffix ? `${base.name} + ${suffix}` : base.name,
    temperature: weightedAverage(entries, (entry) => entry.temperature, base.temperature),
    probability: Object.freeze({
      opening: Object.freeze(probability.opening),
      middlegame: Object.freeze(probability.middlegame),
      endgame: Object.freeze(probability.endgame),
    }),
    styleMix: Object.freeze(styleMix),
    styleWeights: Object.freeze(styleWeights),
    openingPreferenceWeights: Object.freeze(openingPreferenceWeights),
    openingPreferences: Object.freeze(openingPreferences),
    traits: Object.freeze(traitDetails),
    traitNames: Object.freeze(traitDetails.map((trait) => trait.name)),
    signature: suffix
      ? `${base.id}|${traitDetails
          .map((trait) => `${trait.id}:${trait.weight}`)
          .join("|")}`
      : base.id,
  });
}

export function getMovePhase(moveNumber) {
  const number = Math.max(1, Number.parseInt(moveNumber, 10) || 1);
  if (number <= 15) return "opening";
  if (number <= 50) return "middlegame";
  return "endgame";
}

export function classifyCandidateLoss(loss) {
  const value = Math.max(0, Number(loss) || 0);
  if (value < 0.02) return "strong";
  if (value < 0.08) return "normal";
  if (value < 0.15) return "soft";
  return "blunder";
}

function wdlWinProbability(wdl) {
  if (!wdl) return null;
  const wins = Number(
    Array.isArray(wdl) ? wdl[0] : wdl.wins ?? wdl.win ?? wdl.w,
  );
  const draws = Number(
    Array.isArray(wdl) ? wdl[1] : wdl.draws ?? wdl.draw ?? wdl.d,
  );
  const losses = Number(
    Array.isArray(wdl) ? wdl[2] : wdl.losses ?? wdl.loss ?? wdl.l,
  );
  const total = wins + draws + losses;
  if (![wins, draws, losses].every(Number.isFinite) || total <= 0) return null;
  return Math.max(0, Math.min(1, (wins + draws / 2) / total));
}

export function candidateWinProbability(candidate = {}) {
  const wdlProbability = wdlWinProbability(candidate.wdl);
  if (wdlProbability !== null) return wdlProbability;

  const score = candidate.score;
  if (score?.type === "cp" && Number.isFinite(score.value)) {
    return 1 / (1 + Math.exp(-score.value / 120));
  }
  if (score?.type === "mate" && Number.isFinite(score.value)) {
    return score.value > 0 ? 0.999 : 0.001;
  }
  return 0.5;
}

export function compareEngineCandidates(left, right) {
  const leftWin = candidateWinProbability(left);
  const rightWin = candidateWinProbability(right);
  if (rightWin !== leftWin) return rightWin - leftWin;

  const leftMate =
    left.score?.type === "mate" && left.score.value > 0
      ? left.score.value
      : 9999;
  const rightMate =
    right.score?.type === "mate" && right.score.value > 0
      ? right.score.value
      : 9999;
  if (leftMate !== rightMate) return leftMate - rightMate;
  return String(left.move ?? left.pv?.[0] ?? "").localeCompare(
    String(right.move ?? right.pv?.[0] ?? ""),
  );
}

export function getErrorBudgetStatus(
  personaConfig,
  moveNumber,
  categoryHistory = [],
) {
  const history = categoryHistory
    .map((entry) =>
      typeof entry === "string" ? entry : entry?.category,
    )
    .filter((category) => CATEGORY_ORDER.includes(category));
  const softInWindow = history
    .slice(-9)
    .filter((category) => category === "soft").length;
  const blundersInWindow = history
    .slice(-19)
    .filter((category) => category === "blunder").length;
  const totalBlunders = history.filter(
    (category) => category === "blunder",
  ).length;
  const allowedBlundersInWindow =
    personaConfig.errorBudget.blunderPer20 *
    (Math.max(1, moveNumber) / 20);

  return {
    softExceeded:
      softInWindow >= personaConfig.errorBudget.softPer10,
    blunderExceeded:
      blundersInWindow >= allowedBlundersInWindow ||
      totalBlunders >= personaConfig.errorBudget.maxBlunderPerGame,
  };
}

function normalizeProbabilities(values) {
  const safe = values.map((value) =>
    Number.isFinite(value) ? Math.max(0, value) : 0,
  );
  const total = safe.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [1, 0, 0, 0];
  return safe.map((value) => value / total);
}

function styleMixValue(personaConfig, styles) {
  const stylesToMeasure = Array.isArray(styles) ? styles : [styles];
  if (personaConfig.styleMix) {
    return stylesToMeasure.reduce(
      (sum, style) => sum + (personaConfig.styleMix[style] ?? 0),
      0,
    );
  }
  return stylesToMeasure.includes(personaConfig.style) ? 1 : 0;
}

function errorRateMultiplier(personaConfig, advantage, category) {
  if (category !== "blunder") return 1;
  let multiplier = 1;
  if (advantage === "winning") {
    multiplier -=
      styleMixValue(personaConfig, ["conservative", "steady"]) * 0.5;
    multiplier += styleMixValue(personaConfig, "offensive") * 0.1;
    multiplier += styleMixValue(personaConfig, "risky") * 0.3;
    multiplier += styleMixValue(personaConfig, "impulsive") * 0.5;
  }
  if (advantage === "losing") {
    multiplier -= styleMixValue(personaConfig, "conservative") * 0.2;
    multiplier -= styleMixValue(personaConfig, "steady") * 0.3;
    multiplier += styleMixValue(personaConfig, "offensive") * 0.2;
    multiplier += styleMixValue(personaConfig, "risky") * 0.5;
    multiplier += styleMixValue(personaConfig, "impulsive") * 0.8;
  }
  return Math.max(0.25, multiplier);
}

export function getCategoryProbabilities(
  personaConfig,
  moveNumber,
  context = {},
) {
  const phase = getMovePhase(moveNumber);
  const values = [...personaConfig.probability[phase]];
  const advantage = context.advantage ?? "balanced";

  for (let index = 0; index < values.length; index += 1) {
    values[index] *= errorRateMultiplier(
      personaConfig,
      advantage,
      CATEGORY_ORDER[index],
    );
  }

  const budget = context.budget ?? getErrorBudgetStatus(
    personaConfig,
    moveNumber,
    context.categoryHistory,
  );
  if (budget.softExceeded) values[CATEGORY_INDEX.soft] = 0;
  if (budget.blunderExceeded) values[CATEGORY_INDEX.blunder] = 0;
  return normalizeProbabilities(values);
}

function inferAdvantage(bestWin) {
  if (bestWin >= 0.62) return "winning";
  if (bestWin <= 0.38) return "losing";
  return "balanced";
}

function moveCoordinates(moveOrUci) {
  let move = moveOrUci;
  if (typeof moveOrUci === "string") {
    if (!/^[a-i][0-9][a-i][0-9]$/.test(moveOrUci)) return null;
    move = uciToMove(moveOrUci);
  }
  if (
    !Array.isArray(move?.from) ||
    !Array.isArray(move?.to) ||
    move.from.length !== 2 ||
    move.to.length !== 2
  ) {
    return null;
  }
  return {
    move,
    fromRow: move.from[0],
    fromCol: move.from[1],
    toRow: move.to[0],
    toCol: move.to[1],
    piece: "",
    target: ".",
  };
}

function crossedRiver(row, side) {
  return side === "w" ? row <= 4 : row >= 5;
}

function isHeavyLossAfterMove(board, move, side) {
  const next = applyMove(board, move);
  const enemy = opposite(side);
  const enemyMoves = generateLegalMoves(next, enemy);
  return enemyMoves.some((reply) => {
    const target = next[reply.to[0]][reply.to[1]];
    return (
      target !== "." &&
      pieceSide(target) === side &&
      ["R", "C"].includes(target.toUpperCase())
    );
  });
}

function isImmediateLoss(board, move, side) {
  const next = applyMove(board, move);
  const enemy = opposite(side);
  const enemyStatus = gameStatus(next, enemy);
  const checkmate =
    enemyStatus.state !== "playing" &&
    enemyStatus.state === `${side === "w" ? "red" : "black"}_win`;
  const losesHeavy = isHeavyLossAfterMove(board, move, side);
  return {
    checkmate,
    losesHeavy,
  };
}

function buildPositionHistory(startFen, moves, currentBoard, side) {
  const history = [];
  try {
    const parsed = parseFen(startFen);
    let board = cloneBoard(parsed.board);
    let turn = parsed.turn;
    history.push(boardToFen(board, turn));
    for (const uci of moves) {
      if (typeof uci !== "string" || !/^[a-i][0-9][a-i][0-9]$/.test(uci)) {
        break;
      }
      board = applyMove(board, uciToMove(uci));
      turn = opposite(turn);
      history.push(boardToFen(board, turn));
    }
  } catch {
    return [boardToFen(currentBoard, side)];
  }
  return history;
}

function heavyPiecesUnderAttack(board, side) {
  const enemy = opposite(side);
  const threats = [];
  const seen = new Set();
  for (const reply of generateLegalMoves(board, enemy)) {
    const [row, col] = reply.to;
    const target = board[row][col];
    if (
      target === "." ||
      pieceSide(target) !== side ||
      !["R", "C"].includes(target.toUpperCase())
    ) {
      continue;
    }
    const key = `${row}:${col}`;
    if (seen.has(key)) continue;
    seen.add(key);
    threats.push({ row, col, piece: target });
  }
  return threats;
}

function candidateFeatures({
  board,
  side,
  move,
  nextBoard,
  loss,
  immediateLoss,
  positionHistory,
}) {
  const coordinates = moveCoordinates(move);
  if (!coordinates) {
    return Object.fromEntries(
      Object.keys(STYLE_WEIGHTS.balanced).map((key) => [key, false]),
    );
  }
  coordinates.piece = board[move.from[0]][move.from[1]] ?? ".";
  coordinates.target = board[move.to[0]][move.to[1]] ?? ".";
  const pieceType = coordinates.piece.toUpperCase();
  const targetType = coordinates.target.toUpperCase();
  const capturedValue = PIECE_VALUES[targetType] ?? 0;
  const movingValue = PIECE_VALUES[pieceType] ?? 0;
  const enemyMoves = generateLegalMoves(nextBoard, opposite(side));
  const enemyAttacksBefore = generateLegalMoves(board, opposite(side));
  const heavyThreatsBefore = heavyPiecesUnderAttack(board, side);
  const heavyThreatsAfter = heavyPiecesUnderAttack(nextBoard, side);
  const fromSquareAttacked = enemyAttacksBefore.some(
    (reply) =>
      reply.to[0] === move.from[0] && reply.to[1] === move.from[1],
  );
  const destinationAttacked = enemyMoves.some(
    (reply) =>
      reply.to[0] === move.to[0] && reply.to[1] === move.to[1],
  );
  const resultingFen = boardToFen(nextBoard, opposite(side));
  const fromRiver = crossedRiver(coordinates.fromRow, side);
  const toRiver = crossedRiver(coordinates.toRow, side);
  const movingHeavy = ["R", "C"].includes(pieceType);
  const heavyUnderThreatBefore = heavyThreatsBefore.some(
    (threat) =>
      threat.row === move.from[0] && threat.col === move.from[1],
  );
  const heavyStillThreatenedAtDestination = heavyThreatsAfter.some(
    (threat) =>
      threat.row === move.to[0] && threat.col === move.to[1],
  );

  return {
    check: isGeneralInCheck(nextBoard, opposite(side)),
    mate:
      gameStatus(nextBoard, opposite(side)).state ===
      `${side === "w" ? "red" : "black"}_win`,
    capture: coordinates.target !== ".",
    crossRiver: !fromRiver && toRiver,
    sacrifice:
      immediateLoss.losesHeavy ||
      (movingValue >= 4 && capturedValue < movingValue && loss >= 0.02),
    complex: enemyMoves.length >= 32,
    trade:
      coordinates.target !== "." &&
      movingValue >= 2 &&
      capturedValue >= 2,
    retreat: fromRiver && !toRiver,
    guardGeneral:
      isGeneralInCheck(board, side) ||
      distanceToGeneral(nextBoard, side, move.to) <= 2,
    simplify: coordinates.target !== "." && enemyMoves.length <= 28,
    pawn: pieceType === "P",
    coordinate: ["R", "C", "N"].includes(pieceType),
    evade:
      (isGeneralInCheck(board, side) || fromSquareAttacked) &&
      !destinationAttacked,
    heavyValue: movingValue,
    heavyUnderThreatBefore,
    heavyEscape:
      movingHeavy &&
      heavyUnderThreatBefore &&
      !heavyStillThreatenedAtDestination,
    heavyThreatReduced:
      heavyThreatsAfter.length < heavyThreatsBefore.length,
    heavyThreatCleared:
      heavyThreatsBefore.length > 0 && heavyThreatsAfter.length === 0,
    repeat: positionHistory.slice(0, -1).includes(resultingFen),
  };
}

function distanceToGeneral(board, side, point) {
  const general = findGeneral(board, side);
  if (!general) return Number.POSITIVE_INFINITY;
  return Math.abs(general[0] - point[0]) + Math.abs(general[1] - point[1]);
}

function openingProfile(board, side, move, moveNumber) {
  if (moveNumber > 15) return "";
  const coordinates = moveCoordinates(move);
  if (!coordinates) return "";
  coordinates.piece = board[move.from[0]][move.from[1]] ?? ".";
  coordinates.target = board[move.to[0]][move.to[1]] ?? ".";
  const type = coordinates.piece.toUpperCase();
  const crossed = !crossedRiver(coordinates.fromRow, side) &&
    crossedRiver(coordinates.toRow, side);

  if (type === "C" && coordinates.toCol === 4) return "中炮";
  if (type === "C" && [3, 5].includes(coordinates.toCol)) return "过宫炮";
  if (type === "C" && coordinates.fromRow >= 7) return "士角炮";
  if (type === "B" && coordinates.toCol === 4) return "飞相";
  if (type === "A") return "上士";
  if (type === "P" && [2, 6].includes(coordinates.fromCol)) return "仙人指路";
  if (type === "N") return "起马";
  if ((type === "B" || type === "A") && moveNumber > 3) return "补士象";
  if (type === "R" && crossed && moveNumber <= 8) return "急进过河车";
  if (type === "R" && [4, 5].includes(coordinates.toRow)) return "巡河";
  if (coordinates.target !== ".") return "兑子";
  if (type !== "P" && moveNumber <= 3) return "乱出子";
  return "";
}

function openingPreferenceBonus(personaConfig, board, side, move, moveNumber) {
  const profile = openingProfile(board, side, move, moveNumber);
  const preferenceWeights =
    personaConfig.openingPreferenceWeights ??
    Object.fromEntries(
      (personaConfig.openingPreferences ?? []).map((item) => [item, 1]),
    );
  const preferenceScore = (name) =>
    Math.max(0, Number(preferenceWeights[name]) || 0);
  if (!profile) {
    return moveNumber <= 3 &&
      styleMixValue(personaConfig, "impulsive") > 0.5
      ? 6
      : 0;
  }

  let bonus = preferenceScore(profile) * 28;
  if (
    profile === "中炮" &&
    preferenceScore("仙人指路转中炮") > 0
  ) {
    bonus += preferenceScore("仙人指路转中炮") * 24;
  }
  if (
    profile === "急进过河车" &&
    preferenceScore("急进过河车") > 0
  ) {
    bonus += preferenceScore("急进过河车") * 28;
  }
  if (
    profile === "兑子" &&
    preferenceScore("贪吃") > 0
  ) {
    bonus += preferenceScore("贪吃") * 24;
  }
  return bonus;
}

export function styleBonus(
  personaConfig,
  features,
  context = {},
) {
  const weights =
    personaConfig.styleWeights ??
    STYLE_WEIGHTS[personaConfig.style] ??
    STYLE_WEIGHTS.balanced;
  let bonus = 0;
  for (const [key, weight] of Object.entries(weights)) {
    if (features[key]) bonus += weight;
  }

  const phase = context.phase ?? "opening";
  const aggressive = styleMixValue(personaConfig, [
    "offensive",
    "risky",
    "impulsive",
  ]);
  const cautious = styleMixValue(personaConfig, [
    "conservative",
    "steady",
  ]);
  const offensive = styleMixValue(personaConfig, [
    "offensive",
    "risky",
  ]);
  if (
    phase === "middlegame" &&
    context.complexBattle &&
    aggressive > 0.5
  ) {
    bonus *= 1 + aggressive * 0.3;
  }
  if (phase === "middlegame" && context.materialBehind) {
    const conservative = styleMixValue(personaConfig, "conservative");
    const steady = styleMixValue(personaConfig, "steady");
    if (features.trade) {
      bonus += 18 * conservative + 12 * steady;
    }
    if (features.simplify) {
      bonus += 14 * conservative + 10 * steady;
    }
    if (features.guardGeneral) {
      bonus += 18 * conservative + 12 * steady;
    }
  }
  if (phase === "middlegame" && context.enemyGeneralUnsafe) {
    if (features.check) bonus += 22 * offensive;
    if (features.sacrifice) bonus += 22 * offensive;
    if (features.crossRiver) bonus += 16 * offensive;
  }
  if (phase === "middlegame" && context.ownGeneralUnsafe) {
    if (features.guardGeneral) bonus += 22 * cautious;
    if (features.retreat) bonus += 16 * cautious;
    if (features.trade) bonus += 14 * cautious;
  }
  if (
    context.repeatedPosition &&
    styleMixValue(personaConfig, "impulsive") <= 0.5
  ) {
    if (features.repeat) bonus -= 25;
  }
  if (context.advantage === "winning") {
    if (features.complex) {
      bonus +=
        16 *
        styleMixValue(personaConfig, "offensive");
    }
    if (features.sacrifice) {
      bonus += 24 * styleMixValue(personaConfig, "risky");
    }
  }
  if (context.advantage === "losing") {
    const offensiveOnly = styleMixValue(personaConfig, "offensive");
    const riskyOnly = styleMixValue(personaConfig, "risky");
    if (features.check) bonus += 20 * offensiveOnly;
    if (features.sacrifice) {
      bonus += 20 * offensiveOnly + 28 * riskyOnly;
    }
    if (features.complex) bonus += 22 * riskyOnly;
  }
  return bonus;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

export function selectCategory(probabilities, rng = Math.random) {
  let roll = rng();
  for (let index = 0; index < probabilities.length; index += 1) {
    roll -= probabilities[index];
    if (roll <= 0) return CATEGORY_ORDER[index];
  }
  return CATEGORY_ORDER[0];
}

function fallbackOrder(category) {
  if (category === "strong") return ["strong", "normal", "soft", "blunder"];
  if (category === "normal") return ["normal", "strong", "soft", "blunder"];
  if (category === "soft") return ["soft", "normal", "strong", "blunder"];
  return ["blunder", "soft", "normal", "strong"];
}

function weightedPick(candidates, personaConfig, rng) {
  const exponent = Math.max(0.35, 1 - personaConfig.temperature / 200);
  const weighted = candidates.map((candidate) => {
    const noise = rng() * personaConfig.temperature * 0.35;
    const raw = Math.max(
      1,
      120 + candidate.styleBonus + candidate.openingBonus + noise,
    );
    return { candidate, weight: Math.pow(raw, exponent) };
  });
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let roll = rng() * total;
  for (const item of weighted) {
    roll -= item.weight;
    if (roll <= 0) return item.candidate;
  }
  return weighted[weighted.length - 1].candidate;
}

function selectFromPools(candidates, category, personaConfig, rng) {
  for (const fallback of fallbackOrder(category)) {
    const pool = candidates.filter(
      (candidate) => candidate.effectiveCategory === fallback,
    );
    if (pool.length) return weightedPick(pool, personaConfig, rng);
  }
  return candidates[0];
}

function normalizeCandidates(candidates) {
  if (!Array.isArray(candidates)) return [];
  return candidates
    .map((candidate, index) => {
      const move = String(candidate.move ?? candidate.pv?.[0] ?? "")
        .trim()
        .toLowerCase();
      if (!/^[a-i][0-9][a-i][0-9]$/.test(move)) return null;
      return {
        ...candidate,
        move,
        multipv: Number(candidate.multipv) || index + 1,
      };
    })
    .filter(Boolean);
}

function weightedIntentPick(candidates, rng) {
  const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  let roll = rng() * total;
  for (const candidate of candidates) {
    roll -= candidate.weight;
    if (roll <= 0) return candidate;
  }
  return candidates[candidates.length - 1];
}

function withIntentResult(
  selection,
  personaConfig,
  intent,
  intentApplied,
  intentFallbackReason = "",
) {
  if (!selection) return null;
  return {
    ...selection,
    intent,
    intentName: MOVE_INTENTS[intent],
    intentApplied,
    intentFallbackReason,
  };
}

function chooseIntentMove({
  board,
  side,
  startFen,
  moves,
  candidates,
  personaConfig,
  moveNumber,
  intent,
  seed,
}) {
  const bestWin = Math.max(
    ...candidates.map((candidate) => candidateWinProbability(candidate)),
  );
  if (
    intent === "preserveMaterial" &&
    heavyPiecesUnderAttack(board, side).length === 0
  ) {
    return withIntentResult(
      choosePersonaMove({
        board,
        side,
        startFen,
        moves,
        candidates,
        persona: personaConfig,
        personaTraits: personaConfig.traits,
        moveNumber,
        categoryHistory: [],
        seed,
        intent: "persona",
      }),
      personaConfig,
      intent,
      false,
      "当前没有车炮受威胁，已按人格应手",
    );
  }
  const rng = mulberry32(
    seed ??
      personaConfig.seed ^
        hashString(
          `${startFen ?? boardToFen(board, side)}|${moves.join(" ")}|${moveNumber}|${intent}|strict`,
        ),
  );
  const positionHistory = buildPositionHistory(startFen, moves, board, side);
  const decorated = candidates.map((candidate) => {
    const move = uciToMove(candidate.move);
    const nextBoard = applyMove(board, move);
    const immediateLoss = isImmediateLoss(board, move, side);
    const winProbability = candidateWinProbability(candidate);
    const loss = Math.max(0, bestWin - winProbability);
    const features = candidateFeatures({
      board,
      side,
      move,
      nextBoard,
      loss,
      immediateLoss,
      positionHistory,
    });
    return {
      ...candidate,
      winProbability,
      loss,
      features,
      critical: immediateLoss.checkmate || immediateLoss.losesHeavy,
    };
  });

  const ranked = [...decorated].sort(compareEngineCandidates);
  let pool = decorated;
  if (intent === "nonBest") {
    const excluded = new Set([`${ranked[0].move}:${ranked[0].multipv}`]);
    const nonCritical = decorated.filter(
      (candidate) =>
        !excluded.has(`${candidate.move}:${candidate.multipv}`) &&
        !candidate.critical,
    );
    const nonBest = decorated.filter(
      (candidate) =>
        !excluded.has(`${candidate.move}:${candidate.multipv}`),
    );
    pool = nonCritical.length ? nonCritical : nonBest;
  } else if (intent === "capture") {
    pool = decorated.filter((candidate) => candidate.features.capture);
  } else if (intent === "check") {
    pool = decorated.filter((candidate) => candidate.features.check);
  } else if (intent === "evade") {
    pool = decorated.filter((candidate) => candidate.features.evade);
  } else if (intent === "preserveMaterial") {
    const threatsReduced = decorated.filter(
      (candidate) =>
        candidate.features.heavyEscape ||
        candidate.features.heavyThreatReduced,
    );
    const safest = decorated.filter(
      (candidate) =>
        candidate.features.heavyUnderThreatBefore ||
        candidate.features.heavyThreatReduced ||
        candidate.features.guardGeneral,
    );
    pool = threatsReduced.length ? threatsReduced : safest;
  }

  if (!pool.length) {
    return withIntentResult(
      choosePersonaMove({
        board,
        side,
        startFen,
        moves,
        candidates,
        persona: personaConfig,
        personaTraits: personaConfig.traits,
        moveNumber,
        categoryHistory: [],
        seed,
        intent: "persona",
      }),
      personaConfig,
      intent,
      false,
      "没有符合该倾向的候选，已按人格应手",
    );
  }
  const intentApplied = true;

  const weighted = pool.map((candidate) => {
    let weight = 100;
    if (intent === "nonBest") {
      weight = 20 + candidate.loss * 1200;
      if (candidate.critical) weight *= 0.2;
    } else if (intent === "capture") {
      weight = 80 + candidate.features.sacrifice * -20 + candidate.loss * 120;
    } else if (intent === "check") {
      weight =
        (candidate.features.mate ? 100000 : 80) +
        candidate.loss * 80;
    } else if (intent === "evade") {
      weight = 80 + Math.max(0, 0.5 - candidate.loss) * 120;
    } else if (intent === "preserveMaterial") {
      weight =
        120 +
        (candidate.features.heavyThreatCleared ? 180 : 0) +
        (candidate.features.heavyEscape ? 140 : 0) +
        (candidate.features.heavyThreatReduced ? 100 : 0) +
        Math.max(0, 0.35 - candidate.loss) * 100;
      if (candidate.features.heavyUnderThreatBefore) weight += 30;
    }
    return { ...candidate, weight: Math.max(1, weight + rng() * 30) };
  });
  const selected = weightedIntentPick(weighted, rng);
  const category = classifyCandidateLoss(selected.loss);
  return {
    ...selected,
    category,
    categoryName: CATEGORY_NAMES[category],
    originalCategory: category,
    originalCategoryName: CATEGORY_NAMES[category],
    phase: getMovePhase(moveNumber),
    personaId: personaConfig.id,
    personaName: personaConfig.name,
    personaTraits: personaConfig.traits,
    moveNumber,
    probabilities: null,
    intent,
    intentName: MOVE_INTENTS[intent],
    intentApplied,
    intentFallbackReason: "",
  };
}

export function choosePersonaMove({
  board,
  side,
  startFen,
  moves = [],
  candidates = [],
  persona = PERSONAS["intermediate-balanced"],
  personaTraits = [],
  controller = null,
  moveNumber = 1,
  categoryHistory = [],
  seed,
  intent = "persona",
} = {}) {
  const personaConfig = resolvePersona(
    persona,
    personaTraits,
    controller,
  );
  const normalized = normalizeCandidates(candidates);
  if (!normalized.length) return null;
  if (intent && intent !== "persona" && MOVE_INTENTS[intent]) {
    return chooseIntentMove({
      board,
      side,
      startFen,
      moves,
      candidates: normalized,
      personaConfig,
      moveNumber,
      intent,
      seed,
    });
  }

  if (personaConfig.mode === "engine_best") {
    const selected = [...normalized].sort(compareEngineCandidates)[0];
    return {
      ...selected,
      category: "strong",
      categoryName: CATEGORY_NAMES.strong,
      phase: getMovePhase(moveNumber),
      personaId: personaConfig.id,
      personaName: personaConfig.name,
      personaTraits: personaConfig.traits,
      moveNumber,
      loss: 0,
      winProbability: candidateWinProbability(selected),
      critical: false,
      selectedBy: "engine_best",
      controller: getControllerDecision(
        personaConfig,
        categoryHistory.length,
        personaConfig.signature,
      ),
    };
  }

  const controllerDecision = getControllerDecision(
    personaConfig,
    categoryHistory.length,
    personaConfig.signature,
  );
  const ranked = [...normalized].sort(compareEngineCandidates);
  if (controllerDecision.isBestStep) {
    const selected = ranked[0];
    return {
      ...selected,
      category: "strong",
      categoryName: CATEGORY_NAMES.strong,
      originalCategory: "strong",
      originalCategoryName: CATEGORY_NAMES.strong,
      phase: getMovePhase(moveNumber),
      personaId: personaConfig.id,
      personaName: personaConfig.name,
      personaTraits: personaConfig.traits,
      moveNumber,
      loss: 0,
      winProbability: candidateWinProbability(selected),
      critical: false,
      probabilities: [1, 0, 0, 0],
      selectedBy: "controller_best",
      controller: controllerDecision,
    };
  }

  const bestWin = Math.max(
    ...normalized.map((candidate) => candidateWinProbability(candidate)),
  );
  const randomSeed =
    seed ??
    personaConfig.seed ^
      hashString(
        `${startFen ?? boardToFen(board, side)}|${moves.join(" ")}|${moveNumber}|${personaConfig.signature}|${controllerDecision.stepIndex}`,
      );
  const rng = mulberry32(randomSeed);
  const positionHistory = buildPositionHistory(startFen, moves, board, side);
  const decorated = normalized.map((candidate) => {
    const move = uciToMove(candidate.move);
    const immediateLoss = isImmediateLoss(board, move, side);
    const winProbability = candidateWinProbability(candidate);
    const loss = Math.max(0, bestWin - winProbability);
    const originalCategory = classifyCandidateLoss(loss);
    let effectiveCategory = originalCategory;
    if (
      effectiveCategory === "blunder" &&
      (immediateLoss.checkmate || immediateLoss.losesHeavy) &&
      styleMixValue(personaConfig, "impulsive") < 0.5
    ) {
      effectiveCategory = "soft";
    } else if (
      effectiveCategory === "blunder" &&
      (immediateLoss.checkmate || immediateLoss.losesHeavy) &&
      rng() > 0.35
    ) {
      effectiveCategory = "soft";
    }

    const nextBoard = applyMove(board, move);
    const features = candidateFeatures({
      board,
      side,
      move,
      nextBoard,
      loss,
      immediateLoss,
      positionHistory,
    });
    const phase = getMovePhase(moveNumber);
    const featureContext = {
      phase,
      advantage: inferAdvantage(bestWin),
      complexBattle: features.complex,
      materialBehind: countMaterial(board, side) < countMaterial(board, opposite(side)),
      enemyGeneralUnsafe: isGeneralInCheck(nextBoard, opposite(side)),
      ownGeneralUnsafe: isGeneralInCheck(nextBoard, side),
      repeatedPosition: features.repeat,
    };
    return {
      ...candidate,
      winProbability,
      loss,
      originalCategory,
      effectiveCategory,
      critical: immediateLoss.checkmate || immediateLoss.losesHeavy,
      features,
      styleBonus: styleBonus(personaConfig, features, featureContext),
      openingBonus: openingPreferenceBonus(
        personaConfig,
        board,
        side,
        uciToMove(candidate.move),
        moveNumber,
      ),
    };
  });

  const advantage = inferAdvantage(bestWin);
  const budget = getErrorBudgetStatus(
    personaConfig,
    moveNumber,
    categoryHistory,
  );
  const probabilities = getCategoryProbabilities(
    personaConfig,
    moveNumber,
    {
      advantage,
      budget,
      categoryHistory,
    },
  );
  const category = selectCategory(probabilities, rng);
  const bestKey = `${ranked[0].move}:${ranked[0].multipv}`;
  const nonBestPool = decorated.filter(
    (candidate) => `${candidate.move}:${candidate.multipv}` !== bestKey,
  );
  const selectionPool = nonBestPool.length ? nonBestPool : decorated;
  const selected = selectFromPools(
    selectionPool,
    category,
    personaConfig,
    rng,
  );
  return {
    ...selected,
    category: selected.effectiveCategory,
    categoryName: CATEGORY_NAMES[selected.effectiveCategory],
    originalCategory: selected.originalCategory,
    originalCategoryName: CATEGORY_NAMES[selected.originalCategory],
    phase: getMovePhase(moveNumber),
    personaId: personaConfig.id,
    personaName: personaConfig.name,
    personaTraits: personaConfig.traits,
    moveNumber,
    probabilities,
    controller: controllerDecision,
    selectedBy: nonBestPool.length
      ? "controller_avoid"
      : "controller_fallback",
    controllerFallbackReason: nonBestPool.length
      ? ""
      : "候选池只有一个走法，无法避开引擎首选",
  };
}

function countMaterial(board, side) {
  let total = 0;
  for (const row of board) {
    for (const piece of row) {
      if (pieceSide(piece) !== side) continue;
      total += PIECE_VALUES[piece.toUpperCase()] ?? 0;
    }
  }
  return total;
}
