/**
 * 灰燼の札（docs/ideas/boon-impl.md 2-6。段取り 7b）。boonDefs.ts が BOON_KEYS / BOONS に混ぜる。
 * 旧祝福と同じ key の札は、その key の図鑑の記録を引き継ぐ。
 * ここは型だけを boonDefs.ts から読む（実行時の循環を作らない）
 */

import type { EventKind, EventSource } from "../../core/events";
import { kw } from "../../core/keywords";
import { type Modifier, type Rule, type RuleCondition, type RuleEffect, SCOPE_ANY, ruleId } from "../../core/rules";
import type { StatusKind } from "../../core/status";
import { formatMeters } from "../../core/units";
import { BOON, BOON_LINEAGE } from "../../data/tuning";
import type { BoonDef } from "../boonDefs";

export const BOON_KEYS_ASH = [
  // ---- 加護（左 / 右 / ダッシュ / スキル / 奥義） ----
  "emberSeed",
  "ashCircle",
  "fireWalk",
  "firePillar",
  "scorchedEarth",
  // ---- 摂理 ----
  "wildfire",
  "burnSpread",
  "embers",
  // ---- 研鑽 ----
  "ashCinder",
  "ashBlaze",
  // ---- 真髄 ----
  "ashInferno",
] as const;

type AshKey = (typeof BOON_KEYS_ASH)[number];

const L = BOON_LINEAGE.ash;

// -----------------------------------------------------------------------------
// 組み立て（確定発動。ICD は BOON.ruleMinIcd 以上。数えだけの Rule は ICD 0 で全部数える）
// -----------------------------------------------------------------------------

interface RuleSpec {
  when: EventKind;
  if?: readonly RuleCondition[];
  then: RuleEffect;
  icd?: number;
  /** 同じ鍵の Rule は ICD を分け合う（延焼の 3 つの起点で 1 つの CD） */
  icdKey?: string;
}

const ALWAYS = 1;
/** 量を持たない効果（地形を置く）の magnitude。格は半径にだけ掛かる */
const NO_AMOUNT = 0;
const PERCENT = 100;

function rulesOf(key: AshKey, specs: readonly RuleSpec[]): Rule[] {
  const owner: EventSource = { kind: "boon", key };
  return specs.map((s, i) => ({
    id: ruleId(owner, i),
    when: s.when,
    if: s.if ?? [],
    then: s.then,
    chance: ALWAYS,
    icd: s.then.kind === "tally" ? 0 : Math.max(BOON.ruleMinIcd, s.icd ?? 0),
    scope: SCOPE_ANY,
    owner,
    ...(s.icdKey === undefined ? {} : { icdKey: s.icdKey }),
  }));
}

function modifiersOf(key: AshKey, specs: readonly Omit<Modifier, "id" | "owner">[]): Modifier[] {
  const owner: EventSource = { kind: "boon", key };
  return specs.map((s, i) => ({ ...s, id: ruleId(owner, i), owner }));
}

function targetHas(status: StatusKind): RuleCondition {
  return { kind: "targetHas", status };
}

/** 自分が付けた状態異常（地形・敵が付けたものは数えない） */
function appliedByMe(status: StatusKind): readonly RuleCondition[] {
  return [
    { kind: "eventTag", tag: status },
    { kind: "actor", actor: "player" },
  ];
}

const PRIMARY: RuleCondition = { kind: "lane", lane: "primary" };

function pct(ratio: number): number {
  return Math.round(ratio * PERCENT);
}

/** 燃焼を付ける（強さは近接 1 段目の威力の割合。装備の燃焼の方が強ければそちら） */
function burnOn(dpsRatio: number, duration: number): RuleEffect {
  return { kind: "afflict", status: "burn", magnitude: dpsRatio, scaleBy: "slashBase", statFloor: "burnDps", duration };
}

function fireAt(radius: number, duration: number): RuleEffect {
  return { kind: "placeTerrain", terrain: "fire", magnitude: NO_AMOUNT, radius, duration };
}

// -----------------------------------------------------------------------------
// 札
// -----------------------------------------------------------------------------

export const BOONS_ASH: Readonly<Record<AshKey, BoonDef>> = {
  emberSeed: {
    key: "emberSeed",
    name: "火種",
    desc: `攻撃 1 の終撃が当たると燃焼を付ける（${L.emberSeed.duration}秒）。`,
    icon: "火",
    tags: ["burn", "melee", "element"],
    keywords: kw(["burn"], ["finisher"]),
    gives: ["burn"],
    cursed: false,
    lineage: "ash",
    card: "grace",
    action: "primary",
    changes: "timing",
    rules: rulesOf("emberSeed", [{ when: "onFinisher", if: [PRIMARY], then: burnOn(L.emberSeed.dpsRatio, L.emberSeed.duration) }]),
  },
  ashCircle: {
    key: "ashCircle",
    name: "炎陣",
    desc:
      `放出で足元に半径${formatMeters(L.ashCircle.radius)}の炎を置く（${L.ashCircle.duration}秒、炎は自分も焼く）。` +
      `燃える地形の上に立つ間、与ダメージ+${pct(L.ashCircle.increased)}%。`,
    icon: "陣",
    tags: ["burn", "terrain", "element"],
    keywords: kw(["placed", "burn"], [], ["melee", "ranged"]),
    gives: ["burn", "terrain"],
    cursed: false,
    lineage: "ash",
    card: "grace",
    action: "secondary",
    changes: "position",
    // 効果量を持たないので格は炎の半径にだけ掛かる
    graded: true,
    rules: rulesOf("ashCircle", [{ when: "onRelease", then: fireAt(L.ashCircle.radius, L.ashCircle.duration) }]),
    modifiers: modifiersOf("ashCircle", [
      { kind: "increased", tag: "all", amount: L.ashCircle.increased, if: [{ kind: "selfOnTerrain", terrain: "fire" }] },
    ]),
  },
  fireWalk: {
    key: "fireWalk",
    name: "火渡り",
    desc: `ダッシュで離れた場所に半径${formatMeters(L.fireWalk.radius)}の炎を置く（${L.fireWalk.duration}秒）。`,
    icon: "渡",
    tags: ["burn", "dash", "terrain", "element"],
    keywords: kw(["placed", "burn"], ["dash"]),
    gives: ["burn", "terrain"],
    cursed: false,
    lineage: "ash",
    card: "grace",
    action: "dash",
    changes: "position",
    graded: true,
    // 軌跡の線分に置く効果が無いので、始まりの位置（onDash の位置）の 1 点で近似する。
    // 終わりの位置は自分の足元になり、炎は自分も焼くので置かない
    rules: rulesOf("fireWalk", [{ when: "onDash", then: fireAt(L.fireWalk.radius, L.fireWalk.duration) }]),
  },
  firePillar: {
    key: "firePillar",
    name: "火柱",
    desc:
      `スキルが当たると燃焼を付ける。燃えている敵にスキルが当たると、` +
      `その場で半径${formatMeters(L.firePillar.radius)}の爆発が起こる（${L.firePillar.icd}秒に1回）。`,
    icon: "柱",
    tags: ["burn", "explode", "skill", "element"],
    keywords: kw(["burn", "explode"], ["burn"]),
    gives: ["burn", "explode"],
    cursed: false,
    lineage: "ash",
    card: "grace",
    action: "skill",
    changes: "timing",
    rules: rulesOf("firePillar", [
      { when: "onSkillHit", then: burnOn(L.firePillar.dpsRatio, L.firePillar.duration) },
      {
        when: "onSkillHit",
        if: [targetHas("burn")],
        then: { kind: "explode", magnitude: L.firePillar.ratio, scaleBy: "slashBase", radius: L.firePillar.radius },
        icd: L.firePillar.icd,
      },
    ]),
  },
  scorchedEarth: {
    key: "scorchedEarth",
    name: "焦土",
    desc: `奥義で半径${formatMeters(L.scorchedEarth.radius)}の燃焼を起爆し、残りの燃焼ダメージの${L.scorchedEarth.detonateMul}倍を即座に与える。`,
    icon: "焦",
    tags: ["burn", "energy", "element"],
    keywords: kw(["explode"], ["burn", "energy"]),
    cursed: false,
    lineage: "ash",
    card: "grace",
    action: "ultimate",
    changes: "timing",
    rules: rulesOf("scorchedEarth", [
      { when: "onBurst", then: { kind: "detonate", status: "burn", magnitude: L.scorchedEarth.detonateMul, radius: L.scorchedEarth.radius } },
    ]),
  },
  wildfire: {
    key: "wildfire",
    name: "延焼",
    desc:
      `燃えている敵に近接・射撃・スキルを当てると、半径${formatMeters(L.wildfire.radius)}の敵へ` +
      `燃焼が移る（強さ${pct(L.wildfire.potency)}%、${L.wildfire.icd}秒に1回）。`,
    icon: "延",
    tags: ["burn", "element"],
    keywords: kw(["burn"], ["burn"]),
    gives: ["burn"],
    cursed: false,
    lineage: "ash",
    card: "law",
    changes: "target",
    rules: rulesOf(
      "wildfire",
      (["onMeleeHit", "onRangedHit", "onSkillHit"] as const).map((when) => ({
        when,
        if: [targetHas("burn")],
        then: { kind: "spreadStatus", status: "burn", magnitude: L.wildfire.potency, radius: L.wildfire.radius, duration: L.wildfire.duration },
        icd: L.wildfire.icd,
        icdKey: "boon:wildfire",
      })),
    ),
  },
  burnSpread: {
    key: "burnSpread",
    name: "野火",
    desc: `燃えている敵を倒すと、半径${formatMeters(L.burnSpread.radius)}の敵へ燃焼を重ねごと移す。`,
    icon: "F",
    tags: ["burn", "element"],
    keywords: kw(["burn"], ["burn", "kill"]),
    gives: ["burn"],
    cursed: false,
    lineage: "ash",
    card: "law",
    changes: "target",
    rules: rulesOf("burnSpread", [
      {
        when: "onKill",
        if: [targetHas("burn")],
        then: {
          kind: "spreadStatus",
          status: "burn",
          magnitude: L.burnSpread.potency,
          radius: L.burnSpread.radius,
          duration: L.burnSpread.duration,
          inherit: true,
        },
      },
    ]),
  },
  embers: {
    key: "embers",
    name: "燠火",
    desc: `燃えている敵を倒すと、その場に半径${formatMeters(L.embers.radius)}の炎が残る（${L.embers.duration}秒）。`,
    icon: "燠",
    tags: ["burn", "terrain", "element"],
    keywords: kw(["placed", "burn"], ["burn", "kill"]),
    gives: ["burn", "terrain"],
    cursed: false,
    lineage: "ash",
    card: "law",
    changes: "position",
    graded: true,
    rules: rulesOf("embers", [{ when: "onKill", if: [targetHas("burn")], then: fireAt(L.embers.radius, L.embers.duration) }]),
  },
  ashCinder: {
    key: "ashCinder",
    name: "余燼",
    desc:
      `燃えている敵を倒すたびに育つ。${L.ashCinder.every}体ごとに、` +
      `燃えている敵への与ダメージ×${1 + L.ashCinder.perStep}（上限なし）。`,
    icon: "燼",
    tags: ["burn", "element"],
    keywords: kw([], ["burn", "kill"], ["burn"]),
    cursed: false,
    lineage: "ash",
    card: "temper",
    changes: "watch",
    // 数えと常時の倍は格を持たない（育ち方は行動の数で決まる）
    graded: false,
    rules: rulesOf("ashCinder", [{ when: "onKill", if: [targetHas("burn")], then: { kind: "tally", magnitude: 1, key: "ashCinder" } }]),
    modifiers: modifiersOf("ashCinder", [
      {
        kind: "more",
        tag: "all",
        amount: L.ashCinder.perStep,
        per: { count: { kind: "tally", key: "ashCinder" }, every: L.ashCinder.every },
        if: [targetHas("burn")],
      },
    ]),
  },
  ashBlaze: {
    key: "ashBlaze",
    name: "火勢",
    desc: `燃焼を付けるたびに育つ。${L.ashBlaze.every}回ごとに、付ける状態異常の強さ+${pct(L.ashBlaze.perStep)}%（上限なし）。`,
    icon: "勢",
    tags: ["burn", "element"],
    keywords: kw([], ["burn"], ["burn"]),
    cursed: false,
    lineage: "ash",
    card: "temper",
    changes: "watch",
    graded: false,
    rules: rulesOf("ashBlaze", [{ when: "onStatusApplied", if: appliedByMe("burn"), then: { kind: "tally", magnitude: 1, key: "ashBlaze" } }]),
    temperStat: { tally: "ashBlaze", stat: "statusPotencyMul", per: L.ashBlaze.perStep, every: L.ashBlaze.every },
  },
  ashInferno: {
    key: "ashInferno",
    name: "劫火",
    desc:
      `燃焼の重ね1につき、その敵への与ダメージ×${1 + L.ashInferno.stackMore}。` +
      `燃えている敵を倒すと、半径${formatMeters(L.ashInferno.radius)}の敵へ燃焼を重ねごと移す。`,
    icon: "劫",
    tags: ["burn", "element"],
    keywords: kw(["burn"], ["burn", "kill"], ["burn"]),
    gives: ["burn"],
    cursed: false,
    lineage: "ash",
    card: "apex",
    changes: "target",
    // 設計の「燃焼の重ねの上限を外す」は PlayerStats に重ねの上限の口が要る（編集禁止）。重ねにつく倍で近似する
    rules: rulesOf("ashInferno", [
      {
        when: "onKill",
        if: [targetHas("burn")],
        then: {
          kind: "spreadStatus",
          status: "burn",
          magnitude: L.ashInferno.potency,
          radius: L.ashInferno.radius,
          duration: L.ashInferno.duration,
          inherit: true,
        },
      },
    ]),
    modifiers: modifiersOf("ashInferno", [
      { kind: "more", tag: "all", amount: L.ashInferno.stackMore, per: { count: { kind: "targetStacks", status: "burn" } }, if: [] },
    ]),
  },
};
