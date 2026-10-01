// タイトル画面の題字（「墨淵」）のマスクを作る: Yuji Boku（SIL OFL 1.1）で書いた字を二値の点にして
// src/data/sprites/titleLogo.ts へ書き出す。実行時にフォントを読まないため、字形を変えたいときだけ回す。
//
// 使い方:
//   1. フォントを取る（リポジトリには入れない）:
//        curl -sS -A "Mozilla/5.0" "https://fonts.googleapis.com/css2?family=Yuji+Boku&text=墨淵"
//        で出る url(...) の TTF を保存する
//   2. NODE_PATH=$(npm root -g) node scripts/title/gen-logo.mjs --font <ttf> [--text 墨淵] [--px 40] [--thr 110]
// ブラウザは playwright（グローバル）の Chromium。フォントを @font-face で読ませて canvas に描く。
// 二値化は見本（docs/ideas/previews/title/index.html の mask）と同じ:
// 文字の外接矩形で切り、アルファが閾値以上なら 1。
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../../src/data/sprites/titleLogo.ts");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const fontPath = arg("font");
if (!fontPath) {
  console.error("--font <ttf> が必要です（冒頭の手順を参照）");
  process.exit(1);
}
const text = arg("text", "墨淵");
const px = Number(arg("px", "40"));
const thr = Number(arg("thr", "110"));

const { chromium } = require("playwright");
const browser = await chromium.launch();
const page = await browser.newPage();
const b64 = readFileSync(fontPath).toString("base64");
await page.setContent(
  `<style>@font-face{font-family:"YB";src:url(data:font/ttf;base64,${b64}) format("truetype");}</style><body></body>`,
);
const rows = await page.evaluate(
  async ({ text, px, thr }) => {
    await document.fonts.load(`${px}px "YB"`, text);
    const c = document.createElement("canvas");
    const g = c.getContext("2d");
    g.font = `${px}px "YB", serif`;
    const w = Math.ceil(g.measureText(text).width) + px;
    const h = Math.ceil(px * 1.6);
    c.width = w;
    c.height = h;
    g.font = `${px}px "YB", serif`;
    g.textBaseline = "middle";
    g.fillStyle = "#fff";
    g.fillText(text, Math.round(px / 2), Math.round(h / 2));
    const d = g.getImageData(0, 0, w, h).data;
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] < thr) continue;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
    const out = [];
    for (let y = y0; y <= y1; y++) {
      let row = "";
      for (let x = x0; x <= x1; x++) row += d[(y * w + x) * 4 + 3] >= thr ? "#" : ".";
      out.push(row);
    }
    return out;
  },
  { text, px, thr },
);
await browser.close();

const body = rows.map((r) => `  "${r}",`).join("\n");
const src = `/**
 * タイトル画面の題字「${text}」の二値マスク（"#" が墨の点、"." が紙）。生成物なので手で直さない。
 * 作り方: scripts/title/gen-logo.mjs（Yuji Boku、SIL OFL 1.1、${px}px、アルファ閾値 ${thr}）。
 * 実行時にフォントは読まない。塗りは render/titleLogo.ts（縁・影・上下の明暗・光の筋）。
 */
export const TITLE_LOGO_ROWS: readonly string[] = [
${body}
];
`;
writeFileSync(OUT, src);
console.log(`${OUT}: ${rows[0]?.length ?? 0} x ${rows.length}`);
