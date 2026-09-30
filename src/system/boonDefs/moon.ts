/**
 * 月蝕の札（docs/ideas/boon-impl.md 2-6。段取り 7b）。boonDefs.ts が BOON_KEYS / BOONS に混ぜる。
 * 旧祝福と同じ key の札は、その key の図鑑の記録を引き継ぐ。
 * ここは型だけを boonDefs.ts から読む（実行時の循環を作らない）
 *
 * 軸は 宣告・遅れて来る傷・生命の代償。旧 月蝕 4 種（月読・満ち潮・新月・月蝕）は輪廻へ写した。
 * 生命の代償は自分に付く出血で払う（動くほど生命が減る）。Rule に生命を直接払う効果が無く、大出血はプレイヤーに付かないため。
 * 出血の強さには格の倍率が掛かる（効果と代償が一緒に重くなる）
 */

import type { EventKind, EventSource } from "../../core/events";
import { kw } from "../../core/keywords";
import { type Modifier, type Rule, type RuleCondition, type RuleEffect, SCOPE_ANY, ruleId } from "../../core/rules";
import { formatMeters } from "../../core/units";
import { BOON, BOON_LINEAGE } from "../../data/tuning";
import type { BoonDef } from "../boonDefs";

export const BOON_KEYS_MOON = [
  "moonVerdict",
  "bloodMist",
  "moonBloodFog",
  "moonBloodRite",
  "moonNightfall",
  "bloodFeast",
  "woundMemory",
  "moonReprieve",
  "moonGrudge",
  "moonJudgment",
  "moonTotality",
] as const;

type MoonKey = (typeof BOON_KEYS_MOON)[number];

const M = BOON_LINEAGE.moon;
const ALWAYS = 1;
const PERCENT = 100;

/** 執行猶予（受けた傷が遅れて来る。combat.ts の damagePlayer が読む） */
export const MOON_REPRIEVE_KEY: MoonKey = "moonReprieve";
/** 皆既（宣告の間の傷がもう一度来る。combat.ts の tickDelayedDamage が読む） */
export const MOON_TOTALITY_KEY: MoonKey = "moonTotality";

// -----------------------------------------------------------------------------
// 組み立て
// -----------------------------------------------------------------------------

interface RuleSpec {
  when: EventKind;
  if?: readonly RuleCondition[];
  then: RuleEffect;
  icd?: number;
  /** 命中ごとの付与（連鎖に数えない。範囲の命中でも全員に付ける） */
  direct?: true;
}

/** 確定発動の Rule。連鎖に乗るものは ICD を BOON.ruleMinIcd 以上に、数えと直接の付与は ICD 0（全部数える・全員に付ける） */
function rulesOf(key: MoonKey, specs: readonly RuleSpec[]): Rule[] {
  const owner: EventSource = { kind: "boon", key };
  return specs.map((s, i) => ({
    id: ruleId(owner, i),
    when: s.when,
    if: s.if ?? [],
    then: s.then,
    chance: ALWAYS,
    icd: ruleIcd(s),
    scope: SCOPE_ANY,
    owner,
    ...(s.direct === true ? { direct: true } : {}),
  }));
}

function ruleIcd(s: Readonly<RuleSpec>): number {
  if (s.then.kind === "tally" || s.direct === true) return s.icd ?? 0;
  return Math.max(BOON.ruleMinIcd, s.icd ?? 0);
}

function modifiersOf(key: MoonKey, specs: readonly Omit<Modifier, "id" | "owner">[]): Modifier[] {
  const owner: EventSource = { kind: "boon", key };
  return specs.map((s, i) => ({ ...s, id: ruleId(owner, i), owner }));
}

function pct(ratio: number): number {
  return Math.round(ratio * PERCENT);
}

/** 生命の代償: 自分に出血（time 秒。動いた 10px ごとに potency ずつ生命が減る） */
function selfBleed(potency: number, time: number): RuleEffect {
  return { kind: "selfStatus", status: "bleed", magnitude: potency, duration: time };
}

const TARGET_DOOMED: RuleCondition = { kind: "targetHas", status: "doom" };
const PRIMARY: RuleCondition = { kind: "lane", lane: "primary" };

/** 皆既: 近接・射撃・スキルの命中すべてに宣告（付け直しでは延びないので、明けるまで次の宣告は付かない） */
const TOTALITY_HITS: readonly EventKind[] = ["onMeleeHit", "onRangedHit", "onSkillHit"];
const TOTALITY_DOOM: RuleEffect = { kind: "afflict", status: "doom", magnitude: 0, duration: M.moonTotality.duration };

// -----------------------------------------------------------------------------
// 札
// -----------------------------------------------------------------------------

export const BOONS_MOON: Readonly<Record<MoonKey, BoonDef>> = {
  // ---- 加護 ----
  moonVerdict: {
    key: "moonVerdict",
    name: "宣告の刃",
    desc: `左の終撃が当たった敵に${M.moonVerdict.duration}秒の宣告。`,
    icon: "宣",
    tags: ["melee"],
    keywords: kw(["vulnerable"], ["finisher"]),
    cursed: false,
    lineage: "moon",
    card: "grace",
    action: "primary",
    changes: "timing",
    rules: rulesOf("moonVerdict", [
      { when: "onFinisher", if: [PRIMARY], then: { kind: "afflict", status: "doom", magnitude: 0, duration: M.moonVerdict.duration } },
    ]),
  },
  bloodMist: {
    key: "bloodMist",
    name: "血閃",
    desc: `右の放出で照準方向へ貫通する血の斬撃波。放つと自分も${M.bloodMist.selfBleedTime}秒出血する。`,
    icon: "閃",
    tags: ["melee", "hp"],
    keywords: kw(["area"], ["hurt"]),
    cursed: false,
    lineage: "moon",
    card: "grace",
    action: "secondary",
    changes: "press",
    rules: rulesOf("bloodMist", [
      { when: "onRelease", then: { kind: "wave", magnitude: M.bloodMist.waveRatio, scaleBy: "slashBase" }, icd: M.bloodMist.icd },
      { when: "onRelease", then: selfBleed(M.bloodMist.selfBleed, M.bloodMist.selfBleedTime), icd: M.bloodMist.icd },
    ]),
  },
  moonBloodFog: {
    key: "moonBloodFog",
    name: "血霧",
    desc: `ダッシュの起点に血の霧: 周り${formatMeters(M.moonBloodFog.radius)}の敵が${M.moonBloodFog.duration}秒出血する。自分も${M.moonBloodFog.selfBleedTime}秒出血する。`,
    icon: "霞",
    tags: ["dash", "bleed", "hp"],
    gives: ["bleed"],
    keywords: kw(["bleed"], ["dash"]),
    cursed: false,
    lineage: "moon",
    card: "grace",
    action: "dash",
    changes: "position",
    rules: rulesOf("moonBloodFog", [
      {
        when: "onDash",
        then: {
          kind: "nearbyEnemies",
          status: "bleed",
          magnitude: M.moonBloodFog.bleedPotency,
          duration: M.moonBloodFog.duration,
          radius: M.moonBloodFog.radius,
          color: M.moonBloodFog.color,
        },
        icd: M.moonBloodFog.icd,
      },
      { when: "onDash", then: selfBleed(M.moonBloodFog.selfBleed, M.moonBloodFog.selfBleedTime), icd: M.moonBloodFog.icd },
    ]),
  },
  moonBloodRite: {
    key: "moonBloodRite",
    name: "血払い",
    desc: `スキルを撃つたび気力が${M.moonBloodRite.mana}戻り、自分は${M.moonBloodRite.selfBleedTime}秒出血する。`,
    icon: "贄",
    tags: ["skill", "mana", "hp"],
    gives: ["mana"],
    keywords: kw(["mana"], ["hurt"]),
    cursed: false,
    lineage: "moon",
    card: "grace",
    action: "skill",
    changes: "press",
    rules: rulesOf("moonBloodRite", [
      { when: "onSkillCast", then: { kind: "restoreMana", magnitude: M.moonBloodRite.mana, quiet: true }, icd: M.moonBloodRite.icd },
      { when: "onSkillCast", then: selfBleed(M.moonBloodRite.selfBleed, M.moonBloodRite.selfBleedTime), icd: M.moonBloodRite.icd },
    ]),
  },
  moonNightfall: {
    key: "moonNightfall",
    name: "落月",
    desc: `奥義を撃つと周り${formatMeters(M.moonNightfall.radius)}の敵すべてに${M.moonNightfall.duration}秒の宣告。`,
    icon: "夜",
    tags: ["energy"],
    keywords: kw(["vulnerable"], ["energy"]),
    cursed: false,
    lineage: "moon",
    card: "grace",
    action: "ultimate",
    changes: "timing",
    rules: rulesOf("moonNightfall", [
      {
        when: "onBurst",
        then: { kind: "nearbyEnemies", status: "doom", magnitude: 0, duration: M.moonNightfall.duration, radius: M.moonNightfall.radius, color: BOON.ruleTextColor },
      },
    ]),
  },
  // ---- 摂理 ----
  bloodFeast: {
    key: "bloodFeast",
    name: "血の饗宴",
    // ハートが出ないのは boons.ts の boonHeartsAllowed（旧フック。key で見る）
    desc: `撃破するたび生命が${M.bloodFeast.heal}回復する（戦闘中の回復の上限を通さない）。ハートが出なくなる。`,
    icon: "饗",
    tags: ["hp"],
    keywords: kw(["heal"], ["kill"]),
    cursed: false,
    lineage: "moon",
    card: "law",
    changes: "target",
    rules: rulesOf("bloodFeast", [{ when: "onKill", then: { kind: "healDirect", magnitude: M.bloodFeast.heal, quiet: true } }]),
  },
  woundMemory: {
    key: "woundMemory",
    name: "傷の記憶",
    desc: `被弾すると、攻撃してきた敵が${M.woundMemory.duration}秒間脆弱になる。`,
    icon: "傷",
    tags: ["hp", "vulnerable"],
    gives: ["vulnerable"],
    keywords: kw(["vulnerable"], ["hurt"]),
    cursed: false,
    lineage: "moon",
    card: "law",
    changes: "target",
    rules: rulesOf("woundMemory", [
      { when: "onHurt", then: { kind: "afflict", status: "vulnerable", magnitude: 0, duration: M.woundMemory.duration }, direct: true },
    ]),
  },
  moonReprieve: {
    key: "moonReprieve",
    name: "執行猶予",
    // 効果は combat.ts の damagePlayer（Player.deferredDamage）と tickDelayedDamage
    desc: `受けた傷が${M.moonReprieve.delay}秒遅れて来る。`,
    icon: "猶",
    tags: ["hp"],
    // 遅れて来る傷は、来る前の回復で間に合わせる（回復を食う。旧 heartBurn の食いの後継）
    keywords: kw([], ["hurt", "heal"], ["heal"]),
    cursed: false,
    lineage: "moon",
    card: "law",
    changes: "timing",
    graded: false,
  },
  // ---- 研鑽 ----
  moonGrudge: {
    key: "moonGrudge",
    name: "怨恨",
    desc: `受けた傷${M.moonGrudge.every}につき、放出の一撃の与ダメ+${pct(M.moonGrudge.amount)}%（上限なし）。`,
    icon: "怨",
    tags: ["hp"],
    keywords: kw([], ["hurt"]),
    cursed: false,
    lineage: "moon",
    card: "temper",
    changes: "watch",
    rules: rulesOf("moonGrudge", [{ when: "onHurt", then: { kind: "tally", magnitude: 1, scaleBy: "eventAmount", key: "moonGrudge" } }]),
    modifiers: modifiersOf("moonGrudge", [
      { kind: "more", tag: "release", amount: M.moonGrudge.amount, per: { count: { kind: "tally", key: "moonGrudge" }, every: M.moonGrudge.every }, if: [] },
    ]),
  },
  moonJudgment: {
    key: "moonJudgment",
    name: "判決",
    desc: `宣告の敵を倒した${M.moonJudgment.every}体につき、宣告の敵への与ダメ+${pct(M.moonJudgment.amount)}%（上限なし）。`,
    icon: "判",
    tags: ["vulnerable"],
    keywords: kw([], ["kill", "vulnerable"]),
    cursed: false,
    lineage: "moon",
    card: "temper",
    changes: "watch",
    rules: rulesOf("moonJudgment", [{ when: "onKill", if: [TARGET_DOOMED], then: { kind: "tally", magnitude: 1, key: "moonJudgment" } }]),
    modifiers: modifiersOf("moonJudgment", [
      {
        kind: "more",
        tag: "all",
        amount: M.moonJudgment.amount,
        per: { count: { kind: "tally", key: "moonJudgment" }, every: M.moonJudgment.every },
        if: [TARGET_DOOMED],
      },
    ]),
  },
  // ---- 真髄 ----
  moonTotality: {
    key: "moonTotality",
    name: "皆既",
    // 宣告の間の傷は combat.ts の tickDelayedDamage が Enemy.vault（doom）に写し、明けた時に出す
    desc: `命中した敵すべてに${M.moonTotality.duration}秒の宣告。宣告が明けると、その間に与えた傷の${pct(M.moonTotality.echoRatio)}%がもう一度来る。`,
    icon: "皆",
    tags: ["melee", "ranged", "skill"],
    keywords: kw(["vulnerable"], ["melee", "ranged"]),
    cursed: false,
    lineage: "moon",
    card: "apex",
    changes: "timing",
    graded: false,
    rules: rulesOf(
      "moonTotality",
      TOTALITY_HITS.map((when): RuleSpec => ({ when, then: TOTALITY_DOOM, direct: true })),
    ),
  },
};
