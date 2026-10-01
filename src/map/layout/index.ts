/**
 * 階の型（8 種）の入口。型ごとの生成器の表、地図の大きさに合わせた枠（拡縮の規則）、
 * 生成 → 後処理 → 検査 → 作り直しの流れをまとめる（docs/ideas/map-gen-impl.md 2-4・2-5）。
 */
import type { Rng } from "../../core/rng";
import { FLOOR_LORD, MAP_LAYOUT } from "../../data/tuning";
import type { GameMap } from "../grid";
import { generateCavern } from "./cavern";
import { generateCourt } from "./court";
import { generateDrunk } from "./drunk";
import { finalizeLayout } from "./finalize";
import { generateIsle } from "./isle";
import { generatePrefab } from "./prefab";
import { generateRing } from "./ring";
import { generateRiver } from "./river";
import { generateTerrace } from "./terrace";
import type { LayoutFrame, LayoutGenerator, LayoutKind } from "./types";
import { validateLayout } from "./validate";

/** 生成に落ちたとき（生成器が null・検査に落ちた）同じ rng を進めて作り直す最大回数。全部落ちたら null（旧生成器へ） */
export const GENERATE_ATTEMPTS = 8;

/** noiseSeed の範囲（座標ハッシュの種。32bit の符号なしを超えない） */
const NOISE_SEED_MAX = 0x7fffffff;
/** areaScale で縮めた地図の幅・高さの下限（タイル） */
const MIN_SIDE = 24;

export const LAYOUT_GENERATORS: Record<LayoutKind, LayoutGenerator> = {
  cavern: generateCavern,
  river: generateRiver,
  ring: generateRing,
  court: generateCourt,
  drunk: generateDrunk,
  isle: generateIsle,
  terrace: generateTerrace,
  prefab: generatePrefab,
};

/** 型の数値のうち拡縮の規則が読むもの（テストで差し替えられるように型を切り出す） */
export interface LayoutScaleParams {
  previewWidth: number;
  previewHeight: number;
  unitExp: number;
}

/**
 * 地図の大きさ（width x height）に合わせた生成器の枠。
 * S = √(W·H ÷ 見本の面積)、長さの倍率 u = S ^ unitExp、個数の倍率 countMul = S² ÷ u²。
 * 道幅（通路・桟道・はしご・坂）は体の大きさで決まるので据え置き（生成器が unit を掛けない）
 */
export function layoutFrameFor(
  width: number,
  height: number,
  noiseSeed = 0,
  lordRadius: number = FLOOR_LORD.arenaRadius,
  params: LayoutScaleParams = MAP_LAYOUT,
): LayoutFrame {
  const s = Math.sqrt((width * height) / (params.previewWidth * params.previewHeight));
  const unit = s ** params.unitExp;
  return { width, height, unit, countMul: (s * s) / (unit * unit), noiseSeed, lordRadius };
}

/** 型ごとの面積の縮み（areaScale。幅と高さが √ 倍）を掛けた大きさ */
export function scaledSize(kind: LayoutKind, width: number, height: number): { width: number; height: number } {
  const scale = (MAP_LAYOUT.areaScale as Readonly<Partial<Record<LayoutKind, number>>>)[kind] ?? 1;
  if (scale === 1) return { width, height };
  const side = Math.sqrt(scale);
  return { width: Math.max(MIN_SIDE, Math.round(width * side)), height: Math.max(MIN_SIDE, Math.round(height * side)) };
}

/**
 * 型 kind で width x height 前後の階（地図）を作る。作れなければ null（呼び出し側が旧生成器へ落ちる）。
 * 1 回の試行は noiseSeed を rng から 1 回引く → 生成器 → finalizeLayout → validateLayout。
 * 落ちたら同じ rng のまま最大 GENERATE_ATTEMPTS 回。地図の大きさは型ごとの areaScale で縮むことがある（map.width / height を読むこと）
 */
export function generateLayoutMap(
  kind: LayoutKind,
  rng: Rng,
  width: number,
  height: number,
  generators: Readonly<Record<LayoutKind, LayoutGenerator>> = LAYOUT_GENERATORS,
): GameMap | null {
  const size = scaledSize(kind, width, height);
  const generate = generators[kind];
  for (let attempt = 0; attempt < GENERATE_ATTEMPTS; attempt++) {
    const frame = layoutFrameFor(size.width, size.height, rng.int(0, NOISE_SEED_MAX));
    const draft = generate(rng, frame);
    if (!draft) continue;
    const map = finalizeLayout(kind, draft, frame);
    if (map && validateLayout(map) === null) return map;
  }
  return null;
}
