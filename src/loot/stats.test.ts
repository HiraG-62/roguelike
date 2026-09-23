import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { STATUS } from "../data/tuning";
import { scaleFlat } from "./flux";
import { generateItem } from "./generator";
import { computeStats, softCap, statsSummary } from "./stats";
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
    // 紅 3 / 金 1 → 紅の支配（灼極）: 近接 +10%、金の性質（会心率）は 75% に弱まる。implicit は色を持たず弱まらない
    expect(stats.resonance.kind).toBe("dominant");
    expect(stats.resonance.colors).toEqual(["crimson"]);
    expect(stats.meleeDamageMul).toBeCloseTo(1 + 0.4 + 0.25 + scaleFlat(0.1, 4));
    expect(stats.attackSpeedMul).toBeCloseTo(0.75);
    expect(stats.meleeReachMul).toBeCloseTo(1.2);
    expect(stats.meleeDamageFlat).toBe(5);
    expect(stats.critChance).toBeCloseTo(0.05 + 0.02 * 0.75);
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

  it("chillSlow の上限は STATUS.maxSlow に統一されている（statusEffects.ts の chillFactor と同じ値）", () => {
    const equipment = createEmptyEquipment();
    const chillAffix = { key: "chill", kind: "prefix" as const, tier: 1, value: 20, value2: 30 };
    // weapon / gun / ring に chill を積んで 90% 分（旧上限 0.9 を超えて検出できる値）にする
    equipment.weapon = makeItem("weapon", { affixes: [chillAffix] });
    equipment.gun = makeItem("gun", { affixes: [chillAffix] });
    equipment.ring = makeItem("ring", { affixes: [chillAffix] });
    const stats = computeStats(equipment);
    expect(stats.chillSlow).toBeCloseTo(STATUS.maxSlow);
    expect(stats.chillSlow).toBeLessThanOrEqual(STATUS.maxSlow);
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

describe("softCap", () => {
  it("+100% 以下はそのまま", () => {
    expect(softCap(1)).toBe(1);
    expect(softCap(2)).toBe(2);
    expect(softCap(0.5)).toBe(0.5);
  });

  it("単調増加だが伸びが鈍る", () => {
    let prev = softCap(2);
    let prevGain = Infinity;
    for (let mul = 2.5; mul <= 6; mul += 0.5) {
      const v = softCap(mul);
      expect(v).toBeGreaterThan(prev);
      expect(v - prev).toBeLessThan(prevGain);
      prevGain = v - prev;
      prev = v;
    }
  });

  it("+300% を積んでも 3 倍にならない（computeStats 経由）", () => {
    const equipment = createEmptyEquipment();
    const melee = (slot: Slot, value: number): Item =>
      makeItem(slot, { affixes: [{ key: "meleeDamagePct", kind: "prefix", tier: 1, value }] });
    equipment.weapon = melee("weapon", 100);
    equipment.ring = melee("ring", 100);
    equipment.amulet = melee("amulet", 100);
    const stats = computeStats(equipment);
    expect(stats.meleeDamageMul).toBeGreaterThan(2);
    expect(stats.meleeDamageMul).toBeLessThan(3);
  });
});

describe("キーストーンとトリガーの集計", () => {
  const ks = (key: string) => ({ key, kind: "suffix" as const, tier: 1, value: 0 });

  it("同じ排他グループは後勝ち（装備順）で 1 つだけ残る", () => {
    const equipment = createEmptyEquipment();
    equipment.weapon = makeItem("weapon", { affixes: [ks("ks_glassCannon")] });
    equipment.ring = makeItem("ring", { affixes: [ks("ks_juggernaut"), ks("ks_gambler")] });
    const stats = computeStats(equipment);
    expect(stats.keystones).toEqual(["ks_juggernaut", "ks_gambler"]);
    // 誓約 3 つ = 冥の支配（虚極: 被ダメ +10%）。負けた誓約も色の配合には数える
    expect(stats.resonance.colors).toEqual(["umbra"]);
    expect(stats.damageTakenMul).toBeCloseTo(0.5 + 0.1);
    expect(stats.moveSpeedMul).toBeCloseTo(0.65);
    expect(stats.critChance).toBeCloseTo(0.15);
    // 負けた glassCannon の数値効果は掛からない
    expect(stats.maxHp).toBe(DEFAULT_STATS.maxHp);
    expect(stats.meleeDamageMul).toBe(1);
  });

  it("glassCannon は与ダメ 2 倍・最大 HP 1/4（flat 合算後に掛かる）", () => {
    const equipment = createEmptyEquipment();
    equipment.weapon = makeItem("weapon", { affixes: [ks("ks_glassCannon")] });
    equipment.ring = makeItem("ring", {
      affixes: [{ key: "maxLife", kind: "prefix", tier: 5, value: 20 }],
    });
    const stats = computeStats(equipment);
    expect(stats.meleeDamageMul).toBeCloseTo(2);
    expect(stats.rangedDamageMul).toBeCloseTo(2);
    expect(stats.maxHp).toBe(30);
  });

  it("キーストーンの倍率はソフトキャップの対象外（pacifist の射撃倍率 3.0 が残る）", () => {
    const equipment = createEmptyEquipment();
    equipment.gun = makeItem("gun", { affixes: [ks("ks_pacifist")] });
    expect(computeStats(equipment).rangedDamageMul).toBeCloseTo(3);
  });

  it("通常アフィックスだけがソフトキャップされ、キーストーンはその後に足される", () => {
    const equipment = createEmptyEquipment();
    equipment.gun = makeItem("gun", {
      affixes: [
        { key: "rangedDamagePct", kind: "prefix", tier: 1, value: 200 },
        ks("ks_pacifist"),
      ],
    });
    // 1 + 2.0 = 3.0 → softCap → +2.0（キーストーン）
    expect(computeStats(equipment).rangedDamageMul).toBeCloseTo(softCap(3) + 2);
  });

  it("同じキーストーンを 2 つ装備しても 1 回しか効かない", () => {
    const equipment = createEmptyEquipment();
    equipment.ring = makeItem("ring", { affixes: [ks("ks_overclock")] });
    equipment.amulet = makeItem("amulet", { affixes: [ks("ks_overclock")] });
    const stats = computeStats(equipment);
    expect(stats.keystones).toEqual(["ks_overclock"]);
    expect(stats.fireRateMul).toBeCloseTo(1.6);
  });

  it("トリガーアフィックスは stats.triggers に積まれる", () => {
    const equipment = createEmptyEquipment();
    equipment.ring = makeItem("ring", {
      affixes: [{ key: "tr:onDash:always:heal", kind: "suffix", tier: 1, value: 6, value2: 250 }],
    });
    const stats = computeStats(equipment);
    expect(stats.triggers).toEqual([
      { trigger: "onDash", condition: "always", effect: "heal", magnitude: 6, chance: 0.25 },
    ]);
  });
});

describe("statsSummary", () => {
  it("DEFAULT では空", () => {
    expect(statsSummary({ ...DEFAULT_STATS })).toEqual([]);
  });

  it("DPS や総合スコアのような単一指標を出さない", () => {
    const rng = createRng(3);
    const equipment = createEmptyEquipment();
    for (const slot of SLOTS) {
      equipment[slot] = generateItem(rng, { itemLevel: 30, slot, rarityBoost: 5, foundDepth: 1, now: NOW });
    }
    for (const line of statsSummary(computeStats(equipment))) {
      expect(line).not.toMatch(/(DPS|score|rating|power)/i);
    }
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
      "最大HP 140",
      "近接ダメージ +25%",
      "会心率 12%",
      "コンボ猶予 +0.5秒",
    ]);
  });
});

describe("computeStats: マナの性質と渇きの誓約", () => {
  it("渇きの誓約はマナ自然回復の性質があっても自然回復を 0 にする（装備順に依らない）", () => {
    const equipment = createEmptyEquipment();
    equipment.ring = makeItem("ring", { affixes: [{ key: "ks_thirst", value: 0, color: "umbra" }] });
    equipment.amulet = makeItem("amulet", { affixes: [{ key: "manaRegenFlat", value: 1.5 }] });
    const stats = computeStats(equipment);
    expect(stats.keystones).toContain("ks_thirst");
    expect(stats.manaRegen).toBe(0);
  });

  it("撃破でマナの性質は manaOnKill に積み、表示にも出る", () => {
    const equipment = createEmptyEquipment();
    equipment.boots = makeItem("boots", { affixes: [{ key: "manaOnKillFlat", value: 4 }] });
    const stats = computeStats(equipment);
    expect(stats.manaOnKill).toBe(4);
    expect(statsSummary(stats)).toContain("撃破時マナ回収 4");
  });

  it("最大マナ −の性質を重ねても最大マナは 0 未満にならない", () => {
    const equipment = createEmptyEquipment();
    const drought = { key: "manaDrought", value: 10, value2: 100 };
    equipment.ring = makeItem("ring", { affixes: [drought] });
    equipment.amulet = makeItem("amulet", { affixes: [drought] });
    expect(computeStats(equipment).maxMana).toBe(0);
  });
});

describe("computeStats: 武器種と射撃の型（ベースから決まる）", () => {
  it("空装備は剣と単発", () => {
    const stats = computeStats(createEmptyEquipment());
    expect(stats.moveset, "武器なしは剣").toBe("sword");
    expect(stats.shot, "銃なしは単発").toBe("single");
  });

  it("武器ベースが武器種を、銃ベースが射撃の型を決める", () => {
    const equipment = createEmptyEquipment();
    equipment.weapon = makeItem("weapon", { baseKey: "spear" });
    equipment.gun = makeItem("gun", { baseKey: "shotgun" });
    const stats = computeStats(equipment);
    expect(stats.moveset, "槍 → 槍").toBe("spear");
    expect(stats.shot, "散弾銃 → 散弾").toBe("spread");
  });

  it("新しい器のベース（手甲・跳ね銃）も型を持つ", () => {
    const equipment = createEmptyEquipment();
    equipment.weapon = makeItem("weapon", { baseKey: "gauntlets" });
    equipment.gun = makeItem("gun", { baseKey: "ricochetGun" });
    const stats = computeStats(equipment);
    expect(stats.moveset).toBe("fists");
    expect(stats.shot).toBe("ricochet");
  });

  it("型を持たない未知のベースは既定に落ちる", () => {
    const equipment = createEmptyEquipment();
    equipment.weapon = makeItem("weapon", { baseKey: "test" });
    equipment.gun = makeItem("gun", { baseKey: "test" });
    const stats = computeStats(equipment);
    expect(stats.moveset).toBe("sword");
    expect(stats.shot).toBe("single");
  });
});
