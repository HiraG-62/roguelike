// 素材の一部を方眼つきで拡大する（関節の位置の読み取り用）
// node scripts/player-art/crop.mjs <x0> <y0> <w> <h> <scale> <out> [grid=10]
import { readFileSync, writeFileSync } from "node:fs";
import { decodePng, encodePng } from "../fx/png.mjs";

const a = process.argv.slice(2);
const [x0, y0, w, h, scale] = a.slice(0, 5).map(Number);
const out = a[5];
const grid = Number(a[6] ?? 10);
const src = decodePng(readFileSync("docs/example/Graphics/Character/player/sample.png"));
const W = w * scale;
const H = h * scale;
const o = new Uint8Array(W * H * 4);
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const sx = x0 + Math.floor(x / scale);
    const sy = y0 + Math.floor(y / scale);
    const k = (sy * src.width + sx) * 4;
    o.set(src.rgba.subarray(k, k + 4), (y * W + x) * 4);
    if (!grid) continue;
    const lx = (sx - x0) % grid === 0 && x % scale === 0;
    const ly = (sy - y0) % grid === 0 && y % scale === 0;
    if (lx || ly) {
      const major = (lx && (sx - x0) % (grid * 5) === 0) || (ly && (sy - y0) % (grid * 5) === 0);
      o.set(major ? [90, 200, 255, 255] : [60, 110, 150, 255], (y * W + x) * 4);
    }
  }
writeFileSync(out, encodePng(W, H, o));
console.log(out);
