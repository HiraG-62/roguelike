/**
 * 階の型の選び方（docs/ideas/map-gen-impl.md 2-3）。純関数 chooseLayout が rng から 1 回だけ引いて 8 型のどれかを選ぶ。
 * 重み = weight × 章の倍率（深みは deepMul）× floorKind の倍率。minDepth に満たない型と、前の階と同じ型は重みを落とす。
 * 数値は data/balance/world/MAP_LAYOUT/_index.json
 */
import type { Rng } from "../../core/rng";
import { MAP_LAYOUT } from "../../data/tuning";
import { type FloorLayout, LAYOUT_KINDS, type LayoutContext, type LayoutKind } from "./types";

type KindMul = Readonly<Partial<Record<LayoutKind, number>>>;

/** chooseLayout が読む数値（MAP_LAYOUT の一部。テストで差し替えられるように型を切り出す） */
export interface LayoutSelectParams {
  weight: Readonly<Record<LayoutKind, number>>;
  /** 章ごと（添字 0 = 1 章目）の倍率。書かない型は 1 */
  chapterMul: readonly KindMul[];
  deepMul: KindMul;
  /** フロア種別ごとの倍率（省略可） */
  biomeMul?: Readonly<Partial<Record<string, KindMul>>>;
  minDepth: Readonly<Record<LayoutKind, number>>;
  repeatMul: number;
}

/** withFixedLayout の間だけ使う固定の型（null なら抽選） */
let fixedLayout: FloorLayout | null = null;

/**
 * fn の間だけ chooseLayout が必ず kind を返す（乱数を引かない）。テストの検証場（system/testHelpers.ts の arena を
 * "legacy" に固定するなど）と、型ごとのテストが特定の型で階を作るため。ゲーム本体からは呼ばない。
 * 固定はボス階より優先する
 */
export function withFixedLayout<T>(kind: FloorLayout, fn: () => T): T {
  const saved = fixedLayout;
  fixedLayout = kind;
  try {
    return fn();
  } finally {
    fixedLayout = saved;
  }
}

/**
 * この階の型を選ぶ。
 * 乱数を引かない: 固定が掛かっているとき（withFixedLayout）、ボス階（"lordHall"。専用の部屋は別レーン）。
 * それ以外は rng.next() を 1 回だけ引く
 */
export function chooseLayout(rng: Rng, ctx: LayoutContext, params: LayoutSelectParams = MAP_LAYOUT): FloorLayout {
  if (fixedLayout) return fixedLayout;
  if (ctx.isBossFloor) return "lordHall";
  const weights = LAYOUT_KINDS.map((kind) => layoutWeight(kind, ctx, params));
  const total = weights.reduce((sum, w) => sum + w, 0);
  const roll = rng.next();
  if (total <= 0) return fallbackKind(ctx, params);
  let r = roll * total;
  for (let i = 0; i < LAYOUT_KINDS.length; i++) {
    r -= weights[i] ?? 0;
    const kind = LAYOUT_KINDS[i];
    if (r < 0 && kind) return kind;
  }
  // 浮動小数の丸めで取りこぼしたら、重みを持つ最後の型
  for (let i = LAYOUT_KINDS.length - 1; i >= 0; i--) {
    const kind = LAYOUT_KINDS[i];
    if ((weights[i] ?? 0) > 0 && kind) return kind;
  }
  return fallbackKind(ctx, params);
}

/** 型 1 つの重み（0 以上）。minDepth 未満は 0、前の階と同じ型は repeatMul 倍 */
export function layoutWeight(kind: LayoutKind, ctx: LayoutContext, params: LayoutSelectParams = MAP_LAYOUT): number {
  if (params.minDepth[kind] > ctx.depth) return 0;
  const phase = ctx.isDeep ? params.deepMul[kind] : chapterMulOf(params.chapterMul, ctx.chapter, kind);
  const biome = params.biomeMul?.[ctx.floorKind]?.[kind];
  const repeat = ctx.previous === kind ? params.repeatMul : 1;
  return Math.max(0, params.weight[kind] * (phase ?? 1) * (biome ?? 1) * repeat);
}

function chapterMulOf(rows: readonly KindMul[], chapter: number, kind: LayoutKind): number | undefined {
  const row = rows[Math.min(Math.max(1, Math.floor(chapter)), rows.length) - 1];
  return row?.[kind];
}

/** 重みがすべて 0 のとき（設定の誤り・全型が minDepth 未満）: 深度の条件だけ満たす最初の型、無ければ先頭の型 */
function fallbackKind(ctx: LayoutContext, params: LayoutSelectParams): LayoutKind {
  return LAYOUT_KINDS.find((kind) => params.minDepth[kind] <= ctx.depth) ?? "cavern";
}
