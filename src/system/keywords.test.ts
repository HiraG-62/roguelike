import { describe, expect, it } from "vitest";
import { ELEMENTS } from "../core/element";
import { KEYWORDS, KEYWORD_DEFS, type Keyword, emptyProfile, kw, mergeProfiles, profileKeywords } from "../core/keywords";
import { createRng } from "../core/rng";
import { STATUS_KINDS, type StatusKind } from "../core/status";
import { ENEMY_COMBAT } from "../data/enemyCombat";
import { ATTR, BOON } from "../data/tuning";
import { generateItem } from "../loot/generator";
import { computeStats } from "../loot/stats";
import { CONDITION_TEXT, EFFECT_SPECS, TRIGGER_SPECS } from "../loot/triggers";
import {
  ATTR_KEYS,
  DEFAULT_STATS,
  type Equipment,
  LOOT_SLOTS,
  type PlayerStats,
  type TriggerCondition,
  type TriggerEffectKind,
  type TriggerKind,
  createEmptyEquipment,
} from "../loot/types";
import { MODIFIERS, SKILL_DEFS } from "../skills/data";
import type { SkillProfile } from "../skills/types";
import { BOONS, BOON_KEYS, type BoonTag } from "./boonDefs";
import { boonAffinityMul, equipmentTags } from "./boons";
import { KEYSTONE_NAME, KS } from "./keystones";
import {
  ELEMENT_KEYWORD,
  type KeywordHolder,
  STATUS_KEYWORDS,
  affinity,
  buildGaps,
  buildProfile,
  enemyKeywords,
  keywordCoverage,
  keywordSources,
  profileGaps,
  skillKeywords,
  statsKeywords,
} from "./keywords";
import { FLOOR_KEYWORDS, ROOM_KEYWORDS } from "./roomTypes";

// -----------------------------------------------------------------------------
// 回帰用: 共通語彙へ一般化する前の equipmentTags（system/boons.ts 2026-09-24 時点）をそのまま写したもの
// -----------------------------------------------------------------------------

const LEGACY_STATUS_TAGS: Readonly<Partial<Record<StatusKind, readonly BoonTag[]>>> = {
  burn: ["burn"],
  chill: ["chill"],
  freeze: ["chill", "freeze"],
  shock: ["shock"],
  paralyze: ["shock", "paralyze"],
  poison: ["poison"],
  bleed: ["bleed"],
  vulnerable: ["stagger", "vulnerable"],
  weaken: ["weaken"],
  fear: ["fear"],
  silence: ["silence"],
  stagger: ["stagger"],
  guarded: ["guarded"],
};

function legacyEquipmentTags(stats: Readonly<PlayerStats>): Set<BoonTag> {
  const tags = new Set<BoonTag>();
  const effects = new Set(stats.triggers.map((t) => t.effect));
  const triggers = new Set(stats.triggers.map((t) => t.trigger));
  const conditions = new Set(stats.triggers.map((t) => t.condition));
  const ks = new Set(stats.keystones);
  const d = DEFAULT_STATS;
  if (stats.burnChance > 0 || effects.has("burnNearby")) tags.add("burn");
  // 属性の変換（docs/COMBAT_DESIGN.md A-8 で追加。旧実装には無かった事実なのでここに足した）
  if (Object.values(stats.infuse).some((v) => v > 0)) tags.add("element");
  if (stats.chillChance > 0 || effects.has("freezeNearby")) tags.add("chill");
  if (stats.shockChance > 0 || effects.has("chainLightning")) tags.add("shock");
  if (stats.explodeOnKillChance > 0 || effects.has("explode") || ks.has(KS.blink)) tags.add("explode");
  if (
    stats.meleeDamageMul > d.meleeDamageMul ||
    stats.meleeDamageFlat > d.meleeDamageFlat ||
    stats.attackSpeedMul > d.attackSpeedMul ||
    triggers.has("onMeleeHit") ||
    triggers.has("everyNthMeleeHit") ||
    ks.has(KS.bladeOath)
  ) {
    tags.add("melee");
  }
  if (
    stats.rangedDamageMul > d.rangedDamageMul ||
    stats.rangedDamageFlat > d.rangedDamageFlat ||
    stats.fireRateMul > d.fireRateMul ||
    stats.projectileCount > d.projectileCount ||
    stats.pierce > d.pierce ||
    triggers.has("onShoot") ||
    ks.has(KS.pacifist)
  ) {
    tags.add("ranged");
  }
  if (
    stats.dashCharges > d.dashCharges ||
    stats.dashCooldownMul < d.dashCooldownMul ||
    stats.dashDistanceMul > d.dashDistanceMul ||
    triggers.has("onDash") ||
    ks.has(KS.blink)
  ) {
    tags.add("dash");
  }
  if (stats.justDodgeDamageMul > d.justDodgeDamageMul || stats.justDodgeWindow > d.justDodgeWindow || triggers.has("onJustDodge")) {
    tags.add("just");
  }
  if (stats.comboDamagePerStack > 0 || stats.comboWindowBonus > 0 || conditions.has("comboAbove10")) tags.add("combo");
  if (
    stats.energyGainMul > d.energyGainMul ||
    stats.burstDamageMul > d.burstDamageMul ||
    stats.burstRadiusMul > d.burstRadiusMul ||
    effects.has("energy") ||
    conditions.has("fullEnergy")
  ) {
    tags.add("energy");
  }
  if (stats.critChance > d.critChance || stats.critMul > d.critMul) tags.add("crit");
  if (stats.lifeOnHit > 0 || stats.lifeOnKill > 0 || stats.hpRegen > 0 || effects.has("heal") || ks.has(KS.vampire) || ks.has(KS.berserker)) {
    tags.add("hp");
  }
  if (triggers.has("onRoomClear") || conditions.has("roomLocked")) tags.add("room");
  if (ATTR_KEYS.some((k) => stats.attributes[k] > ATTR.base)) tags.add("attr");
  if (stats.attributes.str > ATTR.base || stats.poiseDamageMul > DEFAULT_STATS.poiseDamageMul) tags.add("stagger");
  for (const proc of stats.statusProcs) for (const tag of LEGACY_STATUS_TAGS[proc.kind] ?? []) tags.add(tag);
  for (const t of stats.triggers) {
    if (t.effect !== "inflict" || t.status === undefined) continue;
    for (const tag of LEGACY_STATUS_TAGS[t.status] ?? []) tags.add(tag);
  }
  if (
    stats.maxMana > d.maxMana ||
    stats.manaRegen > d.manaRegen ||
    stats.manaGainMul > d.manaGainMul ||
    stats.manaCostMul < d.manaCostMul
  ) {
    tags.add("mana");
  }
  return tags;
}

function sorted(tags: ReadonlySet<BoonTag>): BoonTag[] {
  return [...tags].sort();
}

/** 深度と揺らぎを散らした装備一式の stats */
function randomLoadoutStats(seed: number): PlayerStats {
  const rng = createRng(seed);
  const eq: Equipment = createEmptyEquipment();
  for (const slot of LOOT_SLOTS) {
    eq[slot] = generateItem(rng, { itemLevel: 1 + (seed % 20), foundDepth: 1 + (seed % 20), slot, rarityBoost: seed % 4, now: 0 });
  }
  return computeStats(eq);
}

const LOADOUT_SAMPLES = 150;

const TRIGGER_KINDS = Object.keys(TRIGGER_SPECS) as TriggerKind[];
const CONDITIONS = Object.keys(CONDITION_TEXT) as TriggerCondition[];
const EFFECTS = Object.keys(EFFECT_SPECS) as TriggerEffectKind[];

function holder(stats: PlayerStats, boons: KeywordHolder["boons"] = []): KeywordHolder {
  const profile: SkillProfile = { version: 1, loadout: [], stones: [] };
  return { stats, boons, boonRun: { baseStats: null }, skills: { profile, slots: [] } };
}

// -----------------------------------------------------------------------------

describe("語の型", () => {
  it("47 語（属性 7 語を含む）で、重複しない。字形も重ならない", () => {
    expect(KEYWORDS.length, "語の数").toBe(47);
    expect(new Set(KEYWORDS).size, "重複").toBe(KEYWORDS.length);
    expect(new Set(KEYWORDS.map((k) => KEYWORD_DEFS[k].glyph)).size, "字形の重複").toBe(KEYWORDS.length);
  });

  it("属性 7 種すべてに語があり、敵の弱点は「食う」、攻撃の属性は「出す」に写る", () => {
    for (const e of ELEMENTS) expect(KEYWORDS, `属性 ${e}`).toContain(ELEMENT_KEYWORD[e]);
    const golemDef = ENEMY_COMBAT.frostGolem;
    if (!golemDef) throw new Error("frostGolem が無い");
    const frostGolem = enemyKeywords(golemDef);
    expect(frostGolem.consumes, "霜ゴーレムは炎が弱点").toContain("elFire");
    expect(frostGolem.produces, "霜ゴーレムは氷属性で攻撃する").toContain("elIce");
    expect(skillKeywords(SKILL_DEFS.thunder).produces, "雷撃は雷属性").toContain("elLightning");
    expect(statsKeywords({ ...DEFAULT_STATS, infuse: { ...DEFAULT_STATS.infuse, fire: 0.4 } }).produces, "炎の変換").toContain("elFire");
  });

  it("kw / mergeProfiles は重複を除き KEYWORDS の順に並べる（決定性）", () => {
    const p = mergeProfiles(kw(["kill", "burn", "burn"]), kw(["melee"], ["kill"]));
    expect(p.produces, "出すの並び").toEqual(["melee", "burn", "kill"]);
    expect(p.consumes, "食うの並び").toEqual(["kill"]);
    expect(emptyProfile(), "空").toEqual({ produces: [], consumes: [], amplifies: [] });
  });

  it("状態異常は全種類が語に写る", () => {
    for (const kind of STATUS_KINDS) {
      expect(STATUS_KEYWORDS[kind].length, `${kind} の語`).toBeGreaterThan(0);
    }
  });
});

describe("全要素が語を持つ", () => {
  it("祝福 122 種すべてが語を 1 つ以上持つ", () => {
    for (const key of BOON_KEYS) expect(profileKeywords(BOONS[key].keywords).length, `祝福 ${key}`).toBeGreaterThan(0);
  });

  it("スキル石・刻印符すべてが明示の語を 1 つ以上持つ", () => {
    for (const def of Object.values(SKILL_DEFS)) expect(profileKeywords(def.keywords).length, `スキル ${def.key}`).toBeGreaterThan(0);
    for (const def of Object.values(MODIFIERS)) expect(profileKeywords(def.keywords).length, `刻印符 ${def.key}`).toBeGreaterThan(0);
  });

  it("敵すべてが語を 1 つ以上持つ", () => {
    for (const [key, def] of Object.entries(ENEMY_COMBAT)) {
      expect(profileKeywords(def.keywords).length, `敵 ${key}`).toBeGreaterThan(0);
    }
  });

  it("部屋の種類とフロア種別すべてが語を 1 つ以上持つ", () => {
    for (const [key, p] of Object.entries(ROOM_KEYWORDS)) expect(profileKeywords(p).length, `部屋 ${key}`).toBeGreaterThan(0);
    for (const [key, p] of Object.entries(FLOOR_KEYWORDS)) expect(profileKeywords(p).length, `フロア ${key}`).toBeGreaterThan(0);
  });

  it("全語に「出す」要素と「食う」要素が 1 つ以上ある（無い語は網の行き止まり）", () => {
    const coverage = keywordCoverage(keywordSources());
    const noProducer = coverage.filter((c) => c.produces === 0).map((c) => c.key);
    const noConsumer = coverage.filter((c) => c.consumes === 0).map((c) => c.key);
    expect(noProducer, "出す要素が無い語（どこかの要素の produces に足す）").toEqual([]);
    expect(noConsumer, "食う要素が無い語（どこかの要素の consumes に足す）").toEqual([]);
  });
});

describe("装備の語の推論", () => {
  it("基礎値の装備は語を持たない", () => {
    expect(profileKeywords(statsKeywords(DEFAULT_STATS)), "基礎値").toEqual([]);
  });

  it("性質・誓約・トリガー・proc・共鳴から語を読む", () => {
    const stats: PlayerStats = {
      ...DEFAULT_STATS,
      burnChance: 0.2,
      thorns: 5,
      keystones: [KS.blink],
      triggers: [{ trigger: "onKill", condition: "belowHalfHp", effect: "inflict", status: "poison", magnitude: 1, chance: 0.3 }],
      statusProcs: [{ kind: "bleed", chance: 0.2, stacks: 1, duration: 3, potency: 1, on: "melee", requiresCrit: true }],
      resonance: {
        kind: "dominant",
        colors: ["umbra"],
        ratios: { crimson: 0.4, azure: 0, jade: 0, gold: 0, umbra: 0.6 },
      },
    };
    const p = statsKeywords(stats);
    const has = (list: readonly Keyword[], words: readonly Keyword[]): boolean => words.every((w) => list.includes(w));
    expect(has(p.produces, ["burn", "explode", "poison", "bleed", "crimson", "umbra"]), `出す: ${p.produces.join(",")}`).toBe(true);
    expect(has(p.consumes, ["hurt", "dash", "kill", "lowHp", "melee", "crit", "umbra", "inverted"]), `食う: ${p.consumes.join(",")}`).toBe(
      true,
    );
    expect(p.amplifies.includes("dash"), "瞬歩はダッシュを強める").toBe(true);
  });

  it("スキル石は命中で付ける状態異常とマナ消費、差した刻印符の語も持つ", () => {
    const p = skillKeywords(SKILL_DEFS.thunder, ["curse"]);
    expect(p.produces.includes("shock"), "雷撃の感電").toBe(true);
    expect(p.consumes.includes("mana"), "マナ型はマナを食う").toBe(true);
    expect(p.produces.includes("vulnerable"), "刻印符 呪い の脆弱").toBe(true);
  });
});

describe("余り・飢え・相性", () => {
  it("出すだけの語は余り、食うだけの語は飢え", () => {
    const gaps = profileGaps(kw(["burn", "mana"], ["mana", "kill"]));
    expect(gaps.surplus, "余り").toEqual(["burn"]);
    expect(gaps.hunger, "飢え").toEqual(["kill"]);
  });

  it("buildGaps は装備と取得済み祝福を合わせて穴を出す", () => {
    const stats: PlayerStats = { ...DEFAULT_STATS, burnChance: 0.2 };
    expect(buildGaps(holder(stats)).surplus, "燃焼を出すだけ").toEqual(["burn"]);
    // 野火（燃焼 + 撃破を食う）を足すと燃焼は余りでなくなり、撃破が飢えになる
    const gaps = buildGaps(holder(stats, ["burnSpread"]));
    expect(gaps.surplus.includes("burn"), "燃焼は食われる").toBe(false);
    expect(gaps.hunger, "撃破が飢え").toEqual(["kill"]);
  });

  it("buildProfile は祝福を畳み込む前の stats を読む", () => {
    const h = holder({ ...DEFAULT_STATS, chillChance: 0.5 });
    h.boonRun.baseStats = { ...DEFAULT_STATS, burnChance: 0.5 };
    const p = buildProfile(h);
    expect(p.produces.includes("burn"), "baseStats の燃焼").toBe(true);
    expect(p.produces.includes("chill"), "畳み込み後の冷気は読まない").toBe(false);
  });

  it("affinity は不足を補うキーワードと余りを活かすキーワードを返す", () => {
    const build = kw(["burn"], ["kill"]);
    const a = affinity(kw(["kill"], ["burn"]), build);
    expect(a.fills, "撃破の飢えを埋める").toEqual(["kill"]);
    expect(a.feeds, "燃焼の余りを活かす").toEqual(["burn"]);
    expect(affinity(kw(["chill"]), build), "関係なし").toEqual({ fills: [], feeds: [] });
  });

  it("祝福の抽選: 飢えを埋める候補は重みが affinityWeightMul 倍", () => {
    // マナを食うだけのビルド（マナ型のスキル石だけ）で確かめる
    const build = kw([], ["mana"]);
    expect(boonAffinityMul(BOONS.springWell, build), "湧水はマナを出す").toBe(BOON.affinityWeightMul);
    expect(boonAffinityMul(BOONS.dashGun, build), "疾走射撃は関係なし").toBe(1);
  });
});

describe("equipmentTags の回帰（一般化の前後で同じ）", () => {
  it("生成した装備一式で旧実装と同じタグになる", () => {
    for (let seed = 1; seed <= LOADOUT_SAMPLES; seed++) {
      const stats = randomLoadoutStats(seed);
      expect(sorted(equipmentTags(stats)), `seed ${seed}`).toEqual(sorted(legacyEquipmentTags(stats)));
    }
  });

  it("トリガーの起点・条件・効果・付与の全種で旧実装と同じタグになる", () => {
    const base: PlayerStats = { ...DEFAULT_STATS };
    const cases: PlayerStats[] = [base];
    for (const trigger of TRIGGER_KINDS) {
      cases.push({ ...base, triggers: [{ trigger, condition: "always", effect: "damageBuff", magnitude: 1, chance: 1 }] });
    }
    for (const condition of CONDITIONS) {
      cases.push({ ...base, triggers: [{ trigger: "onKill", condition, effect: "damageBuff", magnitude: 1, chance: 1 }] });
    }
    for (const effect of EFFECTS) {
      cases.push({ ...base, triggers: [{ trigger: "onKill", condition: "always", effect, magnitude: 1, chance: 1 }] });
    }
    for (const status of STATUS_KINDS) {
      cases.push({ ...base, triggers: [{ trigger: "onKill", condition: "always", effect: "inflict", status, magnitude: 1, chance: 1 }] });
      cases.push({ ...base, statusProcs: [{ kind: status, chance: 1, stacks: 1, duration: 1, potency: 1, on: "any" }] });
    }
    for (const key of Object.keys(KEYSTONE_NAME)) cases.push({ ...base, keystones: [key] });
    cases.push({ ...base, attributes: { ...base.attributes, str: ATTR.base + 1 } });
    cases.push({ ...base, poiseDamageMul: base.poiseDamageMul + 0.1 });
    for (const [i, stats] of cases.entries()) {
      expect(sorted(equipmentTags(stats)), `ケース ${i}`).toEqual(sorted(legacyEquipmentTags(stats)));
    }
  });
});
