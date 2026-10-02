import { TELEGRAPH } from "../data/tuning";
import { hash01 } from "./renderMath";

/**
 * 墨の予告の筆の線（docs/ideas/ink-telegraph-impl.md 段 1・2）。
 * 下絵（黄）= 淡墨の掠れ。入りが太く、抜きで細くなり、繊維の筋がところどころ切れて紙が透ける。
 * 墨入れ（赤）= 一筆で引き切る濃墨。入りに墨溜まり、抜きで細く払い、中に赤い芯を通す。範囲（輪・扇）は縁をこの筆で引き、墨入れは縁の内側へ薄く滲む。
 * 筆の形（輪郭と筋の座標）は「長さ・段・変種・欠けの段階」ごとに 1 回だけ作ってキャッシュし、描くときは回して置くだけにする。
 * ゆらぎは座標ハッシュだけ（state.rng を使わない）で、敵の id と形で固定なのでちらつかない。
 *
 * 描くコストの注意（ソフトウェア描画での実測）:
 * - 1 回の fill / stroke に約 15〜50µs の固定費があり、頂点が増えると 1 頂点 約 0.3µs が乗る。だから層を絞り（線 1 本 = 2〜3 回）、頂点を粗くする
 * - 全部の線を 1 つの Path2D にまとめて塗ると、塗りの範囲（バウンディングボックス）が画面全体になって逆に倍遅い。線ごとに塗る
 * - ctx.save / clip は使わない。回して置く行列は setTransform で直接渡す（自分の体の上を切るのは、線の区間そのものを切って作る）
 */

/** 下絵 / 墨入れ / 被弾筋（赤い芯を持たない墨の一筆。過去の物で、これから来る物と取り違えない） */
export type BrushStage = "sketch" | "ink" | "trace";

export type Tone = "bleed" | "dull" | "bright" | "body" | "core";

/** 1 層分の形。parts は平らな x, y の列（塗りは閉じた多角形・筋は開いた折れ線） */
export interface BrushLayer {
  tone: Tone;
  stroke: boolean;
  parts: number[][];
}

export interface BrushGeo {
  layers: BrushLayer[];
  /** 描くときに 1 度だけ起こす（Path2D の無い環境では空の代わりを持つ） */
  paths: AnyPath[] | null;
}

/** 筆の局所座標 (s, n) → 画面の座標。s は筆の進む距離、n は横。正の n が「内側」 */
type Mapper = (s: number, n: number, out: number[]) => void;

/**
 * 輪郭を標本にする間隔 px（部品ごと）。帯の縁のがたつきは粗い間隔でも筆の掠れに見える。
 * 長い弧は標本が増えすぎないよう、MAX_STATIONS 個を上限にする
 */
const BODY_STEP = 7;
const CORE_STEP = 9;
const BLEED_STEP = 8;
const FIBER_STEP = 8;
const MAX_STATIONS = 70;
/** 長さ・半径を量子化する公比（約 6%）。伸縮は 3% 以内で、キャッシュの数が数十で済む */
const QUANT_RATIO = 1.06;
const QUANT_MIN = 6;
/** 変種の数。同じ長さの線が同じ筆に見えないように */
const VARIANTS = 3;
/** 欠けの段階（0.1 刻み）。当てるほど欠けるのが段階で見えれば十分で、キャッシュが増えない */
const GAP_STEPS = 10;
/** 墨溜まりの位置と広がり px */
const POOL_AT = 2;
const POOL_SIGMA = 3.2;
/** 下絵の入りの太りの広がり px */
const ENTRY_SIGMA = 3;
/** 芯が始まる位置 px（墨溜まりの中から） */
const CORE_START = 3;
/** 縁のがたつき px（墨入れの帯の縁） */
const EDGE_NOISE = 0.4;
/** 芯の横のむら px。まっすぐすぎると定規で引いた線に見える */
const CORE_JITTER = 0.15;
/** 芯を止める位置（払いの長さに対する割合。手前で止めると先は黒い払いだけが細く残る） */
const CORE_TAIL_CUT = 0.45;
/** 下絵のゆるやかな揺れ px と波長の係数 */
const SKETCH_WOBBLE = 0.28;
const WOBBLE_FREQ = 0.09;
/** 下絵の筋の長さ（描く塊 / 切れ目）の基準 px。中央の筋は長く、外の筋はよく切れる */
const BRIGHT_ON = 16;
const BRIGHT_OFF = 3.5;
const DULL_ON = 9;
const DULL_OFF = 4;
/** 中央の筋（黄が明るく長い）に数える横位置の範囲（-0.5..0.5 のうち中央側） */
const BRIGHT_BAND = 0.2;
/** 筋の蛇行の振れ幅 px と波長の係数。筋ごとにばらばらに揺れて、毛先が割れた掠れになる */
const FIBER_WANDER = 0.22;
const FIBER_FREQ = 0.17;
/** 筋が先端で必ず描かれる長さ px（届く先を見せる） */
const TIP_PX = 5;
/** 筋の横の広がり（太さに対する割合）。外の筋が縁からはみ出さない */
const FIBER_SPREAD = 0.9;
/** 墨入れの先の払いで太さが落ちる下限（太さに対する割合） */
const TAIL_MIN = 0.3;
/** 下絵の先の細りで太さが落ちる下限 */
const SKETCH_TAIL_MIN = 0.4;
const TWO_PI = Math.PI * 2;

/** 長さ・半径を量子化する */
export function quantLen(v: number): number {
  const k = Math.round(Math.log(Math.max(v, QUANT_MIN) / QUANT_MIN) / Math.log(QUANT_RATIO));
  return QUANT_MIN * QUANT_RATIO ** k;
}

function variantOf(id: number): number {
  return Math.abs(Math.imul(Math.floor(id), 2654435761) >>> 8) % VARIANTS;
}

function gapStep(gap: number): number {
  return Math.round(Math.max(0, Math.min(1, gap)) * GAP_STEPS);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

const lineMap: Mapper = (s, n, out) => {
  out.push(s, n);
};

function arcMap(radius: number): Mapper {
  return (s, n, out) => {
    const a = s / radius;
    const r = radius - n;
    out.push(Math.cos(a) * r, Math.sin(a) * r);
  };
}

/** s の標本の列（from..to を step 以下で割る。ただし MAX_STATIONS 個を超えない） */
function stations(from: number, to: number, step: number): number[] {
  const n = Math.max(1, Math.min(MAX_STATIONS, Math.ceil((to - from) / step)));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(from + ((to - from) * i) / n);
  return out;
}

interface Profile {
  /** s での筆の太さ */
  width: (s: number) => number;
  /** s での中心の横ずれ（払いの曲がり・揺れ。side の分は別に足す） */
  center: (s: number) => number;
}

/** 先端の細り: 終わりの tail px で 1 → low へ */
function taperAt(s: number, length: number, tail: number, low: number): number {
  const k = clamp01((s - (length - tail)) / tail);
  return 1 - (1 - low) * k * k * (3 - 2 * k);
}

function tailOf(length: number): number {
  return Math.min(TELEGRAPH.brushTailPx, length * 0.3);
}

function sketchProfile(length: number, seed: number): Profile {
  const w = TELEGRAPH.sketchWidth;
  const tail = tailOf(length);
  const phase = hash01(seed, 91) * TWO_PI;
  return {
    width: (s) => w * (1 + TELEGRAPH.brushEntryScale * Math.exp(-((s / ENTRY_SIGMA) ** 2))) * taperAt(s, length, tail, SKETCH_TAIL_MIN),
    center: (s) => SKETCH_WOBBLE * Math.sin(s * WOBBLE_FREQ + phase),
  };
}

function inkProfile(length: number, seed: number): Profile {
  const w = TELEGRAPH.inkCasingWidth;
  const tail = tailOf(length);
  const flick = (hash01(seed, 93) < 0.5 ? -1 : 1) * TELEGRAPH.brushFlickPx;
  return {
    width: (s) => w * (1 + TELEGRAPH.brushPoolScale * Math.exp(-(((s - POOL_AT) / POOL_SIGMA) ** 2))) * taperAt(s, length, tail, TAIL_MIN),
    center: (s) => {
      const k = clamp01((s - (length - tail)) / tail);
      return flick * k * k;
    },
  };
}

/** 帯の輪郭（from..to）。side は帯をどちらへ寄せるか（+1: +n 側だけに広がる、0: 中央） */
function bandPolygon(map: Mapper, p: Profile, from: number, to: number, side: number, noiseSeed: number, noiseAmp: number, step: number, widthMul = 1, widthJitter = 0): number[] {
  const out: number[] = [];
  const bottom: number[] = [];
  stations(from, to, step).forEach((s, i) => {
    // 帯の寄せは芯と本体で同じ基準（widthMul を掛けない太さ）で決める。芯が本体の中央に載る
    const base = p.width(s);
    const w = base * widthMul * (1 + (hash01(noiseSeed + 5, i) - 0.5) * 2 * widthJitter);
    const c = p.center(s) + (side * base) / 2;
    const jt = noiseAmp > 0 ? (hash01(noiseSeed, i * 2) - 0.5) * 2 * noiseAmp : 0;
    const jb = noiseAmp > 0 ? (hash01(noiseSeed, i * 2 + 1) - 0.5) * 2 * noiseAmp : 0;
    map(s, c + w / 2 + jt, out);
    bottom.push(s, c - w / 2 + jb);
  });
  // 下側は逆順に mapper へ通す
  const back: number[] = [];
  for (let i = bottom.length - 2; i >= 0; i -= 2) map(bottom[i] ?? 0, bottom[i + 1] ?? 0, back);
  return out.concat(back);
}

/** 筋（細い線）の折れ線 */
function fiberLine(map: Mapper, p: Profile, from: number, to: number, side: number, offset: number, seed: number): number[] {
  const out: number[] = [];
  const phase = hash01(seed, 3) * TWO_PI;
  stations(from, to, FIBER_STEP).forEach((s, i) => {
    const w = p.width(s);
    const n = p.center(s) + (side * w) / 2 + offset * w * FIBER_SPREAD + FIBER_WANDER * Math.sin(s * FIBER_FREQ + phase) + (hash01(seed, i) - 0.5) * 0.12;
    map(s, n, out);
  });
  return out;
}

/** 筋の描く区間（乱数の代わりに座標ハッシュ）。根元は必ず一定の長さ描く。明るい筋は先端まで描く */
export function fiberRuns(seed: number, length: number, gap: number, onBase: number, offBase: number, reachTip: boolean): [number, number][] {
  const runs: [number, number][] = [];
  const onK = 1.25 - gap;
  const offK = 0.4 + gap * 1.2;
  let s = 0;
  for (let i = 0; s < length && i < 400; i++) {
    const h = hash01(seed, i);
    if (i % 2 === 0) {
      const raw = onBase * (0.5 + h) * onK;
      const len = Math.max(i === 0 ? TELEGRAPH.brushRootPx : 3, raw);
      runs.push([s, Math.min(length, s + len)]);
      s += len;
    } else {
      s += offBase * (0.5 + h) * offK;
    }
  }
  if (reachTip && length > TIP_PX) {
    const last = runs[runs.length - 1];
    if (last && last[1] >= length - TIP_PX) last[1] = length;
    else runs.push([length - TIP_PX, length]);
  }
  return runs;
}

/** 描く窓（筆に沿った区間）。自分の体の上を切った残りだけ作る */
interface Win {
  from: number;
  to: number;
}

function sketchLayers(map: Mapper, length: number, gap: number, side: number, seed: number, win: Win): BrushLayer[] {
  const p = sketchProfile(length, seed);
  const fibers = TELEGRAPH.sketchFibers;
  const dull: number[][] = [];
  const bright: number[][] = [];
  for (let k = 0; k < fibers; k++) {
    const offset = (k + 0.5) / fibers - 0.5;
    const center = Math.abs(offset) < BRIGHT_BAND;
    const runs = fiberRuns(seed * 31 + k * 7, length, gap, center ? BRIGHT_ON : DULL_ON, center ? BRIGHT_OFF : DULL_OFF, center);
    for (const [a, b] of runs) {
      const from = Math.max(a, win.from);
      const to = Math.min(b, win.to);
      if (to - from < 0.5) continue;
      (center ? bright : dull).push(fiberLine(map, p, from, to, side, offset, seed + k * 13 + Math.floor(a)));
    }
  }
  return [
    { tone: "dull", stroke: true, parts: dull },
    { tone: "bright", stroke: true, parts: bright },
  ];
}

function inkLayers(map: Mapper, length: number, side: number, seed: number, bleedRadius: number | null, win: Win, withCore = true): BrushLayer[] {
  const p = inkProfile(length, seed);
  const layers: BrushLayer[] = [];
  if (bleedRadius !== null) {
    // 縁の内側へ滲む（1 枚の薄い帯。グラデーションの塗りは使わない）
    layers.push({ tone: "bleed", stroke: false, parts: [bleedBand(map, win, Math.min(TELEGRAPH.bleedMaxPx, bleedRadius * TELEGRAPH.bleedDepth))] });
  }
  layers.push({ tone: "body", stroke: false, parts: [bandPolygon(map, p, win.from, win.to, side, seed, EDGE_NOISE, BODY_STEP)] });
  // 芯は一定の太さの 1 本の線（塗りの多角形より軽い）。先の払いの手前で止め、先端は止めの印と黒い払いが受ける
  const coreFrom = Math.max(win.from, Math.min(CORE_START, length * 0.2));
  const coreTo = Math.min(win.to, length - tailOf(length) * CORE_TAIL_CUT);
  if (withCore && coreTo - coreFrom > 0.5) layers.push({ tone: "core", stroke: true, parts: [coreLine(map, p, coreFrom, coreTo, side, seed + 1)] });
  return layers;
}

/** 墨入れの芯の折れ線（帯の中央。むらは座標ハッシュ） */
function coreLine(map: Mapper, p: Profile, from: number, to: number, side: number, seed: number): number[] {
  const out: number[] = [];
  stations(from, to, CORE_STEP).forEach((s, i) => {
    const base = p.width(s);
    map(s, p.center(s) + (side * base) / 2 + (hash01(seed, i) - 0.5) * 2 * CORE_JITTER, out);
  });
  return out;
}

/** 弧の内側へ depth だけ広がる帯（縁の滲み） */
function bleedBand(map: Mapper, win: Win, depth: number): number[] {
  const out: number[] = [];
  const st = stations(win.from, win.to, BLEED_STEP);
  for (const s of st) map(s, 0, out);
  for (let i = st.length - 1; i >= 0; i--) map(st[i] ?? 0, depth, out);
  return out;
}

// -----------------------------------------------------------------------------
// 形のキャッシュ
// -----------------------------------------------------------------------------

const GEO_CACHE_MAX = 600;
const geoCache = new Map<string, BrushGeo>();

function remember(key: string, build: () => BrushLayer[]): BrushGeo {
  const hit = geoCache.get(key);
  if (hit) return hit;
  if (geoCache.size >= GEO_CACHE_MAX) geoCache.clear();
  const geo: BrushGeo = { layers: build(), paths: null };
  geoCache.set(key, geo);
  return geo;
}

/**
 * 直線の筆（長さは量子化済み）。side は帯の寄せ（扇の辺は内側へ）。
 * win が全長でないとき（自分の体の上を切った残り）はキャッシュせずに作る（切る位置は自分の動きで毎回違うため）
 */
export function lineGeo(stage: BrushStage, length: number, variant: number, gap: number, side: number, win: Win | null = null): BrushGeo {
  const gs = gapStep(gap);
  const seed = variant * 101 + Math.round(length);
  const build = (w: Win): BrushLayer[] => (stage === "sketch" ? sketchLayers(lineMap, length, gs / GAP_STEPS, side, seed, w) : inkLayers(lineMap, length, side, seed, null, w, stage === "ink"));
  if (win) return { layers: build(win), paths: null };
  return remember(`l${stage}|${length.toFixed(2)}|${variant}|${stage === "sketch" ? gs : 0}|${side}`, () => build({ from: 0, to: length }));
}

/** 弧の筆（半径は量子化済み。弧の内側が +n）。sweep は弧の角度 rad */
export function arcGeo(stage: BrushStage, radius: number, sweep: number, variant: number, gap: number): BrushGeo {
  const gs = gapStep(gap);
  const length = sweep * radius;
  const seed = variant * 101 + Math.round(radius) + 7;
  const map = arcMap(radius);
  const win = { from: 0, to: length };
  return remember(`a${stage}|${radius.toFixed(2)}|${sweep.toFixed(3)}|${variant}|${stage === "sketch" ? gs : 0}`, () =>
    stage === "sketch" ? sketchLayers(map, length, gs / GAP_STEPS, 1, seed, win) : inkLayers(map, length, 1, seed, radius, win, stage === "ink"),
  );
}

// -----------------------------------------------------------------------------
// 描く
// -----------------------------------------------------------------------------

interface ToneStyle {
  color: string;
  alpha: number;
}

function toneStyle(tone: Tone): ToneStyle {
  switch (tone) {
    case "dull":
      return { color: TELEGRAPH.sketchDullColor, alpha: TELEGRAPH.sketchDullAlpha };
    case "bright":
      return { color: TELEGRAPH.readyColor, alpha: TELEGRAPH.sketchAlpha };
    case "body":
      return { color: TELEGRAPH.casingColor, alpha: TELEGRAPH.inkCasingAlpha };
    case "core":
      return { color: TELEGRAPH.commitColor, alpha: 1 };
    case "bleed":
      return { color: TELEGRAPH.commitColor, alpha: TELEGRAPH.rangeInkFillAlpha };
  }
}

/** Path2D の無い環境（単体テスト）の代わり。形は持たず、塗る色の記録だけを通す */
class NullPath {
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
}
type AnyPath = Path2D | NullPath;
const newPath = (): AnyPath => (typeof Path2D === "function" ? new Path2D() : new NullPath());

function pathsOf(geo: BrushGeo): AnyPath[] {
  if (geo.paths) return geo.paths;
  const built = geo.layers.map((layer) => {
    const path = newPath();
    for (const part of layer.parts) {
      path.moveTo(part[0] ?? 0, part[1] ?? 0);
      for (let i = 2; i < part.length; i += 2) path.lineTo(part[i] ?? 0, part[i + 1] ?? 0);
      if (!layer.stroke) path.closePath();
    }
    return path;
  });
  geo.paths = built;
  return built;
}

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/**
 * 筆を置くペン。呼び出し時の変換（カメラと拡大）を覚えておき、形ごとの行列をその上に掛けて setTransform で直接渡す（save / restore を使わない）。
 * 使い終わったら end() で元の変換へ戻す
 */
export class BrushPen {
  private readonly base: Matrix;

  constructor(private readonly ctx: CanvasRenderingContext2D) {
    const t = ctx.getTransform() as DOMMatrix | undefined;
    this.base = t && typeof t.a === "number" ? { a: t.a, b: t.b, c: t.c, d: t.d, e: t.e, f: t.f } : IDENTITY;
  }

  /** 形を局所行列 m で回して置く。alphaMul は全体の濃さ、bleedMul は縁の滲みだけの倍率 */
  geo(geo: BrushGeo, m: Matrix, alphaMul = 1, bleedMul = 1): void {
    const { ctx, base } = this;
    ctx.setTransform(
      base.a * m.a + base.c * m.b,
      base.b * m.a + base.d * m.b,
      base.a * m.c + base.c * m.d,
      base.b * m.c + base.d * m.d,
      base.a * m.e + base.c * m.f + base.e,
      base.b * m.e + base.d * m.f + base.f,
    );
    const paths = pathsOf(geo);
    ctx.lineCap = "butt";
    ctx.lineJoin = "bevel";
    geo.layers.forEach((layer, i) => {
      if (layer.parts.length === 0) return;
      const style = toneStyle(layer.tone);
      ctx.globalAlpha = Math.min(1, style.alpha * alphaMul * (layer.tone === "bleed" ? bleedMul : 1));
      const path = paths[i] as Path2D | undefined;
      if (!path) return;
      if (layer.stroke) {
        ctx.strokeStyle = style.color;
        ctx.lineWidth = layer.tone === "core" ? TELEGRAPH.inkWidth : TELEGRAPH.sketchFiberWidth;
        ctx.stroke(path);
        return;
      }
      ctx.fillStyle = style.color;
      ctx.fill(path);
    });
  }

  end(): void {
    const { ctx, base } = this;
    ctx.setTransform(base.a, base.b, base.c, base.d, base.e, base.f);
    ctx.globalAlpha = 1;
  }
}

/** 線に沿った区間（根元からの距離 px） */
export interface BrushSpan {
  from: number;
  to: number;
}

/**
 * 直線の筆を 1 本置く。pieces は描く区間（自分の体の上を切った残り。null なら全長）。
 * lateral は線の横へずらす距離（擦れて散る動き）、side は帯の寄せ（扇の辺は内側へ）
 */
export function placeBrushLine(
  pen: BrushPen,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stage: BrushStage,
  id: number,
  gap: number,
  pieces: readonly BrushSpan[] | null,
  alphaMul = 1,
  lateral = 0,
  side = 0,
): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len <= 0) return;
  const lq = quantLen(len);
  const k = len / lq;
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  const m = { a: cos * k, b: sin * k, c: -sin, d: cos, e: x0 - sin * lateral, f: y0 + cos * lateral };
  const variant = variantOf(id);
  if (!pieces) {
    pen.geo(lineGeo(stage, lq, variant, gap, side), m, alphaMul);
    return;
  }
  for (const pc of pieces) pen.geo(lineGeo(stage, lq, variant, gap, side, { from: pc.from / k, to: pc.to / k }), m, alphaMul);
}

/** 弧の筆を 1 本置く。a0 から sweep rad。弧の内側へ帯が広がる（判定の外へ太らせない）。bleedMul は縁の滲みの濃さの倍率 */
export function placeBrushArc(
  pen: BrushPen,
  cx: number,
  cy: number,
  radius: number,
  a0: number,
  sweep: number,
  stage: BrushStage,
  id: number,
  gap: number,
  alphaMul = 1,
  bleedMul = 1,
): void {
  if (!(radius > 0)) return;
  const rq = quantLen(radius);
  const k = radius / rq;
  const cos = Math.cos(a0);
  const sin = Math.sin(a0);
  pen.geo(arcGeo(stage, rq, sweep, variantOf(id), gap), { a: cos * k, b: sin * k, c: -sin * k, d: cos * k, e: cx, f: cy }, alphaMul, bleedMul);
}

/** 輪の筆の始点の角度（敵ごとに固定のハッシュ） */
export function ringStartAngle(id: number): number {
  return hash01(id, 31) * TWO_PI;
}

/** 輪は 1 周して始まりに少し重ねる（筆を引き切って始点の墨溜まりに被せる） */
export const RING_SWEEP = TWO_PI + 0.14;
