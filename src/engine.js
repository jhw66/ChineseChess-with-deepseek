import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import fs from "node:fs";
import path from "node:path";

function sanitizeInteger(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function parseScore(tokens) {
  const scoreIndex = tokens.indexOf("score");
  if (scoreIndex < 0 || scoreIndex + 2 >= tokens.length) return null;
  const type = tokens[scoreIndex + 1];
  const value = Number.parseInt(tokens[scoreIndex + 2], 10);
  if (!Number.isFinite(value)) return null;
  return { type, value };
}

function parseWdl(tokens) {
  const wdlIndex = tokens.indexOf("wdl");
  if (wdlIndex < 0 || wdlIndex + 3 >= tokens.length) return null;
  const wins = Number.parseInt(tokens[wdlIndex + 1], 10);
  const draws = Number.parseInt(tokens[wdlIndex + 2], 10);
  const losses = Number.parseInt(tokens[wdlIndex + 3], 10);
  if (![wins, draws, losses].every(Number.isFinite)) return null;
  return { wins, draws, losses };
}

function parseInfoLine(line) {
  if (!line.startsWith("info ")) return null;
  const tokens = line.trim().split(/\s+/);
  const info = {
    depth: null,
    seldepth: null,
    multipv: 1,
    score: null,
    wdl: null,
    nodes: null,
    nps: null,
    hashfull: null,
    time: null,
    pv: [],
    string: null,
  };

  const pvIndex = tokens.indexOf("pv");
  const limit = pvIndex >= 0 ? pvIndex : tokens.length;
  for (let i = 1; i < limit; i += 1) {
    const token = tokens[i];
    const value = tokens[i + 1];
    if (token === "depth") info.depth = Number.parseInt(value, 10);
    if (token === "seldepth") info.seldepth = Number.parseInt(value, 10);
    if (token === "multipv") info.multipv = Number.parseInt(value, 10);
    if (token === "nodes") info.nodes = Number.parseInt(value, 10);
    if (token === "nps") info.nps = Number.parseInt(value, 10);
    if (token === "hashfull") info.hashfull = Number.parseInt(value, 10);
    if (token === "time") info.time = Number.parseInt(value, 10);
  }
  if (pvIndex >= 0) info.pv = tokens.slice(pvIndex + 1);
  info.score = parseScore(tokens);
  info.wdl = parseWdl(tokens);

  const stringIndex = tokens.indexOf("string");
  if (stringIndex >= 0) info.string = tokens.slice(stringIndex + 1).join(" ");
  return info;
}

export class PikafishEngine extends EventEmitter {
  constructor(enginePath, options = {}) {
    super();
    this.enginePath = enginePath;
    this.workingDirectory = options.workingDirectory ?? path.dirname(enginePath);
    this.process = null;
    this.readline = null;
    this.waiters = [];
    this.ready = false;
    this.searching = false;
    this.searchMode = "idle";
    this.currentPositionKey = "";
    this.currentOptions = {};
    this.currentSearchInfo = new Map();
    // 预判续算（ponder）的预算，ponderhit 后需要据此推算还要补多久。
    this.ponderBudgetMs = 0;
    this.ponderStartedAt = 0;
  }

  emitStatus(status, detail = "") {
    this.emit("status", { status, detail, timestamp: Date.now() });
  }

  emitLog(line) {
    this.emit("log", { line, timestamp: Date.now() });
  }

  currentCandidates() {
    return [...this.currentSearchInfo.values()]
      .map((info) => ({
        ...info,
        move: info.pv[0] ?? "",
      }))
      .filter((candidate) => /^[a-i][0-9][a-i][0-9]$/.test(candidate.move))
      .sort((left, right) => left.multipv - right.multipv);
  }

  async start() {
    if (this.process && !this.process.killed) return;
    if (!fs.existsSync(this.enginePath)) {
      throw new Error(`找不到象棋引擎：${this.enginePath}`);
    }

    this.emitStatus("starting", "正在载入棋力引擎");
    this.process = spawn(this.enginePath, [], {
      cwd: this.workingDirectory,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.readline = createInterface({ input: this.process.stdout });
    this.readline.on("line", (line) => this.handleLine(line));

    this.process.stderr.setEncoding("utf8");
    this.process.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) this.emitLog(text);
    });

    this.process.on("error", (error) => {
      this.ready = false;
      this.searching = false;
      this.searchMode = "idle";
      this.rejectAll(error);
      this.emitStatus("error", error.message);
    });

    this.process.on("exit", (code, signal) => {
      this.ready = false;
      this.searching = false;
      this.searchMode = "idle";
      this.currentPositionKey = "";
      const detail = signal ? `信号 ${signal}` : `退出码 ${code}`;
      this.rejectAll(new Error(`象棋引擎已退出：${detail}`));
      this.emitStatus("stopped", detail);
      this.process = null;
      this.readline = null;
    });
  }

  handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    this.emitLog(trimmed);

    if (trimmed.startsWith("info ")) {
      const info = parseInfoLine(trimmed);
      if (info) {
        if (this.searching && info.pv.length) {
          this.currentSearchInfo.set(info.multipv, info);
        }
        // 带上 searchMode，前端才能区分"当前局面的持续分析"和"预判续算"：
        // 两者的评分视角不同，混在一起会让面板显示错位。
        this.emit("info", { ...info, searchMode: this.searchMode });
      }
    }

    if (trimmed.startsWith("bestmove")) {
      const parts = trimmed.split(/\s+/);
      const ponderIndex = parts.indexOf("ponder");
      const bestmove = parts[1] ?? "";
      const ponder = ponderIndex >= 0 ? parts[ponderIndex + 1] : null;
      const searchMode = this.searchMode;
      this.searching = false;
      this.searchMode = "idle";
      this.emit("bestmove", {
        bestmove,
        ponder: ponder || null,
        searchMode,
        candidates: this.currentCandidates(),
      });
    }

    for (const waiter of [...this.waiters]) {
      if (!waiter.matcher(trimmed)) continue;
      clearTimeout(waiter.timer);
      this.waiters = this.waiters.filter((item) => item !== waiter);
      waiter.resolve(trimmed);
    }
  }

  waitFor(matcher, timeoutMs, label) {
    return new Promise((resolve, reject) => {
      const waiter = {
        matcher,
        resolve,
        reject,
        timer: null,
      };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((item) => item !== waiter);
        reject(new Error(`${label}超时。`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  /**
   * 取消一个还没兑现的等待器。
   *
   * 短时间搜索（1ms~50ms）里，bestmove 可能在几十毫秒内就回来。等待器必须
   * 在 go 之前注册好，否则极端情况下会错过这一行；一旦下游 send 抛错，这个
   * 提前注册的等待器又必须立刻收掉，不然会一直挂到超时。
   */
  cancelWaiter(waiter) {
    if (!waiter) return;
    clearTimeout(waiter.timer);
    this.waiters = this.waiters.filter((item) => item !== waiter);
  }

  rejectAll(error) {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiters = [];
  }

  send(command) {
    if (!this.process || !this.process.stdin.writable) {
      throw new Error("象棋引擎尚未启动。");
    }
    this.emit("command", {
      command,
      timestamp: Date.now(),
    });
    this.process.stdin.write(`${command}\n`);
  }

  positionCommand({ startFen, moves = [] }) {
    if (typeof startFen !== "string" || !startFen.trim()) {
      throw new Error("局面代码为空。");
    }
    const safeMoves = Array.isArray(moves)
      ? moves.filter((move) => /^[a-i][0-9][a-i][0-9]$/.test(move))
      : [];
    const fen = startFen.trim();
    const moveSuffix = safeMoves.length ? ` moves ${safeMoves.join(" ")}` : "";
    return {
      command: `position fen ${fen}${moveSuffix}`,
      key: `${fen}|${safeMoves.join(" ")}`,
    };
  }

  parseBestmove(line) {
    const parts = line.split(/\s+/);
    const ponderIndex = parts.indexOf("ponder");
    return {
      bestmove: parts[1] ?? "",
      ponder: ponderIndex >= 0 ? parts[ponderIndex + 1] : null,
    };
  }

  async initialize(rawOptions = {}) {
    await this.start();
    this.send("uci");
    await this.waitFor((line) => line === "uciok", 15000, "引擎握手");

    const options = this.normalizeOptions(rawOptions);
    await this.applyOptions(options);
    this.ready = true;
    this.emitStatus("ready", "棋力引擎已就绪");
    return { ok: true, options: this.currentOptions };
  }

  normalizeOptions(rawOptions = {}) {
    return {
      Threads: sanitizeInteger(rawOptions.threads, 14, 1, 64),
      Hash: sanitizeInteger(rawOptions.hash, 2048, 16, 65536),
      MultiPV: sanitizeInteger(rawOptions.multiPV, 1, 1, 16),
      MoveOverhead: sanitizeInteger(rawOptions.moveOverhead, 30, 0, 5000),
      UCI_ShowWDL: true,
      // 只有打开 Ponder，引擎才会在 bestmove 里带 "ponder xxx"，
      // 我们才能知道它预判对手会走哪一步。
      Ponder: rawOptions.ponder !== false,
    };
  }

  async applyOptions(options) {
    const settingList = [
      ["Threads", options.Threads],
      ["Hash", options.Hash],
      ["MultiPV", options.MultiPV],
      ["Move Overhead", options.MoveOverhead],
      ["UCI_ShowWDL", options.UCI_ShowWDL],
      ["Ponder", options.Ponder !== false],
      ["NumaPolicy", "auto"],
    ];

    for (const [name, value] of settingList) {
      const normalized = typeof value === "boolean" ? (value ? "true" : "false") : value;
      this.send(`setoption name ${name} value ${normalized}`);
    }
    this.currentOptions = { ...this.currentOptions, ...options };
    this.send("isready");
    await this.waitFor((line) => line === "readyok", 30000, "设置引擎");
  }

  async setOptions(options = {}) {
    if (!this.ready) return this.initialize(options);
    if (this.searching) await this.stop({ wait: true });
    const normalized = this.normalizeOptions({
      threads: options.threads ?? this.currentOptions.Threads,
      hash: options.hash ?? this.currentOptions.Hash,
      multiPV: options.multiPV ?? this.currentOptions.MultiPV,
      moveOverhead: options.moveOverhead ?? this.currentOptions.MoveOverhead,
      ponder: options.ponder ?? this.currentOptions.Ponder,
    });
    await this.applyOptions(normalized);
    return { ok: true, options: this.currentOptions };
  }

  async newGame() {
    if (!this.ready) return;
    if (this.searching) await this.stop({ wait: true });
    this.send("ucinewgame");
    this.send("isready");
    await this.waitFor((line) => line === "readyok", 30000, "重置引擎");
  }

  async go({
    startFen,
    moves = [],
    maxThinkMs = 3000,
    multiPV,
    depth,
  }) {
    if (!this.ready) throw new Error("棋力引擎尚未就绪。");
    if (this.searching && this.searchMode === "timed") {
      throw new Error("引擎正在计算走子。");
    }
    if (this.searching) await this.stop({ wait: true });
    const requestedMultiPV = sanitizeInteger(
      multiPV ?? this.currentOptions.MultiPV,
      1,
      1,
      16,
    );
    if (requestedMultiPV !== this.currentOptions.MultiPV) {
      await this.setOptions({ multiPV: requestedMultiPV });
    }

    // 1ms ~ 30 分钟：自由难度模式要能把设置原样交给引擎。
    const thinkTime = sanitizeInteger(maxThinkMs, 3000, 1, 1800000);
    const searchDepth = sanitizeInteger(depth, 0, 0, 128);
    const position = this.positionCommand({ startFen, moves });
    this.currentSearchInfo.clear();
    this.searching = true;
    this.searchMode = "timed";
    this.currentPositionKey = position.key;
    this.emitStatus("thinking", `最长思考 ${thinkTime} 毫秒`);
    const depthLimit = searchDepth > 0 ? ` depth ${searchDepth}` : "";

    // 等待器必须先于 go 注册：movetime 1 时引擎可能在本轮事件循环内就给出
    // bestmove，先发后等会让等待器错过那一行，表现为"短时间思考卡住"。
    const waiter = this.waitFor(
      (candidate) => candidate.startsWith("bestmove"),
      thinkTime + 30000,
      "引擎思考",
    );
    try {
      this.send(position.command);
      this.send(`go${depthLimit} movetime ${thinkTime}`);
    } catch (error) {
      this.cancelWaiter(waiter);
      this.searching = false;
      this.searchMode = "idle";
      throw error;
    }

    try {
      const line = await waiter;
      const { bestmove, ponder } = this.parseBestmove(line);
      return {
        bestmove,
        ponder: ponder || null,
        thinkTime,
        depth: searchDepth || null,
        candidates: this.currentCandidates(),
      };
    } finally {
      this.searching = false;
      if (this.searchMode === "timed") this.searchMode = "idle";
    }
  }

  async analyze({ startFen, moves = [] } = {}) {
    if (!this.ready) throw new Error("棋力引擎尚未就绪。");
    const position = this.positionCommand({ startFen, moves });
    if (this.searching) {
      if (this.searchMode === "timed") {
        return { ok: true, busy: true };
      }
      if (this.currentPositionKey === position.key) {
        this.emitStatus("analyzing", "正在持续分析当前局面");
        return { ok: true, already: true };
      }
      await this.stop({ wait: true });
    }

    this.currentSearchInfo.clear();
    this.send(position.command);
    this.searching = true;
    this.searchMode = "infinite";
    this.currentPositionKey = position.key;
    this.emitStatus("analyzing", "正在持续分析当前局面");
    this.send("go infinite");
    return { ok: true, analysis: true };
  }

  get pondering() {
    return Boolean(this.searching) && this.searchMode === "ponder";
  }

  /**
   * 预判续算（UCI ponder）。
   *
   * 与 go() 的差别：
   *  - 命令下发后立刻返回，不等待 bestmove；
   *  - 搜索模式标记成 "ponder"，bestmove 事件会带上它，方便上层区分；
   *  - 预判本身不设 movetime：movetime 会在预算用完后提前返回 bestmove，
   *    玩家若思考更久，之后 ponderhit 就继承不到搜索树；
   *  - 预算只记录在 ponderBudgetMs 里。ponderhit 后按"预算 - 已预判时间"
   *    决定何时发 stop，既保留搜索树，又不会超出用户设置的总思考时间。
   */
  async startPonder({ startFen, moves = [], budgetMs = 3000, multiPV } = {}) {
    if (!this.ready) throw new Error("棋力引擎尚未就绪。");
    const position = this.positionCommand({ startFen, moves });
    if (this.searching) {
      if (this.searchMode === "ponder" && this.currentPositionKey === position.key) {
        return { ok: true, already: true, pondering: true, budgetMs: this.ponderBudgetMs };
      }
      await this.stop({ wait: true });
    }

    const requestedMultiPV = sanitizeInteger(
      multiPV ?? this.currentOptions.MultiPV,
      1,
      1,
      16,
    );
    if (requestedMultiPV !== this.currentOptions.MultiPV) {
      await this.setOptions({ multiPV: requestedMultiPV });
    }

    // 与 go() 同口径：自由难度模式下 1ms 与 30 分钟都要原样下发。
    const budget = sanitizeInteger(budgetMs, 3000, 1, 1800000);
    this.currentSearchInfo.clear();
    this.send(position.command);
    this.searching = true;
    this.searchMode = "ponder";
    this.currentPositionKey = position.key;
    this.ponderBudgetMs = budget;
    this.ponderStartedAt = Date.now();
    this.emitStatus("analyzing", `预判续算中（预算 ${budget} 毫秒）`);
    this.send("go ponder infinite");
    return { ok: true, pondering: true, budgetMs: budget };
  }

  /**
   * 对手确实走了预判着法：告诉引擎继续用已经算出来的搜索树。
   * 因为预判阶段发的是 go ponder infinite，这里需要自己补上剩余时间的 stop，
   * 否则引擎会一直算到用户主动停止。
   */
  async ponderHit({ timeoutMs = 0 } = {}) {
    if (!this.ready) throw new Error("棋力引擎尚未就绪。");
    if (!this.pondering) {
      return { ok: false, pondering: false, bestmove: "", ponder: null };
    }
    const waitMs = Number(timeoutMs) > 0
      ? Number(timeoutMs)
      : Math.max(60000, this.ponderBudgetMs + 30000);
    const waiter = this.waitFor(
      (candidate) => candidate.startsWith("bestmove"),
      waitMs,
      "预判续算",
    );
    const elapsedMs = this.ponderStartedAt
      ? Date.now() - this.ponderStartedAt
      : 0;
    const remainingMs = Math.max(0, this.ponderBudgetMs - elapsedMs);
    this.send("ponderhit");
    // 允许用户设置的完整思考时间在"预判开始"时就起算。
    // 到了剩余时间后发 stop，Pikafish 会在保留当前搜索树的前提下返回 bestmove。
    const stopTimer = setTimeout(() => {
      try {
        this.send("stop");
      } catch {
        // 引擎可能已经返回 bestmove 或退出。
      }
    }, remainingMs);
    stopTimer.unref?.();
    try {
      const line = await waiter;
      const { bestmove, ponder } = this.parseBestmove(line);
      return {
        ok: true,
        pondering: false,
        bestmove,
        ponder: ponder || null,
        budgetMs: this.ponderBudgetMs,
        candidates: this.currentCandidates(),
      };
    } finally {
      clearTimeout(stopTimer);
      // bestmove 事件通常已经把状态复位了，这里兜底，防止引擎异常时卡住。
      if (this.searchMode === "ponder") {
        this.searching = false;
        this.searchMode = "idle";
      }
      this.ponderStartedAt = 0;
    }
  }

  /**
   * 预判落空：直接停掉预判搜索，之后按常规流程重新算。
   */
  async ponderStop({ wait = true } = {}) {
    if (!this.pondering) return { ok: true, wasSearching: false };
    return this.stop({ wait });
  }

  async stop({ wait = true } = {}) {
    if (!this.process || !this.searching) {
      return { ok: true, wasSearching: false };
    }
    const waiter = wait
      ? this.waitFor(
          (candidate) => candidate.startsWith("bestmove"),
          15000,
          "停止引擎搜索",
        )
      : null;
    this.send("stop");
    if (!waiter) return { ok: true, wasSearching: true };
    try {
      const line = await waiter;
      const { bestmove, ponder } = this.parseBestmove(line);
      return {
        ok: true,
        wasSearching: true,
        bestmove,
        ponder: ponder || null,
        candidates: this.currentCandidates(),
      };
    } catch (error) {
      return {
        ok: false,
        wasSearching: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async quit() {
    if (!this.process) return;
    try {
      this.send("quit");
    } catch {
      // The process may already be gone.
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1500);
      this.process?.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (this.process && !this.process.killed) this.process.kill();
  }
}
