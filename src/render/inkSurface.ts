import { RENDER_SCALE, VIEW_H, VIEW_W } from "../core/view";

/**
 * 墨の予告の作業面（docs/ideas/ink-telegraph-impl.md 5 章）。画面ぶんの「絵のドット」（論理 0.5px = 攻撃エフェクトのスプライトと同じ密度）の
 * 画素列 1 枚に、下絵・面のむら・胡粉・墨・朱を硬い縁でラスタライズし、putImageData（汚れた矩形だけ）→ drawImage 1 回で画面へ置く。
 * 線ごとに canvas の塗りを呼ぶと 1 回ごとの固定費が乱戦で積もる（案 B の実測）ので、CPU で画素を直接書く。
 *
 * - 層の順はドットごとの印（層 × 8 + 段）で決める。上の層は下の層に上書きし（半透明なら重ねる）、同じ層は段の高い方が勝つ（同じ段なら後から置いた物）。
 *   なので呼ぶ順に依らず「下絵 → 面 → 胡粉 → 墨 → 印」に重なる（他の線の胡粉が墨を曇らせない）
 * - ばらつきは座標ハッシュ `dotHash` をワールドのドット（floor(world × 2)）で取る。カメラが動いても模様は泳がない。
 *   カメラは論理 px の整数に丸めてあるので、作業面のドットとワールドのドットは整数のずれで重なる
 * - state も rng も知らない（呼び側が形を渡す）
 */

/** 論理 1px あたりのドット数（絵の 1 ドット = 論理 0.5px） */
export const INK_DOTS = 2;

/** 層（下から）。印の値は 層 × LAYER_SHIFT + 段 */
export const INK_LAYER = {
  sketch: 1,
  fill: 2,
  halo: 3,
  ink: 4,
  mark: 5,
} as const;
export type InkLayerKey = keyof typeof INK_LAYER;

const LAYER_SHIFT = 8;
const BYTE = 255;
/** 不透明度の成分が 255 の ABGR */
const OPAQUE = 0xff000000;
/** ImageData の 1 画素の成分数 */
const RGBA = 4;

/** 4x4 の順序ディザ（0..15） */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const BAYER_N = 16;

/** 整数座標のハッシュ → [0, 1)（scripts/fx/raster.mjs の hash2 と同じ式。攻撃エフェクトの墨と同じ質のばらつき） */
export function dotHash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, -2048144777);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 4x4 の順序ディザの閾（(0.5..15.5) / 16）。ワールドのドットで引く */
export function bayer(wx: number, wy: number): number {
  return ((BAYER4[(wy & 3) * 4 + (wx & 3)] ?? 0) + 0.5) / BAYER_N;
}

/** "#rrggbb" → ABGR の Uint32（ImageData のリトルエンディアンの並び。不透明度の成分は 0） */
export function rgbOf(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = (n >> 16) & BYTE;
  const g = (n >> 8) & BYTE;
  const b = n & BYTE;
  return ((b << 16) | (g << 8) | r) >>> 0;
}

function hexOf(abgr: number): string {
  const r = abgr & BYTE;
  const g = (abgr >>> 8) & BYTE;
  const b = (abgr >>> 16) & BYTE;
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** 半透明の色を下の画素に重ねる（ストレートアルファの over） */
function over(dst: number, rgb: number, a: number): number {
  const da = (dst >>> 24) / BYTE;
  const oa = a + da * (1 - a);
  if (oa <= 0) return 0;
  const k = (da * (1 - a)) / oa;
  const s = a / oa;
  const r = (rgb & BYTE) * s + (dst & BYTE) * k;
  const g = ((rgb >>> 8) & BYTE) * s + ((dst >>> 8) & BYTE) * k;
  const b = ((rgb >>> 16) & BYTE) * s + ((dst >>> 16) & BYTE) * k;
  return ((Math.round(oa * BYTE) << 24) | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r)) >>> 0;
}

export class InkSurface {
  readonly w: number;
  readonly h: number;
  /** 画素（ABGR）。ImageData と同じ並び（同じ ArrayBuffer を共有する） */
  readonly px: Uint32Array;
  private readonly buffer: ArrayBuffer;
  /** ドットごとの層と段（層 × 8 + 段。0 = 空） */
  readonly mark: Uint8Array;
  /** 行ごとに書いた x の範囲（空の行は min > max） */
  private readonly rowMin: Int16Array;
  private readonly rowMax: Int16Array;
  private yMin: number;
  private yMax: number;
  /** ワールド → 画面の平行移動（論理 px の整数）。作業面のドット = (ワールド + ox) × 2 */
  ox = 0;
  oy = 0;
  /** 置いた色を集める（テスト用。null なら集めない） */
  recordColors: Set<string> | null = null;
  private canvas: HTMLCanvasElement | null | undefined;
  private canvasCtx: CanvasRenderingContext2D | null = null;
  private image: ImageData | null = null;

  constructor(w = VIEW_W * INK_DOTS, h = VIEW_H * INK_DOTS) {
    this.w = w;
    this.h = h;
    this.buffer = new ArrayBuffer(w * h * RGBA);
    this.px = new Uint32Array(this.buffer);
    this.mark = new Uint8Array(w * h);
    this.rowMin = new Int16Array(h).fill(w);
    this.rowMax = new Int16Array(h).fill(-1);
    this.yMin = h;
    this.yMax = -1;
  }

  /** 描き始め: 今の ctx の平行移動（ワールド → 画面）を読む。読めない（テストの偽の ctx）なら 0 */
  begin(ctx: CanvasRenderingContext2D): void {
    const t = typeof ctx.getTransform === "function" ? (ctx.getTransform() as DOMMatrix | undefined) : undefined;
    this.ox = t ? Math.round(t.e / RENDER_SCALE) : 0;
    this.oy = t ? Math.round(t.f / RENDER_SCALE) : 0;
  }

  /** ワールド座標 → 作業面のドット座標（小数のまま） */
  dotX(wx: number): number {
    return (wx + this.ox) * INK_DOTS;
  }

  dotY(wy: number): number {
    return (wy + this.oy) * INK_DOTS;
  }

  /** 作業面のドット → ワールドのドット（ハッシュの鍵） */
  worldX(x: number): number {
    return x - this.ox * INK_DOTS;
  }

  worldY(y: number): number {
    return y - this.oy * INK_DOTS;
  }

  /**
   * 1 ドットを置く。layer は INK_LAYER、level は層の中の段（0..7。高いほど勝つ）、rgb は rgbOf の色、alpha は不透明度。
   * 上の層が既にあれば置かない。同じ層の高い段・より濃い物があれば置かない
   */
  put(x: number, y: number, layer: number, level: number, rgb: number, alpha: number): void {
    if (this.putDot(x, y, layer, level, rgb, alpha)) this.touch(y, x, x);
  }

  /**
   * put の汚れの記録なし（置いたら true）。行ごとに走査する呼び側が、行の終わりに touch でまとめて記録する
   * （1 ドットごとに行の範囲を更新すると、細い線のラスタライズで目立つ重さになる）
   */
  putDot(x: number, y: number, layer: number, level: number, rgb: number, alpha: number): boolean {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    const i = y * this.w + x;
    const code = layer * LAYER_SHIFT + level;
    const mark = this.mark;
    const prev = mark[i] ?? 0;
    if (prev > code) return false;
    const px = this.px;
    if (alpha >= 1) {
      mark[i] = code;
      px[i] = (rgb | OPAQUE) >>> 0;
      return true;
    }
    const prevLayer = prev >> 3;
    const a = Math.round(alpha * BYTE);
    // 同じ層で薄い物は濃い物を上書きしない（薄れていく線が他の線に穴を開けない）
    if (prevLayer === layer && a < (px[i] ?? 0) >>> 24) return false;
    mark[i] = code;
    px[i] = prev === 0 || prevLayer === layer ? (rgb | (a << 24)) >>> 0 : over(px[i] ?? 0, rgb, alpha);
    return true;
  }

  /** 行 y の [xa, xb] を汚れとして記録する（作業面の外は切る） */
  touch(y: number, xa: number, xb: number): void {
    if (y < 0 || y >= this.h) return;
    const a = Math.max(0, xa);
    const b = Math.min(this.w - 1, xb);
    if (b < a) return;
    if (a < (this.rowMin[y] ?? this.w)) this.rowMin[y] = a;
    if (b > (this.rowMax[y] ?? -1)) this.rowMax[y] = b;
    if (y < this.yMin) this.yMin = y;
    if (y > this.yMax) this.yMax = y;
  }

  /**
   * 1 行の区間 [xa, xb] に、表の段を写す（面のむら。put を 1 ドットずつ呼ぶより速い。乱戦の大きな輪で効く）。
   * table は一辺 period（2 の冪）の表でワールドのドットで引く。1 バイト = 段（下位 3 ビット）| 塗り始める段（上位）で、上位が step 以下のドットだけ置く。
   * colors は段ごとの色（ABGR。不透明度の成分込み）、alpha はその不透明度
   */
  putTableRow(y: number, xa: number, xb: number, table: Uint8Array, period: number, layer: number, colors: Uint32Array, alpha: number, step: number): void {
    if (y < 0 || y >= this.h) return;
    const from = Math.max(0, xa);
    const to = Math.min(this.w - 1, xb);
    if (to < from) return;
    const mask = period - 1;
    const wy = (y - this.oy * INK_DOTS) & mask;
    const rowBase = wy * period;
    const shift = this.ox * INK_DOTS;
    const base = y * this.w;
    const layerCode = layer * LAYER_SHIFT;
    const stepLimit = (step + 1) << 3;
    // 配列は局所へ（ホットな行の中で this を引き直さない）
    const px = this.px;
    const mark = this.mark;
    let lo = this.w;
    let hi = -1;
    for (let x = from; x <= to; x++) {
      const v = table[rowBase + ((x - shift) & mask)] ?? 0;
      if (v === 0 || v >= stepLimit) continue;
      const level = v & 7;
      const i = base + x;
      const prev = mark[i] ?? 0;
      const code = layerCode + level;
      if (prev > code) continue;
      // 同じ層は置き換え（同じ面の重なりで濃くならない）。下の層があれば重ねる
      if (prev !== 0 && prev < layerCode) px[i] = over(px[i] ?? 0, (colors[level] ?? 0) & 0xffffff, alpha);
      else px[i] = colors[level] ?? 0;
      mark[i] = code;
      if (lo > x) lo = x;
      hi = x;
    }
    const wrote = hi >= 0;
    if (!wrote) return;
    if (lo < (this.rowMin[y] ?? this.w)) this.rowMin[y] = lo;
    if (hi > (this.rowMax[y] ?? -1)) this.rowMax[y] = hi;
    if (y < this.yMin) this.yMin = y;
    if (y > this.yMax) this.yMax = y;
  }

  /** そのドットの層（0 = 空） */
  layerAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return (this.mark[y * this.w + x] ?? 0) >> 3;
  }

  /** 円（ワールド座標）の中を抜く（自分の体の上）。描き込み全体に 1 回だけ掛ける */
  cutCircle(wx: number, wy: number, r: number): void {
    const cx = this.dotX(wx);
    const cy = this.dotY(wy);
    const rr = r * INK_DOTS;
    const y0 = Math.max(0, Math.floor(cy - rr));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + rr));
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      const half2 = rr * rr - dy * dy;
      if (half2 <= 0) continue;
      const half = Math.sqrt(half2);
      const x0 = Math.max(0, Math.ceil(cx - half - 0.5));
      const x1 = Math.min(this.w - 1, Math.floor(cx + half - 0.5));
      if (x1 < x0) continue;
      this.px.fill(0, y * this.w + x0, y * this.w + x1 + 1);
      this.mark.fill(0, y * this.w + x0, y * this.w + x1 + 1);
    }
  }

  /** 何か置いたか */
  get dirty(): boolean {
    return this.yMax >= this.yMin;
  }

  /** 汚れた矩形 [x0, y0, x1, y1]（含む）。空なら null */
  dirtyRect(): [number, number, number, number] | null {
    if (!this.dirty) return null;
    let x0 = this.w;
    let x1 = -1;
    for (let y = this.yMin; y <= this.yMax; y++) {
      const a = this.rowMin[y] ?? this.w;
      const b = this.rowMax[y] ?? -1;
      if (a < x0) x0 = a;
      if (b > x1) x1 = b;
    }
    return [x0, this.yMin, x1, this.yMax];
  }

  /** 画面へ置いて空に戻す（ctx は begin のときと同じ平行移動のまま呼ぶ） */
  flush(ctx: CanvasRenderingContext2D): void {
    const rect = this.dirtyRect();
    if (!rect) return;
    const [x0, y0, x1, y1] = rect;
    if (this.recordColors) this.collectColors();
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    if (this.ensureCanvas() && this.canvas && this.canvasCtx && this.image) {
      this.canvasCtx.putImageData(this.image, 0, 0, x0, y0, w, h);
      const alpha = ctx.globalAlpha;
      ctx.globalAlpha = 1;
      ctx.drawImage(this.canvas, x0, y0, w, h, x0 / INK_DOTS - this.ox, y0 / INK_DOTS - this.oy, w / INK_DOTS, h / INK_DOTS);
      ctx.globalAlpha = alpha;
    }
    this.clear();
  }

  /** 置いた物を捨てる（画面へは出さない） */
  clear(): void {
    for (let y = this.yMin; y <= this.yMax; y++) {
      const a = this.rowMin[y] ?? this.w;
      const b = this.rowMax[y] ?? -1;
      if (b < a) continue;
      this.px.fill(0, y * this.w + a, y * this.w + b + 1);
      this.mark.fill(0, y * this.w + a, y * this.w + b + 1);
      this.rowMin[y] = this.w;
      this.rowMax[y] = -1;
    }
    this.yMin = this.h;
    this.yMax = -1;
  }

  private collectColors(): void {
    const out = this.recordColors;
    if (!out) return;
    for (let y = this.yMin; y <= this.yMax; y++) {
      const a = this.rowMin[y] ?? this.w;
      const b = this.rowMax[y] ?? -1;
      for (let x = a; x <= b; x++) {
        const v = this.px[y * this.w + x] ?? 0;
        if (v >>> 24) out.add(hexOf(v));
      }
    }
  }

  /** 画面へ置く canvas（ブラウザだけ。テストでは作らず、flush は捨てるだけ） */
  private ensureCanvas(): boolean {
    if (this.canvas !== undefined) return this.canvas !== null;
    if (typeof document === "undefined" || typeof ImageData === "undefined") {
      this.canvas = null;
      return false;
    }
    const canvas = document.createElement("canvas");
    canvas.width = this.w;
    canvas.height = this.h;
    const c = canvas.getContext("2d");
    if (!c) {
      this.canvas = null;
      return false;
    }
    this.canvas = canvas;
    this.canvasCtx = c;
    this.image = new ImageData(new Uint8ClampedArray(this.buffer), this.w, this.h);
    return true;
  }
}

let shared: InkSurface | null = null;

/** 描画の全体で使い回す作業面（予告・陣図・地面の物の輪。描き込みは順に行い、flush で空に戻すので 1 枚で足りる） */
export function sharedInkSurface(): InkSurface {
  if (!shared) shared = new InkSurface();
  return shared;
}
