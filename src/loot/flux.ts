import type { Rng } from "../core/rng";
import type { AffixDef, CurvePoint } from "./affixes";
import type { AffixRoll, Rarity } from "./types";

/**
 * 揺らぎ（期待値 + 分散）。docs/LOOT_DESIGN.md「揺らぎ」。
 * - 期待値 nominal: 性質の期待値曲線（旧 tier 表）を深度で線形補間した値
 * - 揺らぎ flux: value = nominal * (1 + flux)。幅 σ は深度で広がる
 * - 反転: 発見深度 INVERSION_MIN_DEPTH 以降、一定確率で flux < -1（値が負）になる
 * tier のような段階は持たない。
 */

/** σ = min(SIGMA_BASE + SIGMA_PER_DEPTH * depth, SIGMA_MAX) × (1 + boost * SIGMA_PER_BOOST) */
export const SIGMA_BASE = 0.12;
export const SIGMA_PER_DEPTH = 0.05;
export const SIGMA_MAX = 1;
/** ドロップ元の boost（ボス・宝物庫など）1 あたりの σ の増加率 */
export const SIGMA_PER_BOOST = 0.1;
/** 三角分布の下端・上端（σ に対する倍率）。上に少しだけ長い */
export const FLUX_LOW_SCALE = 1.3;
export const FLUX_HIGH_SCALE = 1.5;
/** 反転していない性質の flux の下限（値が 0 や負にならないように） */
export const MIN_FLUX = -0.9;
/** 変換の性質の flux の上限（変換割合が 100% を大きく超えないように） */
export const MAX_CONVERSION_FLUX = 0.5;

/** 反転が起こり始める発見深度 */
export const INVERSION_MIN_DEPTH = 13;
export const INVERSION_BASE_CHANCE = 0.04;
export const INVERSION_CHANCE_PER_DEPTH = 0.01;
export const INVERSION_MAX_CHANCE = 0.15;
/** 反転したときの |value| / nominal の範囲 */
export const INVERTED_MAGNITUDE_MIN = 0.2;
export const INVERTED_MAGNITUDE_MAX = 0.9;

/** 見た目の分類（静 / 揺 / 荒）の境界。|flux| の最大値で決める */
export const CALM_FLUX_LIMIT = 0.15;
export const WAVER_FLUX_LIMIT = 0.45;

const NO_FLUX = 0;

export interface Nominal {
  nominal: number;
  nominal2?: number;
}

function mid(min: number, max: number): number {
  return (min + max) / 2;
}

function sortedCurve(def: AffixDef): CurvePoint[] {
  return [...def.curve].sort((a, b) => a.depth - b.depth);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function pointNominal(p: CurvePoint): Nominal {
  const out: Nominal = { nominal: mid(p.min, p.max) };
  if (p.min2 !== undefined && p.max2 !== undefined) out.nominal2 = mid(p.min2, p.max2);
  return out;
}

/**
 * 深度での期待値。曲線の点（depth, 幅の中央）を線形補間する。
 * 最初の点より浅ければ最初の点、最後の点より深ければ最後の点の値
 */
export function nominalAt(def: AffixDef, depth: number): Nominal {
  const curve = sortedCurve(def);
  const first = curve[0];
  if (first === undefined) return { nominal: 0 };
  if (depth <= first.depth) return pointNominal(first);
  for (let i = 1; i < curve.length; i++) {
    const hi = curve[i];
    const lo = curve[i - 1];
    if (hi === undefined || lo === undefined) continue;
    if (depth > hi.depth) continue;
    const t = (depth - lo.depth) / (hi.depth - lo.depth);
    const a = pointNominal(lo);
    const b = pointNominal(hi);
    const out: Nominal = { nominal: lerp(a.nominal, b.nominal, t) };
    if (a.nominal2 !== undefined && b.nominal2 !== undefined) out.nominal2 = lerp(a.nominal2, b.nominal2, t);
    return out;
  }
  const last = curve[curve.length - 1];
  return last === undefined ? { nominal: 0 } : pointNominal(last);
}

export function sigmaAt(depth: number, boost = 0): number {
  const base = Math.min(SIGMA_BASE + SIGMA_PER_DEPTH * Math.max(0, depth), SIGMA_MAX);
  return base * (1 + Math.max(0, boost) * SIGMA_PER_BOOST);
}

/** 三角分布（low..high、最頻値 mode） */
export function triangular(rng: Rng, low: number, mode: number, high: number): number {
  const u = rng.next();
  const span = high - low;
  if (span <= 0) return mode;
  const split = (mode - low) / span;
  if (u < split) return low + Math.sqrt(u * span * (mode - low));
  return high - Math.sqrt((1 - u) * span * (high - mode));
}

/** 反転していない flux を 1 つ引く（MIN_FLUX..上端） */
export function rollFlux(rng: Rng, sigma: number): number {
  const flux = triangular(rng, -FLUX_LOW_SCALE * sigma, NO_FLUX, FLUX_HIGH_SCALE * sigma);
  return Math.max(MIN_FLUX, flux);
}

export function inversionChance(foundDepth: number): number {
  if (foundDepth < INVERSION_MIN_DEPTH) return 0;
  const chance = INVERSION_BASE_CHANCE + INVERSION_CHANCE_PER_DEPTH * (foundDepth - INVERSION_MIN_DEPTH);
  return Math.min(INVERSION_MAX_CHANCE, chance);
}

/** 反転した flux（< -1）を 1 つ引く */
export function rollInvertedFlux(rng: Rng): number {
  const magnitude = INVERTED_MAGNITUDE_MIN + rng.next() * (INVERTED_MAGNITUDE_MAX - INVERTED_MAGNITUDE_MIN);
  return -1 - magnitude;
}

function roundTo(v: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(v * scale) / scale;
}

/**
 * nominal * (1 + flux) を decimals 桁に丸める。符号は flux で決まり（-1 未満なら負）、
 * 丸めで 0 になる場合は最小単位に寄せる（性質が「何もしない」にならないように）
 */
export function valueFromFlux(nominal: number, flux: number, decimals: number): number {
  const raw = roundTo(nominal * (1 + flux), decimals);
  const step = 10 ** -decimals;
  const negative = flux < -1;
  if (negative) return raw < 0 ? raw : -step;
  return raw > 0 ? raw : step;
}

export interface FluxedValues {
  value: number;
  value2?: number;
}

/** 期待値と flux から value / value2 を作る */
export function fluxedValues(nominal: Nominal, flux: number, decimals: number, decimals2: number): FluxedValues {
  const out: FluxedValues = { value: valueFromFlux(nominal.nominal, flux, decimals) };
  if (nominal.nominal2 !== undefined) out.value2 = valueFromFlux(nominal.nominal2, flux, decimals2);
  return out;
}

/** 揺らぎの大きさ（反転は flux の絶対値が 1 を超える） */
export function fluxMagnitude(roll: AffixRoll): number {
  return Math.abs(roll.flux ?? 0);
}

/**
 * 見た目の分類（旧レアリティのキー）。反転あり → unique、|flux| の最大で 静 / 揺 / 荒。
 * 格付けではなく荒れ具合なので、性質が無いアイテムは静
 */
export function fluxClassOf(affixes: readonly AffixRoll[]): Rarity {
  if (affixes.some((r) => r.inverted === true)) return "unique";
  const max = affixes.reduce((m, r) => Math.max(m, fluxMagnitude(r)), 0);
  if (max < CALM_FLUX_LIMIT) return "normal";
  if (max < WAVER_FLUX_LIMIT) return "magic";
  return "rare";
}
