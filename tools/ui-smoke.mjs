/**
 * 真实浏览器冒烟测试（零第三方依赖，只用 Node 内置能力 + 浏览器 DevTools 协议）。
 *
 * 覆盖下面这些交互：
 *   1. 开局棋盘正常渲染 32 枚棋子；
 *   2. 不点“开始对局”也能直接开启自由行棋并落子（红黑双方都能走）；
 *   3. 同一方可以连续走子，“切换红黑行棋”按钮可用；
 *   4. 点过“开始对局”之后自由行棋依然能直接操作；
 *   5. 关掉自由行棋后恢复正常的“轮到我才能走”；
 *   6. AI 助手与 API 密钥收在设置抽屉里，默认隐藏，密钥以星号显示。
 *
 * 用法：node tools/ui-smoke.mjs http://127.0.0.1:8791/
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const URL = process.argv[2] || "http://127.0.0.1:8791/";
const DEBUG_PORT = Number(process.env.UI_SMOKE_PORT || 9333);

const BROWSER_CANDIDATES = [
  process.env.UI_SMOKE_BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].filter(Boolean);

function findBrowser() {
  for (const candidate of BROWSER_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  throw new Error("没有找到 Edge 或 Chrome，可用 UI_SMOKE_BROWSER 指定路径。");
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

/**
 * 通过浏览器级 WebSocket 连上 DevTools，再用 Target.attachToTarget 挂到页面上。
 *
 * 直接连页面级 WebSocket 在部分 Edge 版本上会被立刻断开，浏览器级连接更稳。
 */
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

const PAGE_SCRIPT = String.raw`(async () => {
  const results = [];
  const record = (name, ok, detail) =>
    results.push({ name, ok: !!ok, detail: detail || "" });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const board = document.querySelector("#board");
  const pieceAt = (row, col) =>
    document.querySelector(
      '#boardPieces .board-piece[data-row="' + row + '"][data-col="' + col + '"]',
    );
  const clickDisplay = (row, col) => {
    const rect = board.getBoundingClientRect();
    const clientX = rect.left + (rect.width * (5 + col * 11.25)) / 100;
    const clientY = rect.top + (rect.height * (5 + row * 10)) / 100;
    board.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX, clientY }));
  };
  const countPieces = () =>
    document.querySelectorAll("#boardPieces .board-piece").length;
  const markerCount = () =>
    document.querySelectorAll("#boardPieces .move-marker").length;
  const displayOf = (el) => (el ? getComputedStyle(el).display : "missing");

  await sleep(600);

  const startPieces = countPieces();
  record("开局棋盘已渲染 32 枚棋子", startPieces === 32, "棋子数=" + startPieces);

  // ---- 1. 还没点“开始对局”，自由行棋就应该能直接操作 ----
  const freeBtn = document.querySelector("#freePlayToggleBtn");
  freeBtn.click();
  await sleep(300);
  record(
    "自由行棋开关已激活",
    freeBtn.getAttribute("aria-pressed") === "true" &&
      freeBtn.classList.contains("active"),
    "aria-pressed=" + freeBtn.getAttribute("aria-pressed"),
  );
  record("未开始对局时自由行棋开关可用", !freeBtn.disabled);

  const switchBtn = document.querySelector("#switchTurnBtn");
  record("自由模式下可切换行棋方", !switchBtn.disabled);

  clickDisplay(7, 1);
  await sleep(180);
  const selected = document.querySelector("#boardPieces .board-piece.selected");
  record(
    "不开始对局也能选中棋子",
    !!selected && selected.dataset.row === "7" && selected.dataset.col === "1",
  );
  record("选中后出现可走位置提示", markerCount() > 0, "落点=" + markerCount());

  clickDisplay(4, 1);
  await sleep(350);
  const movedRed = pieceAt(4, 1);
  record(
    "自由模式下红方可直接落子",
    !!movedRed && movedRed.textContent === "炮",
    movedRed ? "目标格=" + movedRed.textContent : "目标格为空",
  );
  record("落子后棋子数量不变", countPieces() === startPieces, "棋子数=" + countPieces());

  clickDisplay(0, 0);
  await sleep(180);
  clickDisplay(1, 0);
  await sleep(350);
  const movedBlack = pieceAt(1, 0);
  record(
    "自由模式下黑方可直接落子（不必轮到黑方）",
    !!movedBlack && movedBlack.textContent === "车",
    movedBlack ? "目标格=" + movedBlack.textContent : "目标格为空",
  );

  // ---- 2. 同一方连续走子 ----
  clickDisplay(7, 7);
  await sleep(180);
  clickDisplay(4, 7);
  await sleep(350);
  const twiceRed = pieceAt(4, 7);
  record(
    "红方可以连续走两步",
    !!twiceRed && twiceRed.textContent === "炮",
    twiceRed ? "目标格=" + twiceRed.textContent : "目标格为空",
  );

  const beforeSwitch = document.querySelector("#sideValue").textContent;
  switchBtn.click();
  await sleep(300);
  const afterSwitch = document.querySelector("#sideValue").textContent;
  record(
    "可以手动切换红黑行棋",
    beforeSwitch !== afterSwitch,
    beforeSwitch + "->" + afterSwitch,
  );

  // ---- 3. 点过“开始对局”之后，自由行棋依然能在棋盘上直接落子 ----
  document.querySelector("#startGameBtn").click();
  await sleep(900);
  const chipAfterStart = document.querySelector("#gameStateChip").textContent.trim();
  record(
    "开始对局后状态显示对局进行中",
    chipAfterStart.indexOf("进行中") >= 0,
    "状态=" + chipAfterStart,
  );
  clickDisplay(6, 0);
  await sleep(180);
  const markersAfterStart = markerCount();
  clickDisplay(5, 0);
  await sleep(350);
  const movedAfterStart = pieceAt(5, 0);
  record(
    "开始对局后自由行棋仍可直接落子",
    markersAfterStart > 0 && !!movedAfterStart && movedAfterStart.textContent === "兵",
    "落点=" +
      markersAfterStart +
      " 目标格=" +
      (movedAfterStart ? movedAfterStart.textContent : "空"),
  );

  // ---- 4. 关掉自由行棋后恢复“轮到我才能走” ----
  const sideText = document.querySelector("#sideValue").textContent.trim();
  if (sideText === "黑方") {
    switchBtn.click();
    await sleep(250);
  }
  freeBtn.click();
  await sleep(350);
  record(
    "自由行棋可以关闭",
    freeBtn.getAttribute("aria-pressed") === "false",
    "aria-pressed=" + freeBtn.getAttribute("aria-pressed"),
  );
  clickDisplay(5, 0);
  await sleep(200);
  record(
    "关闭自由行棋后不再允许随便走子",
    markerCount() === 0 &&
      !document.querySelector("#boardPieces .board-piece.selected"),
    "落点=" + markerCount(),
  );

  // ---- 5. 编辑残局面板可以直接点格子摆放/擦除棋子 ----
  document.querySelector("#editTab").click();
  await sleep(400);
  const piecesBeforeEdit = countPieces();
  document.querySelector('#piecePalette .palette-piece[data-piece="R"]').click();
  await sleep(120);
  clickDisplay(5, 4);
  await sleep(300);
  const placed = pieceAt(5, 4);
  record(
    "编辑残局可以直接摆放棋子",
    !!placed && placed.textContent === "车" && countPieces() === piecesBeforeEdit + 1,
    "格子=" + (placed ? placed.textContent : "空") + " 棋子数=" + countPieces(),
  );
  document.querySelector('#piecePalette .palette-piece[data-piece="."]').click();
  await sleep(120);
  clickDisplay(5, 4);
  await sleep(300);
  record(
    "编辑残局可以直接擦除棋子",
    !pieceAt(5, 4) && countPieces() === piecesBeforeEdit,
    "棋子数=" + countPieces(),
  );
  document.querySelector("#playTab").click();
  await sleep(400);

  // ---- 6. AI 助手与 API 密钥整合进设置菜单 ----
  const keyField = document.querySelector("#deepseekApiKey");
  const drawerItem = keyField.closest(".settings-drawer-item");
  record("API Key 输入框位于设置抽屉内", !!drawerItem);
  record("API Key 以星号形式显示", keyField.getAttribute("type") === "password");
  record(
    "设置默认收起（AI 配置不占主界面）",
    !document.body.classList.contains("settings-open") &&
      displayOf(drawerItem) === "none",
    "display=" + displayOf(drawerItem),
  );
  record("识图功能复用设置里的同一把密钥", !!document.querySelector(".vision-settings"));
  record(
    "密钥输入框整页只有一处",
    document.querySelectorAll('input[type="password"]').length === 1,
    "password字段=" + document.querySelectorAll('input[type="password"]').length,
  );
  const quipToggle = document.querySelector("#quipToggleBtn");
  const coachToggle = document.querySelector("#coachModeToggleBtn");
  const manualCoach = document.querySelector("#coachManualModeBtn");
  const autoCoach = document.querySelector("#coachAutoModeBtn");
  record("语音吐槽与教练模式为两个独立开关", !!quipToggle && !!coachToggle);
  record(
    "教练模式默认手动分析",
    manualCoach.getAttribute("aria-pressed") === "true" &&
      autoCoach.getAttribute("aria-pressed") === "false",
  );
  record(
    "教练模式提供每步自动分析入口",
    autoCoach.textContent.indexOf("每步自动分析") >= 0,
  );
  record(
    "语音语速默认 1.5 倍",
    document.querySelector("#speechRateInput").value === "1.5" &&
      document.querySelector("#speechRateValue").textContent.indexOf("1.5") >= 0,
  );
  record(
    "吐槽与教练语音可独立启停",
    !!document.querySelector("#quipVoiceEnabled") &&
      !!document.querySelector("#coachVoiceEnabled") &&
      document.querySelector("#quipVoiceEnabled").checked &&
      document.querySelector("#coachVoiceEnabled").checked,
  );
  document.querySelector("#settingsToggleBtn").click();
  await sleep(300);
  record(
    "点击设置后 AI 配置可见",
    document.body.classList.contains("settings-open") &&
      displayOf(drawerItem) !== "none",
    "display=" + displayOf(drawerItem),
  );

  return { results };
})()`;

async function main() {
  const browser = findBrowser();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "xiangqi-smoke-"));
  const child = spawn(
    browser,
    [
      "--headless=new",
      // 受控沙箱环境里必须关掉浏览器自身沙箱，否则渲染进程会挂起。
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
    await client.send("Page.navigate", { url: URL }, sessionId);

    // 等棋盘渲染出来（最多 20 秒）。
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

    const evaluation = await client.send(
      "Runtime.evaluate",
      { expression: PAGE_SCRIPT, awaitPromise: true, returnByValue: true },
      sessionId,
    );
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
    console.log(
      failed ? `UI 冒烟测试失败：${failed} 项。` : "UI 冒烟测试全部通过。",
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
