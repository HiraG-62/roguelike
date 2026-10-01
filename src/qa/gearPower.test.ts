import { describe, expect, it } from "vitest";
import { LOOT_SLOTS } from "../loot/types";
import { buildGearPowerSection, fittedEquipment, measureGearPower, sampleGear, withoutInnate } from "./gearPower";

/** Item.id は生成のたびに増える連番の接尾辞が付くので、比べるときは外す */
function withoutIds(eq: ReturnType<typeof fittedEquipment>): string {
  return JSON.stringify(eq, (key, value: unknown) => (key === "id" ? undefined : value));
}

describe("深度に見合う装備", () => {
  it("6 部位すべて itemLevel = 深度の並の遺物で、右手は剣になる", () => {
    const eq = fittedEquipment(1, 12);
    for (const slot of LOOT_SLOTS) {
      const item = eq[slot];
      expect(item, `${slot} が埋まる`).not.toBeNull();
      expect(item?.itemLevel, `${slot} の itemLevel`).toBe(12);
      expect(item?.namedKey, `${slot} は名のある遺物にならない`).toBeUndefined();
    }
    expect(eq.mainHand?.baseKey).toBe("shortsword");
    expect(eq.offHand, "左手は空").toBeNull();
  });

  it("seed と深度が同じなら同じ装備で、深度が違えば別の装備になる", () => {
    const a = fittedEquipment(3, 10);
    const b = fittedEquipment(3, 10);
    expect(withoutIds(b), "決定的").toBe(withoutIds(a));
    expect(withoutIds(fittedEquipment(3, 20))).not.toBe(withoutIds(a));
  });

  it("地金を外した写しは地金だけが空になり、元の装備は変わらない", () => {
    const eq = fittedEquipment(2, 20);
    const bare = withoutInnate(eq);
    for (const slot of LOOT_SLOTS) {
      expect(bare[slot]?.innate, `${slot} の地金`).toEqual([]);
      expect(bare[slot]?.affixes, `${slot} の性質は残る`).toEqual(eq[slot]?.affixes);
    }
    expect(eq.armor?.innate?.length, "元の装備の地金は残る").toBeGreaterThan(0);
  });
});

describe("地力 ÷ 敵の生命", () => {
  it("深度が深いほど平均の 1 撃が深度 1 より強く、深度 1 の比は 1 になる", () => {
    const rows = measureGearPower([1, 10, 20], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(rows[0]?.powerRatio, "深度 1 は基準").toBeCloseTo(1, 5);
    expect(rows[1]?.hit ?? 0, "深度 10 の 1 撃は深度 1 より強い").toBeGreaterThan(rows[0]?.hit ?? Infinity);
    expect(rows[2]?.hit ?? 0, "深度 20 の 1 撃は深度 1 より強い").toBeGreaterThan(rows[0]?.hit ?? Infinity);
    for (const r of rows) {
      expect(r.hit, `深度 ${r.depth} の地金込みは地金なし以上`).toBeGreaterThanOrEqual(r.hitWithoutInnate - 1e-9);
      expect(Number.isFinite(r.ratio), `深度 ${r.depth} の比が有限`).toBe(true);
    }
  });

  it("同じ seed なら同じ値になり、表に NaN が出ない", () => {
    expect(sampleGear(4, 15)).toEqual(sampleGear(4, 15));
    const md = buildGearPowerSection(measureGearPower([1, 5], [1, 2]), 2).join("\n");
    expect(md).not.toMatch(/NaN|Infinity/);
    expect(md).toContain("| 5 |");
  });
});
