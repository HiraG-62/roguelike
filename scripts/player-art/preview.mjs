// 確認用の拡大 PNG: node scripts/player-art/preview.mjs <job> [frames=idle0,walk0,windup,strike] [--styles A,B,C] [--scale 7] [--out file]
import { writeFileSync } from "node:fs";
import { encodePng } from "../fx/png.mjs";
import { drawFrame } from "./draw.mjs";
import { hexToRgb } from "./engine.mjs";
import { JOBS } from "./jobs.mjs";
import { CANVAS, STYLES } from "./styles.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const pos = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const jobKeys = (pos[0] ?? "none").split(",");
const frames = (pos[1] ?? "idle0,walk0,windup,strike").split(",");
const styles = (opt("styles", "A,B,C")).split(",").map((k) => STYLES[k]);
const scale = Number(opt("scale", "6"));
const out = opt("out", "art/player-hires/preview.png");
const crop = { x: 14, y: 8, w: 72, h: 70 };
const FLOOR = "#47424e";

const rows = [];
for (const jk of jobKeys) {
  const job = JOBS.find((j) => j.key === jk);
  for (const s of styles) rows.push(frames.map((f) => drawFrame(s, job, f)));
}
const W = crop.w * scale * frames.length;
const H = crop.h * scale * rows.length;
const rgba = new Uint8Array(W * H * 4);
const bg = hexToRgb(FLOOR);
for (let i = 0; i < W * H; i++) rgba.set([...bg, 255], i * 4);
rows.forEach((row, ry) =>
  row.forEach((px, fx) => {
    for (let y = 0; y < crop.h * scale; y++)
      for (let x = 0; x < crop.w * scale; x++) {
        const c = px[(crop.y + Math.floor(y / scale)) * CANVAS.w + crop.x + Math.floor(x / scale)];
        const k = ((ry * crop.h * scale + y) * W + fx * crop.w * scale + x) * 4;
        if (c) rgba.set([...hexToRgb(c), 255], k);
        else if ((x % (crop.w * scale) === 0) || y % (crop.h * scale) === 0) rgba.set([30, 28, 36, 255], k);
      }
  }),
);
writeFileSync(out, encodePng(W, H, rgba));
console.log(out);
