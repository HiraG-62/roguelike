import { describe, expect, it } from "vitest";
import { ELEMENTS } from "../core/element";
import { AFFIXES, CONVERSION_AFFIXES, ELEMENT_TRAIT_COLOR, INFUSE_KEY_PREFIX, INNATE_LINE_DEFS, RESIST_TRAIT_PREFIX, affixDef, formatAffix } from "./affixes";
import { computeStats, statsSummary } from "./stats";
import { type AffixRoll, type Item, createEmptyEquipment } from "./types";

/** 防御・属性耐性・属性の変換の性質（docs/COMBAT_DESIGN.md A-8） */

function roll(key: string, value: number, value2?: number): AffixRoll {
  const r: AffixRoll = { key, value };
  if (value2 !== undefined) r.value2 = value2;
  return r;
}

/** 性質 2 つまでなら共鳴しないので、性質の数値だけを見られる */
function statsWith(affixes: AffixRoll[], slot: Item["slot"] = "ring"): ReturnType<typeof computeStats> {
  const eq = createEmptyEquipment();
  eq[slot] = {
    id: "item-1",
    seed: 1,
    baseKey: slot === "ring" ? "ironRing" : "longsword",
    slot,
    rarity: "magic",
    itemLevel: 20,
    name: "test",
    implicit: null,
    affixes,
    foundDepth: 10,
    foundAt: 0,
  };
  return computeStats(eq);
}

describe("属性耐性の地金の行", () => {
  it("無属性を除く 6 属性に耐性の地金の行がある。全属性耐性・魔防・堅牢は段取り 7d で消した", () => {
    for (const e of ELEMENTS.filter((x) => x !== "none")) {
      const def = affixDef(`${RESIST_TRAIT_PREFIX}${e}`);
      expect(def, e).toBeDefined();
      expect(INNATE_LINE_DEFS, e).toContain(def);
      expect(AFFIXES, `${e} は抽選に出ない`).not.toContain(def);
    }
    expect(affixDef(`${RESIST_TRAIT_PREFIX}all`)).toBeUndefined();
    expect(affixDef("wardingFlat")).toBeUndefined();
    expect(affixDef("sturdy")).toBeUndefined();
  });

  it("耐性の行はその属性の耐性を足す（無属性は防御の受け持ち）", () => {
    const s = statsWith([roll("res_fire", 20), roll("res_ice", 5)]);
    expect(s.resist.fire).toBe(20);
    expect(s.resist.ice).toBe(5);
    expect(s.resist.none, "無属性は防御の受け持ち").toBe(0);
  });

  it("ステータス一覧に耐性の行が出る", () => {
    const lines = statsSummary(statsWith([roll("res_ice", 12)]));
    expect(lines).toContain("氷耐性 +12%");
  });
});

describe("属性の変換（6 種）", () => {
  const infuse = CONVERSION_AFFIXES.filter((d) => d.key.startsWith(INFUSE_KEY_PREFIX));

  it("6 属性の 6 種（無の刻印は段取り 7d で消した）。色は属性の色（炎 = 紅 / 氷 = 蒼 / 雷 = 金 / 毒 = 翠 / 闇 = 冥）", () => {
    expect(infuse.length).toBe(6);
    expect(affixDef("cv_infuseFire")?.color).toBe(ELEMENT_TRAIT_COLOR.fire);
    expect(ELEMENT_TRAIT_COLOR.fire).toBe("crimson");
    expect(ELEMENT_TRAIT_COLOR.ice).toBe("azure");
    expect(ELEMENT_TRAIT_COLOR.lightning).toBe("gold");
    expect(ELEMENT_TRAIT_COLOR.poison).toBe("jade");
    expect(ELEMENT_TRAIT_COLOR.dark).toBe("umbra");
  });

  it("通常攻撃の割合を属性へ移し、合計が 100% を超えたら按分で 100% に縮める", () => {
    const s = statsWith([roll("cv_infuseFire", 40)], "mainHand");
    expect(s.infuse.fire).toBeCloseTo(0.4);
    const over = statsWith([roll("cv_infuseFire", 80), roll("cv_infuseIce", 80)], "mainHand");
    expect(over.infuse.fire + over.infuse.ice).toBeCloseTo(1);
    expect(over.infuse.fire).toBeCloseTo(over.infuse.ice);
  });

  it("表示は変換として語る", () => {
    expect(formatAffix(roll("cv_infuseFire", 40))).toBe("近接・射撃の40%を炎属性に変換");
  });
});
