// ピクセルマップ（文字列の行）と RGBA 画素列の相互変換、拡大して並べる合成
import { decodePng } from "../fx/png.mjs";

export const TRANSPARENT = ".";
const CHANNELS = 4;
/** 透明とみなす α の境（Aseprite の書き出しは 0 / 255 だけだが、編集ソフトの半透明も切り捨てる） */
const ALPHA_OPAQUE_MIN = 128;

export function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** RGBA の画素列を持つ合成用の板 */
export class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.rgba = new Uint8Array(width * height * CHANNELS);
  }

  set(x, y, rgb, alpha = 255) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const o = (y * this.width + x) * CHANNELS;
    this.rgba[o] = rgb[0];
    this.rgba[o + 1] = rgb[1];
    this.rgba[o + 2] = rgb[2];
    this.rgba[o + 3] = alpha;
  }

  /** 既存の色の上に半透明を重ねる（格子線用） */
  blend(x, y, rgb, alpha) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const o = (y * this.width + x) * CHANNELS;
    const t = alpha / 255;
    for (let i = 0; i < 3; i++) this.rgba[o + i] = Math.round(this.rgba[o + i] * (1 - t) + rgb[i] * t);
    this.rgba[o + 3] = Math.max(this.rgba[o + 3], alpha);
  }

  fill(x, y, w, h, rgb, alpha = 255) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, rgb, alpha);
  }

  /** 画素列（RGBA）を整数倍で拡大して置く。透明（α 0）は置かない */
  blitRgba(x, y, src, scale) {
    for (let sy = 0; sy < src.height; sy++) {
      for (let sx = 0; sx < src.width; sx++) {
        const o = (sy * src.width + sx) * CHANNELS;
        const a = src.rgba[o + 3];
        if (a === 0) continue;
        this.fill(x + sx * scale, y + sy * scale, scale, scale, [src.rgba[o], src.rgba[o + 1], src.rgba[o + 2]], a);
      }
    }
  }
}

/** 1 フレーム（行文字列の配列）を RGBA にする。PALETTE に無い文字は例外 */
export function frameToRgba(frame, palette) {
  const height = frame.length;
  const width = frame[0]?.length ?? 0;
  const out = { width, height, rgba: new Uint8Array(width * height * CHANNELS) };
  for (let y = 0; y < height; y++) {
    const row = frame[y] ?? "";
    for (let x = 0; x < width; x++) {
      const ch = row[x] ?? TRANSPARENT;
      if (ch === TRANSPARENT) continue;
      const hex = palette[ch];
      if (!hex) throw new Error(`PALETTE に無い文字 '${ch}'（${x}, ${y}）`);
      const [r, g, b] = hexToRgb(hex);
      const o = (y * width + x) * CHANNELS;
      out.rgba[o] = r;
      out.rgba[o + 1] = g;
      out.rgba[o + 2] = b;
      out.rgba[o + 3] = 255;
    }
  }
  return out;
}

/** 色 → 文字の逆引き表（同じ色が複数の文字にあれば先勝ち） */
export function invertPalette(palette) {
  const map = new Map();
  for (const [ch, hex] of Object.entries(palette)) if (!map.has(hex)) map.set(hex, ch);
  return map;
}

function nearestChar(palette, r, g, b) {
  let best = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const [ch, hex] of Object.entries(palette)) {
    const [pr, pg, pb] = hexToRgb(hex);
    const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = ch;
    }
  }
  return best;
}

/**
 * RGBA の矩形（x, y, w, h）を文字の行に戻す。
 * 戻り値: { rows, unknown }。unknown は PALETTE に無かった色（hex → 画素数）。
 * nearest を立てると無い色を最も近い PALETTE の色に丸める（unknown には元の色を記録する）
 */
export function rgbaToRows(img, x0, y0, w, h, palette, { nearest = false } = {}) {
  const inv = invertPalette(palette);
  const unknown = new Map();
  const rows = [];
  for (let y = 0; y < h; y++) {
    let row = "";
    for (let x = 0; x < w; x++) {
      const o = ((y0 + y) * img.width + (x0 + x)) * CHANNELS;
      const a = img.rgba[o + 3] ?? 0;
      if (a < ALPHA_OPAQUE_MIN) {
        row += TRANSPARENT;
        continue;
      }
      const r = img.rgba[o];
      const g = img.rgba[o + 1];
      const b = img.rgba[o + 2];
      const hex = rgbToHex(r, g, b);
      const ch = inv.get(hex);
      if (ch !== undefined) {
        row += ch;
        continue;
      }
      unknown.set(hex, (unknown.get(hex) ?? 0) + 1);
      row += nearest ? nearestChar(palette, r, g, b) : "?";
    }
    rows.push(row);
  }
  return { rows, unknown };
}

export function loadPng(buf) {
  return decodePng(buf);
}
