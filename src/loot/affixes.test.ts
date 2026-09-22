import { describe, expect, it } from "vitest";
import { AFFIXES, IMPLICITS, affixDef, affixesFor, formatAffix, implicitDef } from "./affixes";
import { BASES, baseDef, basesForSlot } from "./bases";
import { SLOTS } from "./types";

const MIN_AFFIX_COUNT = 35;
const KIND_LIMIT = 3;
const FIRST_LEVEL = 1;

describe("アフィックス定義", () => {
  it(`${MIN_AFFIX_COUNT} 種以上ある`, () => {
    expect(AFFIXES.length).toBeGreaterThanOrEqual(MIN_AFFIX_COUNT);
  });

  it("key が affix / implicit を通して重複しない", () => {
    const keys = [...AFFIXES.map((a) => a.key), ...IMPLICITS.map((i) => i.key)];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("全 def の tiers が minLevel 昇順（最下位 tier → T1）かつ min≤max", () => {
    for (const def of AFFIXES) {
      expect(def.tiers.length, def.key).toBeGreaterThan(0);
      // index 0 = T1 なので、末尾（最下位）から先頭に向かって minLevel が昇順
      const levelsLowToHigh = [...def.tiers].reverse().map((t) => t.minLevel);
      const sorted = [...levelsLowToHigh].sort((a, b) => a - b);
      expect(levelsLowToHigh, def.key).toEqual(sorted);
      for (const tier of def.tiers) {
        expect(tier.min, def.key).toBeLessThanOrEqual(tier.max);
        if (tier.min2 !== undefined || tier.max2 !== undefined) {
          expect(tier.min2, def.key).toBeDefined();
          expect(tier.max2, def.key).toBeDefined();
          expect(tier.min2 ?? 0, def.key).toBeLessThanOrEqual(tier.max2 ?? 0);
        }
      }
    }
  });

  it("2 値ラベルを持つ def は全 tier に value2 のロール幅がある", () => {
    for (const def of AFFIXES) {
      if (!def.label.includes("{v2}")) continue;
      for (const tier of def.tiers) expect(tier.min2, def.key).toBeDefined();
    }
  });

  it("各スロットで ilvl 1 から prefix / suffix が 3 種以上抽選できる", () => {
    for (const slot of SLOTS) {
      expect(affixesFor(slot, "prefix", FIRST_LEVEL).length, slot).toBeGreaterThanOrEqual(KIND_LIMIT);
      expect(affixesFor(slot, "suffix", FIRST_LEVEL).length, slot).toBeGreaterThanOrEqual(KIND_LIMIT);
    }
  });

  it("affixDef で引ける", () => {
    expect(affixDef("meleeDamagePct")?.kind).toBe("prefix");
    expect(affixDef("does-not-exist")).toBeUndefined();
  });

  it("formatAffix が 1 値 / 2 値 / 小数 / implicit を整形する", () => {
    expect(formatAffix({ key: "meleeDamagePct", kind: "prefix", tier: 1, value: 25 })).toBe(
      "+25% melee damage",
    );
    expect(formatAffix({ key: "burn", kind: "prefix", tier: 2, value: 12, value2: 9 })).toBe(
      "12% chance to burn for 9 damage per second",
    );
    expect(formatAffix({ key: "hpRegen", kind: "suffix", tier: 3, value: 1.5 })).toBe(
      "+1.5 HP regenerated per second",
    );
    expect(formatAffix({ key: "implicit.shortsword", kind: "prefix", tier: 1, value: 10 })).toBe(
      "+10% melee damage",
    );
  });
});

describe("ベースアイテム定義", () => {
  it("各スロットに 4〜5 種あり、ilvl 1 で最低 1 種出る", () => {
    for (const slot of SLOTS) {
      const count = BASES.filter((b) => b.slot === slot).length;
      expect(count, slot).toBeGreaterThanOrEqual(4);
      expect(count, slot).toBeLessThanOrEqual(5);
      expect(basesForSlot(slot, FIRST_LEVEL).length, slot).toBeGreaterThan(0);
    }
  });

  it("implicitKey が全て実在する", () => {
    for (const base of BASES) {
      if (base.implicitKey === undefined) continue;
      expect(implicitDef(base.implicitKey), base.key).toBeDefined();
    }
  });

  it("baseDef で引ける", () => {
    expect(baseDef("greatsword")?.slot).toBe("weapon");
    expect(baseDef("nope")).toBeUndefined();
  });
});
