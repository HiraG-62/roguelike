// 比較サイトを組む: 3 案 × ジョブの帯（PNG）と、今のプレイヤー・敵・床の参考絵を埋め込んだ 1 枚の HTML を書く。
// node scripts/player-art/site.mjs [--out art/player-hires/site/index.html]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "../fx/png.mjs";
import { loadSprites } from "../sprite/load.mjs";
import { frameToRgba } from "../sprite/raster.mjs";
import { drawFrame } from "./draw.mjs";
import { loadSample } from "./segment.mjs";
import { hexToRgb } from "./engine.mjs";
import { JOBS } from "./jobs.mjs";
import { ACTIONS, FRAME_ORDER } from "./rig.mjs";
import { CANVAS, STYLES } from "./styles.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const out = outIdx >= 0 ? args[outIdx + 1] : "art/player-hires/site/index.html";

const dataUri = (w, h, rgba) => `data:image/png;base64,${encodePng(w, h, rgba).toString("base64")}`;

/** 画素列（色 | null）の配列を横一列の帯にする */
function strip(frames, w, h) {
  const W = w * frames.length;
  const rgba = new Uint8Array(W * h * 4);
  frames.forEach((px, f) => {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = px[y * w + x];
        if (!c) continue;
        rgba.set([...hexToRgb(c), 255], (y * W + f * w + x) * 4);
      }
  });
  return dataUri(W, h, rgba);
}

const art = { canvas: CANVAS, frames: FRAME_ORDER, actions: ACTIONS.map((a) => ({ ...a, idx: a.frames.map((f) => FRAME_ORDER.indexOf(f)) })), styles: [], jobs: [], sheets: {}, ref: {} };
// 素材ベースの主人公だけを描く
const FOCUS = [STYLES.S];
const FOCUS_JOBS = JOBS.filter((j) => j.key === "base");
for (const s of FOCUS) {
  const fig = s.fig;
  const height = fig.headRy * 2 + fig.neck + fig.torso + fig.pelvis + fig.thigh + fig.shin + fig.footR * 1.6;
  art.styles.push({ key: s.key, name: "素材ベースの描き直し", tagline: "素材の主人公を 2 倍密度の格子で描き直し、10 姿勢を同じ骨組みで動かしたもの", frames: FRAME_ORDER.length, heads: +(height / (fig.headRy * 2)).toFixed(1), heightDots: Math.round(height) });
}
for (const j of FOCUS_JOBS) art.jobs.push({ key: j.key, name: j.name, concept: j.concept });
for (const s of FOCUS) {
  for (const j of FOCUS_JOBS) {
    const withW = FRAME_ORDER.map((f) => drawFrame(s, j, f));
    const body = FRAME_ORDER.map((f) => drawFrame(s, j, f, { weapon: false }));
    art.sheets[`${s.key}.${j.key}`] = { weapon: strip(withW, CANVAS.w, CANVAS.h), body: strip(body, CANVAS.w, CANVAS.h) };
  }
}

// 手打ちの版（art/player-hand/<姿勢>.txt）。まだ描いていない姿勢は空のコマ
{
  const HAND_DIR = "art/player-hand";
  const FALLBACK = { idle1: "idle0" };
  const { readFrame } = await import("./hand/tool.mjs");
  const { HAND_PALETTE } = await import("./hand/palette.mjs");
  const drawn = [];
  const frames = FRAME_ORDER.map((key) => {
    const file = [key, FALLBACK[key]].map((k) => k && `${HAND_DIR}/${k}.txt`).find((f) => f && existsSync(f));
    const px = new Array(CANVAS.w * CANVAS.h).fill(null);
    if (!file) return px;
    drawn.push(key);
    const f = readFrame(file);
    const ox = CANVAS.anchorX - f.ax;
    const oy = CANVAS.ground - 1 - f.ay;
    for (let y = 0; y < f.h; y++)
      for (let x = 0; x < f.w; x++) {
        const c = HAND_PALETTE[f.rows[y][x]];
        const X = ox + x;
        const Y = oy + y;
        if (c && X >= 0 && Y >= 0 && X < CANVAS.w && Y < CANVAS.h) px[Y * CANVAS.w + X] = c;
      }
    return px;
  });
  if (drawn.length) {
    const s = strip(frames, CANVAS.w, CANVAS.h);
    art.styles.push({ key: "H", name: "手打ち", tagline: `1 ドットずつ手で打った版。いまは ${drawn.includes("walk0") ? "待機と歩き" : "待機"}だけ（ほかの動きは空）`, frames: drawn.length, heads: 5.9, heightDots: 59 });
    art.sheets["H.base"] = { weapon: s, body: s };
  }
}

// 素材の右向きの絵（待機 1 + 歩き 5）を切り出して横一列に
const sample = loadSample();
const SAMPLE_CROPS = [
  [496, 90, 96, 232],
  [758, 368, 72, 98],
  [845, 367, 80, 99],
  [946, 367, 74, 99],
  [1039, 367, 76, 101],
  [1135, 367, 70, 99],
];
{
  const W = SAMPLE_CROPS.reduce((a, c) => a + c[2], 0);
  const H = Math.max(...SAMPLE_CROPS.map((c) => c[3]));
  const rgba = new Uint8Array(W * H * 4);
  const rects = [];
  let ox = 0;
  for (const [x0, y0, w, h] of SAMPLE_CROPS) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = ((y0 + y) * sample.width + x0 + x) * 4;
      rgba.set(sample.rgba.subarray(k, k + 4), (y * W + ox + x) * 4);
    }
    rects.push({ x: ox, y: 0, w, h });
    ox += w;
  }
  art.ref.sample = { src: dataUri(W, H, rgba), rects };
}

// 参考: 今のゲームの絵（論理 1px = 1 ドット）
const { PALETTE, SPRITES } = await loadSprites();
const refStrip = (frames) => {
  const w = frames[0][0].length;
  const h = frames[0].length;
  const W = w * frames.length;
  const rgba = new Uint8Array(W * h * 4);
  frames.forEach((fr, i) => {
    const one = frameToRgba(fr, PALETTE);
    for (let y = 0; y < h; y++) rgba.set(one.rgba.subarray(y * w * 4, (y + 1) * w * 4), (y * W + i * w) * 4);
  });
  return { src: dataUri(W, h, rgba), w, h, n: frames.length };
};
const pick = (k) => SPRITES[k] ?? [];
art.ref.player = refStrip([...pick("player").slice(0, 1), ...pick("player").slice(0, 1), ...pick("player"), ...pick("player.windup"), ...pick("player.strike")]);
for (const k of ["slime", "knight", "skeleton", "wolf"]) if (SPRITES[k]) art.ref[k] = refStrip(SPRITES[k]);
art.ref.floor = refStrip(SPRITES.floor);

const tpl = readFileSync(join(HERE, "site.template.html"), "utf8");
const html = tpl.replace("/*__ART__*/null", JSON.stringify(art));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`${out}（${(html.length / 1024).toFixed(0)} KB）`);
