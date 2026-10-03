/**
 * 装備画面（装束と紋）の確認用の撮影。`npm run menu:shot`。
 * vite を子で起こし、tools/menu-shot.html（src/tools/menuShot.ts）を playwright の Chromium で開いて 1920x1080 で撮る。
 *
 *   npm run menu:shot                                   既定の場面を menu-shot-out（一時フォルダ）へ
 *   npm run menu:shot -- --out <dir>                    出力先を変える（リポジトリの外を推奨）
 *   npm run menu:shot -- --only skills-lift             1 場面だけ
 *   npm run menu:shot -- --only "cand-stone+focus=first" 場面名の後ろに「+」でクエリを足せる（focus=first = 候補の先頭の札に焦点、focus=2 = 3 枚目の札に焦点）
 *
 * 場面: manual（武器指南書。`--only "manual+weapon=spear&move=3&frames=40"`）/ dojo（稽古の間。`--only "dojo+enemy=slime&count=3&frames=240"`）/ dojo-board（稽古帳）/ attire / attire-swap（体の候補）/ skills（手持ちつき）/ skills-lift（手持ちの符を持ち上げ中）/ cand-stone（スキル枠の候補）/ cand-group（スキル枠の候補の束を開いた頁）/ cand-slot（頭の候補）。
 * 別の作業ツリーの vite が同じ port を使っているときは MAP_SHOT_PORT で逃がす（map:shot と共通）
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ensureVite, findPlaywright } from "./browser-tools.mjs";

const PORT = Number(process.env.MAP_SHOT_PORT ?? 5199);
const GPU_ARGS = process.platform === "win32" ? ["--enable-gpu", "--use-angle=d3d11", "--ignore-gpu-blocklist"] : [];
const BASE = `http://localhost:${PORT}`;
const VIEWPORT = { width: 1920, height: 1080 };
const READY_TIMEOUT_MS = 120_000;

const SCENES = ["attire", "attire-swap+focus=first", "skills", "skills-lift", "cand-stone+focus=first", "cand-group+focus=first", "cand-slot+focus=first"];

function parseArgs(argv) {
  const opts = { out: path.join(tmpdir(), "menu-shot-out"), only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") opts.out = path.resolve(argv[++i] ?? "");
    else if (a === "--only") opts.only = argv[++i] ?? null;
    else {
      console.error(`未知の引数: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { chromium } = findPlaywright();
  const scenes = opts.only === null ? SCENES : [opts.only];
  mkdirSync(opts.out, { recursive: true });
  const vite = await ensureVite(PORT, `${BASE}/tools/menu-shot.html`);
  let browser = null;
  let failed = false;
  try {
    browser = await chromium.launch({ args: ["--no-sandbox", ...GPU_ARGS] });
    for (const scene of scenes) {
      const [name, extra] = scene.split("+");
      const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
      page.on("pageerror", (e) => console.error(`[page] ${e.message}`));
      try {
        await page.goto(`${BASE}/tools/menu-shot.html?scene=${name}${extra ? `&${extra}` : ""}`);
        await page.waitForFunction(() => window.__menuShotReady === true, null, { timeout: READY_TIMEOUT_MS });
        const error = await page.evaluate(() => window.__menuShotError ?? null);
        if (error) throw new Error(error);
        const file = path.join(opts.out, `${name}.png`);
        await page.locator("canvas").screenshot({ path: file });
        console.log(file);
      } catch (e) {
        failed = true;
        console.error(`${scene}: 失敗 ${e instanceof Error ? e.message : e}`);
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
