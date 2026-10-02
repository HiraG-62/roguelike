import type { Enemy } from "../core/state";
import { TELEGRAPH } from "../data/tuning";
import { attackCommitted } from "../system/poise";
import type { ThreatArea } from "../system/threat";
import { fillCone, fillRing } from "./inkFill";
import { cornerMark, headMark, shuDot } from "./inkMarks";
import { type BrushStage, type InkPath, arcPath, drawBrush, fanPath, linePath, polyPath } from "./inkStroke";
import { INK_DOTS, type InkSurface, sharedInkSurface } from "./inkSurface";
import { hash01 } from "./renderMath";

/**
 * 墨の予告の筆致の入口（docs/ideas/ink-telegraph-impl.md 5 章。攻撃エフェクトと同じドット絵の墨）。
 * 敵の攻撃は、淡墨の下絵（市松に間引いた淡い帯 = まだ怯ませて潰せる）→ 濃墨の墨入れ（芯が真っ黒の一筆 + 入りの朱 + 外側の胡粉 = もう止まらない）で描く。
 * 範囲（輪・扇・着地・爆弾）は内側を墨のむらで塗り、縁を筆で引く。明暗・形・動きで言うので、灰色でも線の質で分かれる。
 * ワールド座標の形を作業面（inkSurface.ts）のドットへ写して置くだけ。state を書かず、rng も使わない（ばらつきは敵の id と座標ハッシュ）
 */

export type InkStage = "sketch" | "ink";

/** 描く段。境は system/poise.ts の attackCommitted の 1 か所だけ（描画が別の境を持たない） */
export function telegraphStage(e: Enemy): InkStage {
  return attackCommitted(e) ? "ink" : "sketch";
}

/** 自分の体の円。予告の描き込みはこの上だけ抜く */
export interface CutCircle {
  x: number;
  y: number;
  r: number;
}

/** 線の 1 本（ワールド座標） */
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

/** 筆の変種の種（id の座標ハッシュ。同じ敵は同じ筆でちらつかない） */
export function brushSeed(id: number): number {
  return Math.floor(hash01(id, 17) * 0x7fffffff);
}

/** 輪の筆の始点の角度（敵ごとに固定のハッシュ） */
export function ringStartAngle(id: number): number {
  return hash01(id, 31) * Math.PI * 2;
}

/** 輪は 1 周して始まりに少し重ねる（筆を引き切って始点の墨溜まりに被せる） */
export const RING_SWEEP = Math.PI * 2 * 1.03;

/** 筆の全幅（ドット）。widthMul は陣図の構えで太らせる倍率 */
function brushDots(widthMul = 1): number {
  return TELEGRAPH.brushWidth * INK_DOTS * widthMul;
}

/** 小さな輪・扇は筆を細くする（太い帯が範囲の中を埋めて、中の物を隠さないように） */
function areaBrushDots(radius: number): number {
  return Math.min(TELEGRAPH.brushWidth, radius * TELEGRAPH.areaWidthRatio) * INK_DOTS;
}

function segPath(surf: InkSurface, s: Seg): InkPath {
  return linePath(surf.dotX(s.x0), surf.dotY(s.y0), surf.dotX(s.x1), surf.dotY(s.y1));
}

/** 下絵の 1 本（淡墨の掠れた帯）を置く。id は筆の変種の鍵、lateral は線の横へのずれ（擦れて散る動き） */
export function placeSketch(surf: InkSurface, s: Seg, id: number, gap: number, alphaMul = 1, lateral = 0): void {
  const len = segLength(s);
  if (len <= 0) return;
  const nx = (-(s.y1 - s.y0) / len) * lateral;
  const ny = ((s.x1 - s.x0) / len) * lateral;
  const path = segPath(surf, { x0: s.x0 + nx, y0: s.y0 + ny, x1: s.x1 + nx, y1: s.y1 + ny });
  drawBrush(surf, path, { stage: "sketch", seed: brushSeed(id), width: brushDots(), side: 0, gap, alpha: alphaMul, haloMul: 1, entry: true });
}

/** 墨入れの 1 本（濃墨の一筆。入りに朱の墨溜まり・抜きで払い・外側に胡粉）を置く。haloMul は胡粉の濃さの倍率。trace = 朱を持たない被弾筋 */
export function placeInk(surf: InkSurface, s: Seg, id: number, alphaMul = 1, haloMul = 1, stage: "ink" | "trace" = "ink"): void {
  drawBrush(surf, segPath(surf, s), { stage, seed: brushSeed(id), width: brushDots(), side: 0, gap: 0, alpha: alphaMul, haloMul, entry: true });
}

/** 折れ線の筆（陣図の画）。点はワールド座標、dx, dy は全体のずれ（擦れて散る動き）、widthMul は太さの倍率 */
export function placePoly(
  surf: InkSurface,
  points: readonly { x: number; y: number }[],
  stage: BrushStage,
  id: number,
  gap: number,
  alphaMul = 1,
  widthMul = 1,
  dx = 0,
  dy = 0,
): void {
  if (points.length < 2) return;
  const path = polyPath(points.map((p) => ({ x: surf.dotX(p.x + dx), y: surf.dotY(p.y + dy) })));
  drawBrush(surf, path, { stage, seed: brushSeed(id), width: brushDots(widthMul), side: 0, gap, alpha: alphaMul, haloMul: 1, entry: true });
}

/**
 * 範囲（輪・扇）: 内側を墨のむらで塗り、縁を筆で引く。帯は判定の内側に広がる（外へ太らせると嘘になる）。
 * 扇は要（敵の体の縁 bodyR）→ 左の辺 → 弧 → 右の辺の 1 筆
 */
export function placeArea(surf: InkSurface, a: ThreatArea, stage: InkStage, id: number, gap: number, haloMul = 1, bodyR = 0): void {
  const seed = brushSeed(id);
  const cx = surf.dotX(a.x);
  const cy = surf.dotY(a.y);
  if (a.kind === "ring") {
    if (!(a.r > 0)) return;
    fillRing(surf, cx, cy, a.r * INK_DOTS, stage);
    const path = arcPath(cx, cy, a.r * INK_DOTS, ringStartAngle(id), RING_SWEEP);
    drawBrush(surf, path, { stage, seed, width: areaBrushDots(a.r), side: 1, gap, alpha: 1, haloMul, entry: true });
    return;
  }
  if (!(a.range > 0)) return;
  fillCone(surf, cx, cy, a.range * INK_DOTS, a.base, a.half, stage);
  const path = fanPath(cx, cy, a.range * INK_DOTS, a.base, a.half, bodyR * INK_DOTS);
  drawBrush(surf, path, { stage, seed, width: areaBrushDots(a.range), side: 1, gap, alpha: 1, haloMul, entry: true });
}

/**
 * 地面の物（着地・爆弾・死に際の爆発）の範囲を墨で描いてすぐ画面へ置く（内側のむら + 縁の輪。出た時から必ず来るので既定は墨入れ）。
 * 中の色（爆弾の種類）は呼び側が先に塗る
 */
export function strokeInkRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, stage: InkStage = "ink"): void {
  const surf = sharedInkSurface();
  surf.begin(ctx);
  // 筆の変種と始点は位置の座標ハッシュ（同じ場所の物は同じ筆。rng は使わない）
  const id = Math.round(x * 7 + y * 13);
  // 下絵の輪は欠けを怯み値なしの基準で引く（出した敵の怯み値は輪の持ち主が知らない）
  const gap = stage === "sketch" ? sketchGap(0) : 0;
  placeArea(surf, { kind: "ring", x, y, r }, stage, id, gap);
  surf.flush(ctx);
}

/** 先端の朱の点（墨入れの線の届く先） */
export function drawStop(surf: InkSurface, x: number, y: number, alphaMul = 1): void {
  shuDot(surf, surf.dotX(x), surf.dotY(y), TELEGRAPH.shuTipRadius * INK_DOTS, alphaMul);
}

/** 頭上の印: 下絵 = 薄墨の輪（○）、墨入れ = 濃墨の玉に朱の芯（●）。文字ではなく形と明暗で言う（灰色・縮小でも残る） */
export function drawHeadMark(surf: InkSurface, x: number, y: number, stage: InkStage): void {
  headMark(surf, x, y, stage);
}

/** 折れ線の曲がり角の点 */
export function drawCorner(surf: InkSurface, x: number, y: number, stage: InkStage): void {
  cornerMark(surf, x, y, stage);
}
