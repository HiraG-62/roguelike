/**
 * 一瞬の固まり（ヒッチ）の計測。`pnpm run hitch:probe`。
 * tools/hitch-probe.html（src/tools/hitchProbe.ts）を Chromium で開き、bot に実時間で遊ばせて、
 * step・効果音・描画の合計が閾値を超えたフレームを、そのフレームで初めて作った canvas・getImageData・初めて鳴った音・
 * 初めて画面に入った敵と並べて出す。
 *
 *   pnpm run hitch:probe                                  深度 1・seed 1・3600 フレーム（60 秒）
 *   ppnpm run hitch:probe --seed 7 --depth 6            seed と開始の深度
 *   ppnpm run hitch:probe --frames 1800 --threshold 12  フレーム数と閾値（ms）
 *   ppnpm run hitch:probe --methods                     Renderer のメソッドごとの自己時間（上位 6）も出す
 *   ppnpm run hitch:probe --headed                      窓を出して様子を見る（既定は窓を出さない）
 *
 * 窓を出さなくても、Windows では GPU で描く（--use-angle=d3d11。指定しないと headless はソフトウェア描画になり、
 * GPU からの読み戻しのような実機の重さが出ない）。GPU の無い環境ではソフトウェア描画に落ちる
 */
import { ensureVite, findPlaywright } from "./browser-tools.mjs";

const PORT = 5199;
const BASE = `http://localhost:${PORT}`;
const VIEWPORT = { width: 1920, height: 1080 };
/** 60 秒ぶんを実時間で回すので長めに待つ */
const RUN_TIMEOUT_MS = 900_000;
/** 窓を出さずに GPU で描かせる起動オプション（Windows の D3D11） */
const GPU_ARGS = process.platform === "win32" ? ["--enable-gpu", "--use-angle=d3d11", "--ignore-gpu-blocklist"] : [];

function parseArgs(argv) {
  const opts = { seed: 1, depth: 1, frames: 3600, threshold: 16, methods: false, headed: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const num = () => Number(argv[++i]);
    if (a === "--seed") opts.seed = num();
    else if (a === "--depth") opts.depth = num();
    else if (a === "--frames") opts.frames = num();
    else if (a === "--threshold") opts.threshold = num();
    else if (a === "--methods") opts.methods = true;
    else if (a === "--headed") opts.headed = true;
    else {
      console.error(`未知の引数: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

function formatFrame(f) {
  const head = `#${f.frame} 深度${f.depth} step ${f.stepMs.toFixed(1)} 音 ${f.sfxMs.toFixed(1)} 描画 ${f.renderMs.toFixed(1)} 間隔 ${f.gapMs.toFixed(0)}ms`;
  const made = `canvas ${f.canvases} / getImageData ${f.getImageData}（${f.getImageDataMs.toFixed(1)}ms）/ decode ${f.decodes}`;
  const firsts = [
    f.firstSfx.length > 0 ? `初の音 ${f.firstSfx.join(",")}` : "",
    f.firstEnemies.length > 0 ? `初の敵 ${f.firstEnemies.join(",")}` : "",
  ].filter(Boolean);
  const lines = [head, `    ${made}${firsts.length > 0 ? ` | ${firsts.join(" | ")}` : ""}`];
  if (Object.keys(f.sources).length > 0) lines.push(`    出どころ ${JSON.stringify(f.sources)}`);
  if (Object.keys(f.methods).length > 0) lines.push(`    メソッド ${JSON.stringify(f.methods)}`);
  return lines.join("\n");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { chromium } = findPlaywright();
  const query = `seed=${opts.seed}&depth=${opts.depth}&frames=${opts.frames}&threshold=${opts.threshold}${opts.methods ? "&methods=1" : ""}`;
  const vite = await ensureVite(PORT, `${BASE}/tools/hitch-probe.html`);
  const browser = await chromium.launch({ headless: !opts.headed, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required", ...GPU_ARGS] });
  try {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    page.on("pageerror", (e) => console.error(`[page] ${e.message}`));
    await page.goto(`${BASE}/tools/hitch-probe.html?${query}`);
    await page.waitForFunction(() => window.__hitch || window.__hitchError, null, { timeout: RUN_TIMEOUT_MS });
    const error = await page.evaluate(() => window.__hitchError ?? null);
    if (error) throw new Error(error);
    const r = await page.evaluate(() => window.__hitch);
    const gpu = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl");
      const info = gl?.getExtension("WEBGL_debug_renderer_info");
      return info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "不明";
    });
    console.log(`描画: ${gpu}`);
    console.log(`${r.frames} フレーム・平均 ${r.avgMs.toFixed(2)}ms・${opts.threshold}ms 以上 ${r.long.length} 回`);
    console.log(`作った canvas ${r.totals.canvases}・getImageData ${r.totals.getImageData}・decode ${r.totals.decodes}`);
    console.log(`出どころの合計 ${JSON.stringify(r.sources)}`);
    for (const f of r.long) console.log(formatFrame(f));
  } finally {
    await browser.close();
    vite.stop();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
