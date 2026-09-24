import type { Lut } from "../data/tiles";
import { clamp01 } from "./renderMath";

/**
 * バイオームの再配色（docs/ideas/graphics-design.md 5.4）。読み込み時にバイオーム数だけ 1 回作り、
 * atlas に登録する。毎フレームの合成はしない
 */
export function applyLut(src: HTMLCanvasElement, lut: Lut): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = src.width;
  canvas.height = src.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  ctx.drawImage(src, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (!a) continue; // 透明はそのまま
    const [h, s, v] = rgbToHsv(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0);
    const [r, g, b] = hsvToRgb((((h + lut.hue) % 360) + 360) % 360, clamp01(s * lut.sat), clamp01(v * lut.val));
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** r/g/b: 0..255 → h: 0..360, s/v: 0..1 */
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

/** h: 0..360, s/v: 0..1 → r/g/b: 0..255 */
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r0, g0, b0] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r0 + m) * 255), Math.round((g0 + m) * 255), Math.round((b0 + m) * 255)];
}
