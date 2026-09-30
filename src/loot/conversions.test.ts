import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { TRIGGER } from "../data/tuning";
import { CONVERSION_AFFIXES, INFUSE_KEY_PREFIX, affixDef, formatAffix, isConversionKey } from "./affixes";
import { CONVERSION_TRAIT_CHANCE, UNIQUES, generateItem } from "./generator";
import { computeStats } from "./stats";
import { DEFAULT_STATS, createEmptyEquipment, type AffixRoll, type Equipment, type Item } from "./types";

const NOW = 1_700_000_000_000;

function roll(key: string, value: number, value2?: number): AffixRoll {
  const r: AffixRoll = { key, value };
  if (value2 !== undefined) r.value2 = value2;
  return r;
}

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "item-1",
    seed: 1,
    baseKey: "longsword",
    slot: "mainHand",
    rarity: "magic",
    itemLevel: 20,
    name: "test",
    implicit: null,
    affixes: [],
    foundDepth: 10,
    foundAt: 0,
    ...overrides,
  };
}

function equip(item: Item): Equipment {
  const eq = createEmptyEquipment();
  eq[item.slot] = item;
  return eq;
}

/** 性質 2 つまでなら共鳴しない（MIN_RESONANCE_WEIGHT 未満）ので、変換の数値だけを見られる */
function statsWith(affixes: AffixRoll[], slot: Item["slot"] = "ring"): ReturnType<typeof computeStats> {
  return computeStats(equip(makeItem({ slot, baseKey: "ironRing", affixes })));
}

describe("変換の性質", () => {
  it("8 種以上あり、すべて convert 段階・conversion タグ・cv_ 接頭辞", () => {
    expect(CONVERSION_AFFIXES.length).toBeGreaterThanOrEqual(8);
    for (const def of CONVERSION_AFFIXES) {
      expect(isConversionKey(def.key)).toBe(true);
      expect(def.stage).toBe("convert");
      expect(def.tags).toContain("conversion");
      expect(affixDef(def.key)).toBe(def);
    }
  });

  it("転じ 12 と属性の変換 6 の 18 種", () => {
    expect(CONVERSION_AFFIXES.length).toBe(18);
    expect(CONVERSION_AFFIXES.filter((d) => d.key.startsWith(INFUSE_KEY_PREFIX)).length, "属性の変換").toBe(6);
  });

  it("表示は「〜につき」「変換」「会心時:」で語る", () => {
    for (const def of CONVERSION_AFFIXES) {
      const point = def.curve[0];
      if (!point) throw new Error(def.key);
      const text = formatAffix(roll(def.key, point.min, point.min2));
      expect(text, def.key).toMatch(/(変換|につき|会心時:)/);
    }
    expect(formatAffix(roll("cv_critToLightning", 8))).toBe("会心時: 連鎖雷（8 ダメージ）");
  });

  it("会心率 → 連鎖係数: 会心率 1% につき v% の連鎖係数", () => {
    const s = statsWith([roll("cv_critToChain", 2)]);
    expect(s.chainCoefBonus).toBeCloseTo(DEFAULT_STATS.critChance * 100 * 0.02, 5);
  });

  it("最大気力 → 弾数: 最大気力の v% を manaPerProjectile ごとに 1 本、気力自然回復は倍率が掛かる", () => {
    const s = statsWith([roll("cv_manaToProjectiles", 100)], "amulet");
    expect(s.projectileCount).toBe(1 + Math.floor(DEFAULT_STATS.maxMana / TRIGGER.trait.manaPerProjectile));
    expect(s.manaRegen).toBeCloseTo(DEFAULT_STATS.manaRegen * TRIGGER.trait.manaToProjectileRegenMul, 5);
  });

  it("dash charges → 距離: チャージは 1 に、距離はチャージ数に比例", () => {
    const s = computeStats(equip(makeItem({ slot: "boots", baseKey: "boots", affixes: [roll("cv_chargesToDistance", 50)] })));
    expect(s.dashCharges).toBe(1);
    expect(s.dashDistanceMul).toBeCloseTo(1 + 0.5 * DEFAULT_STATS.dashCharges, 5);
  });

  it("「〜につき」の転じは Modifier を足す（移動速度・防御力・最大生命・コンボ猶予・持ち金）", () => {
    const perOf = (key: string, slot: Item["slot"]): string | undefined => statsWith([roll(key, 1)], slot).modifiers.find((m) => m.owner.key === key)?.per?.count.kind;
    expect(perOf("cv_speedToDamage", "amulet")).toBe("stat");
    expect(perOf("cv_armorToPoise", "boots")).toBe("stat");
    expect(perOf("cv_lifeToArea", "amulet")).toBe("stat");
    expect(perOf("cv_comboToFinisher", "ring")).toBe("stat");
    expect(perOf("cv_coinsToMore", "ring")).toBe("coins");
    const poise = statsWith([roll("cv_armorToPoise", 1)], "boots").modifiers.find((m) => m.owner.key === "cv_armorToPoise");
    expect(poise?.tag, "怯み値だけに掛かる").toBe("poise");
  });

  it("会心時の転じは Rule（onCrit）を stats.rules に積む（内部 CD は TRIGGER.trait.critRuleIcd）", () => {
    const s = statsWith([roll("cv_critToLightning", 8), roll("cv_critToCoins", 2)]);
    const kinds = s.rules.map((r) => [r.when, r.then.kind, r.then.magnitude, r.icd]);
    expect(kinds).toEqual([
      ["onCrit", "chainLightning", 8, TRIGGER.trait.critRuleIcd],
      ["onCrit", "gainCoins", 2, TRIGGER.trait.critRuleIcd],
    ]);
  });

  it("抽選に変換が混ざり、1 アイテムに 1 つまで（名のある遺物を除く）。名のある遺物にも組み込まれている", () => {
    expect(CONVERSION_TRAIT_CHANCE).toBeGreaterThan(0);
    const rng = createRng(3);
    let seen = 0;
    for (let i = 0; i < 2000; i++) {
      const item = generateItem(rng, { itemLevel: 30, rarityBoost: 4, foundDepth: 30, now: NOW });
      const conversions = item.affixes.filter((a) => isConversionKey(a.key));
      if (item.namedKey === undefined) expect(conversions.length).toBeLessThanOrEqual(1);
      if (conversions.length > 0) seen++;
      // 変換は反転しない
      for (const c of conversions) expect(c.inverted).toBeUndefined();
    }
    expect(seen).toBeGreaterThan(0);
    expect(UNIQUES.some((u) => u.affixes.some((a) => isConversionKey(a.key)))).toBe(true);
  });
});
