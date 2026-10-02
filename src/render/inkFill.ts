import { TELEGRAPH } from "../data/tuning";
import { INK_LAYER, type InkSurface, bayer } from "./inkSurface";
import { NOISE_PERIOD, noiseTile } from "./inkNoise";
import { inkColorsWithAlpha } from "./inkStroke";

/**
 * 範囲の予告の内側を墨で塗る（docs/ideas/ink-telegraph-impl.md 5 章。見本 area-mura.png の ① むら）。
 * 濃墨のむら（値ノイズの濃淡 + 4x4 の順序ディザ）で塗り、むらの薄い所だけ床が透ける。縁に近いほど濃い。
 * 下絵の範囲は同じ塗りを淡墨にして市松で間引く。ばらつきはワールドのドットで引くので、カメラが動いても模様が泳がない。
 *
 * 速さのため、ドットごとの計算をしない: むら・ディザの閾・市松はワールドのドットの周期（512 と 4 と 2）で決まるので、
 * 「そのドットの段」と「縁の濃さが何段目から塗られるか」を 1 枚の表に焼く。縁の濃さは EDGE_STEPS 段に量子化し、
 * 行ごとに「縁からの深さ d 以上の所」（輪 = 小さな円、扇 = 内へ寄せた扇と円の交わり）の区間を出して、段ごとの差の区間に表を写すだけにする
 */

/** むらの雑音: 粗い格子と細かい格子（ドット）と、混ぜる割合（粗い方） */
const MURA_COARSE_CELL = 16;
const MURA_FINE_CELL = 4;
const MURA_COARSE_MIX = 0.6;
const SEED_COARSE = 0x1b;
const SEED_FINE = 0x2c;
/** むらの濃さ → 段（墨入れ）。濃い所ほど黒 */
const MURA_DARK = 0.55;
const MURA_MID = 0.4;
const LEVEL_DARK = 6;
const LEVEL_MID = 5;
const LEVEL_LIGHT = 4;
/** 下絵の段（淡墨）: むらの濃い所 / 薄い所 */
const SKETCH_DARK = 2;
const SKETCH_LIGHT = 1;
/** 扇の辺までの距離を縁の深さに直す倍率（扇の辺は弧より細く見えるので、辺の近くの濃い帯を広げる） */
const FAN_SIDE_DEPTH = 2.2;
/** 縁の濃さの段の数（縁の帯を何段に割るか。1 段の濃さの差が 0.05 前後なら段の境は見えない） */
export const EDGE_STEPS = 5;
/** 表の 1 バイト: 下位 3 ビット = 段、上位 = 塗り始める縁の段 */
const LEVEL_BITS = 3;
const LEVEL_MASK = 7;
/** 扇の角はこれ未満（凸の扇として区間を出す。今の扇は 25〜30 度） */
const MAX_HALF = Math.PI / 2 - 0.01;

const BYTE = 255;

/** 毎ドット読む数値（モジュールの読み込み時に 1 回だけ読む） */
const MURA_BASE = TELEGRAPH.muraBase;
const MURA_NOISE = TELEGRAPH.muraNoise;
const MURA_EDGE = TELEGRAPH.muraEdge;
const EDGE_REACH = TELEGRAPH.muraEdgeReach;
const FILL_ALPHA = TELEGRAPH.fillAlpha;
const SKETCH_ALPHA = TELEGRAPH.sketchAlpha;

/** 粗い・細かい格子を混ぜたむらの表（0..255）。1 度だけ作る */
let muraTable: Uint8Array | null = null;

export function muraTile(): Uint8Array {
  if (muraTable) return muraTable;
  const coarse = noiseTile(MURA_COARSE_CELL, SEED_COARSE);
  const fine = noiseTile(MURA_FINE_CELL, SEED_FINE);
  const out = new Uint8Array(coarse.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.round((coarse[i] ?? 0) * MURA_COARSE_MIX + (fine[i] ?? 0) * (1 - MURA_COARSE_MIX));
  muraTable = out;
  return out;
}

/** 縁の段 e（0 = 奥、EDGE_STEPS = 縁の際）の縁の濃さ（0..1） */
export function edgeAmount(e: number): number {
  return e <= 0 ? 0 : (e - 0.5) / EDGE_STEPS;
}

/** 縁の段 e の帯の奥側の境の深さ（縁からの深さ。半径・射程に対する割合）。段 e の帯 = 深さ depthOfStep(e + 1) 以上 − 深さ depthOfStep(e) 以上 */
export function depthOfStep(e: number): number {
  return (EDGE_REACH * Math.max(0, EDGE_STEPS - e + 1)) / EDGE_STEPS;
}

/** むらの 1 ドットの段（0 = 床が透ける）。n はむら（0..1）、edge は縁の濃さ（0..1）、th はディザの閾 */
export function muraLevel(n: number, edge: number, th: number): number {
  const dens = MURA_BASE + MURA_NOISE * n + MURA_EDGE * edge;
  if (th > dens) return 0;
  return n > MURA_DARK ? LEVEL_DARK : n > MURA_MID ? LEVEL_MID : LEVEL_LIGHT;
}

function sketchLevelOf(level: number): number {
  if (level === 0) return 0;
  return level >= LEVEL_DARK ? SKETCH_DARK : SKETCH_LIGHT;
}

/**
 * 塗り始める縁の段（むら n・ディザの閾 th のドット）。濃さ base + noise·n + edge·E が閾以上になる最小の段。EDGE_STEPS を超えたら塗らない。
 * muraLevel を段ごとに試すのと同じ答え（inkFill.test.ts）を式で出す
 */
export function startStep(n: number, th: number): number {
  const need = (th - MURA_BASE - MURA_NOISE * n) / MURA_EDGE;
  if (need <= 0) return 0;
  // edgeAmount(e) = (e − 0.5) / EDGE_STEPS >= need
  return Math.max(1, Math.ceil(need * EDGE_STEPS + 0.5 - 1e-9));
}

const fillTables = new Map<boolean, Uint8Array>();

/**
 * 塗りの表（ワールドのドットで引く）。1 バイト = 段 | 塗り始める縁の段 << 3（0 = どこも塗らない）。
 * 縁の段 e の帯では、塗り始めの段が e 以下のドットを塗る。段はむらだけで決まり、縁の濃さで変わるのは塗るかどうかだけ
 */
export function fillTable(sketch: boolean): Uint8Array {
  const hit = fillTables.get(sketch);
  if (hit) return hit;
  const tile = muraTile();
  const out = new Uint8Array(tile.length);
  for (let wy = 0; wy < NOISE_PERIOD; wy++) {
    for (let wx = 0; wx < NOISE_PERIOD; wx++) {
      if (sketch && ((wx + wy) & 1) === 1) continue;
      const i = wy * NOISE_PERIOD + wx;
      const n = (tile[i] ?? 0) / BYTE;
      const e = startStep(n, bayer(wx, wy));
      if (e > EDGE_STEPS) continue;
      const level = muraLevel(n, edgeAmount(e), bayer(wx, wy));
      out[i] = ((sketch ? sketchLevelOf(level) : level) & LEVEL_MASK) | (e << LEVEL_BITS);
    }
  }
  fillTables.set(sketch, out);
  return out;
}

/** 表を先に焼く（初めての予告のフレームで固まらないように。描画の準備のときに 1 回呼ぶ） */
export function warmFillTables(): void {
  fillTable(false);
  fillTable(true);
}

const colorCache = new Map<number, Uint32Array>();

function colorsFor(alpha: number): Uint32Array {
  const key = Math.round(alpha * BYTE);
  const hit = colorCache.get(key);
  if (hit) return hit;
  const c = inkColorsWithAlpha(key / BYTE);
  colorCache.set(key, c);
  return c;
}

/** 行 y で「縁からの深さ depth 以上の所」の x の区間（作業面のドットの連続座標）を out へ。無ければ false */
type RowSpan = (y: number, depth: number, out: [number, number]) => boolean;

const SPAN: [number, number] = [0, 0];
const SPAN_IN: [number, number] = [0, 0];

/** 帯ごとの区間を求めて表を写す。y0..y1 は調べる行。深さの区間は入れ子の凸なので、段 e の帯は 1 行に高々 2 つの区間 */
function fillBands(surf: InkSurface, stage: "sketch" | "ink", alpha: number, y0: number, y1: number, span: RowSpan): void {
  const sketch = stage === "sketch";
  const a = alpha * (sketch ? SKETCH_ALPHA : FILL_ALPHA);
  const colors = colorsFor(a);
  const layer = sketch ? INK_LAYER.sketch : INK_LAYER.fill;
  const table = fillTable(sketch);
  const from = Math.max(0, y0);
  const to = Math.min(surf.h - 1, y1);
  for (let y = from; y <= to; y++) {
    // 奥（e = 0）から縁へ
    let hasIn = false;
    for (let e = 0; e <= EDGE_STEPS; e++) {
      if (!span(y, depthOfStep(e + 1), SPAN)) continue;
      const xa = Math.ceil(SPAN[0] - 0.5);
      const xb = Math.floor(SPAN[1] - 0.5);
      if (!hasIn) {
        surf.putTableRow(y, xa, xb, table, NOISE_PERIOD, layer, colors, a, e);
      } else {
        const ia = Math.ceil(SPAN_IN[0] - 0.5);
        const ib = Math.floor(SPAN_IN[1] - 0.5);
        surf.putTableRow(y, xa, Math.min(xb, ia - 1), table, NOISE_PERIOD, layer, colors, a, e);
        surf.putTableRow(y, Math.max(xa, ib + 1), xb, table, NOISE_PERIOD, layer, colors, a, e);
      }
      SPAN_IN[0] = SPAN[0];
      SPAN_IN[1] = SPAN[1];
      hasIn = true;
    }
  }
}

/** 円の内側を塗る（作業面のドット座標の中心 cx, cy・半径 r ドット） */
export function fillRing(surf: InkSurface, cx: number, cy: number, r: number, stage: "sketch" | "ink", alpha = 1): void {
  if (!(r > 0) || alpha <= 0) return;
  fillBands(surf, stage, alpha, Math.floor(cy - r), Math.ceil(cy + r), (y, depth, out) => {
    const rr = r * (1 - depth);
    const dy = y + 0.5 - cy;
    const h2 = rr * rr - dy * dy;
    if (h2 <= 0) return false;
    const h = Math.sqrt(h2);
    out[0] = cx - h;
    out[1] = cx + h;
    return true;
  });
}

/** lo <= coef × x + k <= hi の x の区間を out と交わる所へ狭める。空なら false */
function narrow(coef: number, k: number, lo: number, hi: number, out: [number, number]): boolean {
  if (Math.abs(coef) < 1e-9) return k >= lo && k <= hi;
  const a = (lo - k) / coef;
  const b = (hi - k) / coef;
  out[0] = Math.max(out[0], Math.min(a, b));
  out[1] = Math.min(out[1], Math.max(a, b));
  return out[0] <= out[1];
}

/**
 * 扇の内側を塗る（要 cx, cy・射程 range ドット・中心の向き base・半角 half rad）。
 * 深さ d 以上の所 = 要を中心の半径 range(1 − d) の円と、辺から d·range / FAN_SIDE_DEPTH だけ内へ寄せた扇（要を中心の向きへずらす）の交わり
 */
export function fillCone(surf: InkSurface, cx: number, cy: number, range: number, base: number, half: number, stage: "sketch" | "ink", alpha = 1): void {
  if (!(range > 0) || !(half > 0) || alpha <= 0) return;
  const h = Math.min(half, MAX_HALF);
  const ux1 = Math.cos(base - h);
  const uy1 = Math.sin(base - h);
  const ux2 = Math.cos(base + h);
  const uy2 = Math.sin(base + h);
  const bx = Math.cos(base);
  const by = Math.sin(base);
  const sinH = Math.sin(h);
  fillBands(surf, stage, alpha, Math.floor(cy - range), Math.ceil(cy + range), (y, depth, out) => {
    const rr = range * (1 - depth);
    const dy = y + 0.5 - cy;
    const h2 = rr * rr - dy * dy;
    if (h2 <= 0) return false;
    const c = Math.sqrt(h2);
    out[0] = cx - c;
    out[1] = cx + c;
    // 内へ寄せた扇の要 (ax, ay) と、行の y の要からのずれ qy
    const shift = (depth * range) / FAN_SIDE_DEPTH / sinH;
    const ax = cx + bx * shift;
    const qy = y + 0.5 - (cy + by * shift);
    // 左の辺の内側: cross(u1, P − A) = ux1·qy − uy1·(px − ax) >= 0
    if (!narrow(-uy1, ux1 * qy + uy1 * ax, 0, Number.POSITIVE_INFINITY, out)) return false;
    // 右の辺の内側: cross(P − A, u2) = (px − ax)·uy2 − qy·ux2 >= 0
    return narrow(uy2, -ax * uy2 - qy * ux2, 0, Number.POSITIVE_INFINITY, out);
  });
}
