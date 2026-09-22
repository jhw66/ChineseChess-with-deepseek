import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { VoiceOutputQueue, VOICE_PRIORITY } from "../src/voice-output.js";
import {
  LOW_POWER_SETTINGS,
  collectResourceWarnings,
} from "../src/think-mode.js";

/**
 * v14.3.3 的几处"看起来只是开关、其实很容易改坏"的约定，用静态回归钉住：
 *   1. 专注视图/全屏必须真的收起干扰元素，而不是只挂一个空 class。
 *   2. 低功耗模式必须停常驻 go infinite，提示改为一次性有限搜索。
 *   3. 关页面只能停搜索，绝不能杀掉常驻引擎进程。
 *   4. 一键恢复默认设置必须保留已保存的 API 密钥。
 *   5. 语音队列的"整段一次说完"用 chunks 表达，不靠改优先级硬凑。
 */

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const APP_PATH = path.join(ROOT, "public", "app.js");
const CSS_PATH = path.join(ROOT, "public", "styles.css");
const HTML_PATH = path.join(ROOT, "public", "index.html");

const appAvailable = fs.existsSync(APP_PATH);
const appSource = appAvailable ? fs.readFileSync(APP_PATH, "utf8") : "";
const cssAvailable = fs.existsSync(CSS_PATH);
const cssSource = cssAvailable ? fs.readFileSync(CSS_PATH, "utf8") : "";
const htmlAvailable = fs.existsSync(HTML_PATH);
const htmlSource = htmlAvailable ? fs.readFileSync(HTML_PATH, "utf8") : "";

const skip = appAvailable ? false : "本目录没有 public/app.js（纯运行时树），跳过静态检查";

function functionBody(name) {
  const start = appSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `找不到函数 ${name}`);
  const rest = appSource.slice(start);
  const end = rest.indexOf("\nfunction ", 1);
  const endAsync = rest.indexOf("\nasync function ", 1);
  const candidates = [end, endAsync].filter((n) => n > 0);
  return candidates.length ? rest.slice(0, Math.min(...candidates)) : rest;
}

test("low-power preset is a real, modest resource profile", () => {
  assert.deepEqual(
    { ...LOW_POWER_SETTINGS },
    { threads: 2, hash: 256, multiPV: 1 },
  );
});

test("resource warnings only fire on genuinely heavy settings", () => {
  const quiet = collectResourceWarnings({
    threads: 2,
    hash: 256,
    multiPV: 1,
    logicalProcessors: 14,
    continuousThinking: true,
  });
  assert.deepEqual(quiet, [], "低功耗档位不应该常驻报警");

  const oversubscribed = collectResourceWarnings({
    threads: 32,
    hash: 8192,
    multiPV: 12,
    logicalProcessors: 14,
    continuousThinking: true,
  });
  assert.ok(
    oversubscribed.some((line) => line.includes("32")),
    "超过本机逻辑线程必须给出警告",
  );
  assert.ok(
    oversubscribed.some((line) => line.includes("内存")),
    "高哈希内存必须给出警告",
  );
});

test("low power disables resident infinite analysis", { skip }, () => {
  const allowed = functionBody("persistentAnalysisAllowed");
  assert.match(
    allowed,
    /return\s+!state\.lowPowerMode/,
    "低功耗模式必须直接关掉常驻分析",
  );

  const keepAnalyzing = functionBody("shouldKeepAnalyzing");
  assert.match(
    keepAnalyzing,
    /if\s*\(!persistentAnalysisAllowed\(\)\)\s*return false/,
    "低功耗下持续思考/教练/提示都不能再触发 go infinite",
  );
});

test("low power still offers hints via a one-shot search", { skip }, () => {
  const hintOnce = functionBody("refreshHintOnce");
  assert.match(
    hintOnce,
    /\/api\/engine\/bestmove/,
    "低功耗提示必须走一次性 bestmove 搜索，而不是常驻分析",
  );
  assert.match(
    hintOnce,
    /movetimeMs:\s*HINT_SEARCH_MOVETIME_MS/,
    "一次性提示要有明确的有限思考时间",
  );
  assert.doesNotMatch(hintOnce, /go infinite/, "低功耗提示不得发送 go infinite");
});

test("closing the page only stops search, never kills the engine", { skip }, () => {
  const marker = 'navigator.sendBeacon?.("/api/engine/stop", "{}")';
  assert.ok(
    appSource.includes(marker),
    "关页面必须只发 /api/engine/stop 停搜索",
  );
  assert.ok(
    !appSource.includes('/api/engine/quit'),
    "任何位置都不应该用 sendBeacon 杀常驻引擎进程",
  );
});

test("one-click reset keeps the saved DeepSeek API key", { skip }, () => {
  const body = functionBody("resetAllSettings");
  assert.match(
    body,
    /const apiKeyStorageKey = "xiangqi\.deepseek\.apiKey"/,
    "重置必须知道 API Key 的存储键",
  );
  assert.match(
    body,
    /key !== apiKeyStorageKey/,
    "清理循环必须跳过 API Key",
  );
  assert.match(
    body,
    /localStorage\.setItem\(apiKeyStorageKey/,
    "重置前要先保存输入框里的最新密钥",
  );
});

test("focus view and fullscreen really hide the distractors", () => {
  assert.ok(cssAvailable, "缺少 public/styles.css");
  for (const selector of [
    "body.focus-view .topbar",
    "body.focus-view .control-panel",
    "html:fullscreen .control-panel",
  ]) {
    assert.ok(
      cssSource.includes(selector),
      `专注视图/全屏样式缺少 ${selector}`,
    );
  }
  assert.ok(
    /body\.focus-view\s+\.play-stage[\s\S]*?grid-template-columns/.test(
      cssSource,
    ),
    "专注视图要让棋盘与分析面板重新排布",
  );
  assert.ok(
    cssSource.includes(".focus-view-toggle.active") &&
      cssSource.includes(".fullscreen-toggle.active"),
    "两个开关都要有激活态样式",
  );
});

test("focus and fullscreen controls exist in the markup", () => {
  assert.ok(htmlAvailable, "缺少 public/index.html");
  for (const id of [
    "focusViewBtn",
    "globalFullscreenBtn",
    "lowPowerToggleBtn",
    "resetAllSettingsBtn",
  ]) {
    assert.ok(htmlSource.includes(`id="${id}"`), `棋盘工具栏缺少 ${id}`);
  }
});

test("voice queue keeps declared chunks so a paragraph reads in order", () => {
  const queue = new VoiceOutputQueue();
  queue.enqueue({
    text: "整段点评",
    chunks: ["第一片", "  ", "第二片", ""],
    priority: VOICE_PRIORITY.MOVE_QUIP,
  });
  const task = queue.takeNext();
  assert.deepEqual(task.chunks, ["第一片", "第二片"], "chunks 要去空白并保序");
});
