import type { Rng } from "./rng";

/**
 * 深度の曲線と揺らぎの共通の器（docs/ideas/scaling-impl.md 2-6）。純関数だけで、state を持たない。
 * 敵の生命・攻撃の曲線（data/enemies.ts）、陣ごとの生命の揺らぎ（system/jinSpawn.ts）、装備の揺らぎ（loot/flux.ts）が使う。
 */

/**
 * 深度の曲線。値 = (base ?? 1) + perDepth × (d − 1)。deepDepth 以降は深度 deepDepth の値から
 * 1 階ごとに deepGrowth 倍（指数）。deepDepth か deepGrowth が無ければ最後まで線形
 */
export interface DepthCurve {
  base?: number;
  perDepth: number;
  deepDepth?: number;
  deepGrowth?: number;
}

/** 深度は 1 が最初の階。それより小さい値は 1 として扱う（曲線が基準値を下回らないように） */
const FIRST_DEPTH = 1;

function linearAt(curve: DepthCurve, depth: number): number {
  return (curve.base ?? 1) + curve.perDepth * (Math.max(FIRST_DEPTH, depth) - FIRST_DEPTH);
}

export function curveAt(curve: DepthCurve, depth: number): number {
  const { deepDepth, deepGrowth } = curve;
  if (deepDepth === undefined || deepGrowth === undefined || depth <= deepDepth) return linearAt(curve, depth);
  return linearAt(curve, deepDepth) * deepGrowth ** (depth - deepDepth);
}

/** 平均に掛ける倍率の三角分布。mode 省略は 1（平均そのもの） */
export interface Spread {
  low: number;
  mode?: number;
  high: number;
}

const SPREAD_DEFAULT_MODE = 1;

/** 三角分布（low..high、最頻値 mode）。rng を 1 回引く */
export function triangular(rng: Rng, low: number, mode: number, high: number): number {
  const u = rng.next();
  const span = high - low;
  if (span <= 0) return mode;
  const split = (mode - low) / span;
  if (u < split) return low + Math.sqrt(u * span * (mode - low));
  return high - Math.sqrt((1 - u) * span * (high - mode));
}

/** mean に Spread の倍率（三角分布）を掛けた値を 1 つ引く。rng を 1 回引く */
export function rollSpread(rng: Rng, mean: number, spread: Spread): number {
  return mean * triangular(rng, spread.low, spread.mode ?? SPREAD_DEFAULT_MODE, spread.high);
}
