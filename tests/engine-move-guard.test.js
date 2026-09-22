import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 静态回归：引擎走子不能被"停止分析"误伤。
 *
 * 起因：关掉【持续思考】或切到后台时会调用 haltEngineSearch()。
 * 若它与 requestEngineMove() 共用同一个代次计数器，电脑那一步会在返回时被
 * 静默丢弃 —— 表现就是"轮到电脑却永远不走棋、棋盘像卡死"。
 * 修法是把两个代次分开，并用这个文件把约定钉住。
 */

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const APP_PATH = path.join(ROOT, "public", "app.js");
const available = fs.existsSync(APP_PATH);
const source = available ? fs.readFileSync(APP_PATH, "utf8") : "";
const ENGINE_PATH = path.join(ROOT, "src", "engine.js");
const engineAvailable = fs.existsSync(ENGINE_PATH);
const engineSource = engineAvailable ? fs.readFileSync(ENGINE_PATH, "utf8") : "";
const engineSkip = engineAvailable ? false : "src/engine.js is unavailable";
const skip = available ? false : "本目录没有 public/app.js（纯运行时树），跳过静态检查";

function functionBody(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `找不到函数 ${name}`);
  // 粗略截取到下一个顶层 function，足够做静态断言。
  const rest = source.slice(start);
  const end = rest.indexOf("\nfunction ", 1);
  const endAsync = rest.indexOf("\nasync function ", 1);
  const candidates = [end, endAsync].filter((n) => n > 0);
  return candidates.length ? rest.slice(0, Math.min(...candidates)) : rest;
}

test("engine moves use their own generation, not the analysis one", { skip }, () => {
  const body = functionBody("requestEngineMove");
  assert.match(body, /state\.moveGeneration/, "引擎走子必须用 moveGeneration 守卫");
  assert.doesNotMatch(
    body,
    /\+\+state\.engineGeneration/,
    "引擎走子不得再用 engineGeneration（会被停止分析误伤）",
  );
});

// ---------------------------------------------------------------------------
// 这是本文件最重要的一条断言，也是最容易被"只改一半"绕过的地方。
// 历史事故（发生过两次，症状都是"机器不走棋、棋盘像卡死"）：
//   捕获时写了 `const generation = ++state.moveGeneration;`
//   比较时却写成 `if (generation !== state.engineGeneration) return;`
//   —— 两个计数器相互独立，只要它们不相等，引擎每一步都会在这里被静默丢弃。
// 只断言"出现过 moveGeneration""没出现过 ++engineGeneration"是**抓不住**它的：
// 上面那两行同时满足这两条。必须断言"捕获与比较用的是同一个计数器"。
// ---------------------------------------------------------------------------
test("engine moves compare against the very generation they captured", { skip }, () => {
  const body = functionBody("requestEngineMove");

  const captured = body.match(/const\s+generation\s*=\s*\+\+state\.([A-Za-z0-9_]+)\s*;/);
  assert.ok(captured, "找不到 `const generation = ++state.<计数器>` 的捕获写法");
  const counter = captured[1];
  assert.equal(
    counter,
    "moveGeneration",
    "引擎走子捕获的代次必须取自 moveGeneration（analysis 的代次会被停止分析误伤）",
  );

  const comparisons = [
    ...body.matchAll(/generation\s*[!=]==\s*state\.([A-Za-z0-9_]+)/g),
  ].map((match) => match[1]);
  assert.ok(
    comparisons.length >= 1,
    "找不到任何代次比较——引擎走子的守卫形同虚设",
  );

  const mismatched = comparisons.filter((name) => name !== counter);
  assert.deepEqual(
    mismatched,
    [],
    `引擎走子里出现了跨计数器比较：捕获用的是 ${counter}，` +
      `但比较用了 ${mismatched.join("、")}。\n` +
      `这会让引擎每一步都在守卫处被静默丢弃，表现为「机器自己不移动棋子」。`,
  );
});

test("超级大师正式走子使用完整设置时间", { skip }, () => {
  const body = functionBody("requestEngineMove");
  assert.match(
    body,
    /resolvePersonaThinkMs\(\{[\s\S]*?requestedThinkMs:\s*state\.thinkTimeMs/,
    "正式走子必须通过 resolvePersonaThinkMs 统一计算思考时间",
  );
  assert.doesNotMatch(
    body,
    /Math\.min\(state\.thinkTimeMs,\s*persona\.movetimeMs\)/,
    "不能再把超级大师的长时间截断成人格自带的 5 秒",
  );
  assert.match(
    body,
    /maxThinkMs:\s*effectiveThinkMs/,
    "下发给引擎的时间必须与界面显示的有效思考时间一致",
  );
});

test("预判搜索的信息流与主分析面板隔离", { skip }, () => {
  const body = functionBody("updateAnalysis");
  assert.match(
    body,
    /info\.searchMode === "ponder"/,
    "updateAnalysis 必须识别预判搜索",
  );
  assert.match(
    body,
    /state\.ponderDepth[\s\S]*renderForecastChip\(\)[\s\S]*return;/,
    "预判信息只能刷新预判状态，不能继续更新主面板评分",
  );
});

// ---------------------------------------------------------------------------
// 上面那条只盯 requestEngineMove；同类事故在别的异步流程里同样会发生。
// 所以这里把整个 app.js 扫一遍：任何 `const generation = ++state.X` 之后的每一次
// `generation [!=]== state.Y` 都必须是同一个 X。
// ---------------------------------------------------------------------------
test("no async flow anywhere compares across two different generations", { skip }, () => {
  const lines = source.split("\n");
  const functionStarts = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/(?:^|\s)(?:async\s+)?function\s+([A-Za-z0-9_]+)/);
    if (match) functionStarts.push({ line: index, name: match[1] });
  }

  const problems = [];
  let captureCount = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const capture = lines[index].match(
      /const\s+generation\s*=\s*\+\+state\.([A-Za-z0-9_]+)\s*;/,
    );
    if (!capture) continue;
    captureCount += 1;
    const counter = capture[1];

    const owner = [...functionStarts].reverse().find((item) => item.line <= index);
    const nextStart =
      functionStarts.find((item) => item.line > index)?.line ?? lines.length;
    const scope = lines.slice(index, nextStart).join("\n");

    const compared = new Set(
      [...scope.matchAll(/generation\s*[!=]==\s*state\.([A-Za-z0-9_]+)/g)].map(
        (match) => match[1],
      ),
    );
    const mismatched = [...compared].filter((name) => name !== counter);
    if (mismatched.length) {
      problems.push(
        `${owner?.name ?? "?"}（第 ${index + 1} 行附近）：` +
          `捕获 ${counter}，却与 ${mismatched.join("、")} 比较`,
      );
    }
  }

  assert.ok(captureCount >= 2, `只找到 ${captureCount} 处代次捕获，扫描逻辑可能失效了`);
  assert.deepEqual(
    problems,
    [],
    `存在跨计数器比较，会让对应的异步流程被静默丢弃：\n${problems.join("\n")}`,
  );
});

test("stopping analysis only invalidates analysis by default", { skip }, () => {
  const body = functionBody("haltEngineSearch");
  assert.match(body, /keepPendingMove/, "haltEngineSearch 必须支持 keepPendingMove");
  assert.match(
    body,
    /if \(!keepPendingMove\) state\.moveGeneration \+= 1/,
    "只有显式要求时才作废在途的引擎走子",
  );
  assert.match(body, /state\.engineGeneration \+= 1/, "分析代次始终要作废");
});

test("resetting the position invalidates a pending engine move", { skip }, () => {
  const body = functionBody("resetCurrentPosition");
  assert.match(body, /state\.moveGeneration \+= 1/, "悔棋/载入/编辑后必须作废在途走子");
});

test("returning to the standard opening invalidates a pending engine move", { skip }, () => {
  const body = functionBody("resetStandardOpening");
  assert.match(body, /state\.moveGeneration \+= 1/, "一键重置开局后必须作废在途走子");
});

test("the continuous-thinking switch keeps a pending engine move alive", { skip }, () => {
  const body = functionBody("setContinuousThinkingEnabled");
  assert.ok(body.length > 0, "找不到 setContinuousThinkingEnabled");
  assert.match(
    body,
    /haltEngineSearch\(\{[^}]*keepPendingMove:\s*true/,
    "关闭持续思考时不能丢弃在途的电脑走子（haltEngineSearch 必须 keepPendingMove: true）",
  );
});

test("the coach switch keeps a pending engine move alive", { skip }, () => {
  const body = functionBody("setCoachModeEnabled");
  assert.ok(body.length > 0, "找不到 setCoachModeEnabled");
  assert.match(
    body,
    /haltEngineSearch\(\{[^}]*keepPendingMove:\s*true/,
    "关闭教练模式只停分析，不能丢弃在途的电脑走子",
  );
});

test("pausing analysis and backgrounding the page also keep the move alive", { skip }, () => {
  // 暂停按钮走 stopEngineSearch()：只停分析，不丢弃在途的电脑走子。
  const pauseBody = functionBody("stopEngineSearch");
  assert.match(
    pauseBody,
    /haltEngineSearch\(\{[^}]*keepPendingMove:\s*true/,
    "暂停分析必须 keepPendingMove: true，否则会误杀在途的电脑走子",
  );

  const bgIdx = source.indexOf("页面切到后台，已暂停分析");
  assert.ok(bgIdx > 0, "找不到切后台暂停分析的调用");
  assert.match(source.slice(bgIdx - 160, bgIdx + 120), /keepPendingMove:\s*true/);
});

test("ponder search must use go ponder infinite", { skip: engineSkip }, () => {
  assert.match(
    engineSource,
    /this\.send\("go ponder infinite"\)/,
    "ponder must not carry movetime, or the search returns before ponderhit",
  );
  assert.doesNotMatch(
    engineSource,
    /send\("go ponder movetime/,
    "the old movetime-based ponder command must not return",
  );
});
