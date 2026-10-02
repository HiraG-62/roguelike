import RAMPS from "../data/fxRamps.json";
import { TELEGRAPH } from "../data/tuning";
import { INK_DOTS, INK_LAYER, type InkSurface, bayer, dotHash, rgbOf } from "./inkSurface";
import { noiseIndex, noiseTile } from "./inkNoise";
import { InkRecorder, InkShapeCache, replayRecord } from "./inkCache";
import { shuDot } from "./inkMarks";

/**
 * 墨の予告の筆（docs/ideas/ink-telegraph-impl.md 5 章。見本 docs/ideas/previews/ink-telegraph-px の A 案）。
 * プレイヤーの攻撃エフェクト（scripts/fx/ink.mjs の inkify）と同じ質の墨を、作業面のドットへ直接ラスタライズする。
 *
 * - 墨入れ: 芯が真っ黒・縁へ段が淡くなる（攻撃の無属性の配色 steel の 7 段）。縁の 1 ドットは淡い段で、座標ハッシュで齧る。
 *   太い所に線に沿った掠れの毛筋、外へ短い毛羽、周りに疎らな飛沫。外側の 1 ドットに胡粉の滲み（ぼかさない）。入りの墨溜まりに朱の点
 * - 下絵: 同じ筆の形を淡墨（低い段）で、市松に間引いて半透明に見せる（縁のドットは残す）。線に沿って掠れて途切れ、欠けの割合（怯み値）で欠けが増える
 * - 被弾筋: 朱を持たない墨入れ（胡粉も薄い）
 * 筆の形は入りの押さえ → 墨溜まり → 胴 → 抜きの払い（案 B の BrushPen と同じ考え方）。
 *
 * 総当たりを避ける: 線は行ごとに帯の区間だけ、弧は行ごとに輪の区間だけを調べ、ドットごとに「道に沿った距離 s・横のずれ n」を出して塗る。
 * 縁の齧り・毛羽・筋のうねりはワールドのドットの座標ハッシュ（カメラが動いても泳がない）、毛筋の並びと飛沫は筆の局所座標のハッシュ（筆と一緒に動く）
 */

export type BrushStage = "sketch" | "ink" | "trace";

/** 墨の配色（段 1 = 淡墨の縁 … 段 7 = 芯の真っ黒）。攻撃エフェクトの無属性と同じ表を読む */
export const INK_RAMP: readonly number[] = RAMPS.steel.map(rgbOf);
export const INK_LEVELS = INK_RAMP.length;

/** 段（0..7。0 は段 1 と同じ）→ 色の表 */
const RGB_BY_LEVEL = Uint32Array.from({ length: INK_LEVELS + 1 }, (_, l) => INK_RAMP[Math.max(1, l) - 1] ?? 0);

export function inkRgb(level: number): number {
  return RGB_BY_LEVEL[level] ?? RGB_BY_LEVEL[INK_LEVELS] ?? 0;
}

/** 段ごとの色に不透明度の成分を入れた表（putTableRow 用） */
export function inkColorsWithAlpha(alpha: number): Uint32Array {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
  return RGB_BY_LEVEL.map((rgb) => (rgb | (a << 24)) >>> 0);
}

/** 明るさ v（0..1）→ 段 の境目（scripts/fx/raster.mjs の LEVEL_EDGES と同じ） */
const LEVEL_EDGES = [0.1, 0.2, 0.32, 0.46, 0.62, 0.8];
/** 段のディザの強さ（raster.mjs の paint と同じ） */
const LEVEL_DITHER = 0.08;

export function levelOf(v: number): number {
  let level = 1;
  for (const edge of LEVEL_EDGES) if (v >= edge) level++;
  return level;
}

/** 明るさ（0..1 を 256 段）→ 段 の表（毎ドットの比較の繰り返しを避ける） */
const LEVEL_STEPS = 255;
const LEVEL_LUT = Uint8Array.from({ length: LEVEL_STEPS + 1 }, (_, i) => levelOf(i / LEVEL_STEPS));

function levelFast(v: number): number {
  const i = v <= 0 ? 0 : v >= 1 ? LEVEL_STEPS : Math.round(v * LEVEL_STEPS);
  return LEVEL_LUT[i] ?? 1;
}

// ---- 筆の形（論理 px の定数はドットへ直して使う） ----
/** 入りが太り終わる距離と墨溜まりの長さ（論理 px） */
const ENTRY_PX = 3;
const POOL_PX = 3;
/** 筆圧のゆらぎ（太さの倍率の振れ幅）と、ゆらぎの格子（ドット） */
const PRESSURE_WAVE = 0.2;
const PRESSURE_CELL = 18;

// ---- 墨入れの質（scripts/fx/ink.mjs の inkify と同じ値） ----
/** 縁の段・毛羽と飛沫の段 */
const RIM_LEVEL = 1;
const HAIR_LEVEL = 2;
/** 縁を齧る割合・外へ毛を出す割合・2 ドット目まで伸びる毛の割合 */
const NIBBLE = 0.22;
const HAIR = 0.16;
const HAIR_FAR = 0.05;
/** 毛羽と飛沫を出す太さ（半幅のドット） */
const THICK = 3;
/** 掠れの毛筋を開ける太さ（半幅のドット）と、縁からの深さの下限（ドット） */
const STREAK_THICK = 5;
const STREAK_DEPTH = 2;
/** 毛筋の間隔・そのうち隙間にする幅の割合・毛筋が隙間になる割合 */
const STREAK_PITCH = 2.6;
const STREAK_LINE = 0.42;
const STREAK_GAP = 0.5;
/** 毛筋のうねりの格子（ドット）と強さ（ドット） */
const STREAK_WARP_CELL = 16;
const STREAK_WARP = 2.2;
/** 毛筋を線に沿って途切れさせる区切りの長さ（ドット）と、区切りが掠れを持つ割合 */
const BREAK_LEN = 11;
const BREAK_ON = 0.62;
/** 芯（段 7）は掠れを減らす */
const CORE_GAP_MUL = 0.45;
/** 掠れの毛筋のうち、抜かずに淡くする割合と淡くする段数 */
const DARK_STRAND = 0.35;
const DARK_STEP = 2;
/** 飛沫: 縁からの距離の範囲（ドット）と、道 1 ドットあたりの出る率・2 ドットになる率 */
const SPLASH_MIN = 3;
const SPLASH_MAX = 9;
const SPLASH_PER_DOT = 0.07;
const SPLASH_PAIR = 0.35;
/** 胡粉の滲みの届く幅（縁の外のドット） */
const HALO_REACH = 1;
/** 入りの飛沫の広がりの角度 rad と、粒の段の範囲 */
const SPLAT_CONE = 2.4;
const SPLAT_LEVEL_MIN = 2;
const SPLAT_LEVELS = 4;
/** 抜きの先の淡さの段 */
const LEVEL_CURVE = 1.6;
const ACROSS_STEPS = 64;

// ---- 下絵 ----
/** 掠れの筋の数（横に割る帯）と、縁とみなす横の位置（これより外は淡い段） */
const SKETCH_LANES = 3;
const SKETCH_EDGE_ACROSS = 0.72;
const SKETCH_EDGE_LEVEL = 1;
const SKETCH_BODY_LEVEL = 2;
/** 根元と先端は必ず描く長さ（論理 px。向きと届きを見せる） */
const ROOT_PX = 8;
const TIP_PX = 5;

// ---- ハッシュの種 ----
const SEED_NIBBLE = 0x6b1d;
const SEED_HAIR = 0x51a7;
const SEED_FAR = 0x77;
const SEED_WARP = 0x2f31;
const SEED_SPLASH = 0x9e3;
const SEED_SPLAT = 0x5917;
const SEED_LANE = 0x3;

/** 毎ドット読む数値（モジュールの読み込み時に 1 回だけ読む） */
const INK_FALL = TELEGRAPH.inkFall;
const INK_DRY = TELEGRAPH.inkDry;
const SKETCH_ALPHA = TELEGRAPH.sketchAlpha;
/** 毛筋の番号の表の片側の数（筆の半幅より十分広い） */
const STRAND_SPAN = 32;

/** 横の位置 → 段の明るさの落ち（across^1.6 の表。毎ドットの pow を避ける） */
const FALL_CURVE = new Float32Array(ACROSS_STEPS + 1).map((_, i) => (i / ACROSS_STEPS) ** LEVEL_CURVE);

// -----------------------------------------------------------------------------
// 道（作業面のドット座標）
// -----------------------------------------------------------------------------

/** 直線の区間。s0 は道の始めからの距離 */
interface LinePiece {
  kind: "line";
  ax: number;
  ay: number;
  dx: number;
  dy: number;
  len: number;
  s0: number;
}

/** 弧の区間（角度が増える向きに進む）。横のずれ n は中心の側が正 */
interface ArcPiece {
  kind: "arc";
  cx: number;
  cy: number;
  r: number;
  a0: number;
  sweep: number;
  s0: number;
}

type Piece = LinePiece | ArcPiece;

/** 筆の道。横のずれ n は「進む向きの左」（弧・扇では内側）が正 */
export interface InkPath {
  pieces: Piece[];
  length: number;
}

function linePiece(x0: number, y0: number, x1: number, y1: number, s0: number): LinePiece | null {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (!(len > 0)) return null;
  return { kind: "line", ax: x0, ay: y0, dx: (x1 - x0) / len, dy: (y1 - y0) / len, len, s0 };
}

export function linePath(x0: number, y0: number, x1: number, y1: number): InkPath {
  const p = linePiece(x0, y0, x1, y1, 0);
  return p ? { pieces: [p], length: p.len } : { pieces: [], length: 0 };
}

export function polyPath(points: readonly { x: number; y: number }[]): InkPath {
  const pieces: Piece[] = [];
  let s = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    const p = linePiece(a.x, a.y, b.x, b.y, s);
    if (!p) continue;
    pieces.push(p);
    s += p.len;
  }
  return { pieces, length: s };
}

export function arcPath(cx: number, cy: number, r: number, a0: number, sweep: number): InkPath {
  if (!(r > 0) || !(sweep > 0)) return { pieces: [], length: 0 };
  return { pieces: [{ kind: "arc", cx, cy, r, a0, sweep, s0: 0 }], length: r * sweep };
}

/** 扇: 要の外（r0）→ 左の辺 → 弧 → 右の辺 → 要の外の 1 筆（内側が正） */
export function fanPath(cx: number, cy: number, range: number, base: number, half: number, r0: number): InkPath {
  const from = Math.min(r0, range * 0.5);
  const a0 = base - half;
  const a1 = base + half;
  const pieces: Piece[] = [];
  let s = 0;
  const left = linePiece(cx + Math.cos(a0) * from, cy + Math.sin(a0) * from, cx + Math.cos(a0) * range, cy + Math.sin(a0) * range, s);
  if (left) {
    pieces.push(left);
    s += left.len;
  }
  pieces.push({ kind: "arc", cx, cy, r: range, a0, sweep: half * 2, s0: s });
  s += range * half * 2;
  const right = linePiece(cx + Math.cos(a1) * range, cy + Math.sin(a1) * range, cx + Math.cos(a1) * from, cy + Math.sin(a1) * from, s);
  if (right) {
    pieces.push(right);
    s += right.len;
  }
  return { pieces, length: s };
}

/** 道の上の点と進む向き（単位）。道の外は端の向きへ伸ばす */
export function pathPoint(path: InkPath, s: number): { x: number; y: number; tx: number; ty: number } {
  let piece = path.pieces[0];
  for (const p of path.pieces) {
    if (p.s0 > s) break;
    piece = p;
  }
  if (!piece) return { x: 0, y: 0, tx: 1, ty: 0 };
  const t = s - piece.s0;
  if (piece.kind === "line") return { x: piece.ax + piece.dx * t, y: piece.ay + piece.dy * t, tx: piece.dx, ty: piece.dy };
  const a = piece.a0 + Math.max(0, Math.min(piece.sweep, t / piece.r));
  return { x: piece.cx + Math.cos(a) * piece.r, y: piece.cy + Math.sin(a) * piece.r, tx: -Math.sin(a), ty: Math.cos(a) };
}

// -----------------------------------------------------------------------------
// 筆の太さ
// -----------------------------------------------------------------------------

/** 1 次元のなめらかな雑音 0..1（筆圧のゆらぎ） */
function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return dotHash(i, 0, seed) * (1 - u) + dotHash(i + 1, 0, seed) * u;
}

/**
 * 筆の半幅（ドット）の表。添字は道に沿った距離（ドット）。入りの押さえ → 墨溜まり → 胴 → 抜きの払い + 筆圧のゆらぎ。
 * width は筆の全幅（ドット）
 */
export function brushProfile(length: number, width: number, seed: number): Float32Array {
  const n = Math.max(1, Math.ceil(length)) + 1;
  const out = new Float32Array(n);
  const entry = ENTRY_PX * INK_DOTS;
  const pool = POOL_PX * INK_DOTS;
  const tail = Math.min(TELEGRAPH.brushTailPx * INK_DOTS, length * TELEGRAPH.brushTailRatio);
  for (let s = 0; s < n; s++) {
    let k = 1;
    if (s < entry) k = TELEGRAPH.brushEntryMin + (1 - TELEGRAPH.brushEntryMin) * (s / entry);
    else if (s < entry + pool) k = 1 + TELEGRAPH.brushPoolScale * Math.sin(((s - entry) / pool) * Math.PI);
    if (tail > 0 && s > length - tail) k *= 1 - TELEGRAPH.brushTailDrop * Math.min(1, (s - (length - tail)) / tail);
    k *= 1 - PRESSURE_WAVE / 2 + PRESSURE_WAVE * noise1(s / PRESSURE_CELL, seed);
    out[s] = (width / 2) * Math.max(0, k);
  }
  return out;
}

// -----------------------------------------------------------------------------
// ラスタライズ
// -----------------------------------------------------------------------------

export interface BrushOpts {
  stage: BrushStage;
  /** 筆の変種（毛筋の並び・筆圧のゆらぎ・飛沫） */
  seed: number;
  /** 筆の全幅（ドット） */
  width: number;
  /** 帯の寄せ（0 = 道が中央、1 = 道から内側〔n の正〕だけに広がる。範囲の縁は判定の外へ太らせない） */
  side: number;
  /** 下絵の欠けの割合（0..1） */
  gap: number;
  /** 濃さ（不透明度の倍率。擦れて散る・逸れて薄れる・被弾筋の乾き・折れ線の 2 本目。間引くと下絵の市松と紛れるので間引かない） */
  alpha: number;
  /** 胡粉の滲みの濃さの倍率（攻撃の直前で濃い） */
  haloMul: number;
  /** 道の始めから描く（入りの朱と飛沫を置く） */
  entry: boolean;
}

/** 1 本の筆のラスタライズの状態（ドットごとの塗りを 1 か所にまとめる） */
class BrushRaster {
  readonly prof: Float32Array;
  readonly last: number;
  /** 弧の帯（横のずれの範囲） */
  readonly nLo: number;
  readonly nHi: number;
  /** 墨溜まりを除いた半幅の最大と、縁の外へ届く幅（毛羽・胡粉） */
  readonly hBody: number;
  readonly reach: number;
  private readonly oxd: number;
  private readonly oyd: number;
  private readonly sketch: boolean;
  private readonly haloRgb: number;
  private readonly haloAlpha: number;
  private readonly warp: Uint8Array;
  private readonly cell: number;
  private readonly root: number;
  private readonly tip: number;
  private readonly dryFrom: number;
  private readonly dryLen: number;
  private readonly side: number;
  private readonly alpha: number;
  private readonly seed: number;
  private readonly gap: number;
  /** 毛筋ごとの区切りのずれと、隙間 / 淡い筋の選び（番号 + STRAND_SPAN で引く） */
  private readonly strandShift: Float32Array;
  private readonly strandPick: Float32Array;

  constructor(
    private readonly surf: InkSurface,
    readonly path: InkPath,
    private readonly o: BrushOpts,
    /** 置いたドットを覚える（形のキャッシュ）。覚えないなら null */
    readonly recorder: InkRecorder | null = null,
  ) {
    // 帯の幅（bandFor）が寄せを読むので、設定の写しを先に置く
    this.side = o.side;
    this.alpha = o.alpha;
    this.seed = o.seed;
    this.gap = o.gap;
    this.prof = brushProfile(path.length, o.width, o.seed);
    this.last = this.prof.length - 1;
    let hMax = 0;
    for (const h of this.prof) hMax = Math.max(hMax, h);
    this.sketch = o.stage === "sketch";
    this.reach = this.sketch ? 0 : HALO_REACH + 1;
    // 弧は墨溜まり（入りの太り）を除いた太さで帯を取る（大きな輪の帯を 4 割広げない。入りは朱の点が覆う）
    let hBody = 0;
    const poolEnd = Math.min(this.prof.length, Math.ceil((ENTRY_PX + POOL_PX) * INK_DOTS));
    for (let i = poolEnd; i < this.prof.length; i++) hBody = Math.max(hBody, this.prof[i] ?? 0);
    this.hBody = hBody > 0 ? hBody : hMax;
    const [lo, hi] = this.bandFor(this.hBody);
    this.nLo = lo;
    this.nHi = hi;
    this.oxd = surf.ox * INK_DOTS;
    this.oyd = surf.oy * INK_DOTS;
    this.haloRgb = rgbOf(TELEGRAPH.gofunColor);
    const traceMul = o.stage === "trace" ? TELEGRAPH.traceHaloMul : 1;
    this.haloAlpha = Math.min(1, TELEGRAPH.inkHaloAlpha * o.haloMul * traceMul);
    this.warp = noiseTile(STREAK_WARP_CELL, SEED_WARP);
    this.cell = TELEGRAPH.sketchCell * INK_DOTS;
    this.root = ROOT_PX * INK_DOTS;
    this.tip = path.length - TIP_PX * INK_DOTS;
    this.dryFrom = path.length * TELEGRAPH.inkDryFrom;
    this.dryLen = Math.max(1, path.length - this.dryFrom);
    this.strandShift = new Float32Array(STRAND_SPAN * 2);
    this.strandPick = new Float32Array(STRAND_SPAN * 2);
    for (let k = 0; k < STRAND_SPAN * 2; k++) {
      this.strandShift[k] = dotHash(k - STRAND_SPAN, 0x5d, o.seed) * BREAK_LEN;
      this.strandPick[k] = dotHash(k - STRAND_SPAN, 0x2c9, o.seed);
    }
  }

  /** 作業面のドット (x, y) を塗る。s は道に沿った距離（端で丸めた値）、n は横のずれ、over は端を越えた距離 */
  dot(x: number, y: number, s: number, n: number, over: number): void {
    const si = s <= 0 ? 0 : s >= this.last ? this.last : s | 0;
    const h = this.prof[si] ?? 0;
    const dn = n - this.side * h;
    const d = over > 0 ? Math.sqrt(over * over + dn * dn) : dn < 0 ? -dn : dn;
    const wx = x - this.oxd;
    const wy = y - this.oyd;
    if (this.sketch) {
      if (d <= h) this.sketchDot(x, y, wx, wy, s, d, h);
      return;
    }
    if (d > h + HALO_REACH + 1) return;
    if (d <= h) {
      this.inkDot(x, y, wx, wy, s, dn, d, h);
      return;
    }
    // 外: 短い毛羽（太い所だけ）か、胡粉の滲み
    if (h >= THICK && d <= h + 1 && dotHash(wx, wy, SEED_HAIR) < HAIR) {
      this.ink(x, y, HAIR_LEVEL);
      return;
    }
    if (h >= THICK && d > h + 1 && dotHash(wx, wy, SEED_FAR) < HAIR_FAR) {
      this.ink(x, y, HAIR_LEVEL);
      return;
    }
    if (d <= h + HALO_REACH) this.halo(x, y);
  }

  private halo(x: number, y: number): void {
    if (this.haloAlpha <= 0) return;
    this.emit(x, y, INK_LAYER.halo, 1, this.haloRgb, this.haloAlpha * this.alpha);
  }

  private ink(x: number, y: number, level: number): void {
    this.emit(x, y, INK_LAYER.ink, level, inkRgb(level), this.alpha);
  }

  /** 作業面へ置く（記録中なら覚える） */
  private emit(x: number, y: number, layer: number, level: number, rgb: number, alpha: number): void {
    // 汚れは行の走査の終わりにまとめて記録する（rasterLineChunk / rasterArc の touch、粒は speck）
    this.surf.putDot(x, y, layer, level, rgb, alpha);
    if (this.recorder) this.recorder.push(x, y, layer, level, rgb, alpha);
  }

  private inkDot(x: number, y: number, wx: number, wy: number, s: number, dn: number, d: number, h: number): void {
    // 縁の 1 ドット: 淡い段。座標ハッシュで齧り、齧った所は胡粉が覗く
    if (d > h - 1) {
      if (dotHash(wx, wy, SEED_NIBBLE) < NIBBLE) {
        this.halo(x, y);
        return;
      }
      this.ink(x, y, RIM_LEVEL);
      return;
    }
    const across = d / Math.max(h, 0.01);
    const dry = s > this.dryFrom ? (INK_DRY * (s - this.dryFrom)) / this.dryLen : 0;
    const v = 1 - INK_FALL * (FALL_CURVE[Math.min(ACROSS_STEPS, Math.round(across * ACROSS_STEPS))] ?? 1) - dry;
    let level = levelFast(v + (bayer(wx, wy) - 0.5) * LEVEL_DITHER);
    if (h >= STREAK_THICK && h - d >= STREAK_DEPTH) {
      const streak = this.streak(dn, s, wx, wy, level);
      if (streak === 0) return;
      level = streak;
    }
    this.ink(x, y, level);
  }

  /** 掠れの毛筋（inkify と同じ式）。0 = 抜く、それ以外は段 */
  private streak(dn: number, s: number, wx: number, wy: number, level: number): number {
    const warp = ((this.warp[noiseIndex(wx, wy)] ?? 0) / 255 - 0.5) * 2 * STREAK_WARP;
    const u = (dn + warp) / STREAK_PITCH;
    const strand = Math.floor(u);
    if (u - strand >= STREAK_LINE) return level;
    const k = strand + STRAND_SPAN;
    if (k < 0 || k >= STRAND_SPAN * 2) return level;
    const seg = Math.floor((s + (this.strandShift[k] ?? 0)) / BREAK_LEN);
    if (dotHash(strand, seg, this.seed ^ 0x3f1) > BREAK_ON) return level;
    const pick = this.strandPick[k] ?? 1;
    const gapRate = STREAK_GAP * (level >= INK_LEVELS ? CORE_GAP_MUL : 1);
    if (pick < gapRate) return 0;
    if (pick < gapRate + DARK_STRAND) return Math.max(RIM_LEVEL, level - DARK_STEP);
    return level;
  }

  private sketchDot(x: number, y: number, wx: number, wy: number, s: number, d: number, h: number): void {
    const edge = d > h - 1;
    // 市松に間引いて半透明に見せる（縁は残して形を保つ）。ワールドのドットの偶奇なのでカメラで泳がない
    if (!edge && (wx + wy) & 1) return;
    const across = d / Math.max(h, 0.01);
    if (s > this.root && s < this.tip) {
      const lane = Math.min(SKETCH_LANES - 1, Math.floor(across * SKETCH_LANES));
      const seg = Math.floor((s + dotHash(lane, SEED_LANE, this.seed) * this.cell) / this.cell);
      if (dotHash(lane, seg, this.seed) < this.gap) return;
    }
    const level = across > SKETCH_EDGE_ACROSS ? SKETCH_EDGE_LEVEL : SKETCH_BODY_LEVEL;
    this.emit(x, y, INK_LAYER.sketch, level, inkRgb(level), SKETCH_ALPHA * this.alpha);
  }

  /** 走査した行の範囲を汚れとして記録する（置かなかったドットも含む。広めに取るだけで害は無い） */
  touch(y: number, xa: number, xb: number): void {
    this.surf.touch(y, xa, xb);
  }

  /** 横の帯の幅（行の区間を出すのに使う） */
  get band(): number {
    return Math.max(-this.nLo, this.nHi);
  }

  /** 半幅 h の筆の横の帯 [下, 上]（寄せ side の側だけに広がる） */
  bandFor(h: number): [number, number] {
    const body = h * (1 + Math.abs(this.side));
    return [this.side > 0 ? -this.reach : -(body + this.reach), this.side < 0 ? this.reach : body + this.reach];
  }

  /** 道に沿った区間 [a, b]（ドット）の半幅の最大 */
  maxHalf(a: number, b: number): number {
    let m = 0;
    const from = Math.max(0, Math.floor(a));
    const to = Math.min(this.last, Math.ceil(b));
    for (let i = from; i <= to; i++) m = Math.max(m, this.prof[i] ?? 0);
    return m;
  }

  /** 墨入れの周りの飛沫（太い所だけ。筆の局所のハッシュで、筆と一緒に動く） */
  splash(): void {
    if (this.sketch) return;
    const len = Math.floor(this.path.length);
    for (let si = 0; si < len; si++) {
      const h = this.prof[si] ?? 0;
      if (h < THICK) continue;
      if (dotHash(si, 1, this.o.seed ^ SEED_SPLASH) >= SPLASH_PER_DOT) continue;
      const side = dotHash(si, 2, this.o.seed ^ SEED_SPLASH) < 0.5 ? -1 : 1;
      const far = dotHash(si, 3, this.o.seed ^ SEED_SPLASH);
      const off = SPLASH_MIN + Math.floor(far * far * (SPLASH_MAX - SPLASH_MIN + 1));
      const p = pathPoint(this.path, si);
      const lateral = this.o.side * h + side * (h + off);
      const x = Math.floor(p.x - p.ty * lateral);
      const y = Math.floor(p.y + p.tx * lateral);
      this.speck(x, y, HAIR_LEVEL);
      if (dotHash(si, 4, this.o.seed ^ SEED_SPLASH) < SPLASH_PAIR) this.speck(x + 1, y, HAIR_LEVEL);
    }
  }

  /** 入りの飛沫（敵の側 = 筆の進む逆へ散る小さな墨の粒） */
  splatter(): void {
    const p = pathPoint(this.path, 0);
    const c = this.o.side * (this.prof[0] ?? 0);
    const spread = TELEGRAPH.splatterSpread * INK_DOTS;
    for (let i = 0; i < TELEGRAPH.splatterCount; i++) {
      const r1 = dotHash(i, 1, this.o.seed ^ SEED_SPLAT);
      const dist = (0.4 + r1 * r1 * 1.6) * spread;
      const a = Math.PI + (dotHash(i, 2, this.o.seed ^ SEED_SPLAT) - 0.5) * SPLAT_CONE;
      const along = Math.cos(a) * dist;
      const lateral = c + Math.sin(a) * dist;
      const x = Math.floor(p.x + p.tx * along - p.ty * lateral);
      const y = Math.floor(p.y + p.ty * along + p.tx * lateral);
      const level = SPLAT_LEVEL_MIN + Math.floor(dotHash(i, 3, this.o.seed ^ SEED_SPLAT) * SPLAT_LEVELS);
      this.speck(x, y, level);
    }
  }

  /** 粒 1 つ（胡粉は敷かない。周りに置くと「＋」の形に見えて墨の粒に見えない） */
  private speck(x: number, y: number, level: number): void {
    this.ink(x, y, level);
    this.surf.touch(y, x, x);
  }
}

/** 走査するドットの範囲（含む）。ふだんは作業面、形を記録するときは画面の外も含む全体 */
interface Clip {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 記録するときに走査する範囲（作業面の外へこれだけ広げる。記録のずれは 16 ビットに収まる） */
const RECORD_REACH = 4096;

/** 区間の両端の x（px の連続座標）: lo <= coef × px + k <= hi */
function solve(coef: number, k: number, lo: number, hi: number, out: [number, number]): boolean {
  if (Math.abs(coef) < 1e-9) {
    if (k < lo || k > hi) return false;
    out[0] = Number.NEGATIVE_INFINITY;
    out[1] = Number.POSITIVE_INFINITY;
    return true;
  }
  const a = (lo - k) / coef;
  const b = (hi - k) / coef;
  out[0] = Math.min(a, b);
  out[1] = Math.max(a, b);
  return true;
}

const SPAN_A: [number, number] = [0, 0];
const SPAN_B: [number, number] = [0, 0];

/** 線を走査する区切りの長さ（ドット）。区切りごとの太さで帯を取り、細い抜きの所で無駄に広く調べない */
const LINE_CHUNK = 24;

/** 直線の区間を、区切りごとの帯（横の範囲 × 道に沿った範囲）で行ごとに走査して塗る。区間の両端は帯の幅だけ越える（丸い入り・つなぎ目） */
function rasterLine(br: BrushRaster, p: LinePiece, clip: Clip): void {
  for (let t0 = 0; t0 < p.len; t0 += LINE_CHUNK) {
    const t1 = Math.min(p.len, t0 + LINE_CHUNK);
    const hc = br.maxHalf(p.s0 + t0 - 1, p.s0 + t1 + 1);
    const [nLo, nHi] = br.bandFor(hc);
    const cap = Math.max(-nLo, nHi);
    rasterLineChunk(br, p, t0 === 0 ? -cap : t0, t1 >= p.len ? p.len + cap : t1, nLo, nHi, clip);
  }
}

function rasterLineChunk(br: BrushRaster, p: LinePiece, ta: number, tb: number, nLo: number, nHi: number, clip: Clip): void {
  const band = Math.max(-nLo, nHi);
  const ya = p.ay + p.dy * ta;
  const yb = p.ay + p.dy * tb;
  const y0 = Math.max(clip.y0, Math.floor(Math.min(ya, yb) - band));
  const y1 = Math.min(clip.y1, Math.ceil(Math.max(ya, yb) + band));
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5 - p.ay;
    // n = dx·py − dy·(px − ax) ∈ [nLo, nHi]、t = dx·(px − ax) + dy·py ∈ [ta, tb]
    if (!solve(-p.dy, p.dx * py + p.dy * p.ax, nLo, nHi, SPAN_A)) continue;
    if (!solve(p.dx, p.dy * py - p.dx * p.ax, ta, tb, SPAN_B)) continue;
    const xa = Math.max(SPAN_A[0], SPAN_B[0], clip.x0 + 0.5);
    const xb = Math.min(SPAN_A[1], SPAN_B[1], clip.x1 + 0.5);
    const from = Math.ceil(xa - 0.5);
    const to = Math.floor(xb - 0.5);
    if (to < from) continue;
    br.touch(y, from, to);
    for (let x = from; x <= to; x++) {
      const rx = x + 0.5 - p.ax;
      const t = rx * p.dx + py * p.dy;
      const n = p.dx * py - p.dy * rx;
      const over = t < 0 ? -t : t > p.len ? t - p.len : 0;
      br.dot(x, y, p.s0 + (t < 0 ? 0 : t > p.len ? p.len : t), n, over);
    }
  }
}

const TWO_PI = Math.PI * 2;

/** 速い atan2（誤差 1.5e-4 rad 程度。大きな輪の 1 ドットごとに呼ぶので Math.atan2 を避ける） */
export function fastAtan2(y: number, x: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const mx = Math.max(ax, ay);
  if (mx === 0) return 0;
  const a = Math.min(ax, ay) / mx;
  const s = a * a;
  let r = ((-0.0464964749 * s + 0.15931422) * s - 0.327622764) * s * a + a;
  if (ay > ax) r = Math.PI / 2 - r;
  if (x < 0) r = Math.PI - r;
  return y < 0 ? -r : r;
}

/** 弧の区間の輪（半径 r − nHi .. r − nLo）を行ごとに走査して塗る。輪を 1 周より長く引いた重なりは両方の s で塗る */
function rasterArc(br: BrushRaster, p: ArcPiece, clip: Clip): void {
  const rIn = Math.max(0, p.r - br.nHi);
  const rOut = p.r - br.nLo;
  const y0 = Math.max(clip.y0, Math.floor(p.cy - rOut));
  const y1 = Math.min(clip.y1, Math.ceil(p.cy + rOut));
  const in2 = rIn * rIn;
  const out2 = rOut * rOut;
  const scan = (y: number, dy: number, xa: number, xb: number): void => {
    const from = Math.max(clip.x0, Math.ceil(xa - 0.5));
    const to = Math.min(clip.x1, Math.floor(xb - 0.5));
    if (to < from) return;
    br.touch(y, from, to);
    for (let x = from; x <= to; x++) {
      const dx = x + 0.5 - p.cx;
      const d2 = dx * dx + dy * dy;
      if (d2 < in2 || d2 > out2) continue;
      const dist = Math.sqrt(d2);
      let rel = fastAtan2(dy, dx) - p.a0;
      rel -= Math.floor(rel / TWO_PI) * TWO_PI;
      const n = p.r - dist;
      if (rel <= p.sweep) br.dot(x, y, p.s0 + rel * p.r, n, 0);
      if (rel + TWO_PI <= p.sweep) br.dot(x, y, p.s0 + (rel + TWO_PI) * p.r, n, 0);
    }
  };
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - p.cy;
    const o2 = out2 - dy * dy;
    if (o2 < 0) continue;
    const xo = Math.sqrt(o2);
    const i2 = in2 - dy * dy;
    if (i2 <= 0) {
      scan(y, dy, p.cx - xo, p.cx + xo);
      continue;
    }
    const xi = Math.sqrt(i2);
    scan(y, dy, p.cx - xo, p.cx - xi);
    scan(y, dy, p.cx + xi, p.cx + xo);
  }
}

/** 筆を 1 本、作業面へラスタライズする（道は作業面のドット座標） */
/** 掠れの筋のうねりの表を先に焼く（初めての墨入れのフレームで固まらないように） */
export function warmInkStroke(): void {
  noiseTile(STREAK_WARP_CELL, SEED_WARP);
}

/** 筆の形のキャッシュ（描画の全体で 1 つ。inkCache.ts） */
const shapeCache = new InkShapeCache();

/** 形のキャッシュを空にする（テスト用） */
export function clearBrushCache(): void {
  shapeCache.clear();
}

/** 覚えている形の数（テスト用） */
export function brushCacheSize(): number {
  return shapeCache.size;
}

/** 道と筆の設定の鍵（ワールドのドットで。カメラが動いても同じ形は同じ鍵） */
function shapeKey(surf: InkSurface, path: InkPath, o: BrushOpts): string {
  const oxd = surf.ox * INK_DOTS;
  const oyd = surf.oy * INK_DOTS;
  const r = (v: number): string => v.toFixed(3);
  const parts = [o.stage, o.seed, r(o.width), o.side, r(o.gap), r(o.alpha), r(o.haloMul), o.entry ? 1 : 0];
  for (const p of path.pieces) {
    if (p.kind === "line") parts.push("l", r(p.ax - oxd), r(p.ay - oyd), r(p.dx), r(p.dy), r(p.len));
    else parts.push("a", r(p.cx - oxd), r(p.cy - oyd), r(p.r), r(p.a0), r(p.sweep));
  }
  return parts.join("|");
}

/** 筆を 1 本、作業面へラスタライズする（道は作業面のドット座標）。同じ形が続けば記録を写すだけ */
export function drawBrush(surf: InkSurface, path: InkPath, o: BrushOpts): void {
  if (!(path.length > 0) || o.alpha <= 0) return;
  const key = shapeKey(surf, path, o);
  const hit = shapeCache.get(key);
  if (hit) {
    replayRecord(surf, hit);
    if (hit.shu) shuDot(surf, hit.shu.x + surf.ox * INK_DOTS, hit.shu.y + surf.oy * INK_DOTS, TELEGRAPH.shuPoolRadius * INK_DOTS, o.alpha);
    return;
  }
  // 2 度目に見た形は、画面の外も含めて全体を記録する（カメラが動いても同じ記録を写せる）
  const recorder = shapeCache.seenBefore(key) ? new InkRecorder(surf.ox * INK_DOTS, surf.oy * INK_DOTS) : null;
  const clip: Clip = recorder
    ? { x0: -RECORD_REACH, y0: -RECORD_REACH, x1: surf.w + RECORD_REACH, y1: surf.h + RECORD_REACH }
    : { x0: 0, y0: 0, x1: surf.w - 1, y1: surf.h - 1 };
  const br = new BrushRaster(surf, path, o, recorder);
  for (const p of path.pieces) {
    if (p.kind === "line") rasterLine(br, p, clip);
    else rasterArc(br, p, clip);
  }
  if (o.stage !== "sketch") br.splash();
  if (o.entry && o.stage === "ink") {
    br.splatter();
    const at = pathPoint(path, TELEGRAPH.shuPoolAt * INK_DOTS);
    const c = o.side * (br.prof[Math.min(br.last, Math.round(TELEGRAPH.shuPoolAt * INK_DOTS))] ?? 0);
    const sx = at.x - at.ty * c;
    const sy = at.y + at.tx * c;
    shuDot(surf, sx, sy, TELEGRAPH.shuPoolRadius * INK_DOTS, o.alpha);
    if (recorder) recorder.shu = { x: sx - surf.ox * INK_DOTS, y: sy - surf.oy * INK_DOTS };
  }
  if (!recorder) return;
  const rec = recorder.finish();
  if (rec) shapeCache.store(key, rec);
}
