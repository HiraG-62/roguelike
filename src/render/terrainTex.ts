// 地形の層の dual-grid アトラス（docs/ideas/map-visual-impl.md 1-7 節）。
// 画面の頂点（マスの角）を中心に 32x32 ドット（論理 16x16）の 1 枚を置き、頂点を囲む 4 マスのどれが同じ地形かを
// 4 ビットの「形」で選ぶ。縁は角の丸めで作るので、地形の境目がマスの格子に縛られない。
// 画素を作る関数は純関数（座標ハッシュだけ。Math.random・state.rng は使わない）。canvas にするのは別の小さな口。
import { TERRAIN_KINDS, type TerrainKind } from "../core/terrain";
import { TILE_DOTS } from "./mapTypes";
import { createVorOut, h32, hashString, hf, pack, vnoise, type VorOut } from "./mapNoise";

/** dual-grid で描く地形。崩れる床（rubble）はマスごとの揺れの予告があるので対象外、煙は別の層 */
export type TexKind = "water" | "oil" | "lava" | "bog" | "ice" | "grass" | "fire" | "mud";

export const TEX_KINDS: readonly TexKind[] = ["water", "oil", "lava", "bog", "ice", "grass", "fire", "mud"];

/** 形のビット: 頂点を囲む 4 マスの左上・右上・左下・右下 */
export const QUAD_TL = 1;
export const QUAD_TR = 2;
export const QUAD_BL = 4;
export const QUAD_BR = 8;
export const QUAD_ALL = QUAD_TL | QUAD_TR | QUAD_BL | QUAD_BR;
/** 形の数（4 ビット） */
export const MASK_COUNT = 16;
/** 変種の数。模様の位相（頂点の座標の偶奇）で決まる */
export const VARIANT_COUNT = 4;

/** 1 枚のドット数（1 マス）と、1 つのマスの四半分（頂点から見た 1 象限）のドット数 */
export const CELL_DOTS = TILE_DOTS;
const HALF = CELL_DOTS / 2;
/** 模様の周期（ドット）。1 枚の 2 倍なので、頂点の偶奇で 4 つの位相に分かれ、隣り合う枚の模様が途切れない */
const PERIOD = 64;
/** 揺らぎ（縁のゆがみ）の雑音の周期 */
const EDGE_NOISE_PERIOD = 9;
/** 面取り距離（3-4 の近似） */
const DIAGONAL = 1.414;
const FAR = 1e5;

/** 穴のマスの扱い（頂点ごとの 4 マスの印）。水の章の穴は水と数える */
export const PIT_NONE = 0;
/** 同じ種類の液体の穴（形には数えるが、絵は焼いた穴が描くのでここでは描かない） */
export const PIT_SAME = 1;
/** 別の種類の穴（数えない・描かない） */
export const PIT_OTHER = 2;

/** 描く象限の印を形の上位に詰めた値の境目 */
const DRAW_SHIFT = 4;
const MASK_BITS = 0xf;

function hex(code: string): number {
  const n = Number.parseInt(code.slice(1), 16);
  return pack((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

interface TexPalette {
  /** 本体 */
  a: number;
  /** 奥 */
  deep: number;
  /** 縁 */
  foam: number;
  /** 割れ目・波紋・粒 */
  rip: number;
  /** 北の縁の切り口（液体だけ） */
  bank: number;
  /** 中間 */
  mid: number;
  /** 補助 */
  extra: readonly number[];
}

// 色は章に依らず種類で固定（地形は戦闘の道具）。見本 map-preview.html の TER を基準に、旧 STYLE の色相へ合わせた
const PALETTE: Readonly<Record<TexKind, TexPalette>> = {
  water: { a: hex("#4a8cb0"), deep: hex("#2e5a78"), foam: hex("#9ccbe0"), rip: hex("#72b0d0"), bank: hex("#1e2a2c"), mid: hex("#4a8cb0"), extra: [] },
  oil: {
    a: hex("#2a2420"),
    deep: hex("#1c1816"),
    foam: hex("#6a5a9a"),
    rip: hex("#3a8a7a"),
    bank: hex("#16110f"),
    mid: hex("#2a2420"),
    extra: [hex("#7a62a8"), hex("#3a8a7a"), hex("#a89a48"), hex("#3a8a7a")],
  },
  lava: { a: hex("#e0561e"), deep: hex("#ff7a2a"), foam: hex("#1a0e0a"), rip: hex("#ffd05a"), bank: hex("#140a08"), mid: hex("#a8341a"), extra: [] },
  bog: { a: hex("#3c5a20"), deep: hex("#2a4016"), foam: hex("#5e8a30"), rip: hex("#a0e060"), bank: hex("#1a2610"), mid: hex("#3c5a20"), extra: [] },
  ice: { a: hex("#8ab8d8"), deep: hex("#6a98bc"), foam: hex("#e8f4ff"), rip: hex("#b8e4ff"), bank: hex("#2a3448"), mid: hex("#8ab8d8"), extra: [] },
  grass: { a: hex("#2c5a24"), deep: hex("#234a1d"), foam: hex("#1c3c17"), rip: hex("#70c050"), bank: hex("#1c3c17"), mid: hex("#2c5a24"), extra: [hex("#a0e078")] },
  fire: { a: hex("#ff6010"), deep: hex("#b82808"), foam: hex("#b82808"), rip: hex("#ffe060"), bank: hex("#b82808"), mid: hex("#ff9020"), extra: [] },
  mud: { a: hex("#5a4028"), deep: hex("#4a3220"), foam: hex("#7a5c38"), rip: hex("#8a6a40"), bank: hex("#3a2818"), mid: hex("#5a4028"), extra: [] },
};

/** 北の縁に切り口（暗い帯）を見せる液体 */
const LIQUID: Readonly<Record<TexKind, boolean>> = {
  water: true,
  oil: true,
  lava: true,
  bog: true,
  ice: false,
  grass: false,
  fire: false,
  mud: false,
};

/** 縁のゆがみの振幅（ドット）。枚の境目では 0 に絞るので、隣の枚の縁と必ず繋がる */
const EDGE_AMP: Readonly<Record<TexKind, number>> = { water: 2, oil: 2, lava: 2, bog: 2, ice: 1, grass: 2, fire: 3, mud: 2 };
/** 角の丸めの半径（ドット）。1 マスの半分 = 内接円 */
const CORNER_R = HALF;
/** 北の縁の切り口の厚み（ドット） */
const BANK_ROWS = 3;

// -----------------------------------------------------------------------------
// 周期 64 の雑音（枚の位相が違っても模様が繋がるよう、格子の値を折り返して引く）
// -----------------------------------------------------------------------------

function wrap(i: number, n: number): number {
  return ((i % n) + n) % n;
}

/** 周期 PERIOD で折り返す値雑音（0..1）。p は PERIOD の約数 */
function pnoise(x: number, y: number, px: number, py: number, seed: number): number {
  const nx = PERIOD / px;
  const ny = PERIOD / py;
  const fx = x / px;
  const fy = y / py;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  let tx = fx - ix;
  let ty = fy - iy;
  tx = tx * tx * (3 - 2 * tx);
  ty = ty * ty * (3 - 2 * ty);
  const a = hf(wrap(ix, nx), wrap(iy, ny), seed);
  const b = hf(wrap(ix + 1, nx), wrap(iy, ny), seed);
  const c = hf(wrap(ix, nx), wrap(iy + 1, ny), seed);
  const d = hf(wrap(ix + 1, nx), wrap(iy + 1, ny), seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/** 周期 PERIOD で折り返すボロノイ。cell は PERIOD の約数。out を書き換えて返す（毎ドットの割り当てを避ける） */
function pvor(x: number, y: number, cell: number, seed: number, out: VorOut): VorOut {
  const n = PERIOD / cell;
  const gx0 = Math.floor(x / cell);
  const gy0 = Math.floor(y / cell);
  let d1 = FAR;
  let d2 = FAR;
  let id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const gx = gx0 + i;
      const gy = gy0 + j;
      const hh = h32(wrap(gx, n), wrap(gy, n), seed);
      const fx = (gx + 0.12 + ((hh & 1023) / 1024) * 0.76) * cell;
      const fy = (gy + 0.12 + (((hh >>> 10) & 1023) / 1024) * 0.76) * cell;
      const dx = x - fx;
      const dy = y - fy;
      const d = dx * dx + dy * dy;
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = hh;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  out.d1 = Math.sqrt(d1);
  out.d2 = Math.sqrt(d2);
  out.id = id;
  return out;
}

// -----------------------------------------------------------------------------
// 形（頂点を囲む 4 マス → 32x32 ドットの角の丸め）
// -----------------------------------------------------------------------------

function quadBit(qx: number, qy: number): number {
  return 1 << (qy * 2 + qx);
}

/**
 * 1 ドットが形の中か。自分のマス・横の隣・縦の隣で決まり（斜めは見ない）、外角と内角のときだけ半径 CORNER_R の円を当てる。
 * 縁のゆがみ e は呼び出し側が枚の境目で 0 に絞った値を渡す
 */
function insideShape(mask: number, u: number, v: number, e: number): boolean {
  const qx = u >= HALF ? 1 : 0;
  const qy = v >= HALF ? 1 : 0;
  const own = (mask & quadBit(qx, qy)) !== 0;
  const hN = (mask & quadBit(1 - qx, qy)) !== 0;
  const vN = (mask & quadBit(qx, 1 - qy)) !== 0;
  // 頂点の線（= 元のマスの縁）までの距離
  const dx = (qx === 0 ? HALF - 1 - u : u - HALF) + 0.5;
  const dy = (qy === 0 ? HALF - 1 - v : v - HALF) + 0.5;
  if (own) {
    if (!hN && !vN) {
      const ax = dx - e;
      const ay = dy - e;
      if (ax < 0 || ay < 0) return false;
      if (ax >= CORNER_R || ay >= CORNER_R) return true;
      return (ax - CORNER_R) * (ax - CORNER_R) + (ay - CORNER_R) * (ay - CORNER_R) <= CORNER_R * CORNER_R;
    }
    if (!hN) return dx >= e;
    if (!vN) return dy >= e;
    return true;
  }
  if (hN && vN) {
    const ax = dx + e;
    const ay = dy + e;
    if (ax < 0 || ay < 0) return true;
    if (ax >= CORNER_R || ay >= CORNER_R) return false;
    return (ax - CORNER_R) * (ax - CORNER_R) + (ay - CORNER_R) * (ay - CORNER_R) > CORNER_R * CORNER_R;
  }
  if (hN) return dx < -e;
  if (vN) return dy < -e;
  return false;
}

/** 枚の境目（= 元のマスの中心）で 0、中心で 1 になる重み。縁のゆがみをこれで絞ると隣の枚と継ぎ目なく繋がる */
function edgeEnvelope(u: number, v: number): number {
  return Math.sin((Math.PI * (u + 0.5)) / CELL_DOTS) * Math.sin((Math.PI * (v + 0.5)) / CELL_DOTS);
}

function buildShape(kind: TexKind, mask: number, variant: number): Uint8Array {
  const shape = new Uint8Array(CELL_DOTS * CELL_DOTS);
  if (mask === 0) return shape;
  if (mask === QUAD_ALL) return shape.fill(1);
  const amp = EDGE_AMP[kind];
  const seed = (hashString(kind) + variant) | 0;
  for (let v = 0; v < CELL_DOTS; v++) {
    for (let u = 0; u < CELL_DOTS; u++) {
      const e = Math.round((vnoise(u, v, EDGE_NOISE_PERIOD, seed) - 0.5) * 2 * amp * edgeEnvelope(u, v));
      shape[v * CELL_DOTS + u] = insideShape(mask, u, v, e) ? 1 : 0;
    }
  }
  return shape;
}

/**
 * 形の外までの距離（3-4 の面取り）。外は 0、中ほど大きい。枚の外は「形が続く」と見て数えない
 * （枚の境目は元のマスの中心で、そこから数ドットの範囲に外側の縁は来ない）
 */
function buildDistance(shape: Uint8Array): Float32Array {
  const n = CELL_DOTS;
  const d = new Float32Array(n * n);
  for (let i = 0; i < d.length; i++) d[i] = shape[i] === 0 ? 0 : FAR;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      let val = d[i] ?? 0;
      if (val === 0) continue;
      if (x > 0) val = Math.min(val, (d[i - 1] ?? FAR) + 1);
      if (y > 0) {
        val = Math.min(val, (d[i - n] ?? FAR) + 1);
        if (x > 0) val = Math.min(val, (d[i - n - 1] ?? FAR) + DIAGONAL);
        if (x < n - 1) val = Math.min(val, (d[i - n + 1] ?? FAR) + DIAGONAL);
      }
      d[i] = val;
    }
  }
  for (let y = n - 1; y >= 0; y--) {
    for (let x = n - 1; x >= 0; x--) {
      const i = y * n + x;
      let val = d[i] ?? 0;
      if (val === 0) continue;
      if (x < n - 1) val = Math.min(val, (d[i + 1] ?? FAR) + 1);
      if (y < n - 1) {
        val = Math.min(val, (d[i + n] ?? FAR) + 1);
        if (x < n - 1) val = Math.min(val, (d[i + n + 1] ?? FAR) + DIAGONAL);
        if (x > 0) val = Math.min(val, (d[i + n - 1] ?? FAR) + DIAGONAL);
      }
      d[i] = val;
    }
  }
  return d;
}

// -----------------------------------------------------------------------------
// 模様（見本 map-preview.html の terTex。座標は 64 ドット周期、d は縁までの距離）
// -----------------------------------------------------------------------------

interface DotInput {
  wx: number;
  wy: number;
  /** 縁（形の外）までの距離（ドット） */
  d: number;
  seed: number;
  vor: VorOut;
}

const RIPPLE_ROWS = 8;

function waterDot(p: TexPalette, s: DotInput): number {
  if (s.d <= 1.5) return p.foam;
  if (s.d <= 4) return p.a;
  const sway = Math.round(pnoise(s.wx, s.wy, 16, 16, s.seed) * 6);
  if (wrap(s.wy + sway, RIPPLE_ROWS) === 0 && pnoise(s.wx, s.wy, 8, 8, s.seed + 3) > 0.6) return p.rip;
  return p.deep;
}

function oilDot(p: TexPalette, s: DotInput): number {
  const sheen = p.extra;
  const film = sheen[(((s.wx + s.wy) >> 2) & 3) % sheen.length] ?? p.rip;
  if (s.d <= 2) return film;
  if (hf(s.wx, s.wy, s.seed + 9) < 0.008) return sheen[(s.wx >> 3) % sheen.length] ?? p.rip;
  return pnoise(s.wx, s.wy, 16, 16, s.seed + 5) > 0.62 ? p.a : p.deep;
}

function lavaDot(p: TexPalette, s: DotInput): number {
  if (s.d <= 2) return p.foam;
  if (s.d <= 4) return p.mid;
  const v = pvor(s.wx, s.wy, 16, s.seed + 13, s.vor);
  if (v.d2 - v.d1 < 1.4) return p.rip;
  const k = v.id & 3;
  if (k === 0) return p.mid;
  return k === 1 ? p.a : p.deep;
}

function iceDot(p: TexPalette, s: DotInput): number {
  if (s.d <= 1.5) return p.foam;
  const v = pvor(s.wx, s.wy, 16, s.seed + 17, s.vor);
  if (v.d2 - v.d1 < 1) return p.rip;
  if (wrap(s.wx + s.wy, 32) < 2 && pnoise(s.wx, s.wy, 16, 16, s.seed + 19) > 0.55) return p.foam;
  return pnoise(s.wx, s.wy, 32, 32, s.seed + 23) > 0.55 ? p.rip : p.a;
}

function bogDot(p: TexPalette, s: DotInput): number {
  if (s.d <= 1.5) return p.foam;
  if (hf(s.wx, s.wy, s.seed + 29) < 0.01) return p.rip;
  return pnoise(s.wx, s.wy, 16, 16, s.seed + 31) > 0.6 ? p.deep : p.a;
}

function mudDot(p: TexPalette, s: DotInput): number {
  if (s.d <= 1.5) return p.foam;
  if (hf(s.wx, s.wy, s.seed + 37) < 0.025) return p.rip;
  return pnoise(s.wx, s.wy, 16, 16, s.seed + 41) > 0.6 ? p.deep : p.a;
}

/** 草の房: 8 ドットの格子ごとに確率で 1 つ、縦 3 ドットの茎と両脇の葉を置く */
const TUFT_GRID = 8;
const TUFT_CHANCE = 3;
const TUFT_CHANCE_OF = 8;

function grassDot(p: TexPalette, s: DotInput): number {
  if (s.d <= 1.5) return p.foam;
  const tip = p.extra[0] ?? p.rip;
  // 房は格子の中心付近に置くので、自分の格子だけ調べれば足りる（茎は 3 ドット・脇は 1 ドットで格子を出ない）
  const gx = Math.floor(s.wx / TUFT_GRID);
  const gy = Math.floor(s.wy / TUFT_GRID);
  const h = h32(wrap(gx, PERIOD / TUFT_GRID), wrap(gy, PERIOD / TUFT_GRID), s.seed + 43);
  if (h % TUFT_CHANCE_OF < TUFT_CHANCE) {
    const tx = gx * TUFT_GRID + 2 + ((h >>> 3) & 3);
    const ty = gy * TUFT_GRID + 4 + ((h >>> 5) & 3);
    if (s.wx === tx && s.wy === ty - 2) return tip;
    if (s.wx === tx && (s.wy === ty - 1 || s.wy === ty)) return p.rip;
    if ((s.wx === tx - 1 || s.wx === tx + 1) && s.wy === ty - 1) return p.rip;
  }
  return pnoise(s.wx, s.wy, 16, 16, s.seed + 47) < 0.35 ? p.deep : p.a;
}

function fireDot(p: TexPalette, s: DotInput): number {
  if (s.d <= 2) return p.deep;
  // 炎は縦に長い雑音にして、舌のように見せる。芯（縁から遠い所）ほど黄色い
  const heat = pnoise(s.wx, s.wy, 8, 16, s.seed + 53) * 0.7 + Math.min(1, s.d / 8) * 0.3;
  if (heat > 0.8) return p.rip;
  return heat > 0.56 ? p.mid : p.a;
}

function dotColor(kind: TexKind, s: DotInput): number {
  const p = PALETTE[kind];
  switch (kind) {
    case "water":
      return waterDot(p, s);
    case "oil":
      return oilDot(p, s);
    case "lava":
      return lavaDot(p, s);
    case "ice":
      return iceDot(p, s);
    case "bog":
      return bogDot(p, s);
    case "mud":
      return mudDot(p, s);
    case "grass":
      return grassDot(p, s);
    case "fire":
      return fireDot(p, s);
  }
}

/** 枚の左上の、模様の座標（頂点の偶奇で 0 か 32 ずれ、枚が頂点を中心にするぶん -16） */
function phaseOrigin(variant: number): { x: number; y: number } {
  const shift = (bit: number): number => (bit * CELL_DOTS + PERIOD - HALF) % PERIOD;
  return { x: shift(variant & 1), y: shift((variant >> 1) & 1) };
}

/** 枚の 1 ドットが北の縁（真上の数ドットに形の外がある）か。液体の切り口を見せる */
function isNorthEdge(shape: Uint8Array, u: number, v: number): boolean {
  for (let k = 2; k <= BANK_ROWS; k++) {
    if (v - k >= 0 && shape[(v - k) * CELL_DOTS + u] === 0) return true;
  }
  return false;
}

// -----------------------------------------------------------------------------
// 公開: 画素と canvas
// -----------------------------------------------------------------------------

/** 頂点の座標の偶奇から変種を決める。64 ドット周期の模様の位相になるので、隣り合う枚で模様が繋がる */
export function terrainVariantAt(vx: number, vy: number): number {
  return (vx & 1) | ((vy & 1) << 1);
}

/**
 * 頂点を囲む 4 マスの印から (形 | 描く象限 << 4) を作る。
 * 形 = 同じ地形のマスと「同じ液体の穴」のマス（穴は水と数えて縁を作らない）。描く象限 = 穴でない同じ地形のマスだけ
 * @param kindCode 描く地形の番号（TERRAIN_KINDS の添字）
 * @param codes 4 マス（左上・右上・左下・右下）の地形の番号
 * @param pits 4 マスの穴の印（PIT_NONE / PIT_SAME / PIT_OTHER）
 */
export function vertexMasks(kindCode: number, codes: ArrayLike<number>, pits: ArrayLike<number>): number {
  let shape = 0;
  let draw = 0;
  for (let q = 0; q < 4; q++) {
    const bit = 1 << q;
    const pit = pits[q] ?? PIT_NONE;
    if (pit === PIT_SAME) {
      shape |= bit;
      continue;
    }
    if (pit === PIT_OTHER) continue;
    if (codes[q] === kindCode) {
      shape |= bit;
      draw |= bit;
    }
  }
  return shape | (draw << DRAW_SHIFT);
}

export function shapeOf(packed: number): number {
  return packed & MASK_BITS;
}

export function drawOf(packed: number): number {
  return (packed >> DRAW_SHIFT) & MASK_BITS;
}

/** 地形の番号 → dual-grid で描く種類（描かない種類は undefined） */
export function texKindOfCode(code: number): TexKind | undefined {
  const kind: TerrainKind | undefined = TERRAIN_KINDS[code];
  return kind !== undefined && isTexKind(kind) ? kind : undefined;
}

function isTexKind(kind: TerrainKind): kind is TexKind {
  return (TEX_KINDS as readonly string[]).includes(kind);
}

/**
 * 1 枚（32x32 ドット、行優先、ABGR）の画素を作る。形 0 は全透明、形 15 は全不透明。
 * @param mask 形（QUAD_*。1 が立つ象限が地形）
 * @param variant 0..3（模様の位相）
 * @param drawMask 描く象限。省略時は形と同じ。形に入っていても描かない象限（焼いた穴）は透明にする
 */
export function terrainCellPixels(kind: TexKind, mask: number, variant: number, drawMask: number = mask): Uint32Array {
  const out = new Uint32Array(CELL_DOTS * CELL_DOTS);
  const m = mask & MASK_BITS;
  if (m === 0) return out;
  const vr = variant & 3;
  const shape = buildShape(kind, m, vr);
  const dist = buildDistance(shape);
  const origin = phaseOrigin(vr);
  const palette = PALETTE[kind];
  const liquid = LIQUID[kind];
  const input: DotInput = { wx: 0, wy: 0, d: 0, seed: hashString(kind) | 0, vor: createVorOut() };
  const draw = drawMask & m;
  for (let v = 0; v < CELL_DOTS; v++) {
    const qy = v >= HALF ? 1 : 0;
    for (let u = 0; u < CELL_DOTS; u++) {
      const i = v * CELL_DOTS + u;
      if (shape[i] === 0) continue;
      if ((draw & quadBit(u >= HALF ? 1 : 0, qy)) === 0) continue;
      if (liquid && isNorthEdge(shape, u, v)) {
        out[i] = palette.bank;
        continue;
      }
      input.wx = (origin.x + u) % PERIOD;
      input.wy = (origin.y + v) % PERIOD;
      input.d = dist[i] ?? 0;
      out[i] = dotColor(kind, input);
    }
  }
  return out;
}

const cellCache = new Map<number, HTMLCanvasElement>();

function cellKey(kind: TexKind, mask: number, variant: number, drawMask: number): number {
  return (((TEX_KINDS.indexOf(kind) * MASK_COUNT + mask) * VARIANT_COUNT + variant) * MASK_COUNT + drawMask) | 0;
}

/** 画素列から canvas を作る。確認用の PNG や dev ツールからも使えるよう公開 */
export function cellCanvas(pixels: Uint32Array): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = CELL_DOTS;
  canvas.height = CELL_DOTS;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");
  const image = ctx.createImageData(CELL_DOTS, CELL_DOTS);
  new Uint32Array(image.data.buffer).set(pixels);
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * 1 枚の canvas。種類・形・変種・描く象限の組ごとに初めて使うとき 1 回だけ作る（最大 8 種 × 16 形 × 4 変種。
 * 描く象限が形と違う組は水の岸だけなので実際はずっと少ない）
 */
export function terrainCellImage(kind: TexKind, mask: number, variant: number, drawMask: number = mask): HTMLCanvasElement {
  const m = mask & MASK_BITS;
  const dm = drawMask & m;
  const vr = variant & 3;
  const key = cellKey(kind, m, vr, dm);
  const cached = cellCache.get(key);
  if (cached) return cached;
  const canvas = cellCanvas(terrainCellPixels(kind, m, vr, dm));
  cellCache.set(key, canvas);
  return canvas;
}
