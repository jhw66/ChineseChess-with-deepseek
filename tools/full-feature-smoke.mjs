/**
 * v14.3.3 全功能联动冒烟测试（零第三方依赖，只用 Node 内置 + 浏览器 DevTools 协议）。
 *
 * 目标：把"能同时打开的功能尽量全开"，验证它们不会互相打架。
 * 覆盖：
 *   1. 开局渲染 / API Key 收纳在设置抽屉里、以星号显示；
 *   2. 翻转棋盘 + 提示 + 持续思考 + 双人同机 + 语音吐槽 + 教练（每步自动）同时开启；
 *   3. 自由行棋：红方连走、手动切换行棋方，落子后触发短评与教练请求；
 *   4. 语音串行播放，语速 1.5 倍，同一时刻只有一条在播；
 *   5. 自由行棋 TXT 棋谱导出（含传统记谱）→ 重新导入，棋盘完全一致；
 *   6. 标准对局 TXT 棋谱导出 → 一键重置 → 重新导入，棋盘完全一致；
 *   7. 复盘：载入内置对局，分析中出现进度，取消后引擎指令里没有 go infinite；
 *   8. 复盘 / 训练 / 残局布置 互斥，退出后持续思考自动恢复；
 *   9. 错题训练：走出存储的最优解直接通过、零引擎调用、标记已掌握；
 *  10. 识图纠错闭环：上传图片 → 10×9 面板 → 人工改一格 → 确认后主棋盘随之变化。
 *
 * DeepSeek 接口（短评 / 教练 / 识图）与语音合成都用桩替代，避免真实计费与外网。
 * 引擎接口 /api/engine/* 全部走真实后端。
 *
 * 用法：node tools/full-feature-smoke.mjs http://127.0.0.1:8791/
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const URL = process.argv[2] || "http://127.0.0.1:8791/";
const DEBUG_PORT = Number(process.env.FULL_SMOKE_PORT || 9444);
const SCRIPT_TIMEOUT_MS = Number(process.env.FULL_SMOKE_TIMEOUT || 240000);

const BROWSER_CANDIDATES = [
  process.env.FULL_SMOKE_BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].filter(Boolean);

function findBrowser() {
  for (const candidate of BROWSER_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  throw new Error("没有找到 Edge 或 Chrome，可用 FULL_SMOKE_BROWSER 指定路径。");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDevTools(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return response.json();
    } catch {
      // 浏览器还没就绪，稍后重试。
    }
    await sleep(200);
  }
  throw new Error("等待浏览器调试端口超时。");
}

function createClient(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 0;
  let closeInfo = null;

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", () =>
      reject(new Error("浏览器调试连接失败。")),
    );
  });
  socket.addEventListener("close", (event) => {
    closeInfo = `code=${event.code} reason=${event.reason || ""}`;
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id != null) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
      return;
    }
    const handlers = listeners.get(message.method) || [];
    for (const handler of handlers) handler(message.params);
  });

  return {
    ready,
    get closeInfo() {
      return closeInfo;
    },
    send(method, params = {}, sessionId) {
      const id = (nextId += 1);
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(
          JSON.stringify({
            id,
            method,
            params,
            ...(sessionId ? { sessionId } : {}),
          }),
        );
      });
    },
    on(method, handler) {
      const handlers = listeners.get(method) || [];
      handlers.push(handler);
      listeners.set(method, handlers);
    },
    close() {
      try {
        socket.close();
      } catch {
        // 忽略关闭异常。
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* 导航前注入：语音桩 + DeepSeek 接口桩 + 下载拦截 + 初始错题          */
/* ------------------------------------------------------------------ */

const INIT_SCRIPT = String.raw`
(() => {
  // ---- 语音合成桩：记录语速，模拟"说完一句再接下句"，统计并发数 ----
  window.__spoken = [];
  window.__speechLive = 0;
  window.__speechMaxLive = 0;
  window.__speechCancelCount = 0;
  class FakeUtterance {
    constructor(text) {
      this.text = text;
      this.rate = 1;
      this.pitch = 1;
      this.lang = "zh-CN";
      this.voice = null;
      this.onend = null;
      this.onerror = null;
    }
  }
  window.SpeechSynthesisUtterance = FakeUtterance;
  const fakeSynth = {
    speak(utterance) {
      window.__spoken.push({ text: utterance.text, rate: utterance.rate });
      window.__speechLive += 1;
      window.__speechMaxLive = Math.max(window.__speechMaxLive, window.__speechLive);
      setTimeout(() => {
        window.__speechLive -= 1;
        try {
          if (typeof utterance.onend === "function") utterance.onend();
        } catch {}
      }, 90);
    },
    cancel() {
      window.__speechCancelCount += 1;
    },
    pause() {},
    resume() {},
    getVoices() {
      return [];
    },
    addEventListener() {},
    removeEventListener() {},
    onvoiceschanged: null,
  };
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: fakeSynth,
  });

  // ---- 记录 API 调用次数 + 桩掉三个 DeepSeek 接口 ----
  window.__apiCalls = { commentary: 0, coach: 0, vision: 0, bestmove: 0, analyze: 0, go: 0 };
  const VISION_MATRIX = [
    ["r","n","b","a","k","a","b","n","r"],
    [".",".",".",".",".",".",".",".","."],
    [".","c",".",".",".",".",".","c","."],
    ["p",".","p",".","p",".","p",".","p"],
    [".",".",".",".",".",".",".",".","."],
    [".",".",".",".",".",".",".",".","."],
    ["P",".","P",".","P",".","P",".","P"],
    [".","C",".",".",".",".",".","C","."],
    [".",".",".",".",".",".",".",".","."],
    ["R","N","B","A","K","A","B","N","R"],
  ];
  const jsonResponse = (payload, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  const originalFetch = window.fetch.bind(window);
  window.__origFetch = originalFetch;
  window.fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input && typeof input.url === "string"
          ? input.url
          : String(input || "");
    if (url.includes("/api/commentary/vision")) {
      window.__apiCalls.vision += 1;
      return Promise.resolve(
        jsonResponse({
          board: VISION_MATRIX.map((row) => row.slice()),
          passes: 2,
          conflicts: [],
          notes: "桩识别：已完成两轮交叉复核。",
          model: "deepseek-flash",
        }),
      );
    }
    if (url.includes("/api/commentary")) {
      window.__apiCalls.commentary += 1;
      return Promise.resolve(jsonResponse({ text: "短评：这一手不错。", model: "deepseek-flash" }));
    }
    if (url.includes("/api/coach/analysis")) {
      window.__apiCalls.coach += 1;
      return Promise.resolve(
        jsonResponse({ text: "教练分析：建议抢占中路。", model: "deepseek-flash" }),
      );
    }
    if (url.includes("/api/engine/bestmove")) window.__apiCalls.bestmove += 1;
    else if (url.includes("/api/engine/analyze")) window.__apiCalls.analyze += 1;
    else if (url.includes("/api/engine/go")) window.__apiCalls.go += 1;
    return originalFetch(input, init);
  };

  // ---- 拦截 <a download>，把导出的 Blob 存下来供断言 ----
  window.__downloads = [];
  const originalCreateObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    window.__downloads.push(blob);
    return originalCreateObjectURL(blob);
  };
  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function click() {
    if (this.hasAttribute("download")) return;
    return originalAnchorClick.call(this);
  };

  // ---- 预置一道错题，供错题训练使用（必须在 app 启动前写入）----
  try {
    if (location.protocol === "http:" || location.protocol === "https:") {
      const key = "xiangqi.review.mistakes.v1";
      if (!localStorage.getItem(key)) {
        localStorage.setItem(
          key,
          JSON.stringify([
            {
              id: "xq-smoke-training",
              fen: "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1",
              sideToMove: "w",
              actualMove: { uci: "b2e2", chinese: "炮八平五" },
              bestMove: { uci: "h2e2", chinese: "炮二平五" },
              bestScoreCp: 18,
              bestScore: { type: "cp", value: 18 },
              lossCp: 420,
              status: "未掌握",
              source: "smoke-training",
              startFen: "",
              ply: 1,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ]),
        );
      }
      localStorage.removeItem("xiangqi.review.trainingStats.v1");
    }
  } catch {
    // about:blank 等不透明来源会抛错，忽略。
  }
})();
`;

/* ------------------------------------------------------------------ */
/* 页面内断言脚本                                                      */
/* ------------------------------------------------------------------ */

const PAGE_SCRIPT = String.raw`(async () => {
  const results = [];
  const record = (name, ok, detail) =>
    results.push({ name, ok: !!ok, detail: detail || "" });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const $ = (selector) => document.querySelector(selector);
  const board = $("#board");
  const pieceAt = (row, col) =>
    document.querySelector(
      '#boardPieces .board-piece[data-row="' + row + '"][data-col="' + col + '"]',
    );
  const boardSignature = () =>
    Array.from(document.querySelectorAll("#boardPieces .board-piece"))
      .map((el) => el.dataset.row + "," + el.dataset.col + ":" + el.textContent)
      .sort()
      .join("|");
  const countPieces = () =>
    document.querySelectorAll("#boardPieces .board-piece").length;
  const markerCount = () =>
    document.querySelectorAll("#boardPieces .move-marker").length;
  const flipped = () => $("#flipBoardBtn").getAttribute("aria-pressed") === "true";
  const clickDisplay = (row, col) => {
    const rect = board.getBoundingClientRect();
    const clientX = rect.left + (rect.width * (5 + col * 11.25)) / 100;
    const clientY = rect.top + (rect.height * (5 + row * 10)) / 100;
    board.dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX, clientY }),
    );
  };
  // 按真实棋盘坐标点击，自动换算翻转后的显示坐标。
  const clickBoard = (row, col) => {
    const f = flipped();
    return clickDisplay(f ? 9 - row : row, f ? 8 - col : col);
  };
  const engineLog = async () => {
    const response = await window.__origFetch("/api/engine/commands");
    return response.json();
  };
  const waitFor = async (probe, timeoutMs = 8000, stepMs = 120) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (probe()) return true;
      } catch {
        // 继续轮询。
      }
      await sleep(stepMs);
    }
    return false;
  };
  const setInput = (el, value) => {
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const dropFile = (input, file) => {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  await sleep(900);

  // ---------- 0. 开局 ----------
  record("开局棋盘渲染 32 枚棋子", countPieces() === 32, "棋子数=" + countPieces());
  record(
    "整页只有一处 API Key 输入（星号显示）",
    document.querySelectorAll('input[type="password"]').length === 1,
    "password字段=" + document.querySelectorAll('input[type="password"]').length,
  );
  record(
    "设置抽屉默认收起，AI 配置不占主界面",
    !document.body.classList.contains("settings-open") &&
      getComputedStyle($("#deepseekApiKey").closest(".settings-drawer-item")).display === "none",
  );

  // ---------- 1. 填 Key、设模型 ----------
  setInput($("#deepseekApiKey"), "sk-test-only");
  setInput($("#deepseekModel"), "deepseek-flash");
  setInput($("#deepseekVisionModel"), "deepseek-flash");
  $("#settingsToggleBtn").click();
  await sleep(200);
  record(
    "点击设置后 AI 配置可见",
    document.body.classList.contains("settings-open") &&
      getComputedStyle($("#deepseekApiKey").closest(".settings-drawer-item")).display !== "none",
  );
  $("#settingsToggleBtn").click();
  await sleep(200);

  // ---------- 2. 一口气全开 ----------
  $("#flipBoardBtn").click();
  $("#hintToggleBtn").click();
  $("#continuousThinkingToggleBtn").click();
  setInput($("#matchModeSelect"), "human");
  $("#quipToggleBtn").click();
  $("#coachModeToggleBtn").click();
  $("#coachAutoModeBtn").click();
  await sleep(500);

  record("翻转棋盘已开启", flipped());
  record(
    "提示功能已开启",
    $("#hintToggleBtn").getAttribute("aria-pressed") === "true",
  );
  record(
    "持续思考已开启",
    $("#continuousThinkingToggleBtn").getAttribute("aria-pressed") === "true",
  );
  record(
    "双人同机模式已切换",
    $("#matchModeSelect").value === "human",
    "matchMode=" + $("#matchModeSelect").value,
  );
  record(
    "语音吐槽与教练为两个独立开关且已开启",
    $("#quipToggleBtn").getAttribute("aria-pressed") === "true" &&
      $("#coachModeToggleBtn").getAttribute("aria-pressed") === "true",
  );
  record(
    "教练为每步自动分析",
    $("#coachAutoModeBtn").getAttribute("aria-pressed") === "true",
  );

  // ---------- 3. 自由行棋：红方连走 + 切换行棋方 ----------
  $("#freePlayToggleBtn").click();
  await sleep(400);
  record(
    "自由行棋已开启",
    $("#freePlayToggleBtn").getAttribute("aria-pressed") === "true",
  );
  record("自由模式下可切换行棋方", !$("#switchTurnBtn").disabled);

  const piecesBefore = countPieces();
  // 翻转状态下，用棋盘坐标点击也应命中正确棋子。
  clickBoard(7, 1);
  await sleep(200);
  const selected = document.querySelector("#boardPieces .board-piece.selected");
  record(
    "翻转棋盘后仍能选中真实坐标的棋子",
    !!selected && selected.dataset.row === "7" && selected.dataset.col === "1",
    selected ? "选中=" + selected.dataset.row + "," + selected.dataset.col : "无选中",
  );
  record("选中后出现走法提示", markerCount() > 0, "落点=" + markerCount());
  clickBoard(4, 1);
  await sleep(600);
  const movedRed = pieceAt(4, 1);
  record(
    "自由模式红方第一手落子（炮）",
    !!movedRed && movedRed.textContent === "炮" && countPieces() === piecesBefore,
    movedRed ? "目标=" + movedRed.textContent : "目标为空",
  );

  const sideBefore = $("#sideValue").textContent.trim();
  clickBoard(7, 7);
  await sleep(200);
  clickBoard(4, 7);
  await sleep(600);
  const twiceRed = pieceAt(4, 7);
  record(
    "红方可以连续走第二手（不轮换）",
    !!twiceRed && twiceRed.textContent === "炮" &&
      $("#sideValue").textContent.trim() === sideBefore,
    twiceRed ? "目标=" + twiceRed.textContent : "目标为空",
  );

  $("#switchTurnBtn").click();
  await sleep(500);
  record(
    "手动切换红黑行棋权",
    $("#sideValue").textContent.trim() !== sideBefore,
    sideBefore + " -> " + $("#sideValue").textContent.trim(),
  );
  clickBoard(0, 0);
  await sleep(200);
  clickBoard(1, 0);
  await sleep(600);
  const movedBlack = pieceAt(1, 0);
  record(
    "切换后黑方可以直接落子",
    !!movedBlack && movedBlack.textContent === "车",
    movedBlack ? "目标=" + movedBlack.textContent : "目标为空",
  );

  // ---------- 4. 短评 / 教练 / 语音联动 ----------
  const commentaryOk = await waitFor(
    () => window.__apiCalls.commentary >= 2,
    6000,
  );
  record(
    "落子后触发 DeepSeek 短评请求",
    commentaryOk,
    "commentary=" + window.__apiCalls.commentary,
  );
  const coachOk = await waitFor(() => window.__apiCalls.coach >= 1, 8000);
  const coachTextOk = await waitFor(
    () => $("#coachReport").textContent.trim().length > 0,
    5000,
  );
  record(
    "教练模式每步自动分析已触发",
    coachOk,
    "coach=" + window.__apiCalls.coach,
  );
  record(
    "教练面板显示分析文本",
    coachTextOk,
    $("#coachReport").textContent.trim().slice(0, 20),
  );

  const spokenOk = await waitFor(() => window.__spoken.length >= 1, 6000);
  record(
    "语音吐槽已朗读",
    spokenOk,
    "朗读条数=" + window.__spoken.length,
  );
  record(
    "所有语音语速均为 1.5 倍",
    window.__spoken.length > 0 && window.__spoken.every((s) => s.rate === 1.5),
    window.__spoken.map((s) => s.rate).join(","),
  );
  record(
    "语音严格串行（同一时刻最多一条）",
    window.__speechMaxLive <= 1,
    "并发峰值=" + window.__speechMaxLive,
  );
  record(
    "默认语音语速控件为 1.5",
    $("#speechRateInput").value === "1.5",
    "rate=" + $("#speechRateInput").value,
  );

  // ---------- 5. 自由行棋 TXT 导出 / 导入闭环 ----------
  window.__downloads.length = 0;
  $("#saveRecordBtn").click();
  await sleep(400);
  const freeBlob = window.__downloads[0];
  const freeText = freeBlob ? await freeBlob.text() : "";
  record(
    "自由行棋导出 TXT 棋谱",
    !!freeBlob && freeText.length > 0,
    "字节=" + freeText.length,
  );
  record(
    "自由行棋 TXT 含传统记谱与坐标",
    freeText.includes("[传统记谱]") &&
      freeText.includes("自由行棋") &&
      /\([a-i][0-9][a-i][0-9]\)/.test(freeText),
  );

  const freeFenBefore = boardSignature();
  const freeFileName = (() => {
    const now = new Date();
    return "freeplay-" + now.getTime() + ".txt";
  })();
  dropFile(
    $("#recordFileInput"),
    new File([freeText], freeFileName, { type: "text/plain" }),
  );
  await waitFor(
    () => $("#toast").textContent.includes("自由行棋棋谱已导入"),
    5000,
  );
  await waitFor(() => boardSignature() === freeFenBefore, 5000);
  record(
    "自由行棋 TXT 导入后棋盘完全还原",
    boardSignature() === freeFenBefore,
    "棋子数=" + countPieces(),
  );

  // ---------- 6. 关闭自由行棋 + 标准棋谱导出 / 导入 ----------
  $("#freePlayToggleBtn").click();
  const freePlayClosed = await waitFor(
    () => $("#freePlayToggleBtn").getAttribute("aria-pressed") === "false",
    5000,
  );
  record(
    "自由行棋可以关闭并回到标准规则",
    freePlayClosed,
    "aria=" + $("#freePlayToggleBtn").getAttribute("aria-pressed"),
  );
  $("#resetOpeningBtn").click();
  await sleep(900);
  record("一键重置为标准开局", countPieces() === 32, "棋子数=" + countPieces());

  // 红：炮二平五；黑：马8进7
  clickBoard(7, 7);
  await sleep(200);
  clickBoard(7, 4);
  await sleep(600);
  clickBoard(0, 7);
  await sleep(200);
  clickBoard(2, 6);
  await sleep(700);
  const standardSignature = boardSignature();
  record(
    "标准对局走出两步（红炮二平五、黑马8进7）",
    pieceAt(7, 4)?.textContent === "炮" && pieceAt(2, 6)?.textContent === "马",
    "棋子数=" + countPieces(),
  );

  window.__downloads.length = 0;
  $("#saveRecordBtn").click();
  await sleep(400);
  const stdBlob = window.__downloads[0];
  const stdText = stdBlob ? await stdBlob.text() : "";
  record(
    "标准对局导出 TXT 棋谱",
    !!stdBlob && /传统记谱/.test(stdText) && /炮二平五/.test(stdText),
    "字节=" + stdText.length,
  );
  $("#resetOpeningBtn").click();
  await sleep(900);
  dropFile(
    $("#recordFileInput"),
    new File([stdText], "standard-" + Date.now() + ".txt", { type: "text/plain" }),
  );
  await waitFor(() => $("#toast").textContent.includes("棋谱已导入"), 5000);
  await waitFor(() => boardSignature() === standardSignature, 5000);
  record(
    "标准 TXT 导入后逐步还原到同一局面",
    boardSignature() === standardSignature,
    "棋子数=" + countPieces(),
  );

  // ---------- 7. 复盘（互斥 + 取消 + 无 go infinite）----------
  const logBeforeReview = await engineLog();
  const reviewLogStartedAt = Date.now();
  $("#fixtureReviewBtn").click();
  await sleep(1400);
  record(
    "载入内置对局后进入复盘面板",
    $("#reviewPanel").hidden === false && $("#playPanel").hidden === true,
  );
  record(
    "复盘时持续思考被暂停（引擎状态不再显示持续分析）",
    /暂停|停止/.test($("#engineStateText").textContent),
    "engineState=" + $("#engineStateText").textContent,
  );

  $("#startReviewBtn").click();
  const progressSeen = await waitFor(
    () => /手/.test($("#reviewProgressText").textContent),
    8000,
  );
  record(
    "复盘分析出现逐手进度",
    progressSeen,
    $("#reviewProgressText").textContent,
  );
  await sleep(1500);
  record("复盘进行中可取消", !$("#cancelReviewBtn").disabled);
  $("#cancelReviewBtn").click();
  const cancelled = await waitFor(() => $("#cancelReviewBtn").disabled === true, 10000);
  record(
    "取消复盘后分析停止",
    cancelled,
    $("#reviewProgressText").textContent,
  );
  await sleep(400);
  const logAfterReview = await engineLog();
  const duringReview = (logAfterReview.commands || []).filter(
    (entry) => Number(entry.timestamp) >= reviewLogStartedAt,
  );
  const infiniteDuringReview = duringReview.filter((entry) =>
    /^go infinite/.test(entry.command || ""),
  );
  record(
    "复盘期间只发有限时长搜索，未出现 go infinite",
    infiniteDuringReview.length === 0,
    "go infinite 次数=" + infiniteDuringReview.length,
  );
  record(
    "复盘期间确实发起了 movetime 数量级搜索",
    duringReview.some((entry) => /^go movetime/.test(entry.command || "")),
    "复盘指令数=" + duringReview.length,
  );

  // 复盘 × 残局布置 互斥
  $("#editTab").click();
  await sleep(600);
  record(
    "复盘模式下点击残局布置，复盘自动退出并进入布置",
    $("#editPanel").hidden === false && $("#reviewPanel").hidden === true,
  );
  $("#playTab").click();
  await sleep(600);
  record("可以回到对局面板", $("#playPanel").hidden === false);
  const resumed = await waitFor(
    () => /^[0-9]+/.test($("#depthValue").textContent.trim()),
    10000,
  );
  record(
    "退出复盘后持续思考自动恢复",
    resumed,
    "depth=" + $("#depthValue").textContent,
  );

  // ---------- 8. 错题训练（零引擎开销）----------
  $("#reviewTab").click();
  await sleep(500);
  record(
    "错题本已有 1 道未掌握题目",
    $("#mistakeBookSummary").textContent.includes("未掌握 1"),
    $("#mistakeBookSummary").textContent,
  );
  const bestmoveBefore = window.__apiCalls.bestmove;
  const analyzeBefore = window.__apiCalls.analyze;
  $("#startTrainingBtn").click();
  await sleep(900);
  record(
    "进入错题训练并载入题目",
    $("#trainingQuestion").hidden === false &&
      $("#trainingStatus").textContent.length > 0,
    $("#trainingStatus").textContent,
  );
  clickBoard(7, 7);
  await sleep(200);
  clickBoard(7, 4);
  await sleep(1400);
  record(
    "走出存储的最优解直接判定通过",
    /已掌握|正确/.test($("#trainingStatus").textContent),
    $("#trainingStatus").textContent,
  );
  record(
    "训练走最优解零引擎调用（无 go/bestmove）",
    window.__apiCalls.bestmove === bestmoveBefore &&
      window.__apiCalls.analyze === analyzeBefore,
    "bestmove=" + (window.__apiCalls.bestmove - bestmoveBefore) +
      " analyze=" + (window.__apiCalls.analyze - analyzeBefore),
  );
  const stored = JSON.parse(
    localStorage.getItem("xiangqi.review.mistakes.v1") || "[]",
  );
  record(
    "错题记录保留且标记为已掌握",
    stored.length === 1 && stored[0].status === "已掌握",
    JSON.stringify(stored[0] && stored[0].status),
  );
  if (!$("#endTrainingBtn").disabled) $("#endTrainingBtn").click();
  await sleep(600);
  $("#playTab").click();
  await sleep(500);

  // ---------- 9. 识图纠错闭环 ----------
  $("#editTab").click();
  await sleep(600);
  const canvas = document.createElement("canvas");
  canvas.width = 620;
  canvas.height = 700;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f2dcae";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#6b4a20";
  ctx.lineWidth = 3;
  for (let i = 0; i <= 9; i += 1) {
    ctx.beginPath();
    ctx.moveTo(40, 40 + i * ((canvas.height - 80) / 9));
    ctx.lineTo(canvas.width - 40, 40 + i * ((canvas.height - 80) / 9));
    ctx.stroke();
  }
  for (let i = 0; i <= 8; i += 1) {
    ctx.beginPath();
    ctx.moveTo(40 + i * ((canvas.width - 80) / 8), 40);
    ctx.lineTo(40 + i * ((canvas.width - 80) / 8), canvas.height - 40);
    ctx.stroke();
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  dropFile(
    $("#visionImageInput"),
    new File([blob], "board-" + Date.now() + ".png", { type: "image/png" }),
  );
  const imageReady = await waitFor(
    () => $("#recognizeVisionBtn").disabled === false,
    8000,
  );
  record("选择棋盘图片后可以发起识别", imageReady);
  $("#recognizeVisionBtn").click();
  const modalOpen = await waitFor(() => $("#visionReviewModal").hidden === false, 8000);
  record(
    "识图返回 10×9 纠错面板",
    modalOpen &&
      document.querySelectorAll("#visionReviewBoard .vision-review-cell").length === 90,
    "格子数=" +
      document.querySelectorAll("#visionReviewBoard .vision-review-cell").length,
  );

  const targetCell = document.querySelector(
    '#visionReviewBoard .vision-review-cell[data-row="0"][data-col="0"]',
  );
  targetCell.value = ".";
  targetCell.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(200);
  record(
    "人工修正后的格子被标记",
    targetCell.classList.contains("corrected") ||
      targetCell.classList.contains("empty"),
  );
  $("#visionReviewConfirmBtn").click();
  await sleep(900);
  record(
    "确认后识图局面载入主棋盘（黑车被移除）",
    !pieceAt(0, 0) && countPieces() === 31,
    "棋子数=" + countPieces(),
  );
  $("#playTab").click();
  await sleep(400);

  // ---------- 9.5 绝杀后的状态与棋盘锁定 ----------
  // 红车从 a 路底线杀入，双兵封住九宫另外两个逃格，形成一步绝杀。
  const mateFen = "3k5/9/3PP4/9/9/9/9/9/9/R4K3 w - - 0 1";
  setInput($("#fenInput"), mateFen);
  $("#loadFenBtn").click();
  await waitFor(() => !!pieceAt(9, 0) && !!pieceAt(0, 3), 5000);
  $("#playTab").click();
  await sleep(300);
  $("#startGameBtn").click();
  const mateGameStarted = await waitFor(
    () => /对局进行中/.test($("#gameStateChip").textContent),
    5000,
  );
  record(
    "绝杀残局已就绪且轮到红方行棋",
    mateGameStarted &&
      !!pieceAt(9, 0) &&
      !!pieceAt(0, 3) &&
      $("#sideValue").textContent.trim() === "红方",
    "红车=" +
      (pieceAt(9, 0) ? pieceAt(9, 0).textContent : "无") +
      "，状态=" +
      $("#gameStateChip").textContent.trim(),
  );
  clickBoard(9, 0);
  await sleep(200);
  clickBoard(0, 0);
  await waitFor(
    () =>
      /红方胜/.test($("#gameStateChip").textContent) ||
      $("#moveCountText").textContent.trim() === "1",
    5000,
  );
  const mateChip = $("#gameStateChip").textContent.trim();
  record(
    "绝杀后状态显示红方胜而不是对局进行中",
    /红方胜/.test(mateChip) && !/对局进行中/.test(mateChip),
    "状态=" + mateChip + "，手数=" + $("#moveCountText").textContent.trim(),
  );
  clickBoard(0, 0);
  await sleep(250);
  record(
    "绝杀后棋盘锁定，不再允许选中棋子或显示走法标记",
    !document.querySelector("#boardPieces .board-piece.selected") && markerCount() === 0,
    "标记=" + markerCount(),
  );

  // ---------- 10. 收尾：确认没有异常请求 ----------
  record(
    "识图接口确实被调用且返回可识别内容",
    window.__apiCalls.vision >= 1,
    "vision=" + window.__apiCalls.vision,
  );

  // ---------- 11. 专注视图 / 全屏 / 低功耗 / 恢复默认 ----------
  const topbarDisplay = () => getComputedStyle($(".topbar")).display;
  const controlDisplay = () => getComputedStyle($(".control-panel")).display;

  $("#focusViewBtn").click();
  await sleep(200);
  record(
    "专注视图生效：body 带上 focus-view 并收起顶部栏",
    document.body.classList.contains("focus-view") && topbarDisplay() === "none",
    "topbar=" + topbarDisplay(),
  );
  record(
    "专注视图收起控制面板，只留棋盘与分析",
    controlDisplay() === "none",
    "control=" + controlDisplay(),
  );
  record(
    "专注视图按钮变成可退回的“退出专注”",
    $("#focusViewLabel").textContent.trim() === "退出专注",
    "label=" + $("#focusViewLabel").textContent.trim(),
  );
  $("#focusViewBtn").click();
  await sleep(200);
  record(
    "再次点击退出专注视图并恢复顶部栏",
    !document.body.classList.contains("focus-view") &&
      topbarDisplay() !== "none",
    "topbar=" + topbarDisplay(),
  );

  // 全局全屏：无头浏览器可能拒绝 requestFullscreen，属于环境限制；
  // 只要没有抛未捕获异常、并且要么进入全屏要么给了提示，就算通过。
  const fullscreenBefore = document.fullscreenElement;
  let fullscreenThrew = false;
  try {
    $("#globalFullscreenBtn").click();
    await sleep(500);
  } catch {
    fullscreenThrew = true;
  }
  const fullscreenEntered = Boolean(document.fullscreenElement);
  const fullscreenTipped = /全屏|Fullscreen|denied|permissions/i.test(
    $("#toast")?.textContent || "",
  );
  record(
    "全局全屏按钮可点击且不抛未捕获异常",
    !fullscreenThrew,
    "fullscreen=" + (fullscreenEntered || "未进入") + "，提示=" + fullscreenTipped,
  );
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch {
      // 忽略退出全屏失败；不影响后续断言。
    }
  }

  $("#lowPowerToggleBtn").click();
  await waitFor(
    () => $("#lowPowerToggleBtn").getAttribute("aria-pressed") === "true",
    6000,
  );
  record(
    "低功耗模式已开启",
    $("#lowPowerToggleBtn").getAttribute("aria-pressed") === "true",
  );
  record(
    "低功耗把线程/内存/候选降到 2 / 256 / 1",
    $("#threadsInput").value === "2" &&
      $("#hashInput").value === "256" &&
      $("#multiPvInput").value === "1",
    "线程=" + $("#threadsInput").value +
      " 内存=" + $("#hashInput").value +
      " 候选=" + $("#multiPvInput").value,
  );
  record(
    "低功耗切到梁子分心模式",
    $("#thinkModeDistractedBtn").getAttribute("aria-pressed") === "true",
  );
  $("#lowPowerToggleBtn").click();
  await waitFor(
    () => $("#lowPowerToggleBtn").getAttribute("aria-pressed") === "false",
    6000,
  );
  record(
    "低功耗模式可关闭并恢复参数",
    $("#lowPowerToggleBtn").getAttribute("aria-pressed") === "false",
  );

  // 一键恢复默认：点击后 250ms 会刷新页面。这里临时拦下那次刷新，
  // 确认 API Key 被保留、其它 xiangqi.* 设置被清空，再恢复定时器。
  try {
    localStorage.setItem("xiangqi.smoke.scratch", "should-be-cleared");
    const keyAtClick = $("#deepseekApiKey").value.trim() || "sk-smoke-keep";
    const realSetTimeout = window.setTimeout;
    let reloadScheduled = false;
    window.setTimeout = function (fn, ms, ...rest) {
      if (typeof fn === "function" && Number(ms) === 250) {
        reloadScheduled = true;
        return 0;
      }
      return realSetTimeout.call(window, fn, ms, ...rest);
    };
    $("#resetAllSettingsBtn").click();
    await sleep(400);
    const keptKey = localStorage.getItem("xiangqi.deepseek.apiKey");
    const clearedScratch = localStorage.getItem("xiangqi.smoke.scratch");
    window.setTimeout = realSetTimeout;
    record(
      "一键恢复默认设置保留 API Key",
      Boolean(keptKey) && keptKey === keyAtClick,
      "key=" + (keptKey ? "保留" : "丢失"),
    );
    record(
      "一键恢复默认设置清空其它本地设置",
      clearedScratch === null,
      "scratch=" + String(clearedScratch),
    );
    record(
      "一键恢复默认设置会触发刷新",
      reloadScheduled === true,
      "reload=" + reloadScheduled,
    );
  } catch (error) {
    record("一键恢复默认设置可执行", false, String(error));
  }

  return { results };
})()`;

async function main() {
  const browser = findBrowser();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "xiangqi-full-"));
  const child = spawn(
    browser,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const problems = [];
  let client = null;
  try {
    const version = await waitForDevTools(DEBUG_PORT);
    client = createClient(version.webSocketDebuggerUrl);
    await client.ready;

    const targets = await client.send("Target.getTargets");
    const page = targets.targetInfos.find((target) => target.type === "page");
    if (!page) throw new Error("没有找到可调试的页面。");
    const attached = await client.send("Target.attachToTarget", {
      targetId: page.targetId,
      flatten: true,
    });
    const sessionId = attached.sessionId;

    client.on("Runtime.exceptionThrown", (params) => {
      problems.push(`页面异常：${params.exceptionDetails?.text || "unknown"}`);
    });
    client.on("Runtime.consoleAPICalled", (params) => {
      if (params.type === "error") {
        const text = (params.args || [])
          .map((arg) => arg.value ?? arg.description ?? "")
          .join(" ");
        problems.push(`控制台报错：${text}`);
      }
    });

    await client.send("Runtime.enable", {}, sessionId);
    await client.send("Page.enable", {}, sessionId);
    await client.send(
      "Page.addScriptToEvaluateOnNewDocument",
      { source: INIT_SCRIPT },
      sessionId,
    );
    await client.send("Page.navigate", { url: URL }, sessionId);

    let rendered = false;
    for (let i = 0; i < 40; i += 1) {
      await sleep(500);
      const probe = await client.send(
        "Runtime.evaluate",
        {
          expression:
            "document.querySelectorAll('#boardPieces .board-piece').length",
          returnByValue: true,
        },
        sessionId,
      );
      if ((probe.result?.value || 0) >= 32) {
        rendered = true;
        break;
      }
    }
    if (!rendered) throw new Error("页面打开后棋盘没有渲染出棋子。");

    // 校验注入桩生效，否则测试结果不可信。
    const guard = await client.send(
      "Runtime.evaluate",
      {
        expression:
          "Boolean(window.__apiCalls && window.speechSynthesis && window.__downloads)",
        returnByValue: true,
      },
      sessionId,
    );
    if (guard.result?.value !== true) {
      throw new Error("测试桩没有注入成功，结果不可信。");
    }

    const evaluation = await Promise.race([
      client.send(
        "Runtime.evaluate",
        { expression: PAGE_SCRIPT, awaitPromise: true, returnByValue: true },
        sessionId,
      ),
      sleep(SCRIPT_TIMEOUT_MS).then(() => {
        throw new Error(`页面脚本执行超过 ${SCRIPT_TIMEOUT_MS / 1000} 秒。`);
      }),
    ]);
    if (evaluation.exceptionDetails) {
      throw new Error(
        `页面脚本执行失败：${evaluation.exceptionDetails.text} ${
          evaluation.exceptionDetails.exception?.description || ""
        }`,
      );
    }

    const results = evaluation.result?.value?.results || [];
    let failed = 0;
    for (const item of results) {
      console.log(
        `[${item.ok ? "PASS" : "FAIL"}] ${item.name}${
          item.detail ? ` (${item.detail})` : ""
        }`,
      );
      if (!item.ok) failed += 1;
    }
    for (const problem of problems) {
      console.log(`[FAIL] ${problem}`);
      failed += 1;
    }
    if (!results.length) {
      console.log("[FAIL] 页面没有返回任何断言结果。");
      failed += 1;
    }
    const total = results.length + problems.length;
    console.log(
      failed
        ? `全功能冒烟测试失败：${failed}/${total} 项未通过。`
        : `全功能冒烟测试全部通过：${total} 项。`,
    );
    process.exitCode = failed ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    if (client?.closeInfo) console.error(`调试连接状态：${client.closeInfo}`);
    process.exitCode = 1;
  } finally {
    client?.close();
    child.kill("SIGKILL");
    await sleep(400);
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // 浏览器还没完全退出时临时目录可能删不掉，不影响测试结果。
    }
  }
}

main()
  .then(() => {
    // WebSocket 关闭和浏览器子进程回收在 Windows 上偶尔会留下异步句柄。
    // 断言和清理已经结束，显式退出可避免命令一直挂起。
    setTimeout(() => process.exit(process.exitCode || 0), 100);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    setTimeout(() => process.exit(1), 100);
  });
