/**
 * 読み込み画面「絵巻」の紙と山水の画素列（docs/ideas/loading-screen.md）。DOM に触らない純関数で、同じ引数なら同じ絵。
 * 墨の量（0..1）を層ごとに重ね、淡墨〜濃墨の 6 段と 4x4 の順序ディザで和紙へ落とす。
 * 章の様式（MapStyle）で中景の建物、階の種類（FloorKind）で手前の添え物を描き分ける
 */
import type { FloorKind } from "../core/state";
import { h32, hf, pack, vnoise } from "./mapNoise";
import type { MapStyle } from "./mapTypes";

/** 巻物の紙の大きさ（絵のドット = 論理 0.5px）。上下の表装の帯を含む */
export const SCROLL_W = 662;
export const SCROLL_H = 288;
/** 上下の表装の帯の高さ（ドット） */
export const SCROLL_BAND = 16;
/** 墨の段の数（淡墨〜濃墨） */
export const SCROLL_INK_LEVELS = 6;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const WASHI = [221, 211, 190] as const;
const INK = [11, 10, 13] as const;
const BROCADE = [29, 34, 56] as const;
const GOLD = [200, 160, 80] as const;
/** 墨の線の濃さ（輪郭）と面の濃さ */
const RIM_INK = 0.95;

export interface ScrollArtInput {
  style: MapStyle;
  /** 階の種類（拠点などは null = 添え物なし） */
  floorKind: FloorKind | null;
  seed: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** 周期 period の 4 オクターブの雑音（0..1） */
function fbm(x: number, y: number, period: number, seed: number, octaves = 4): number {
  let total = 0;
  let amp = 0.5;
  let p = period;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    total += vnoise(x, y, p, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    p /= 2;
  }
  return total / norm;
}

/** 墨の量の作業面（絵の範囲だけ） */
class InkField {
  readonly v = new Float32Array(SCROLL_W * SCROLL_H);
  max(x: number, y: number, v: number): void {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < SCROLL_BAND || xi >= SCROLL_W || yi >= SCROLL_H - SCROLL_BAND) return;
    const i = yi * SCROLL_W + xi;
    if (v > (this.v[i] ?? 0)) this.v[i] = v;
  }
  /** 白く抜く（雪・月）。v 以下に下げる */
  lift(x: number, y: number, v: number): void {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= SCROLL_W || yi >= SCROLL_H) return;
    const i = yi * SCROLL_W + xi;
    if ((this.v[i] ?? 0) > v) this.v[i] = v;
  }
  /** 太さ w の筆の線（端は細る） */
  line(x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, v: number): void {
    const len = Math.max(1, Math.hypot(x1 - x0, y1 - y0));
    for (let s = 0; s <= len; s += 0.5) {
      const t = s / len;
      const w = w0 + (w1 - w0) * t;
      const cx = x0 + (x1 - x0) * t;
      const cy = y0 + (y1 - y0) * t;
      const r = w / 2;
      for (let dy = -r; dy <= r; dy += 0.5) for (let dx = -r; dx <= r; dx += 0.5) if (dx * dx + dy * dy <= r * r) this.max(cx + dx, cy + dy, v);
    }
  }
  rect(x0: number, y0: number, x1: number, y1: number, v: number): void {
    for (let y = Math.round(y0); y < y1; y++) for (let x = Math.round(x0); x < x1; x++) this.max(x, y, v);
  }
  /** 底辺 bottom、上辺の幅 top（台形）。反りは両端を上げる */
  roof(cx: number, y: number, halfW: number, h: number, curl: number, v: number): void {
    for (let dy = 0; dy < h; dy++) {
      const t = dy / Math.max(1, h - 1);
      const half = halfW * (0.35 + 0.65 * t);
      for (let dx = -half; dx <= half; dx += 1) {
        const lift = curl * Math.pow(Math.abs(dx) / halfW, 3);
        this.max(cx + dx, y + dy - lift, v);
      }
    }
  }
}

/** 遠山・中景の稜線（列ごと） */
function ridge(x: number, base: number, amp: number, period: number, seed: number): number {
  return base - fbm(x, 0, period, seed) * amp;
}

function paintMountains(f: InkField, seed: number, snow: boolean): { mid: Float32Array } {
  const top = SCROLL_BAND;
  const bottom = SCROLL_H - SCROLL_BAND;
  const mid = new Float32Array(SCROLL_W);
  for (let x = 0; x < SCROLL_W; x++) {
    const far = ridge(x, top + 118, 86, 160, seed + 1);
    const m = ridge(x, top + 166, 96, 90, seed + 2);
    mid[x] = m;
    for (let y = top; y < bottom; y++) {
      let v = 0;
      if (y > far) v = Math.max(v, 0.2 * Math.exp(-(y - far) / 46) + (y - far < 3 ? 0.18 : 0));
      if (y > m) v = Math.max(v, 0.42 * Math.exp(-(y - m) / 40) + (y - m < 3 ? 0.3 : 0));
      // 霞の帯
      const mist = smooth(0.42, 0.62, fbm(x, y * 4, 100, seed + 3, 2)) * smooth(top + 150, top + 180, y) * (1 - smooth(top + 200, top + 220, y));
      v *= 1 - mist * 0.85;
      // 雪: 稜線のすぐ下は白く残す
      if (snow && ((y > far && y - far < 9 + hf(x, 0, seed) * 6) || (y > m && y - m < 7 + hf(x, 1, seed) * 5))) v *= 0.15;
      f.max(x, y, v);
    }
  }
  return { mid };
}

/** 両脇の崖（真ん中は低い）。輪郭は濃く、内は淡い面に疎らな皴 */
function paintCliffs(f: InkField, seed: number, snow: boolean): Float32Array {
  const bottom = SCROLL_H - SCROLL_BAND;
  const center = SCROLL_W * 0.48;
  const edge = new Float32Array(SCROLL_W);
  for (let x = 0; x < SCROLL_W; x++) {
    const side = smooth(60, 300, Math.abs(x - center));
    const nearTop = SCROLL_BAND + 240 - fbm(x, 0, 64, seed + 4) * 50 - side * 150;
    edge[x] = nearTop;
    for (let y = Math.max(SCROLL_BAND, Math.floor(nearTop)); y < bottom; y++) {
      const depth = y - nearTop;
      const face = 0.32 + fbm(x, y, 32, seed + 5, 3) * 0.3;
      const crack = smooth(0.66, 0.72, vnoise(x * 1.1 + y * 0.6, y * 0.3, 10, seed + 6)) * 0.3;
      let v = depth < 4 ? RIM_INK : Math.min(1, face + crack + depth / 400);
      if (snow && depth >= 4 && depth < 10) v *= 0.2;
      f.max(x, y, v);
    }
  }
  return edge;
}

function paintPagoda(f: InkField, cx: number, base: number): void {
  const tiers = 5;
  let y = base;
  for (let i = 0; i < tiers; i++) {
    const half = 30 - i * 4;
    f.rect(cx - half * 0.55, y - 12, cx + half * 0.55, y, 0.62);
    f.roof(cx, y - 18, half, 6, 4, 0.78);
    y -= 18;
  }
  f.line(cx, y, cx, y - 26, 2, 1, 0.8);
  for (let k = 0; k < 4; k++) f.line(cx - 4, y - 6 - k * 5, cx + 4, y - 6 - k * 5, 1, 1, 0.8);
}

function paintCastle(f: InkField, cx: number, base: number, snow: boolean): void {
  // 石垣（裾広がり）
  for (let dy = 0; dy < 26; dy++) {
    const half = 54 - dy * 0.6 + Math.pow(dy / 26, 2) * 8;
    for (let dx = -half; dx <= half; dx++) f.max(cx + dx, base - dy, 0.55 + ((dx + dy * 3) % 9 === 0 ? 0.25 : 0));
  }
  let y = base - 26;
  const tiers = [44, 34, 24];
  tiers.forEach((half, i) => {
    f.rect(cx - half * 0.8, y - 16, cx + half * 0.8, y, 0.5);
    for (let wx = -half * 0.6; wx <= half * 0.6; wx += 10) f.rect(cx + wx, y - 11, cx + wx + 4, y - 6, 0.9);
    f.roof(cx, y - 24, half, 8, 6, 0.85);
    if (snow) for (let dx = -half * 0.4; dx <= half * 0.4; dx++) f.lift(cx + dx, y - 25, 0);
    y -= 24;
    void i;
  });
  // 鯱
  f.line(cx - 10, y + 2, cx - 13, y - 6, 2, 1, 0.9);
  f.line(cx + 10, y + 2, cx + 13, y - 6, 2, 1, 0.9);
}

function paintTorii(f: InkField, cx: number, base: number, scale: number, v: number): void {
  const h = 70 * scale;
  const half = 30 * scale;
  f.line(cx - half * 0.7, base, cx - half * 0.62, base - h, 5 * scale, 4 * scale, v);
  f.line(cx + half * 0.7, base, cx + half * 0.62, base - h, 5 * scale, 4 * scale, v);
  f.line(cx - half * 0.8, base - h * 0.72, cx + half * 0.8, base - h * 0.72, 3 * scale, 3 * scale, v);
  f.roof(cx, base - h - 8 * scale, half * 1.2, 6 * scale, 6 * scale, v);
}

function paintPine(f: InkField, x: number, base: number, h: number, seed: number): void {
  const lean = (hf(x, 0, seed) - 0.5) * 20;
  f.line(x, base, x + lean, base - h, 7, 3, 0.9);
  for (let k = 0; k < 4; k++) {
    const t = 0.4 + k * 0.17;
    const bx = x + lean * t;
    const by = base - h * t;
    const len = 40 - k * 7;
    const dir = k % 2 === 0 ? 1 : -1;
    f.line(bx, by, bx + dir * len, by - 5, 3, 1, 0.85);
    // 葉の塊（横に平たい楕円を、縁を濃く内を淡く点描）
    const fx = bx + dir * len * 0.65;
    const fy = by - 8;
    const rx = 26 - k * 3;
    const ry = 8;
    for (let i = 0; i < 420; i++) {
      const a = hf(i, k, seed + x) * Math.PI * 2;
      const r = Math.sqrt(hf(i, k + 9, seed + x));
      f.max(fx + Math.cos(a) * r * rx, fy + Math.sin(a) * r * ry, r > 0.75 ? 0.9 : 0.55);
    }
  }
}

function paintDeadTree(f: InkField, x: number, base: number, h: number, seed: number): void {
  const branch = (x0: number, y0: number, ang: number, len: number, w: number, depth: number): void => {
    const x1 = x0 + Math.cos(ang) * len;
    const y1 = y0 + Math.sin(ang) * len;
    f.line(x0, y0, x1, y1, w, Math.max(1, w * 0.6), 0.9);
    if (depth <= 0) return;
    const spread = 0.5 + hf(Math.round(x1), Math.round(y1), seed) * 0.4;
    branch(x1, y1, ang - spread, len * 0.68, w * 0.62, depth - 1);
    branch(x1, y1, ang + spread * 0.8, len * 0.62, w * 0.58, depth - 1);
  };
  branch(x, base, -Math.PI / 2 + (hf(x, 2, seed) - 0.5) * 0.4, h * 0.45, 5, 4);
}

function paintSmoke(f: InkField, cx: number, base: number, seed: number): void {
  for (let y = SCROLL_BAND + 20; y < base; y++) {
    const t = (base - y) / (base - SCROLL_BAND - 20);
    const sway = (fbm(0, y, 60, seed + 7, 2) - 0.5) * 80 * t;
    const half = 8 + t * 40;
    for (let dx = -half; dx <= half; dx++) {
      const n = fbm(cx + dx + sway, y, 24, seed + 8, 3);
      const fall = 1 - Math.abs(dx) / half;
      const v = smooth(0.35, 0.6, n) * Math.sqrt(fall) * (0.62 - t * 0.35);
      if (v > 0.05) f.max(cx + dx + sway, y, v);
    }
  }
}

function paintCave(f: InkField, cx: number, cy: number): void {
  for (let dy = -40; dy <= 30; dy++) {
    for (let dx = -46; dx <= 46; dx++) {
      const e = (dx / 46) ** 2 + (dy / 40) ** 2;
      if (e < 0.72) f.max(cx + dx, cy + dy, 1);
      else if (e < 1) f.max(cx + dx, cy + dy, 0.85);
    }
  }
}

/** 奈落の口（手前の地面に開いた楕円）と、そこへ吸い込まれる墨の筋 */
function paintChasm(f: InkField, cx: number, seed: number): void {
  const cy = SCROLL_H - SCROLL_BAND - 22;
  const rx = 120;
  const ry = 30;
  for (let dy = -ry - 4; dy <= ry; dy++) {
    for (let dx = -rx - 6; dx <= rx + 6; dx++) {
      const wob = (fbm(dx, 0, 24, seed + 9, 2) - 0.5) * 0.25;
      const e = (dx / rx) ** 2 + (dy / ry) ** 2 + wob;
      if (e < 0.8) f.max(cx + dx, cy + dy, 1);
      else if (e < 1) f.max(cx + dx, cy + dy, RIM_INK * (1 - (e - 0.8) * 2));
    }
  }
  // 霞から奈落へ落ちる筋
  for (let k = 0; k < 14; k++) {
    const x = cx + (hf(k, 1, seed) - 0.5) * rx * 1.6;
    const y0 = SCROLL_BAND + 120 + hf(k, 2, seed) * 40;
    f.line(x, y0, x + (cx - x) * 0.25, cy - ry * 0.5, 1, 2, 0.4 + hf(k, 3, seed) * 0.3);
  }
}

function paintReeds(f: InkField, seed: number): void {
  const bottom = SCROLL_H - SCROLL_BAND;
  for (let k = 0; k < 9; k++) {
    const y = bottom - 30 + k * 3;
    const x0 = hf(k, 1, seed) * SCROLL_W * 0.6;
    f.line(x0, y, x0 + 60 + hf(k, 2, seed) * 120, y, 1, 1, 0.45);
  }
  for (let k = 0; k < 46; k++) {
    const x = hf(k, 3, seed) * SCROLL_W;
    const h = 24 + hf(k, 4, seed) * 40;
    const lean = (hf(k, 5, seed) - 0.5) * 16;
    f.line(x, bottom - 4, x + lean, bottom - 4 - h, 3, 1, 0.9);
  }
}

function paintGrass(f: InkField, seed: number): void {
  const bottom = SCROLL_H - SCROLL_BAND;
  for (let k = 0; k < 70; k++) {
    const x = hf(k, 6, seed) * SCROLL_W;
    for (let b = 0; b < 4; b++) {
      const h = 12 + hf(k, 7 + b, seed) * 18;
      f.line(x, bottom - 3, x + (b - 1.5) * 7, bottom - 3 - h, 3, 1, 0.9);
    }
  }
}

function paintMoon(f: InkField, cx: number, cy: number, r: number): void {
  for (let dy = -r - 6; dy <= r + 6; dy++) {
    for (let dx = -r - 6; dx <= r + 6; dx++) {
      const d = Math.hypot(dx, dy);
      if (d <= r) f.lift(cx + dx, cy + dy, 0);
      else if (d <= r + 2) f.max(cx + dx, cy + dy, 0.55);
    }
  }
}

/** 空の淡い墨（暗い階・深み） */
function paintSky(f: InkField, amount: number, seed: number): void {
  for (let y = SCROLL_BAND; y < SCROLL_H - SCROLL_BAND; y++) {
    for (let x = 0; x < SCROLL_W; x++) {
      const t = 1 - (y - SCROLL_BAND) / (SCROLL_H - 2 * SCROLL_BAND);
      f.max(x, y, amount * (0.6 + 0.4 * t) * (0.8 + fbm(x, y, 80, seed + 11, 2) * 0.4));
    }
  }
}

/** 中景の建物（章の様式） */
function paintStyle(f: InkField, style: MapStyle, mid: Float32Array, seed: number): void {
  const at = (x: number): number => mid[Math.round(x)] ?? SCROLL_BAND + 150;
  switch (style) {
    case "moss":
      paintPine(f, SCROLL_W * 0.16, at(SCROLL_W * 0.16) + 40, 110, seed);
      paintPine(f, SCROLL_W * 0.8, at(SCROLL_W * 0.8) + 50, 90, seed + 1);
      return;
    case "temple":
      paintPagoda(f, SCROLL_W * 0.64, at(SCROLL_W * 0.64) + 18);
      return;
    case "castleFire":
    case "castleFrost":
      paintCastle(f, SCROLL_W * 0.5, at(SCROLL_W * 0.5) + 30, style === "castleFrost");
      return;
    case "deep":
      paintChasm(f, SCROLL_W * 0.48, seed);
      return;
    case "final":
      paintChasm(f, SCROLL_W * 0.48, seed);
      paintTorii(f, SCROLL_W * 0.48 - 150, SCROLL_H - SCROLL_BAND - 34, 0.9, 0.95);
      return;
    case "town":
      paintTorii(f, SCROLL_W * 0.48, SCROLL_H - SCROLL_BAND - 20, 1.3, 0.95);
      for (const [x, w] of [
        [SCROLL_W * 0.2, 44],
        [SCROLL_W * 0.3, 36],
        [SCROLL_W * 0.7, 40],
      ] as const) {
        const base = at(x) + 26;
        f.rect(x - w * 0.7, base - 14, x + w * 0.7, base, 0.55);
        f.roof(x, base - 24, w, 10, 5, 0.82);
      }
      return;
  }
}

/** 手前の添え物（階の種類） */
function paintKind(f: InkField, kind: FloorKind | null, edge: Float32Array, seed: number): void {
  const center = SCROLL_W * 0.48;
  const ground = SCROLL_H - SCROLL_BAND - 30;
  switch (kind) {
    case "cave":
      paintCave(f, center, ground - 6);
      return;
    case "dark":
      paintMoon(f, SCROLL_W * 0.78, SCROLL_BAND + 50, 18);
      return;
    case "forge":
    case "mine":
      paintSmoke(f, center + 40, ground, seed);
      return;
    case "swamp":
      paintReeds(f, seed);
      return;
    case "meadow":
      paintGrass(f, seed);
      return;
    case "ossuary":
      paintDeadTree(f, SCROLL_W * 0.3, (edge[Math.round(SCROLL_W * 0.3)] ?? ground) + 4, 160, seed);
      return;
    case "glacier":
    case "rooms":
    case null:
      return;
  }
}

/** 上下の表装の帯（藍の裂に金の点） */
function brocade(x: number, y: number): readonly [number, number, number] {
  const yy = y < SCROLL_BAND ? y : SCROLL_H - 1 - y;
  if (yy === SCROLL_BAND - 1) return [GOLD[0] * 0.6, GOLD[1] * 0.6, GOLD[2] * 0.6];
  const motif = yy % 6 === 3 && ((x + yy * 2) % 12 === 0 || (x - yy * 2 + 600) % 12 === 0);
  if (motif) return [GOLD[0] * 0.8, GOLD[1] * 0.8, GOLD[2] * 0.8];
  const k = 0.8 + vnoise(x, y, 5, 2) * 0.3;
  return [BROCADE[0] * k, BROCADE[1] * k, BROCADE[2] * k];
}

/** 和紙（繊維・染み・塵） */
function washi(x: number, y: number, seed: number): readonly [number, number, number] {
  const fib = vnoise(x, y * 18, 20, seed) * 0.6 + vnoise(x * 18, y, 20, seed + 3) * 0.4;
  const stain = smooth(0.62, 0.8, fbm(x, y, 125, seed + 11));
  const speck = h32(x, y, seed + 5) % 1000 > 992 ? 0.82 : 1;
  const k = (0.94 + fib * 0.08) * (1 - stain * 0.05) * speck;
  return [WASHI[0] * k, WASHI[1] * k * (1 - stain * 0.015), WASHI[2] * k * (1 - stain * 0.04)];
}

/** 巻物の紙（表装の帯 + 和紙 + 山水）を ABGR の画素列（SCROLL_W x SCROLL_H、行優先）で返す */
export function scrollPixels(input: ScrollArtInput): Uint32Array {
  const { style, floorKind, seed } = input;
  const f = new InkField();
  const snow = floorKind === "glacier" || style === "castleFrost";
  if (floorKind === "dark") paintSky(f, 0.34, seed);
  if (style === "deep" || style === "final") paintSky(f, 0.22, seed);
  const { mid } = paintMountains(f, seed, snow);
  paintStyle(f, style, mid, seed);
  const edge = paintCliffs(f, seed, snow);
  paintKind(f, floorKind, edge, seed);
  const out = new Uint32Array(SCROLL_W * SCROLL_H);
  for (let y = 0; y < SCROLL_H; y++) {
    const band = y < SCROLL_BAND || y >= SCROLL_H - SCROLL_BAND;
    for (let x = 0; x < SCROLL_W; x++) {
      const i = y * SCROLL_W + x;
      if (band) {
        const [r, g, b] = brocade(x, y);
        out[i] = pack(r, g, b);
        continue;
      }
      const [pr, pg, pb] = washi(x, y, seed);
      const v = f.v[i] ?? 0;
      const q = Math.min(1, Math.floor(v * SCROLL_INK_LEVELS + (BAYER[(y & 3) * 4 + (x & 3)] ?? 0)) / SCROLL_INK_LEVELS);
      const k = 1 - q;
      out[i] = pack(pr * k + INK[0] * q, pg * k + INK[1] * q, pb * k + INK[2] * q);
    }
  }
  return out;
}

/** 墨の濃さの割合（テスト・確認用）: 和紙の地より暗い画素の割合 */
export function inkCoverage(px: Uint32Array): number {
  let dark = 0;
  let total = 0;
  for (let y = SCROLL_BAND; y < SCROLL_H - SCROLL_BAND; y++) {
    for (let x = 0; x < SCROLL_W; x++) {
      const c = px[y * SCROLL_W + x] ?? 0;
      total++;
      if ((c & 255) < WASHI[0] * 0.6) dark++;
    }
  }
  return dark / total;
}
