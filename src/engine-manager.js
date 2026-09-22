import { EventEmitter } from "node:events";

/**
 * EngineManager 单例：所有引擎指令都必须经这里排队，禁止绕过队列直写 stdin。
 *
 * 优先级（数字越小越优先）：
 *   quit(0) > stop(1) > position(2) > go movetime/depth(3) > go infinite(4)
 *
 * stop / quit 走"抢占"路径：它们不进队列，而是直接打断正在运行的搜索，
 * 这样复盘取消才能立刻终止当前 go，而不必等它跑完 movetime。
 */

export const ENGINE_PRIORITY = {
  quit: 0,
  stop: 1,
  position: 2,
  go: 3,
  infinite: 4,
};

const UCI_PATTERN = /^[a-i][0-9][a-i][0-9]$/;

function clampInteger(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

export function normalizeBestMoveResult(result) {
  const raw = typeof result?.bestmove === "string" ? result.bestmove : "";
  const bestmove = UCI_PATTERN.test(raw) ? raw : "(none)";
  const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
  const best =
    candidates.find((candidate) => candidate.move === raw) ??
    candidates[0] ??
    null;
  return {
    bestmove,
    ponder: result?.ponder ?? null,
    score: bestmove === "(none)" ? null : best?.score ?? null,
    wdl: best?.wdl ?? null,
    depth: best?.depth ?? null,
    seldepth: best?.seldepth ?? null,
    nodes: best?.nodes ?? null,
    nps: best?.nps ?? null,
    pv: Array.isArray(best?.pv) ? best.pv : [],
    thinkTime: result?.thinkTime ?? null,
    candidates: candidates.map((candidate) => ({
      move: candidate.move,
      score: candidate.score ?? null,
      depth: candidate.depth ?? null,
      multipv: candidate.multipv ?? 1,
    })),
  };
}

export class EngineManager extends EventEmitter {
  constructor(engine, { commandLogLimit = 500 } = {}) {
    super();
    this.engine = engine;
    this.queue = [];
    this.running = null;
    this.draining = false;
    this.sequence = 0;
    this.commandLog = [];
    this.commandLogLimit = commandLogLimit;
    this.closed = false;
    this.#forwardEvents();
  }

  #forwardEvents() {
    for (const type of ["status", "info", "bestmove", "log"]) {
      this.engine.on(type, (payload) => this.emit(type, payload));
    }
    this.engine.on("command", (payload) => {
      this.commandLog.push(payload);
      if (this.commandLog.length > this.commandLogLimit) {
        this.commandLog = this.commandLog.slice(-this.commandLogLimit);
      }
      this.emit("command", payload);
    });
  }

  recentCommands(limit = 120) {
    const size = Math.max(1, Math.min(this.commandLogLimit, limit));
    return this.commandLog.slice(-size);
  }

  submit({ priority = ENGINE_PRIORITY.go, label = "", run, interruptible = false }) {
    if (typeof run !== "function") {
      throw new Error("引擎任务必须提供执行体。");
    }
    return new Promise((resolve, reject) => {
      this.queue.push({
        priority,
        label,
        run,
        interruptible,
        sequence: (this.sequence += 1),
        resolve,
        reject,
        cancelled: false,
      });
      void this.#drain();
    });
  }

  async #drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length) {
        this.queue.sort(
          (left, right) =>
            left.priority - right.priority || left.sequence - right.sequence,
        );
        const task = this.queue.shift();
        if (task.cancelled) {
          task.resolve({ cancelled: true, label: task.label });
          continue;
        }
        this.running = task;
        try {
          const value = await task.run();
          task.resolve(value);
        } catch (error) {
          task.reject(error);
        } finally {
          this.running = null;
        }
      }
    } finally {
      this.draining = false;
    }
  }

  /**
   * 取消队列里满足条件的任务（默认取消所有还没开始的任务）。
   */
  cancelQueued(predicate = () => true) {
    let cancelled = 0;
    for (const task of this.queue) {
      if (task.cancelled) continue;
      if (!predicate(task)) continue;
      task.cancelled = true;
      cancelled += 1;
    }
    return cancelled;
  }

  async initialize(options = {}) {
    this.closed = false;
    return this.submit({
      priority: ENGINE_PRIORITY.position,
      label: "initialize",
      run: () => this.engine.initialize(options),
    });
  }

  async setOptions(options = {}) {
    return this.submit({
      priority: ENGINE_PRIORITY.position,
      label: "setOptions",
      run: () => this.engine.setOptions(options),
    });
  }

  async newGame() {
    return this.submit({
      priority: ENGINE_PRIORITY.position,
      label: "ucinewgame",
      run: () => this.engine.newGame(),
    });
  }

  async go(options = {}) {
    return this.submit({
      priority: ENGINE_PRIORITY.go,
      label: `go movetime ${options.maxThinkMs ?? 3000}`,
      interruptible: true,
      run: () => this.engine.go(options),
    });
  }

  async analyze(options = {}) {
    return this.submit({
      priority: ENGINE_PRIORITY.infinite,
      label: "go infinite",
      run: () => this.engine.analyze(options),
    });
  }

  /**
   * 预判续算：假定对手走 predictedMove，先在该子局面上开着引擎。
   */
  async startPonder(options = {}) {
    return this.submit({
      priority: ENGINE_PRIORITY.infinite,
      label: "go ponder infinite",
      run: () => this.engine.startPonder(options),
    });
  }

  /**
   * ponderhit 属于"继续正在进行的搜索"：优先级要高于排队中的 position / analyze，
   * 又不能被 stop() 的队列清理顺手取消（那条规则只清 priority >= go 的任务），
   * 所以给它 stop 级的优先级。
   */
  async ponderHit(options = {}) {
    return this.submit({
      priority: ENGINE_PRIORITY.stop,
      label: "ponderhit",
      run: () => this.engine.ponderHit(options),
    });
  }

  /**
   * 预判落空：抢占式停掉预判搜索，并清掉队列里还没开始的低优先级任务。
   */
  async ponderStop(options = {}) {
    return this.submit({
      priority: ENGINE_PRIORITY.stop,
      label: "ponderstop",
      run: () => this.engine.ponderStop(options),
    });
  }

  /**
   * 复盘 / 训练专用：固定时长搜索，返回最优着法与原始评分。
   */
  async getBestMove({ startFen, moves = [], movetimeMs = 3000, depth = 0 } = {}) {
    const thinkMs = clampInteger(movetimeMs, 3000, 1, 1800000);
    const searchDepth = clampInteger(depth, 0, 0, 128);
    const result = await this.submit({
      priority: ENGINE_PRIORITY.go,
      label: `go${searchDepth ? ` depth ${searchDepth}` : ""} movetime ${thinkMs}`,
      interruptible: true,
      run: () =>
        this.engine.go({
          startFen,
          moves,
          maxThinkMs: thinkMs,
          multiPV: 1,
          depth: searchDepth,
        }),
    });
    if (result?.cancelled) return { cancelled: true, bestmove: "(none)", score: null };
    return normalizeBestMoveResult(result);
  }

  /**
   * stop 抢占：先清掉还没开始的高优先级任务，再直接打断正在跑的搜索。
   */
  async stop({ wait = true, clearQueue = true } = {}) {
    let cleared = 0;
    if (clearQueue) {
      cleared = this.cancelQueued(
        (task) => task.priority >= ENGINE_PRIORITY.go,
      );
    }
    try {
      const result = await this.engine.stop({ wait });
      return { ...result, cleared };
    } catch (error) {
      return {
        ok: false,
        cleared,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async quit() {
    this.closed = true;
    this.cancelQueued(() => true);
    try {
      await this.engine.quit();
    } catch {
      // 进程可能已经退出。
    }
    return { ok: true };
  }

  get commandLogSnapshot() {
    return this.commandLog.map((entry) => ({ ...entry }));
  }

  get busy() {
    return Boolean(this.running);
  }

  get currentLabel() {
    return this.running?.label ?? "";
  }
}
