import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { STATUS, WEAPON } from "../data/tuning";
import { DEFAULT_MOVESET, MOVESETS, UNARMED_NAME, movesetLabel } from "../data/weapons";
import { generateItem } from "./generator";
import { UNARMED_MORE, computeStats, damageModDiffs, formatMore, softCap, statsSummary } from "./stats";
import { createIncreased } from "../core/damage";
import { DEFAULT_STATS, LOOT_SLOTS, createEmptyEquipment, type Item, type Slot } from "./types";

const NOW = 1_700_000_000_000;
/** 右手が空の computeStats の結果（DEFAULT_STATS から型・素手・素手の倍だけが素手のものになる） */
const UNARMED_STATS = { ...DEFAULT_STATS, moveset: DEFAULT_MOVESET, unarmed: true, more: [UNARMED_MORE] };

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
  it("空装備で DEFAULT_STATS と一致（右手が空なので型・素手・素手の倍だけ素手のもの）", () => {
    expect(computeStats(createEmptyEquipment())).toEqual(UNARMED_STATS);
  });

  it("DEFAULT_STATS の配列を共有しない", () => {
    const stats = computeStats(createEmptyEquipment());
    expect(stats.keystones).not.toBe(DEFAULT_STATS.keystones);
    expect(stats.triggers).not.toBe(DEFAULT_STATS.triggers);
    expect(stats.increased, "増の表も共有しない").not.toBe(DEFAULT_STATS.increased);
    expect(stats.more).not.toBe(DEFAULT_STATS.more);
  });

  it("implicit と affix を反映する", () => {
    const equipment = createEmptyEquipment();
    equipment.mainHand = makeItem("mainHand", {
      implicit: { key: "implicit.greatsword", kind: "prefix", tier: 1, value: 40 },
      affixes: [
        { key: "damageVsStaggered", kind: "prefix", tier: 3, value: 25 },
        { key: "burn", kind: "prefix", tier: 4, value: 5, value2: 3 },
      ],
    });
    // 性質 2 つまでなら共鳴しないので、implicit と性質の数値だけを見られる
    const stats = computeStats(equipment);
    expect(stats.increased.melee).toBeCloseTo(0.4);
    expect(stats.attackSpeedMul).toBeCloseTo(0.75);
    expect(stats.meleeReachMul).toBeCloseTo(1.2);
    expect(stats.increased.vsStaggered).toBeCloseTo(0.25);
    expect(stats.burnChance).toBeCloseTo(0.05);
    expect(stats.burnDps).toBe(3);
  });

  it("整数化とクランプが効く", () => {
    const equipment = createEmptyEquipment();
    equipment.ring = makeItem("ring", {
      affixes: [
        { key: "burn", kind: "prefix", tier: 1, value: 500, value2: 1 },
        { key: "groundMend", kind: "prefix", tier: 1, value: 1, value2: 1000 },
      ],
    });
    equipment.mainHand = makeItem("mainHand", {
      implicit: { key: "implicit.shotgun", kind: "prefix", tier: 1, value: 2 },
    });
    const stats = computeStats(equipment);
    expect(stats.burnChance).toBe(1);
    expect(stats.maxHp).toBe(1);
    expect(Number.isInteger(stats.projectileCount)).toBe(true);
    expect(stats.projectileCount).toBe(3);
    expect(Number.isInteger(stats.dashCharges)).toBe(true);
  });

  it("chillSlow の上限は STATUS.maxSlow に統一されている（statusEffects.ts の chillFactor と同じ値）", () => {
    const equipment = createEmptyEquipment();
    const chillAffix = { key: "chill", kind: "prefix" as const, tier: 1, value: 20, value2: 30 };
    // mainHand / armor / ring に chill を積んで 90% 分（旧上限 0.9 を超えて検出できる値）にする
    equipment.mainHand = makeItem("mainHand", { affixes: [chillAffix] });
    equipment.armor = makeItem("armor", { affixes: [chillAffix] });
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
    expect(computeStats(equipment)).toEqual(UNARMED_STATS);
  });

  it("ランダム装備を全スロットに付けても値が健全", () => {
    const rng = createRng(123);
    for (let run = 0; run < 100; run++) {
      const equipment = createEmptyEquipment();
      for (const slot of LOOT_SLOTS) {
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

  it("+300% は 4.0 倍になる（増は圧縮しない。computeStats 経由）", () => {
    const equipment = createEmptyEquipment();
    const staggered = (slot: Slot, value: number): Item =>
      makeItem(slot, { affixes: [{ key: "damageVsStaggered", kind: "prefix", tier: 1, value }] });
    equipment.mainHand = staggered("mainHand", 100);
    equipment.ring = staggered("ring", 100);
    equipment.amulet = staggered("amulet", 100);
    const stats = computeStats(equipment);
    expect(1 + stats.increased.vsStaggered).toBeCloseTo(4);
  });
});

describe("キーストーンとトリガーの集計", () => {
  const ks = (key: string) => ({ key, kind: "suffix" as const, tier: 1, value: 0 });

  it("同じ排他グループは後勝ち（装備順）で 1 つだけ残る", () => {
    const equipment = createEmptyEquipment();
    equipment.mainHand = makeItem("mainHand", { affixes: [ks("ks_glassCannon")] });
    equipment.ring = makeItem("ring", { affixes: [ks("ks_vampire"), ks("ks_gambler")] });
    const stats = computeStats(equipment);
    expect(stats.keystones).toEqual(["ks_vampire", "ks_gambler"]);
    expect(stats.critChance).toBeCloseTo(DEFAULT_STATS.critChance + 0.1);
    // 負けた glassCannon の数値効果（最大 HP 1/4）は掛からず、勝った吸血の 0.7 だけ
    expect(stats.maxHp).toBe(Math.round(DEFAULT_STATS.maxHp * 0.7));
    expect(stats.more.some((m) => m.source === "keystone:ks_glassCannon"), "負けた誓約の倍は入らない").toBe(false);
  });

  it("glassCannon は与ダメ 2 倍・最大 HP 1/4（flat 合算後に掛かる）", () => {
    const equipment = createEmptyEquipment();
    equipment.mainHand = makeItem("mainHand", { affixes: [ks("ks_glassCannon")] });
    const stats = computeStats(equipment);
    const glass = stats.more.find((m) => m.source === "keystone:ks_glassCannon");
    expect(glass?.mul, "誓約は倍").toBeCloseTo(2);
    expect(glass?.tags, "近接と射撃に掛かる").toEqual(["melee", "ranged"]);
    expect(stats.increased.melee, "増には入らない").toBe(0);
    expect(stats.maxHp).toBe(Math.round(DEFAULT_STATS.maxHp * 0.25));
  });

  it("誓約は more に入り増と掛け算になる", () => {
    const equipment = createEmptyEquipment();
    equipment.mainHand = makeItem("mainHand", {
      affixes: [
        { key: "damageVsStaggered", kind: "prefix", tier: 1, value: 200 },
        ks("ks_glassCannon"),
      ],
    });
    // 増 +200% → ×3.0、誓約の倍 ×2 → 6 倍
    const stats = computeStats(equipment);
    const glass = stats.more.find((m) => m.source === "keystone:ks_glassCannon")?.mul ?? 1;
    expect((1 + stats.increased.vsStaggered) * glass).toBeCloseTo(6);
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
    for (const slot of LOOT_SLOTS) {
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
      increased: { ...createIncreased(), melee: 0.25 },
      more: [{ source: "keystone:ks_glassCannon", label: "硝子の砲", mul: 2, tags: ["melee", "ranged"] }],
      critChance: 0.12,
      comboWindowBonus: 0.5,
    });
    expect(summary).toEqual([
      "最大生命 140",
      "会心率 12%",
      "コンボ猶予 +0.5秒",
      "近接ダメージ 増 +25%",
      "硝子の砲 倍 ×2",
    ]);
  });
});

describe("damageModDiffs（装備の比較の増・倍の差）", () => {
  it("増はタグごと、倍は出所ごとに差を出し、消えたものは「→ なし」", () => {
    const before = { ...DEFAULT_STATS, increased: { ...createIncreased(), melee: 0.2 }, more: [UNARMED_MORE] };
    const after = { ...DEFAULT_STATS, increased: { ...createIncreased(), melee: 0.5, ranged: 0.1 } };
    const diffs = damageModDiffs(before, after);
    expect(diffs.map((d) => d.rises)).toEqual([true, true, true]);
    expect(diffs.map((d) => d.text)).toEqual(["近接ダメージ 増 +50%", "射撃ダメージ 増 +10%", `${formatMore(UNARMED_MORE)} → なし`]);
    expect(damageModDiffs(after, after), "同じなら差なし").toEqual([]);
  });
});

describe("computeStats: 気力の性質の代償", () => {
  it("汲み上げの代償は撃破時の気力回収を下げる", () => {
    const equipment = createEmptyEquipment();
    equipment.mainHand = makeItem("mainHand", { affixes: [{ key: "manaOnStagger", value: 4, value2: 2 }] });
    const stats = computeStats(equipment);
    expect(stats.traits.manaOnStagger).toBe(4);
    expect(stats.manaOnKill).toBe(-2);
  });

  it("溢れの代償（最大気力 −）を重ねても最大気力は 0 未満にならない", () => {
    const equipment = createEmptyEquipment();
    const overflow = { key: "manaOverflow", value: 50, value2: 100 };
    equipment.ring = makeItem("ring", { affixes: [overflow] });
    equipment.amulet = makeItem("amulet", { affixes: [overflow] });
    expect(computeStats(equipment).maxMana).toBe(0);
  });
});

describe("computeStats: 武器種と弾（ベースから決まる）", () => {
  it("右手が空なら拳の型で unarmed、威力は ×0.7、表示名は素手", () => {
    const stats = computeStats(createEmptyEquipment());
    expect(stats.moveset, "武器なしは拳の型").toBe("fists");
    expect(stats.unarmed, "武器なしは素手").toBe(true);
    expect(stats.more.find((m) => m.source === "unarmed")?.mul, "素手の威力の倍").toBeCloseTo(WEAPON.unarmed.damageMul);
    expect(WEAPON.unarmed.damageMul, "weapons.WEAPON.unarmed.damageMul は縮小率").toBeGreaterThan(0);
    expect(WEAPON.unarmed.damageMul, "weapons.WEAPON.unarmed.damageMul は縮小率").toBeLessThan(1);
    expect(movesetLabel(MOVESETS[stats.moveset], stats.unarmed), "表示名は素手").toBe(UNARMED_NAME);
    expect(stats.bullet, "銃なしは既定の弾").toBe("pistol");
  });

  it("手甲を持てば同じ拳の型でも素手ではなく、威力は削られず表示名は拳", () => {
    const equipment = createEmptyEquipment();
    equipment.mainHand = makeItem("mainHand", { baseKey: "gauntlets" });
    const stats = computeStats(equipment);
    expect(stats.moveset).toBe("fists");
    expect(stats.unarmed, "手甲は素手ではない").toBe(false);
    expect(stats.more, "威力は等倍（倍なし）").toEqual([]);
    expect(movesetLabel(MOVESETS[stats.moveset], stats.unarmed)).toBe(MOVESETS.fists.name);
  });

  it("近接ベースは武器種だけを決め、弾は既定のまま", () => {
    const equipment = createEmptyEquipment();
    equipment.mainHand = makeItem("mainHand", { baseKey: "spear" });
    const stats = computeStats(equipment);
    expect(stats.moveset, "槍 → 槍").toBe("spear");
    expect(stats.bullet, "近接ベースは弾を持たない").toBe("pistol");
  });

  it("銃ベースは武器種（家系）と自分の弾の両方を決める", () => {
    const equipment = createEmptyEquipment();
    equipment.mainHand = makeItem("mainHand", { baseKey: "shotgun" });
    const stats = computeStats(equipment);
    expect(stats.moveset, "散弾銃 → 砲の家系").toBe("cannon");
    expect(stats.bullet, "散弾銃 → 散弾銃の弾").toBe("shotgun");
  });

  it("新しい器のベース（手甲・クナイ・手裏剣）も型を持つ", () => {
    const equipment = createEmptyEquipment();
    equipment.mainHand = makeItem("mainHand", { baseKey: "gauntlets" });
    expect(computeStats(equipment).moveset).toBe("fists");
    equipment.mainHand = makeItem("mainHand", { baseKey: "kunai" });
    const stats = computeStats(equipment);
    expect(stats.moveset).toBe("kunai");
    expect(stats.bullet, "クナイは左で投げる弾を持つ").toBe("kunai");
    equipment.mainHand = makeItem("mainHand", { baseKey: "shuriken" });
    expect(computeStats(equipment).moveset).toBe("shuriken");
  });

  it("型を持たない未知のベースは既定に落ちる", () => {
    const equipment = createEmptyEquipment();
    equipment.mainHand = makeItem("mainHand", { baseKey: "test" });
    const stats = computeStats(equipment);
    expect(stats.moveset).toBe(DEFAULT_MOVESET);
    expect(stats.unarmed, "右手に物があれば素手の倍率は掛けない").toBe(false);
    expect(stats.bullet).toBe("pistol");
  });
});
