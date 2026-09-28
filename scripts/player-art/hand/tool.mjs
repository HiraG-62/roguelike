// 手打ちの主人公の道具
//   dump <poseKey> <out.txt>          生成版の 1 コマを文字の格子に落とす（下描き用）
//   render <frames.txt,...> <out.png> [--scale 8] [--grid]  格子を拡大 PNG に（床色の背景）
//   ase <frames.txt,...> <out.aseprite> [--png strip.png]   Aseprite のファイルと横一列 PNG に書き出す
// 格子のファイル: 1 行目 "# <名前> <幅>x<高さ> anchor <x>,<y>"、以降は 1 文字 = 1 色の行
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { encodePng } from "../../fx/png.mjs";
import { buildAseprite } from "../../sprite/aseprite.mjs";
import { drawFrame } from "../draw.mjs";
import { hexToRgb } from "../engine.mjs";
import { JOBS } from "../jobs.mjs";
import { CANVAS, STYLES } from "../styles.mjs";
import { HAND_PALETTE } from "./palette.mjs";

const PAL = Object.entries(HAND_PALETTE).filter(([, v]) => v);

function nearestChar(hex) {
  const c = hexToRgb(hex);
  let best = ".";
  let bd = Infinity;
  for (const [ch, h] of PAL) {
    const p = hexToRgb(h);
    const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2;
    if (d < bd) {
      bd = d;
      best = ch;
    }
  }
  return best;
}

export function readFrame(file) {
  const lines = readFileSync(file, "utf8").replace(/\r/g, "").split("\n");
  const head = lines[0];
  const m = /^# (\S+) (\d+)x(\d+) anchor (\d+),(\d+)/.exec(head);
  if (!m) throw new Error(`${file}: 1 行目の書式が違う`);
  const [, name, w, h, ax, ay] = m;
  const raw = lines.slice(1).filter((l) => l.length > 0 && !l.startsWith("#"));
  const W = Number(w);
  // 手打ちの途中で幅がずれても描けるよう、短い行は右を透明で埋める。長い行は誤りとして知らせる
  const long = raw.map((r, i) => [i + 1, r.length]).filter(([, n]) => n > W);
  if (long.length) throw new Error(`${file}: 幅 ${W} を超える行 ${long.map(([i, n]) => `${i}行目(${n})`).join(", ")}`);
  const rows = raw.map((r) => r.padEnd(W, "."));
  const H = rows.length;
  if (H !== Number(h)) console.warn(`${file}: 見出しの高さ ${h} と行数 ${H} が違う（行数を使う）`);
  rows.forEach((r, i) => {
    for (const ch of r) if (!(ch in HAND_PALETTE)) throw new Error(`${file}: 色に無い文字 '${ch}'（${i + 1} 行目）`);
  });
  return { name, w: W, h: H, ax: Number(ax), ay: Number(ay), rows };
}

function toRgba(frames, scale, bg, grid) {
  // 足元を揃えて横に並べる
  const top = Math.max(...frames.map((f) => f.ay));
  const bottom = Math.max(...frames.map((f) => f.h - f.ay));
  const H = (top + bottom) * scale;
  const W = frames.reduce((a, f) => a + f.w, 0) * scale;
  const rgba = new Uint8Array(W * H * 4);
  const bgc = bg ? hexToRgb(bg) : null;
  if (bgc) for (let i = 0; i < W * H; i++) rgba.set([...bgc, 255], i * 4);
  let ox = 0;
  for (const f of frames) {
    const oy = top - f.ay;
    for (let y = 0; y < f.h; y++)
      for (let x = 0; x < f.w; x++) {
        const hex = HAND_PALETTE[f.rows[y][x]];
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) {
            const X = (ox + x) * scale + dx;
            const Y = (oy + y) * scale + dy;
            const k = (Y * W + X) * 4;
            const onGrid = grid && scale >= 6 && (dx === 0 || dy === 0);
            if (hex) rgba.set([...hexToRgb(hex), 255], k);
            if (onGrid) rgba.set(hex ? [...hexToRgb(hex).map((v) => Math.max(0, v - 18)), 255] : [60, 56, 68, 255], k);
          }
      }
    ox += f.w;
  }
  return { W, H, rgba };
}

// 直接起動したときだけコマンドとして動く（site.mjs から読み込むときは readFrame だけ使う）
const isMain = (process.argv[1] ?? "").split("\\").join("/").endsWith("hand/tool.mjs");
const [cmd, ...rest] = isMain ? process.argv.slice(2) : [];
const opt = (name, def) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : def;
};

if (cmd === "dump") {
  const [poseKey, out] = rest;
  const job = JOBS.find((j) => j.key === "base");
  const px = drawFrame(STYLES.S, job, poseKey, { weapon: !rest.includes("--no-weapon") });
  // 人物のある範囲だけ切る（左右に 3 の余白）
  let x0 = CANVAS.w;
  let x1 = 0;
  let y0 = CANVAS.h;
  for (let y = 0; y < CANVAS.h; y++)
    for (let x = 0; x < CANVAS.w; x++)
      if (px[y * CANVAS.w + x]) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
      }
  x0 = Math.max(0, x0 - 3);
  x1 = Math.min(CANVAS.w - 1, x1 + 3);
  y0 = Math.max(0, y0 - 3);
  const rows = [];
  for (let y = y0; y < CANVAS.h; y++) {
    let r = "";
    for (let x = x0; x <= x1; x++) {
      const c = px[y * CANVAS.w + x];
      r += c ? nearestChar(c) : ".";
    }
    rows.push(r);
  }
  const text = `# ${poseKey} ${x1 - x0 + 1}x${rows.length} anchor ${CANVAS.anchorX - x0},${CANVAS.ground - y0}\n${rows.join("\n")}\n`;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  console.log(out);
} else if (cmd === "render") {
  const [list, out] = rest;
  const frames = list.split(",").map(readFrame);
  const { W, H, rgba } = toRgba(frames, Number(opt("scale", "8")), opt("bg", "#47424e"), rest.includes("--grid"));
  writeFileSync(out, encodePng(W, H, rgba));
  console.log(out);
} else if (cmd === "ase") {
  const [list, out] = rest;
  const frames = list.split(",").map(readFrame);
  // Aseprite は同じ寸法のフレームを並べるので、最大の寸法に足元を揃えて置き直す
  const top = Math.max(...frames.map((f) => f.ay));
  const bottom = Math.max(...frames.map((f) => f.h - f.ay));
  const left = Math.max(...frames.map((f) => f.ax));
  const right = Math.max(...frames.map((f) => f.w - f.ax));
  const fw = left + right;
  const fh = top + bottom;
  const W = fw * frames.length;
  const rgba = new Uint8Array(W * fh * 4);
  frames.forEach((f, i) => {
    const ox = i * fw + left - f.ax;
    const oy = top - f.ay;
    for (let y = 0; y < f.h; y++)
      for (let x = 0; x < f.w; x++) {
        const hex = HAND_PALETTE[f.rows[y][x]];
        if (hex) rgba.set([...hexToRgb(hex), 255], ((oy + y) * W + ox + x) * 4);
      }
  });
  const strip = opt("png", out.replace(/\.aseprite$/, ".png"));
  writeFileSync(strip, encodePng(W, fh, rgba));
  const gpl = out.replace(/\.aseprite$/, ".gpl");
  writeFileSync(gpl, `GIMP Palette\nName: player-hand\nColumns: 8\n#\n${PAL.map(([ch, h]) => `${hexToRgb(h).join(" ")}\t${ch}`).join("\n")}\n`);
  buildAseprite({ strip, frameW: fw, frameH: fh, gpl, out });
  console.log(`${out}（${frames.length} コマ、${fw}x${fh}）/ ${strip}`);
} else if (isMain) {
  console.log("dump | render | ase");
}
