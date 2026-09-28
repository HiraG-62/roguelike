// 素材シートから人物のコマ（連結成分）を拾い、外接矩形を出す（確認用）
import { readFileSync } from "node:fs";
import { decodePng } from "../fx/png.mjs";

export const SAMPLE = "docs/example/Graphics/Character/player/sample.png";

export function loadSample() {
  return decodePng(readFileSync(SAMPLE));
}

/** 背景色（四隅の中央値に近い暗い灰色）との差 */
export function bgColor(img) {
  const k = (8 * img.width + 8) * 4;
  return [img.rgba[k], img.rgba[k + 1], img.rgba[k + 2]];
}

export function fgMask(img, thr = 22) {
  const bg = bgColor(img);
  const m = new Uint8Array(img.width * img.height);
  for (let i = 0; i < m.length; i++) {
    const r = img.rgba[i * 4];
    const g = img.rgba[i * 4 + 1];
    const b = img.rgba[i * 4 + 2];
    const d = Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]);
    m[i] = d > thr ? 1 : 0;
  }
  return m;
}

export function components(img, mask, minArea = 400) {
  const { width: W, height: H } = img;
  const lab = new Int32Array(W * H).fill(-1);
  const out = [];
  const stack = [];
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || lab[s] >= 0) continue;
    let x0 = W;
    let y0 = H;
    let x1 = 0;
    let y1 = 0;
    let area = 0;
    lab[s] = out.length;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop();
      const x = p % W;
      const y = (p - x) / W;
      area++;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const q = yy * W + xx;
          if (mask[q] && lab[q] < 0) {
            lab[q] = out.length;
            stack.push(q);
          }
        }
    }
    if (area >= minArea) out.push({ x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, area });
    else out.push(null);
  }
  return out.filter(Boolean);
}

if (process.argv[1]?.endsWith("segment.mjs")) {
  const img = loadSample();
  console.log("bg", bgColor(img));
  const cs = components(img, fgMask(img)).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  for (const c of cs) console.log(`${c.x0},${c.y0} ${c.w}x${c.h} area=${c.area}`);
}
