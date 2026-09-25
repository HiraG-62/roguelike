import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { WEAPON } from "../data/tuning";
import { CONVERSION_AFFIXES, affixDef, formatAffix, isConversionKey } from "./affixes";
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

  it("表示は動詞で語る", () => {
    for (const def of CONVERSION_AFFIXES) {
      const point = def.curve[0];
      if (!point) throw new Error(def.key);
      const text = formatAffix(roll(def.key, point.min, point.min2));
      expect(text).toMatch(/(変換|消費)/);
    }
    expect(formatAffix(roll("cv_meleeToBurn", 40))).toBe("近接ダメージの40%を炎上に変換");
  });

  it("melee → burn: 近接倍率の一部を burn に移す（scale の後に掛かる）", () => {
    const s = statsWith([roll("meleeDamagePct", 50), roll("cv_meleeToBurn", 40)], "amulet");
    // 1.5 * 0.6 = 0.9、移した 0.6 → burn DPS 6、chance 0.4 * 0.5 = 0.2。右手が空なので最後に素手の倍率が掛かる
    expect(s.meleeDamageMul).toBeCloseTo(0.9 * WEAPON.unarmed.damageMul, 5);
    expect(s.burnDps).toBeCloseTo(6, 5);
    expect(s.burnChance).toBeCloseTo(0.2, 5);
  });

  it("crit chance → crit multiplier: chance が 0 になり、1% あたり v% の倍率になる", () => {
    const s = statsWith([roll("critChance", 10), roll("cv_critToMultiplier", 5)]);
    // chance 0.15 → multiplier +0.75
    expect(s.critChance).toBe(0);
    expect(s.critMul).toBeCloseTo(DEFAULT_STATS.critMul + 0.75, 5);
  });

  it("max HP → armor: 30% の HP を 1/3 の armor に", () => {
    const s = statsWith([roll("cv_lifeToArmor", 30)], "armor");
    expect(s.maxHp).toBe(70);
    expect(s.armor).toBeCloseTo(10, 5);
  });

  it("dash charges → 距離: チャージは 1 に、距離はチャージ数に比例", () => {
    const s = computeStats(
      equip(
        makeItem({
          slot: "boots",
          baseKey: "boots",
          affixes: [roll("dashCharge", 1), roll("cv_chargesToDistance", 50)],
        }),
      ),
    );
    expect(s.dashCharges).toBe(1);
    // 2 チャージ × 50% = +100%（boots の implicit は無し）
    expect(s.dashDistanceMul).toBeCloseTo(2, 5);
  });

  it("spread → pierce: 弾数に比例して射撃ダメージが減り、pierce が増える", () => {
    const s = statsWith([roll("projectiles", 2, 0), roll("cv_splitToPierce", 10, 3)], "amulet");
    expect(s.projectileCount).toBe(3);
    expect(s.pierce).toBe(3);
    expect(s.rangedDamageMul).toBeCloseTo(0.8, 5);
  });

  it("move speed の超過分 → attack speed", () => {
    const s = statsWith([roll("moveSpeed", 20), roll("cv_speedToAttack", 50)], "amulet");
    expect(s.moveSpeedMul).toBeCloseTo(1.1, 5);
    expect(s.attackSpeedMul).toBeCloseTo(1.1, 5);
  });

  it("combo damage → JUST damage、life on hit → energy", () => {
    const combo = statsWith([roll("comboDamage", 2, 40), roll("cv_comboToJust", 50)]);
    expect(combo.comboDamageCap).toBeCloseTo(0.2, 5);
    expect(combo.justDodgeDamageMul).toBeCloseTo(1 + 0.2 * 1.5, 5);
    const leech = statsWith([roll("lifeOnHit", 4), roll("cv_leechToEnergy", 50)]);
    expect(leech.lifeOnHit).toBeCloseTo(2, 5);
    expect(leech.energyGainMul).toBeCloseTo(1 + 2 * 0.15, 5);
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
