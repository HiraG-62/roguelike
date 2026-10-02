import type { Enemy } from "../core/state";
import { TELEGRAPH } from "../data/tuning";
import { attackCommitted } from "../system/poise";
import { hash01 } from "./renderMath";

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

/** 線の 1 本 */
export interface Seg {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 線に沿った区間（根元からの距離 px） */
export interface Span {
  from: number;
  to: number;
}

/** 自分の体の円。線はこの上だけ切る */
export interface CutCircle {
  x: number;
  y: number;
  r: number;
}

export function segLength(s: Seg): number {
  return Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
}

/** 欠けの割合 = 基準 + 係数 × 怯み値の割合。上限で丸める（あと何撃で崩れるかを線そのものが見せる） */
export function sketchGap(poiseRatio: number): number {
  const gap = TELEGRAPH.sketchGapBase + TELEGRAPH.sketchGapPoise * Math.max(0, Math.min(1, poiseRatio));
  return Math.min(TELEGRAPH.sketchGapMax, gap);
}

/** 欠けを 0.05 刻みに丸める（キャッシュの鍵。見た目の差は出ない） */
const GAP_QUANT = 20;
const SPAN_CACHE_MAX = 512;
const spanCache = new Map<string, readonly Span[]>();

/**
 * 下絵の描く区間。長さを sketchCell 刻みのセルに割り、hash01(id, i) が欠けの割合を下回るセルを描かない。
 * 閾を上げると欠けるセルが増えるだけで減らない（削れが戻って見えない）。根元と先端のセルは必ず描く（向きと届きを見せる）。
 * 端数は最後のセルに足し、セルは sketchCell 未満にならない。返す配列は共有なので変更しない
 */
export function sketchSpans(id: number, length: number, gap: number): readonly Span[] {
  const q = Math.round(Math.max(0, Math.min(1, gap)) * GAP_QUANT);
  const key = `${id}:${Math.round(length)}:${q}`;
  const hit = spanCache.get(key);
  if (hit) return hit;
  const spans = buildSpans(id, length, q / GAP_QUANT);
  if (spanCache.size >= SPAN_CACHE_MAX) spanCache.clear();
  spanCache.set(key, spans);
  return spans;
}

/** セルの長さのばらつき（sketchCell の 1〜2 倍）。同じ長さの塊が並ぶと規則的な破線に見えるので、セルごとに変える */
const CELL_JITTER = 1;

function buildSpans(id: number, length: number, gap: number): Span[] {
  const cell = TELEGRAPH.sketchCell;
  if (!(length > 0)) return [];
  const bounds = cellBounds(id, length, cell);
  const spans: Span[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const from = bounds[i] ?? 0;
    const to = bounds[i + 1] ?? length;
    const edge = i === 0 || i === bounds.length - 2;
    if (!edge && hash01(id * 131 + 7, i * 17 + 3) < gap) continue;
    const last = spans[spans.length - 1];
    if (last && Math.abs(last.to - from) < 1e-6) last.to = to;
    else spans.push({ from, to });
  }
  return spans;
}

/** セルの境の距離の列（0 から length まで）。端数は最後のセルに足し、どのセルも cell 未満にならない */
function cellBounds(id: number, length: number, cell: number): number[] {
  const bounds = [0];
  let at = 0;
  for (let i = 0; ; i++) {
    const next = at + cell * (1 + CELL_JITTER * hash01(id * 977 + 13, i));
    // 残りがもう 1 セル取れなければ、残りを最後のセルにする
    if (length - next < cell) break;
    bounds.push(next);
    at = next;
  }
  bounds.push(length);
  return bounds;
}

/** 区間の列から [a, b] を取り除く（自分の体の上を切る） */
export function cutSpans(spans: readonly Span[], a: number, b: number): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    if (s.to <= a || s.from >= b) {
      out.push(s);
      continue;
    }
    if (s.from < a) out.push({ from: s.from, to: a });
    if (s.to > b) out.push({ from: b, to: s.to });
  }
  return out;
}

/** 線が円と重なる区間（根元からの距離）。重ならなければ null */
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

/** 線の区間を path に足す（stroke は呼び側）。lateral は線の横へずらす距離（擦れて散る動き） */
function addSpans(ctx: CanvasRenderingContext2D, s: Seg, spans: readonly Span[], lateral: (i: number) => number): void {
  const len = segLength(s);
  if (len <= 0) return;
  const dx = (s.x1 - s.x0) / len;
  const dy = (s.y1 - s.y0) / len;
  spans.forEach((sp, i) => {
    const off = lateral(i);
    const ox = -dy * off;
    const oy = dx * off;
    ctx.moveTo(s.x0 + dx * sp.from + ox, s.y0 + dy * sp.from + oy);
    ctx.lineTo(s.x0 + dx * sp.to + ox, s.y0 + dy * sp.to + oy);
  });
}

function visibleSpans(s: Seg, base: readonly Span[], cut: CutCircle | null): readonly Span[] {
  if (!cut) return base;
  const c = circleCut(s, cut);
  return c ? cutSpans(base, c.from, c.to) : base;
}

const NO_DRIFT = (): number => 0;

/** いま組んだ path を段の筆で引く: 下絵 = 暗い細い縁 + 黄の細線、墨入れ = 暗い帯 + 赤い芯 */
export function strokeStaged(ctx: CanvasRenderingContext2D, stage: InkStage, alphaMul = 1): void {
  const sketch = stage === "sketch";
  ctx.lineCap = "butt";
  ctx.strokeStyle = TELEGRAPH.casingColor;
  ctx.globalAlpha = (sketch ? TELEGRAPH.sketchCasingAlpha : TELEGRAPH.inkCasingAlpha) * alphaMul;
  ctx.lineWidth = sketch ? TELEGRAPH.sketchWidth + TELEGRAPH.sketchCasingWidth * 2 : TELEGRAPH.inkCasingWidth;
  ctx.stroke();
  ctx.strokeStyle = sketch ? TELEGRAPH.readyColor : TELEGRAPH.commitColor;
  ctx.globalAlpha = (sketch ? TELEGRAPH.sketchAlpha : 1) * alphaMul;
  ctx.lineWidth = sketch ? TELEGRAPH.sketchWidth : TELEGRAPH.inkWidth;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** 下絵の 1 本: 暗い縁 → 黄の細い欠けた線。id は欠けの並びの鍵 */
export function strokeSketch(
  ctx: CanvasRenderingContext2D,
  s: Seg,
  id: number,
  gap: number,
  cut: CutCircle | null,
  alphaMul = 1,
  drift: (i: number) => number = NO_DRIFT,
): void {
  const spans = visibleSpans(s, sketchSpans(id, segLength(s), gap), cut);
  if (spans.length === 0) return;
  ctx.beginPath();
  addSpans(ctx, s, spans, drift);
  strokeStaged(ctx, "sketch", alphaMul);
}

/** 墨入れの 1 本: 暗い帯 → 赤い芯（途切れない） */
export function strokeInk(ctx: CanvasRenderingContext2D, s: Seg, cut: CutCircle | null, alphaMul = 1): void {
  const len = segLength(s);
  if (len <= 0) return;
  const spans = visibleSpans(s, [{ from: 0, to: len }], cut);
  if (spans.length === 0) return;
  ctx.beginPath();
  addSpans(ctx, s, spans, NO_DRIFT);
  strokeStaged(ctx, "ink", alphaMul);
}

/** 先端の止め: 赤い点 + 暗い縁（墨入れの線の終わり） */
export function drawStop(ctx: CanvasRenderingContext2D, x: number, y: number, alphaMul = 1): void {
  const size = TELEGRAPH.stopSize;
  const half = size / 2;
  const edge = TELEGRAPH.stopCasing;
  ctx.globalAlpha = TELEGRAPH.inkCasingAlpha * alphaMul;
  ctx.fillStyle = TELEGRAPH.casingColor;
  ctx.fillRect(x - half - edge, y - half - edge, size + edge * 2, size + edge * 2);
  ctx.globalAlpha = alphaMul;
  ctx.fillStyle = TELEGRAPH.commitColor;
  ctx.fillRect(x - half, y - half, size, size);
  ctx.globalAlpha = 1;
}

/** 頭上の印: 下絵 = 黄の輪（○）、墨入れ = 赤の塗りの点（●）。どちらも暗い縁付き。文字ではなく形で言う（灰色・縮小でも残る） */
export function drawHeadMark(ctx: CanvasRenderingContext2D, x: number, y: number, stage: InkStage): void {
  const r = TELEGRAPH.headMarkSize / 2;
  ctx.fillStyle = TELEGRAPH.casingColor;
  ctx.strokeStyle = TELEGRAPH.casingColor;
  ctx.globalAlpha = TELEGRAPH.inkCasingAlpha;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  if (stage === "ink") {
    ctx.fillStyle = TELEGRAPH.commitColor;
    ctx.beginPath();
    ctx.arc(x, y, r - TELEGRAPH.stopCasing, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // 輪の穴は暗い縁の塗りに抜く（○ と ● を 5px でも分ける）
  ctx.strokeStyle = TELEGRAPH.readyColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, r - 1, 0, Math.PI * 2);
  ctx.stroke();
}
