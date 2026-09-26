import { describe, expect, it } from "vitest";
import { ELEMENTS } from "../core/element";
import { CONVERSION_AFFIXES, ELEMENT_TRAIT_COLOR, INFUSE_KEY_PREFIX, RESIST_TRAIT_PREFIX, affixDef, formatAffix } from "./affixes";
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

describe("属性耐性・防御の性質", () => {
  it("無属性を除く 6 属性に耐性の性質があり、全属性耐性・魔防・堅牢を加えて 9 種", () => {
    for (const e of ELEMENTS.filter((x) => x !== "none")) expect(affixDef(`${RESIST_TRAIT_PREFIX}${e}`), e).toBeDefined();
    expect(affixDef(`${RESIST_TRAIT_PREFIX}all`)).toBeDefined();
    expect(affixDef("wardingFlat")).toBeDefined();
    expect(affixDef("sturdy")?.tags).toContain("tradeoff");
  });

  it("耐性の性質はその属性の耐性を足し、全属性耐性は無属性以外すべてに足す", () => {
    const s = statsWith([roll("res_fire", 20), roll("res_all", 5)]);
    expect(s.resist.fire).toBe(25);
    expect(s.resist.ice).toBe(5);
    expect(s.resist.none, "無属性は防御の受け持ち").toBe(0);
  });

  it("魔防と堅牢（防御力と魔防 + 移動速度 −）", () => {
    const s = statsWith([roll("wardingFlat", 7), roll("sturdy", 4, 5)], "ring");
    expect(s.warding).toBe(11);
    expect(s.armor).toBe(4);
    expect(s.moveSpeedMul).toBeCloseTo(0.95);
  });

  it("ステータス一覧に魔防と耐性の行が出る", () => {
    const lines = statsSummary(statsWith([roll("wardingFlat", 7), roll("res_ice", 12)]));
    expect(lines).toContain("魔防 7");
    expect(lines).toContain("氷耐性 +12%");
  });
});

describe("属性の変換（7 種）", () => {
  const infuse = CONVERSION_AFFIXES.filter((d) => d.key.startsWith(INFUSE_KEY_PREFIX));

  it("6 属性 + 無の刻印の 7 種。色は属性の色（炎 = 紅 / 氷 = 蒼 / 雷 = 金 / 毒 = 翠 / 闇 = 冥）", () => {
    expect(infuse.length).toBe(7);
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

  it("無の刻印はスキルの無属性化の割合（100% で頭打ち）", () => {
    expect(statsWith([roll("cv_infuseNone", 60)]).skillNeutral).toBeCloseTo(0.6);
    expect(statsWith([roll("cv_infuseNone", 150)]).skillNeutral).toBe(1);
  });

  it("表示は変換として語る", () => {
    expect(formatAffix(roll("cv_infuseFire", 40))).toBe("近接・射撃の40%を炎属性に変換");
  });
});
