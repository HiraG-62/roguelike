// frames.json（抜き出したコマ）を拡大して並べる: node scripts/player-art/view.mjs <json> <keys> <scale> <out>
import { readFileSync, writeFileSync } from "node:fs";
import { encodePng } from "../fx/png.mjs";
import { hexToRgb } from "./engine.mjs";
const [, , file, keys, sc, out] = process.argv;
const data = JSON.parse(readFileSync(file, "utf8"));
const want = keys === "all" ? data.frames.map((f) => f.key) : keys.split(",");
const frames = want.map((k) => data.frames.find((f) => f.key === k));
const scale = Number(sc);
const { w, h } = data.canvas;
const crop = { x: 8, y: 6, w: 80, h: 72 };
const W = crop.w * scale * frames.length;
const H = crop.h * scale;
const rgba = new Uint8Array(W * H * 4);
const fl = hexToRgb("#47424e");
for (let i = 0; i < W * H; i++) rgba.set([...fl, 255], i * 4);
frames.forEach((f, i) => {
  for (let y = 0; y < H; y++)
    for (let x = 0; x < crop.w * scale; x++) {
      const c = f.px[(crop.y + Math.floor(y / scale)) * w + crop.x + Math.floor(x / scale)];
      const k = (y * W + i * crop.w * scale + x) * 4;
      if (c) rgba.set([...hexToRgb(c), 255], k);
      else if (x === 0) rgba.set([30, 28, 36, 255], k);
    }
});
writeFileSync(out, encodePng(W, H, rgba));
console.log(out);
