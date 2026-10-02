/**
 * 呪い付きと芯の札（docs/ideas/boon-impl.md 2-6。段取り 7b）。boonDefs.ts が BOON_KEYS / BOONS に混ぜる。
 * 旧祝福と同じ key の札は、その key の図鑑の記録を引き継ぐ。
 * ここは型だけを boonDefs.ts から読む（実行時の循環を作らない）。
 * 呪い付き 6（Wave2 から残す。一念だけ「系譜が 1 つのとき倍」に作り直した）と、ランの方針を決める芯 8
 * （3 択の顔ぶれが毎回変わるよう 4 → 8 に増やした。数値は system/boonCores.ts が BOON の芯の値で畳む）。どちらも系譜を持たない
 */

import type { EventKind, EventSource } from "../../core/events";
import { kw } from "../../core/keywords";
import { type Modifier, type Rule, type RuleCondition, type RuleEffect, SCOPE_ANY, ruleId } from "../../core/rules";
import { BOON, BOON_LINEAGE } from "../../data/tuning";
import type { BoonDef } from "../boonDefs";

export const BOON_KEYS_CURSED = [
  // ---- 呪い付き 6 ----
  "bloodSoil",
  "singleMind",
  "scorchBlade",
  "madBloom",
  "heavyOath",
  "drenched",
  // ---- 芯 8 ----
  "coreCurseEater",
  "coreTempo",
  "coreBloodLoop",
  "coreMirage",
  "coreGlass",
  "coreHeavy",
  "coreWellspring",
  "coreGreed",
] as const;

type CursedKey = (typeof BOON_KEYS_CURSED)[number];

const K = BOON_LINEAGE.cursed;

interface RuleSpec {
  when: EventKind;
  if?: readonly RuleCondition[];
  then: RuleEffect;
  icd?: number;
}

const ALWAYS = 1;
const NO_AMOUNT = 0;
const PERCENT = 100;
const BY_PLAYER: RuleCondition = { kind: "actor", actor: "player" };
const WATER: RuleCondition = { kind: "eventTag", tag: "water" };
const GREATSWORD: RuleCondition = { kind: "moveset", movesets: ["greatsword"] };
const CHARGED: RuleCondition = { kind: "chargedSwing", atLeast: 1 };
/** 一念: 持っている札の系譜が 1 つまで / 2 つ以上 */
const ONE_LINEAGE: RuleCondition = { kind: "counter", counter: { kind: "lineagesOwned" }, atMost: 1 };
const MANY_LINEAGES: RuleCondition = { kind: "counter", counter: { kind: "lineagesOwned" }, atLeast: 2 };

/** 確定発動の Rule。ICD は BOON.ruleMinIcd を下限にする */
function rulesOf(key: CursedKey, specs: readonly RuleSpec[]): Rule[] {
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

function modifiersOf(key: CursedKey, specs: readonly Pick<Modifier, "kind" | "tag" | "amount" | "if">[]): Modifier[] {
  const owner: EventSource = { kind: "boon", key };
  return specs.map((s, i) => ({ ...s, id: ruleId(owner, i), owner }));
}

/** 倍率 → 増減の %（1.5 → 50、0.8 → 20） */
function pctMul(mul: number): number {
  return Math.round(Math.abs(mul - 1) * PERCENT);
}

/** 割合 → %（0.02 → 2） */
function pct(ratio: number): number {
  return Math.round(ratio * PERCENT);
}

export const BOONS_CURSED: Readonly<Record<CursedKey, BoonDef>> = {
  // ---------------------------------------------------------------------------
  // 呪い付き（強い効果 + 代償。格を持たない）
  // ---------------------------------------------------------------------------
  bloodSoil: {
    key: "bloodSoil",
    name: "血染めの地",
    desc: `地形に踏み込むたび奥義ゲージ+${K.bloodSoil.energy}。その代わり、そのたび自分が出血する。`,
    icon: "染",
    tags: ["energy", "terrain", "bleed"],
    keywords: kw(["energy"], ["placed"]),
    cursed: true,
    rules: rulesOf("bloodSoil", [
      { when: "onTerrainEnter", then: { kind: "energy", magnitude: K.bloodSoil.energy }, icd: K.bloodSoil.icd },
      { when: "onTerrainEnter", then: { kind: "selfStatus", status: "bleed", magnitude: K.bloodSoil.bleed, duration: K.bloodSoil.bleedTime }, icd: K.bloodSoil.icd },
    ]),
  },
  singleMind: {
    key: "singleMind",
    name: "一念",
    desc: `持っている札の系譜が1つだけの間、与ダメージ+${pctMul(K.singleMind.mainMul)}%（倍）。その代わり、系譜が2つ以上になると与ダメージ-${pctMul(K.singleMind.otherMul)}%（倍）。`,
    icon: "一",
    tags: [],
    keywords: kw([], [], ["melee", "ranged"]),
    cursed: true,
    modifiers: modifiersOf("singleMind", [
      { kind: "more", tag: "all", amount: K.singleMind.mainMul, if: [ONE_LINEAGE] },
      { kind: "more", tag: "all", amount: K.singleMind.otherMul, if: [MANY_LINEAGES] },
    ]),
  },
  scorchBlade: {
    key: "scorchBlade",
    name: "焦がれ刃",
    desc: "近接が当たるたび燃焼を付ける。その代わり、倒すたび自分も少し燃える。",
    icon: "焼",
    tags: ["melee", "burn"],
    gives: ["burn"],
    keywords: kw(["burn"], ["melee"]),
    cursed: true,
    rules: rulesOf("scorchBlade", [
      { when: "onMeleeHit", then: { kind: "inflict", status: "burn", magnitude: K.scorchBlade.burn }, icd: K.scorchBlade.icd },
      { when: "onKill", then: { kind: "selfStatus", status: "burn", magnitude: K.scorchBlade.selfDps, duration: K.scorchBlade.selfTime }, icd: K.scorchBlade.selfIcd },
    ]),
  },
  madBloom: {
    key: "madBloom",
    name: "狂い咲き",
    desc: `反応を起こすたびその場で衝撃波。その代わり、そのたび自分が${K.madBloom.weaken}秒弱体する。`,
    icon: "咲",
    tags: ["element", "stagger"],
    keywords: kw(["area"], ["reaction"]),
    cursed: true,
    rules: rulesOf("madBloom", [
      { when: "onReaction", if: [BY_PLAYER], then: { kind: "shockwave", magnitude: K.madBloom.ratio, scaleBy: "slashBase" }, icd: K.madBloom.icd },
      { when: "onReaction", if: [BY_PLAYER], then: { kind: "selfStatus", status: "weaken", magnitude: NO_AMOUNT, duration: K.madBloom.weaken }, icd: K.madBloom.icd },
    ]),
  },
  heavyOath: {
    key: "heavyOath",
    name: "重き誓い",
    desc: `大剣の溜め斬りは怯み値+${K.heavyOath.poise}。その代わり、溜めずに当てると自分が${K.heavyOath.weaken}秒弱体する。`,
    icon: "誓",
    tags: ["melee", "stagger"],
    gives: ["stagger"],
    keywords: kw(["stagger"], ["melee", "still"]),
    cursed: true,
    loadout: { movesets: ["greatsword"] },
    rules: rulesOf("heavyOath", [
      { when: "onMeleeHit", if: [GREATSWORD, CHARGED], then: { kind: "addPoise", magnitude: K.heavyOath.poise } },
      {
        when: "onMeleeHit",
        if: [GREATSWORD, { kind: "not", condition: CHARGED }],
        then: { kind: "selfStatus", status: "weaken", magnitude: NO_AMOUNT, duration: K.heavyOath.weaken },
        icd: K.heavyOath.icd,
      },
    ]),
  },
  drenched: {
    key: "drenched",
    name: "濡れ鼠",
    desc: `水たまりに踏み込むと気力が満ちる（${K.drenched.icd}秒に1回）。その代わり、自分に濡れが${K.drenched.wetStacks}つ付く。`,
    icon: "鼠",
    tags: ["mana", "terrain"],
    gives: ["mana"],
    keywords: kw(["mana"], ["placed"]),
    cursed: true,
    rules: rulesOf("drenched", [
      { when: "onTerrainEnter", if: [WATER], then: { kind: "restoreMana", magnitude: K.drenched.mana }, icd: K.drenched.icd },
      {
        when: "onTerrainEnter",
        if: [WATER],
        then: { kind: "selfStatus", status: "wet", magnitude: NO_AMOUNT, count: K.drenched.wetStacks, duration: K.drenched.wetTime },
        icd: K.drenched.icd,
      },
    ]),
  },

  // ---------------------------------------------------------------------------
  // 芯（1 ランに 1 つ。深度 BOON.coreDepth の最初の提示だけに出る。数値・割り込みは system/boonCores.ts）
  // ---------------------------------------------------------------------------
  coreCurseEater: {
    key: "coreCurseEater",
    name: "呪い喰い",
    desc:
      `以後の3択に必ず呪い付きが1枚混ざる。持っている呪い付き1つごとに大祝福・神威が出やすくなる` +
      `（+${pct(BOON.curseEaterGradeShiftPerCurse)}%、最大+${pct(BOON.curseEaterMaxShift)}%）。代わりに呪い付きを手放せない。`,
    icon: "喰",
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
      `コンボ1ごとに与ダメージ+${pct(BOON.tempoPerStack)}%（最大+${pct(BOON.tempoCap)}%）。` +
      `代わりにコンボの猶予が-${pctMul(BOON.tempoWindowMul)}%になり、被弾するとコンボが必ず0になる。`,
    icon: "拍",
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
    tags: ["hp"],
    keywords: kw(["heal"], ["melee"]),
    cursed: false,
    core: true,
    graded: false,
  },
  coreMirage: {
    key: "coreMirage",
    name: "逃げ水",
    desc:
      `ダッシュ回数+${BOON.mirageCharges}、ダッシュの再使用時間-${pctMul(BOON.mirageCooldownMul)}%。ダッシュの終わりに爆発が起こる。` +
      `代わりに移動速度-${pctMul(BOON.mirageMoveMul)}%。`,
    icon: "幻",
    tags: ["dash", "explode"],
    gives: ["explode"],
    keywords: kw(["explode"], ["dash"], ["dash"]),
    cursed: false,
    core: true,
    graded: false,
    rules: rulesOf("coreMirage", [
      { when: "onDashEnd", then: { kind: "explode", magnitude: BOON.mirageBlastRatio, scaleBy: "slashBase", radius: BOON.mirageBlastRadius } },
    ]),
  },
  coreGlass: {
    key: "coreGlass",
    name: "硝子の刃",
    desc: `与ダメージ+${pctMul(BOON.glassDamageMore)}%（倍）。代わりに被ダメージ+${pctMul(BOON.glassDamageTakenMul)}%。`,
    icon: "硝",
    tags: ["melee", "ranged"],
    keywords: kw([], ["hurt"], ["melee", "ranged"]),
    cursed: false,
    core: true,
    graded: false,
    // 威力の倍は出所ごとに掛け算（装備の増とは別枠）。被ダメは foldGlass が stats に畳む
    modifiers: modifiersOf("coreGlass", [{ kind: "more", tag: "all", amount: BOON.glassDamageMore, if: [] }]),
  },
  coreHeavy: {
    key: "coreHeavy",
    name: "重心",
    desc:
      `敵への怯み値+${pctMul(BOON.heavyPoiseMul)}%、ノックバック+${pctMul(BOON.heavyKnockbackMul)}%。` +
      `代わりに攻撃速度-${pctMul(BOON.heavyAttackSpeedMul)}%。`,
    icon: "重",
    tags: ["melee", "stagger"],
    gives: ["stagger"],
    keywords: kw(["stagger"], [], ["melee"]),
    cursed: false,
    core: true,
    graded: false,
  },
  coreWellspring: {
    key: "coreWellspring",
    name: "気の泉",
    desc:
      `最大気力+${BOON.wellspringMana}、気力の獲得+${pctMul(BOON.wellspringManaGainMul)}%。` +
      `代わりに最大生命-${pctMul(BOON.wellspringHpMul)}%。`,
    icon: "泉",
    tags: ["mana", "skill"],
    keywords: kw(["mana"], [], ["mana"]),
    cursed: false,
    core: true,
    graded: false,
  },
  coreGreed: {
    key: "coreGreed",
    name: "銭の亡者",
    desc:
      `銭の獲得+${pctMul(BOON.greedCoinGainMul)}%、銭を引き寄せる範囲+${pctMul(BOON.greedMagnetMul)}%。` +
      `代わりに被弾でこぼれる銭が${BOON.greedSpillMul}倍になる。`,
    icon: "銭",
    tags: ["loot"],
    keywords: kw([], ["hurt"]),
    cursed: false,
    core: true,
    graded: false,
  },
};
