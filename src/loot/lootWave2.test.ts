import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { KEYSTONE, RESONANCE } from "../data/tuning";
import { MOVESET_KEYS } from "../data/weapons";
import {
  CONVERSION_AFFIXES,
  KEYSTONES,
  affixDef,
  applyRoll,
  formatAffix,
  implicitDef,
  keystoneDef,
  keystoneToRoll,
  resolveKeystones,
  traitsFor,
} from "./affixes";
import { BASES, baseDef } from "./bases";
import { BASE_LEAN, traitColorOf } from "./colors";
import {
  BLEACH_COST,
  BLEACH_VALUE_FACTOR,
  RECALL_COST,
  REFORGE_MARGIN_COST,
  TENSION_COST,
  TENSION_FACTOR,
  bleachTrait,
  calmTrait,
  craftEcho,
  createEchoWallet,
  echoCost,
  pourGrowth,
  pouredProvenance,
  recallBud,
  reforgeTrait,
  tensionTrait,
  type EchoCraftState,
} from "./crafting";
import { describeTrait } from "./describe";
import { rollUniqueAffixes } from "./generator";
import { fillProvenanceCounters } from "./migrate";
import { UNIQUES, uniqueDef } from "./named";
import { loadProfile, saveProfile } from "./profile";
import { MILESTONES, bumpProvenance, makeBudOffer, milestoneDef } from "./provenance";
import {
  CONSTELLATIONS,
  NEGATIVE_EFFECTS,
  cancelInversions,
  colorWeights,
  describeResonance,
  itemMainColor,
  negativeInput,
  resolveConstellation,
  resolveResonance,
  resonanceRules,
  type MainColors,
} from "./resonance";
import { computeStats, equipmentResonance } from "./stats";
import {
  CONSTELLATION_KEYS,
  DEFAULT_STATS,
  createEmptyEquipment,
  createEmptyProfile,
  createEmptyProvenance,
  type AffixRoll,
  type Item,
  type PlayerStats,
  type Slot,
  type TraitColor,
  type TraitStats,
} from "./types";

/**
 * 装備の第 2 弾（属性・武器種・銃の弾・地形・新しい状態異常・ジョブ・交戦中）のテスト。
 * 性質・誓約・変換・名のある遺物・ベース・共鳴の拡張（陰画・拮抗・星座）・残響の新操作・来歴の節目と目覚め
 */

const NEW_TRAITS = [
  "weakRead",
  "prismEdge",
  "resistBreaker",
  "backlash",
  "conductor",
  "igniter",
  "elementalBreak",
  "elementalWard",
  "chargeCore",
  "chargeQuake",
  "branchArt",
  "spreadCore",
  "spreadShove",
  "homingVenom",
  "rapidBrand",
  "brandDetonator",
  "schoolForm",
  "selfTaught",
  "wanderer",
  "schoolHarvest",
  "groundRooted",
  "slickFooting",
  "mireGuard",
  "terrainHunter",
  "terrainBurst",
  "emberTrail",
  "frostTrail",
  "groundMend",
  "brokenHunter",
  "corrodeClaw",
  "doomToll",
  "siegeGuard",
  "siegeSpark",
  "switchHitter",
  "switchBreath",
] as const;

const NEW_AWAKENINGS = [
  "weakInsight",
  "sevenHues",
  "counterGrain",
  "groundWisdom",
  "mireLord",
  "schoolMastery",
  "schoolSecret",
  "fullCharge",
  "formBreaker",
  "hueBreak",
  "brokenBreaker",
  "battleRhythm",
  "stormConduit",
  "siegeHeart",
  "emberWalk",
  "frostWalk",
] as const;

const NEW_CONVERSIONS = [
  "cv_armorToWarding",
  "cv_wardingToArmor",
  "cv_resistToDamage",
  "cv_resistToWarding",
  "cv_burnToFire",
  "cv_chillToIce",
  "cv_shockToLightning",
  "cv_critToLight",
] as const;

const NEW_KEYSTONES = [
  "ks_oneElement",
  "ks_weakOath",
  "ks_nullOath",
  "ks_ironOath",
  "ks_chargeOath",
  "ks_stanceOath",
  "ks_earthOath",
  "ks_slickOath",
  "ks_emberOath",
] as const;

const NEW_BASES = [
  "katana",
  "zanbato",
  "twinDaggers",
  "halberd",
  "sickle",
  "cestus",
  "chainWhip",
  "shakujo",
  "crystalWand",
  "blunderbuss",
  "crossbow",
  "chakram",
  "handCannon",
  "caltrops",
  "seekerOrb",
  "mino",
] as const;

const NEW_UNIQUES = [
  "emberHeart",
  "glacierStep",
  "thunderLash",
  "bogMother",
  "duskSickle",
  "dawnCrystal",
  "oneHueBand",
  "plainVeil",
  "backlashCharm",
  "moonCleaver",
  "mastersKatana",
  "strayFists",
  "matedFangs",
  "gateHalberd",
  "abbotsStaff",
  "rustbreaker",
  "thunderTrumpet",
  "brandingKnives",
  "demonCaltrops",
  "circlingMoon",
  "earthMino",
  "rootedGeta",
  "driftersCharm",
  "lampOil",
] as const;

const PERCENT = 0.01;

function stats(): PlayerStats {
  return {
    ...DEFAULT_STATS,
    keystones: [],
    triggers: [],
    statusProcs: [],
    attributes: { ...DEFAULT_STATS.attributes },
    traits: { ...DEFAULT_STATS.traits },
    resist: { ...DEFAULT_STATS.resist },
    infuse: { ...DEFAULT_STATS.infuse },
  };
}

function roll(key: string, value: number, value2?: number, color?: TraitColor): AffixRoll {
  const out: AffixRoll = { key, value, nominal: value, flux: 0, origin: "found" };
  if (value2 !== undefined) {
    out.value2 = value2;
    out.nominal2 = value2;
  }
  if (color !== undefined) out.color = color;
  return out;
}

function item(slot: Slot, affixes: AffixRoll[], overrides: Partial<Item> = {}): Item {
  return {
    id: `it-${slot}-${affixes.map((a) => a.key).join("-")}`,
    seed: 7,
    baseKey: BASES.find((b) => b.slot === slot)?.key ?? "ironRing",
    slot,
    rarity: "magic",
    itemLevel: 5,
    name: "テスト",
    implicit: null,
    affixes,
    foundDepth: 5,
    foundAt: 0,
    provenance: createEmptyProvenance(),
    margin: 2,
    marginMax: 3,
    milestones: [],
    buds: [],
    budOffer: null,
    ...overrides,
  };
}

/** TraitStats の中で既定から動いたフィールド */
function movedTraits(s: PlayerStats): (keyof TraitStats)[] {
  return (Object.keys(DEFAULT_STATS.traits) as (keyof TraitStats)[]).filter((k) => s.traits[k] !== DEFAULT_STATS.traits[k]);
}

function keystoneRoll(key: string): AffixRoll {
  const def = keystoneDef(key);
  if (def === undefined) throw new Error(`誓約 ${key} が無い`);
  return keystoneToRoll(def);
}

// ---------------------------------------------------------------------------
// 性質・目覚め
// ---------------------------------------------------------------------------

describe("第 2 弾の性質（30 種以上）", () => {
  it(`${NEW_TRAITS.length} 種が定義され、通常の抽選に出る`, () => {
    expect(NEW_TRAITS.length).toBeGreaterThanOrEqual(30);
    for (const key of NEW_TRAITS) {
      const def = affixDef(key);
      expect(def, key).toBeDefined();
      expect(def?.awakening, key).toBeUndefined();
      const slot = def?.slots[0];
      if (slot === undefined) throw new Error(key);
      expect(traitsFor(slot, 30).some((d) => d.key === key), `${key} は抽選に出る`).toBe(true);
    }
  });

  it("代償付き（tradeoff）は利得と代償の両方を表示し、{v} が残らない", () => {
    for (const key of NEW_TRAITS) {
      const def = affixDef(key);
      if (def === undefined) throw new Error(key);
      const text = formatAffix(roll(key, 10, 5));
      expect(text, key).not.toContain("{v");
      if (def.tags.includes("tradeoff")) expect(def.label, key).toContain("{v2}");
    }
  });

  it("どの性質も apply で何かの数値を動かす（ルール変更は TraitStats、数値は PlayerStats）", () => {
    for (const key of [...NEW_TRAITS, ...NEW_AWAKENINGS]) {
      const s = stats();
      const before = JSON.stringify(s);
      applyRoll(s, roll(key, 10, 5));
      expect(JSON.stringify(s), `${key} が stats を動かす`).not.toBe(before);
    }
  });

  it("属性の性質はルール変更のフィールドを動かす", () => {
    const s = stats();
    applyRoll(s, roll("prismEdge", 40, 10));
    applyRoll(s, roll("resistBreaker", 150, 10));
    applyRoll(s, roll("backlash", 3));
    expect(s.traits.weakDamageMul).toBeCloseTo(0.4 - 0.1);
    expect(s.traits.nonWeakPenalty).toBeCloseTo(0.1);
    expect(s.traits.resistPierce, "耐性破りは 100% で頭打ち").toBeCloseTo(1);
    expect(s.traits.resistedInflict).toBe(3);
  });

  it("地形・武器・ジョブの性質は代償も積む", () => {
    const s = stats();
    applyRoll(s, roll("groundRooted", 30, 8));
    applyRoll(s, roll("chargeCore", 20, 10));
    applyRoll(s, roll("schoolForm", 20, 12));
    applyRoll(s, roll("emberTrail", 5, 12));
    expect(movedTraits(s)).toEqual(
      expect.arrayContaining(["terrainDamageMul", "offTerrainPenalty", "chargedMeleeMul", "unchargedPenalty", "favoredDamageMul", "unfavoredPenalty", "burningKillFire"]),
    );
    expect(s.resist.fire, "残り火の代償は炎耐性").toBe(-12);
  });

  it("連射の烙印の確率は 100% で頭打ち", () => {
    const s = stats();
    applyRoll(s, roll("rapidBrand", 80, 10));
    applyRoll(s, roll("rapidBrand", 80, 10));
    expect(s.traits.rapidBrandChance).toBe(1);
    expect(s.rangedDamageMul).toBeCloseTo(1 - 0.2);
  });
});

describe("第 2 弾の目覚め（15 種以上）", () => {
  it("芽専用で、通常の抽選には出ない。どれも節目が名指ししている", () => {
    expect(NEW_AWAKENINGS.length).toBeGreaterThanOrEqual(15);
    const named = new Set(MILESTONES.map((m) => m.awakening).filter((k): k is string => k !== undefined));
    for (const key of NEW_AWAKENINGS) {
      expect(affixDef(key)?.awakening, key).toBe(true);
      expect(traitsFor("mainHand", 40).some((d) => d.key === key), `${key} は抽選に出ない`).toBe(false);
      expect(named.has(key), `${key} を名指しする節目がある`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 変換
// ---------------------------------------------------------------------------

describe("第 2 弾の変換（6 種以上）", () => {
  it("すべて cv_ で convert 段階、変換の一覧に入る", () => {
    expect(NEW_CONVERSIONS.length).toBeGreaterThanOrEqual(6);
    for (const key of NEW_CONVERSIONS) {
      const def = CONVERSION_AFFIXES.find((d) => d.key === key);
      expect(def, key).toBeDefined();
      expect(def?.stage, key).toBe("convert");
      expect(def?.label, key).toMatch(/変換/);
    }
  });

  it("防御 ⇄ 魔防を移す", () => {
    const s = stats();
    s.armor = 20;
    applyRoll(s, roll("cv_armorToWarding", 50));
    expect(s.armor).toBeCloseTo(10);
    expect(s.warding).toBeCloseTo(10);
    applyRoll(s, roll("cv_wardingToArmor", 50));
    expect(s.warding).toBeCloseTo(5);
    expect(s.armor).toBeCloseTo(15);
  });

  it("耐性を捨てて与ダメージ / 魔防にする（負の耐性は捨てない）", () => {
    const s = stats();
    s.resist.fire = 60;
    s.resist.ice = -20;
    applyRoll(s, roll("cv_resistToDamage", 50));
    expect(s.resist.fire).toBeCloseTo(30);
    expect(s.resist.ice, "弱点はそのまま").toBe(-20);
    // 捨てた 30 を 6 属性で割った平均 5% × 0.5%
    expect(s.meleeDamageMul).toBeCloseTo(1 + 5 * 0.005);
    const t = stats();
    t.resist.light = 60;
    applyRoll(t, roll("cv_resistToWarding", 100));
    expect(t.resist.light).toBeCloseTo(0);
    expect(t.warding).toBeCloseTo(10);
  });

  it("状態異常の確率・会心率を属性の変換へ移す", () => {
    const s = stats();
    s.burnChance = 0.2;
    s.chillChance = 0.1;
    s.shockChance = 0.1;
    s.critChance = 0.1;
    applyRoll(s, roll("cv_burnToFire", 50));
    applyRoll(s, roll("cv_chillToIce", 100));
    applyRoll(s, roll("cv_shockToLightning", 100));
    applyRoll(s, roll("cv_critToLight", 100));
    expect(s.burnChance).toBeCloseTo(0.1);
    expect(s.infuse.fire).toBeCloseTo(0.2);
    expect(s.chillChance).toBeCloseTo(0);
    expect(s.infuse.ice).toBeCloseTo(0.2);
    expect(s.infuse.lightning).toBeCloseTo(0.2);
    expect(s.critChance).toBeCloseTo(0);
    expect(s.infuse.light).toBeCloseTo(0.3);
  });
});

// ---------------------------------------------------------------------------
// 誓約
// ---------------------------------------------------------------------------

describe("第 2 弾の誓約（8 種以上）", () => {
  it("属性 / 武器 / 地形の 3 グループに 3 つずつ", () => {
    expect(NEW_KEYSTONES.length).toBeGreaterThanOrEqual(8);
    for (const group of ["element", "weapon", "terrain"] as const) {
      expect(KEYSTONES.filter((k) => k.exclusiveGroup === group).length, group).toBe(3);
    }
  });

  it("同じグループは後勝ち", () => {
    expect(resolveKeystones(["ks_oneElement", "ks_weakOath", "ks_ironOath"])).toEqual(["ks_weakOath", "ks_ironOath"]);
    expect(resolveKeystones(["ks_earthOath", "ks_slickOath", "ks_emberOath"])).toEqual(["ks_emberOath"]);
  });

  it("一色の誓い: 最も強い属性の変換を 100% にし、全属性耐性が下がる", () => {
    const eq = createEmptyEquipment();
    eq.mainHand = item("mainHand", [roll("cv_infuseFire", 40), roll("cv_infuseIce", 20)]);
    eq.ring = item("ring", [keystoneRoll("ks_oneElement")]);
    const s = computeStats(eq);
    expect(s.infuse.fire).toBeCloseTo(1);
    expect(s.infuse.ice).toBeCloseTo(0);
    expect(s.resist.poison).toBe(-KEYSTONE.oneElementResistLoss);
    expect(s.keystones).toContain("ks_oneElement");
  });

  it("無の誓い: 変換を捨て、状態異常の効果量が下がる", () => {
    const eq = createEmptyEquipment();
    eq.mainHand = item("mainHand", [roll("cv_infuseFire", 40)]);
    eq.ring = item("ring", [keystoneRoll("ks_nullOath")]);
    const s = computeStats(eq);
    expect(s.infuse.fire).toBe(0);
    expect(s.statusPotencyMul).toBeCloseTo(KEYSTONE.nullOathPotencyMul);
  });

  it("土の誓い: 自然回復が 0 / 熾火の誓い: 炎耐性が下がる", () => {
    const eq = createEmptyEquipment();
    eq.armor = item("armor", [roll("hpRegen", 2), keystoneRoll("ks_earthOath")]);
    expect(computeStats(eq).hpRegen).toBe(0);
    const eq2 = createEmptyEquipment();
    eq2.armor = item("armor", [keystoneRoll("ks_emberOath")]);
    expect(computeStats(eq2).resist.fire).toBe(-KEYSTONE.emberFireResistLoss);
  });
});

// ---------------------------------------------------------------------------
// ベース・名のある遺物
// ---------------------------------------------------------------------------

describe("第 2 弾のベース（10 種以上）", () => {
  it("implicit が実在し、色の傾きを持ち、武器種・銃の弾ごとに 2 つ以上の器がある", () => {
    expect(NEW_BASES.length).toBeGreaterThanOrEqual(10);
    for (const key of NEW_BASES) {
      const base = baseDef(key);
      expect(base, key).toBeDefined();
      expect(BASE_LEAN[key], key).toBeDefined();
      if (base?.implicitKey !== undefined) expect(implicitDef(base.implicitKey), key).toBeDefined();
    }
    for (const m of MOVESET_KEYS) expect(BASES.filter((b) => b.moveset === m).length, m).toBeGreaterThanOrEqual(2);
  });

  it("implicit が個性を持つ（斬馬刀は溜め、小鎌は闇の変換、喇叭銃は散弾の間合い）", () => {
    const eq = createEmptyEquipment();
    eq.mainHand = item("mainHand", [], { baseKey: "zanbato", implicit: { key: "implicit.zanbato", value: 10 } });
    const s = computeStats(eq);
    expect(s.moveset).toBe("greatsword");
    expect(s.traits.chargedMeleeMul).toBeCloseTo(0.1);
    const eqGun = createEmptyEquipment();
    eqGun.mainHand = item("mainHand", [], { baseKey: "blunderbuss", implicit: { key: "implicit.blunderbuss", value: 20 } });
    const sGun = computeStats(eqGun);
    expect(sGun.bullet).toBe("blunderbuss");
    expect(sGun.traits.spreadCloseMul).toBeCloseTo(0.2);
    const eq2 = createEmptyEquipment();
    eq2.mainHand = item("mainHand", [], { baseKey: "sickle", implicit: { key: "implicit.sickle", value: 25 } });
    expect(computeStats(eq2).infuse.dark).toBeCloseTo(0.25);
  });
});

describe("第 2 弾の名のある遺物（20 種以上）", () => {
  it("全て生成でき、ベースが実在し、銘の一文を持つ", () => {
    expect(NEW_UNIQUES.length).toBeGreaterThanOrEqual(20);
    for (const key of NEW_UNIQUES) {
      const def = uniqueDef(key);
      if (def === undefined) throw new Error(`遺物 ${key} が無い`);
      expect(baseDef(def.baseKey), key).toBeDefined();
      expect(def.flavor?.length ?? 0, key).toBeGreaterThan(0);
      const rolls = rollUniqueAffixes(createRng(3), def, def.minLevel);
      expect(rolls.length, key).toBe(def.affixes.length + (def.keystone === undefined ? 0 : 1));
      if (def.keystone !== undefined) expect(rolls.some((r) => r.key === def.keystone), key).toBe(true);
    }
  });

  it("key は重複しない", () => {
    const keys = UNIQUES.map((u) => u.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ---------------------------------------------------------------------------
// 共鳴の拡張: 陰画・拮抗
// ---------------------------------------------------------------------------

function inverted(key: string, value: number): AffixRoll {
  return { key, value: -value, nominal: value, flux: -1.5, inverted: true, color: "umbra", origin: "found" };
}

describe("陰画（支配が裏返る）", () => {
  const upright = [roll("meleeDamagePct", 20), roll("meleeDamageFlat", 5), roll("attackSpeed", 5), roll("maxLife", 10)];

  it(`反転の重みが ${RESONANCE.negativeInvertedRatio * 100}% 以上で、反転を除いた支配色の陰画になる`, () => {
    // 表: 紅 5・翠 1（紅 83%）。反転 2 つは重み 2 ずつ = 4 / 10 = 40%（冥は支配に届かない）
    const more = [roll("critMultiplier", 10, undefined, "crimson"), roll("knockback", 10)];
    const rolls = [...upright, ...more, inverted("moveSpeed", 5), inverted("rangedDamagePct", 5)];
    const r = resolveResonance(colorWeights(rolls), resonanceRules([]), negativeInput(rolls));
    expect(r.kind).toBe("dominant");
    expect(r.form).toBe("negative");
    expect(r.colors).toEqual(["crimson"]);
  });

  it("反転が少なければ陰画にならない（ふつうの支配）", () => {
    const rolls = [...upright, roll("meleeDamagePct", 5), inverted("moveSpeed", 1)];
    const input = negativeInput(rolls);
    expect(input.invertedWeight / (input.invertedWeight + 5)).toBeLessThan(RESONANCE.negativeInvertedRatio);
    const r = resolveResonance(colorWeights(rolls), resonanceRules([]), input);
    expect(r.form).toBeUndefined();
  });

  it("冥が支配していれば虚極のまま（陰画にしない）", () => {
    const rolls = [roll("meleeDamagePct", 20), inverted("moveSpeed", 5), inverted("rangedDamagePct", 5), inverted("maxLife", 5)];
    const r = resolveResonance(colorWeights(rolls), resonanceRules([]), negativeInput(rolls));
    expect(r.kind).toBe("dominant");
    expect(r.colors).toEqual(["umbra"]);
    expect(r.form).toBeUndefined();
  });

  it("冷たい炎: 燃焼の確率が冷気へ移る / 暗雷: 会心が 0", () => {
    const s = stats();
    s.burnChance = 0.2;
    NEGATIVE_EFFECTS.crimson.apply(s);
    expect(s.burnChance).toBe(0);
    expect(s.chillChance).toBeCloseTo(0.2);
    const g = stats();
    g.critChance = 0.3;
    NEGATIVE_EFFECTS.gold.apply(g);
    expect(g.critChance).toBe(0);
    expect(g.triggers.some((t) => t.effect === "chainLightning")).toBe(true);
  });

  it("説明の 1 行目が「〜の陰画」", () => {
    const r = resolveResonance(
      { crimson: 5, azure: 0, jade: 1, gold: 0, umbra: 4 },
      resonanceRules([]),
      { invertedWeight: 4, upright: { crimson: 5, azure: 0, jade: 1, gold: 0, umbra: 0 } },
    );
    expect(describeResonance(r)[0]).toContain("陰画");
  });
});

describe("拮抗（反対色の均衡）", () => {
  const w = (p: Partial<Record<TraitColor, number>>): Record<TraitColor, number> => ({ crimson: 0, azure: 0, jade: 0, gold: 0, umbra: 0, ...p });

  it("他の共鳴が成立しないとき、反対色の組が 25% 以上で差 5% 以内なら拮抗", () => {
    const r = resolveResonance(w({ crimson: 31, azure: 27, jade: 21, umbra: 21 }));
    expect(r.kind).toBe("dual");
    expect(r.form).toBe("balance");
    expect(r.colors).toEqual(["crimson", "azure"]);
    const g = resolveResonance(w({ jade: 32, gold: 28, crimson: 20, umbra: 20 }));
    expect(g.form).toBe("balance");
    expect(g.colors).toEqual(["jade", "gold"]);
  });

  it("差が 5% を超えれば拮抗しない。散光・二重・三和音は奪わない", () => {
    expect(resolveResonance(w({ crimson: 33, azure: 26, jade: 21, umbra: 20 })).kind).toBe("none");
    expect(resolveResonance(w({ crimson: 25, azure: 25, jade: 25, gold: 25 })).kind).toBe("scatter");
    expect(resolveResonance(w({ crimson: 35, azure: 33, jade: 32 })).form).toBeUndefined();
  });

  it("天秤・表裏は TraitStats に数値を積む", () => {
    const eq = createEmptyEquipment();
    // 紅 31・蒼 27・翠 21・冥 21 を性質の重みで作る（右手は 1 つしか無いので、蒼は靴に置く）
    eq.mainHand = item("mainHand", [roll("meleeDamagePct", 31)]);
    eq.boots = item("boots", [roll("rangedDamagePct", 27)]);
    eq.armor = item("armor", [roll("maxLife", 21)]);
    eq.ring = item("ring", [roll("invertedFeast", 21, 3)]);
    // 重みは |value / nominal| で 1 ずつになるので、期待値で比を作る
    for (const it of [eq.mainHand, eq.boots, eq.armor, eq.ring]) for (const r of it.affixes) r.nominal = 1;
    for (const r of eq.mainHand.affixes) r.value = 3.1;
    for (const r of eq.boots.affixes) r.value = 2.7;
    for (const r of eq.armor.affixes) r.value = 2.1;
    for (const r of eq.ring.affixes) r.value = 2.1;
    const res = equipmentResonance(eq);
    expect(res.form).toBe("balance");
    const s = computeStats(eq);
    expect(s.traits.alternateDamageStep).toBeGreaterThan(0);
    expect(s.traits.alternateDamageCap).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 星座
// ---------------------------------------------------------------------------

function mains(p: Partial<Record<Slot, TraitColor>>): MainColors {
  return { mainHand: undefined, offHand: undefined, armor: undefined, boots: undefined, ring: undefined, amulet: undefined, ...p };
}

describe("星座（6 部位の主色の並び）", () => {
  it("7 つすべてに代償付きの効果がある", () => {
    for (const key of CONSTELLATION_KEYS) {
      const def = CONSTELLATIONS[key];
      expect(def.lines.some((l) => l.startsWith("代償")), key).toBe(true);
    }
  });

  it("主色は重みの最大、同点は先に付いた性質の色", () => {
    expect(itemMainColor([roll("maxLife", 5), roll("meleeDamagePct", 5)])).toBe("jade");
    expect(itemMainColor([roll("maxLife", 5), roll("meleeDamagePct", 5), roll("meleeDamageFlat", 5)])).toBe("crimson");
    expect(itemMainColor([{ ...roll("maxLife", 5), colorless: true }])).toBeUndefined();
  });

  it("並びごとに成立する（表の順で最初の 1 つ。左手を使う 4 種は隠していて成立しない）", () => {
    expect(resolveConstellation(mains({ mainHand: "crimson", offHand: "gold", amulet: "jade", armor: "jade", boots: "jade" }))).toBe("spine");
    expect(
      resolveConstellation(mains({ mainHand: "crimson", offHand: "gold", amulet: "jade", armor: "azure", boots: "umbra", ring: "crimson" })),
    ).toBe("ring");
    expect(resolveConstellation(mains({ mainHand: "umbra", offHand: "gold", amulet: "umbra", armor: "jade", boots: "umbra" }))).toBe("void");
    expect(resolveConstellation(mains({ mainHand: "crimson" }))).toBeUndefined();
  });

  it("左手（offHand）が絡む 4 種（双子・対岸・鏡像・鎖）は、並びが一致していても隠していて成立しない", () => {
    expect(resolveConstellation(mains({ mainHand: "crimson", offHand: "crimson" })), "双子").toBeUndefined();
    expect(resolveConstellation(mains({ mainHand: "crimson", offHand: "azure" })), "対岸").toBeUndefined();
    expect(
      resolveConstellation(mains({ mainHand: "crimson", offHand: "gold", amulet: "azure", armor: "crimson", boots: "gold", ring: "azure" })),
      "鏡像",
    ).toBeUndefined();
    expect(
      resolveConstellation(mains({ mainHand: "crimson", offHand: "gold", amulet: "crimson", armor: "gold", boots: "crimson", ring: "gold" })),
      "鎖",
    ).toBeUndefined();
    for (const key of ["twins", "shores", "mirror", "chain"] as const) {
      expect(CONSTELLATIONS[key].hidden, `${key} は hidden`).toBe(true);
    }
  });

  it("冥が隣り合えば虚空にならない", () => {
    expect(resolveConstellation(mains({ mainHand: "umbra", offHand: "umbra", amulet: "gold", armor: "umbra", boots: "gold" }))).not.toBe("void");
  });

  it("computeStats に効果と代償が乗り、説明に「星座」の行が出る", () => {
    const eq = createEmptyEquipment();
    eq.amulet = item("amulet", [roll("maxLife", 5)]);
    eq.armor = item("armor", [roll("armorFlat", 5)]);
    eq.boots = item("boots", [roll("hpRegen", 1)]);
    const s = computeStats(eq);
    expect(s.resonance.constellation).toBe("spine");
    expect(s.damageTakenMul).toBeCloseTo(1 - RESONANCE.spineGuard);
    expect(s.moveSpeedMul).toBeCloseTo(1 - RESONANCE.spineSlow);
    expect(describeResonance(s.resonance).some((l) => l.includes("星座 背骨"))).toBe(true);
  });

  it("虚空: 反転した性質の値が 0 になる", () => {
    const rolls = cancelInversions([inverted("moveSpeed", 5), roll("maxLife", 5)]);
    expect(rolls[0]?.value).toBeCloseTo(0);
    expect(rolls[1]?.value).toBe(5);
  });

  it("双子: 左手に相当する装備を合成しても、隠している間は computeStats 上でも成立しない", () => {
    const eq = createEmptyEquipment();
    eq.mainHand = item("mainHand", [roll("meleeDamagePct", 40)]);
    eq.offHand = item("offHand", [roll("rangedDamagePct", 10, undefined, "crimson")]);
    const s = computeStats(eq);
    expect(s.resonance.constellation).not.toBe("twins");
  });
});

// ---------------------------------------------------------------------------
// 残響の新操作
// ---------------------------------------------------------------------------

function craftState(amount = 20): EchoCraftState {
  const echoes = createEchoWallet();
  for (const c of Object.keys(echoes) as TraitColor[]) echoes[c] = amount;
  return { echoes, counter: 0 };
}

describe("脱色", () => {
  it("無色になり、値は 9 割、共鳴の配合に数えない。費用は翠響", () => {
    const it = item("mainHand", [roll("meleeDamagePct", 20), roll("maxLife", 10)]);
    const out = bleachTrait(it, 0);
    const bleached = out?.affixes[0];
    expect(bleached?.colorless).toBe(true);
    expect(bleached?.value).toBeCloseTo(20 * BLEACH_VALUE_FACTOR);
    expect(bleached === undefined ? "?" : traitColorOf(bleached)).toBeUndefined();
    expect(colorWeights(out?.affixes ?? []).crimson).toBe(0);
    expect(echoCost({ op: "bleach", item: it, traitIndex: 0 })).toEqual({ color: "jade", amount: BLEACH_COST });
    expect(describeTrait(bleached ?? roll("x", 0)).text.startsWith("無色")).toBe(true);
  });

  it("反転・誓約・脱色済みは脱色できない", () => {
    expect(bleachTrait(item("boots", [inverted("moveSpeed", 5)]), 0)).toBeNull();
    expect(bleachTrait(item("ring", [keystoneRoll("ks_pure")]), 0)).toBeNull();
    expect(bleachTrait(item("ring", [{ ...roll("maxLife", 5), colorless: true }]), 0)).toBeNull();
  });

  it("脱色済みの性質の鎮め・削ぎは元の色の残響で払う（無料にしない）", () => {
    const it = item("mainHand", [{ ...roll("meleeDamagePct", 20), colorless: true, flux: 0.3 }]);
    expect(echoCost({ op: "calm", item: it, traitIndex: 0 })?.color).toBe("crimson");
  });
});

describe("呼び戻し", () => {
  const a = { ...roll("meleeDamagePct", 10), origin: "bud" as const };
  const b = { ...roll("maxLife", 10), origin: "bud" as const };

  it("選ばなかった方と入れ替わり、1 つの遺物に 1 回だけ", () => {
    const it = item("mainHand", [roll("attackSpeed", 5), a], { buds: [{ milestone: "kills:50", options: [a, b], chosen: 0 }] });
    const out = recallBud(it, 0);
    expect(out?.affixes.map((r) => r.key)).toEqual(["attackSpeed", "maxLife"]);
    expect(out?.buds?.[0]?.chosen).toBe(1);
    expect(out?.buds?.[0]?.recalled).toBe(true);
    expect(out === null ? null : recallBud(out, 0), "2 回目はできない").toBeNull();
  });

  it("選んだ芽を削いでいれば呼び戻せない。費用は冥響", () => {
    const it = item("mainHand", [roll("attackSpeed", 5)], { buds: [{ milestone: "kills:50", options: [a, b], chosen: 0 }] });
    expect(recallBud(it, 0)).toBeNull();
    expect(echoCost({ op: "recall", item: it, budIndex: 0 })).toEqual({ color: "umbra", amount: RECALL_COST });
  });
});

describe("注ぎ", () => {
  it("来歴の半分（切り捨て）が注がれ、最深は深い方", () => {
    const src = { ...createEmptyProvenance(), kills: 51, weakHits: 9, deepest: 12, killsByEnemy: { slime: 7 } };
    const dst = { ...createEmptyProvenance(), kills: 10, deepest: 4, killsByEnemy: { slime: 1 } };
    const out = pouredProvenance(src, dst);
    expect(out.kills).toBe(10 + 25);
    expect(out.weakHits).toBe(4);
    expect(out.deepest).toBe(12);
    expect(out.killsByEnemy.slime).toBe(1 + 3);
    expect(dst.kills, "元は変えない").toBe(10);
  });

  it("同じ部位の別の遺物にだけ注げ、捧げた遺物は消える（費用なし）。届いた節目の芽が出る", () => {
    const source = item("mainHand", [], { id: "src", provenance: { ...createEmptyProvenance(), kills: 120 } });
    const target = item("mainHand", [roll("meleeDamagePct", 10)], { id: "dst", provenance: createEmptyProvenance() });
    expect(pourGrowth(source, item("ring", [], { id: "ring" }))).toBeNull();
    const state = craftState(0);
    const result = craftEcho(state, { op: "pour", item: source, target });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.consumedIds).toEqual(["src"]);
    expect(result.item?.provenance?.kills).toBe(60);
    expect(result.item?.budOffer?.milestone, "撃破 50 の芽").toBe("kills:50");
    expect(target.milestones, "元の遺物の節目の配列を書き換えない").toEqual([]);
  });
});

describe("鍛え直し", () => {
  it("来歴の最深で期待値を取り直し、揺らぎは保つ。余白の上限が 1 減る", () => {
    const def = affixDef("meleeDamagePct");
    if (def === undefined) throw new Error("def");
    const low: AffixRoll = { key: "meleeDamagePct", value: 6, nominal: 5, flux: 0.2, origin: "found" };
    const it = item("mainHand", [low], { itemLevel: 2, marginMax: 3, margin: 3, provenance: { ...createEmptyProvenance(), deepest: 20 } });
    const out = reforgeTrait(it, 0);
    const lifted = out?.affixes[0];
    expect(lifted?.nominal ?? 0).toBeGreaterThan(5);
    expect(lifted?.flux).toBeCloseTo(0.2);
    expect(out?.marginMax).toBe(3 - REFORGE_MARGIN_COST);
    expect(out?.margin).toBe(2);
    expect(out?.reforged).toBe(1);
    expect(out === null ? null : reforgeTrait(out, 0), "同じ最深では上がらない").toBeNull();
  });

  it("最深が浅い・余白の上限が無い・誓約は鍛え直せない", () => {
    const low: AffixRoll = { key: "meleeDamagePct", value: 60, nominal: 60, flux: 0, origin: "found" };
    expect(reforgeTrait(item("mainHand", [low], { provenance: { ...createEmptyProvenance(), deepest: 1 } }), 0)).toBeNull();
    const deep = { ...createEmptyProvenance(), deepest: 30 };
    const weak: AffixRoll = { key: "meleeDamagePct", value: 5, nominal: 5, flux: 0, origin: "found" };
    expect(reforgeTrait(item("mainHand", [weak], { marginMax: 0, provenance: deep }), 0)).toBeNull();
    expect(reforgeTrait(item("ring", [keystoneRoll("ks_pure")], { provenance: deep }), 0)).toBeNull();
  });

  it("同じ遺物・同じ回数なら同じ結果（決定的）", () => {
    const low: AffixRoll = { key: "meleeDamagePct", value: 6, nominal: 5, flux: 0.2, origin: "found" };
    const it = item("mainHand", [low], { itemLevel: 2, provenance: { ...createEmptyProvenance(), deepest: 18 } });
    const a = craftEcho(craftState(), { op: "reforge", item: it, traitIndex: 0 });
    const b = craftEcho(craftState(), { op: "reforge", item: it, traitIndex: 0 });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.item?.affixes).toEqual(b.item?.affixes);
  });
});

describe("張り", () => {
  it("代償付きの性質の利得と代償を両方 1.3 倍。1 回だけ。鎮めでも戻らない", () => {
    const crushing: AffixRoll = { key: "crushing", value: 40, value2: 10, nominal: 40, nominal2: 10, flux: 0.2, origin: "found" };
    const it = item("mainHand", [crushing], { margin: 2 });
    const out = tensionTrait(it, 0);
    const tensed = out?.affixes[0];
    expect(tensed?.value).toBeCloseTo(40 * TENSION_FACTOR);
    expect(tensed?.value2).toBeCloseTo(10 * TENSION_FACTOR);
    expect(tensed?.tensed).toBe(true);
    expect(out === null ? null : tensionTrait(out, 0)).toBeNull();
    const calmed = out === null ? null : calmTrait(out, 0);
    expect(calmed?.affixes[0]?.nominal).toBeCloseTo(40 * TENSION_FACTOR);
    expect(echoCost({ op: "tension", item: it, traitIndex: 0 })).toEqual({ color: "umbra", amount: TENSION_COST });
  });

  it("代償の無い性質は張れない", () => {
    expect(tensionTrait(item("mainHand", [roll("meleeDamagePct", 20)]), 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 来歴の節目・移行
// ---------------------------------------------------------------------------

describe("第 2 弾の来歴と節目", () => {
  it("新しい出来事を数える", () => {
    const p = createEmptyProvenance();
    for (const kind of ["weakHit", "resistedHit", "terrainKill", "favoredKill", "chargedHit", "branchHit"] as const) {
      bumpProvenance(p, { kind }, 3);
    }
    expect([p.weakHits, p.resistedHits, p.terrainKills, p.favoredKills, p.chargedHits, p.branchHits]).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it("新しい節目が 8 種以上あり、どれも目覚めを名指しし、芽の片方が目覚めになる", () => {
    const keys = ["weakHits:150", "resistedHits:150", "terrainKills:60", "favoredKills:150", "chargedHits:100", "branchHits:150", "weakHits:600", "terrainKills:250", "favoredKills:600"];
    expect(keys.length).toBeGreaterThanOrEqual(8);
    for (const key of keys) {
      const def = milestoneDef(key);
      if (def === undefined) throw new Error(key);
      expect(def.awakening, key).toBeDefined();
      const offer = makeBudOffer(item("mainHand", [roll("meleeDamagePct", 10)]), def);
      expect(offer?.options[0].key, key).toBe(def.awakening);
    }
  });

  it("欠けた第 2 弾のカウンタは 0 で補う", () => {
    const { weakHits: _w, branchHits: _b, ...old } = createEmptyProvenance();
    const p = old as ReturnType<typeof createEmptyProvenance>;
    fillProvenanceCounters(p);
    expect(p.weakHits).toBe(0);
    expect(p.branchHits).toBe(0);
  });

  it("保存と読み込みで、脱色・張り・呼び戻し・鍛え直し・新しい来歴が残る", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage;
    const profile = createEmptyProfile();
    const a = { ...roll("meleeDamagePct", 10), origin: "bud" as const, colorless: true };
    const b = { ...roll("crushing", 10, 5), tensed: true };
    profile.stash.push(
      item("mainHand", [a, b], {
        buds: [{ milestone: "kills:50", options: [a, roll("maxLife", 5)], chosen: 0, recalled: true }],
        reforged: 2,
        provenance: { ...createEmptyProvenance(), weakHits: 4, terrainKills: 2 },
      }),
    );
    saveProfile(profile, storage);
    const loaded = loadProfile(storage).stash[0];
    expect(loaded?.affixes[0]?.colorless).toBe(true);
    expect(loaded?.affixes[1]?.tensed).toBe(true);
    expect(loaded?.buds?.[0]?.recalled).toBe(true);
    expect(loaded?.reforged).toBe(2);
    expect(loaded?.provenance?.weakHits).toBe(4);
    expect(loaded?.provenance?.terrainKills).toBe(2);
  });
});

describe("数値の単位", () => {
  it("% 表示の性質は 0.01 単位で TraitStats に入る", () => {
    const s = stats();
    applyRoll(s, roll("terrainHunter", 25));
    expect(s.traits.enemyOnTerrainMul).toBeCloseTo(25 * PERCENT);
  });
});
