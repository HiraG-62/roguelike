import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { generateItem } from "./generator";
import { computeStats, statsSummary } from "./stats";
import { DEFAULT_STATS, SLOTS, createEmptyEquipment, type Item, type Slot } from "./types";

const NOW = 1_700_000_000_000;

function makeItem(slot: Slot, partial: Partial<Item>): Item {
  return {
    id: `test-${slot}`,
    seed: 0,
    baseKey: "test",
    slot,
    rarity: "magic",
    itemLevel: 1,
    name: "Test",
    implicit: null,
    affixes: [],
    foundDepth: 1,
    foundAt: NOW,
    ...partial,
  };
}

describe("computeStats", () => {
  it("空装備で DEFAULT_STATS と一致", () => {
    expect(computeStats(createEmptyEquipment())).toEqual(DEFAULT_STATS);
  });

  it("DEFAULT_STATS の配列を共有しない", () => {
    const stats = computeStats(createEmptyEquipment());
    expect(stats.keystones).not.toBe(DEFAULT_STATS.keystones);
    expect(stats.triggers).not.toBe(DEFAULT_STATS.triggers);
  });

  it("implicit と affix を反映する", () => {
    const equipment = createEmptyEquipment();
    equipment.weapon = makeItem("weapon", {
      implicit: { key: "implicit.greatsword", kind: "prefix", tier: 1, value: 40 },
      affixes: [
        { key: "meleeDamagePct", kind: "prefix", tier: 3, value: 25 },
        { key: "meleeDamageFlat", kind: "prefix", tier: 4, value: 5 },
        { key: "critChance", kind: "suffix", tier: 5, value: 2 },
        { key: "burn", kind: "prefix", tier: 4, value: 5, value2: 3 },
      ],
    });
    const stats = computeStats(equipment);
    expect(stats.meleeDamageMul).toBeCloseTo(1 + 0.4 + 0.25);
    expect(stats.attackSpeedMul).toBeCloseTo(0.75);
    expect(stats.meleeReachMul).toBeCloseTo(1.2);
    expect(stats.meleeDamageFlat).toBe(5);
    expect(stats.critChance).toBeCloseTo(0.07);
    expect(stats.burnChance).toBeCloseTo(0.05);
    expect(stats.burnDps).toBe(3);
  });

  it("max HP % は全スロットの flat 合算後に掛かる", () => {
    const equipment = createEmptyEquipment();
    // % を先の slot（armor）に、flat を後の slot（ring）に置いても順序に依存しない
    equipment.armor = makeItem("armor", {
      affixes: [{ key: "maxLifePct", kind: "prefix", tier: 4, value: 10 }],
    });
    equipment.ring = makeItem("ring", {
      affixes: [{ key: "maxLife", kind: "prefix", tier: 5, value: 20 }],
    });
    expect(computeStats(equipment).maxHp).toBe(132);
  });

  it("整数化とクランプが効く", () => {
    const equipment = createEmptyEquipment();
    equipment.ring = makeItem("ring", {
      affixes: [
        { key: "critChance", kind: "suffix", tier: 1, value: 500 },
        { key: "maxLife", kind: "prefix", tier: 1, value: -1000 },
      ],
    });
    equipment.gun = makeItem("gun", {
      implicit: { key: "implicit.shotgun", kind: "prefix", tier: 1, value: 2 },
    });
    const stats = computeStats(equipment);
    expect(stats.critChance).toBe(1);
    expect(stats.maxHp).toBe(1);
    expect(Number.isInteger(stats.projectileCount)).toBe(true);
    expect(stats.projectileCount).toBe(3);
    expect(Number.isInteger(stats.dashCharges)).toBe(true);
  });

  it("未知の key は無視する", () => {
    const equipment = createEmptyEquipment();
    equipment.amulet = makeItem("amulet", {
      implicit: { key: "removed.implicit", kind: "prefix", tier: 1, value: 99 },
      affixes: [{ key: "removedAffix", kind: "suffix", tier: 1, value: 99 }],
    });
    expect(computeStats(equipment)).toEqual(DEFAULT_STATS);
  });

  it("ランダム装備を全スロットに付けても値が健全", () => {
    const rng = createRng(123);
    for (let run = 0; run < 100; run++) {
      const equipment = createEmptyEquipment();
      for (const slot of SLOTS) {
        equipment[slot] = generateItem(rng, { itemLevel: 40, slot, rarityBoost: 3, foundDepth: 1, now: NOW });
      }
      const stats = computeStats(equipment);
      for (const value of Object.values(stats)) {
        if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
      }
      expect(stats.critChance).toBeGreaterThanOrEqual(0);
      expect(stats.critChance).toBeLessThanOrEqual(1);
      expect(stats.maxHp).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("statsSummary", () => {
  it("DEFAULT では空", () => {
    expect(statsSummary({ ...DEFAULT_STATS })).toEqual([]);
  });

  it("異なる項目だけを列挙する", () => {
    const summary = statsSummary({
      ...DEFAULT_STATS,
      maxHp: 140,
      meleeDamageMul: 1.25,
      critChance: 0.12,
      comboWindowBonus: 0.5,
    });
    expect(summary).toEqual([
      "Max HP 140",
      "Melee Damage +25%",
      "Crit Chance 12%",
      "Combo Window +0.5s",
    ]);
  });
});
