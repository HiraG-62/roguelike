import { TELEGRAPH } from "../data/tuning";
import { hash01 } from "./renderMath";

/**
 * 墨の予告の筆の線（docs/ideas/ink-telegraph-impl.md。案 B「薄墨 → 濃墨 + 朱」）。
 * 下絵 = 薄墨: 半透明の明るい灰の淡い滲みに、水の多い筆の毛の束が掠れて走る（明るく淡い帯）。
 * 墨入れ = 濃墨: 真っ黒な一筆（入りで押さえて墨溜まり → 胴 → 抜きで払う。縁の毛は先へ行くほど掠れる）。入りに朱の点、
 *   敵の側へ墨の飛沫。暗い床で黒が沈まないよう、墨の下に胡粉（明るい白）の滲みと毛羽を敷く。
 * 2 段は「明るい淡い帯 ↔ 真っ黒な一筆」の明暗と形で分かれる（灰色にしても分かる）。
 *
 * 形（輪郭・毛の束・滲みの判子の座標）は「長さ・段・変種・欠けの段階」ごとに 1 回だけ作ってキャッシュし、描くときは行列で回して置くだけ。
 * ゆらぎは座標ハッシュだけ（state.rng を使わない）で、敵の id と形で固定なのでちらつかない。
 *
 * 描くコストの注意（GPU の実測）:
 * - 細い線（毛の束）を毎フレーム stroke すると、線 1 本ごとの頂点が多くて乱戦で 1 フレーム 8ms 余り増えた。毛の束・滲み・毛羽は 1 度だけ画像に焼き、
 *   置くのは drawImage にする（下絵 = 1 枚、墨入れ = 胡粉 1 枚 + 塗り 1 回 + 縁の掠れ 1 枚 + 朱 1 枚）。ぼかし（filter）は焼くときだけ掛ける
 * - 全部の線を 1 つの Path2D にまとめると塗りの範囲が画面全体に広がって逆に遅い。線ごとに描く
 * - 回して置く行列は setTransform で直接渡す（save / restore を使わない）。自分の体の上を抜く切り抜きは呼び側が描き込み全体に 1 回だけ掛ける
 * - 描く順は層ごと（下絵 → 墨入れの胡粉 → 墨 → 縁の掠れ → 朱）。墨入れの黒が他の線の胡粉で曇らない
 */

/** 下絵 / 墨入れ / 被弾筋（朱を持たない墨の一筆。過去の物で、これから来る物と取り違えない） */
export type BrushStage = "sketch" | "ink" | "trace";

/** 層の色の役。描く順（下から）は TONE_ORDER */
export type Tone = "sketch" | "inkHalo" | "body" | "dry" | "shu";

const TONE_ORDER: readonly Tone[] = ["sketch", "inkHalo", "body", "dry", "shu"];

/** 塗り（閉じた多角形）。parts は平らな x, y の列 */
export interface PathLayer {
  kind: "fill";
  tone: Tone;
  parts: number[][];
}

/**
 * 焼いた絵を置く層（下絵の滲みと毛の束・胡粉の滲みと毛羽・墨入れの縁の掠れ）。細い線を毎フレーム引くと重いので、1 度だけ画像に焼く。
 * from..to は直線の筆に沿った描く区間（自分の体の上を切った残り）。全部なら ±Infinity
 */
export interface ImageLayer {
  kind: "image";
  tone: "sketch" | "inkHalo" | "dry";
  src: BakeSrc;
  from: number;
  to: number;
}

/** 朱の点（入りの墨溜まり）。座標は筆の局所座標。画面の向きで置く（照りが左上に来るように） */
export interface ShuLayer {
  kind: "shu";
  tone: "shu";
  dots: number[];
}

export type BrushLayer = PathLayer | ImageLayer | ShuLayer;

export interface BrushGeo {
  layers: BrushLayer[];
  /** 描くときに 1 度だけ起こす（Path2D の無い環境では空の代わりを持つ） */
  paths: (AnyPath | null)[] | null;
}

/** 毛の束 1 組（同じ色・太さ・濃さの折れ線。焼くときは 1 本ずつ引いて重なりを濃くする） */
export interface StrandSet {
  color: string;
  alpha: number;
  width: number;
  parts: number[][];
}

/** 焼く絵の材料と、焼いた画像（局所座標の外接矩形 x0..x1, y0..y1 に焼く） */
export interface BakeSrc {
  /** 滲みの判子の色・ぼかし（論理 px）・濃さ */
  color: string;
  blur: number;
  baseAlpha: number;
  /** 判子の円 x, y, r の並び */
  dabs: number[];
  /** 明るいむらの判子（下絵の水溜まり）と色 */
  lightColor: string | null;
  puddles: number[];
  /** 毛羽の線分 x0, y0, x1, y1 の並び（墨入れの胡粉） */
  fibers: number[];
  /** 毛の束（下絵の筋・墨入れの縁の掠れ） */
  strands: StrandSet[];
  /** 焼く解像度（論理 1px あたりの画素） */
  bakeScale: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** undefined = まだ焼いていない、null = 焼けない環境 */
  image: HTMLCanvasElement | null | undefined;
}

/** 筆の局所座標 (s, n) → 形の座標。s は筆の進む距離、n は横。正の n が「内側」 */
type Mapper = (s: number, n: number, out: number[]) => void;

/** 長さ・半径を量子化する公比（約 6%）。伸縮は 3% 以内で、キャッシュの数が数十で済む */
const QUANT_RATIO = 1.06;
const QUANT_MIN = 6;
/** 変種の数。同じ長さの線が同じ筆に見えないように */
const VARIANTS = 3;
/** 欠けの段階（0.1 刻み）。当てるほど掠れるのが段階で見えれば十分で、キャッシュが増えない */
const GAP_STEPS = 10;
/** 輪郭（塗り）を標本にする間隔 px と、標本の上限。縁のがたつきは粗い間隔でも筆の掠れに見える */
const BODY_STEP = 6;
const MAX_STATIONS = 90;
/** 筋を標本にする間隔 px と上限（掠れの切れ目が見える細かさ） */
const STRAND_STEP = 3;
const MAX_STRAND_STATIONS = 160;
/** 滲みの判子の間隔 px（下絵の水溜まり・胡粉の毛羽） */
const DAB_STEP = 1.2;
const PUDDLE_STEP = 3.1;
const FIBER_EVERY = 0.7;
/** 入りが太り終わる距離 px と、墨溜まりの位置・広がり px */
const ENTRY_PX = 3;
const POOL_AT = 3;
const POOL_SIGMA = 2.6;
/** 太さのゆるいうねり（筆圧のむら） */
const PRESSURE_WAVE = 0.08;
const PRESSURE_FREQ = 0.13;
/** 筋のゆらぎ（横）: 振れ幅 px と波長の係数 */
const SKETCH_WOBBLE = 1.3;
const INK_WOBBLE = 0.4;
const WOBBLE_FREQ = 0.15;
/** 掠れのむら: 墨の量の雑音の強さと波長の係数（下絵は長くゆるく、墨入れは細かく） */
const SKETCH_NOISE = 1.1;
const SKETCH_NOISE_FREQ = 0.12;
const INK_NOISE = 0.5;
const INK_NOISE_FREQ = 0.3;
/** 墨の量がこれを下回ると描かない（掠れの切れ目）。欠けの割合が基準より増えた分だけ上げる */
const INK_THRESHOLD = 0.45;
const GAP_TO_THRESHOLD = 0.8;
/** 中央の筋（下絵）は根元と先端で必ず描く（向きと届きを見せる）。中央とみなす横位置と長さ px */
const CENTER_BAND = 0.2;
const ROOT_PX = 8;
const TIP_PX = 5;
/** 墨入れの塗りが受け持つ中央の幅（太さに対する割合）。外は掠れる筋 */
const INK_CORE = 0.78;
/** 墨入れの塗りの縁のがたつき px */
const EDGE_NOISE = 0.25;
/** 滲みの形: 半径のむら・中心の揺れ px（下絵 / 墨入れ） */
const SKETCH_HALO_ROUGH = 0.6;
const SKETCH_HALO_WOBBLE = 1.4;
const INK_HALO_ROUGH = 0.4;
/** 下絵の水溜まり: 半径（太さに対する倍率）・揺れ・むら・焼く濃さ */
const PUDDLE_RADIUS = 0.35;
const PUDDLE_WOBBLE = 2.2;
const PUDDLE_ROUGH = 0.9;
const PUDDLE_ALPHA = 0.5;
/** 胡粉の毛羽: 根元の位置（太さに対する倍率）・長さ・太さ・濃さ */
const FIBER_BASE = 0.9;
const FIBER_LEN = 1.1;
const FIBER_WIDTH = 0.45;
const FIBER_ALPHA = 0.85;
/** 飛沫の大きさ・広がりの角度 rad */
const SPLAT_SIZE = 1;
const SPLAT_CONE = 2.4;
/** 朱の点の照りの位置（半径に対する割合）と大きさ */
const SHU_LIGHT_OFFSET = 0.25;
const SHU_LIGHT_RADIUS = 0.43;
const SHU_LIGHT_ALPHA = 0.8;
/** いびつな玉の角の数とむら */
const BLOB_SIDES = 14;
const BLOB_ROUGH = 0.22;
/** 焼いた画像の画素の合計の上限。超えたら全部捨てて焼き直す（大きな輪が続いても記憶が膨らまない） */
const BAKE_PIXEL_BUDGET = 24_000_000;
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

function smooth(a: number, b: number, v: number): number {
  const k = clamp01((v - a) / (b - a));
  return k * k * (3 - 2 * k);
}

/** 1 次元のなめらかな雑音 0..1（座標ハッシュの値を滑らかにつなぐ） */
function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash01(seed, i) * (1 - u) + hash01(seed, i + 1) * u;
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

/** 折れ線の道。s はなぞる距離、n は左の法線（扇の道は内側が左に来る向きでなぞる）。法線は折れ角でなめらかに回す */
interface PolyPath {
  map: Mapper;
  length: number;
}

const POLY_STEP = 0.5;
/** 法線をならす前後の標本の数（POLY_STEP × これ px） */
const POLY_SMOOTH = 4;

function polyPath(points: readonly { x: number; y: number }[]): PolyPath {
  const xs: number[] = [];
  const ys: number[] = [];
  let carry = 0;
  const first = points[0];
  if (first) {
    xs.push(first.x);
    ys.push(first.y);
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    let t = POLY_STEP - carry;
    while (t <= d) {
      xs.push(a.x + ((b.x - a.x) * t) / d);
      ys.push(a.y + ((b.y - a.y) * t) / d);
      t += POLY_STEP;
    }
    carry = d - (t - POLY_STEP);
  }
  const count = xs.length;
  const nx: number[] = [];
  const ny: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = Math.max(0, i - POLY_SMOOTH);
    const b = Math.min(count - 1, i + POLY_SMOOTH);
    const tx = (xs[b] ?? 0) - (xs[a] ?? 0);
    const ty = (ys[b] ?? 0) - (ys[a] ?? 0);
    const l = Math.hypot(tx, ty) || 1;
    nx.push(-ty / l);
    ny.push(tx / l);
  }
  const length = Math.max(0, (count - 1) * POLY_STEP);
  const map: Mapper = (s, n, out) => {
    // 道の外（入りの飛沫・払いの先）は端の向きへ伸ばす
    const i = Math.max(0, Math.min(count - 1, Math.round(s / POLY_STEP)));
    const over = s - i * POLY_STEP;
    const nxi = nx[i] ?? 0;
    const nyi = ny[i] ?? 1;
    out.push((xs[i] ?? 0) + nyi * over + nxi * n, (ys[i] ?? 0) - nxi * over + nyi * n);
  };
  return { map, length };
}

/** s の標本の列（from..to を step 以下で割る。ただし max 個を超えない） */
function stations(from: number, to: number, step: number, max: number): number[] {
  const n = Math.max(1, Math.min(max, Math.ceil((to - from) / step)));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(from + ((to - from) * i) / n);
  return out;
}

/** 筆圧の形: 入りで押さえて墨溜まり → 胴 → 抜きで払う（太さの倍率） */
function pressure(length: number, seed: number): (s: number) => number {
  const tail = Math.min(TELEGRAPH.brushTailPx, length * TELEGRAPH.brushTailRatio);
  const entryMin = TELEGRAPH.brushEntryMin;
  const phase = hash01(seed, 91) * TWO_PI;
  return (s) => {
    const entry = entryMin + (1 - entryMin) * smooth(0, ENTRY_PX, s) + TELEGRAPH.brushPoolScale * Math.exp(-(((s - POOL_AT) / POOL_SIGMA) ** 2));
    const k = clamp01((s - (length - tail)) / tail);
    const drop = 1 - TELEGRAPH.brushTailDrop * k * k * (3 - 2 * k);
    return entry * drop * (1 + PRESSURE_WAVE * Math.sin(s * PRESSURE_FREQ + phase));
  };
}

/** 筆 1 本の作りの材料 */
interface Stroke {
  map: Mapper;
  length: number;
  /** 帯の寄せ（+1: +n 側だけに広がる、0: 中央） */
  side: number;
  seed: number;
  /** 太さの倍率（陣図の構えで太らせる） */
  widthMul: number;
}

function widthAt(st: Stroke, prof: (s: number) => number, s: number): number {
  return TELEGRAPH.brushWidth * st.widthMul * prof(s);
}

/** 毛 1 本の墨の量の掠れ: 先へ行くほど尽き、雑音で切れる。描く区間 [from, to] の列を返す */
export function strandRuns(seed: number, length: number, gap: number, u: number, k: number, stage: "sketch" | "ink"): [number, number][] {
  const edge = Math.min(1, Math.abs(u) / 0.5);
  const dry = (stage === "sketch" ? TELEGRAPH.sketchDry : TELEGRAPH.inkDry) * (0.45 + 1.4 * edge * edge) * (0.7 + 0.6 * hash01(seed + 3, k));
  const amp = stage === "sketch" ? SKETCH_NOISE : INK_NOISE;
  const freq = stage === "sketch" ? SKETCH_NOISE_FREQ : INK_NOISE_FREQ;
  const threshold = INK_THRESHOLD + Math.max(0, gap - TELEGRAPH.sketchGapBase) * GAP_TO_THRESHOLD;
  const center = stage === "sketch" && Math.abs(u) < CENTER_BAND;
  const runs: [number, number][] = [];
  let start = -1;
  const st = stations(0, length, STRAND_STEP, MAX_STRAND_STATIONS);
  st.forEach((s, i) => {
    const t = length > 0 ? s / length : 0;
    const ink = 1 - dry * t ** 1.5 + (noise1(s * freq + k * 17.3, seed + k) - 0.5) * amp;
    const forced = center && (s <= ROOT_PX || s >= length - TIP_PX);
    const on = forced || ink >= threshold;
    if (on && start < 0) start = i;
    if ((!on || i === st.length - 1) && start >= 0) {
      const end = on ? i : i - 1;
      if (end > start) runs.push([st[start] ?? 0, st[end] ?? 0]);
      start = -1;
    }
  });
  return runs;
}

/** 描く窓（筆に沿った区間）。自分の体の上を切った残りだけ作る */
interface Win {
  from: number;
  to: number;
}

/** 毛の束（筋）の折れ線を、明るい / 暗いの 2 つの束に分けて作る */
function strandLayers(st: Stroke, prof: (s: number) => number, stage: "sketch" | "ink", count: number, uFrom: number, uTo: number, gap: number, win: Win): number[][][] {
  const groups: number[][][] = [[], []];
  const wobble = stage === "sketch" ? SKETCH_WOBBLE : INK_WOBBLE;
  for (let k = 0; k < count; k++) {
    const span = (uTo - uFrom) / count;
    const u = uFrom + span * (k + 0.5) + (hash01(st.seed + 11, k) - 0.5) * span * 0.6;
    const group = groups[hash01(st.seed + 17, k) < 0.5 ? 0 : 1];
    for (const [a, b] of strandRuns(st.seed, st.length, gap, u, k, stage)) {
      const from = Math.max(a, win.from);
      const to = Math.min(b, win.to);
      if (to - from < 0.5) continue;
      const line: number[] = [];
      for (const s of stations(from, to, STRAND_STEP, MAX_STRAND_STATIONS)) {
        const w = widthAt(st, prof, s);
        const wob = (noise1(s * WOBBLE_FREQ + k * 5.1, st.seed + 77) - 0.5) * wobble;
        st.map(s, (st.side * w) / 2 + u * w + wob, line);
      }
      group?.push(line);
    }
  }
  return groups;
}

/** 墨入れの塗り（中央の幅）。縁は座標ハッシュでがたつく */
function bodyPolygon(st: Stroke, prof: (s: number) => number, win: Win): number[] {
  const top: number[] = [];
  const bottom: number[] = [];
  stations(win.from, win.to, BODY_STEP, MAX_STATIONS).forEach((s, i) => {
    const w = widthAt(st, prof, s);
    const c = (st.side * w) / 2;
    const half = (w * INK_CORE) / 2;
    st.map(s, c + half + (hash01(st.seed, i * 2) - 0.5) * 2 * EDGE_NOISE, top);
    bottom.push(s, c - half + (hash01(st.seed, i * 2 + 1) - 0.5) * 2 * EDGE_NOISE);
  });
  const back: number[] = [];
  for (let i = bottom.length - 2; i >= 0; i -= 2) st.map(bottom[i] ?? 0, bottom[i + 1] ?? 0, back);
  return top.concat(back);
}

/** いびつな玉の多角形（中心 s, n は局所座標。半径 r） */
function blobPolygon(st: Stroke, s: number, n: number, r: number, seed: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < BLOB_SIDES; i++) {
    const a = (i / BLOB_SIDES) * TWO_PI;
    const rr = r * (1 + (noise1(i * 0.9, seed) - 0.5) * 2 * BLOB_ROUGH);
    st.map(s + Math.cos(a) * rr, n + Math.sin(a) * rr, out);
  }
  return out;
}

/** 入りの飛沫（敵の側＝筆の進む逆へ散る小さな墨の粒） */
function splatterParts(st: Stroke): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < TELEGRAPH.splatterCount; i++) {
    const d = (0.4 + hash01(st.seed + 21, i) ** 2 * 1.6) * TELEGRAPH.splatterSpread;
    const a = Math.PI + (hash01(st.seed + 23, i) - 0.5) * SPLAT_CONE;
    const r = (0.15 + hash01(st.seed + 25, i) ** 2 * 0.85) * SPLAT_SIZE;
    out.push(blobPolygon(st, Math.cos(a) * d, Math.sin(a) * d, r, st.seed + i));
  }
  return out;
}

const FULL: Win = { from: 0, to: Number.POSITIVE_INFINITY };

/** 下絵: 薄墨の滲み・水溜まり・毛の束を 1 枚に焼いた絵だけ（線は引かない） */
function sketchLayers(st: Stroke, win: Win, src: BakeSrc): BrushLayer[] {
  return [imageLayer("sketch", src, win, st.length)];
}

/** 墨入れ・被弾筋: 胡粉の滲みの絵 → 濃墨の塗り（と入りの飛沫）→ 縁の掠れの絵 → 朱の点 */
function inkLayers(st: Stroke, stage: "ink" | "trace", win: Win, halo: BakeSrc, dry: BakeSrc): BrushLayer[] {
  const prof = pressure(st.length, st.seed);
  const body = [bodyPolygon(st, prof, win)];
  const whole = win.from <= 0;
  if (whole && stage === "ink") body.push(...splatterParts(st));
  const layers: BrushLayer[] = [
    imageLayer("inkHalo", halo, win, st.length),
    { kind: "fill", tone: "body", parts: body },
    imageLayer("dry", dry, win, st.length),
  ];
  const poolAt = TELEGRAPH.shuPoolAt;
  if (stage === "ink" && poolAt >= win.from && poolAt <= win.to) {
    const dot: number[] = [];
    st.map(poolAt, (st.side * widthAt(st, prof, poolAt)) / 2, dot);
    layers.push({ kind: "shu", tone: "shu", dots: dot });
  }
  return layers;
}

function imageLayer(tone: ImageLayer["tone"], src: BakeSrc, win: Win, length: number): ImageLayer {
  // 端の窓は焼いた絵の外の余白まで含める（入りと払いの先のぼかしを切らない）
  return { kind: "image", tone, src, from: win.from <= 0 ? Number.NEGATIVE_INFINITY : win.from, to: win.to >= length ? Number.POSITIVE_INFINITY : win.to };
}

// -----------------------------------------------------------------------------
// 焼く絵の材料（判子・毛羽・毛の束）
// -----------------------------------------------------------------------------

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function emptyBox(): Box {
  return { x0: Number.POSITIVE_INFINITY, y0: Number.POSITIVE_INFINITY, x1: Number.NEGATIVE_INFINITY, y1: Number.NEGATIVE_INFINITY };
}

function grow(box: Box, x: number, y: number, r: number): void {
  box.x0 = Math.min(box.x0, x - r);
  box.y0 = Math.min(box.y0, y - r);
  box.x1 = Math.max(box.x1, x + r);
  box.y1 = Math.max(box.y1, y + r);
}

/** 滲みの判子の円の列（下絵 = 薄墨の帯 / 墨入れ = 胡粉の下敷き） */
function dabCircles(st: Stroke, prof: (s: number) => number, sketch: boolean, box: Box): number[] {
  const radiusMul = sketch ? TELEGRAPH.sketchHaloRadius : TELEGRAPH.inkHaloRadius;
  const rough = sketch ? SKETCH_HALO_ROUGH : INK_HALO_ROUGH;
  const wobble = sketch ? SKETCH_HALO_WOBBLE : 0;
  const dabs: number[] = [];
  const pt: number[] = [];
  for (let s = 0; s <= st.length; s += DAB_STEP) {
    const w = widthAt(st, prof, s);
    const r = Math.max(0.2, radiusMul * w * (1 + (noise1(s * 0.4, st.seed + 13) - 0.5) * rough));
    pt.length = 0;
    st.map(s, (st.side * w) / 2 + (noise1(s * 0.12, st.seed + 41) - 0.5) * wobble, pt);
    dabs.push(pt[0] ?? 0, pt[1] ?? 0, r);
    grow(box, pt[0] ?? 0, pt[1] ?? 0, r);
  }
  return dabs;
}

/** 下絵の水溜まり（ところどころ明るく濃い） */
function puddleCircles(st: Stroke, prof: (s: number) => number): number[] {
  const out: number[] = [];
  const pt: number[] = [];
  for (let s = 0; s <= st.length; s += PUDDLE_STEP) {
    const w = widthAt(st, prof, s);
    pt.length = 0;
    st.map(s, (st.side * w) / 2 + (noise1(s * 0.12, st.seed + 44) - 0.5) * PUDDLE_WOBBLE, pt);
    out.push(pt[0] ?? 0, pt[1] ?? 0, Math.max(0.2, PUDDLE_RADIUS * w * (1 + (noise1(s * 0.4, st.seed + 16) - 0.5) * PUDDLE_ROUGH)));
  }
  return out;
}

/** 胡粉の毛羽（帯の縁から外へ伸びる細い筋） */
function fiberSegments(st: Stroke, prof: (s: number) => number, box: Box): number[] {
  const fibers: number[] = [];
  const pt: number[] = [];
  let i = 0;
  for (let s = 0; s <= st.length; s += FIBER_EVERY, i++) {
    const w = widthAt(st, prof, s);
    const sign = hash01(st.seed + 51, i) < 0.5 ? -1 : 1;
    const len = (0.4 + hash01(st.seed + 53, i) ** 2 * 2.2) * FIBER_LEN;
    const ang = (hash01(st.seed + 55, i) - 0.5) * 1.6;
    const base = (st.side * w) / 2 + sign * w * FIBER_BASE;
    pt.length = 0;
    st.map(s - Math.sin(ang) * len * 0.3, base - sign * Math.cos(ang) * len * 0.3, pt);
    st.map(s + Math.sin(ang) * len, base + sign * Math.cos(ang) * len, pt);
    fibers.push(pt[0] ?? 0, pt[1] ?? 0, pt[2] ?? 0, pt[3] ?? 0);
    grow(box, pt[2] ?? 0, pt[3] ?? 0, 0);
  }
  return fibers;
}

function growByStrands(box: Box, sets: readonly StrandSet[]): void {
  for (const set of sets) for (const part of set.parts) for (let i = 0; i + 1 < part.length; i += 2) grow(box, part[i] ?? 0, part[i + 1] ?? 0, set.width);
}

function finish(box: Box, pad: number, rest: Omit<BakeSrc, "x0" | "y0" | "x1" | "y1" | "image">): BakeSrc {
  const ok = Number.isFinite(box.x0);
  return { ...rest, x0: (ok ? box.x0 : 0) - pad, y0: (ok ? box.y0 : 0) - pad, x1: (ok ? box.x1 : 1) + pad, y1: (ok ? box.y1 : 1) + pad, image: undefined };
}

/** 下絵の絵の材料: 薄墨の滲み + 水溜まり + 毛の束（暗・明の 2 組。欠けで掠れる） */
function sketchSrc(st: Stroke, gap: number): BakeSrc {
  const prof = pressure(st.length, st.seed);
  const box = emptyBox();
  const dabs = dabCircles(st, prof, true, box);
  const [dark, light] = strandLayers(st, prof, "sketch", TELEGRAPH.sketchStrands, -0.5, 0.5, gap, FULL);
  const strands: StrandSet[] = [
    { color: TELEGRAPH.usuzumiDarkColor, alpha: TELEGRAPH.sketchStrandAlpha, width: TELEGRAPH.sketchStrandWidth, parts: dark ?? [] },
    { color: TELEGRAPH.usuzumiLightColor, alpha: TELEGRAPH.sketchStrandAlpha, width: TELEGRAPH.sketchStrandWidth, parts: light ?? [] },
  ];
  growByStrands(box, strands);
  const blur = TELEGRAPH.sketchHaloBlurPx;
  return finish(box, blur * 2 + 1, {
    color: TELEGRAPH.usuzumiColor,
    blur,
    baseAlpha: TELEGRAPH.sketchHaloAlpha,
    dabs,
    lightColor: TELEGRAPH.usuzumiLightColor,
    puddles: puddleCircles(st, prof),
    fibers: [],
    strands,
    bakeScale: TELEGRAPH.sketchBakeScale,
  });
}

/** 墨入れの胡粉の絵の材料: 白い滲み + 毛羽（濃さは置くときに掛ける） */
function gofunSrc(st: Stroke): BakeSrc {
  const prof = pressure(st.length, st.seed);
  const box = emptyBox();
  const dabs = dabCircles(st, prof, false, box);
  const fibers = fiberSegments(st, prof, box);
  const blur = TELEGRAPH.inkHaloBlurPx;
  return finish(box, blur * 2 + 1, {
    color: TELEGRAPH.gofunColor,
    blur,
    baseAlpha: 1,
    dabs,
    lightColor: null,
    puddles: [],
    fibers,
    strands: [],
    bakeScale: TELEGRAPH.inkHaloBakeScale,
  });
}

/** 墨入れの縁の掠れの絵の材料: 塗りの外の毛（先へ行くほど墨が尽きて切れる） */
function drySrc(st: Stroke): BakeSrc {
  const prof = pressure(st.length, st.seed);
  const n = TELEGRAPH.inkStrands;
  const edgeFrom = INK_CORE / 2 - 0.04;
  const [a, b] = strandLayers(st, prof, "ink", n, edgeFrom, 0.5, 0, FULL);
  const [c, d] = strandLayers({ ...st, seed: st.seed + 5 }, prof, "ink", n, -0.5, -edgeFrom, 0, FULL);
  const strands: StrandSet[] = [{ color: TELEGRAPH.sumiColor, alpha: 1, width: TELEGRAPH.inkStrandWidth, parts: [...(a ?? []), ...(b ?? []), ...(c ?? []), ...(d ?? [])] }];
  const box = emptyBox();
  growByStrands(box, strands);
  return finish(box, 1, { color: TELEGRAPH.sumiColor, blur: 0, baseAlpha: 1, dabs: [], lightColor: null, puddles: [], fibers: [], strands, bakeScale: TELEGRAPH.inkDryBakeScale });
}

// -----------------------------------------------------------------------------
// 形のキャッシュ
// -----------------------------------------------------------------------------

const GEO_CACHE_MAX = 600;
const geoCache = new Map<string, BrushGeo>();
const BAKE_CACHE_MAX = 500;
const bakeCache = new Map<string, BakeSrc>();

function remember(key: string, make: () => BrushLayer[]): BrushGeo {
  const hit = geoCache.get(key);
  if (hit) return hit;
  if (geoCache.size >= GEO_CACHE_MAX) geoCache.clear();
  const geo: BrushGeo = { layers: make(), paths: null };
  geoCache.set(key, geo);
  return geo;
}

/** 焼く絵の材料を覚える（形の鍵ごと。窓つきの形も全長の絵を区間で切って使う） */
function rememberBake(key: string, make: () => BakeSrc): BakeSrc {
  const hit = bakeCache.get(key);
  if (hit) return hit;
  if (bakeCache.size >= BAKE_CACHE_MAX) clearBakes();
  const src = make();
  bakeCache.set(key, src);
  return src;
}

/** 筆 1 本の層を作る。shapeKey は量子化した形の鍵（焼く絵の共有に使う） */
function build(st: Stroke, stage: BrushStage, gs: number, win: Win, shapeKey: string): BrushLayer[] {
  if (stage === "sketch") return sketchLayers(st, win, rememberBake(`s|${shapeKey}|${gs}`, () => sketchSrc(st, gs / GAP_STEPS)));
  const halo = rememberBake(`h|${shapeKey}`, () => gofunSrc(st));
  const dry = rememberBake(`d|${shapeKey}`, () => drySrc(st));
  return inkLayers(st, stage, win, halo, dry);
}

/**
 * 直線の筆（長さは量子化済み）。side は帯の寄せ。
 * win が全長でないとき（自分の体の上を切った残り）はキャッシュせずに作る（切る位置は自分の動きで毎回違うため）。焼いた絵は全長の物を区間で切って置く
 */
export function lineGeo(stage: BrushStage, length: number, variant: number, gap: number, side: number, win: Win | null = null): BrushGeo {
  const gs = stage === "sketch" ? gapStep(gap) : 0;
  const st: Stroke = { map: lineMap, length, side, seed: variant * 101 + Math.round(length), widthMul: 1 };
  const shapeKey = `l|${length.toFixed(2)}|${variant}|${side}`;
  if (win) return { layers: build(st, stage, gs, win, shapeKey), paths: null };
  return remember(`${stage}|${shapeKey}|${gs}`, () => build(st, stage, gs, { from: 0, to: length }, shapeKey));
}

/** 小さな輪・扇は筆を細くする（太い帯と滲みが範囲の中を埋めて、中の物を隠さないように） */
function areaWidthMul(radius: number): number {
  return Math.min(1, (radius * TELEGRAPH.areaWidthRatio) / TELEGRAPH.brushWidth);
}

/** 弧の筆（半径は量子化済み。弧の内側が +n）。sweep は弧の角度 rad */
export function arcGeo(stage: BrushStage, radius: number, sweep: number, variant: number, gap: number): BrushGeo {
  const gs = stage === "sketch" ? gapStep(gap) : 0;
  const length = sweep * radius;
  const st: Stroke = { map: arcMap(radius), length, side: 1, seed: variant * 101 + Math.round(radius) + 7, widthMul: areaWidthMul(radius) };
  const shapeKey = `a|${radius.toFixed(2)}|${sweep.toFixed(3)}|${variant}`;
  return remember(`${stage}|${shapeKey}|${gs}`, () => build(st, stage, gs, { from: 0, to: length }, shapeKey));
}

/**
 * 扇の筆（射程は量子化済み）。要から右（+x）を中心に ±half の扇を、要 → 左の辺 → 弧 → 右の辺 → 要の 1 筆でなぞる。
 * 帯は扇の内側へ寄せる（判定の外へ太らせない）。r0 は辺の書き始めの要からの距離（敵の体の縁）
 */
export function fanGeo(stage: BrushStage, range: number, half: number, r0: number, variant: number, gap: number): BrushGeo {
  const gs = stage === "sketch" ? gapStep(gap) : 0;
  const shapeKey = `f|${range.toFixed(2)}|${half.toFixed(3)}|${r0.toFixed(1)}|${variant}`;
  return remember(`${stage}|${shapeKey}|${gs}`, () => {
    const path = polyPath(fanPoints(range, half, r0));
    const st: Stroke = { map: path.map, length: path.length, side: 1, seed: variant * 101 + Math.round(range) + 13, widthMul: areaWidthMul(range) };
    return build(st, stage, gs, { from: 0, to: path.length }, shapeKey);
  });
}

const FAN_ARC_STEP = 2;

function fanPoints(range: number, half: number, r0: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const from = Math.min(r0, range * 0.5);
  pts.push({ x: Math.cos(-half) * from, y: Math.sin(-half) * from });
  pts.push({ x: Math.cos(-half) * range, y: Math.sin(-half) * range });
  const n = Math.max(2, Math.ceil((range * half * 2) / FAN_ARC_STEP));
  for (let i = 1; i <= n; i++) {
    const a = -half + (half * 2 * i) / n;
    pts.push({ x: Math.cos(a) * range, y: Math.sin(a) * range });
  }
  pts.push({ x: Math.cos(half) * from, y: Math.sin(half) * from });
  return pts;
}

const POLY_CACHE_MAX = 64;
const polyCache = new Map<string, BrushGeo>();

/**
 * 折れ線の筆（陣図の画）。点はそのままの座標（回さない）。widthMul は太さの倍率。
 * 点が変わらない間は同じ形を返す（座標を丸めた鍵で覚える）
 */
export function polyGeo(stage: BrushStage, points: readonly { x: number; y: number }[], id: number, gap: number, widthMul = 1): BrushGeo {
  const gs = stage === "sketch" ? gapStep(gap) : 0;
  const shapeKey = `p|${widthMul}|${id}|${points.map((p) => `${Math.round(p.x * 2)},${Math.round(p.y * 2)}`).join(";")}`;
  const key = `${stage}|${gs}|${shapeKey}`;
  const hit = polyCache.get(key);
  if (hit) return hit;
  if (polyCache.size >= POLY_CACHE_MAX) polyCache.clear();
  const path = polyPath(points);
  const st: Stroke = { map: path.map, length: path.length, side: 0, seed: variantOf(id) * 101 + Math.round(path.length) + 29, widthMul };
  const geo: BrushGeo = { layers: build(st, stage, gs, { from: 0, to: path.length }, shapeKey), paths: null };
  polyCache.set(key, geo);
  return geo;
}

// -----------------------------------------------------------------------------
// 焼く（滲み・毛の束・朱の点）
// -----------------------------------------------------------------------------

let bakedPixels = 0;
/** 画像を持っている材料（予算を超えたら画像だけ捨てて、次に置くときに焼き直す） */
const baked: BakeSrc[] = [];

function dropImages(): void {
  for (const s of baked) s.image = undefined;
  baked.length = 0;
  bakedPixels = 0;
}

function clearBakes(): void {
  bakeCache.clear();
  dropImages();
}

/** ぼかしの filter が使えるか（使えない環境は判子を少しずつ大きく重ねて代える） */
function canBlur(c: CanvasRenderingContext2D): boolean {
  c.filter = "blur(1px)";
  const ok = c.filter === "blur(1px)";
  c.filter = "none";
  return ok;
}

function circlesPath(c: CanvasRenderingContext2D, circles: readonly number[], grow: number): void {
  c.beginPath();
  for (let i = 0; i + 2 < circles.length; i += 3) {
    const x = circles[i] ?? 0;
    const y = circles[i + 1] ?? 0;
    const r = Math.max(0.1, (circles[i + 2] ?? 0) + grow);
    c.moveTo(x + r, y);
    c.arc(x, y, r, 0, TWO_PI);
  }
}

/** 判子の和をぼかして塗る。ぼかしが無ければ、広げた輪郭を薄く重ねて縁を柔らかくする */
function fillSoft(c: CanvasRenderingContext2D, circles: readonly number[], blur: number, scale: number, blurOk: boolean, alpha: number): void {
  if (blurOk) {
    c.filter = `blur(${blur * scale}px)`;
    c.globalAlpha = alpha;
    circlesPath(c, circles, 0);
    c.fill();
    c.filter = "none";
    return;
  }
  const steps = 3;
  for (let i = steps; i >= 1; i--) {
    c.globalAlpha = alpha / (steps + 1);
    circlesPath(c, circles, (blur * i) / steps);
    c.fill();
  }
  c.globalAlpha = alpha;
  circlesPath(c, circles, -blur / 2);
  c.fill();
}

function strokeStrands(c: CanvasRenderingContext2D, sets: readonly StrandSet[]): void {
  c.lineCap = "round";
  c.lineJoin = "round";
  for (const set of sets) {
    c.strokeStyle = set.color;
    c.lineWidth = set.width;
    c.globalAlpha = set.alpha;
    // 1 本ずつ引いて、重なった所を濃くする（毛の束の密度が濃淡になる）
    for (const part of set.parts) {
      c.beginPath();
      c.moveTo(part[0] ?? 0, part[1] ?? 0);
      for (let i = 2; i + 1 < part.length; i += 2) c.lineTo(part[i] ?? 0, part[i + 1] ?? 0);
      c.stroke();
    }
  }
}

function bake(src: BakeSrc): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const scale = src.bakeScale;
  const w = Math.max(1, Math.ceil((src.x1 - src.x0) * scale));
  const h = Math.max(1, Math.ceil((src.y1 - src.y0) * scale));
  if (bakedPixels + w * h > BAKE_PIXEL_BUDGET) dropImages();
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext("2d");
  if (!c) return null;
  bakedPixels += w * h;
  baked.push(src);
  c.setTransform(scale, 0, 0, scale, -src.x0 * scale, -src.y0 * scale);
  const blurOk = src.blur > 0 && canBlur(c);
  if (src.dabs.length > 0) {
    c.fillStyle = src.color;
    fillSoft(c, src.dabs, src.blur, scale, blurOk, src.baseAlpha);
  }
  if (src.lightColor && src.puddles.length > 0) {
    c.fillStyle = src.lightColor;
    fillSoft(c, src.puddles, src.blur * 0.4, scale, blurOk, src.baseAlpha * PUDDLE_ALPHA);
  }
  if (src.fibers.length > 0) {
    c.strokeStyle = src.color;
    c.lineWidth = FIBER_WIDTH;
    c.lineCap = "round";
    c.globalAlpha = FIBER_ALPHA;
    c.beginPath();
    for (let i = 0; i + 3 < src.fibers.length; i += 4) {
      c.moveTo(src.fibers[i] ?? 0, src.fibers[i + 1] ?? 0);
      c.lineTo(src.fibers[i + 2] ?? 0, src.fibers[i + 3] ?? 0);
    }
    c.stroke();
  }
  strokeStrands(c, src.strands);
  return canvas;
}

function bakedImage(src: BakeSrc): HTMLCanvasElement | null {
  if (src.image === undefined) src.image = bake(src);
  return src.image;
}


/** 朱の点の絵（変種ごとに 1 度だけ焼く）。kind: pool = 入りの墨溜まり（照り付き）、tip = 線の先端の点 */
export type ShuKind = "pool" | "tip";

const SHU_RES = 4;
const shuCache = new Map<string, HTMLCanvasElement | null>();

function shuRadius(kind: ShuKind): number {
  return kind === "pool" ? TELEGRAPH.shuPoolRadius : TELEGRAPH.shuTipRadius;
}

function blobPath(c: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number): void {
  c.beginPath();
  for (let i = 0; i <= BLOB_SIDES; i++) {
    const a = (i / BLOB_SIDES) * TWO_PI;
    const rr = r * (1 + (noise1(i * 0.9, seed) - 0.5) * 2 * BLOB_ROUGH);
    if (i === 0) c.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
}

/** 朱の点を ctx に直接描く（中心 x, y。論理 px） */
export function paintShu(c: CanvasRenderingContext2D, kind: ShuKind, x: number, y: number, variant: number): void {
  const r = shuRadius(kind);
  c.fillStyle = TELEGRAPH.shuColor;
  blobPath(c, x, y, r, 300 + variant * 7);
  c.fill();
  if (kind !== "pool") return;
  c.globalAlpha *= SHU_LIGHT_ALPHA;
  c.fillStyle = TELEGRAPH.shuLightColor;
  blobPath(c, x - r * SHU_LIGHT_OFFSET, y - r * SHU_LIGHT_OFFSET, r * SHU_LIGHT_RADIUS, 330 + variant * 7);
  c.fill();
}

function shuImage(kind: ShuKind, variant: number): HTMLCanvasElement | null {
  const key = `${kind}|${variant}`;
  const hit = shuCache.get(key);
  if (hit !== undefined) return hit;
  if (typeof document === "undefined") return null;
  const size = shuRadius(kind) * 3;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(size * SHU_RES);
  canvas.height = Math.ceil(size * SHU_RES);
  const c = canvas.getContext("2d");
  if (!c) {
    shuCache.set(key, null);
    return null;
  }
  c.scale(SHU_RES, SHU_RES);
  paintShu(c, kind, size / 2, size / 2, variant);
  shuCache.set(key, canvas);
  return canvas;
}

/** 朱の点を置く（中心 x, y は ctx の今の座標）。焼けない環境では直接描く */
export function stampShu(ctx: CanvasRenderingContext2D, kind: ShuKind, x: number, y: number, variant: number, alpha: number): void {
  ctx.globalAlpha = alpha;
  const img = shuImage(kind, variant);
  if (!img) {
    paintShu(ctx, kind, x, y, variant);
    ctx.globalAlpha = 1;
    return;
  }
  const size = shuRadius(kind) * 3;
  ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
  ctx.globalAlpha = 1;
}

// -----------------------------------------------------------------------------
// 描く
// -----------------------------------------------------------------------------

/** 層の色と濃さ（焼いた絵の層は焼いた色のまま。濃さだけ掛ける） */
function toneAlpha(tone: Tone): number {
  return tone === "inkHalo" ? TELEGRAPH.inkHaloAlpha : 1;
}

/** Path2D の無い環境（単体テスト）の代わり。形は持たず、塗る色の記録だけを通す */
class NullPath {
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
}
type AnyPath = Path2D | NullPath;
const newPath = (): AnyPath => (typeof Path2D === "function" ? new Path2D() : new NullPath());

function pathsOf(geo: BrushGeo): (AnyPath | null)[] {
  if (geo.paths) return geo.paths;
  const built = geo.layers.map((layer) => {
    if (layer.kind !== "fill") return null;
    const path = newPath();
    for (const part of layer.parts) {
      path.moveTo(part[0] ?? 0, part[1] ?? 0);
      for (let i = 2; i < part.length; i += 2) path.lineTo(part[i] ?? 0, part[i + 1] ?? 0);
      path.closePath();
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

/** 置いた 1 本（行列は局所 → 世界） */
interface Placement {
  geo: BrushGeo;
  m: Matrix;
  alpha: number;
  haloMul: number;
  variant: number;
}

/**
 * 筆を置くペン。呼び出し時の変換（カメラと拡大）を覚えておき、置いた筆を end() でまとめて層の順に描く
 * （下絵の滲み → 下絵の筋 → 墨入れの胡粉 → 墨 → 朱）。形ごとの行列は setTransform で直接渡す（save / restore を使わない）
 */
export class BrushPen {
  private readonly base: Matrix;
  private readonly queue: Placement[] = [];

  constructor(private readonly ctx: CanvasRenderingContext2D) {
    const t = ctx.getTransform() as DOMMatrix | undefined;
    this.base = t && typeof t.a === "number" ? { a: t.a, b: t.b, c: t.c, d: t.d, e: t.e, f: t.f } : IDENTITY;
  }

  /** 形を局所行列 m で回して置く。alphaMul は全体の濃さ、haloMul は滲みだけの倍率（攻撃の直前で胡粉を濃く・被弾筋で薄く） */
  geo(geo: BrushGeo, m: Matrix, alphaMul = 1, haloMul = 1, variant = 0): void {
    if (alphaMul <= 0) return;
    this.queue.push({ geo, m, alpha: alphaMul, haloMul, variant });
  }

  /** 置いた筆を層の順に描き、元の変換へ戻す */
  end(): void {
    const { ctx, base } = this;
    const smoothing = ctx.imageSmoothingEnabled;
    for (const tone of TONE_ORDER) {
      for (const p of this.queue) {
        p.geo.layers.forEach((layer, i) => {
          if (layer.tone === tone) this.drawLayer(p, layer, i);
        });
      }
    }
    this.queue.length = 0;
    ctx.imageSmoothingEnabled = smoothing;
    ctx.setTransform(base.a, base.b, base.c, base.d, base.e, base.f);
    ctx.globalAlpha = 1;
  }

  private place(m: Matrix): void {
    const { ctx, base } = this;
    ctx.setTransform(
      base.a * m.a + base.c * m.b,
      base.b * m.a + base.d * m.b,
      base.a * m.c + base.c * m.d,
      base.b * m.c + base.d * m.d,
      base.a * m.e + base.c * m.f + base.e,
      base.b * m.e + base.d * m.f + base.f,
    );
  }

  private drawLayer(p: Placement, layer: BrushLayer, index: number): void {
    const { ctx } = this;
    if (layer.kind === "shu") {
      // 朱の点は画面の向きのまま置く（照りを左上に保つ）
      const { base } = this;
      ctx.setTransform(base.a, base.b, base.c, base.d, base.e, base.f);
      for (let i = 0; i + 1 < layer.dots.length; i += 2) {
        const x = layer.dots[i] ?? 0;
        const y = layer.dots[i + 1] ?? 0;
        stampShu(ctx, "pool", p.m.a * x + p.m.c * y + p.m.e, p.m.b * x + p.m.d * y + p.m.f, p.variant, Math.min(1, p.alpha));
      }
      return;
    }
    this.place(p.m);
    if (layer.kind === "image") {
      const haloMul = layer.tone === "inkHalo" ? p.haloMul : 1;
      this.drawImageLayer(layer, Math.min(1, toneAlpha(layer.tone) * p.alpha * haloMul));
      return;
    }
    if (layer.parts.length === 0) return;
    const path = pathsOf(p.geo)[index] as Path2D | undefined | null;
    if (!path) return;
    ctx.globalAlpha = Math.min(1, toneAlpha(layer.tone) * p.alpha);
    ctx.fillStyle = TELEGRAPH.sumiColor;
    ctx.fill(path);
  }

  /** 焼いた絵を置く（直線の筆は区間 from..to だけを切り出す） */
  private drawImageLayer(layer: ImageLayer, alpha: number): void {
    const { ctx } = this;
    const src = layer.src;
    if (alpha <= 0) return;
    const img = bakedImage(src);
    if (!img) {
      // 画像を焼けない環境（単体テスト）では毛の束だけを線で引く（何を描いたかを数えられるように）
      ctx.globalAlpha = alpha;
      strokeStrands(ctx, src.strands);
      return;
    }
    const from = Math.max(layer.from, src.x0);
    const to = Math.min(layer.to, src.x1);
    if (to - from <= 0) return;
    const sx = (img.width * (from - src.x0)) / (src.x1 - src.x0);
    const sw = (img.width * (to - from)) / (src.x1 - src.x0);
    if (sw <= 0) return;
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, sx, 0, sw, img.height, from, src.y0, to - from, src.y1 - src.y0);
  }
}

/** 線に沿った区間（根元からの距離 px） */
export interface BrushSpan {
  from: number;
  to: number;
}

/**
 * 直線の筆を 1 本置く。pieces は描く区間（自分の体の上を切った残り。null なら全長）。
 * lateral は線の横へずらす距離（擦れて散る動き）、side は帯の寄せ、haloMul は滲みの濃さの倍率
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
  haloMul = 1,
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
    pen.geo(lineGeo(stage, lq, variant, gap, side), m, alphaMul, haloMul, variant);
    return;
  }
  for (const pc of pieces) pen.geo(lineGeo(stage, lq, variant, gap, side, { from: pc.from / k, to: pc.to / k }), m, alphaMul, haloMul, variant);
}

/** 弧の筆を 1 本置く。a0 から sweep rad。弧の内側へ帯が広がる（判定の外へ太らせない） */
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
  haloMul = 1,
): void {
  if (!(radius > 0)) return;
  const rq = quantLen(radius);
  const k = radius / rq;
  const cos = Math.cos(a0);
  const sin = Math.sin(a0);
  const variant = variantOf(id);
  pen.geo(arcGeo(stage, rq, sweep, variant, gap), { a: cos * k, b: sin * k, c: -sin * k, d: cos * k, e: cx, f: cy }, alphaMul, haloMul, variant);
}

/** 扇の筆を 1 本置く（要 cx, cy、中心の向き base rad、半角 half rad、辺の書き始め r0） */
export function placeBrushFan(
  pen: BrushPen,
  cx: number,
  cy: number,
  range: number,
  base: number,
  half: number,
  r0: number,
  stage: BrushStage,
  id: number,
  gap: number,
  alphaMul = 1,
  haloMul = 1,
): void {
  if (!(range > 0)) return;
  const rq = quantLen(range);
  const k = range / rq;
  const cos = Math.cos(base);
  const sin = Math.sin(base);
  const variant = variantOf(id);
  pen.geo(fanGeo(stage, rq, half, Math.round(r0 / k), variant, gap), { a: cos * k, b: sin * k, c: -sin * k, d: cos * k, e: cx, f: cy }, alphaMul, haloMul, variant);
}

/** 折れ線の筆を置く（座標はそのまま。dx, dy は全体のずれ = 擦れて散る動き） */
export function placeBrushPoly(pen: BrushPen, points: readonly { x: number; y: number }[], stage: BrushStage, id: number, gap: number, alphaMul = 1, widthMul = 1, dx = 0, dy = 0): void {
  if (points.length < 2) return;
  pen.geo(polyGeo(stage, points, id, gap, widthMul), { ...IDENTITY, e: dx, f: dy }, alphaMul, 1, variantOf(id));
}

/** 輪の筆の始点の角度（敵ごとに固定のハッシュ） */
export function ringStartAngle(id: number): number {
  return hash01(id, 31) * TWO_PI;
}

/** 輪は 1 周して始まりに少し重ねる（筆を引き切って始点の墨溜まりに被せる） */
export const RING_SWEEP = TWO_PI * 1.03;
