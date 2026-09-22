import test from "node:test";
import assert from "node:assert/strict";
import {
  PERSONAS,
  PERSONA_LIST,
  buildControllerPlan,
  choosePersonaMove,
  classifyCandidateLoss,
  getCategoryProbabilities,
  getControllerDecision,
  getMovePhase,
  normalizeController,
  normalizePersonaTraits,
  resolvePersona,
} from "../src/persona.js";
import {
  START_FEN,
  parseFen,
} from "../src/xiangqi.js";

function candidatesFromStart() {
  return [
    {
      move: "b2e2",
      multipv: 1,
      wdl: { wins: 1000, draws: 0, losses: 0 },
    },
    {
      move: "h2e2",
      multipv: 2,
      wdl: { wins: 850, draws: 100, losses: 50 },
    },
    {
      move: "b0c2",
      multipv: 3,
      wdl: { wins: 650, draws: 100, losses: 250 },
    },
    {
      move: "h0g2",
      multipv: 4,
      wdl: { wins: 350, draws: 100, losses: 550 },
    },
  ];
}

function startPosition() {
  const parsed = parseFen(START_FEN);
  return {
    board: parsed.board,
    side: parsed.turn,
  };
}

test("move phases and loss thresholds follow the configured boundaries", () => {
  assert.equal(getMovePhase(1), "opening");
  assert.equal(getMovePhase(15), "opening");
  assert.equal(getMovePhase(16), "middlegame");
  assert.equal(getMovePhase(50), "middlegame");
  assert.equal(getMovePhase(51), "endgame");

  assert.equal(classifyCandidateLoss(0), "strong");
  assert.equal(classifyCandidateLoss(0.0199), "strong");
  assert.equal(classifyCandidateLoss(0.02), "normal");
  assert.equal(classifyCandidateLoss(0.0799), "normal");
  assert.equal(classifyCandidateLoss(0.08), "soft");
  assert.equal(classifyCandidateLoss(0.1499), "soft");
  assert.equal(classifyCandidateLoss(0.15), "blunder");
});

test("controller plans preserve the requested quota and streak constraints", () => {
  for (const persona of PERSONA_LIST) {
    const controller = persona.controller;
    const first = buildControllerPlan(controller, 3, persona.id);
    const second = buildControllerPlan(controller, 3, persona.id);
    assert.deepEqual(first, second, `${persona.id} should be deterministic`);
    assert.equal(first.length, controller.cycleN);
    assert.ok(
      first.filter(Boolean).length >= controller.bestCount,
      `${persona.id} should keep at least bestCount best steps`,
    );
    assert.ok(
      first.filter((value) => !value).length >= controller.avoidCount,
      `${persona.id} should keep at least avoidCount avoid steps`,
    );

    let avoidRun = 0;
    let bestRun = 0;
    for (const isBest of first) {
      if (isBest) {
        if (avoidRun > 0) {
          assert.ok(
            avoidRun <= controller.maxStreakAvoid,
            `${persona.id} has a too-long avoid run`,
          );
        }
        avoidRun = 0;
        bestRun += 1;
      } else {
        if (bestRun > 0) {
          assert.ok(
            bestRun >= controller.minStreakBest,
            `${persona.id} has a too-short best run`,
          );
        }
        bestRun = 0;
        avoidRun += 1;
      }
    }
    if (avoidRun > 0) {
      assert.ok(
        avoidRun <= controller.maxStreakAvoid,
        `${persona.id} ends with a too-long avoid run`,
      );
    }
    if (bestRun > 0) {
      assert.ok(
        bestRun >= controller.minStreakBest,
        `${persona.id} ends with a too-short best run`,
      );
    }
  }
});

test("controller normalization keeps the quota inside one cycle", () => {
  const controller = normalizeController({
    cycleN: 20,
    bestCount: 18,
    avoidCount: 9,
    minStreakBest: 4,
    maxStreakAvoid: 3,
  });
  assert.equal(controller.cycleN, 20);
  assert.equal(controller.bestCount, 18);
  assert.equal(controller.avoidCount, 2);
  assert.equal(controller.bestCount + controller.avoidCount, 20);
});

test("controller decisions are deterministic and use the supplied step index", () => {
  const persona = PERSONAS["expert-steady"];
  const first = getControllerDecision(persona, 9, persona.id);
  const second = getControllerDecision(persona, 9, persona.id);
  assert.deepEqual(first, second);
  assert.equal(first.cycleIndex, 0);
  assert.equal(first.cycleStep, 9);
  assert.equal(first.plan.length, persona.controller.cycleN);
});

test("persona overlays merge style, probabilities, and opening preferences", () => {
  const traits = normalizePersonaTraits([
    { trait: "offensive", weight: 1.5 },
    { trait: "steady", weight: 0.5 },
  ]);
  const merged = resolvePersona("intermediate-balanced", traits);

  assert.ok(merged.styleMix.offensive > merged.styleMix.steady);
  assert.ok(merged.styleWeights.crossRiver > 0);
  assert.ok(
    Math.abs(merged.probability.opening[0] - 0.4216666667) < 0.000001,
  );
  assert.ok(
    Math.abs(merged.probability.opening[2] - 0.215) < 0.000001,
  );
  assert.ok(
    Object.keys(merged.openingPreferenceWeights).includes("中炮"),
  );
  assert.equal(merged.traits.length, 2);
  assert.match(merged.signature, /offensive:1\.5/);
});

test("controller overrides are merged into the resolved persona", () => {
  const resolved = resolvePersona(
    "intermediate-balanced",
    [],
    {
      cycleN: 12,
      bestCount: 4,
      avoidCount: 8,
      minStreakBest: 2,
      maxStreakAvoid: 2,
      shuffle: false,
    },
  );
  assert.equal(resolved.controller.cycleN, 12);
  assert.equal(resolved.controller.bestCount, 4);
  assert.equal(resolved.controller.avoidCount, 8);
  assert.equal(resolved.controller.minStreakBest, 2);
  assert.equal(resolved.controller.maxStreakAvoid, 2);
  assert.equal(resolved.controller.shuffle, false);
});

test("controller best steps choose the engine top move", () => {
  const persona = PERSONAS["intermediate-balanced"];
  const stepIndex = Array.from({ length: 40 }, (_, index) => index)
    .find((index) =>
      getControllerDecision(persona, index, persona.id).isBestStep,
    );
  assert.notEqual(stepIndex, undefined);
  const decision = getControllerDecision(persona, stepIndex, persona.id);
  assert.equal(decision.isBestStep, true);
  const { board, side } = startPosition();
  const selection = choosePersonaMove({
    board,
    side,
    startFen: START_FEN,
    moves: [],
    candidates: candidatesFromStart(),
    persona,
    moveNumber: stepIndex + 1,
    categoryHistory: Array.from({ length: stepIndex }, () => "strong"),
    seed: 17,
  });

  assert.equal(selection.move, "b2e2");
  assert.equal(selection.selectedBy, "controller_best");
});

test("controller avoid steps exclude the engine top move", () => {
  const persona = PERSONAS["intermediate-balanced"];
  const stepIndex = Array.from({ length: 40 }, (_, index) => index)
    .find((index) => {
      const decision = getControllerDecision(persona, index, persona.id);
      return !decision.isBestStep;
    });
  assert.notEqual(stepIndex, undefined);
  const history = Array.from({ length: stepIndex }, () => "strong");
  const { board, side } = startPosition();
  const selection = choosePersonaMove({
    board,
    side,
    startFen: START_FEN,
    moves: [],
    candidates: candidatesFromStart(),
    persona,
    moveNumber: stepIndex + 1,
    categoryHistory: history,
    seed: 23,
  });

  assert.notEqual(selection.move, "b2e2");
  assert.equal(selection.selectedBy, "controller_avoid");
  assert.equal(selection.controller.isBestStep, false);
});

test("error budget removes exhausted soft and blunder categories", () => {
  const persona = PERSONAS["intermediate-balanced"];
  const probabilities = getCategoryProbabilities(persona, 20, {
    advantage: "balanced",
    categoryHistory: [
      "soft",
      "soft",
      "blunder",
      "blunder",
      "blunder",
      "blunder",
    ],
  });
  assert.equal(probabilities[2], 0);
  assert.equal(probabilities[3], 0);
});

test("intent fallback keeps the selected persona overlays", () => {
  const { board, side } = startPosition();
  const selection = choosePersonaMove({
    board,
    side,
    startFen: START_FEN,
    moves: [],
    candidates: candidatesFromStart(),
    persona: PERSONAS["intermediate-balanced"],
    personaTraits: [{ trait: "offensive", weight: 0.8 }],
    moveNumber: 1,
    categoryHistory: [],
    seed: 29,
    intent: "preserveMaterial",
  });

  assert.equal(selection.intent, "preserveMaterial");
  assert.equal(selection.intentApplied, false);
  assert.ok(
    selection.personaTraits.some(
      (trait) => trait.id === "offensive" && trait.weight === 0.8,
    ),
  );
});

test("undoing persona history restores the same controller decision", () => {
  const persona = PERSONAS["expert-offensive"];
  const stepIndex = 13;
  const first = getControllerDecision(persona, stepIndex, persona.id);
  const history = Array.from({ length: stepIndex }, (_, index) =>
    index % 2 === 0 ? "strong" : "normal",
  );
  const undecided = history.slice(0, -1);
  const restored = getControllerDecision(
    persona,
    undecided.length,
    persona.id,
  );

  assert.equal(restored.stepIndex, stepIndex - 1);
  assert.notDeepEqual(restored, first);
  assert.deepEqual(
    getControllerDecision(persona, undecided.length, persona.id),
    restored,
  );
});
