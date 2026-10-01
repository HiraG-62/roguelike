// 地図の模様（docs/ideas/map-visual-impl.md 1-2 節。見本の floorTex / topTex / sideTex / voidTex / terTex）。
// すべてワールドのドット座標と TexContext だけで決まる純関数で、1 ドットごとに割り当てを起こさない。
// 種は theme.key の文字列ハッシュだけ（state.rng・Math.random・state.seed は使わない）。
// 速さのため、値雑音は格子の値を（焼く範囲ぶん）前計算した Lattice、ボロノイは特徴点を前計算した VorGrid で引く。
// どちらも範囲の外では mapNoise の vnoise / vor に切り替えるので、範囲の取り方で絵は変わらない。
import { createVorOut, h32, hashString, hf, vnoise, vor, type VorOut } from "./mapNoise";
import { mixColor, packedPitColors, DEFAULT_MOSS_ZONE, DEFAULT_STONE_ZONE, type PackedPitColors } from "./mapTheme";
import type { MapPalette, MapTheme } from "./mapTypes";

const U32 = 4294967296;

// ---------------------------------------------------------------------------
// 前計算つきの雑音
// ---------------------------------------------------------------------------

/**
 * 周期 p の値雑音の格子値を [x0, x1) x [y0, y1) ぶん持つ。at は mapNoise.vnoise と同じ値を返す。
 * rowCache なら、同じ y を続けて引く間は「その行の縦の補間」を使い回す（行ごとに 1 回の再計算で、1 ドットは横の補間だけ）。
 * y が毎回変わる使い方（側面の煤）は rowCache を切る
 */
export class Lattice {
  private readonly vals: Float64Array;
  private readonly ix0: number;
  private readonly iy0: number;
  private readonly gw: number;
  private readonly gh: number;
  /** 行の縦補間の結果: 左の格子の値と、右の格子との差 */
  private readonly rowA: Float64Array;
  private readonly rowD: Float64Array;
  private rowY = Number.NaN;
  private rowValid = false;

  constructor(
    private readonly period: number,
    private readonly seed: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    private readonly rowCache = true,
  ) {
    this.ix0 = Math.floor(x0 / period);
    this.iy0 = Math.floor(y0 / period);
    this.gw = Math.floor((x1 - 1) / period) + 1 - this.ix0 + 1;
    this.gh = Math.floor((y1 - 1) / period) + 1 - this.iy0 + 1;
    this.vals = new Float64Array(this.gw * this.gh);
    for (let j = 0; j < this.gh; j++) {
      for (let i = 0; i < this.gw; i++) this.vals[j * this.gw + i] = hf(this.ix0 + i, this.iy0 + j, seed);
    }
    this.rowA = new Float64Array(rowCache ? this.gw : 0);
    this.rowD = new Float64Array(rowCache ? this.gw : 0);
  }

  /** y の行の縦補間を作る。範囲の外なら rowValid を false にして、at が vnoise へ落ちる */
  private buildRow(y: number): void {
    this.rowY = y;
    const fy = y / this.period;
    const iy = Math.floor(fy);
    const gy = iy - this.iy0;
    this.rowValid = gy >= 0 && gy + 1 < this.gh;
    if (!this.rowValid) return;
    let ty = fy - iy;
    ty = ty * ty * (3 - 2 * ty);
    const { gw, vals } = this;
    const base = gy * gw;
    for (let g = 0; g + 1 < gw; g++) {
      const a = vals[base + g] ?? 0;
      const b = vals[base + g + 1] ?? 0;
      const c = vals[base + gw + g] ?? 0;
      const d = vals[base + gw + g + 1] ?? 0;
      const left = a + (c - a) * ty;
      this.rowA[g] = left;
      this.rowD[g] = b + (d - b) * ty - left;
    }
  }

  at(x: number, y: number): number {
    if (!this.rowCache) return this.atDirect(x, y);
    if (y !== this.rowY) this.buildRow(y);
    if (!this.rowValid) return vnoise(x, y, this.period, this.seed);
    const fx = x / this.period;
    const ix = Math.floor(fx);
    const gx = ix - this.ix0;
    if (gx < 0 || gx + 1 >= this.gw) return vnoise(x, y, this.period, this.seed);
    let tx = fx - ix;
    tx = tx * tx * (3 - 2 * tx);
    // gx は直前の検査で 0 <= gx < gw - 1 に収まっている
    return this.rowA[gx]! + this.rowD[gx]! * tx;
  }

  private atDirect(x: number, y: number): number {
    const fx = x / this.period;
    const fy = y / this.period;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const gx = ix - this.ix0;
    const gy = iy - this.iy0;
    if (gx < 0 || gy < 0 || gx + 1 >= this.gw || gy + 1 >= this.gh) return vnoise(x, y, this.period, this.seed);
    let tx = fx - ix;
    let ty = fy - iy;
    tx = tx * tx * (3 - 2 * tx);
    ty = ty * ty * (3 - 2 * ty);
    const o = gy * this.gw + gx;
    const a = this.vals[o] ?? 0;
    const b = this.vals[o + 1] ?? 0;
    const c = this.vals[o + this.gw] ?? 0;
    const d = this.vals[o + this.gw + 1] ?? 0;
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  }
}

/**
 * セル幅 cell のボロノイの特徴点を [x0, x1) x [y0, y1) ぶん持つ。query は mapNoise.vor と同じ値を out に書く。
 * 特徴点は (x, y) を交互に並べた 1 本の配列で持ち、9 セルを分岐なしに順に測る（枝刈りは分岐予測の外れで逆に遅かった）。
 * 範囲の内側は構築時に決めた大きさで添字が収まるので、内側ループでは添字の undefined 検査を省く
 */
export class VorGrid {
  private readonly pts: Float64Array;
  private readonly ids: Uint32Array;
  private readonly gx0: number;
  private readonly gy0: number;
  private readonly gw: number;
  private readonly gh: number;

  constructor(
    private readonly cell: number,
    private readonly seed: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ) {
    // 検索は自分の周り 1 セルまで見るので、範囲より 1 セル広く持つ
    this.gx0 = Math.floor(x0 / cell) - 1;
    this.gy0 = Math.floor(y0 / cell) - 1;
    this.gw = Math.floor((x1 - 1) / cell) + 1 - this.gx0 + 1;
    this.gh = Math.floor((y1 - 1) / cell) + 1 - this.gy0 + 1;
    const n = this.gw * this.gh;
    this.pts = new Float64Array(n * 2);
    this.ids = new Uint32Array(n);
    for (let j = 0; j < this.gh; j++) {
      for (let i = 0; i < this.gw; i++) {
        const gx = this.gx0 + i;
        const gy = this.gy0 + j;
        const hh = h32(gx, gy, seed);
        const o = j * this.gw + i;
        this.pts[o * 2] = (gx + 0.12 + ((hh & 1023) / 1024) * 0.76) * cell;
        this.pts[o * 2 + 1] = (gy + 0.12 + (((hh >>> 10) & 1023) / 1024) * 0.76) * cell;
        this.ids[o] = hh;
      }
    }
  }

  query(x: number, y: number, out: VorOut): VorOut {
    const cx = Math.floor(x / this.cell) - this.gx0;
    const cy = Math.floor(y / this.cell) - this.gy0;
    if (cx < 1 || cy < 1 || cx + 1 >= this.gw || cy + 1 >= this.gh) return vor(x, y, this.cell, this.seed, out);
    const pts = this.pts;
    const gw = this.gw;
    let d1 = 1e9;
    let d2 = 1e9;
    let best = 0;
    for (let j = -1; j <= 1; j++) {
      const row = (cy + j) * gw + cx;
      for (let i = -1; i <= 1; i++) {
        const o = row + i;
        const dx = x - pts[o * 2]!;
        const dy = y - pts[o * 2 + 1]!;
        const d = dx * dx + dy * dy;
        if (d < d1) {
          d2 = d1;
          d1 = d;
          best = o;
        } else if (d < d2) d2 = d;
      }
    }
    out.d1 = Math.sqrt(d1);
    out.d2 = Math.sqrt(d2);
    out.id = this.ids[best]!;
    out.cx = pts[best * 2]!;
    out.cy = pts[best * 2 + 1]!;
    return out;
  }
}

// ---------------------------------------------------------------------------
// 模様の文脈
// ---------------------------------------------------------------------------

/** 枯山水の砂紋が避ける石（最深の間の墨の石。置物のレーンが渡す）。ring は同心円の半径（ドット） */
export interface TexStone {
  x: number;
  y: number;
  ring: number;
}

/** 同じ色の混ぜ合わせを毎ドット計算しないための前計算 */
interface Premix {
  mossMid: number;
  fBfD50: number;
  fBfD60: number;
  fLfD60: number;
  fBfD50fD60: number;
  moss1fD50: number;
  glyph: number;
  tBtD55: number;
  tBtD30: number;
  tBtD35: number;
  tBtL60: number;
}

export interface TexContext {
  theme: MapTheme;
  P: MapPalette;
  /** theme.key のハッシュ。模様の種の土台 */
  seed: number;
  vo: VorOut;
  stoneZone: number;
  mossZone: number;
  stones: readonly TexStone[];
  /** 砂紋の横ずれ（列ごと。床が sand のときだけ使う） */
  sandBand: Float64Array;
  sandX0: number;
  /** 砂紋の位相（theme.key のハッシュから） */
  sandPhase: number;
  m: Premix;
  pit: PackedPitColors | null;
  zone56: Lattice;
  moss34: Lattice;
  ash44: Lattice;
  rockMoss30: Lattice;
  mason26: Lattice;
  strata18: Lattice;
  cliff16: Lattice;
  soot14: Lattice;
  water20: Lattice;
  water9: Lattice;
  oil14: Lattice;
  ice18: Lattice;
  ice22: Lattice;
  ink12: Lattice;
  vor20: VorGrid;
  vor17: VorGrid;
  vor13: VorGrid;
  vor10: VorGrid;
  vor15: VorGrid;
}

/** 側面の模様が引く縦方向（k）の最大。側面の高さ 32 + 余り */
const SIDE_K_MAX = 40;

/**
 * 焼く範囲 [x0, x0 + w) x [y0, y0 + h)（ワールドのドット）に合わせて文脈を作る。
 * 範囲は速さのためだけで、範囲の外を引いても同じ絵になる（チャンクの継ぎ目が一致する根拠）
 */
export function createTexContext(theme: MapTheme, x0: number, y0: number, w: number, h: number, stones: readonly TexStone[] = []): TexContext {
  const seed = hashString(theme.key) | 0;
  const P = theme.palette;
  const x1 = x0 + w;
  const y1 = y0 + h;
  const lat = (period: number, salt: number): Lattice => new Lattice(period, seed + salt, x0, y0, x1, y1);
  const lat1d = (period: number, salt: number): Lattice => new Lattice(period, seed + salt, x0, 0, x1, 1);
  const vg = (cell: number, salt: number): VorGrid => new VorGrid(cell, seed + salt, x0, y0, x1, y1);
  const fBfD50 = mixColor(P.fB, P.fD, 0.5);
  const sandBand = new Float64Array(theme.floor === "sand" ? w : 0);
  const phase = ((seed >>> 0) % SAND_PHASE_STEPS) / SAND_PHASE_STEPS * SAND_PHASE_MAX;
  for (let i = 0; i < sandBand.length; i++) sandBand[i] = sandBandAt(phase, x0 + i);
  return {
    theme,
    P,
    seed,
    vo: createVorOut(),
    stoneZone: theme.floorZone?.stone ?? DEFAULT_STONE_ZONE,
    mossZone: theme.floorZone?.moss ?? DEFAULT_MOSS_ZONE,
    stones,
    sandBand,
    sandX0: x0,
    sandPhase: phase,
    m: {
      mossMid: mixColor(P.moss1, P.moss2, 0.5),
      fBfD50,
      fBfD60: mixColor(P.fB, P.fD, 0.6),
      fLfD60: mixColor(P.fL, P.fD, 0.6),
      fBfD50fD60: mixColor(fBfD50, P.fD, 0.6),
      moss1fD50: mixColor(P.moss1, P.fD, 0.5),
      glyph: mixColor(P.accent, P.fB, 0.45),
      tBtD55: mixColor(P.tB, P.tD, 0.55),
      tBtD30: mixColor(P.tB, P.tD, 0.3),
      tBtD35: mixColor(P.tB, P.tD, 0.35),
      tBtL60: mixColor(P.tB, P.tL, 0.6),
    },
    pit: packedPitColors(theme.pit),
    zone56: lat(56, 11),
    moss34: lat(34, 19),
    ash44: lat(44, 47),
    rockMoss30: lat(30, 67),
    mason26: lat(26, 73),
    strata18: lat1d(18, 83),
    cliff16: lat1d(16, 101),
    soot14: new Lattice(14, seed + 97, x0, 0, x1, SIDE_K_MAX, false),
    water20: lat(20, 0),
    water9: lat(9, 3),
    oil14: lat(14, 5),
    ice18: lat(18, 19),
    ice22: lat(22, 23),
    ink12: lat(12, 0),
    vor20: vg(20, 61),
    vor17: vg(17, 7),
    vor13: vg(13, 7),
    vor10: vg(10, 13),
    vor15: vg(15, 17),
  };
}

const SAND_PHASE_STEPS = 628;
const SAND_PHASE_MAX = 6.28;

/** 砂紋の横ずれ（列ごとに 1 回だけ要る値。範囲の外では毎回これを計算する） */
function sandBandAt(phase: number, wx: number): number {
  return Math.sin(wx / 37 + phase) * 5 + Math.sin(wx / 13) * 1.2;
}

/** mix(c, fD, 0.6) のうち、床の基本色は前計算を引く */
function mixToFloorDark(tc: TexContext, c: number): number {
  const m = tc.m;
  if (c === tc.P.fB) return m.fBfD60;
  if (c === tc.P.fL) return m.fLfD60;
  if (c === m.fBfD50) return m.fBfD50fD60;
  return mixColor(c, tc.P.fD, 0.6);
}

// ---------------------------------------------------------------------------
// 床（5 種）
// ---------------------------------------------------------------------------

export function floorTex(tc: TexContext, wx: number, wy: number): number {
  switch (tc.theme.floor) {
    case "cobble":
      return floorCobble(tc, wx, wy);
    case "slab":
      return floorSlab(tc, wx, wy, false);
    case "ashlar":
      return floorAshlar(tc, wx, wy);
    case "glyph":
      return floorSlab(tc, wx, wy, true);
    case "sand":
      return floorSand(tc, wx, wy);
  }
}

/** 土と石畳の地帯 + 苔（章 1） */
function floorCobble(tc: TexContext, wx: number, wy: number): number {
  const { P, m, seed } = tc;
  const zone = tc.zone56.at(wx, wy);
  const mossZ = tc.moss34.at(wx, wy);
  if (zone < tc.stoneZone) {
    // 土の地帯: ほぼ平塗り + 少しの粒（広間は読みやすく）
    const h = hf(wx, wy, seed + 3);
    if (mossZ > tc.mossZone) return mossZ > 0.8 ? m.mossMid : P.moss1;
    return h < 0.018 ? P.fD : h < 0.03 ? P.fL : P.fB;
  }
  const v = (zone > 0.72 ? tc.vor13 : tc.vor17).query(wx, wy, tc.vo);
  const e = v.d2 - v.d1;
  if (e < 1.2) return mossZ > tc.mossZone - 0.04 ? P.moss1 : P.fD;
  const mossy = mossZ > tc.mossZone && ((v.id >>> 7) & 1) === 1;
  let base = mossy ? P.moss1 : (v.id & 15) === 0 ? P.fL : ((v.id >>> 4) & 7) === 0 ? m.fBfD50 : P.fB;
  const rel = wx - v.cx + (wy - v.cy);
  if (e < 2.6) {
    if (rel < -3) base = mossy ? P.moss2 : base === P.fL ? P.fH : P.fL;
    else if (rel > 3) base = mossy ? m.moss1fD50 : mixToFloorDark(tc, base);
  }
  return base;
}

/** 敷石（段をずらした 32x16 + 2x2 の大石）。glyph なら金の文字を混ぜる（深み） */
function floorSlab(tc: TexContext, wx: number, wy: number, glyph: boolean): number {
  const { P, m, seed } = tc;
  const W = 32;
  const H = 16;
  const row = Math.floor(wy / H);
  const off = (row & 1) * (W / 2);
  const col = Math.floor((wx + off) / W);
  let lx = wx + off - col * W;
  let ly = wy - row * H;
  let sw = W;
  let sh = H;
  let id = h32(col, row, seed + 23);
  // 2x2 の大きな敷石を混ぜて格子を崩す
  const bc = Math.floor(wx / (W * 2));
  const br = Math.floor(wy / (H * 2));
  if (hf(bc, br, seed + 29) < 0.12) {
    lx = wx - bc * W * 2;
    ly = wy - br * H * 2;
    sw = W * 2;
    sh = H * 2;
    id = h32(bc, br, seed + 31);
  }
  if (lx === 0 || ly === 0) return P.fD;
  let base = id % 10 < 2 ? P.fL : id % 10 < 3 ? m.fBfD50 : P.fB;
  if (lx === 1 || ly === 1) base = base === P.fL ? P.fH : P.fL;
  else if (lx === sw - 1 || ly === sh - 1) base = mixToFloorDark(tc, base);
  if (id % 9 === 0) {
    const t = lx / sw;
    const yl = sh * 0.25 + sh * 0.5 * t + Math.round(Math.sin(lx * 0.8) * 1.2);
    if (Math.abs(ly - yl) < 0.6 && lx > 3 && lx < sw - 4) return P.fD;
  }
  if (glyph && id % 19 === 1) {
    const gx = lx - (sw >> 1) + 6;
    const gy = ly - (sh >> 1) + 5;
    if (gx >= 0 && gx < 12 && gy >= 0 && gy < 10) {
      const cx = Math.floor((gx < 6 ? gx : 11 - gx) / 2);
      const cy = Math.floor(gy / 2);
      if ((id >>> (cx * 5 + cy)) & 1) return m.glyph;
    }
  }
  return hf(wx, wy, seed + 37) < 0.01 ? P.fD : base;
}

/** 切石（32x32 を半分ずらして積む）。煤・霜はフラグで地帯状に乗る */
function floorAshlar(tc: TexContext, wx: number, wy: number): number {
  const { P, m, seed } = tc;
  const W = 32;
  const H = 32;
  const row = Math.floor(wy / H);
  const off = (row & 1) * 16;
  const col = Math.floor((wx + off) / W);
  const lx = wx + off - col * W;
  const ly = wy - row * H;
  const id = h32(col, row, seed + 41);
  let c: number;
  if (lx === 0 || ly === 0) c = P.fD;
  else if ((lx <= 2 && ly <= 2) || (lx >= W - 2 && ly <= 1 && (id & 1) === 1)) c = P.fD;
  else {
    c = id % 7 === 0 ? P.fL : id % 7 === 1 ? m.fBfD50 : P.fB;
    if (lx === 1 || ly === 1) c = c === P.fL ? P.fH : P.fL;
    else if (lx === W - 1 || ly === H - 1) c = mixToFloorDark(tc, c);
    if (id % 5 === 0) {
      const yl = 6 + lx * 0.6 + Math.round(Math.sin(lx) * 1.1);
      if (Math.abs(ly - yl) < 0.6 && lx > 4 && lx < 26) c = P.fD;
    }
    if (hf(wx, wy, seed + 43) < 0.012) c = P.fD;
  }
  const flags = tc.theme.flags;
  if (!flags.soot && !flags.frost) return c;
  const z = tc.ash44.at(wx, wy);
  if (flags.soot) {
    if (z > 0.8) c = mixColor(c, P.soot, 0.5);
    else if (z > 0.72) c = mixColor(c, P.soot, 0.25);
  }
  if (flags.frost) {
    if (z > 0.72) c = mixColor(c, P.snow, 0.42);
    else if (z > 0.64) c = mixColor(c, P.snow, 0.2);
  }
  return c;
}

/** 枯山水: 横の砂紋 + 石の周りの同心円（最深の間） */
function floorSand(tc: TexContext, wx: number, wy: number): number {
  const { P, seed } = tc;
  let t = wy + (tc.sandBand[wx - tc.sandX0] ?? sandBandAt(tc.sandPhase, wx));
  for (const s of tc.stones) {
    // 全ドット × 石の数だけ回るので、外れは先に軸ごとに落とし、平方根は輪の中だけで取る
    const dy = wy - s.y;
    if (dy >= s.ring || dy <= -s.ring) continue;
    const dx = (wx - s.x) / 1.15;
    if (dx >= s.ring || dx <= -s.ring) continue;
    const d2 = dx * dx + dy * dy;
    if (d2 < s.ring * s.ring) {
      t = Math.sqrt(d2);
      break;
    }
  }
  const ph = ((t / 7) % 1 + 1) % 1;
  const c = ph < 0.2 ? P.fD : ph < 0.42 ? P.fL : P.fB;
  const h = hf(wx, wy, seed + 59);
  return h < 0.01 ? P.fD : h < 0.02 ? P.fL : c;
}

// ---------------------------------------------------------------------------
// 天面（3 種）
// ---------------------------------------------------------------------------

export function topTex(tc: TexContext, wx: number, wy: number): number {
  switch (tc.theme.top) {
    case "rock":
      return topRock(tc, wx, wy);
    case "mason":
      return topMason(tc, wx, wy);
    case "ink":
      return topInk(tc, wx, wy);
  }
}

/** 岩（ボロノイの塊）。苔の垂れはフラグで乗る */
function topRock(tc: TexContext, wx: number, wy: number): number {
  const { P, m } = tc;
  const v = tc.vor20.query(wx, wy, tc.vo);
  const e = v.d2 - v.d1;
  const rel = wx - v.cx + (wy - v.cy);
  let c: number;
  if (e < 1.4) c = P.tD;
  else if (e < 3.6 && rel < -3) c = P.tL;
  else if (e < 3.6 && rel > 3) c = m.tBtD55;
  else c = (v.id & 3) === 0 ? m.tBtD30 : P.tB;
  if (tc.theme.flags.drips && e >= 1.4 && tc.rockMoss30.at(wx, wy) > 0.66) c = e < 3.6 && rel < -3 ? P.moss2 : P.moss1;
  return c;
}

/** 石垣（24x16 の切石を段ごとにずらす） */
function topMason(tc: TexContext, wx: number, wy: number): number {
  const { P, m, seed } = tc;
  const row = Math.floor(wy / 16);
  const off = (row & 1) * 12;
  const lx = (((wx + off) % 24) + 24) % 24;
  const ly = wy - row * 16;
  if (lx === 0 || ly === 0) return P.tD;
  if (ly === 1) return P.tL;
  const id = h32(Math.floor((wx + off) / 24), row, seed + 71);
  let c = id % 5 === 0 ? m.tBtD35 : P.tB;
  const flags = tc.theme.flags;
  if (!flags.frost && !flags.soot) return c;
  const z = tc.mason26.at(wx, wy);
  if (flags.frost && z > 0.55) c = mixColor(c, P.snow, 0.45);
  if (flags.soot && z > 0.6) c = mixColor(c, P.soot, 0.4);
  return c;
}

/** 墨: 横の刷毛目 */
function topInk(tc: TexContext, wx: number, wy: number): number {
  const { P, m, seed } = tc;
  const band = Math.floor(wy / 2);
  const h = hf(band, Math.floor((wx + hf(band, 0, seed) * 60) / 34), seed + 79);
  return h < 0.1 ? m.tBtL60 : h < 0.18 ? P.tD : P.tB;
}

// ---------------------------------------------------------------------------
// 側面（5 種）。k = 側面の上端からのドット数（0..h-1）
// ---------------------------------------------------------------------------

export function sideTex(tc: TexContext, wx: number, wy: number, k: number, h: number): number {
  switch (tc.theme.side) {
    case "rockside":
      return sideRock(tc, wx, k, h);
    case "stonewall":
      return sideStoneWall(tc, wx, wy, k, h);
    case "ashlarside":
      return sideAshlar(tc, wx, k, h);
    case "inkside":
      return sideInk(tc, wx, k);
    case "cliff":
      return cliffTex(tc, wx, k, h);
  }
}

function sideRock(tc: TexContext, wx: number, k: number, h: number): number {
  const { P, seed } = tc;
  const strata = Math.floor((k + Math.round(tc.strata18.at(wx, 0) * 5)) / 5);
  let c = strata % 3 === 0 ? P.sL : P.sB;
  if (k < 2) c = P.sL;
  if (hf(wx >> 1, 3, seed + 89) < 0.06 && k > 2) c = P.sD;
  if (k >= h - 2) c = P.sD;
  if (tc.theme.flags.drips) {
    const col = wx >> 1;
    if (hf(col, 11, seed) < 0.45) {
      const len = 2 + Math.floor(hf(col, 12, seed) * h * 0.6);
      if (k < len) c = k === len - 1 ? P.moss2 : P.moss1;
    }
  }
  return c;
}

/** 石垣の側面。朱の柱・注連縄は置物のレーン（mapDecor）が側面の飾りとして重ねる */
function sideStoneWall(tc: TexContext, wx: number, wy: number, k: number, h: number): number {
  const { P, seed } = tc;
  const row = Math.floor(wy / 8);
  const off = Math.floor(hf(row, 5, seed) * 16);
  const bw = 18;
  const bx = (((wx + off) % bw) + bw) % bw;
  let c = bx === 0 || (wy & 7) === 0 ? P.sD : (wy & 7) === 1 ? P.sL : P.sB;
  if (k < 2) c = P.sL;
  if (k >= h - 2) c = P.sD;
  return c;
}

function sideAshlar(tc: TexContext, wx: number, k: number, h: number): number {
  const { P } = tc;
  const row = Math.floor(k / 10);
  const off = (row & 1) * 8;
  const bx = (((wx + off) % 16) + 16) % 16;
  const by = k - row * 10;
  let c = bx === 0 || by === 0 ? P.sD : by === 1 ? P.sL : P.sB;
  if (k < 2) c = P.sL;
  const flags = tc.theme.flags;
  if (flags.soot && k > h * 0.45 && tc.soot14.at(wx, k) > 0.4) c = mixColor(c, P.soot, 0.6);
  if (flags.frost && k >= h - 3) c = P.snow;
  if (k >= h - 1) c = P.sD;
  return c;
}

function sideInk(tc: TexContext, wx: number, k: number): number {
  const { P, seed } = tc;
  if (k < 1) return P.tL;
  return hf(wx >> 1, 31, seed) < 0.12 ? mixColor(P.sB, P.tB, 0.55) : P.sB;
}

/** 崖の断面（深み）。上から vD へ溶ける。穴の北の縁の奈落にも使う */
export function cliffTex(tc: TexContext, wx: number, k: number, h: number): number {
  const { P, seed } = tc;
  const strata = Math.floor((k + Math.round(tc.cliff16.at(wx, 0) * 4)) / 4);
  let c = strata % 2 === 1 ? P.sL : mixColor(P.sL, P.sB, 0.5);
  if (k > h * 0.55) c = mixColor(c, P.vD, 0.45);
  if (k > h * 0.8) c = mixColor(c, P.vD, 0.75);
  const col = wx >> 1;
  if (hf(col, 4, seed) < 0.07 && k < 4 + Math.floor(hf(col, 5, seed) * h)) c = P.fL;
  return c;
}

// ---------------------------------------------------------------------------
// 奈落（章 4・深みの壁の奥と穴）
// ---------------------------------------------------------------------------

const VOID_FLOAT_CELL = 52;

/** 奈落の面。d = 縁から奈落へ入ったドット数。浮かぶ岩片と遠い光の点を散らす */
export function voidTex(tc: TexContext, wx: number, wy: number, d: number): number {
  const { P, seed } = tc;
  let c = d < 10 ? mixColor(P.sB, P.vD, 0.3) : d < 22 ? mixColor(P.sB, P.vD, 0.66) : P.vD;
  const gx = Math.floor(wx / VOID_FLOAT_CELL);
  const gy = Math.floor(wy / VOID_FLOAT_CELL);
  const hh = h32(gx, gy, seed + 103);
  if ((hh & 255) < 22) {
    const cx = gx * VOID_FLOAT_CELL + 12 + ((hh >>> 8) & 31);
    const cy = gy * VOID_FLOAT_CELL + 12 + ((hh >>> 13) & 31);
    const r = 3 + ((hh >>> 18) & 3);
    const dx = wx - cx;
    const dy = (wy - cy) * 1.3;
    const dd = Math.hypot(dx, dy);
    if (dd < r) c = dd > r - 1 ? P.fO : dy < -r * 0.2 ? P.sL : P.sB;
  }
  if (h32(wx, wy, seed + 107) / U32 < 0.0016) c = P.lightDim;
  return c;
}

// ---------------------------------------------------------------------------
// 穴（水・油・溶岩・氷・墨）
// ---------------------------------------------------------------------------

/**
 * 穴の本体の模様。d = 岸からのドット数（岸の 1 ドットは 1）、north = 北の縁の帯（床の切り口）。
 * 奈落（theme.pit === "abyss"）は voidTex。northの崖は呼び出し側（mapBake）が cliffTex で描く
 */
export function pitTex(tc: TexContext, wx: number, wy: number, d: number, north: boolean): number {
  const pc = tc.pit;
  if (!pc) return voidTex(tc, wx, wy, d);
  if (north && pc.liquid) return pc.bank;
  const seed = tc.seed;
  switch (tc.theme.pit) {
    case "water": {
      if (d <= 1.5) return pc.foam;
      if (d <= 4) return pc.a;
      const band = (((wy + Math.round(tc.water20.at(wx, wy) * 6)) % 8) + 8) % 8;
      if (band === 0 && tc.water9.at(wx, wy) > 0.6) return pc.rip;
      return pc.deep;
    }
    case "oil": {
      if (d <= 2) return pc.sheen[((((wx + wy) >> 2) % 3) + 3) % 3] ?? pc.a;
      if (hf(wx, wy, seed + 9) < 0.008) return pc.sheen[(((wx >> 3) % 3) + 3) % 3] ?? pc.a;
      return tc.oil14.at(wx, wy) > 0.62 ? pc.a : pc.deep;
    }
    case "lava": {
      if (d <= 2) return pc.foam;
      if (d <= 4) return pc.mid;
      const v = tc.vor10.query(wx, wy, tc.vo);
      if (v.d2 - v.d1 < 1.4) return pc.rip;
      const sel = v.id & 3;
      return sel === 0 ? pc.mid : sel === 1 ? pc.a : pc.deep;
    }
    case "ice": {
      if (d <= 1.5) return pc.foam;
      const v = tc.vor15.query(wx, wy, tc.vo);
      if (v.d2 - v.d1 < 1) return pc.rip;
      if ((((wx + wy) % 29) + 29) % 29 < 2 && tc.ice18.at(wx, wy) > 0.55) return pc.foam;
      return tc.ice22.at(wx, wy) > 0.55 ? pc.rip : pc.a;
    }
    case "ink": {
      if (d <= 1.5) return pc.bank;
      const band = wy + Math.round(Math.sin(wx / 9) * 2);
      if (band % 11 === 0 && tc.ink12.at(wx, wy) > 0.62) return pc.foam;
      return pc.deep;
    }
    case "abyss":
      return voidTex(tc, wx, wy, d);
  }
}
