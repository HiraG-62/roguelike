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
 * playwright は PLAYWRIGHT_MODULE（パス）→ リポジトリの node_modules → `npm root -g` の順で探す。
 * Chromium は PLAYWRIGHT_BROWSERS_PATH（既定 /opt/pw-browsers）にあるものを使う（playwright install はしない）。
 */
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5199;
const BASE = `http://localhost:${PORT}`;
const VIEWPORT = { width: 1920, height: 1080 };
const READY_TIMEOUT_MS = 120_000;
const SERVER_TIMEOUT_MS = 60_000;

/** 既定で撮る一覧（5-2 節の 12 枚 + river + court） */
const SHOTS = [
  ["hub", "kind=hub"],
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

function findPlaywright() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_MODULE) candidates.push(process.env.PLAYWRIGHT_MODULE);
  candidates.push(path.join(ROOT, "node_modules", "playwright"));
  try {
    candidates.push(path.join(execSync("npm root -g", { encoding: "utf8" }).trim(), "playwright"));
  } catch {
    // npm が無ければ次の候補へ
  }
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error(`playwright が見つからない。探した場所: ${candidates.join(", ")}`);
  return createRequire(path.join(found, "package.json"))(found);
}

async function waitForServer(url, child) {
  const started = Date.now();
  while (Date.now() - started < SERVER_TIMEOUT_MS) {
    if (child.exitCode !== null) throw new Error(`vite が終了した（exit ${child.exitCode}）`);
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // まだ起きていない
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("vite が時間内に起動しなかった");
}

function startVite() {
  const entry = path.join(ROOT, "node_modules", "vite", "bin", "vite.js");
  const child = spawn(process.execPath, [entry, "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.on("data", (d) => process.stderr.write(`[vite] ${d}`));
  return child;
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
  process.env.PLAYWRIGHT_BROWSERS_PATH ??= "/opt/pw-browsers";
  const { chromium } = findPlaywright();
  const shots = pickShots(opts);
  if (!opts.bench) mkdirSync(opts.out, { recursive: true });

  const vite = startVite();
  let browser = null;
  let failed = false;
  try {
    await waitForServer(`${BASE}/tools/map-shot.html`, vite);
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
    vite.kill();
  }
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
