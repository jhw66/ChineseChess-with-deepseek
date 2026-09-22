import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  ENGINE_PRIORITY,
  EngineManager,
  normalizeBestMoveResult,
} from "../src/engine-manager.js";

class FakeEngine extends EventEmitter {
  constructor() {
    super();
    this.commands = [];
    this.stopCalls = 0;
    this.quitCalls = 0;
    this.goResult = {
      bestmove: "h2e2",
      ponder: null,
      thinkTime: 3000,
      candidates: [
        {
          move: "h2e2",
          score: { type: "cp", value: 42 },
          depth: 21,
          seldepth: 28,
          nodes: 123456,
          nps: 900000,
          multipv: 1,
          pv: ["h2e2", "h9g7"],
        },
      ],
    };
  }

  log(command) {
    this.commands.push(command);
    this.emit("command", { command, timestamp: Date.now() });
  }

  async initialize() {
    this.log("uci");
    return { ok: true, options: { Threads: 14 } };
  }

  async setOptions() {
    this.log("setoption");
    return { ok: true };
  }

  async newGame() {
    this.log("ucinewgame");
    return { ok: true };
  }

  async go(options = {}) {
    this.log(`go movetime ${options.maxThinkMs ?? 3000}`);
    return { ...this.goResult };
  }

  async analyze() {
    this.log("go infinite");
    return { ok: true, analysis: true };
  }

  async startPonder(options = {}) {
    this.log("go ponder infinite");
    return {
      ok: true,
      pondering: true,
      budgetMs: options.budgetMs ?? 3000,
    };
  }

  async ponderHit() {
    this.log("ponderhit");
    return { ok: true, pondering: false, bestmove: "h9g7" };
  }

  async ponderStop() {
    this.log("ponderstop");
    return { ok: true, wasSearching: true };
  }

  async stop() {
    this.stopCalls += 1;
    this.log("stop");
    return { ok: true, wasSearching: true };
  }

  async quit() {
    this.quitCalls += 1;
    this.log("quit");
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("normalizeBestMoveResult keeps UCI, score and depth for review", () => {
  const engine = new FakeEngine();
  const normalized = normalizeBestMoveResult(engine.goResult);
  assert.equal(normalized.bestmove, "h2e2");
  assert.deepEqual(normalized.score, { type: "cp", value: 42 });
  assert.equal(normalized.depth, 21);
  assert.deepEqual(normalized.pv, ["h2e2", "h9g7"]);
  assert.equal(normalized.candidates.length, 1);

  // 引擎返回 (none) / 非法串时统一成 (none) 且不带分值。
  assert.equal(normalizeBestMoveResult({ bestmove: "(none)" }).bestmove, "(none)");
  assert.equal(normalizeBestMoveResult({ bestmove: "0000" }).bestmove, "(none)");
  assert.equal(normalizeBestMoveResult({}).score, null);
  assert.equal(normalizeBestMoveResult({}).depth, null);
});

test("the serial queue honours priority before submission order", async () => {
  const manager = new EngineManager(new FakeEngine());
  const order = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const blocker = manager.submit({
    priority: ENGINE_PRIORITY.go,
    label: "blocker",
    run: async () => {
      order.push("blocker");
      await gate;
    },
  });
  assert.deepEqual(order, ["blocker"], "第一条任务必须立即开始");

  const low = manager.submit({
    priority: ENGINE_PRIORITY.go,
    label: "low",
    run: async () => {
      order.push("low");
    },
  });
  const high = manager.submit({
    priority: ENGINE_PRIORITY.position,
    label: "high",
    run: async () => {
      order.push("high");
    },
  });

  release();
  await Promise.all([blocker, low, high]);
  assert.deepEqual(order, ["blocker", "high", "low"]);
});

test("stop clears the queued reviews instead of letting them run", async () => {
  const engine = new FakeEngine();
  const manager = new EngineManager(engine);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let queuedRan = false;

  const running = manager.submit({
    priority: ENGINE_PRIORITY.go,
    label: "go movetime 3000",
    interruptible: true,
    run: async () => {
      await gate;
      return { bestmove: "h2e2" };
    },
  });
  const queued = manager.submit({
    priority: ENGINE_PRIORITY.go,
    label: "go movetime 3000",
    run: async () => {
      queuedRan = true;
      return { bestmove: "h9g7" };
    },
  });

  const stopped = await manager.stop({ wait: true, clearQueue: true });
  assert.equal(engine.stopCalls, 1, "取消必须真的向引擎发 stop");
  assert.equal(stopped.cleared, 1, "队列里剩下的复盘任务要被清空");

  release();
  await running;
  const queuedResult = await queued;
  assert.equal(queuedRan, false);
  assert.equal(queuedResult.cancelled, true);
  assert.equal(queuedResult.label, "go movetime 3000");
});

test("getBestMove runs a bounded search and never asks for go infinite", async () => {
  const engine = new FakeEngine();
  const manager = new EngineManager(engine);

  const result = await manager.getBestMove({
    startFen: "start-fen w - - 0 1",
    moves: ["h2e2"],
    movetimeMs: 3000,
  });

  assert.equal(result.bestmove, "h2e2");
  assert.deepEqual(result.score, { type: "cp", value: 42 });
  assert.equal(result.depth, 21);
  assert.ok(
    engine.commands.every((command) => !command.includes("go infinite")),
    "复盘分析禁止 go infinite",
  );
  assert.ok(
    engine.commands.includes("go movetime 3000"),
    "复盘每手必须走 go movetime 3000",
  );
});

test("getBestMove surfaces a cancelled task without a fake score", async () => {
  const engine = new FakeEngine();
  engine.go = async () => ({ cancelled: true });
  const manager = new EngineManager(engine);
  const result = await manager.getBestMove({
    startFen: "start-fen w - - 0 1",
    movetimeMs: 3000,
  });
  assert.equal(result.cancelled, true);
  assert.equal(result.bestmove, "(none)");
  assert.equal(result.score, null);
});

test("ponder commands are serialized with their own priority labels", async () => {
  const engine = new FakeEngine();
  const manager = new EngineManager(engine);

  const started = await manager.startPonder({
    startFen: "fen w - - 0 1",
    moves: [],
    budgetMs: 9000,
  });
  assert.equal(started.pondering, true);
  assert.equal(started.budgetMs, 9000);

  const hit = await manager.ponderHit();
  assert.equal(hit.bestmove, "h9g7");
  assert.equal(engine.commands.at(-1), "ponderhit");

  const stopped = await manager.ponderStop();
  assert.equal(stopped.wasSearching, true);
  assert.equal(engine.commands.at(-1), "ponderstop");
});

test("quit drops every queued task and closes the session", async () => {
  const engine = new FakeEngine();
  const manager = new EngineManager(engine);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let lateRan = false;

  const running = manager.submit({
    priority: ENGINE_PRIORITY.go,
    run: async () => {
      await gate;
    },
  });
  const late = manager.submit({
    priority: ENGINE_PRIORITY.go,
    run: async () => {
      lateRan = true;
    },
  });

  await manager.quit();
  assert.equal(engine.quitCalls, 1);
  assert.equal(manager.closed, true);

  release();
  await running;
  const lateResult = await late;
  assert.equal(lateRan, false);
  assert.equal(lateResult.cancelled, true);
});

test("recent commands are exposed for the on-page command log", async () => {
  const engine = new FakeEngine();
  const manager = new EngineManager(engine, { commandLogLimit: 5 });
  await manager.initialize();
  await manager.newGame();

  const commands = manager.recentCommands(10);
  assert.deepEqual(
    commands.map((entry) => entry.command),
    ["uci", "ucinewgame"],
  );

  // 日志长度受 limit 限制。
  for (let index = 0; index < 8; index += 1) engine.log(`extra ${index}`);
  assert.equal(manager.recentCommands(50).length, 5);
  assert.equal(manager.recentCommands(50).at(-1).command, "extra 7");
});

test("cancelQueued can target a subset of the queue", async () => {
  const engine = new FakeEngine();
  const manager = new EngineManager(engine);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const running = manager.submit({
    priority: ENGINE_PRIORITY.go,
    run: async () => {
      await gate;
    },
  });
  const marker = { reviewed: true };
  const queued = manager.submit({
    priority: ENGINE_PRIORITY.go,
    label: "review",
    run: async () => marker,
  });
  const kept = manager.submit({
    priority: ENGINE_PRIORITY.position,
    label: "keep",
    run: async () => 1,
  });

  const cancelled = manager.cancelQueued((task) => task.label === "review");
  assert.equal(cancelled, 1);

  release();
  await running;
  const result = await queued;
  assert.equal(result.cancelled, true);
  assert.equal(await kept, 1);
});

test("busy and currentLabel describe the in-flight task", async () => {
  const engine = new FakeEngine();
  const manager = new EngineManager(engine);
  assert.equal(manager.busy, false);

  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const running = manager.submit({
    priority: ENGINE_PRIORITY.go,
    label: "go movetime 3000",
    run: async () => {
      await gate;
    },
  });
  assert.equal(manager.busy, true);
  assert.equal(manager.currentLabel, "go movetime 3000");

  release();
  await running;
  await tick();
  assert.equal(manager.busy, false);
  assert.equal(manager.currentLabel, "");
});
