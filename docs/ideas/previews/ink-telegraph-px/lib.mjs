// サンプル作成の共通部品（作業用）
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
export const ROOT = "/home/user/roguelike/";
const R = ROOT + "scripts/fx/";
export const { Frame, cleanup, paint, hash2, valueNoise, clamp01, segment } = await import(R + "raster.mjs");
export const { inkify } = await import(R + "ink.mjs");
const { fitAtlas } = await import(R + "fit.mjs");
export const { encodePng, decodePng } = await import(R + "png.mjs");
export const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const RAMPS = JSON.parse(readFileSync(ROOT + "src/data/fxRamps.json", "utf8"));
const atlases = {};
async function atlasOf(k) {
  if (!atlases[k]) {
    const a = (await import(pathToFileURL(R + "sheets/" + k + ".mjs").href)).ATLAS;
    atlases[k] = { a, fit: fitAtlas(ROOT, a) };
  }
  return atlases[k];
}
function keySeed(k) { let h = 0x811c9dc5; for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 0x01000193); return h >>> 0; }
export async function fxFrame(atlasKey, key, dir, f) {
  const { a, fit } = await atlasOf(atlasKey);
  const sheet = a.sheets.find((s) => s.key === key);
  const d = dir % sheet.dirs;
  const ang = (d / sheet.dirs) * Math.PI * 2;
  const fr = new Frame(sheet.size, sheet.size, ang, fit.sheets.get(key));
  sheet.draw(fr, f, { dir: d, angle: ang });
  cleanup(fr);
  inkify(fr, keySeed(key) ^ Math.imul(d + 1, 0x9e3779b1), Math.imul(f + 1, 0x85ebca6b));
  return fr;
}
/** 画面（1920x1080、論理 1px = 4 画素、絵の 1 ドット = 2 画素） */
export class Canvas {
  constructor(bg) { this.w = bg.width; this.h = bg.height; this.px = new Uint8Array(bg.rgba); }
  blend(x, y, c, a) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 4;
    for (let k = 0; k < 3; k++) this.px[o + k] = Math.round(this.px[o + k] * (1 - a) + c[k] * a);
  }
  dot(dx, dy, c, a = 1) { for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) this.blend(dx * 2 + sx, dy * 2 + sy, c, a); }
  copy(sx, sy, w, h, tx, ty) {
    const tmp = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = ((sy + y) * this.w + sx + x) * 4; tmp.set(this.px.subarray(o, o + 4), (y * w + x) * 4); }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = ((ty + y) * this.w + tx + x) * 4; if (tx + x < this.w && ty + y < this.h) this.px.set(tmp.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), o); }
  }
  /** 段の格子を ramp で置く。ox, oy は格子の (0,0) の絵のドット座標 */
  frame(fr, ox, oy, ramp, halo, alpha = 1) {
    if (halo) {
      const hc = hex(halo.color);
      for (let y = 0; y < fr.h; y++) for (let x = 0; x < fr.w; x++) {
        if (fr.get(x, y)) continue;
        let best = 99;
        for (let dy = -halo.r; dy <= halo.r; dy++) for (let dx = -halo.r; dx <= halo.r; dx++) {
          const d2 = dx * dx + dy * dy;
          if (d2 <= halo.r * halo.r + 1 && d2 < best && fr.get(x + dx, y + dy)) best = d2;
        }
        if (best === 99) continue;
        const a = halo.flat ? halo.alpha : halo.alpha * (1 - (Math.sqrt(best) - 1) / (halo.r + 0.5));
        this.dot(ox + x, oy + y, hc, a);
      }
    }
    for (let y = 0; y < fr.h; y++) for (let x = 0; x < fr.w; x++) {
      const l = fr.get(x, y); if (!l) continue;
      this.dot(ox + x, oy + y, hex(ramp[l - 1]), alpha);
    }
  }
  /** 中心 (cx, cy)（絵のドット）に置く FX のフレーム */
  fx(fr, cx, cy, ramp, halo) { this.frame(fr, Math.round(cx - fr.cx), Math.round(cy - fr.cy), ramp, halo); }
  /** (x0,y0) から w x h を z 倍に拡大した新しい画像 */
  zoom(x0, y0, w, h, z) {
    const out = new Uint8Array(w * z * h * z * 4);
    for (let y = 0; y < h * z; y++) for (let x = 0; x < w * z; x++) {
      const s = ((y0 + Math.floor(y / z)) * this.w + x0 + Math.floor(x / z)) * 4;
      out.set(this.px.subarray(s, s + 4), (y * w * z + x) * 4);
    }
    return { w: w * z, h: h * z, px: out };
  }
}
/** 画像を縦横に並べる */
export function tile(rows) {
  const W = Math.max(...rows.map((r) => r.reduce((s, i) => s + i.w, 0)));
  const H = rows.reduce((s, r) => s + Math.max(...r.map((i) => i.h)), 0);
  const out = new Uint8Array(W * H * 4);
  let oy = 0;
  for (const r of rows) {
    let ox = 0;
    for (const im of r) {
      for (let y = 0; y < im.h; y++) out.set(im.px.subarray(y * im.w * 4, (y + 1) * im.w * 4), ((oy + y) * W + ox) * 4);
      ox += im.w;
    }
    oy += Math.max(...r.map((i) => i.h));
  }
  return { w: W, h: H, px: out };
}
