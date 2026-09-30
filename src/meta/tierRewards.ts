import { TIER_REWARD } from "../data/tuning";
import type { ProfileMeta } from "../loot/types";
import type { TierPerk } from "../system/runMeta";

/**
 * 踏破した最高位階の見返り（docs/ideas/meta-impl.md 2-6）。
 * プロフィールの踏破の回数と最高位階（meta.clears / bestClearTier）から導く純関数で、新しい保存値は持たない。
 * 強さを配らず、選べる幅（章の市の品・出口の本数）だけを増やす
 */

/** 見返りを導く元（プロフィールの踏破の記録。拠点の材料も同じ形で渡す） */
export type ClearMeta = Pick<ProfileMeta, "clears" | "bestClearTier">;

/** 位階の称号（実績の key は clearTier1 … clearTier20）を出す位階。key に使うので TS に置く */
export const CLEAR_TITLE_TIERS = [1, 5, 10, 15, 20] as const;

/** 最高位階の見返り 1 つ: 必要な位階・効く仕組み・表示の語 */
interface PerkRule {
  perk: TierPerk;
  tier: number;
  label: string;
}

function marketExtraCount(): number {
  return Object.values<number>(TIER_REWARD.marketExtra).reduce((sum, n) => sum + n, 0);
}

function perkRules(): readonly PerkRule[] {
  return [
    { perk: "market", tier: TIER_REWARD.marketTier, label: `章の市の品 +${marketExtraCount()}` },
    { perk: "exit", tier: TIER_REWARD.exitTier, label: `出口 +${TIER_REWARD.exitExtra}` },
  ];
}

/** 踏破したことがあるか（位階 0 の踏破は bestClearTier を持たないので clears で見る） */
export function hasCleared(meta: Readonly<ClearMeta>): boolean {
  return (meta.clears ?? 0) > 0;
}

/** 踏破した最高位階。踏破していなければ 0 */
export function bestClearTierOf(meta: Readonly<ClearMeta>): number {
  return hasCleared(meta) ? (meta.bestClearTier ?? 0) : 0;
}

/** 次のランに効く見返り。踏破していなければ空（rules 表の順） */
export function tierPerks(meta: Readonly<ClearMeta>): TierPerk[] {
  if (!hasCleared(meta)) return [];
  const best = bestClearTierOf(meta);
  return perkRules()
    .filter((r) => best >= r.tier)
    .map((r) => r.perk);
}

/** 死亡画面の踏破の行に添える、まだ得ていない見返りのうち最も近い位階のもの。全部得ていれば null */
export function nextTierRewardLine(meta: Readonly<ClearMeta>): string | null {
  const best = bestClearTierOf(meta);
  const ahead = perkRules().filter((r) => r.tier > best);
  if (ahead.length === 0) return null;
  const tier = Math.min(...ahead.map((r) => r.tier));
  const labels = ahead.filter((r) => r.tier === tier).map((r) => r.label);
  return `次の見返り: 位階 ${tier} で踏破 → ${labels.join("・")}`;
}

/** 拠点の飾り「踏破の碑」の文言。踏破していなければ null */
export function steleLabel(meta: Readonly<ClearMeta>): string | null {
  if (!hasCleared(meta)) return null;
  return `踏破の碑（踏破 ${meta.clears ?? 0} 回・最高位階 ${bestClearTierOf(meta)}）`;
}
