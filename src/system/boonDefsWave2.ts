/**
 * 祝福の第 2 弾（データのみ）。Wave 2〜3 で入った仕組み（地形・新しい状態異常・反応・武器種・射撃の型・属性・ジョブ・
 * 交戦中・巣窟・徘徊・分岐路）を前提にした祝福。効果は可能な限り統一ルール文法（BoonDef.rules）で書き、
 * フックが要るもの（巣窟の主・狩場の王・織り交ぜ・一念・満ち溢れ）だけ system/boonRules.ts に置く。
 * boonDefs.ts が BOON_KEYS / BOONS に混ぜる（ここは型だけを boonDefs.ts から読む。実行時の循環を作らない）
 */

import type { EventKind, EventSource } from "../core/events";
import { kw } from "../core/keywords";
import { type Rule, type RuleCondition, type RuleEffect, SCOPE_ANY, ruleId } from "../core/rules";
import type { FloorKind } from "../core/state";
import type { TerrainKind } from "../core/terrain";
import type { MovesetKey } from "../data/weapons";
import { BOON, STATUS } from "../data/tuning";
import type { BoonDef } from "./boonDefs";

export const BOON_KEYS_WAVE2 = [
  // ---- 系譜: 大地（地形） ----
  "leyLine",
  "footBreak",
  "oilSpill",
  "earthWrath",
  // ---- 系譜: 刃鳴（武器種の連撃） ----
  "bladeHum",
  "layeredEdge",
  "chargeRing",
  "hundredBlades",
  // ---- 武器種 ----
  "rockStance",
  "twinShadow",
  "spearPierce",
  "scytheReap",
  "fistsHeat",
  "whipThreat",
  "cleaverSplit",
  "staffRing",
  "wandLamp",
  // ---- 射撃の型 ----
  "oilMine",
  "chargeRecoil",
  "venomBee",
  "pebbleRain",
  // ---- 属性 ----
  "weakStrike",
  "resistBreak",
  "oilSlash",
  "elementTorrent",
  "darkFeast",
  "lightPierce",
  "waterThunder",
  // ---- 地形 ----
  "iceSkate",
  "fieldBurn",
  "waterRunner",
  "frozenWater",
  // ---- ジョブ ----
  "favoredPride",
  "namelessPride",
  "otherStyle",
  // ---- 部屋・交戦中・巣窟・徘徊・分岐路 ----
  "hordeLord",
  "hordeEater",
  "roamHunt",
  "strayMark",
  "wayfarer",
  "engageSpark",
  // ---- 反応 ----
  "reactionEmber",
  "steamVeil",
  // ---- 気力・スキル（スロット別のコスト） ----
  "weave",
  "overflowCup",
  // ---- 呪い ----
  "bloodSoil",
  "singleMind",
  "scorchBlade",
  "madBloom",
  "strayBounty",
  "heavyOath",
  "drenched",
  // ---- 結び ----
  "oilBlast",
  "iceDance",
  "thunderRain",
  "groundRend",
  "huntLord",
  "weakChain",
] as const;

export type BoonKeyWave2 = (typeof BOON_KEYS_WAVE2)[number];

// -----------------------------------------------------------------------------
// Rule の組み立て（確定発動。ICD は BOON.ruleMinIcd 以上。語ごとの回数上限は resolveRules が掛ける）
// -----------------------------------------------------------------------------

interface RuleSpec {
  when: EventKind;
  if?: readonly RuleCondition[];
  then: RuleEffect;
  icd?: number;
}

const ALWAYS = 1;

function rulesOf(key: BoonKeyWave2, specs: readonly RuleSpec[]): Rule[] {
  const owner: EventSource = { kind: "boon", key };
  return specs.map((s, i) => ({
    id: ruleId(owner, i),
    when: s.when,
    if: s.if ?? [],
    then: s.then,
    chance: ALWAYS,
    icd: Math.max(BOON.ruleMinIcd, s.icd ?? 0),
    scope: SCOPE_ANY,
    owner,
  }));
}

/**
 * 旧フック（boonRules.ts）から移した祝福の Rule（boonDefs.ts の directRules と同じ形。ここから boonDefs.ts の値は読めない）。
 * フックと数値・回数を揃えるため確率 1・ICD 0・direct（連鎖に数えない）
 */
function directRulesOf(key: BoonKeyWave2, specs: readonly RuleSpec[]): Rule[] {
  const owner: EventSource = { kind: "boon", key };
  return specs.map((s, i) => ({
    id: ruleId(owner, i),
    when: s.when,
    if: s.if ?? [],
    then: s.then,
    chance: ALWAYS,
    icd: s.icd ?? 0,
    scope: SCOPE_ANY,
    owner,
    direct: true,
  }));
}

/** 強さを持たない状態異常（脆弱・恐怖）の magnitude */
const NO_AMOUNT = 0;

/** 波で湧く部屋（巣窟・試練・闘技場。狩場の王の制圧の条件） */
const WAVE_ROOM: RuleCondition = { kind: "eventTagIn", tags: ["horde", "challenge", "arena"] };

const FINISHER: RuleCondition = { kind: "finisher" };
const BRANCH: RuleCondition = { kind: "branchSwing" };
const BY_PLAYER: RuleCondition = { kind: "actor", actor: "player" };
const FAVORED: RuleCondition = { kind: "favoredWeapon" };
const ROAMER: RuleCondition = { kind: "targetRoamer" };

function weapon(...movesets: MovesetKey[]): RuleCondition {
  return { kind: "moveset", movesets };
}

function targetOn(terrain: TerrainKind | "any"): RuleCondition {
  return { kind: "targetOnTerrain", terrain };
}

function selfOn(terrain: TerrainKind | "any"): RuleCondition {
  return { kind: "selfOnTerrain", terrain };
}

function tag(value: string): RuleCondition {
  return { kind: "eventTag", tag: value };
}

/** バイオームの階（分岐路の行き先になる種類） */
const BIOME_FLOORS: readonly FloorKind[] = ["forge", "ossuary", "swamp", "glacier", "mine", "meadow"];

// -----------------------------------------------------------------------------
// 定義
// -----------------------------------------------------------------------------

export const BOONS_WAVE2: Readonly<Record<BoonKeyWave2, BoonDef>> = {
  // ---------------------------------------------------------------------------
  // 系譜: 大地（地形）。踏む → 敵の足元を崩す → 地形を撒く → 地形を広げる
  // ---------------------------------------------------------------------------
  leyLine: {
    key: "leyLine",
    name: "地脈",
    desc: `地形に踏み込むたび気力+${BOON.leyLineMana}。`,
    icon: "脈",
    rarity: "common",
    tags: ["mana", "terrain"],
    gives: ["mana"],
    keywords: kw(["mana"], ["placed"]),
    cursed: false,
    lineage: "earth",
    rules: rulesOf("leyLine", [{ when: "onTerrainEnter", then: { kind: "restoreMana", magnitude: BOON.leyLineMana }, icd: BOON.leyLineIcd }]),
  },
  footBreak: {
    key: "footBreak",
    name: "足場崩し",
    desc: `地形の上に立つ敵への近接は怯み値+${BOON.footBreakPoise}。`,
    icon: "場",
    rarity: "common",
    tags: ["melee", "stagger", "terrain"],
    gives: ["stagger"],
    keywords: kw(["stagger"], ["melee", "placed"]),
    cursed: false,
    lineage: "earth",
    after: "leyLine",
    rules: rulesOf("footBreak", [{ when: "onMeleeHit", if: [targetOn("any")], then: { kind: "addPoise", magnitude: BOON.footBreakPoise } }]),
  },
  oilSpill: {
    key: "oilSpill",
    name: "油撒き",
    desc: `終撃が当たると敵の足元に油が広がる（${BOON.oilSpillTime}秒）。油の上にいると燃えやすい。`,
    icon: "油",
    rarity: "rare",
    tags: ["melee", "terrain", "burn"],
    gives: ["terrain"],
    keywords: kw(["placed"], ["finisher"], ["burn"]),
    cursed: false,
    lineage: "earth",
    after: "footBreak",
    rules: rulesOf("oilSpill", [
      {
        when: "onMeleeHit",
        if: [FINISHER],
        then: { kind: "placeTerrain", terrain: "oil", magnitude: 0, radius: BOON.oilSpillRadius, duration: BOON.oilSpillTime },
        icd: BOON.oilSpillIcd,
      },
    ]),
  },
  earthWrath: {
    key: "earthWrath",
    name: "大地の怒り",
    desc: "地形の上の敵を倒すと、その地形が周りへ広がる。バーストで周囲の油と草に火がつく。",
    icon: "怒",
    rarity: "epic",
    tags: ["melee", "terrain", "burn"],
    gives: ["terrain", "burn"],
    keywords: kw(["placed", "burn"], ["kill"]),
    cursed: false,
    requires: "melee",
    lineage: "earth",
    after: "oilSpill",
    rules: rulesOf("earthWrath", [
      { when: "onKill", if: [targetOn("any")], then: { kind: "spreadTerrain", magnitude: 0, radius: BOON.earthWrathRadius }, icd: BOON.earthWrathIcd },
      { when: "onBurst", then: { kind: "igniteTerrain", magnitude: 0, radius: BOON.earthWrathBurstRadius } },
    ]),
  },

  // ---------------------------------------------------------------------------
  // 系譜: 刃鳴（武器種の連撃）。派生 → 長い連撃 → 溜めと派生 → 終撃
  // ---------------------------------------------------------------------------
  bladeHum: {
    key: "bladeHum",
    name: "刃鳴",
    desc: `コンボ派生の攻撃が当たると気力+${BOON.bladeHumMana}。`,
    icon: "鳴",
    rarity: "common",
    tags: ["melee", "mana", "combo"],
    gives: ["mana"],
    keywords: kw(["mana"], ["melee", "combo"]),
    cursed: false,
    lineage: "blade",
    rules: rulesOf("bladeHum", [{ when: "onMeleeHit", if: [BRANCH], then: { kind: "restoreMana", magnitude: BOON.bladeHumMana }, icd: BOON.bladeHumIcd }]),
  },
  layeredEdge: {
    key: "layeredEdge",
    name: "重ね刃",
    desc: `武器の${BOON.layeredEdgeStep + 1}段目以降が当たると衝撃波が出る。段数の多い武器ほど多く出る。`,
    icon: "層",
    rarity: "rare",
    tags: ["melee", "combo"],
    keywords: kw(["area"], ["melee", "combo"]),
    cursed: false,
    lineage: "blade",
    after: "bladeHum",
    rules: rulesOf("layeredEdge", [
      {
        when: "onMeleeHit",
        if: [{ kind: "swingStep", atLeast: BOON.layeredEdgeStep }],
        then: { kind: "shockwave", magnitude: BOON.layeredEdgeRatio, scaleBy: "slashBase" },
        icd: BOON.layeredEdgeIcd,
      },
    ]),
  },
  chargeRing: {
    key: "chargeRing",
    name: "溜め鳴り",
    desc: `溜め斬りかコンボ派生が当たった敵は${BOON.chargeRingBroken}秒崩勢（怯みやすく、崩れると長く倒れる）。`,
    icon: "溜",
    rarity: "rare",
    tags: ["melee", "stagger"],
    gives: ["stagger"],
    keywords: kw(["stagger"], ["melee"]),
    cursed: false,
    lineage: "blade",
    after: "layeredEdge",
    rules: rulesOf("chargeRing", [
      { when: "onMeleeHit", if: [{ kind: "chargedSwing", atLeast: 1 }], then: { kind: "inflict", status: "broken", magnitude: BOON.chargeRingBroken } },
      { when: "onMeleeHit", if: [BRANCH], then: { kind: "inflict", status: "broken", magnitude: BOON.chargeRingBroken } },
    ]),
  },
  hundredBlades: {
    key: "hundredBlades",
    name: "百刃",
    desc: `終撃が当たると照準方向へ貫通する刃の波が飛ぶ。得意な武器なら必殺ゲージ+${BOON.hundredBladesEnergy}。`,
    icon: "百",
    rarity: "epic",
    tags: ["melee", "combo", "energy"],
    gives: ["energy"],
    keywords: kw(["area", "energy"], ["finisher"]),
    cursed: false,
    requires: "melee",
    lineage: "blade",
    after: "chargeRing",
    rules: rulesOf("hundredBlades", [
      { when: "onMeleeHit", if: [FINISHER], then: { kind: "wave", magnitude: BOON.hundredBladesRatio, scaleBy: "slashBase" }, icd: BOON.hundredBladesIcd },
      { when: "onMeleeHit", if: [FINISHER, FAVORED], then: { kind: "energy", magnitude: BOON.hundredBladesEnergy }, icd: BOON.hundredBladesIcd },
    ]),
  },

  // ---------------------------------------------------------------------------
  // 武器種（その武器を持っているときだけ 3 択に出る）
  // ---------------------------------------------------------------------------
  rockStance: {
    key: "rockStance",
    name: "岩の構え",
    desc: `大剣の溜め中に被弾すると${BOON.rockStanceTime}秒硬化し、怒気+${BOON.rockStanceWrath}。溜めを崩されにくい。`,
    icon: "岩",
    rarity: "rare",
    tags: ["melee", "stagger"],
    keywords: kw(["ward", "stagger"], ["hurt"]),
    cursed: false,
    loadout: { movesets: ["greatsword"] },
    rules: rulesOf("rockStance", [
      { when: "onHurt", if: [weapon("greatsword"), { kind: "charging" }], then: { kind: "selfStatus", status: "harden", magnitude: 0, duration: BOON.rockStanceTime }, icd: BOON.rockStanceIcd },
      {
        when: "onHurt",
        if: [weapon("greatsword"), { kind: "charging" }],
        then: { kind: "selfStatus", status: "wrath", magnitude: 0, count: BOON.rockStanceWrath, duration: STATUS.wrath.duration },
        icd: BOON.rockStanceIcd,
      },
    ]),
  },
  twinShadow: {
    key: "twinShadow",
    name: "影分身",
    desc: "双剣の5段目以降が当たると、分身が同じ敵をもう一度斬る。",
    icon: "分",
    rarity: "rare",
    tags: ["melee", "combo"],
    keywords: kw(["melee"], ["combo"]),
    cursed: false,
    loadout: { movesets: ["twinBlades"] },
    rules: rulesOf("twinShadow", [
      {
        when: "onMeleeHit",
        if: [weapon("twinBlades"), { kind: "swingStep", atLeast: BOON.twinShadowStep }],
        then: { kind: "strike", magnitude: BOON.twinShadowRatio, scaleBy: "slashBase" },
      },
    ]),
  },
  spearPierce: {
    key: "spearPierce",
    name: "穂先貫き",
    desc: "槍の終撃が当たると、突きの先へ貫通する衝撃波が伸びる。",
    icon: "穂",
    rarity: "common",
    tags: ["melee"],
    keywords: kw(["area"], ["finisher"]),
    cursed: false,
    loadout: { movesets: ["spear"] },
    rules: rulesOf("spearPierce", [
      { when: "onMeleeHit", if: [weapon("spear"), FINISHER], then: { kind: "wave", magnitude: BOON.spearPierceRatio, scaleBy: "slashBase" }, icd: BOON.spearPierceIcd },
    ]),
  },
  scytheReap: {
    key: "scytheReap",
    name: "鎌の実り",
    desc: `大鎌で倒すと気力+${BOON.scytheReapMana}、周りの敵に出血。`,
    icon: "鎌",
    rarity: "common",
    tags: ["melee", "bleed", "mana"],
    gives: ["bleed", "mana"],
    keywords: kw(["mana", "bleed"], ["kill"]),
    cursed: false,
    loadout: { movesets: ["scythe"] },
    rules: rulesOf("scytheReap", [
      { when: "onKill", if: [weapon("scythe")], then: { kind: "restoreMana", magnitude: BOON.scytheReapMana } },
      { when: "onKill", if: [weapon("scythe")], then: { kind: "inflict", status: "bleed", magnitude: BOON.scytheReapBleed }, icd: BOON.scytheReapIcd },
    ]),
  },
  fistsHeat: {
    key: "fistsHeat",
    name: "連打の熱",
    desc: `拳でコンボ${BOON.fistsHeatCombo}以上の間、当たるたび必殺ゲージ+${BOON.fistsHeatEnergy}。`,
    icon: "拳",
    rarity: "common",
    tags: ["melee", "combo", "energy"],
    gives: ["energy"],
    keywords: kw(["energy"], ["combo"]),
    cursed: false,
    loadout: { movesets: ["fists"] },
    rules: rulesOf("fistsHeat", [
      {
        when: "onMeleeHit",
        if: [weapon("fists"), { kind: "comboAbove", count: BOON.fistsHeatCombo }],
        then: { kind: "energy", magnitude: BOON.fistsHeatEnergy },
        icd: BOON.fistsHeatIcd,
      },
    ]),
  },
  whipThreat: {
    key: "whipThreat",
    name: "鞭の脅し",
    desc: `鞭のコンボ派生が当たった敵は${BOON.whipThreatFear}秒恐怖する。`,
    icon: "鞭",
    rarity: "common",
    tags: ["melee", "fear"],
    gives: ["fear"],
    keywords: kw(["fear"], ["combo"]),
    cursed: false,
    loadout: { movesets: ["whip"] },
    rules: rulesOf("whipThreat", [
      { when: "onMeleeHit", if: [weapon("whip"), BRANCH], then: { kind: "inflict", status: "fear", magnitude: BOON.whipThreatFear }, icd: BOON.whipThreatIcd },
    ]),
  },
  cleaverSplit: {
    key: "cleaverSplit",
    name: "叩き割り",
    desc: `鉈で堅守の敵を叩くと${BOON.cleaverSplitBroken}秒崩勢にする。`,
    icon: "割",
    rarity: "common",
    tags: ["melee", "guarded", "stagger"],
    gives: ["stagger"],
    keywords: kw(["stagger"], ["melee"]),
    cursed: false,
    loadout: { movesets: ["cleaver"] },
    rules: rulesOf("cleaverSplit", [
      {
        when: "onMeleeHit",
        if: [weapon("cleaver"), { kind: "trigger", condition: "targetGuarded" }],
        then: { kind: "inflict", status: "broken", magnitude: BOON.cleaverSplitBroken },
        icd: BOON.cleaverSplitIcd,
      },
    ]),
  },
  staffRing: {
    key: "staffRing",
    name: "棍の響き",
    desc: "棍を持つ間、敵が怯むとその場から衝撃波が広がる。",
    icon: "棍",
    rarity: "rare",
    tags: ["melee", "stagger"],
    keywords: kw(["area"], ["stagger"]),
    cursed: false,
    loadout: { movesets: ["staff"] },
    rules: rulesOf("staffRing", [
      { when: "onStagger", if: [weapon("staff")], then: { kind: "shockwave", magnitude: BOON.staffRingRatio, scaleBy: "slashBase" }, icd: BOON.staffRingIcd },
    ]),
  },
  wandLamp: {
    key: "wandLamp",
    name: "杖の灯",
    desc: `杖を持つ間、射撃が当たるたび気力+${BOON.wandLampMana}。`,
    icon: "灯",
    rarity: "common",
    tags: ["ranged", "mana"],
    gives: ["mana"],
    keywords: kw(["mana"], ["ranged"]),
    cursed: false,
    loadout: { movesets: ["wand"] },
    rules: rulesOf("wandLamp", [{ when: "onRangedHit", if: [weapon("wand")], then: { kind: "restoreMana", magnitude: BOON.wandLampMana }, icd: BOON.wandLampIcd }]),
  },

  // ---------------------------------------------------------------------------
  // 射撃の型（その型を持っているときだけ 3 択に出る）
  // ---------------------------------------------------------------------------
  oilMine: {
    key: "oilMine",
    name: "油の地雷",
    desc: `設置弾が当たると足元に油が広がる（${BOON.oilMineTime}秒）。炎の弾なら燃え上がる。`,
    icon: "埋",
    rarity: "common",
    tags: ["ranged", "terrain", "burn", "placed"],
    gives: ["terrain"],
    keywords: kw(["placed"], ["ranged"], ["burn"]),
    cursed: false,
    loadout: { shots: ["mine"] },
    rules: rulesOf("oilMine", [
      {
        when: "onRangedHit",
        if: [{ kind: "shot", shots: ["mine"] }],
        then: { kind: "placeTerrain", terrain: "oil", magnitude: 0, radius: BOON.oilMineRadius, duration: BOON.oilMineTime },
        icd: BOON.oilMineIcd,
      },
    ]),
  },
  chargeRecoil: {
    key: "chargeRecoil",
    name: "撃ち離れ",
    desc: "溜め撃ちが当たるとダッシュの回数が1戻る。",
    icon: "離",
    rarity: "common",
    tags: ["ranged", "dash"],
    keywords: kw(["dash"], ["ranged", "still"]),
    cursed: false,
    loadout: { shots: ["charge"] },
    rules: rulesOf("chargeRecoil", [
      { when: "onRangedHit", if: [{ kind: "shot", shots: ["charge"] }], then: { kind: "refillDash", magnitude: 0, count: 1 }, icd: BOON.chargeRecoilIcd },
    ]),
  },
  venomBee: {
    key: "venomBee",
    name: "毒蜂",
    desc: `追尾弾が当たった敵に毒（${BOON.venomBeePoison}秒）。`,
    icon: "蜂",
    rarity: "common",
    tags: ["ranged", "poison"],
    gives: ["poison"],
    keywords: kw(["poison"], ["ranged"]),
    cursed: false,
    loadout: { shots: ["homing"] },
    rules: rulesOf("venomBee", [
      { when: "onRangedHit", if: [{ kind: "shot", shots: ["homing"] }], then: { kind: "inflict", status: "poison", magnitude: BOON.venomBeePoison } },
    ]),
  },
  pebbleRain: {
    key: "pebbleRain",
    name: "礫雨",
    desc: `散弾の1粒ごとに怯み値+${BOON.pebbleRainPoise}。近くで当てるほど怯ませやすい。`,
    icon: "礫",
    rarity: "common",
    tags: ["ranged", "stagger"],
    gives: ["stagger"],
    keywords: kw(["stagger"], ["ranged", "bullet"]),
    cursed: false,
    loadout: { shots: ["spread"] },
    rules: rulesOf("pebbleRain", [
      { when: "onRangedHit", if: [{ kind: "shot", shots: ["spread"] }], then: { kind: "addPoise", magnitude: BOON.pebbleRainPoise } },
    ]),
  },

  // ---------------------------------------------------------------------------
  // 属性
  // ---------------------------------------------------------------------------
  weakStrike: {
    key: "weakStrike",
    name: "弱点突き",
    desc: `弱点を突くと気力が戻る（近接+${BOON.weakStrikeMeleeMana} / 射撃+${BOON.weakStrikeRangedMana}）。`,
    icon: "突",
    rarity: "common",
    tags: ["element", "mana"],
    gives: ["mana"],
    keywords: kw(["mana"], ["melee", "ranged"]),
    cursed: false,
    rules: rulesOf("weakStrike", [
      {
        when: "onMeleeHit",
        if: [{ kind: "targetAffinity", affinity: "weak", via: "melee" }],
        then: { kind: "restoreMana", magnitude: BOON.weakStrikeMeleeMana },
        icd: BOON.weakStrikeIcd,
      },
      {
        when: "onRangedHit",
        if: [{ kind: "targetAffinity", affinity: "weak", via: "ranged" }],
        then: { kind: "restoreMana", magnitude: BOON.weakStrikeRangedMana },
        icd: BOON.weakStrikeIcd,
      },
    ]),
  },
  resistBreak: {
    key: "resistBreak",
    name: "耐性崩し",
    desc: `近接の属性に耐性を持つ敵に反応を起こすと、${BOON.resistBreakVulnerable}秒脆弱にする。`,
    icon: "崩",
    rarity: "rare",
    tags: ["element", "vulnerable"],
    gives: ["vulnerable"],
    keywords: kw(["vulnerable"], ["reaction"]),
    cursed: false,
    rules: rulesOf("resistBreak", [
      {
        when: "onReaction",
        if: [BY_PLAYER, { kind: "targetAffinity", affinity: "resist", via: "melee" }],
        then: { kind: "inflict", status: "vulnerable", magnitude: BOON.resistBreakVulnerable },
        icd: BOON.resistBreakIcd,
      },
    ]),
  },
  oilSlash: {
    key: "oilSlash",
    name: "油火斬り",
    desc: "油の上の敵を斬ると燃焼を付ける。燃えた敵から足元の油へ火が移る。",
    icon: "斬",
    rarity: "common",
    tags: ["melee", "burn", "terrain", "element"],
    gives: ["burn"],
    keywords: kw(["burn"], ["melee", "placed"]),
    cursed: false,
    rules: rulesOf("oilSlash", [
      { when: "onMeleeHit", if: [targetOn("oil")], then: { kind: "inflict", status: "burn", magnitude: BOON.oilSlashBurn }, icd: BOON.oilSlashIcd },
    ]),
  },
  elementTorrent: {
    key: "elementTorrent",
    name: "属性の奔流",
    desc: `近接に属性が付いている間、反応を起こすたび必殺ゲージ+${BOON.elementTorrentEnergy}。`,
    icon: "奔",
    rarity: "common",
    tags: ["element", "energy"],
    gives: ["energy"],
    keywords: kw(["energy"], ["reaction"]),
    cursed: false,
    rules: rulesOf("elementTorrent", [
      {
        when: "onReaction",
        if: [BY_PLAYER, { kind: "not", condition: { kind: "attackElement", element: "none", via: "melee" } }],
        then: { kind: "energy", magnitude: BOON.elementTorrentEnergy },
        icd: BOON.elementTorrentIcd,
      },
    ]),
  },
  darkFeast: {
    key: "darkFeast",
    name: "闇喰らい",
    desc: `近接が闇属性の間、倒すたび生命+${BOON.darkFeastHeal}。`,
    icon: "闇",
    rarity: "common",
    tags: ["element", "hp"],
    keywords: kw(["heal"], ["kill"]),
    cursed: false,
    rules: rulesOf("darkFeast", [
      { when: "onKill", if: [{ kind: "attackElement", element: "dark", via: "melee" }], then: { kind: "heal", magnitude: BOON.darkFeastHeal } },
    ]),
  },
  lightPierce: {
    key: "lightPierce",
    name: "光刺し",
    desc: `近接が光属性の間、会心が出た敵を${BOON.lightPierceVulnerable}秒脆弱にする。`,
    icon: "光",
    rarity: "common",
    tags: ["element", "crit", "vulnerable"],
    gives: ["vulnerable"],
    keywords: kw(["vulnerable"], ["crit"]),
    cursed: false,
    rules: rulesOf("lightPierce", [
      {
        when: "onCrit",
        if: [{ kind: "attackElement", element: "light", via: "melee" }],
        then: { kind: "inflict", status: "vulnerable", magnitude: BOON.lightPierceVulnerable },
        icd: BOON.lightPierceIcd,
      },
    ]),
  },
  waterThunder: {
    key: "waterThunder",
    name: "水面の雷",
    desc: `水たまりに立つ敵に感電が付くと、半径${BOON.waterThunderRadius}の敵へ感電が走る。`,
    icon: "水",
    rarity: "rare",
    tags: ["shock", "terrain", "element"],
    gives: ["shock"],
    keywords: kw(["shock"], ["shock", "placed"]),
    cursed: false,
    rules: rulesOf("waterThunder", [
      {
        when: "onStatusApplied",
        if: [BY_PLAYER, tag("shock"), targetOn("water")],
        then: { kind: "spreadStatus", status: "shock", magnitude: 1, radius: BOON.waterThunderRadius, duration: BOON.waterThunderTime },
        icd: BOON.waterThunderIcd,
      },
    ]),
  },

  // ---------------------------------------------------------------------------
  // 地形
  // ---------------------------------------------------------------------------
  iceSkate: {
    key: "iceSkate",
    name: "氷滑り",
    desc: `氷床に踏み込むとダッシュの回数が1戻り、${BOON.iceSkateHaste}秒加速する。`,
    icon: "滑",
    rarity: "common",
    tags: ["dash", "terrain", "chill"],
    keywords: kw(["dash"], ["chill"]),
    cursed: false,
    rules: rulesOf("iceSkate", [
      { when: "onTerrainEnter", if: [tag("ice")], then: { kind: "refillDash", magnitude: 0, count: 1 }, icd: BOON.iceSkateIcd },
      { when: "onTerrainEnter", if: [tag("ice")], then: { kind: "selfStatus", status: "haste", magnitude: 0, duration: BOON.iceSkateHaste }, icd: BOON.iceSkateIcd },
    ]),
  },
  fieldBurn: {
    key: "fieldBurn",
    name: "野焼き",
    desc: "草むらに立つ敵を撃つと燃焼を付ける。草に燃え移って広がる。",
    icon: "野",
    rarity: "common",
    tags: ["ranged", "burn", "terrain"],
    gives: ["burn"],
    keywords: kw(["burn"], ["ranged", "placed"]),
    cursed: false,
    rules: rulesOf("fieldBurn", [
      { when: "onRangedHit", if: [targetOn("grass")], then: { kind: "inflict", status: "burn", magnitude: BOON.fieldBurnBurn }, icd: BOON.fieldBurnIcd },
    ]),
  },
  waterRunner: {
    key: "waterRunner",
    name: "水走り",
    desc: `水たまりに踏み込むと帯電+${BOON.waterRunnerStacks}（次の近接で放電する）。`,
    icon: "走",
    rarity: "common",
    tags: ["shock", "terrain", "melee"],
    gives: ["shock"],
    keywords: kw(["shock"], ["placed"], ["melee"]),
    cursed: false,
    rules: rulesOf("waterRunner", [
      {
        when: "onTerrainEnter",
        if: [tag("water")],
        then: { kind: "selfStatus", status: "charged", magnitude: 0, count: BOON.waterRunnerStacks, duration: BOON.waterRunnerTime },
        icd: BOON.waterRunnerIcd,
      },
    ]),
  },
  frozenWater: {
    key: "frozenWater",
    name: "凍て水",
    desc: `水たまりに立つ敵に冷気が付くと、${BOON.frozenWaterFreeze}秒凍りつく。`,
    icon: "氷",
    rarity: "rare",
    tags: ["chill", "freeze", "terrain"],
    gives: ["freeze"],
    keywords: kw(["chill"], ["chill", "placed"]),
    cursed: false,
    rules: rulesOf("frozenWater", [
      {
        when: "onStatusApplied",
        if: [BY_PLAYER, tag("chill"), targetOn("water")],
        then: { kind: "inflict", status: "freeze", magnitude: BOON.frozenWaterFreeze },
        icd: BOON.frozenWaterIcd,
      },
    ]),
  },

  // ---------------------------------------------------------------------------
  // ジョブ
  // ---------------------------------------------------------------------------
  favoredPride: {
    key: "favoredPride",
    name: "得物の誉れ",
    desc: `ジョブの得意な武器の終撃が当たると必殺ゲージ+${BOON.favoredPrideEnergy}。`,
    icon: "誉",
    rarity: "common",
    tags: ["melee", "energy"],
    gives: ["energy"],
    keywords: kw(["energy"], ["finisher"]),
    cursed: false,
    loadout: { jobs: ["swordsman", "hunter", "brawler", "shieldBearer", "hexer", "lancer", "invoker", "shadow", "alchemist"] },
    rules: rulesOf("favoredPride", [
      { when: "onMeleeHit", if: [FAVORED, FINISHER], then: { kind: "energy", magnitude: BOON.favoredPrideEnergy }, icd: BOON.favoredPrideIcd },
    ]),
  },
  namelessPride: {
    key: "namelessPride",
    name: "無名の誇り",
    desc: `見習いの間、倒すたび気力+${BOON.namelessMana}・必殺ゲージ+${BOON.namelessEnergy}。`,
    icon: "名",
    rarity: "common",
    tags: ["mana", "energy"],
    gives: ["mana", "energy"],
    keywords: kw(["mana", "energy"], ["kill"]),
    cursed: false,
    loadout: { jobs: ["none"] },
    rules: rulesOf("namelessPride", [
      { when: "onKill", if: [{ kind: "job", jobs: ["none"] }], then: { kind: "restoreMana", magnitude: BOON.namelessMana } },
      { when: "onKill", if: [{ kind: "job", jobs: ["none"] }], then: { kind: "energy", magnitude: BOON.namelessEnergy } },
    ]),
  },
  otherStyle: {
    key: "otherStyle",
    name: "他流",
    desc: `ジョブが得意としない武器で近接が当たると気力+${BOON.otherStyleMana}。`,
    icon: "流",
    rarity: "common",
    tags: ["melee", "mana"],
    gives: ["mana"],
    keywords: kw(["mana"], ["melee"]),
    cursed: false,
    loadout: { jobs: ["swordsman", "hunter", "brawler", "shieldBearer", "hexer", "lancer", "invoker", "shadow", "alchemist"] },
    rules: rulesOf("otherStyle", [
      {
        when: "onMeleeHit",
        if: [{ kind: "not", condition: FAVORED }, { kind: "not", condition: { kind: "job", jobs: ["none"] } }],
        then: { kind: "restoreMana", magnitude: BOON.otherStyleMana },
        icd: BOON.otherStyleIcd,
      },
    ]),
  },

  // ---------------------------------------------------------------------------
  // 部屋・交戦中・巣窟・徘徊・分岐路
  // ---------------------------------------------------------------------------
  hordeLord: {
    key: "hordeLord",
    name: "巣窟の主",
    desc: `巣窟・試練・闘技場の波が始まるたび、必殺ゲージ+${BOON.hordeLordEnergy}・気力+${BOON.hordeLordMana}。`,
    icon: "巣",
    rarity: "rare",
    tags: ["room", "energy", "mana"],
    gives: ["energy", "mana"],
    keywords: kw(["energy", "mana"], ["clear"]),
    cursed: false,
  },
  hordeEater: {
    key: "hordeEater",
    name: "群れ喰らい",
    desc: `巣窟で戦う間、倒すたび生命+${BOON.hordeEaterHeal}・必殺ゲージ+${BOON.hordeEaterEnergy}。`,
    icon: "群",
    rarity: "common",
    tags: ["room", "hp", "energy"],
    keywords: kw(["heal", "energy"], ["kill"]),
    cursed: false,
    rules: rulesOf("hordeEater", [
      { when: "onKill", if: [{ kind: "engagedIn", rooms: ["horde"] }], then: { kind: "heal", magnitude: BOON.hordeEaterHeal } },
      { when: "onKill", if: [{ kind: "engagedIn", rooms: ["horde"] }], then: { kind: "energy", magnitude: BOON.hordeEaterEnergy } },
    ]),
  },
  roamHunt: {
    key: "roamHunt",
    name: "徘徊狩り",
    desc: `徘徊の敵を倒すと気力+${BOON.roamHuntMana}・必殺ゲージ+${BOON.roamHuntEnergy}。`,
    icon: "徊",
    rarity: "common",
    tags: ["room", "mana", "energy"],
    gives: ["mana", "energy"],
    keywords: kw(["mana", "energy"], ["kill"]),
    cursed: false,
    rules: rulesOf("roamHunt", [
      { when: "onKill", if: [ROAMER], then: { kind: "restoreMana", magnitude: BOON.roamHuntMana } },
      { when: "onKill", if: [ROAMER], then: { kind: "energy", magnitude: BOON.roamHuntEnergy } },
    ]),
  },
  strayMark: {
    key: "strayMark",
    name: "迷い討ち",
    desc: `徘徊の敵に当てると${BOON.strayMarkVulnerable}秒脆弱にする。`,
    icon: "迷",
    rarity: "common",
    tags: ["room", "vulnerable"],
    gives: ["vulnerable"],
    keywords: kw(["vulnerable"], ["melee", "ranged"]),
    cursed: false,
    rules: rulesOf("strayMark", [
      { when: "onMeleeHit", if: [ROAMER], then: { kind: "inflict", status: "vulnerable", magnitude: BOON.strayMarkVulnerable } },
      { when: "onRangedHit", if: [ROAMER], then: { kind: "inflict", status: "vulnerable", magnitude: BOON.strayMarkVulnerable } },
    ]),
  },
  wayfarer: {
    key: "wayfarer",
    name: "旅慣れ",
    desc: `バイオームの階では、地形に踏み込むたび必殺ゲージ+${BOON.wayfarerEnergy}、制圧で気力+${BOON.wayfarerClearMana}。`,
    icon: "旅",
    rarity: "common",
    tags: ["room", "terrain", "energy"],
    gives: ["energy", "mana"],
    keywords: kw(["energy", "mana"], ["clear", "placed"]),
    cursed: false,
    rules: rulesOf("wayfarer", [
      { when: "onTerrainEnter", if: [{ kind: "floorKind", kinds: BIOME_FLOORS }], then: { kind: "energy", magnitude: BOON.wayfarerEnergy }, icd: BOON.wayfarerIcd },
      { when: "onRoomClear", if: [{ kind: "floorKind", kinds: BIOME_FLOORS }], then: { kind: "restoreMana", magnitude: BOON.wayfarerClearMana } },
    ]),
  },
  engageSpark: {
    key: "engageSpark",
    name: "口火",
    desc: `交戦が始まった瞬間、近くの敵を${BOON.engageSparkFear}秒恐怖させる。`,
    icon: "口",
    rarity: "common",
    tags: ["room", "fear"],
    gives: ["fear"],
    keywords: kw(["fear"], ["clear"]),
    cursed: false,
    rules: rulesOf("engageSpark", [{ when: "onRoomLock", then: { kind: "inflict", status: "fear", magnitude: BOON.engageSparkFear } }]),
  },

  // ---------------------------------------------------------------------------
  // 反応
  // ---------------------------------------------------------------------------
  reactionEmber: {
    key: "reactionEmber",
    name: "反応の余熱",
    desc: `反応を起こすたび気力+${BOON.reactionEmberMana}。`,
    icon: "熱",
    rarity: "common",
    tags: ["mana", "element"],
    gives: ["mana"],
    keywords: kw(["mana"], ["reaction"]),
    cursed: false,
    rules: rulesOf("reactionEmber", [
      { when: "onReaction", if: [BY_PLAYER], then: { kind: "restoreMana", magnitude: BOON.reactionEmberMana }, icd: BOON.reactionEmberIcd },
    ]),
  },
  steamVeil: {
    key: "steamVeil",
    name: "蒸気隠れ",
    desc: `蒸発か蒸気の反応が起きると${BOON.steamVeilHaste}秒加速する。`,
    icon: "霧",
    rarity: "common",
    tags: ["burn", "chill", "dash"],
    keywords: kw(["dash"], ["reaction"]),
    cursed: false,
    rules: rulesOf("steamVeil", [
      { when: "onReaction", if: [tag("vaporize")], then: { kind: "selfStatus", status: "haste", magnitude: 0, duration: BOON.steamVeilHaste }, icd: BOON.steamVeilIcd },
      { when: "onReaction", if: [tag("steam")], then: { kind: "selfStatus", status: "haste", magnitude: 0, duration: BOON.steamVeilHaste }, icd: BOON.steamVeilIcd },
    ]),
  },

  // ---------------------------------------------------------------------------
  // 気力・スキル（スロット別のコスト。boonRules.ts の boonRuleCostMul）
  // ---------------------------------------------------------------------------
  weave: {
    key: "weave",
    name: "織り交ぜ",
    desc: `直前と違うスロットのスキルは気力コスト${Math.round((1 - BOON.weaveOtherMul) * 100)}%減、同じスロットの連打は${Math.round((BOON.weaveSameMul - 1) * 100)}%増。`,
    icon: "織",
    rarity: "rare",
    tags: ["mana", "skill"],
    keywords: kw([], ["mana"], ["mana"]),
    cursed: false,
  },
  overflowCup: {
    key: "overflowCup",
    name: "満ち溢れ",
    desc: `気力が満タンの間、近接で溢れた気力を溜めておく（最大気力の${Math.round(BOON.overflowCapRatio * 100)}%まで）。次のスキルで払った気力を、溜めた分から取り戻す。`,
    icon: "溢",
    rarity: "rare",
    tags: ["mana", "skill", "melee"],
    keywords: kw(["mana"], ["melee"], ["mana"]),
    cursed: false,
  },

  // ---------------------------------------------------------------------------
  // 呪い
  // ---------------------------------------------------------------------------
  bloodSoil: {
    key: "bloodSoil",
    name: "血染めの地",
    desc: `地形に踏み込むたび必殺ゲージ+${BOON.bloodSoilEnergy}。その代わり、そのたび自分が出血する。`,
    icon: "染",
    rarity: "rare",
    tags: ["energy", "terrain", "bleed"],
    keywords: kw(["energy"], ["placed"]),
    cursed: true,
    rules: rulesOf("bloodSoil", [
      { when: "onTerrainEnter", then: { kind: "energy", magnitude: BOON.bloodSoilEnergy }, icd: BOON.bloodSoilIcd },
      {
        when: "onTerrainEnter",
        then: { kind: "selfStatus", status: "bleed", magnitude: BOON.bloodSoilBleed, duration: BOON.bloodSoilBleedTime },
        icd: BOON.bloodSoilIcd,
      },
    ]),
  },
  singleMind: {
    key: "singleMind",
    name: "一念",
    desc: `スロット1のスキルは気力コストが${Math.round((1 - BOON.singleMindMainMul) * 100)}%減。その代わり、スロット2〜4は気力コスト${BOON.singleMindOtherMul}倍。`,
    icon: "一",
    rarity: "rare",
    tags: ["skill", "mana"],
    keywords: kw([], ["mana"], ["mana"]),
    cursed: true,
  },
  scorchBlade: {
    key: "scorchBlade",
    name: "焦がれ刃",
    desc: "近接が当たるたび燃焼を付ける。その代わり、倒すたび自分も少し燃える。",
    icon: "焼",
    rarity: "rare",
    tags: ["melee", "burn"],
    gives: ["burn"],
    keywords: kw(["burn"], ["melee"]),
    cursed: true,
    rules: rulesOf("scorchBlade", [
      { when: "onMeleeHit", then: { kind: "inflict", status: "burn", magnitude: BOON.scorchBladeBurn }, icd: BOON.scorchBladeIcd },
      {
        when: "onKill",
        then: { kind: "selfStatus", status: "burn", magnitude: BOON.scorchBladeSelfDps, duration: BOON.scorchBladeSelfTime },
        icd: BOON.scorchBladeSelfIcd,
      },
    ]),
  },
  madBloom: {
    key: "madBloom",
    name: "狂い咲き",
    desc: `反応を起こすたびその場で衝撃波。その代わり、そのたび自分が${BOON.madBloomWeaken}秒弱体する。`,
    icon: "咲",
    rarity: "rare",
    tags: ["element", "stagger"],
    keywords: kw(["area"], ["reaction"]),
    cursed: true,
    rules: rulesOf("madBloom", [
      { when: "onReaction", if: [BY_PLAYER], then: { kind: "shockwave", magnitude: BOON.madBloomRatio, scaleBy: "slashBase" }, icd: BOON.madBloomIcd },
      { when: "onReaction", if: [BY_PLAYER], then: { kind: "selfStatus", status: "weaken", magnitude: 0, duration: BOON.madBloomWeaken }, icd: BOON.madBloomIcd },
    ]),
  },
  strayBounty: {
    key: "strayBounty",
    name: "野良の賞金",
    desc: `徘徊の敵を倒すと必殺ゲージが満ちる。その代わり、交戦していない間に被弾すると自分が${BOON.strayBountyWeaken}秒弱体する。`,
    icon: "賞",
    rarity: "rare",
    tags: ["room", "energy"],
    gives: ["energy"],
    keywords: kw(["energy"], ["kill", "hurt"]),
    cursed: true,
    rules: rulesOf("strayBounty", [
      { when: "onKill", if: [ROAMER], then: { kind: "energy", magnitude: BOON.strayBountyEnergy } },
      {
        when: "onHurt",
        if: [{ kind: "not", condition: { kind: "roomLocked" } }],
        then: { kind: "selfStatus", status: "weaken", magnitude: 0, duration: BOON.strayBountyWeaken },
        icd: BOON.strayBountyIcd,
      },
    ]),
  },
  heavyOath: {
    key: "heavyOath",
    name: "重き誓い",
    desc: `大剣の溜め斬りは怯み値+${BOON.heavyOathPoise}。その代わり、溜めずに当てると自分が${BOON.heavyOathWeaken}秒弱体する。`,
    icon: "誓",
    rarity: "rare",
    tags: ["melee", "stagger"],
    gives: ["stagger"],
    keywords: kw(["stagger"], ["melee", "still"]),
    cursed: true,
    loadout: { movesets: ["greatsword"] },
    rules: rulesOf("heavyOath", [
      { when: "onMeleeHit", if: [weapon("greatsword"), { kind: "chargedSwing", atLeast: 1 }], then: { kind: "addPoise", magnitude: BOON.heavyOathPoise } },
      {
        when: "onMeleeHit",
        if: [weapon("greatsword"), { kind: "not", condition: { kind: "chargedSwing", atLeast: 1 } }],
        then: { kind: "selfStatus", status: "weaken", magnitude: 0, duration: BOON.heavyOathWeaken },
        icd: BOON.heavyOathIcd,
      },
    ]),
  },
  drenched: {
    key: "drenched",
    name: "濡れ鼠",
    desc: `水たまりに踏み込むと気力が満ちる（${BOON.drenchedIcd}秒に1回）。その代わり、自分に濡れが${BOON.drenchedWetStacks}つ付く。`,
    icon: "鼠",
    rarity: "common",
    tags: ["mana", "terrain"],
    gives: ["mana"],
    keywords: kw(["mana"], ["placed"]),
    cursed: true,
    rules: rulesOf("drenched", [
      { when: "onTerrainEnter", if: [tag("water")], then: { kind: "restoreMana", magnitude: BOON.drenchedMana }, icd: BOON.drenchedIcd },
      {
        when: "onTerrainEnter",
        if: [tag("water")],
        then: { kind: "selfStatus", status: "wet", magnitude: 0, count: BOON.drenchedWetStacks, duration: BOON.drenchedWetTime },
        icd: BOON.drenchedIcd,
      },
    ]),
  },

  // ---------------------------------------------------------------------------
  // 結び
  // ---------------------------------------------------------------------------
  oilBlast: {
    key: "oilBlast",
    name: "油火爆",
    desc: "油膜の敵が炎上すると、その場で爆発する。",
    icon: "爆",
    rarity: "epic",
    tags: ["burn", "explode", "terrain"],
    keywords: kw(["explode"], ["burn", "placed"]),
    cursed: false,
    duo: ["oilSpill", "emberSeed"],
    rules: rulesOf("oilBlast", [
      {
        when: "onReaction",
        if: [BY_PLAYER, tag("ignite")],
        then: { kind: "explode", magnitude: BOON.oilBlastRatio, scaleBy: "slashBase" },
        icd: BOON.oilBlastIcd,
      },
    ]),
  },
  iceDance: {
    key: "iceDance",
    name: "氷上の舞",
    desc: `氷床の上で見切りを決めると、近くの敵が${BOON.iceDanceFreeze}秒凍りつく。`,
    icon: "舞",
    rarity: "epic",
    tags: ["just", "freeze", "terrain"],
    keywords: kw(["chill"], ["just", "placed"]),
    cursed: false,
    duo: ["iceSkate", "frostBreath"],
    rules: rulesOf("iceDance", [
      { when: "onJustDodge", if: [selfOn("ice")], then: { kind: "inflict", status: "freeze", magnitude: BOON.iceDanceFreeze }, icd: BOON.iceDanceIcd },
    ]),
  },
  thunderRain: {
    key: "thunderRain",
    name: "雷雨",
    desc: "水たまりに踏み込むと、自分から雷が連鎖する。",
    icon: "雨",
    rarity: "epic",
    tags: ["shock", "terrain", "dash"],
    keywords: kw(["shock"], ["placed", "dash"]),
    cursed: false,
    duo: ["waterRunner", "staticDash"],
    rules: rulesOf("thunderRain", [
      {
        when: "onTerrainEnter",
        if: [tag("water")],
        then: { kind: "chainLightning", magnitude: BOON.thunderRainRatio, scaleBy: "slashBase" },
        icd: BOON.thunderRainIcd,
      },
    ]),
  },
  groundRend: {
    key: "groundRend",
    name: "地走り",
    desc: "地形の上の敵にコンボ派生が当たると、その地形が周りへ広がる。",
    icon: "壌",
    rarity: "epic",
    tags: ["melee", "terrain", "combo"],
    keywords: kw(["placed"], ["melee", "combo"]),
    cursed: false,
    duo: ["bladeHum", "footBreak"],
    rules: rulesOf("groundRend", [
      { when: "onMeleeHit", if: [BRANCH, targetOn("any")], then: { kind: "spreadTerrain", magnitude: 0, radius: BOON.groundRendRadius }, icd: BOON.groundRendIcd },
    ]),
  },
  huntLord: {
    key: "huntLord",
    name: "狩場の王",
    desc: `巣窟・試練・闘技場を制圧すると、この階の徘徊の敵すべてが脆弱になり${BOON.huntLordFear}秒恐怖する。`,
    icon: "王",
    rarity: "epic",
    tags: ["room", "vulnerable", "fear"],
    keywords: kw(["vulnerable", "fear"], ["clear"]),
    cursed: false,
    duo: ["roamHunt", "hordeLord"],
    rules: directRulesOf("huntLord", [
      {
        when: "onRoomClear",
        if: [WAVE_ROOM],
        then: { kind: "roomEnemies", room: "roaming", status: "vulnerable", magnitude: NO_AMOUNT, duration: STATUS.vulnerable.duration },
      },
      {
        when: "onRoomClear",
        if: [WAVE_ROOM],
        then: {
          kind: "roomEnemies",
          room: "roaming",
          status: "fear",
          magnitude: NO_AMOUNT,
          duration: BOON.huntLordFear,
          text: "狩場",
          color: BOON.rarityColor.epic,
        },
      },
    ]),
  },
  weakChain: {
    key: "weakChain",
    name: "弱点連鎖",
    desc: "近接の属性が弱点の敵に反応が起きると、その敵から雷が連鎖する。",
    icon: "連",
    rarity: "epic",
    tags: ["element", "shock"],
    keywords: kw(["shock"], ["reaction"]),
    cursed: false,
    duo: ["weakStrike", "reactionEmber"],
    rules: rulesOf("weakChain", [
      {
        when: "onReaction",
        if: [BY_PLAYER, { kind: "targetAffinity", affinity: "weak", via: "melee" }],
        then: { kind: "chainLightning", magnitude: BOON.weakChainRatio, scaleBy: "slashBase" },
        icd: BOON.weakChainIcd,
      },
    ]),
  },
};
