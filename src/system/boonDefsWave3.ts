/**
 * 祝福の第 3 弾（データのみ。docs/ideas/boon-power-up.md 3-4）。芯 8 種と、格（大祝福・神威）で伸びる通常の祝福 10 種。
 * 芯は core: true / graded: false（強さは固定。数値は system/boonCores.ts の foldCoreStats が畳み込む）。
 * 通常の 10 種はすべて Rule 型で、格は system/rules.ts が効果量・半径に掛ける（効果量 0 で半径だけ持つものは graded: true）。
 * boonDefs.ts が BOON_KEYS / BOONS に混ぜる（ここは型だけを boonDefs.ts から読む。実行時の循環を作らない）
 */

import type { EventKind, EventSource } from "../core/events";
import { kw } from "../core/keywords";
import { type Rule, type RuleCondition, type RuleEffect, SCOPE_ANY, ruleId } from "../core/rules";
import type { StatusKind } from "../core/status";
import { formatMeters } from "../core/units";
import { BOON, STATUS } from "../data/tuning";
import type { BoonDef } from "./boonDefs";

export const BOON_KEYS_WAVE3 = [
  // ---- 芯（1 ランに 1 つ。深度 BOON.coreDepth の最初の提示だけに出る） ----
  "coreGlassHeart",
  "coreCurseEater",
  "coreTempo",
  "coreBloodLoop",
  "coreManaTide",
  "coreMirage",
  "coreIronGiant",
  "corePlagueEater",
  // ---- 格を活かす通常の祝福 ----
  "firePillar",
  "boltDrop",
  "bloodVein",
  "surgeOfBattle",
  "tailwind",
  "woundReply",
  "eliteHunt",
  "shadowStitch",
  "iceStep",
  "counterBlast",
] as const;

export type BoonKeyWave3 = (typeof BOON_KEYS_WAVE3)[number];

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
/** 効果量を持たない効果（地形・恐怖の付与・コンボの消去）の magnitude */
const NO_AMOUNT = 0;
/** 出血は元の強さ・スタックのまま広げる（spreadStatus の倍率） */
const SAME_POTENCY = 1;
const PERCENT = 100;

function rulesOf(key: BoonKeyWave3, specs: readonly RuleSpec[]): Rule[] {
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

function targetHas(status: StatusKind): RuleCondition {
  return { kind: "targetHas", status };
}

/** 回避で取った見切り（受け流しのスキルが積む見切りは出どころが skill なので外す） */
const DODGED: RuleCondition = { kind: "from", source: "player" };
const TARGET_ELITE: RuleCondition = { kind: "targetElite" };

/** 倍率 → 増減の %（1.5 → 50、0.8 → 20） */
function pct(mul: number): number {
  return Math.round(Math.abs(mul - 1) * PERCENT);
}

/** 割合 → %（0.02 → 2） */
function ratioPct(ratio: number): number {
  return Math.round(ratio * PERCENT);
}

/** 雷落としの連鎖雷（同じ見切りで boltDropCount 本。chainLightning は 1 本ずつなので Rule を並べる） */
const BOLT_DROP_RULES: readonly RuleSpec[] = Array.from({ length: BOON.boltDropCount }, () => ({
  when: "onJustDodge" as const,
  if: [DODGED],
  then: { kind: "chainLightning" as const, magnitude: BOON.boltDropDamage, statFloor: "shockDamage" as const },
}));

// -----------------------------------------------------------------------------
// 定義
// -----------------------------------------------------------------------------

export const BOONS_WAVE3: Readonly<Record<BoonKeyWave3, BoonDef>> = {
  // ---------------------------------------------------------------------------
  // 芯（遊び方そのものを変える大型のルール変更 + 代償。数値は boonCores.ts）
  // ---------------------------------------------------------------------------
  coreGlassHeart: {
    key: "coreGlassHeart",
    name: "硝子の心",
    desc: `近接・射撃・スキルの威力+${pct(BOON.glassHeartDamageMul)}%。代わりに最大生命が-${pct(BOON.glassHeartHpMul)}%になる。`,
    icon: "硝",
    rarity: "rare",
    tags: ["melee", "ranged", "skill"],
    keywords: kw([], [], ["melee", "ranged"]),
    cursed: false,
    core: true,
    graded: false,
  },
  coreCurseEater: {
    key: "coreCurseEater",
    name: "呪い喰い",
    desc:
      `以後の3択に必ず呪い付きが1枚混ざる。持っている呪い付き1つごとに大祝福・神威が出やすくなる` +
      `（+${ratioPct(BOON.curseEaterGradeShiftPerCurse)}%、最大+${ratioPct(BOON.curseEaterMaxShift)}%）。代わりに呪い付きを手放せない。`,
    icon: "喰",
    rarity: "rare",
    tags: [],
    keywords: kw([], [], ["lowHp"]),
    cursed: false,
    core: true,
    graded: false,
  },
  coreTempo: {
    key: "coreTempo",
    name: "拍の刻",
    desc:
      `コンボ1ごとに与ダメージ+${ratioPct(BOON.tempoPerStack)}%（最大+${ratioPct(BOON.tempoCap)}%）。` +
      `代わりにコンボの猶予が-${pct(BOON.tempoWindowMul)}%になり、被弾するとコンボが必ず0になる。`,
    icon: "拍",
    rarity: "rare",
    tags: ["combo"],
    keywords: kw([], ["hurt"], ["combo"]),
    cursed: false,
    core: true,
    graded: false,
    // 被弾でコンボを消す（堅実な手の「半分残る」も上書きする。効果量なしなので格は無関係）
    rules: rulesOf("coreTempo", [{ when: "onHurt", then: { kind: "resetCombo", magnitude: NO_AMOUNT } }]),
  },
  coreBloodLoop: {
    key: "coreBloodLoop",
    name: "血の巡り",
    desc: `与ダメージの${BOON.bloodLoopLifeOnHit}%を生命として回収する（戦闘中の回復の上限あり）。代わりに生命が自然回復せず、ハートを拾えない。`,
    icon: "巡",
    rarity: "rare",
    tags: ["hp"],
    keywords: kw(["heal"], ["melee"]),
    cursed: false,
    core: true,
    graded: false,
  },
  coreManaTide: {
    key: "coreManaTide",
    name: "満ち潮の器",
    desc: `最大気力×${BOON.manaTideMaxMul}、気力の回収量×${BOON.manaTideGainMul}。代わりに気力が自然回復しない。`,
    icon: "器",
    rarity: "rare",
    tags: ["mana", "skill"],
    keywords: kw(["mana"], ["melee"]),
    cursed: false,
    core: true,
    graded: false,
  },
  coreMirage: {
    key: "coreMirage",
    name: "逃げ水",
    desc:
      `ダッシュ回数+${BOON.mirageCharges}、ダッシュの再使用時間-${pct(BOON.mirageCooldownMul)}%。ダッシュの終わりに爆発が起こる。` +
      `代わりに移動速度-${pct(BOON.mirageMoveMul)}%。`,
    icon: "幻",
    rarity: "rare",
    tags: ["dash", "explode"],
    gives: ["explode"],
    keywords: kw(["explode"], ["dash"], ["dash"]),
    cursed: false,
    core: true,
    graded: false,
    rules: rulesOf("coreMirage", [
      {
        when: "onDashEnd",
        then: { kind: "explode", magnitude: BOON.mirageBlastRatio, scaleBy: "slashBase", radius: BOON.mirageBlastRadius },
      },
    ]),
  },
  coreIronGiant: {
    key: "coreIronGiant",
    name: "鉄の巨人",
    desc:
      `怯み値×${BOON.ironGiantPoiseMul}、ノックバック×${BOON.ironGiantKnockbackMul}、最大生命+${pct(BOON.ironGiantHpMul)}%。` +
      `代わりに攻撃速度-${pct(BOON.ironGiantAttackSpeedMul)}%、移動速度-${pct(BOON.ironGiantMoveMul)}%。`,
    icon: "鉄",
    rarity: "rare",
    tags: ["stagger", "melee"],
    gives: ["stagger"],
    keywords: kw(["stagger"], [], ["stagger"]),
    cursed: false,
    core: true,
    graded: false,
  },
  corePlagueEater: {
    key: "corePlagueEater",
    name: "病み喰い",
    desc:
      `状態異常を${BOON.plagueEaterStatuses}種以上持つ敵への攻撃は必ず会心になる。付ける状態異常の強さ+${pct(BOON.plagueEaterPotencyMul)}%。` +
      `代わりに最大生命-${pct(BOON.plagueEaterHpMul)}%。`,
    icon: "病",
    rarity: "rare",
    tags: ["crit", "poison", "bleed", "burn"],
    keywords: kw(["crit"], ["burn", "chill", "shock", "poison", "bleed"]),
    cursed: false,
    core: true,
    graded: false,
  },

  // ---------------------------------------------------------------------------
  // 格を活かす通常の祝福（Rule 型。格で効果量・半径が伸びる）
  // ---------------------------------------------------------------------------
  firePillar: {
    key: "firePillar",
    name: "火柱",
    desc: `燃焼中の敵を倒すと、その場で半径${formatMeters(BOON.firePillarRadius)}の爆発が起こる。`,
    icon: "柱",
    rarity: "rare",
    tags: ["burn", "explode"],
    gives: ["explode"],
    keywords: kw(["explode"], ["burn", "kill"]),
    cursed: false,
    requires: "burn",
    rules: rulesOf("firePillar", [
      {
        when: "onKill",
        if: [targetHas("burn")],
        then: { kind: "explode", magnitude: BOON.firePillarRatio, scaleBy: "slashBase", radius: BOON.firePillarRadius },
      },
    ]),
  },
  boltDrop: {
    key: "boltDrop",
    name: "雷落とし",
    desc: `回避で見切ると、連鎖する雷を${BOON.boltDropCount}回放つ。`,
    icon: "雷",
    rarity: "rare",
    tags: ["just", "shock"],
    gives: ["shock"],
    keywords: kw(["shock"], ["just"]),
    cursed: false,
    rules: rulesOf("boltDrop", BOLT_DROP_RULES),
  },
  bloodVein: {
    key: "bloodVein",
    name: "血脈",
    desc: `出血中の敵に会心が出ると、半径${formatMeters(BOON.bloodVeinRadius)}の敵へ出血が広がる。`,
    icon: "滲",
    rarity: "rare",
    tags: ["bleed", "crit"],
    gives: ["bleed"],
    keywords: kw(["bleed"], ["crit", "bleed"]),
    cursed: false,
    rules: rulesOf("bloodVein", [
      {
        when: "onCrit",
        if: [targetHas("bleed")],
        then: { kind: "spreadStatus", status: "bleed", magnitude: SAME_POTENCY, radius: BOON.bloodVeinRadius, inherit: true, duration: STATUS.bleed.duration },
      },
    ]),
  },
  surgeOfBattle: {
    key: "surgeOfBattle",
    name: "猛り",
    desc: `交戦が始まってから${BOON.surgeTime}秒間、与ダメージ+${BOON.surgeDamagePct}%。`,
    icon: "猛",
    rarity: "common",
    tags: ["room"],
    keywords: kw([], ["clear"], ["melee", "ranged"]),
    cursed: false,
    rules: rulesOf("surgeOfBattle", [
      { when: "onRoomLock", then: { kind: "damageBuff", magnitude: BOON.surgeDamagePct, duration: BOON.surgeTime } },
    ]),
  },
  tailwind: {
    key: "tailwind",
    name: "追い風",
    desc: `敵を倒すたび${BOON.tailwindTime}秒間、移動速度+${BOON.tailwindPct}%。`,
    icon: "風",
    rarity: "common",
    tags: ["dash"],
    keywords: kw([], ["kill"]),
    cursed: false,
    rules: rulesOf("tailwind", [{ when: "onKill", then: { kind: "speedBuff", magnitude: BOON.tailwindPct, duration: BOON.tailwindTime } }]),
  },
  woundReply: {
    key: "woundReply",
    name: "疵の返礼",
    desc: `被弾すると、自分の周り半径${formatMeters(BOON.woundReplyRadius)}に爆発が起こる。`,
    icon: "疵",
    rarity: "common",
    tags: ["hp", "explode"],
    gives: ["explode"],
    keywords: kw(["explode"], ["hurt"]),
    cursed: false,
    rules: rulesOf("woundReply", [
      {
        when: "onHurt",
        // 被弾のイベントの位置は自分。攻撃の主（対象）も巻き込む
        then: { kind: "explode", magnitude: BOON.woundReplyRatio, scaleBy: "slashBase", radius: BOON.woundReplyRadius },
      },
    ]),
  },
  eliteHunt: {
    key: "eliteHunt",
    name: "精鋭狩り",
    desc: `精鋭に近接か射撃を当てると${BOON.eliteHuntVulnerable}秒脆弱にする。`,
    icon: "精",
    rarity: "common",
    tags: ["vulnerable"],
    gives: ["vulnerable"],
    keywords: kw(["vulnerable"], ["elite"]),
    cursed: false,
    rules: rulesOf("eliteHunt", [
      { when: "onMeleeHit", if: [TARGET_ELITE], then: { kind: "inflict", status: "vulnerable", magnitude: BOON.eliteHuntVulnerable } },
      { when: "onRangedHit", if: [TARGET_ELITE], then: { kind: "inflict", status: "vulnerable", magnitude: BOON.eliteHuntVulnerable } },
    ]),
  },
  shadowStitch: {
    key: "shadowStitch",
    name: "怯え伝い",
    desc: `恐怖中の敵を倒すと、半径${formatMeters(BOON.shadowStitchRadius)}の敵を${BOON.shadowStitchFear}秒恐怖させる。`,
    icon: "縫",
    rarity: "rare",
    tags: ["fear"],
    gives: ["fear"],
    keywords: kw(["fear"], ["fear", "kill"]),
    cursed: false,
    requires: "fear",
    // 効果量を持たないので格は半径にだけ掛かる（自動判定では外れるので明示する）
    graded: true,
    rules: rulesOf("shadowStitch", [
      {
        when: "onKill",
        if: [targetHas("fear")],
        then: { kind: "nearbyEnemies", status: "fear", magnitude: NO_AMOUNT, duration: BOON.shadowStitchFear, radius: BOON.shadowStitchRadius },
      },
    ]),
  },
  iceStep: {
    key: "iceStep",
    name: "氷の足跡",
    desc: `ダッシュの終わりに氷床を置く（${BOON.iceStepTime}秒）。`,
    icon: "跡",
    rarity: "common",
    tags: ["dash", "chill", "terrain"],
    gives: ["terrain", "chill"],
    keywords: kw(["placed", "chill"], ["dash"]),
    cursed: false,
    // 効果量を持たないので格は氷床の半径にだけ掛かる
    graded: true,
    rules: rulesOf("iceStep", [
      { when: "onDashEnd", then: { kind: "placeTerrain", terrain: "ice", magnitude: NO_AMOUNT, radius: BOON.iceStepRadius, duration: BOON.iceStepTime } },
    ]),
  },
  counterBlast: {
    key: "counterBlast",
    name: "逆撃",
    desc: "カウンターヒットで、当てた敵の位置に爆発が起こる。",
    icon: "逆",
    rarity: "rare",
    tags: ["counter", "explode"],
    gives: ["explode"],
    keywords: kw(["explode"], ["counter"]),
    cursed: false,
    rules: rulesOf("counterBlast", [
      { when: "onCounter", then: { kind: "explode", magnitude: BOON.counterBlastRatio, scaleBy: "slashBase", radius: BOON.counterBlastRadius } },
    ]),
  },
};
