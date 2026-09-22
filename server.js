import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import "./src/runtime-compat.js";
import { PikafishEngine } from "./src/engine.js";
import { EngineManager } from "./src/engine-manager.js";
import { generateDeepSeekCommentary } from "./src/commentary.js";
import { generateCoachAnalysis } from "./src/coach.js";
import { recognizePositionFromImage } from "./src/vision.js";
import {
  choosePersonaMove,
  getPersona,
} from "./src/persona.js";
import { applyPersonaOverrides } from "./src/difficulty.js";
import { ensureNnueModel } from "./src/nnue-model.js";
import {
  applyMove,
  opposite,
  parseFen,
  uciToMove,
} from "./src/xiangqi.js";
import {
  resolvePersonaThinkMs,
  supportsPonder,
} from "./src/think-time.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = path.join(ROOT, "public");
const ENGINE_PATH = path.join(
  ROOT,
  "engine",
  "Pikafish-Windows-x86-64-universal.exe",
);
const ENGINE_DIR = path.dirname(ENGINE_PATH);
ensureNnueModel(ENGINE_DIR);
// 默认监听所有网卡，让同一个局域网里的手机/平板也能打开页面同步听语音。
// 想只允许本机访问时，可设置环境变量 XIANGQI_HOST=127.0.0.1。
const HOST = process.env.XIANGQI_HOST || "0.0.0.0";
const LOCAL_HOST = "127.0.0.1";
const REQUEST_LIMIT = 1024 * 1024;
const VISION_REQUEST_LIMIT = 16 * 1024 * 1024;
const DEEPSEEK_ENDPOINT =
  process.env.DEEPSEEK_API_ENDPOINT || undefined;
const DEEPSEEK_VISION_ENDPOINT =
  process.env.DEEPSEEK_VISION_ENDPOINT || DEEPSEEK_ENDPOINT;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const rawEngine = new PikafishEngine(ENGINE_PATH, {
  workingDirectory: ENGINE_DIR,
});
const engine = new EngineManager(rawEngine);
const eventClients = new Set();
let engineInitialized = false;
let lastError = "";
let idleStopTimer = null;
let serverPort = 0;

function writeJson(response, status, body) {
  const data = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "Cache-Control": "no-store",
  });
  response.end(data);
}

function broadcast(type, payload = {}) {
  const message = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const response of eventClients) response.write(message);
}

engine.on("status", (payload) => {
  if (payload.status === "error") lastError = payload.detail;
  broadcast("status", payload);
});
engine.on("info", (payload) => broadcast("info", payload));
engine.on("bestmove", (payload) => broadcast("bestmove", payload));

/**
 * 所有页面都断开后：只停止搜索、把 CPU 还回去，**不退出引擎进程**。
 *
 * 这里原先调用 engine.quit()，有两个问题：
 *  1. SSE 会自动重连。刷新一下页面，1.5 秒内没有活跃连接就会被误判成"页面关了"，
 *     引擎被回收，其它标签页立刻失效，托盘图标还在但引擎已死。
 *  2. 与《使用说明》里「关闭浏览器页面不会退出棋力引擎」的承诺正相反。
 * 真正退出进程交给托盘菜单或显式的 /api/engine/quit。
 */
function scheduleIdleEngineStop() {
  clearTimeout(idleStopTimer);
  if (!engineInitialized || eventClients.size) return;
  idleStopTimer = setTimeout(async () => {
    idleStopTimer = null;
    if (eventClients.size || !engineInitialized) return;
    try {
      await engine.stop({ wait: false });
    } catch {
      // 引擎可能还没真正启动，忽略即可。
    }
    broadcast("status", {
      status: "idle",
      detail: "页面已断开，已暂停引擎搜索（进程保留）",
      timestamp: Date.now(),
    });
  }, 1500);
}

async function readJson(request, limit = REQUEST_LIMIT) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error("请求内容过大。");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function serveStatic(request, response, pathname) {
  const isSourceFile = pathname.startsWith("/src/");
  const baseRoot = isSourceFile ? ROOT : PUBLIC_ROOT;
  const requested = pathname === "/" ? "/index.html" : pathname;
  const relativePath = isSourceFile
    ? path.join("src", requested.slice("/src/".length))
    : requested.replace(/^\/+/, "");
  const filePath = path.resolve(baseRoot, relativePath);
  if (filePath !== baseRoot && !filePath.startsWith(`${baseRoot}${path.sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] ?? "application/octet-stream",
      "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=3600",
    });
    fs.createReadStream(filePath).pipe(response);
  });
}

/**
 * 列出本机所有可用的局域网 IPv4 地址，供其它设备打开页面一起听语音。
 */
function lanAddresses() {
  const addresses = [];
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      addresses.push(`http://${entry.address}:${serverPort || 0}/`);
    }
  }
  return addresses;
}

function systemInfo() {
  const cpus = os.cpus();
  return {
    cpuModel: cpus[0]?.model ?? "未知处理器",
    logicalProcessors: cpus.length,
    totalMemoryGB: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
    freeMemoryGB: Number((os.freemem() / 1024 ** 3).toFixed(1)),
    engineAvailable: fs.existsSync(ENGINE_PATH),
    engineInitialized,
    enginePath: ENGINE_PATH,
    platform: process.platform,
    architecture: process.arch,
    lastError,
    port: serverPort || 0,
    localUrl: serverPort ? `http://${LOCAL_HOST}:${serverPort}/` : "",
    lanAddresses: lanAddresses(),
  };
}

function recommendedHashMB(info = systemInfo()) {
  const freeMemoryGB = Number.isFinite(info.freeMemoryGB)
    ? info.freeMemoryGB
    : info.totalMemoryGB;
  const byFreeMemory =
    Math.floor((freeMemoryGB * 1024) / 4 / 128) * 128;
  return Math.max(512, Math.min(2048, byFreeMemory));
}

function positionState(startFen, moves = []) {
  const parsed = parseFen(startFen);
  let board = parsed.board;
  let turn = parsed.turn;
  for (const uci of Array.isArray(moves) ? moves : []) {
    if (!/^[a-i][0-9][a-i][0-9]$/.test(uci)) break;
    board = applyMove(board, uciToMove(uci));
    turn = opposite(turn);
  }
  return { board, side: turn };
}

function personaMoveNumber(startFen, moves, side) {
  const parsed = parseFen(startFen);
  let turn = parsed.turn;
  let count = 0;
  for (const uci of Array.isArray(moves) ? moves : []) {
    if (!/^[a-i][0-9][a-i][0-9]$/.test(uci)) break;
    if (turn === side) count += 1;
    turn = opposite(turn);
  }
  return count + 1;
}

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/events") {
    clearTimeout(idleStopTimer);
    idleStopTimer = null;
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write(": connected\n\n");
    eventClients.add(response);
    request.on("close", () => {
      eventClients.delete(response);
      scheduleIdleEngineStop();
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/system") {
    writeJson(response, 200, systemInfo());
    return;
  }

  // 跨设备语音同步：说话方把"要朗读的文本"广播给所有已连接的页面，
  // 其它设备用本机的中文语音朗读同一句话。发送方用 origin 标记，收到自己的
  // 广播时忽略，避免重复朗读。
  if (
    request.method === "POST" &&
    pathname === "/api/voice/broadcast"
  ) {
    const body = await readJson(request, 64 * 1024);
    broadcast("voice", {
      action: body.action === "stop" ? "stop" : "speak",
      text: typeof body.text === "string" ? body.text.slice(0, 2000) : "",
      rate: Number(body.rate) || 1.5,
      voiceUri: typeof body.voiceUri === "string" ? body.voiceUri : "",
      channel: typeof body.channel === "string" ? body.channel : "quip",
      origin: typeof body.origin === "string" ? body.origin : "",
      timestamp: Date.now(),
    });
    writeJson(response, 200, { ok: true, clients: eventClients.size });
    return;
  }

  if (request.method === "GET" && pathname === "/api/engine/commands") {
    writeJson(response, 200, {
      commands: engine.recentCommands(200),
      busy: engine.busy,
      currentLabel: engine.currentLabel,
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/review/fixture") {
    const fixturePath = path.join(
      ROOT,
      "tests",
      "fixtures",
      "review-game.json",
    );
    if (!fs.existsSync(fixturePath)) {
      writeJson(response, 404, { error: "内置复盘测试对局不存在。" });
      return;
    }
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    fs.createReadStream(fixturePath).pipe(response);
    return;
  }

  if (request.method === "POST" && pathname === "/api/engine/init") {
    const body = await readJson(request);
    const info = systemInfo();
    const defaults = {
      threads: info.logicalProcessors,
      hash: recommendedHashMB(info),
      multiPV: 1,
      moveOverhead: 30,
    };
    const requested = { ...defaults, ...body };
    let result;
    try {
      result = await engine.initialize(requested);
    } catch (error) {
      const requestedHash = Number.parseInt(requested.hash, 10);
      const message = error instanceof Error ? error.message : String(error);
      if (
        requestedHash <= 512 ||
        !/allocate|memory|内存|退出码/i.test(message)
      ) {
        throw error;
      }

      const fallbackHash = Math.max(512, Math.floor(requestedHash / 2));
      await new Promise((resolve) => setTimeout(resolve, 150));
      result = await engine.initialize({ ...requested, hash: fallbackHash });
      result.hashFallback = {
        from: requestedHash,
        to: fallbackHash,
        reason: message,
      };
    }
    engineInitialized = true;
    lastError = "";
    writeJson(response, 200, { ...result, system: systemInfo() });
    return;
  }

  if (request.method === "POST" && pathname === "/api/engine/options") {
    const body = await readJson(request);
    const result = await engine.setOptions(body);
    writeJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && pathname === "/api/engine/bestmove") {
    if (!engineInitialized) {
      writeJson(response, 409, { error: "棋力引擎尚未初始化。" });
      return;
    }
    const body = await readJson(request);
    const result = await engine.getBestMove({
      startFen: body.startFen,
      moves: Array.isArray(body.moves) ? body.moves : [],
      movetimeMs: body.movetimeMs,
      depth: body.depth,
    });
    writeJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && pathname === "/api/engine/new") {
    if (!engineInitialized) {
      writeJson(response, 409, { error: "棋力引擎尚未初始化。" });
      return;
    }
    await engine.newGame();
    writeJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && pathname === "/api/engine/go") {
    if (!engineInitialized) {
      writeJson(response, 409, { error: "棋力引擎尚未初始化。" });
      return;
    }
    const body = await readJson(request);
    const basePersona = getPersona(body.personaId || "grandmaster");
    // 自由难度模式：客户端把当前档位的自定义参数一并发上来，叠加到内置
    // 人格之上。applyPersonaOverrides 会打上 freeThinkTime 标记，后续
    // 思考时间不再被内置人格的 movetimeMs 截断。
    const persona =
      applyPersonaOverrides(basePersona, body.personaOverrides) ?? basePersona;
    const requestedThinkMs = Math.max(
      1,
      Math.min(1800000, Number(body.maxThinkMs) || 3000),
    );
    // 超级大师直接按用户设置思考，不再被旧版硬编码的 5 秒上限截断；
    // 其它人格维持原来的 min(用户设置, 人格建议时间)。
    const effectiveThinkMs = resolvePersonaThinkMs({
      persona,
      requestedThinkMs,
    });
    const requestedIntent = body.personaIntent || "persona";
    const personaTraits = Array.isArray(body.personaTraits)
      ? body.personaTraits
      : [];
    const personaController =
      body.personaController && typeof body.personaController === "object"
        ? body.personaController
        : null;
    const requiresCandidatePool =
      requestedIntent !== "persona" && requestedIntent !== "";
    const multiPV = requiresCandidatePool
      ? Math.max(persona.topK, 16)
      : persona.topK;
    const result = await engine.go({
      ...body,
      maxThinkMs: effectiveThinkMs,
      multiPV,
      depth: persona.depth,
    });
    const state = positionState(body.startFen, body.moves);
    const moveNumber = personaMoveNumber(
      body.startFen,
      body.moves,
      state.side,
    );
    const selection = choosePersonaMove({
      board: state.board,
      side: state.side,
      startFen: body.startFen,
      moves: body.moves,
      candidates: result.candidates,
      persona,
      personaTraits,
      controller: personaController,
      moveNumber,
      categoryHistory: body.categoryHistory,
      intent: requestedIntent,
    });
    if (selection?.move) result.bestmove = selection.move;
    result.persona = selection
      ? {
          id: selection.personaId,
          name: selection.personaName,
          traits: selection.personaTraits ?? [],
          moveNumber: selection.moveNumber,
          phase: selection.phase,
          category: selection.category,
          categoryName: selection.categoryName,
          originalCategory: selection.originalCategory,
          originalCategoryName: selection.originalCategoryName,
          loss: selection.loss,
          critical: selection.critical,
          probabilities: selection.probabilities,
          intent: selection.intent || "persona",
          intentName: selection.intentName || "跟随人格",
          intentApplied: selection.intentApplied !== false,
          intentFallbackReason: selection.intentFallbackReason || "",
          selectedBy: selection.selectedBy || "sampled",
          controller: selection.controller || null,
          controllerFallbackReason:
            selection.controllerFallbackReason || "",
          requestedThinkMs,
          effectiveThinkMs,
          multiPV,
        }
      : null;
    writeJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && pathname === "/api/engine/analyze") {
    if (!engineInitialized) {
      writeJson(response, 409, { error: "棋力引擎尚未初始化。" });
      return;
    }
    const body = await readJson(request);
    const result = await engine.analyze(body);
    writeJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && pathname === "/api/engine/stop") {
    const result = await engine.stop({ wait: true });
    writeJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && pathname === "/api/engine/ponder") {
    if (!engineInitialized) {
      writeJson(response, 409, { error: "棋力引擎尚未初始化。" });
      return;
    }
    const body = await readJson(request);
    const persona =
      applyPersonaOverrides(
        getPersona(body.personaId || "grandmaster"),
        body.personaOverrides,
      ) ?? getPersona(body.personaId || "grandmaster");
    // 预判续算只服务于超级大师：它按用户设置的完整时间思考，
    // 续算省下来的每一毫秒都是实打实的多核性能。
    if (!supportsPonder(persona)) {
      writeJson(response, 200, { ok: false, skipped: "persona" });
      return;
    }
    const requestedThinkMs = Math.max(
      1,
      Math.min(1800000, Number(body.maxThinkMs) || 3000),
    );
    const budgetMs = resolvePersonaThinkMs({ persona, requestedThinkMs });
    const result = await engine.startPonder({
      startFen: body.startFen,
      moves: Array.isArray(body.moves) ? body.moves : [],
      budgetMs,
      multiPV: 1,
    });
    writeJson(response, 200, { ...result, budgetMs });
    return;
  }

  if (request.method === "POST" && pathname === "/api/engine/ponderhit") {
    if (!engineInitialized) {
      writeJson(response, 409, { error: "棋力引擎尚未初始化。" });
      return;
    }
    const result = await engine.ponderHit({});
    writeJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && pathname === "/api/engine/ponderstop") {
    const result = await engine.ponderStop({ wait: true });
    writeJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && pathname === "/api/engine/quit") {
    engineInitialized = false;
    clearTimeout(idleStopTimer);
    idleStopTimer = null;
    await engine.quit();
    writeJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && pathname === "/api/commentary") {
    const body = await readJson(request);
    try {
      const result = await generateDeepSeekCommentary(body, {
        endpoint: DEEPSEEK_ENDPOINT,
      });
      writeJson(response, 200, result);
    } catch (error) {
      writeJson(response, error?.statusCode ?? 502, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/commentary/vision") {
    const body = await readJson(request, VISION_REQUEST_LIMIT);
    try {
      const result = await recognizePositionFromImage(body, {
        endpoint: DEEPSEEK_VISION_ENDPOINT,
      });
      writeJson(response, 200, result);
    } catch (error) {
      writeJson(response, error?.statusCode ?? 502, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/coach/analysis") {
    const body = await readJson(request);
    try {
      const result = await generateCoachAnalysis(body, {
        endpoint: DEEPSEEK_ENDPOINT,
      });
      writeJson(response, 200, result);
    } catch (error) {
      writeJson(response, error?.statusCode ?? 502, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/shutdown") {
    writeJson(response, 200, { ok: true });
    setTimeout(async () => {
      await engine.quit();
      process.exit(0);
    }, 50);
    return;
  }

  writeJson(response, 404, { error: "未知接口。" });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host ?? HOST}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url.pathname);
      return;
    }
    serveStatic(request, response, decodeURIComponent(url.pathname));
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    broadcast("status", { status: "error", detail: lastError, timestamp: Date.now() });
    writeJson(response, error?.statusCode ?? 500, { error: lastError });
  }
});
// 预判命中后的 /api/engine/ponderhit 最长会等到用户设置的最大思考时间。
// Node 默认会按请求计时，长时间思考可能被截断；本地单机服务禁用该限制即可。
server.requestTimeout = 0;

function launchBrowser(url) {
  if (process.env.XIANGQI_NO_BROWSER === "1") return;
  try {
    spawn("cmd.exe", ["/d", "/s", "/c", "start", "", url], {
      windowsHide: true,
      detached: true,
      stdio: "ignore",
    }).unref();
  } catch {
    // The URL is also printed in the console.
  }
}

server.listen(Number(process.env.XIANGQI_PORT) || 0, HOST, () => {
  const address = server.address();
  serverPort = Number(address.port) || 0;
  const url = `http://${LOCAL_HOST}:${serverPort}/`;
  console.log(`中国象棋已启动：${url}`);
  for (const lan of lanAddresses()) {
    console.log(`局域网地址（其它设备可用）：${lan}`);
  }
  launchBrowser(url);
});

async function shutdown() {
  clearTimeout(idleStopTimer);
  for (const client of eventClients) client.end();
  await engine.quit();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
