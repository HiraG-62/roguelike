import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { KEYSTONE_KEY_PREFIX, affixDef, implicitDef, keystoneDef } from "./affixes";
import { baseDef } from "./bases";
import { decodeTriggerRoll, isTriggerKey } from "./triggers";
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

const isKeystone = (r: AffixRoll): boolean => r.key.startsWith(KEYSTONE_KEY_PREFIX);
/** アフィックス枠を占めるもの（キーストーンは別枠） */
const slotAffixes = (item: Item): AffixRoll[] => item.affixes.filter((r) => !isKeystone(r));

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
      const affixes = slotAffixes(item);
      const prefixes = affixes.filter((a) => a.kind === "prefix").length;
      const suffixes = affixes.filter((a) => a.kind === "suffix").length;
      expect(item.affixes.filter(isKeystone).length).toBeLessThanOrEqual(1);
      switch (item.rarity) {
        case "normal":
          expect(item.affixes).toHaveLength(0);
          break;
        case "magic":
          expect(affixes.length).toBeGreaterThanOrEqual(1);
          expect(affixes.length).toBeLessThanOrEqual(2);
          expect(prefixes).toBeLessThanOrEqual(1);
          expect(suffixes).toBeLessThanOrEqual(1);
          break;
        case "rare":
          expect(affixes.length).toBeGreaterThanOrEqual(3);
          expect(affixes.length).toBeLessThanOrEqual(6);
          expect(prefixes).toBeLessThanOrEqual(3);
          expect(suffixes).toBeLessThanOrEqual(3);
          break;
        case "unique":
          expect(affixes.length).toBeGreaterThan(0);
          expect(item.affixes.filter(isKeystone)).toHaveLength(1);
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
      for (const roll of item.affixes) {
        if (isKeystone(roll)) {
          expect(keystoneDef(roll.key), roll.key).toBeDefined();
          expect(roll.kind).toBe("suffix");
          continue;
        }
        if (isTriggerKey(roll.key)) {
          expect(decodeTriggerRoll(roll), roll.key).not.toBeNull();
          continue;
        }
        expectRollInRange(roll, item.itemLevel, item.rarity);
      }
    }
  });

  it("トレードオフ付きアフィックスが生成され、代償側 value2 も tier の範囲内", () => {
    let seen = 0;
    for (const item of generateMany(MANY, 43, { rarityBoost: 3 })) {
      for (const roll of item.affixes) {
        const def = affixDef(roll.key);
        if (def === undefined || !def.tags.includes("tradeoff")) continue;
        seen++;
        const tier = def.tiers[roll.tier - 1];
        expect(tier?.min2).toBeDefined();
        expect(roll.value2 ?? Number.NaN).toBeGreaterThanOrEqual(tier?.min2 ?? Infinity);
        expect(roll.value2 ?? Number.NaN).toBeLessThanOrEqual(tier?.max2 ?? -Infinity);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("トリガー文法アフィックスは rare にだけ付き、ある程度の頻度で出る", () => {
    const items = generateMany(MANY, 37, { rarityBoost: 3 });
    for (const item of items) {
      if (item.rarity === "rare") continue;
      expect(item.affixes.some((r) => isTriggerKey(r.key))).toBe(false);
    }
    const rares = items.filter((i) => i.rarity === "rare");
    const withTrigger = rares.filter((i) => i.affixes.some((r) => isTriggerKey(r.key)));
    // 1 枠 25%・3〜6 枠なので、トリガー付き rare は過半数になるはず
    expect(withTrigger.length / rares.length).toBeGreaterThan(0.5);
  });

  it("キーストーンは rare の約 15% に付き、normal / magic には付かない", () => {
    const items = generateMany(MANY * 3, 41, { rarityBoost: 3 });
    for (const item of items) {
      if (item.rarity === "normal" || item.rarity === "magic") {
        expect(item.affixes.some(isKeystone)).toBe(false);
      }
    }
    const rares = items.filter((i) => i.rarity === "rare");
    const ratio = rares.filter((i) => i.affixes.some(isKeystone)).length / rares.length;
    expect(ratio).toBeGreaterThan(0.08);
    expect(ratio).toBeLessThan(0.22);
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
      if (item.rarity === "rare") expect(item.name.split("の")).toHaveLength(2);
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

  it("itemLevel 8 / boost 0.3 で unique 出現率が 1%〜5%（通常ドロップ相当）", () => {
    const rng = createRng(2024);
    const N = 10_000;
    let uniqueCount = 0;
    for (let i = 0; i < N; i++) {
      if (rollRarity(rng, 8, 0.3) === "unique") uniqueCount++;
    }
    const ratio = uniqueCount / N;
    expect(ratio).toBeGreaterThanOrEqual(0.01);
    expect(ratio).toBeLessThanOrEqual(0.05);
  });

  it("itemLevel 8 / boost 1.5 で unique 出現率が 10%〜25%（ボス撃破ドロップ相当）", () => {
    const rng = createRng(4048);
    const N = 10_000;
    let uniqueCount = 0;
    for (let i = 0; i < N; i++) {
      if (rollRarity(rng, 8, 1.5) === "unique") uniqueCount++;
    }
    const ratio = uniqueCount / N;
    expect(ratio).toBeGreaterThanOrEqual(0.1);
    expect(ratio).toBeLessThanOrEqual(0.25);
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
  it("15 個あり、ベース・アフィックス・tier が実在する", () => {
    expect(UNIQUES.length).toBeGreaterThanOrEqual(15);
    for (const u of UNIQUES) {
      const base = baseDef(u.baseKey);
      expect(base, u.key).toBeDefined();
      expect(u.minLevel).toBeGreaterThanOrEqual(base?.minLevel ?? Infinity);
      expect(uniquesFor(base?.slot ?? "weapon", u.minLevel)).toContain(u);
      expect(u.keystone === undefined || keystoneDef(u.keystone) !== undefined, u.key).toBe(true);
      for (const spec of u.affixes) {
        const def = affixDef(spec.key);
        expect(def?.tiers[spec.tier - 1], `${u.key}/${spec.key}`).toBeDefined();
      }
    }
  });

  it("各スロットに 2 つ以上ある", () => {
    for (const slot of SLOTS) {
      const count = UNIQUES.filter((u) => baseDef(u.baseKey)?.slot === slot).length;
      expect(count, slot).toBeGreaterThanOrEqual(2);
    }
  });

  it("uniquesFor はそのスロット・itemLevel で解禁済みの unique だけを返す", () => {
    for (const slot of SLOTS) {
      for (const u of uniquesFor(slot, 30)) {
        expect(baseDef(u.baseKey)?.slot).toBe(slot);
        expect(u.minLevel).toBeLessThanOrEqual(30);
      }
    }
  });
});
