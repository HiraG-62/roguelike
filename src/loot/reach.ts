import { REACH } from "../data/tuning";
import { REACH_KEYS, type PlayerStats, type ReachKey } from "./types";

/** 割合（1 = 100%）を % 表示に直す倍率 */
const PERCENT_SCALE = 100;
/** 性質の足し算の小数の誤差（0.3 + 0.5 が閾値 0.8 に届かない扱いを避ける） */
const EPSILON = 1e-9;

/**
 * 厳選の到達点（docs/ideas/deep-impl.md 2-4）。遺物の性質を同じ向きに重ね、装備だけで数えた量が閾値に届くと、
 * その軸の決まりが 1 つ変わる。測る量は computeStats が stats.reach に入れる（祝福・起点・祭壇の誓約では届かない）
 */
export interface ReachDef {
  readonly key: ReachKey;
  /** 表示名（無尽 / 燎原 / 常在） */
  readonly name: string;
  /** 測る量の名（効果の頁の detail に出す） */
  readonly measureLabel: string;
  /** 届いたときの効果（効果そのもの） */
  readonly effect: string;
  /** 届く閾値（REACH.*） */
  readonly threshold: number;
  /** 届かせる主な性質の key（QA の届き方の見積もり。先頭が主） */
  readonly affixes: readonly string[];
  /** 装備だけの stats から測る量を取る */
  measure(stats: Readonly<PlayerStats>): number;
  /** 測る量・閾値の表示（連鎖は「+80%」、他は「+7」） */
  format(value: number): string;
}

function formatPercent(value: number): string {
  return `+${Math.round(value * PERCENT_SCALE)}%`;
}

function formatFlat(value: number): string {
  return `+${Math.round(value)}`;
}

export const REACH_DEFS: Readonly<Record<ReachKey, ReachDef>> = {
  chain: {
    key: "chain",
    name: "無尽",
    measureLabel: "連鎖係数",
    effect: "連鎖が衰えない",
    threshold: REACH.chain,
    affixes: ["chainSource", "cv_critToChain"],
    measure: (stats) => stats.chainCoefBonus,
    format: formatPercent,
  },
  burn: {
    key: "burn",
    name: "燎原",
    measureLabel: "燃焼の重ねの上限",
    effect: "燃焼が際限なく重なる",
    threshold: REACH.burn,
    affixes: ["burnStack"],
    measure: (stats) => stats.statusStackCapBonus.burn ?? 0,
    format: formatFlat,
  },
  morale: {
    key: "morale",
    name: "常在",
    measureLabel: "戦意の上限",
    effect: "戦意が冷めない",
    threshold: REACH.morale,
    affixes: ["moraleCap"],
    measure: (stats) => stats.moraleMaxAdd,
    format: formatFlat,
  },
};

/** 装備だけの stats から 3 軸の測る量を取る（computeStats の最後で stats.reach に入れる） */
export function reachMeasures(stats: Readonly<PlayerStats>): Record<ReachKey, number> {
  return {
    chain: REACH_DEFS.chain.measure(stats),
    burn: REACH_DEFS.burn.measure(stats),
    morale: REACH_DEFS.morale.measure(stats),
  };
}

/** 到達しているか（stats.reach は装備だけの値。拠点でもラン中でも同じ） */
export function hasReach(stats: Readonly<PlayerStats>, key: ReachKey): boolean {
  return stats.reach[key] >= REACH_DEFS[key].threshold - EPSILON;
}

/** 到達している軸（REACH_KEYS の順） */
export function reachedKeys(stats: Readonly<PlayerStats>): ReachKey[] {
  return REACH_KEYS.filter((key) => hasReach(stats, key));
}
