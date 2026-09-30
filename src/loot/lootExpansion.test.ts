import { createIncreased } from "../core/damage";
import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { createRng } from "../core/rng";
import { KEYSTONE } from "../data/tuning";
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
import { MAX_MARGIN, VESSEL_CAPACITY, generateItem } from "./generator";
import { loadProfile, saveProfile } from "./profile";
import { MILESTONES, makeBudOffer, milestoneDef, recordProvenance } from "./provenance";
import { computeStats } from "./stats";
import { PROVENANCE_STEPS, gearContext } from "./traitContext";
import {
  DEFAULT_STATS,
  SLOTS,
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
 * 性質・誓約・変換・ベース・名のある遺物・来歴の節目と目覚めをまとめて検査する（段取り 7d で消えた性質・共鳴・転調の節は外した）
 */

const NOW = 1_700_000_000_000;
const PERCENT = 0.01;

function stats(): PlayerStats {
  return {
    ...DEFAULT_STATS,
    increased: createIncreased(),
    more: [],
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

describe("性質の量産", () => {
  it("性質（変換を含む）の key が重複しない", () => {
    const keys = [...AFFIXES, ...CONVERSION_AFFIXES].map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("目覚め専用の性質は無く、節目が名指しする性質は通常の抽選にも出る", () => {
    expect(AFFIXES.filter((d) => d.awakening === true)).toEqual([]);
    for (const m of MILESTONES) {
      if (m.awakening === undefined) continue;
      expect(isAwakeningKey(m.awakening), m.key).toBe(false);
      const def = affixDef(m.awakening);
      expect(def, `${m.key} の名指し ${m.awakening}`).toBeDefined();
      if (def === undefined) continue;
      expect(SLOTS.some((slot) => traitsFor(slot, 40).includes(def)), m.awakening).toBe(true);
    }
  });

  it("汲み上げ: 怯みでマナ、撃破のマナは減る", () => {
    const s = stats();
    applyRoll(s, roll("manaOnStagger", 6, 3));
    expect(s.traits.manaOnStagger).toBe(6);
    expect(s.manaOnKill).toBe(-3);
  });

  it("剥がし: 堅守の打ち消しは 100% で頭打ち", () => {
    const s = stats();
    applyRoll(s, roll("guardPiercer", 150));
    expect(s.traits.guardPierce).toBeCloseTo(1);
    expect(formatAffix(roll("guardPiercer", 150)), "表示も上限で切る").toContain("100%");
  });

  it("固定のトリガーを持つ性質は確率 1 で積み、値が 0 以下なら積まない", () => {
    const s = stats();
    applyRoll(s, roll("staggerSpark", 10));
    applyRoll(s, roll("plagueSeed", 4));
    applyRoll(s, roll("firstMove", -5));
    expect(s.triggers.map((t) => `${t.trigger}:${t.effect}`)).toEqual(["onStagger:chainLightning", "onKill:inflict"]);
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
    expect(s.increased.melee).toBeCloseTo(2 * PERCENT * 5);
    eq.boots = item("boots", [], { margin: 0 });
    expect(computeStats(eq).increased.melee).toBeCloseTo(2 * PERCENT * 3);
  });

  it("文脈（余白・銘・反転・異色の数）は畳み込み後の stats に残らない", () => {
    const eq = createEmptyEquipment();
    eq.ring = item("ring", [], { margin: 3, inscription: "銘" });
    expect(gearContext(eq)).toEqual({ gearMargin: 3, gearItems: 1, gearInscribed: 1, gearInverted: 0, gearOffColor: 0 });
    expect(computeStats(eq).traits).toEqual(DEFAULT_STATS.traits);
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
  it("cv_projectilesToPoise: 弾数を 1 にし、減らした分だけ射撃の怯み値", () => {
    const s = stats();
    s.projectileCount = 4;
    applyRoll(s, roll("cv_projectilesToPoise", 100));
    expect(s.projectileCount).toBe(1);
    expect(s.traits.rangedPoiseMul).toBeCloseTo(3);
  });

});

describe("誓約の追加", () => {
  it("排他グループ（body / tempo / style / mana / status / poise / coin）のどれにも誓約がある", () => {
    const groups: KeystoneGroup[] = ["body", "tempo", "style", "mana", "status", "poise", "coin"];
    for (const g of groups) expect(KEYSTONES.some((k) => k.exclusiveGroup === g), g).toBe(true);
  });

  it("無垢の誓い: 受ける状態異常の持続が 0、装備の付与がすべて消える", () => {
    const eq = createEmptyEquipment();
    eq.mainHand = item("mainHand", [roll("burn", 10, 5), roll("procPoison", 20), roll("plagueSeed", 4)]);
    eq.armor = item("armor", [{ ...keystoneToRoll(keystoneDefOrThrow("ks_pure")) }]);
    const s = computeStats(eq);
    expect(s.statusTakenMul).toBe(0);
    expect(s.burnChance).toBe(0);
    expect(s.statusProcs).toHaveLength(0);
    expect(s.triggers.some((t) => t.effect === "inflict")).toBe(false);
  });

  it("揺るがぬ誓い: 怯み値は 0、上昇分は与ダメージになる", () => {
    const eq = createEmptyEquipment();
    // 不殺（style）で怯み値を上げてから揺るがぬ（poise）が畳む。誓約は装備の順に適用される
    eq.mainHand = item("mainHand", [keystoneToRoll(keystoneDefOrThrow("ks_pacifist")), keystoneToRoll(keystoneDefOrThrow("ks_unshaken"))]);
    const s = computeStats(eq);
    expect(s.poiseDamageMul).toBe(0);
    const raised = KEYSTONE.pacifistPoiseMul - 1;
    expect(s.more.find((m) => m.source === "keystone:ks_unshaken")?.mul).toBeCloseTo(1 + KEYSTONE.unshakenDamageBonus + raised * KEYSTONE.unshakenPoiseToDamage);
  });

});

function keystoneDefOrThrow(key: string): NonNullable<ReturnType<typeof keystoneDef>> {
  const def = keystoneDef(key);
  if (def === undefined) throw new Error(`誓約 ${key} が無い`);
  return def;
}

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
    const inverted: AffixRoll = { key: "firstStrikeEdge", value: -3, nominal: 5, flux: -1.6, inverted: true, color: "umbra" };
    eq.ring = item("ring", [], { implicit: { key: "implicit.blackIronRing", value: 3 } });
    eq.boots = item("boots", [inverted]);
    expect(computeStats(eq).critChance).toBeCloseTo(DEFAULT_STATS.critChance + 0.03);
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

  it("盾騎士の撃破数で「堅守崩し」が芽吹く", () => {
    const state = equippedState();
    const weapon = state.profile.equipment.mainHand;
    if (weapon === null) throw new Error("武器が無い");
    // 他の節目は到達済みにして、盾騎士 30 の節目だけを見る
    weapon.milestones = MILESTONES.map((m) => m.key).filter((k) => k !== "enemy:knight:30");
    for (let i = 0; i < 30; i++) recordProvenance(state, { kind: "kill", enemyKey: "knight", boss: false });
    expect(weapon.budOffer?.milestone).toBe("enemy:knight:30");
    expect(weapon.budOffer?.options[0].key).toBe("guardedBane");
    expect(state.pendingBud?.milestoneLabel).toBe("盾騎士撃破 30");
  });

  it("来歴は 1 つずつ積み、印章指輪は 2 倍", () => {
    const plain = equippedState();
    recordProvenance(plain, { kind: "just" });
    expect(plain.profile.equipment.mainHand?.provenance?.justDodges).toBe(1);

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

describe("名前の付いた性質の表示", () => {
  it("新しい性質は「名前: 効果」か数値の行で、{v} が残らない", () => {
    for (const def of AFFIXES) {
      const text = formatAffix(roll(def.key, 10, 5));
      expect(text, def.key).not.toContain("{v");
    }
    expect(affixDef("purse")?.label.startsWith("懐:")).toBe(true);
  });
});

describe("作業領域・ハブ性質の定義", () => {
  it("余韻斬り・形見・撃ち込み杭・置き土産・血の署名が数値を積む", () => {
    const s = stats();
    applyRoll(s, roll("echoSlash", 2, 0.3));
    applyRoll(s, roll("inheritance", 3, 10));
    applyRoll(s, roll("stake", 6, 10));
    applyRoll(s, roll("placedInfuse", 3, 8));
    applyRoll(s, roll("bloodSignature", 40, 10));
    expect(s.traits.comboBreakWave).toBe(2);
    expect(s.comboWindowBonus).toBeCloseTo(-0.3);
    expect(s.traits.inheritCharges).toBe(3);
    expect(s.traits.stakeDamage).toBe(6);
    expect(s.traits.placedInfuse).toBe(3);
    expect(s.maxHp, "置き土産 8 + 血の署名 10").toBe(DEFAULT_STATS.maxHp - 8 - 10);
    expect(s.traits.lowHpSkillHaste).toBeCloseTo(0.4);
  });

  it("状態異常の付与の説明は全種類に動詞がある", () => {
    for (const kind of STATUS_KINDS) {
      const text = describeStatusProc({ kind, chance: 0.1, stacks: 1, duration: 2, potency: 0, on: "any" });
      expect(text, kind).not.toContain("undefined");
    }
  });
});
