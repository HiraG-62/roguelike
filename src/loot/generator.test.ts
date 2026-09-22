import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { affixDef, implicitDef } from "./affixes";
import { baseDef } from "./bases";
import {
  UNIQUES,
  generateItem,
  rollAffixes,
  rollRarity,
  uniquesFor,
  type GenerateOptions,
} from "./generator";
import { SLOTS, type AffixRoll, type Item, type Rarity } from "./types";

const NOW = 1_700_000_000_000;
const MANY = 1000;
const HIGH_LEVEL = 40;

function opts(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return { itemLevel: 10, foundDepth: 5, now: NOW, ...overrides };
}

function generateMany(count: number, seed: number, o: Partial<GenerateOptions> = {}): Item[] {
  const rng = createRng(seed);
  const items: Item[] = [];
  for (let i = 0; i < count; i++) {
    items.push(generateItem(rng, opts({ itemLevel: 1 + (i % HIGH_LEVEL), ...o })));
  }
  return items;
}

function expectRollInRange(roll: AffixRoll, itemLevel: number, rarity: Rarity): void {
  const def = affixDef(roll.key);
  expect(def, roll.key).toBeDefined();
  if (def === undefined) return;
  expect(roll.kind).toBe(def.kind);
  const tier = def.tiers[roll.tier - 1];
  expect(tier, `${roll.key} T${roll.tier}`).toBeDefined();
  if (tier === undefined) return;
  // unique は固定 tier なので minLevel 制約の対象外
  if (rarity !== "unique") expect(tier.minLevel).toBeLessThanOrEqual(itemLevel);
  expect(roll.value).toBeGreaterThanOrEqual(tier.min);
  expect(roll.value).toBeLessThanOrEqual(tier.max);
  if (tier.min2 === undefined || tier.max2 === undefined) {
    expect(roll.value2).toBeUndefined();
    return;
  }
  expect(roll.value2).toBeDefined();
  expect(roll.value2 ?? Number.NaN).toBeGreaterThanOrEqual(tier.min2);
  expect(roll.value2 ?? Number.NaN).toBeLessThanOrEqual(tier.max2);
}

describe("generateItem", () => {
  it("同 seed 同 opts で同一アイテム（id の連番部分を除く）", () => {
    const a = generateItem(createRng(42), opts());
    const b = generateItem(createRng(42), opts());
    expect({ ...a, id: "" }).toEqual({ ...b, id: "" });
    expect(a.id.split("-")[0]).toBe(b.id.split("-")[0]);
  });

  it("1000 個生成して例外なし・id ユニーク", () => {
    const items = generateMany(MANY, 7);
    expect(items).toHaveLength(MANY);
    expect(new Set(items.map((i) => i.id)).size).toBe(MANY);
  });

  it("rarity ごとのアフィックス数が範囲内（prefix/suffix 上限も守る）", () => {
    const items = generateMany(MANY, 11, { rarityBoost: 2 });
    const seen = new Set<Rarity>();
    for (const item of items) {
      seen.add(item.rarity);
      const prefixes = item.affixes.filter((a) => a.kind === "prefix").length;
      const suffixes = item.affixes.filter((a) => a.kind === "suffix").length;
      switch (item.rarity) {
        case "normal":
          expect(item.affixes).toHaveLength(0);
          break;
        case "magic":
          expect(item.affixes.length).toBeGreaterThanOrEqual(1);
          expect(item.affixes.length).toBeLessThanOrEqual(2);
          expect(prefixes).toBeLessThanOrEqual(1);
          expect(suffixes).toBeLessThanOrEqual(1);
          break;
        case "rare":
          expect(item.affixes.length).toBeGreaterThanOrEqual(3);
          expect(item.affixes.length).toBeLessThanOrEqual(6);
          expect(prefixes).toBeLessThanOrEqual(3);
          expect(suffixes).toBeLessThanOrEqual(3);
          break;
        case "unique":
          expect(item.affixes.length).toBeGreaterThan(0);
          break;
      }
    }
    expect(seen.has("normal") && seen.has("magic") && seen.has("rare")).toBe(true);
  });

  it("アフィックス key が 1 アイテム内で重複しない", () => {
    for (const item of generateMany(MANY, 13, { rarityBoost: 3 })) {
      const keys = item.affixes.map((a) => a.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("tier の minLevel ≤ itemLevel、値が tier の範囲内", () => {
    for (const item of generateMany(MANY, 17, { rarityBoost: 2 })) {
      for (const roll of item.affixes) expectRollInRange(roll, item.itemLevel, item.rarity);
    }
  });

  it("implicit はベースの定義どおりにロールされる", () => {
    for (const item of generateMany(200, 19)) {
      const base = baseDef(item.baseKey);
      expect(base?.slot).toBe(item.slot);
      expect(base?.minLevel ?? Infinity).toBeLessThanOrEqual(item.itemLevel);
      const implicit = item.implicit;
      expect(implicit?.key).toBe(base?.implicitKey);
      if (implicit === null) continue;
      const def = implicitDef(implicit.key);
      expect(def).toBeDefined();
      if (def === undefined) continue;
      expect(implicit.value).toBeGreaterThanOrEqual(def.range.min);
      expect(implicit.value).toBeLessThanOrEqual(def.range.max);
    }
  });

  it("slot 指定が守られる", () => {
    for (const slot of SLOTS) {
      for (const item of generateMany(50, 23, { slot, rarityBoost: 5 })) {
        expect(item.slot).toBe(slot);
        expect(baseDef(item.baseKey)?.slot).toBe(slot);
      }
    }
  });

  it("名前が rarity に応じて付く", () => {
    for (const item of generateMany(300, 29, { rarityBoost: 3 })) {
      const base = baseDef(item.baseKey);
      expect(item.name.length).toBeGreaterThan(0);
      if (item.rarity === "normal") expect(item.name).toBe(base?.name);
      if (item.rarity === "magic") expect(item.name).toContain(base?.name ?? "");
      if (item.rarity === "rare") expect(item.name.split(" ")).toHaveLength(2);
      if (item.rarity === "unique") expect(UNIQUES.map((u) => u.name)).toContain(item.name);
    }
  });

  it("itemLevel が低くても（0 以下でも）生成できる", () => {
    const item = generateItem(createRng(1), opts({ itemLevel: 0 }));
    expect(item.itemLevel).toBe(1);
  });

  it("高 rarityBoost・高 itemLevel では unique が出る", () => {
    const items = generateMany(MANY, 31, { itemLevel: HIGH_LEVEL, rarityBoost: 20 });
    expect(items.some((i) => i.rarity === "unique")).toBe(true);
  });
});

describe("rollRarity", () => {
  it("rarityBoost で rare 以上の割合が増える", () => {
    const countRare = (boost: number): number => {
      const rng = createRng(99);
      let n = 0;
      for (let i = 0; i < MANY; i++) {
        const r = rollRarity(rng, 5, boost);
        if (r === "rare" || r === "unique") n++;
      }
      return n;
    };
    expect(countRare(3)).toBeGreaterThan(countRare(0));
  });
});

describe("rollAffixes", () => {
  it("normal は 0 個", () => {
    expect(rollAffixes(createRng(3), "weapon", "normal", 10)).toHaveLength(0);
  });

  it("prefix → suffix の順に並ぶ", () => {
    const rolls = rollAffixes(createRng(5), "ring", "rare", 30);
    const firstSuffix = rolls.findIndex((r) => r.kind === "suffix");
    if (firstSuffix < 0) return;
    expect(rolls.slice(firstSuffix).every((r) => r.kind === "suffix")).toBe(true);
  });
});

describe("unique 定義", () => {
  it("3〜5 個あり、ベース・アフィックス・tier が実在する", () => {
    expect(UNIQUES.length).toBeGreaterThanOrEqual(3);
    expect(UNIQUES.length).toBeLessThanOrEqual(5);
    for (const u of UNIQUES) {
      const base = baseDef(u.baseKey);
      expect(base, u.key).toBeDefined();
      expect(u.minLevel).toBeGreaterThanOrEqual(base?.minLevel ?? Infinity);
      expect(uniquesFor(base?.slot ?? "weapon", u.minLevel)).toContain(u);
      for (const spec of u.affixes) {
        const def = affixDef(spec.key);
        expect(def?.tiers[spec.tier - 1], `${u.key}/${spec.key}`).toBeDefined();
      }
    }
  });
});
