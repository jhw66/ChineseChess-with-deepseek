/**
 * 静态自检：public/app.js 里用 querySelector("#id") 拿到的每个元素，
 * 必须在 public/index.html 里真实存在。
 *
 * 为什么需要它：elements 表在启动时一次性求值，任何一个 id 拼错都会让
 * 整个界面在 boot() 里抛错白屏，而 node --check 只查语法、查不出这种问题。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const app = readFileSync(join(root, "public", "app.js"), "utf8");
const html = readFileSync(join(root, "public", "index.html"), "utf8");

const start = app.indexOf("const elements = {");
const end = app.indexOf("\n};", start);
const block = start >= 0 && end > start ? app.slice(start, end) : app;

const ids = new Set();
for (const match of block.matchAll(/querySelector\("#([A-Za-z0-9_-]+)"\)/g)) {
  ids.add(match[1]);
}

const missing = [...ids].filter(
  (id) => !html.includes(`id="${id}"`) && !html.includes(`id='${id}'`),
);

console.log(`elements 里引用了 ${ids.size} 个 id。`);
if (missing.length) {
  console.error(`index.html 中缺失：${missing.join(", ")}`);
  process.exit(1);
}
console.log("全部存在。");
