import type { GameState } from "../core/state";
import { KEYSTONE } from "../data/tuning";

/**
 * キーストーン判定ヘルパー。key は src/loot/affixes.ts の KEYSTONES と揃える。
 * 数値だけのキーストーン（glassCannon / windWalker など）は computeStats 側で適用済み。
 */
export const KS = {
  berserker: "ks_berserker",
  blink: "ks_blink",
  pacifist: "ks_pacifist",
  bladeOath: "ks_bladeOath",
  juggernaut: "ks_juggernaut",
  gambler: "ks_gambler",
  vampire: "ks_vampire",
  overclock: "ks_overclock",
} as const;

export type KeystoneKey = (typeof KS)[keyof typeof KS];

export function hasKeystone(state: GameState, key: KeystoneKey): boolean {
  return state.stats.keystones.includes(key);
}

/** ks_berserker: 失った HP の割合ぶん与ダメが増える */
export function berserkerMul(state: GameState): number {
  if (!hasKeystone(state, KS.berserker)) return 1;
  const p = state.player;
  if (p.maxHp <= 0) return 1;
  return 1 + Math.max(0, 1 - p.hp / p.maxHp);
}

/** ks_gambler: 1 ヒットごとのランダム倍率 */
export function gamblerMul(state: GameState): number {
  if (!hasKeystone(state, KS.gambler)) return 1;
  return KEYSTONE.gamblerMin + state.rng.next() * (KEYSTONE.gamblerMax - KEYSTONE.gamblerMin);
}

/** 毎秒回復が有効か（berserker / vampire は無効） */
export function regenAllowed(state: GameState): boolean {
  return !hasKeystone(state, KS.berserker) && !hasKeystone(state, KS.vampire);
}

export function healMul(state: GameState): number {
  return hasKeystone(state, KS.berserker) ? KEYSTONE.berserkerHealMul : 1;
}

/** ks_vampire: ハートを拾えない */
export function heartsAllowed(state: GameState): boolean {
  return !hasKeystone(state, KS.vampire);
}

/** ks_overclock: 行動ごとに HP を払う（1 未満にはしない） */
export function payOverclock(state: GameState, cost: number): void {
  if (!hasKeystone(state, KS.overclock)) return;
  const p = state.player;
  p.hp = Math.max(1, p.hp - cost);
}
