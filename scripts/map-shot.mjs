/**
 * 地図の見た目の確認用の撮影（docs/ideas/map-visual-impl.md 5-2 節）。`npm run map:shot`。
 * vite を子で起こし、tools/map-shot.html（src/tools/mapShot.ts）を playwright の Chromium で開いて 1920x1080 で撮る。
 *
 *   npm run map:shot                          既定の 14 枚を map-shot-out へ
 *   npm run map:shot -- --out <dir>           出力先を変える（リポジトリの外を推奨）
 *   npm run map:shot -- --only d7-rooms       1 枚だけ
 *   npm run map:shot -- --query "depth=9&kind=mine&seed=3&layout=court&tx=40&ty=30"   任意のクエリで 1 枚（名前は custom）
 *   npm run map:shot -- --bench [--only name] 撮らずに ?bench=1 で地図の描画と焼きの平均 ms を表示する
 *
 * playwright と vite の用意は browser-tools.mjs（playwright は PLAYWRIGHT_MODULE → リポジトリ → `npm root -g` の順。
 * Chromium は PLAYWRIGHT_BROWSERS_PATH。クラウドでは /opt/pw-browsers。vite がすでに起きていれば使い回す）。
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureVite, findPlaywright } from "./browser-tools.mjs";

/** 別の作業ツリーの vite が 5199 を使っているときは MAP_SHOT_PORT で逃がす（使い回すと別の作業ツリーの絵を撮る） */
const PORT = Number(process.env.MAP_SHOT_PORT ?? 5199);
const BASE = `http://localhost:${PORT}`;
const VIEWPORT = { width: 1920, height: 1080 };
const READY_TIMEOUT_MS = 120_000;

/** 既定で撮る一覧（5-2 節の 12 枚 + river + court） */
const SHOTS = [
  ["hub-new", "kind=hub&scene=new"],
  ["hub-full", "kind=hub&scene=full"],
  ["d3-cave", "depth=3&kind=cave"],
  ["d4-swamp", "depth=4&kind=swamp"],
  ["d5-boss", "depth=5"],
  ["d7-rooms", "depth=7&kind=rooms"],
  ["d8-mine", "depth=8&kind=mine"],
  ["d12-forge", "depth=12&kind=forge"],
  ["d13-glacier", "depth=13&kind=glacier"],
  ["d17-cave", "depth=17&kind=cave"],
  ["d18-dark", "depth=18&kind=dark"],
  ["d21", "depth=21"],
  ["d23", "depth=23"],
  ["river", "depth=3&kind=cave&layout=river"],
  ["court", "depth=7&kind=rooms&layout=court"],
  // 予告の場面（docs/ideas/ink-telegraph-impl.md 段 0-c）: 乱戦 30 体 / 7 形の並べ撮り / 明るい章様式 / 暗闇の階
  ["tele-crowd", "depth=3&kind=cave&scene=tele&tele=crowd"],
  ["tele-shapes", "depth=3&kind=cave&scene=tele&tele=shapes"],
  ["tele-bright", "depth=13&kind=glacier&scene=tele&tele=crowd"],
  ["tele-dark", "depth=18&kind=dark&scene=tele&tele=crowd"],
];

function parseArgs(argv) {
  const opts = { out: path.join(tmpdir(), "map-shot"), only: null, query: null, bench: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") opts.out = path.resolve(argv[++i] ?? "");
    else if (a === "--only") opts.only = argv[++i] ?? null;
    else if (a === "--query") opts.query = argv[++i] ?? null;
    else if (a === "--bench") opts.bench = true;
    else {
      console.error(`未知の引数: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

function pickShots(opts) {
  if (opts.query) return [["custom", opts.query]];
  if (!opts.only) return SHOTS;
  const hit = SHOTS.filter(([name]) => name === opts.only);
  if (hit.length === 0) {
    console.error(`未知の名前: ${opts.only}（${SHOTS.map(([n]) => n).join(" / ")}）`);
    process.exit(2);
  }
  return hit;
}

async function openShot(page, query, bench) {
  await page.goto(`${BASE}/tools/map-shot.html?${query}${bench ? "&bench=1" : ""}`);
  await page.waitForFunction(() => window.__mapShotReady === true, null, { timeout: READY_TIMEOUT_MS });
  const error = await page.evaluate(() => window.__mapShotError ?? null);
  if (error) throw new Error(error);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { chromium } = findPlaywright();
  const shots = pickShots(opts);
  if (!opts.bench) mkdirSync(opts.out, { recursive: true });

  const vite = await ensureVite(PORT, `${BASE}/tools/map-shot.html`);
  let browser = null;
  let failed = false;
  try {
    browser = await chromium.launch({ args: ["--no-sandbox"] });
    for (const [name, query] of shots) {
      // 1 枚ごとに新しいページ（同じページで読み直すとブラウザの資源が尽きることがある）
      const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
      page.on("pageerror", (e) => console.error(`[page] ${e.message}`));
      page.on("console", (m) => {
        if (m.type() === "error") console.error(`[console] ${m.text()}`);
      });
      try {
        await openShot(page, query, opts.bench);
        if (opts.bench) {
          console.log(`${name}: ${JSON.stringify(await page.evaluate(() => window.__mapBench))}`);
          continue;
        }
        const file = path.join(opts.out, `${name}.png`);
        await page.locator("canvas").screenshot({ path: file });
        console.log(file);
      } catch (e) {
        failed = true;
        console.error(`${name}: 失敗 ${e instanceof Error ? e.message : e}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    if (browser) await browser.close();
    vite.stop();
  }
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
