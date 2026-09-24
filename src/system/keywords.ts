import {
  KEYWORDS,
  type Keyword,
  type KeywordProfile,
  emptyProfile,
  kw,
  mergeProfiles,
} from "../core/keywords";
import { ELEMENTS, type Element } from "../core/element";
import type { FloorKind, RoomKind } from "../core/state";
import type { StatusKind, StatusProc } from "../core/status";
import { ENEMY_COMBAT, type EnemyCombatDef } from "../data/enemyCombat";
import { enemyDefense, enemyWeaknesses } from "../data/enemyDefense";
import { ATTR } from "../data/tuning";
import {
  ATTR_KEYS,
  DEFAULT_STATS,
  type PlayerStats,
  TRAIT_COLORS,
  type TraitColor,
  type TraitStats,
  type TriggerCondition,
  type TriggerEffectKind,
  type TriggerKind,
  type TriggeredEffect,
} from "../loot/types";
import { MODIFIERS, SKILL_ATTACK, SKILL_DEFS } from "../skills/data";
import { stoneInSlot } from "../skills/persistence";
import type { ModifierKey, SkillDef, SkillProfile } from "../skills/types";
import { BOONS, BOON_KEYS, type BoonDef, type BoonKey, type BoonTag } from "./boonDefs";
import { KS } from "./keystones";
import { FLOOR_KEYWORDS, ROOM_KEYWORDS } from "./roomTypes";

/**
 * 共通語彙（語）の推論と集計。docs/ideas/synergy-web.md 1・4 章。
 * 装備（stats）からの推論は「事実」の表 1 つで、語（KeywordProfile）と祝福タグ（BoonTag）の両方を出す。
 * 祝福の抽選が使う equipmentTags（system/boons.ts）はこの表の BoonTag 側を読む薄いラッパー。
 * UI にスコアは出さない（余り / 飢え / 埋める語を語として見せるだけ）
 */

// -----------------------------------------------------------------------------
// 状態異常 → 語
// -----------------------------------------------------------------------------

/** 属性 → 語（docs/COMBAT_DESIGN.md A-8） */
export const ELEMENT_KEYWORD: Readonly<Record<Element, Keyword>> = {
  none: "elNone",
  fire: "elFire",
  ice: "elIce",
  lightning: "elLightning",
  poison: "elPoison",
  dark: "elDark",
  light: "elLight",
};

/** 状態異常の種類 → 語。昇華は元の状態の語、良い状態は近い動詞の語へ寄せる */
export const STATUS_KEYWORDS: Readonly<Record<StatusKind, readonly Keyword[]>> = {
  burn: ["burn"],
  chill: ["chill"],
  freeze: ["chill"],
  shock: ["shock"],
  paralyze: ["shock"],
  poison: ["poison"],
  bleed: ["bleed"],
  vulnerable: ["vulnerable"],
  weaken: ["weaken"],
  fear: ["fear"],
  silence: ["silence"],
  stagger: ["stagger"],
  guarded: ["stagger"],
  wet: ["reaction"],
  oiled: ["burn", "reaction"],
  corrode: ["stagger"],
  brand: ["explode"],
  broken: ["stagger"],
  doom: ["vulnerable"],
  siphon: ["mana"],
  hue: ["reaction"],
  scorch: ["burn"],
  blaze: ["burn"],
  venom: ["poison"],
  hemorrhage: ["bleed"],
  encase: ["chill"],
  exposed: ["vulnerable"],
  enfeeble: ["weaken"],
  soaked: ["chill", "reaction"],
  haste: ["dash"],
  harden: ["ward"],
  wrath: ["hurt", "stagger"],
  fury: ["stagger"],
  charged: ["shock"],
};

/**
 * 状態異常の種類 → 祝福タグ（旧 system/boons.ts の STATUS_TAGS をそのまま移した）。
 * 脆弱は崩し（stagger）の系統にも数える。2026-09-24 追加の種類はタグを持たない（抽選の挙動を変えない）
 */
export const STATUS_BOON_TAGS: Readonly<Partial<Record<StatusKind, readonly BoonTag[]>>> = {
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

function statusProduces(kind: StatusKind): KeywordProfile {
  return kw(STATUS_KEYWORDS[kind]);
}

// -----------------------------------------------------------------------------
// 装備（stats）の事実表
// -----------------------------------------------------------------------------

/** 装備から読める 1 つの事実。tags は祝福の抽選用（旧 equipmentTags と同じ条件で付く）、keywords は語 */
interface StatFact {
  tags: readonly BoonTag[];
  keywords: KeywordProfile;
}

interface StatRule extends StatFact {
  /** 出典（テストと報告用の名前） */
  id: string;
  test(stats: Readonly<PlayerStats>): boolean;
}

type NumericStat = { [K in keyof PlayerStats]: PlayerStats[K] extends number ? K : never }[keyof PlayerStats];
type NumericTrait = { [K in keyof TraitStats]: TraitStats[K] extends number ? K : never }[keyof TraitStats];

const D = DEFAULT_STATS;

/** 基礎値より大きい（良い）ときに成立 */
function above(id: NumericStat, tags: readonly BoonTag[], keywords: KeywordProfile): StatRule {
  return { id, tags, keywords, test: (s) => s[id] > D[id] };
}

/** 基礎値より小さい（倍率が下がるほど良い軸）ときに成立 */
function below(id: NumericStat, tags: readonly BoonTag[], keywords: KeywordProfile): StatRule {
  return { id, tags, keywords, test: (s) => s[id] < D[id] };
}

/** 性質のルール変更（TraitStats）が 0 より大きいときに成立。祝福タグは持たない */
function trait(id: NumericTrait, keywords: KeywordProfile): StatRule {
  return { id: `traits.${id}`, tags: [], keywords, test: (s) => s.traits[id] > 0 };
}

const STAT_RULES: readonly StatRule[] = [
  // ---- 旧 equipmentTags と同じ条件（tags を持つもの） ----
  above("burnChance", ["burn"], kw(["burn"])),
  above("chillChance", ["chill"], kw(["chill"])),
  above("shockChance", ["shock"], kw(["shock"])),
  above("explodeOnKillChance", ["explode"], kw(["explode"], ["kill"])),
  above("meleeDamageMul", ["melee"], kw([], [], ["melee"])),
  above("meleeDamageFlat", ["melee"], kw([], [], ["melee"])),
  above("attackSpeedMul", ["melee"], kw([], [], ["melee"])),
  above("rangedDamageMul", ["ranged"], kw([], [], ["ranged"])),
  above("rangedDamageFlat", ["ranged"], kw([], [], ["ranged"])),
  above("fireRateMul", ["ranged"], kw([], [], ["ranged"])),
  above("projectileCount", ["ranged"], kw([], [], ["ranged", "bullet"])),
  above("pierce", ["ranged"], kw([], [], ["ranged", "bullet"])),
  above("dashCharges", ["dash"], kw([], [], ["dash"])),
  below("dashCooldownMul", ["dash"], kw([], [], ["dash"])),
  above("dashDistanceMul", ["dash"], kw([], [], ["dash"])),
  above("justDodgeDamageMul", ["just"], kw([], [], ["just"])),
  above("justDodgeWindow", ["just"], kw([], [], ["just"])),
  above("comboDamagePerStack", ["combo"], kw([], ["combo"])),
  above("comboWindowBonus", ["combo"], kw([], [], ["combo"])),
  above("energyGainMul", ["energy"], kw([], [], ["energy"])),
  above("burstDamageMul", ["energy"], kw([], [], ["energy"])),
  above("burstRadiusMul", ["energy"], kw([], [], ["energy"])),
  above("critChance", ["crit"], kw(["crit"])),
  above("critMul", ["crit"], kw([], [], ["crit"])),
  above("lifeOnHit", ["hp"], kw(["heal"])),
  above("lifeOnKill", ["hp"], kw(["heal"], ["kill"])),
  above("hpRegen", ["hp"], kw(["heal"])),
  above("maxMana", ["mana"], kw([], [], ["mana"])),
  above("manaRegen", ["mana"], kw([], [], ["mana"])),
  above("manaGainMul", ["mana"], kw([], [], ["mana"])),
  below("manaCostMul", ["mana"], kw([], [], ["mana"])),
  {
    id: "attributes",
    tags: ["attr"],
    keywords: emptyProfile(),
    test: (s) => ATTR_KEYS.some((k) => s.attributes[k] > ATTR.base),
  },
  { id: "attributes.str", tags: ["stagger"], keywords: kw([], [], ["stagger", "melee"]), test: (s) => s.attributes.str > ATTR.base },
  above("poiseDamageMul", ["stagger"], kw([], [], ["stagger"])),
  // ---- 語だけ（祝福タグは付けない） ----
  above("thorns", [], kw([], ["hurt"])),
  below("damageTakenMul", [], kw([], [], ["hurt"])),
  above("armor", [], kw([], [], ["hurt"])),
  above("knockbackMul", [], kw(["wall"])),
  above("damageVsStaggeredMul", [], kw([], ["stagger"])),
  above("meleeReachMul", [], kw([], [], ["melee"])),
  above("projectileSpeedMul", [], kw([], [], ["bullet"])),
  above("burnDps", [], kw([], [], ["burn"])),
  above("chillSlow", [], kw([], [], ["chill"])),
  above("shockDamage", [], kw([], [], ["shock"])),
  above("explodeDamage", [], kw([], [], ["explode"])),
  above("manaOnKill", [], kw(["mana"], ["kill"])),
  above("bulletCut", [], kw([], ["bullet"])),
  trait("manaOnStagger", kw(["mana"], ["stagger"])),
  trait("lowManaGainMul", kw([], [], ["mana"])),
  trait("fullManaSkillMul", kw([], ["mana"])),
  trait("lowManaSkillMul", kw([], ["mana"])),
  trait("manaShieldCost", kw(["ward"], ["mana"])),
  trait("silencedKillMana", kw(["mana"], ["silence", "kill"])),
  trait("lastKillManaRatio", kw(["mana"], ["clear"])),
  trait("manaOverflowToEnergy", kw(["energy"], ["mana"])),
  trait("damagePerStatusKind", kw([], ["reaction"])),
  trait("damagePerSelfStatus", kw([], ["hurt"])),
  trait("windupDamageMul", kw([], ["counter"])),
  trait("guardedDamageMul", kw([], ["stagger"])),
  trait("bossDamageMul", kw([], ["elite"])),
  trait("lockedDamageMul", kw([], ["clear"])),
  trait("darkRangedMul", kw([], [], ["ranged", "still"])),
  trait("fearPoiseMul", kw([], ["fear"], ["stagger"])),
  trait("silencedPoiseMul", kw([], ["silence"], ["stagger"])),
  trait("vulnerablePoiseMul", kw([], ["vulnerable"], ["stagger"])),
  trait("guardedPoiseMul", kw([], ["stagger"], ["stagger"])),
  trait("wedgePoiseMul", kw([], ["stagger"], ["stagger"])),
  trait("rangedPoiseMul", kw([], ["ranged"], ["stagger"])),
  trait("critPoiseMul", kw([], ["crit"], ["stagger"])),
  trait("guardPierce", kw([], ["stagger"])),
  trait("staggerQuake", kw(["stagger", "area"], ["stagger"])),
  trait("healOnStagger", kw(["heal"], ["stagger"])),
  trait("weakenedGuard", kw([], ["weaken"])),
  trait("lastKillClearsBullets", kw([], ["clear", "bullet"])),
  trait("lastKillEnergy", kw(["energy"], ["clear"])),
  trait("comboBreakWave", kw(["area"], ["combo"])),
  trait("inheritCharges", kw([], ["kill"])),
  trait("stakeDamage", kw([], ["bullet", "melee"])),
  trait("placedInfuse", kw([], ["placed", "melee"])),
  trait("placedExtend", kw([], ["stagger"], ["placed"])),
  trait("lowHpSkillHaste", kw([], ["lowHp"])),
  trait("boonEchoCrimson", kw([], ["crimson"])),
  trait("boonEchoAzure", kw([], ["azure"])),
  trait("boonEchoJade", kw([], ["jade"])),
  trait("boonEchoGold", kw([], ["gold"])),
  trait("boonEchoUmbra", kw([], ["umbra"])),
  trait("gearInverted", kw(["inverted"])),
  // ---- 属性（docs/COMBAT_DESIGN.md A-8）。変換で通常攻撃がその属性を帯びる / 無の刻印でスキルが無属性に戻る ----
  ...ELEMENTS.filter((e) => e !== "none").map(
    (e): StatRule => ({ id: `infuse.${e}`, tags: ["element"], keywords: kw([ELEMENT_KEYWORD[e]]), test: (s) => s.infuse[e] > 0 }),
  ),
  { id: "skillNeutral", tags: [], keywords: kw(["elNone"]), test: (s) => s.skillNeutral > 0 },
];

/** トリガーの起点 → 食う語。祝福タグは旧 equipmentTags が見ていたものだけ */
const TRIGGER_FACTS: Readonly<Record<TriggerKind, StatFact>> = {
  onMeleeHit: { tags: ["melee"], keywords: kw([], ["melee"]) },
  onShoot: { tags: ["ranged"], keywords: kw([], ["ranged"]) },
  onKill: { tags: [], keywords: kw([], ["kill"]) },
  onJustDodge: { tags: ["just"], keywords: kw([], ["just"]) },
  onDash: { tags: ["dash"], keywords: kw([], ["dash"]) },
  onHurt: { tags: [], keywords: kw([], ["hurt"]) },
  onRoomClear: { tags: ["room"], keywords: kw([], ["clear"]) },
  everyNthMeleeHit: { tags: ["melee"], keywords: kw([], ["melee", "combo"]) },
  onStagger: { tags: [], keywords: kw([], ["stagger"]) },
  onCounter: { tags: [], keywords: kw([], ["counter"]) },
};

const TRIGGER_CONDITION_FACTS: Readonly<Record<TriggerCondition, StatFact>> = {
  always: { tags: [], keywords: emptyProfile() },
  aboveHalfHp: { tags: [], keywords: emptyProfile() },
  belowHalfHp: { tags: [], keywords: kw([], ["lowHp"]) },
  comboAbove10: { tags: ["combo"], keywords: kw([], ["combo"]) },
  roomLocked: { tags: ["room"], keywords: kw([], ["clear"]) },
  fullEnergy: { tags: ["energy"], keywords: kw([], ["energy"]) },
  manaFull: { tags: [], keywords: kw([], ["mana"]) },
  manaLow: { tags: [], keywords: kw([], ["mana"]) },
  selfAfflicted: { tags: [], keywords: kw([], ["hurt"]) },
  targetInWindup: { tags: [], keywords: kw([], ["counter"]) },
  targetGuarded: { tags: [], keywords: kw([], ["stagger"]) },
  targetMultiStatus: { tags: [], keywords: kw([], ["reaction"]) },
  targetElite: { tags: [], keywords: kw([], ["elite"]) },
};

/** トリガーの効果 → 出す語。inflict の種類は status から別に読む */
const TRIGGER_EFFECT_FACTS: Readonly<Record<TriggerEffectKind, StatFact>> = {
  shockwave: { tags: [], keywords: kw(["area", "wall"]) },
  spawnBullets: { tags: [], keywords: kw(["bullet"]) },
  chainLightning: { tags: ["shock"], keywords: kw(["shock"]) },
  burnNearby: { tags: ["burn"], keywords: kw(["burn"]) },
  freezeNearby: { tags: ["chill"], keywords: kw(["chill"]) },
  explode: { tags: ["explode"], keywords: kw(["explode"]) },
  heal: { tags: ["hp"], keywords: kw(["heal"]) },
  damageBuff: { tags: [], keywords: emptyProfile() },
  speedBuff: { tags: [], keywords: emptyProfile() },
  energy: { tags: ["energy"], keywords: kw(["energy"]) },
  invuln: { tags: [], keywords: kw(["ward"]) },
  restoreMana: { tags: [], keywords: kw(["mana"]) },
  addPoise: { tags: [], keywords: kw(["stagger"]) },
  inflict: { tags: [], keywords: emptyProfile() },
  cleanse: { tags: [], keywords: kw(["ward"]) },
  extendStatus: { tags: [], keywords: kw([], [], ["reaction"]) },
  skillHaste: { tags: [], keywords: kw([], [], ["mana"]) },
  volley: { tags: [], keywords: kw(["ranged", "bullet"]) },
  healMissing: { tags: [], keywords: kw(["heal"], ["lowHp"]) },
};

/**
 * 誓約 → 語。どの誓約も冥の性質なので umbra を出す（keystoneFact が足す）。
 * 祝福タグは旧 equipmentTags が見ていた 5 つ（瞬歩・不殺・剣の誓い・吸血・狂戦士）だけ
 */
const KEYSTONE_FACTS: Readonly<Record<string, StatFact>> = {
  ks_glassCannon: { tags: [], keywords: kw(["lowHp"], [], ["melee", "ranged"]) },
  [KS.berserker]: { tags: ["hp"], keywords: kw([], ["lowHp"]) },
  [KS.blink]: { tags: ["explode", "dash"], keywords: kw(["explode"], ["dash"], ["dash"]) },
  [KS.pacifist]: { tags: ["ranged"], keywords: kw([], [], ["ranged"]) },
  [KS.bladeOath]: { tags: ["melee"], keywords: kw([], [], ["melee"]) },
  [KS.juggernaut]: { tags: [], keywords: kw([], ["hurt"], ["hurt"]) },
  [KS.gambler]: { tags: [], keywords: kw(["crit"]) },
  [KS.vampire]: { tags: ["hp"], keywords: kw(["heal"], ["melee"]) },
  [KS.overclock]: { tags: [], keywords: kw(["lowHp"], [], ["melee", "ranged"]) },
  ks_windWalker: { tags: [], keywords: kw([], [], ["dash"]) },
  [KS.overdraw]: { tags: [], keywords: kw(["lowHp"], ["mana"]) },
  [KS.silentVow]: { tags: [], keywords: kw(["mana"], [], ["still"]) },
  [KS.thirst]: { tags: [], keywords: kw(["mana"], ["melee"]) },
  [KS.pure]: { tags: [], keywords: kw(["ward"]) },
  [KS.blight]: { tags: [], keywords: kw(["hurt"], [], ["reaction"]) },
  [KS.contagion]: { tags: [], keywords: kw([], ["kill"], ["reaction"]) },
  [KS.wedgeOath]: { tags: [], keywords: kw([], [], ["stagger"]) },
  [KS.unshaken]: { tags: [], keywords: kw([], ["stagger"]) },
  [KS.chokehold]: { tags: [], keywords: kw([], ["stagger"]) },
  [KS.readOath]: { tags: [], keywords: kw([], ["counter"]) },
  [KS.backwater]: { tags: [], keywords: kw(["heal"], ["clear"]) },
  [KS.reaperOath]: { tags: [], keywords: kw(["elite"]) },
  [KS.chant]: { tags: [], keywords: kw(["mana"], ["melee"]) },
  [KS.monochrome]: { tags: [], keywords: kw([], [], ["crimson", "azure", "jade", "gold", "umbra"]) },
  [KS.colorless]: { tags: [], keywords: emptyProfile() },
  [KS.mirror]: { tags: [], keywords: kw([], [], ["crimson", "azure", "jade", "gold"]) },
  [KS.discipline]: { tags: [], keywords: emptyProfile() },
  [KS.oblivion]: { tags: [], keywords: emptyProfile() },
};

const KEYSTONE_UMBRA: KeywordProfile = kw(["umbra"]);

function keystoneFact(key: string): StatFact {
  const fact = KEYSTONE_FACTS[key];
  if (!fact) return { tags: [], keywords: KEYSTONE_UMBRA };
  return { tags: fact.tags, keywords: mergeProfiles(fact.keywords, KEYSTONE_UMBRA) };
}

/** proc の判定対象 → 食う語（会心時のみなら会心も食う） */
const PROC_ON_KEYWORDS: Readonly<Record<StatusProc["on"], readonly Keyword[]>> = {
  melee: ["melee"],
  ranged: ["ranged"],
  skill: ["mana"],
  any: [],
};

function procFact(proc: Readonly<StatusProc>): StatFact {
  const consumes: Keyword[] = [...PROC_ON_KEYWORDS[proc.on]];
  if (proc.requiresCrit) consumes.push("crit");
  return { tags: STATUS_BOON_TAGS[proc.kind] ?? [], keywords: kw(STATUS_KEYWORDS[proc.kind], consumes) };
}

function triggerFacts(t: Readonly<TriggeredEffect>): StatFact[] {
  const facts = [TRIGGER_FACTS[t.trigger], TRIGGER_CONDITION_FACTS[t.condition], TRIGGER_EFFECT_FACTS[t.effect]];
  if (t.effect === "inflict" && t.status !== undefined) {
    facts.push({ tags: STATUS_BOON_TAGS[t.status] ?? [], keywords: statusProduces(t.status) });
  }
  return facts;
}

/** 色 → 語（性質の色と語の key は同じ名前） */
const COLOR_KEYWORD: Readonly<Record<TraitColor, Keyword>> = {
  crimson: "crimson",
  azure: "azure",
  jade: "jade",
  gold: "gold",
  umbra: "umbra",
};

/** 配合に入っている色は「出す」、共鳴が成立した色は「食う」（虚極は反転も食う） */
function resonanceFacts(stats: Readonly<PlayerStats>): StatFact[] {
  const res = stats.resonance;
  const facts: StatFact[] = [];
  for (const c of TRAIT_COLORS) {
    if (res.ratios[c] > 0) facts.push({ tags: [], keywords: kw([COLOR_KEYWORD[c]]) });
  }
  for (const c of res.colors) facts.push({ tags: [], keywords: resonanceConsumes(c) });
  return facts;
}

function resonanceConsumes(color: TraitColor): KeywordProfile {
  return color === "umbra" ? kw([], ["umbra", "inverted"]) : kw([], [COLOR_KEYWORD[color]]);
}

/** 装備から成立する事実をすべて集める（表の順 → トリガー → 誓約 → proc → 共鳴。順は結果に影響しない） */
function statFacts(stats: Readonly<PlayerStats>): StatFact[] {
  const facts: StatFact[] = STAT_RULES.filter((r) => r.test(stats));
  for (const t of stats.triggers) facts.push(...triggerFacts(t));
  for (const key of stats.keystones) facts.push(keystoneFact(key));
  for (const proc of stats.statusProcs) facts.push(procFact(proc));
  facts.push(...resonanceFacts(stats));
  return facts;
}

/** 装備（stats）の語。性質・変換・誓約・トリガー・共鳴から推論する */
export function statsKeywords(stats: Readonly<PlayerStats>): KeywordProfile {
  return mergeProfiles(...statFacts(stats).map((f) => f.keywords));
}

/** 装備（stats）の祝福タグ。system/boons.ts の equipmentTags がこれを返す */
export function statsBoonTags(stats: Readonly<PlayerStats>): Set<BoonTag> {
  const tags = new Set<BoonTag>();
  for (const f of statFacts(stats)) for (const t of f.tags) tags.add(t);
  return tags;
}

// -----------------------------------------------------------------------------
// 要素ごとの語
// -----------------------------------------------------------------------------

const MANA_SPENDER: KeywordProfile = kw([], ["mana"]);

/** スキル石の語。明示の語 + 命中で付ける状態異常 + マナ型ならマナを食う + 差した刻印符の語 */
export function skillKeywords(def: Readonly<SkillDef>, modifiers: readonly ModifierKey[] = []): KeywordProfile {
  const parts: KeywordProfile[] = [def.keywords];
  for (const a of def.applies ?? []) parts.push(statusProduces(a.kind));
  if (def.resource === "mana") parts.push(MANA_SPENDER);
  const atk = SKILL_ATTACK[def.key];
  // 無属性は大多数なので語にしない（無属性の語は無の刻印が出す）
  if (atk && atk.element !== "none") parts.push(kw([ELEMENT_KEYWORD[atk.element]]));
  for (const m of modifiers) parts.push(MODIFIERS[m].keywords);
  return mergeProfiles(...parts);
}

export function boonKeywords(def: Readonly<BoonDef>): KeywordProfile {
  return def.keywords;
}

/** 敵の語。明示の語 + 使ってくる状態異常 + 攻撃の属性（出す）と弱点（食う。ボスはどの段階の弱点も） */
export function enemyKeywords(def: Readonly<EnemyCombatDef>): KeywordProfile {
  return mergeProfiles(def.keywords, ...def.inflicts.map((i) => statusProduces(i.kind)), enemyElementKeywords(def));
}

function enemyElementKeywords(def: Readonly<EnemyCombatDef>): KeywordProfile {
  const guard = def.guard ?? enemyDefense("");
  const produces: Keyword[] = guard.attack.element === "none" ? [] : [ELEMENT_KEYWORD[guard.attack.element]];
  const stages = [0, ...(guard.stages ?? []).map((_, i) => i + 1)];
  const weak = stages.flatMap((stage) => enemyWeaknesses(guard, stage));
  return kw(produces, weak.map((e) => ELEMENT_KEYWORD[e]));
}

export function roomKeywords(kind: RoomKind): KeywordProfile {
  return ROOM_KEYWORDS[kind];
}

export function floorKeywords(kind: FloorKind): KeywordProfile {
  return FLOOR_KEYWORDS[kind];
}

// -----------------------------------------------------------------------------
// ビルドの合成と穴
// -----------------------------------------------------------------------------

/** ビルドの語に要る state の部分（テストで GameState 全体を作らずに済むよう絞る） */
export interface KeywordHolder {
  stats: Readonly<PlayerStats>;
  boons: readonly BoonKey[];
  boonRun: { baseStats: Readonly<PlayerStats> | null };
  skills: { profile: SkillProfile; slots: readonly { modifiers: readonly ModifierKey[] }[] };
}

/** 今のビルド = 装備（祝福を畳み込む前の stats）+ 装着スキル石（とそのスロットの刻印符）+ 取得済み祝福 */
export function buildProfile(state: Readonly<KeywordHolder>): KeywordProfile {
  const parts: KeywordProfile[] = [statsKeywords(state.boonRun.baseStats ?? state.stats)];
  const rs = state.skills;
  for (let i = 0; i < rs.slots.length; i++) {
    const stone = stoneInSlot(rs.profile, i);
    if (!stone) continue;
    parts.push(skillKeywords(SKILL_DEFS[stone.skillKey], rs.slots[i]?.modifiers ?? []));
  }
  for (const key of state.boons) parts.push(BOONS[key].keywords);
  return mergeProfiles(...parts);
}

export interface KeywordGaps {
  /** 余り: 出しているのに誰も食わない語 */
  surplus: Keyword[];
  /** 飢え: 食うのに誰も出さない語 */
  hunger: Keyword[];
}

export function profileGaps(p: Readonly<KeywordProfile>): KeywordGaps {
  const produced = new Set(p.produces);
  const consumed = new Set(p.consumes);
  return {
    surplus: KEYWORDS.filter((k) => produced.has(k) && !consumed.has(k)),
    hunger: KEYWORDS.filter((k) => consumed.has(k) && !produced.has(k)),
  };
}

export function buildGaps(state: Readonly<KeywordHolder>): KeywordGaps {
  return profileGaps(buildProfile(state));
}

export interface KeywordAffinity {
  /** 候補が出し、今のビルドが飢えている語（穴を埋める） */
  fills: Keyword[];
  /** 候補が食い、今のビルドが余らせている語（流れを太くする） */
  feeds: Keyword[];
}

/** 候補（祝福・遺物・スキル石）が今のビルドとどう噛むか。スコアにはせず語の列で返す */
export function affinity(candidate: Readonly<KeywordProfile>, build: Readonly<KeywordProfile>): KeywordAffinity {
  const gaps = profileGaps(build);
  const hunger = new Set(gaps.hunger);
  const surplus = new Set(gaps.surplus);
  return {
    fills: candidate.produces.filter((k) => hunger.has(k)),
    feeds: candidate.consumes.filter((k) => surplus.has(k)),
  };
}

// -----------------------------------------------------------------------------
// 全要素の一覧（網の検査・図鑑・UI 用）
// -----------------------------------------------------------------------------

export type KeywordSourceKind = "equipment" | "boon" | "skill" | "modifier" | "enemy" | "room" | "floor";

export interface KeywordSource {
  kind: KeywordSourceKind;
  key: string;
  keywords: KeywordProfile;
}

/** 装備側の事実を静的に列挙する（stats を作らずに、どの性質の形がどの語に関わるかを見る） */
function equipmentSources(): KeywordSource[] {
  const src = (key: string, keywords: KeywordProfile): KeywordSource => ({ kind: "equipment", key, keywords });
  const list: KeywordSource[] = STAT_RULES.map((r) => src(r.id, r.keywords));
  for (const [k, f] of Object.entries(TRIGGER_FACTS)) list.push(src(`trigger:${k}`, f.keywords));
  for (const [k, f] of Object.entries(TRIGGER_CONDITION_FACTS)) list.push(src(`condition:${k}`, f.keywords));
  for (const [k, f] of Object.entries(TRIGGER_EFFECT_FACTS)) list.push(src(`effect:${k}`, f.keywords));
  for (const k of Object.keys(KEYSTONE_FACTS)) list.push(src(`keystone:${k}`, keystoneFact(k).keywords));
  for (const [k, words] of Object.entries(STATUS_KEYWORDS)) list.push(src(`proc:${k}`, kw(words)));
  for (const c of TRAIT_COLORS) {
    list.push(src(`color:${c}`, kw([COLOR_KEYWORD[c]])));
    list.push(src(`resonance:${c}`, resonanceConsumes(c)));
  }
  return list;
}

export function keywordSources(): KeywordSource[] {
  const list = equipmentSources();
  for (const k of BOON_KEYS) list.push({ kind: "boon", key: k, keywords: BOONS[k].keywords });
  for (const def of Object.values(SKILL_DEFS)) list.push({ kind: "skill", key: def.key, keywords: skillKeywords(def) });
  for (const def of Object.values(MODIFIERS)) list.push({ kind: "modifier", key: def.key, keywords: def.keywords });
  for (const [k, def] of Object.entries(ENEMY_COMBAT)) list.push({ kind: "enemy", key: k, keywords: enemyKeywords(def) });
  for (const [k, p] of Object.entries(ROOM_KEYWORDS)) list.push({ kind: "room", key: k, keywords: p });
  for (const [k, p] of Object.entries(FLOOR_KEYWORDS)) list.push({ kind: "floor", key: k, keywords: p });
  return list;
}

/** 語ごとに「出す / 食う / 強める」要素の数を数える（KEYWORDS 順） */
export function keywordCoverage(sources: readonly KeywordSource[]): { key: Keyword; produces: number; consumes: number; amplifies: number }[] {
  return KEYWORDS.map((key) => ({
    key,
    produces: sources.filter((s) => s.keywords.produces.includes(key)).length,
    consumes: sources.filter((s) => s.keywords.consumes.includes(key)).length,
    amplifies: sources.filter((s) => s.keywords.amplifies.includes(key)).length,
  }));
}

