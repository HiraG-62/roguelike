import type { Enemy } from "../core/state";
import { TELEGRAPH } from "../data/tuning";
import { attackCommitted } from "../system/poise";
import { RENDER_SCALE } from "../core/view";
import { BrushPen, RING_SWEEP, placeBrushArc, placeBrushLine, ringStartAngle } from "./inkBrush";
import { type Span, sketchSpans } from "./sketchCells";

export { sketchSpans };
export type { Span };

/**
 * 墨の予告の筆致（docs/ideas/ink-telegraph-impl.md 段 1）。
 * 敵の攻撃は、淡墨の下絵（黄。途切れた細い線 = まだ怯ませて潰せる）→ 濃墨の墨入れ（赤。暗い帯 + 赤い芯 + 先端の止め = もう止まらない）で描く。
 * 色・形・動きの 3 本の通り道で言うので、色が見えなくても線の質で分かれる。
 * 純関数（段の判定・欠けの並び・切り抜き）と canvas に線を引く関数だけ。state を書かず、rng も使わない（欠けは敵の id とセルの番号の座標ハッシュ）
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

/** 下絵の 1 本（淡墨の掠れ）を置く。id は筆の変種の鍵、lateral は線の横へのずれ（擦れて散る動き）、side は帯の寄せ */
export function placeSketch(pen: BrushPen, s: Seg, id: number, gap: number, cut: CutCircle | null, alphaMul = 1, lateral = 0, side = 0): void {
  placeBrushLine(pen, s.x0, s.y0, s.x1, s.y1, "sketch", id, gap, visiblePieces(s, cut), alphaMul, lateral, side);
}

/** 墨入れの 1 本（濃墨の一筆。入りに墨溜まり・抜きで払い・赤い芯）を置く */
export function placeInk(pen: BrushPen, s: Seg, id: number, cut: CutCircle | null, alphaMul = 1, side = 0): void {
  placeBrushLine(pen, s.x0, s.y0, s.x1, s.y1, "ink", id, 0, visiblePieces(s, cut), alphaMul, 0, side);
}

/** 下絵 1 本を即時に描く（単発の描画用。乱戦の予告は 1 つの BrushPen で続けて置く） */
export function strokeSketch(ctx: CanvasRenderingContext2D, s: Seg, id: number, gap: number, cut: CutCircle | null, alphaMul = 1, lateral = 0, side = 0): void {
  const pen = new BrushPen(ctx);
  placeSketch(pen, s, id, gap, cut, alphaMul, lateral, side);
  pen.end();
}

/** 墨入れ 1 本を即時に描く（単発の描画用） */
export function strokeInk(ctx: CanvasRenderingContext2D, s: Seg, id: number, cut: CutCircle | null, alphaMul = 1, side = 0): void {
  const pen = new BrushPen(ctx);
  placeInk(pen, s, id, cut, alphaMul, side);
  pen.end();
}

/** 地面の物（着地・爆弾・死に際の爆発）の輪を墨入れで描く（出た時から必ず来るので下絵を持たない。中の色は呼び側が先に塗る） */
export function strokeInkRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, stage: InkStage = "ink"): void {
  const pen = new BrushPen(ctx);
  // 筆の変種と始点は位置の座標ハッシュ（同じ場所の物は同じ筆。rng は使わない）
  const id = Math.round(x * 7 + y * 13);
  // 下絵（黄）の輪は欠けを怯み値なしの基準で引く（出した敵の怯み値は輪の持ち主が知らない）
  const gap = stage === "sketch" ? sketchGap(0) : 0;
  placeBrushArc(pen, x, y, r, ringStartAngle(id), RING_SWEEP, stage, id, gap, 1, 1);
  pen.end();
}

// -----------------------------------------------------------------------------
// 印（頭上の ○ / ●・先端の止め）。小さな絵なので、1 度だけ焼いた画像を置く（円弧の塗りを何度も引くより軽い）
// -----------------------------------------------------------------------------

type MarkKind = "ready" | "commit" | "stop";

/** 印の絵の余白 px（暗い縁の外側） */
const MARK_PAD = 1;

function markSize(kind: MarkKind): number {
  return (kind === "stop" ? TELEGRAPH.stopSize + TELEGRAPH.stopCasing * 2 : TELEGRAPH.headMarkSize) + MARK_PAD * 2;
}

/** 印を ctx に直接描く（中心 x, y）。画像に焼くときと、画像が作れない環境（単体テスト）で使う */
function paintMark(ctx: CanvasRenderingContext2D, kind: MarkKind, x: number, y: number, alphaMul: number): void {
  if (kind === "stop") {
    const half = TELEGRAPH.stopSize / 2;
    const edge = TELEGRAPH.stopCasing;
    ctx.globalAlpha = TELEGRAPH.inkCasingAlpha * alphaMul;
    ctx.fillStyle = TELEGRAPH.casingColor;
    ctx.fillRect(x - half - edge, y - half - edge, TELEGRAPH.stopSize + edge * 2, TELEGRAPH.stopSize + edge * 2);
    ctx.globalAlpha = alphaMul;
    ctx.fillStyle = TELEGRAPH.commitColor;
    ctx.fillRect(x - half, y - half, TELEGRAPH.stopSize, TELEGRAPH.stopSize);
    ctx.globalAlpha = 1;
    return;
  }
  const r = TELEGRAPH.headMarkSize / 2;
  ctx.fillStyle = TELEGRAPH.casingColor;
  ctx.globalAlpha = TELEGRAPH.inkCasingAlpha * alphaMul;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = alphaMul;
  if (kind === "commit") {
    ctx.fillStyle = TELEGRAPH.commitColor;
    ctx.beginPath();
    ctx.arc(x, y, r - TELEGRAPH.stopCasing, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }
  // 輪の穴は暗い縁の塗りに抜く（○ と ● を 5px でも分ける）
  ctx.strokeStyle = TELEGRAPH.readyColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, r - 1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

const markCache = new Map<MarkKind, HTMLCanvasElement>();

function markImage(kind: MarkKind): HTMLCanvasElement | null {
  const hit = markCache.get(kind);
  if (hit) return hit;
  if (typeof document === "undefined") return null;
  const size = markSize(kind);
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

/** 印を置く（中心 x, y）。alphaMul は折れ線の 2 本目など薄く描く倍率 */
function stampMark(ctx: CanvasRenderingContext2D, kind: MarkKind, x: number, y: number, alphaMul: number): void {
  const img = markImage(kind);
  if (!img) {
    paintMark(ctx, kind, x, y, alphaMul);
    return;
  }
  const size = markSize(kind);
  ctx.globalAlpha = alphaMul;
  ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
  ctx.globalAlpha = 1;
}

/** 先端の止め: 赤い点 + 暗い縁（墨入れの線の終わり） */
export function drawStop(ctx: CanvasRenderingContext2D, x: number, y: number, alphaMul = 1): void {
  stampMark(ctx, "stop", x, y, alphaMul);
}

/** 頭上の印: 下絵 = 黄の輪（○）、墨入れ = 赤の塗りの点（●）。どちらも暗い縁付き。文字ではなく形で言う（灰色・縮小でも残る） */
export function drawHeadMark(ctx: CanvasRenderingContext2D, x: number, y: number, stage: InkStage): void {
  stampMark(ctx, stage === "ink" ? "commit" : "ready", x, y, 1);
}
