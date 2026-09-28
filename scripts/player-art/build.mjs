// 3 案 × ジョブ × 姿勢を描き、確認用の一覧 PNG と比較サイト用の JSON を書く。
// node scripts/player-art/build.mjs [--jobs none,swordsman] [--styles A,B] [--scale 3] [--out <dir>]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodePng } from "../fx/png.mjs";
import { hexToRgb } from "./engine.mjs";
import { drawFrame } from "./draw.mjs";
import { JOBS } from "./jobs.mjs";
import { FRAME_ORDER } from "./rig.mjs";
import { CANVAS, STYLES } from "./styles.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const jobFilter = opt("jobs", null)?.split(",");
const styleFilter = opt("styles", null)?.split(",");
const scale = Number(opt("scale", "3"));
const outDir = opt("out", "art/player-hires");
const noWeapon = args.includes("--no-weapon");
mkdirSync(outDir, { recursive: true });

const FLOOR = "#47424e";
const { w, h } = CANVAS;


const styles = Object.values(STYLES).filter((s) => !styleFilter || styleFilter.includes(s.key));
const jobs = JOBS.filter((j) => !jobFilter || jobFilter.includes(j.key));

/** パレット圧縮: 色を表に、画素を添字に */
function pack(frames) {
  const colors = [];
  const index = new Map();
  const data = frames.map((px) =>
    px
      .map((c) => {
        if (!c) return 0;
        if (!index.has(c)) {
          index.set(c, colors.length + 1);
          colors.push(c);
        }
        return index.get(c);
      })
      .map((i) => i.toString(36).padStart(1, "0")),
  );
  return { colors, data };
}

const json = { canvas: CANVAS, frames: FRAME_ORDER, styles: {}, jobs: jobs.map(({ key, name, concept }) => ({ key, name, concept })) };
for (const style of styles) {
  json.styles[style.key] = { name: style.name, tagline: style.tagline, jobs: {} };
  // 一覧 PNG: 行 = ジョブ、列 = 姿勢
  const cellW = w * scale;
  const cellH = h * scale;
  const sheetW = cellW * FRAME_ORDER.length;
  const sheetH = cellH * jobs.length;
  const rgba = new Uint8Array(sheetW * sheetH * 4);
  const bg = hexToRgb(FLOOR);
  for (let i = 0; i < sheetW * sheetH; i++) rgba.set([...bg, 255], i * 4);
  jobs.forEach((job, jy) => {
    const frames = FRAME_ORDER.map((pk) => drawFrame(style, job, pk, { weapon: !noWeapon }));
    const bodyOnly = FRAME_ORDER.map((pk) => drawFrame(style, job, pk, { weapon: false }));
    json.styles[style.key].jobs[job.key] = { withWeapon: pack(frames), body: pack(bodyOnly) };
    frames.forEach((px, fx) => {
      for (let y = 0; y < cellH; y++) {
        for (let x = 0; x < cellW; x++) {
          const c = px[Math.floor(y / scale) * w + Math.floor(x / scale)];
          if (!c) continue;
          const k = ((jy * cellH + y) * sheetW + fx * cellW + x) * 4;
          rgba.set([...hexToRgb(c), 255], k);
        }
      }
    });
  });
  writeFileSync(join(outDir, `sheet-${style.key}.png`), encodePng(sheetW, sheetH, rgba));
}
writeFileSync(join(outDir, "data.json"), JSON.stringify(json));
console.log(`書き出し: ${outDir}（${styles.length} 案 × ${jobs.length} ジョブ × ${FRAME_ORDER.length} 姿勢）`);
