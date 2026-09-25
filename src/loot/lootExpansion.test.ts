import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { createRng } from "../core/rng";
import { KEYSTONE, WEAPON } from "../data/tuning";
import {
  AFFIXES,
  CONVERSION_AFFIXES,
  KEYSTONES,
  affixDef,
  applyRoll,
  formatAffix,
  implicitDef,
  isAwakeningKey,
  keystoneToRoll,
  keystoneDef,
  traitsFor,
  type KeystoneGroup,
} from "./affixes";
import { BASES, baseDef } from "./bases";
import { describeStatusProc } from "./describe";
import { STATUS_KINDS } from "../core/status";
import { BASE_LEAN, OPPOSITE_COLOR, traitColorOf } from "./colors";
import { MODULATE_COST, craftEcho, createEchoWallet, modulateTrait, type EchoCraftState } from "./crafting";
import { MAX_MARGIN, VESSEL_CAPACITY, generateItem, rollUniqueAffixes } from "./generator";
import { UNIQUES } from "./named";
import { loadProfile, saveProfile } from "./profile";
import { MILESTONES, makeBudOffer, milestoneDef, recordProvenance } from "./provenance";
import {
  DEFAULT_RESONANCE_RULES,
  TRIAD_EFFECTS,
  TRIAD_MIN_RATIO,
  resolveResonance,
  resonanceRules,
  triadKey,
  type ColorWeights,
} from "./resonance";
import { computeStats, equipmentResonance } from "./stats";
import { PROVENANCE_STEPS, gearContext } from "./traitContext";
import {
  ATTR_KEYS,
  DEFAULT_STATS,
  SLOTS,
  TRAIT_COLORS,
  createEmptyEquipment,
  createEmptyProfile,
  createEmptyProvenance,
  type AffixRoll,
  type Item,
  type PlayerStats,
  type Slot,
} from "./types";

/**
 * 装備コンテンツの大量拡張（docs/ideas/loot-expansion.md）のテスト。
 * 性質・誓約・変換・ベース・名のある遺物・来歴の節目と目覚め・転調・三和音をまとめて検査する
 */

const NOW = 1_700_000_000_000;
const MIN_AFFIXES = 130;
const MIN_NEW_KEYSTONES = 8;
const PERCENT = 0.01;

function stats(): PlayerStats {
  return {
    ...DEFAULT_STATS,
    keystones: [],
    triggers: [],
    statusProcs: [],
    attributes: { ...DEFAULT_STATS.attributes },
    traits: { ...DEFAULT_STATS.traits },
  };
}

function roll(key: string, value: number, value2?: number): AffixRoll {
  const out: AffixRoll = { key, value, nominal: value, flux: 0, origin: "found" };
  if (value2 !== undefined) out.value2 = value2;
  return out;
}

function item(slot: Slot, affixes: AffixRoll[], overrides: Partial<Item> = {}): Item {
  return {
    id: `x-${slot}`,
    seed: 3,
    baseKey: "test",
    slot,
    rarity: "magic",
    itemLevel: 10,
    name: "test",
    implicit: null,
    affixes,
    foundDepth: 10,
    foundAt: 0,
    provenance: createEmptyProvenance(),
    margin: 0,
    marginMax: 0,
    milestones: [],
    buds: [],
    budOffer: null,
    ...overrides,
  };
}

function w(partial: Partial<ColorWeights>): ColorWeights {
  return { crimson: 0, azure: 0, jade: 0, gold: 0, umbra: 0, ...partial };
}

describe("性質の量産", () => {
  it(`性質（変換を含む）は ${MIN_AFFIXES} 種以上あり、key が重複しない`, () => {
    const keys = [...AFFIXES, ...CONVERSION_AFFIXES].map((d) => d.key);
    expect(keys.length).toBeGreaterThanOrEqual(MIN_AFFIXES);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("目覚めは通常の抽選（traitsFor）に出ないが、定義としては引ける", () => {
    const awakenings = AFFIXES.filter((d) => d.awakening === true);
    expect(awakenings.length, "目覚めが 4 種以上").toBeGreaterThanOrEqual(4);
    for (const slot of SLOTS) {
      for (const def of traitsFor(slot, 40)) expect(def.awakening, def.key).not.toBe(true);
    }
    for (const def of awakenings) expect(isAwakeningKey(def.key), def.key).toBe(true);
  });

  it("汲み上げ: 怯みでマナ、撃破のマナは減る", () => {
    const s = stats();
    applyRoll(s, roll("manaOnStagger", 6, 3));
    expect(s.traits.manaOnStagger).toBe(6);
    expect(s.manaOnKill).toBe(-3);
  });

  it("剥がし撃ち: 堅守の打ち消しは 100% で頭打ち", () => {
    const s = stats();
    applyRoll(s, roll("guardPiercer", 150, 10));
    expect(s.traits.guardPierce).toBeCloseTo(1);
    expect(s.traits.rangedPoiseMul).toBeCloseTo(-0.1);
    expect(formatAffix(roll("guardPiercer", 150, 10)), "表示も上限で切る").toContain("100%");
  });

  it("固定のトリガーを持つ性質は確率 1 で積み、値が 0 以下なら積まない", () => {
    const s = stats();
    applyRoll(s, roll("dashVolley", 60, 8));
    applyRoll(s, roll("plagueSeed", 4));
    applyRoll(s, roll("windupCrack", -5));
    expect(s.triggers.map((t) => `${t.trigger}:${t.effect}`)).toEqual(["onDash:volley", "onKill:inflict"]);
    expect(s.triggers.every((t) => t.chance === 1)).toBe(true);
    expect(s.triggers[1]?.status).toBe("poison");
  });
});

describe("装備全体の文脈を読む性質", () => {
  it("若木: 装備全体の残り余白 1 につき与ダメージが伸びる（芽を選ぶと弱まる）", () => {
    const eq = createEmptyEquipment();
    eq.ring = item("ring", [roll("sapling", 2)], { margin: 3 });
    eq.boots = item("boots", [], { margin: 2 });
    const s = computeStats(eq);
    // 右手が空なので素手の倍率が掛かる
    const unarmed = WEAPON.unarmed.damageMul;
    expect(s.meleeDamageMul).toBeCloseTo((1 + 2 * PERCENT * 5) * unarmed);
    eq.boots = item("boots", [], { margin: 0 });
    expect(computeStats(eq).meleeDamageMul).toBeCloseTo((1 + 2 * PERCENT * 3) * unarmed);
  });

  it("文脈（余白・銘・反転・異色の数）は畳み込み後の stats に残らない", () => {
    const eq = createEmptyEquipment();
    eq.ring = item("ring", [], { margin: 3, inscription: "銘" });
    expect(gearContext(eq)).toEqual({ gearMargin: 3, gearItems: 1, gearInscribed: 1, gearInverted: 0, gearOffColor: 0 });
    expect(computeStats(eq).traits).toEqual(DEFAULT_STATS.traits);
  });

  it("銘の重み: 銘 1 つにつき会心倍率、銘の無い装備 1 つにつき最大HP −", () => {
    const eq = createEmptyEquipment();
    eq.ring = item("ring", [roll("inscribedWeight", 10, 3)], { inscription: "見切り" });
    eq.boots = item("boots", []);
    eq.armor = item("armor", []);
    const s = computeStats(eq);
    expect(s.critMul).toBeCloseTo(DEFAULT_STATS.critMul + 0.1);
    expect(s.maxHp).toBe(DEFAULT_STATS.maxHp - 3 * 2);
  });

  it("裏の糧: 反転 1 つにつき与ダメージと被ダメージが増える", () => {
    const eq = createEmptyEquipment();
    // 反転の重みを小さくして共鳴（虚極）を起こさない: 重みの合計が 3 未満
    const inverted: AffixRoll = { key: "moveSpeed", value: -1, nominal: 5, flux: -1.2, inverted: true, color: "umbra" };
    eq.ring = item("ring", [roll("invertedFeast", 10, 3)]);
    eq.boots = item("boots", [inverted, { ...inverted, key: "dashDistance" }]);
    const s = computeStats(eq);
    expect(s.resonance.kind).toBe("none");
    expect(s.rangedDamageMul).toBeCloseTo(1 + 0.2);
    expect(s.damageTakenMul).toBeCloseTo(1 + 0.06);
  });

  it("異郷の響き: 異色の性質 1 つにつき全ステータスが上がる", () => {
    const eq = createEmptyEquipment();
    eq.ring = item("ring", [roll("foreignEcho", 1, 6)]);
    eq.mainHand = item("mainHand", [{ ...roll("meleeDamagePct", 10), color: "azure" }]);
    expect(gearContext(eq).gearOffColor).toBe(1);
    const s = computeStats(eq);
    for (const k of ATTR_KEYS) expect(s.attributes[k], k).toBeGreaterThanOrEqual(DEFAULT_STATS.attributes[k] + 1);
  });

  it("来歴で育つ性質: 段数を掛けて適用し、上限で止まる", () => {
    const eq = createEmptyEquipment();
    const provenance = { ...createEmptyProvenance(), hurtTaken: 250 };
    eq.armor = item("armor", [roll("oldScars", 2)], { provenance });
    expect(computeStats(eq).armor).toBe(2 * 2);
    eq.armor = item("armor", [roll("oldScars", 2)], { provenance: { ...provenance, hurtTaken: 10_000 } });
    expect(computeStats(eq).armor, "5 段まで").toBe(2 * (PROVENANCE_STEPS.oldScars?.max ?? 0));
    eq.armor = item("armor", [roll("oldScars", 2)]);
    expect(computeStats(eq).armor, "新品は何もない").toBe(0);
  });
});

describe("変換の追加", () => {
  it("cv_regenToGain: 自然回復を回収へ移す", () => {
    const s = stats();
    applyRoll(s, roll("cv_regenToGain", 50));
    expect(s.manaRegen).toBeCloseTo(DEFAULT_STATS.manaRegen * 0.5);
    expect(s.manaGainMul).toBeGreaterThan(1);
  });

  it("cv_projectilesToPoise: 弾数を 1 にし、減らした分だけ射撃の怯み値", () => {
    const s = stats();
    s.projectileCount = 4;
    applyRoll(s, roll("cv_projectilesToPoise", 100));
    expect(s.projectileCount).toBe(1);
    expect(s.traits.rangedPoiseMul).toBeCloseTo(3);
  });

  it("cv_knockbackToPoise / cv_burnToPoison / cv_lifeToMana が軸を移す", () => {
    const s = stats();
    s.knockbackMul = 1.5;
    s.burnChance = 0.2;
    s.burnDps = 10;
    applyRoll(s, roll("cv_knockbackToPoise", 100));
    applyRoll(s, roll("cv_burnToPoison", 50));
    applyRoll(s, roll("cv_lifeToMana", 10));
    expect(s.knockbackMul).toBeCloseTo(1);
    expect(s.poiseDamageMul).toBeCloseTo(1.5);
    expect(s.burnChance).toBeCloseTo(0.1);
    expect(s.statusProcs.map((p) => p.kind)).toEqual(["poison"]);
    expect(s.maxMana).toBeCloseTo(DEFAULT_STATS.maxMana + DEFAULT_STATS.maxHp * 0.1 * 0.5);
  });
});

describe("誓約の追加", () => {
  it(`新しい排他グループ（status / poise / room / hue / chronicle）に ${MIN_NEW_KEYSTONES} 種以上`, () => {
    const groups: KeystoneGroup[] = ["status", "poise", "room", "hue", "chronicle"];
    const added = KEYSTONES.filter((k) => groups.includes(k.exclusiveGroup));
    expect(added.length).toBeGreaterThanOrEqual(MIN_NEW_KEYSTONES);
    for (const g of groups) expect(added.some((k) => k.exclusiveGroup === g), g).toBe(true);
  });

  it("無垢の誓い: 受ける状態異常の持続が 0、装備の付与がすべて消える", () => {
    const eq = createEmptyEquipment();
    eq.mainHand = item("mainHand", [roll("burn", 10, 5), roll("procPoison", 20), roll("plagueSeed", 4)]);
    eq.armor = item("armor", [roll("statusWard", 20), { ...keystoneToRoll(keystoneDefOrThrow("ks_pure")) }]);
    const s = computeStats(eq);
    expect(s.statusTakenMul).toBe(0);
    expect(s.burnChance).toBe(0);
    expect(s.statusProcs).toHaveLength(0);
    expect(s.triggers.some((t) => t.effect === "inflict")).toBe(false);
  });

  it("蝕みの誓約: 付与確率 ×2（上限 1）、受ける持続 ×2", () => {
    const eq = createEmptyEquipment();
    eq.mainHand = item("mainHand", [roll("procPoison", 20)]);
    eq.armor = item("armor", [keystoneToRoll(keystoneDefOrThrow("ks_blight"))]);
    const s = computeStats(eq);
    expect(s.statusProcs[0]?.chance).toBeCloseTo(0.4);
    expect(s.statusTakenMul).toBeCloseTo(KEYSTONE.blightTakenMul);
  });

  it("揺るがぬ誓い: 怯み値は 0、上昇分は与ダメージになる", () => {
    const eq = createEmptyEquipment();
    eq.mainHand = item("mainHand", [roll("heavyHand", 40, 5), keystoneToRoll(keystoneDefOrThrow("ks_unshaken"))]);
    const s = computeStats(eq);
    expect(s.poiseDamageMul).toBe(0);
    expect(s.skillDamageMul).toBeCloseTo(1 + KEYSTONE.unshakenDamageBonus + 0.4 * KEYSTONE.unshakenPoiseToDamage);
  });

  it("背水の誓い: 制圧時に失った HP を取り戻すトリガーを持つ", () => {
    const eq = createEmptyEquipment();
    eq.armor = item("armor", [keystoneToRoll(keystoneDefOrThrow("ks_backwater"))]);
    const t = computeStats(eq).triggers.find((x) => x.effect === "healMissing");
    expect(t?.trigger).toBe("onRoomClear");
    expect(t?.magnitude).toBe(KEYSTONE.backwaterClearHealPct);
  });

  it("忘却の誓い: 余白 1 につき全ステータス +1", () => {
    const eq = createEmptyEquipment();
    eq.armor = item("armor", [keystoneToRoll(keystoneDefOrThrow("ks_oblivion"))], { margin: 2 });
    eq.ring = item("ring", [], { margin: 1 });
    const s = computeStats(eq);
    for (const k of ATTR_KEYS) expect(s.attributes[k], k).toBe(DEFAULT_STATS.attributes[k] + 3);
  });
});

function keystoneDefOrThrow(key: string): NonNullable<ReturnType<typeof keystoneDef>> {
  const def = keystoneDef(key);
  if (def === undefined) throw new Error(`誓約 ${key} が無い`);
  return def;
}

describe("共鳴: 三和音と規則", () => {
  it("三和音: ちょうど 3 色が 22% 以上で成立し、10 組すべてに効果がある", () => {
    const r = resolveResonance(w({ crimson: 29, azure: 26, jade: 25, gold: 10, umbra: 10 }));
    expect(r.kind).toBe("triad");
    expect(r.colors).toEqual(["crimson", "azure", "jade"]);
    expect(Object.keys(TRIAD_EFFECTS)).toHaveLength(10);
    for (const [a, b, c] of [["crimson", "azure", "gold"], ["jade", "gold", "umbra"]] as const) {
      expect(TRIAD_EFFECTS[triadKey([a, b, c])], `${a}+${b}+${c}`).toBeDefined();
    }
    expect(TRIAD_MIN_RATIO).toBeLessThan(DEFAULT_RESONANCE_RULES.dualMinRatio);
  });

  it("二重が先に勝つ / 4 色目まで強ければ散光", () => {
    expect(resolveResonance(w({ crimson: 35, azure: 33, jade: 32 })).kind).toBe("dual");
    expect(resolveResonance(w({ crimson: 25, azure: 25, jade: 25, gold: 25 })).kind).toBe("scatter");
  });

  it("橋渡し・双頭の指輪: 二重の成立条件が下がり、橋渡しは散光を止める", () => {
    const rules = resonanceRules([roll("bridge", 25), { key: "implicit.twinRing", value: 3 }]);
    expect(rules.dualMinRatio).toBeCloseTo(0.22);
    expect(rules.allowScatter).toBe(false);
    expect(resolveResonance(w({ crimson: 40, azure: 26, jade: 20, gold: 14 }), rules).kind).toBe("dual");
  });

  it("単色の誓い: 支配だけ（35% で成立）、効果は 2 回", () => {
    const rules = resonanceRules([keystoneToRoll(keystoneDefOrThrow("ks_monochrome"))]);
    expect(resolveResonance(w({ crimson: 36, azure: 34, jade: 30 }), rules).kind).toBe("dominant");
    expect(resolveResonance(w({ crimson: 34, azure: 33, jade: 33 }), rules).kind).toBe("none");
    expect(rules.effectRepeats).toBe(2);
  });

  it("無色の誓い: 共鳴せず、性質の値が上がる", () => {
    const eq = createEmptyEquipment();
    eq.mainHand = item("mainHand", [roll("meleeDamagePct", 20), roll("meleeDamageFlat", 5)]);
    eq.ring = item("ring", [roll("attackSpeed", 10), keystoneToRoll(keystoneDefOrThrow("ks_colorless"))]);
    const s = computeStats(eq);
    expect(s.resonance.kind).toBe("none");
    expect(s.meleeDamageMul).toBeCloseTo(1 + 0.2 * KEYSTONE.colorlessTraitMul);
  });

  it("鏡の誓い: 色を反対色で数える（紅ばかりなら蒼の支配）", () => {
    const eq = createEmptyEquipment();
    eq.mainHand = item("mainHand", [roll("meleeDamagePct", 20), roll("meleeDamageFlat", 5), roll("attackSpeed", 5)]);
    eq.ring = item("ring", [roll("crushing", 30, 10), keystoneToRoll(keystoneDefOrThrow("ks_mirror"))]);
    const r = equipmentResonance(eq);
    expect(r.kind).toBe("dominant");
    expect(r.colors).toEqual(["azure"]);
  });
});

describe("ベースの追加", () => {
  it("新ベースは implicit が実在し、色の傾きを持つ", () => {
    for (const base of BASES) {
      expect(BASE_LEAN[base.key], base.key).toBeDefined();
      if (base.implicitKey !== undefined) expect(implicitDef(base.implicitKey), base.key).toBeDefined();
    }
    expect(BASES.length, "35 → 56").toBeGreaterThanOrEqual(43);
  });

  it("襤褸は implicit を持たず、余白が多い（器の容量まで）", () => {
    const rags = baseDef("rags");
    expect(rags?.implicitKey).toBeUndefined();
    const rng = createRng(11);
    let sawExtra = false;
    for (let i = 0; i < 400; i++) {
      const it = generateItem(rng, { itemLevel: 3, foundDepth: 3, slot: "armor", now: NOW });
      if (it.baseKey !== "rags" || it.namedKey !== undefined) continue;
      expect(it.margin ?? 0).toBeLessThanOrEqual(VESSEL_CAPACITY);
      if ((it.margin ?? 0) > MAX_MARGIN) sawExtra = true;
    }
    expect(sawExtra, "器の容量いっぱいの襤褸が出る").toBe(true);
  });

  it("黒鉄の指輪: 装備中の反転の数だけ会心率", () => {
    const eq = createEmptyEquipment();
    const inverted: AffixRoll = { key: "moveSpeed", value: -3, nominal: 5, flux: -1.6, inverted: true, color: "umbra" };
    eq.ring = item("ring", [], { implicit: { key: "implicit.blackIronRing", value: 3 } });
    eq.boots = item("boots", [inverted]);
    expect(computeStats(eq).critChance).toBeCloseTo(DEFAULT_STATS.critChance + 0.03);
  });
});

describe("名のある遺物の追加", () => {
  it("全て生成でき、固定の性質と誓約が付く", () => {
    for (const u of UNIQUES) {
      const affixes = rollUniqueAffixes(createRng(5), u, u.minLevel);
      const keys = affixes.map((r) => r.key);
      for (const spec of u.affixes) expect(keys, u.key).toContain(spec.key);
      if (u.keystone !== undefined) expect(keys, u.key).toContain(u.keystone);
      expect(u.flavor?.length ?? 0, `${u.key} の銘の一文`).toBeGreaterThan(0);
    }
  });
});

describe("来歴の節目と目覚め", () => {
  function equippedState(slot: Slot = "mainHand", baseKey = "shortsword"): ReturnType<typeof createGame> {
    const gen = generateItem(createRng(21), { itemLevel: 10, foundDepth: 10, slot, now: NOW });
    const profile = createEmptyProfile();
    profile.equipment[slot] = { ...gen, baseKey, affixes: gen.affixes.slice(0, 1), margin: 3, marginMax: 3 };
    return createGame(1, "1", profile);
  }

  it("怯ませた / カウンター / スキル発動 / エリート撃破 / 殲滅を数える", () => {
    const state = equippedState();
    for (const kind of ["stagger", "counter", "skillCast", "eliteKill", "lastKill"] as const) recordProvenance(state, { kind });
    const p = state.profile.equipment.mainHand?.provenance;
    expect([p?.staggers, p?.counters, p?.skillCasts, p?.eliteKills, p?.lastKills]).toEqual([1, 1, 1, 1, 1]);
  });

  it("節目が 4 種以上増え、目覚めを名指しする節目の芽は片方が目覚め", () => {
    const counters = new Set(MILESTONES.map((m) => (m.enemyKey === undefined ? m.counter : `enemy:${m.enemyKey}`)));
    for (const c of ["staggers", "counters", "skillCasts", "eliteKills"]) expect(counters.has(c), c).toBe(true);
    const def = milestoneDef("counters:30");
    expect(def?.awakening).toBe("firstMove");
    if (def === undefined) return;
    const gen = generateItem(createRng(3), { itemLevel: 10, foundDepth: 10, slot: "mainHand", now: NOW });
    const offer = makeBudOffer({ ...gen, affixes: [] }, def);
    expect(offer?.options[0].key).toBe("firstMove");
    expect(traitColorOf(offer?.options[1] ?? { key: "", value: 0 })).toBe(OPPOSITE_COLOR.gold);
  });

  it("盾騎士の撃破数で「盾割り」が芽吹く", () => {
    const state = equippedState();
    const weapon = state.profile.equipment.mainHand;
    if (weapon === null) throw new Error("武器が無い");
    // 他の節目は到達済みにして、盾騎士 30 の節目だけを見る
    weapon.milestones = MILESTONES.map((m) => m.key).filter((k) => k !== "enemy:knight:30");
    for (let i = 0; i < 30; i++) recordProvenance(state, { kind: "kill", enemyKey: "knight", boss: false });
    expect(weapon.budOffer?.milestone).toBe("enemy:knight:30");
    expect(weapon.budOffer?.options[0].key).toBe("shieldSplitter");
    expect(state.pendingBud?.milestoneLabel).toBe("盾騎士撃破 30");
  });

  it("修行の誓いは来歴を 3 倍、忘却の誓いは積まない、印章指輪は 2 倍", () => {
    const disciplined = equippedState();
    disciplined.stats = { ...disciplined.stats, keystones: ["ks_discipline"] };
    recordProvenance(disciplined, { kind: "just" });
    expect(disciplined.profile.equipment.mainHand?.provenance?.justDodges).toBe(KEYSTONE.disciplineProgress);

    const forgotten = equippedState();
    forgotten.stats = { ...forgotten.stats, keystones: ["ks_oblivion"] };
    recordProvenance(forgotten, { kind: "just" });
    expect(forgotten.profile.equipment.mainHand?.provenance?.justDodges).toBe(0);

    const signet = equippedState("ring", "signet");
    recordProvenance(signet, { kind: "just" });
    expect(signet.profile.equipment.ring?.provenance?.justDodges).toBe(2);
  });

  it("読み込みを通らない来歴（リプレイの装備など）も、積む前に欠けたカウンタを 0 で補う", () => {
    const state = equippedState();
    const weapon = state.profile.equipment.mainHand;
    if (weapon?.provenance === undefined) throw new Error("来歴が無い");
    const { staggers: _s, counters: _c, skillCasts: _k, eliteKills: _e, lastKills: _l, ...old } = weapon.provenance;
    weapon.provenance = old as typeof weapon.provenance;
    recordProvenance(state, { kind: "stagger" });
    expect(weapon.provenance.staggers).toBe(1);
  });

  it("旧セーブ（新しい来歴が無い）を読んでも 0 で補う", () => {
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
    const legacy = item("ring", [roll("critChance", 3)]);
    const { staggers: _s, counters: _c, skillCasts: _k, eliteKills: _e, lastKills: _l, ...oldProvenance } = createEmptyProvenance();
    profile.stash.push({ ...legacy, provenance: { ...oldProvenance, kills: 7 } as ReturnType<typeof createEmptyProvenance> });
    saveProfile(profile, storage);
    const loaded = loadProfile(storage).stash[0]?.provenance;
    expect(loaded?.kills).toBe(7);
    expect(loaded?.staggers).toBe(0);
    expect(loaded?.lastKills).toBe(0);
  });
});

describe("残響: 転調", () => {
  function richState(): EchoCraftState {
    const echoes = createEchoWallet();
    for (const c of TRAIT_COLORS) echoes[c] = 10;
    return { echoes, counter: 0 };
  }

  it("効果はそのまま、色だけ反対色へ。費用は変えた先の色の残響", () => {
    const target = item("mainHand", [{ ...roll("meleeDamagePct", 20), color: "crimson" }]);
    const craft = richState();
    const result = craftEcho(craft, { op: "modulate", item: target, traitIndex: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok || result.item === null) return;
    expect(result.item.affixes[0]?.color).toBe("azure");
    expect(result.item.affixes[0]?.value).toBe(20);
    expect(craft.echoes.azure).toBe(10 - MODULATE_COST);
    expect(craft.echoes.crimson).toBe(10);
  });

  it("反転・誓約は転調できない（何も消費しない）", () => {
    const inverted: AffixRoll = { key: "moveSpeed", value: -3, nominal: 5, flux: -1.6, inverted: true, color: "umbra" };
    expect(modulateTrait(item("boots", [inverted]), 0)).toBeNull();
    expect(modulateTrait(item("ring", [keystoneToRoll(keystoneDefOrThrow("ks_pure"))]), 0)).toBeNull();
    const craft = richState();
    const result = craftEcho(craft, { op: "modulate", item: item("boots", [inverted]), traitIndex: 0 });
    expect(result.ok).toBe(false);
    expect(TRAIT_COLORS.every((c) => craft.echoes[c] === 10)).toBe(true);
  });

  it("転調で共鳴の配合が動く（紅 4・翠 1・金 1 の紅 2 つを蒼へ → 二重）", () => {
    const eq = createEmptyEquipment();
    const reds = [roll("meleeDamagePct", 20), roll("meleeDamageFlat", 5), roll("attackSpeed", 5), roll("crushing", 30, 10)];
    eq.mainHand = item("mainHand", reds);
    eq.armor = item("armor", [roll("maxLife", 20)]);
    eq.ring = item("ring", [roll("critChance", 3)]);
    expect(equipmentResonance(eq).kind).toBe("dominant");
    let changed = eq.mainHand;
    for (const index of [0, 1]) changed = modulateTrait(changed, index) ?? changed;
    eq.mainHand = changed;
    expect(equipmentResonance(eq).kind).toBe("dual");
  });
});

describe("名前の付いた性質の表示", () => {
  it("新しい性質は「名前: 効果」か数値の行で、{v} が残らない", () => {
    for (const def of AFFIXES) {
      const text = formatAffix(roll(def.key, 10, 5));
      expect(text, def.key).not.toContain("{v");
    }
    expect(affixDef("kaleidoscope")?.label.startsWith("多彩:")).toBe(true);
  });
});

describe("作業領域・ハブ性質の定義", () => {
  it("余韻斬り・形見・撃ち込み杭・置き土産・杭打ち・血の署名が数値を積む", () => {
    const s = stats();
    applyRoll(s, roll("echoSlash", 2, 0.3));
    applyRoll(s, roll("inheritance", 3, 10));
    applyRoll(s, roll("stake", 6, 10));
    applyRoll(s, roll("placedInfuse", 3, 8));
    applyRoll(s, roll("placedAnchor", 1.5, 5));
    applyRoll(s, roll("bloodSignature", 40, 10));
    expect(s.traits.comboBreakWave).toBe(2);
    expect(s.comboWindowBonus).toBeCloseTo(-0.3);
    expect(s.traits.inheritCharges).toBe(3);
    expect(s.traits.stakeDamage).toBe(6);
    expect(s.traits.placedInfuse).toBe(3);
    expect(s.maxHp, "置き土産 8 + 血の署名 10").toBe(DEFAULT_STATS.maxHp - 8 - 10);
    expect(s.traits.placedExtend).toBe(1.5);
    expect(s.traits.lowHpSkillHaste).toBeCloseTo(0.4);
  });

  it("祝福の響きは 5 色すべてにあり、色はその性質の色", () => {
    for (const color of TRAIT_COLORS) {
      const def = affixDef(`boonEcho_${color}`);
      expect(def?.color, color).toBe(color);
    }
    const s = stats();
    applyRoll(s, roll("boonEcho_gold", 5));
    expect(s.traits.boonEchoGold).toBeCloseTo(0.05);
  });

  it("状態異常の付与の説明は全種類に動詞がある", () => {
    for (const kind of STATUS_KINDS) {
      const text = describeStatusProc({ kind, chance: 0.1, stacks: 1, duration: 2, potency: 0, on: "any" });
      expect(text, kind).not.toContain("undefined");
    }
  });
});
