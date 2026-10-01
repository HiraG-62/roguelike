import { describe, expect, it } from "vitest";
import { TIER_REWARD } from "../data/tuning";
import { CLEAR_TITLE_TIERS, nextTierRewardLine, steleLabel, tierPerks } from "./tierRewards";

describe("位階の見返り", () => {
  it("踏破していなければ見返りは無い（最高位階があっても clears が 0 なら無効）", () => {
    expect(tierPerks({})).toEqual([]);
    expect(tierPerks({ clears: 0, bestClearTier: 20 })).toEqual([]);
    expect(steleLabel({})).toBeNull();
  });

  it("位階 0 の踏破では見返りは無く、最高位階 3 で market、10 で exit", () => {
    expect(tierPerks({ clears: 1 }), "位階 0 で踏破").toEqual([]);
    expect(tierPerks({ clears: 1, bestClearTier: TIER_REWARD.marketTier - 1 })).toEqual([]);
    expect(tierPerks({ clears: 1, bestClearTier: TIER_REWARD.marketTier })).toEqual(["market"]);
    expect(tierPerks({ clears: 4, bestClearTier: TIER_REWARD.exitTier })).toEqual(["market", "exit"]);
  });

  it("次の見返りの行: まだ得ていない最も近い位階のもの。全部得ていれば無い", () => {
    const first = nextTierRewardLine({ clears: 1 });
    expect(first, "最初の見返り").toContain(`位階 ${TIER_REWARD.marketTier}`);
    expect(first).toContain("章の市の品 +1");
    expect(nextTierRewardLine({ clears: 1, bestClearTier: TIER_REWARD.marketTier })).toContain("出口 +1");
    expect(nextTierRewardLine({ clears: 1, bestClearTier: TIER_REWARD.exitTier })).toBeNull();
  });

  it("踏破の碑は回数と最高位階を語る", () => {
    const label = steleLabel({ clears: 3, bestClearTier: 5 });
    expect(label).toContain("3 回");
    expect(label).toContain("最高位階 5");
  });

  it("位階の称号の位階は昇順で重ならない", () => {
    expect([...CLEAR_TITLE_TIERS]).toEqual([...CLEAR_TITLE_TIERS].sort((a, b) => a - b));
    expect(new Set(CLEAR_TITLE_TIERS).size).toBe(CLEAR_TITLE_TIERS.length);
  });
});
