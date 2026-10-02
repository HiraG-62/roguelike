import type { Enemy } from "../core/state";
import { TELEGRAPH } from "../data/tuning";
import { attackCommitted } from "../system/poise";
import { RENDER_SCALE } from "../core/view";
import { BrushPen, RING_SWEEP, placeBrushArc, placeBrushLine, ringStartAngle, stampShu } from "./inkBrush";
import { type Span, sketchSpans } from "./sketchCells";

export { sketchSpans };
export type { Span };

/**
 * 墨の予告の筆致（docs/ideas/ink-telegraph-impl.md。案 B）。
 * 敵の攻撃は、薄墨の下絵（明るく淡い掠れた帯 = まだ怯ませて潰せる）→ 濃墨の墨入れ（真っ黒な一筆 + 入りの朱 + 下に敷いた胡粉 = もう止まらない）で描く。
 * 明暗・形・動きの 3 本の通り道で言うので、色が見えなくても（灰色でも）線の質で分かれる。
 * 純関数（段の判定・欠けの並び・切り抜き）と canvas に線を引く関数だけ。state を書かず、rng も使わない（掠れは敵の id と形の座標ハッシュ）
 */

export type InkStage = "sketch" | "ink";

/** 描く段。境は system/poise.ts の attackCommitted の 1 か所だけ（描画が別の境を持たない） */
export function telegraphStage(e: Enemy): InkStage {
  return attackCommitted(e) ? "ink" : "sketch";
}

/** 自分の体の円。線はこの上だけ切る */
export interface CutCircle {
  x: number;
  y: number;
  r: number;
}

/** 線の 1 本 */
export interface Seg {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function segLength(s: Seg): number {
  return Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
}

/** 欠けの割合 = 基準 + 係数 × 怯み値の割合。上限で丸める（あと何撃で崩れるかを線そのものが見せる） */
export function sketchGap(poiseRatio: number): number {
  const gap = TELEGRAPH.sketchGapBase + TELEGRAPH.sketchGapPoise * Math.max(0, Math.min(1, poiseRatio));
  return Math.min(TELEGRAPH.sketchGapMax, gap);
}

/** 線の区間を円で切る（根元からの距離）。重ならなければ null */
export function circleCut(s: Seg, c: CutCircle): Span | null {
  const len = segLength(s);
  if (len <= 0) return null;
  const dx = (s.x1 - s.x0) / len;
  const dy = (s.y1 - s.y0) / len;
  const fx = c.x - s.x0;
  const fy = c.y - s.y0;
  const along = fx * dx + fy * dy;
  const across2 = fx * fx + fy * fy - along * along;
  const h2 = c.r * c.r - across2;
  if (h2 <= 0) return null;
  const h = Math.sqrt(h2);
  const from = along - h;
  const to = along + h;
  if (to <= 0 || from >= len) return null;
  return { from: Math.max(0, from), to: Math.min(len, to) };
}

/** 区間の列から [a, b] を取り除く（自分の体の上を切る） */
export function cutSpans(spans: readonly Span[], a: number, b: number): Span[] {
  const out: Span[] = [];
  for (const sp of spans) {
    if (sp.to <= a || sp.from >= b) {
      out.push(sp);
      continue;
    }
    if (sp.from < a) out.push({ from: sp.from, to: a });
    if (sp.to > b) out.push({ from: b, to: sp.to });
  }
  return out;
}

/** 線が自分の体の円に切られて残る区間。切られなければ null（全長を描く） */
function visiblePieces(s: Seg, cut: CutCircle | null): readonly Span[] | null {
  if (!cut) return null;
  const c = circleCut(s, cut);
  return c ? cutSpans([{ from: 0, to: segLength(s) }], c.from, c.to) : null;
}

/** 下絵の 1 本（薄墨の掠れ）を置く。id は筆の変種の鍵、lateral は線の横へのずれ（擦れて散る動き）、side は帯の寄せ */
export function placeSketch(pen: BrushPen, s: Seg, id: number, gap: number, cut: CutCircle | null, alphaMul = 1, lateral = 0, side = 0): void {
  placeBrushLine(pen, s.x0, s.y0, s.x1, s.y1, "sketch", id, gap, visiblePieces(s, cut), alphaMul, lateral, side);
}

/** 墨入れの 1 本（濃墨の一筆。入りに朱の墨溜まり・抜きで払い・下に胡粉）を置く。haloMul は胡粉の濃さの倍率（攻撃の直前で濃く） */
export function placeInk(pen: BrushPen, s: Seg, id: number, cut: CutCircle | null, alphaMul = 1, side = 0, haloMul = 1): void {
  placeBrushLine(pen, s.x0, s.y0, s.x1, s.y1, "ink", id, 0, visiblePieces(s, cut), alphaMul, 0, side, haloMul);
}

/** 地面の物（着地・爆弾・死に際の爆発）の輪を墨入れで描く（出た時から必ず来るので下絵を持たない。中の色は呼び側が先に塗る） */
export function strokeInkRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, stage: InkStage = "ink"): void {
  const pen = new BrushPen(ctx);
  // 筆の変種と始点は位置の座標ハッシュ（同じ場所の物は同じ筆。rng は使わない）
  const id = Math.round(x * 7 + y * 13);
  // 下絵の輪は欠けを怯み値なしの基準で引く（出した敵の怯み値は輪の持ち主が知らない）
  const gap = stage === "sketch" ? sketchGap(0) : 0;
  placeBrushArc(pen, x, y, r, ringStartAngle(id), RING_SWEEP, stage, id, gap, 1, 1);
  pen.end();
}

// -----------------------------------------------------------------------------
// 印（頭上の ○ / ●・先端の朱の点）。小さな絵なので、1 度だけ焼いた画像を置く（円弧の塗りを何度も引くより軽い）
// -----------------------------------------------------------------------------

type MarkKind = "ready" | "commit";

/** 印の絵の余白 px（縁の外側） */
const MARK_PAD = 1;
/** ○ の輪の太さ・暗い縁の濃さ（明るい床で薄墨の輪が沈まないように） */
const READY_RING_W = 1;
const READY_EDGE_ALPHA = 0.55;
/** ● の胡粉の縁の太さと、朱の芯の半径（外径の半分に対する割合） */
const COMMIT_RIM = 0.75;
const COMMIT_SHU = 0.34;

function markSize(): number {
  return TELEGRAPH.headMarkSize + MARK_PAD * 2;
}

function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** 印を ctx に直接描く（中心 x, y）。画像に焼くときと、画像が作れない環境（単体テスト）で使う */
function paintMark(ctx: CanvasRenderingContext2D, kind: MarkKind, x: number, y: number, alphaMul: number): void {
  const r = TELEGRAPH.headMarkSize / 2;
  if (kind === "commit") {
    // ● = 胡粉の縁 → 濃墨の玉 → 朱の芯（暗い床でも明るい床でも玉の形が残る）
    disc(ctx, x, y, r, TELEGRAPH.gofunColor, alphaMul);
    disc(ctx, x, y, r - COMMIT_RIM, TELEGRAPH.sumiColor, alphaMul);
    disc(ctx, x, y, r * COMMIT_SHU, TELEGRAPH.shuColor, alphaMul);
    ctx.globalAlpha = 1;
    return;
  }
  // ○ = 薄墨の輪（中は抜く）。外へ薄い墨の縁を添えて、明るい床でも輪が読める
  ctx.lineWidth = READY_RING_W;
  ctx.globalAlpha = READY_EDGE_ALPHA * alphaMul;
  ctx.strokeStyle = TELEGRAPH.sumiColor;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = alphaMul;
  ctx.strokeStyle = TELEGRAPH.usuzumiLightColor;
  ctx.beginPath();
  ctx.arc(x, y, r - READY_RING_W, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

const markCache = new Map<MarkKind, HTMLCanvasElement>();

function markImage(kind: MarkKind): HTMLCanvasElement | null {
  const hit = markCache.get(kind);
  if (hit) return hit;
  if (typeof document === "undefined") return null;
  const size = markSize();
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(size * RENDER_SCALE);
  canvas.height = Math.ceil(size * RENDER_SCALE);
  const c = canvas.getContext("2d");
  if (!c) return null;
  c.scale(RENDER_SCALE, RENDER_SCALE);
  paintMark(c, kind, size / 2, size / 2, 1);
  markCache.set(kind, canvas);
  return canvas;
}

/** 印を置く（中心 x, y） */
function stampMark(ctx: CanvasRenderingContext2D, kind: MarkKind, x: number, y: number, alphaMul: number): void {
  const img = markImage(kind);
  if (!img) {
    paintMark(ctx, kind, x, y, alphaMul);
    return;
  }
  const size = markSize();
  ctx.globalAlpha = alphaMul;
  ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
  ctx.globalAlpha = 1;
}

/** 先端の朱の点（墨入れの線の届く先）。焼いた朱の玉を置く（変種は位置の座標ハッシュ） */
export function drawStop(ctx: CanvasRenderingContext2D, x: number, y: number, alphaMul = 1): void {
  stampShu(ctx, "tip", x, y, Math.abs(Math.round(x * 3 + y * 5)) % 3, alphaMul);
}

/** 頭上の印: 下絵 = 薄墨の輪（○）、墨入れ = 濃墨の玉に朱の芯（●）。文字ではなく形と明暗で言う（灰色・縮小でも残る） */
export function drawHeadMark(ctx: CanvasRenderingContext2D, x: number, y: number, stage: InkStage): void {
  stampMark(ctx, stage === "ink" ? "commit" : "ready", x, y, 1);
}
