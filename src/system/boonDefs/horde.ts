/**
 * 眷属の札（docs/ideas/boon-impl.md 2-6。段取り 7b）。boonDefs.ts が BOON_KEYS / BOONS に混ぜる。
 * 旧祝福と同じ key の札は、その key の図鑑の記録を引き継ぐ。
 * ここは型だけを boonDefs.ts から読む（実行時の循環を作らない）。
 * 軸は従魔（味方にした敵。Enemy.allyUntil、AI は system/enemies.ts の updateAlly）と設置物。
 * 歩く杭・十字砲火は skills/placed.ts、采配の狙いは skills/summons.ts（砲台）と enemies.ts（従魔）が読む
 */

import type { EventKind, EventSource } from "../../core/events";
import { kw } from "../../core/keywords";
import { type Modifier, type Rule, type RuleCondition, type RuleEffect, SCOPE_ANY, ruleId } from "../../core/rules";
import { BOON, BOON_LINEAGE } from "../../data/tuning";
import type { BoonDef } from "../boonDefs";

export const BOON_KEYS_HORDE = [
  "rallyCall",
  "offering",
  "walkingStake",
  "lingerOn",
  "thrall",
  "crossfire",
  "packLeader",
  "guardian",
  "hordeTally",
  "stakeTally",
  "hundredDemons",
] as const;

type HordeKey = (typeof BOON_KEYS_HORDE)[number];

const H = BOON_LINEAGE.horde;

/** 群: 従魔・設置物の数の最高記録 */
export const HORDE_TALLY = "horde";
/** 杭: スキルを撃つたびに数える場の設置物・従魔の数の合計 */
export const STAKE_TALLY = "stake";

interface RuleSpec {
  when: EventKind;
  if?: readonly RuleCondition[];
  then: RuleEffect;
  icd?: number;
}

const ALWAYS = 1;
const NO_AMOUNT = 0;
const PERCENT = 100;
const PRIMARY: RuleCondition = { kind: "lane", lane: "primary" };
/** 従魔・設置物が 1 つ以上いる */
const HAS_MINION: RuleCondition = { kind: "counter", counter: { kind: "minions" }, atLeast: 1 };

/** 確定発動の Rule。数え（tally）以外の ICD は BOON.ruleMinIcd を下限にする */
function rulesOf(key: HordeKey, specs: readonly RuleSpec[]): Rule[] {
  const owner: EventSource = { kind: "boon", key };
  return specs.map((s, i) => ({
    id: ruleId(owner, i),
    when: s.when,
    if: s.if ?? [],
    then: s.then,
    chance: ALWAYS,
    icd: s.then.kind === "tally" ? (s.icd ?? 0) : Math.max(BOON.ruleMinIcd, s.icd ?? 0),
    scope: SCOPE_ANY,
    owner,
  }));
}

function modifiersOf(key: HordeKey, specs: readonly Pick<Modifier, "kind" | "tag" | "amount" | "per">[]): Modifier[] {
  const owner: EventSource = { kind: "boon", key };
  return specs.map((s, i) => ({ ...s, id: ruleId(owner, i), if: [], owner }));
}

function pct(ratio: number): number {
  return Math.round(ratio * PERCENT);
}

export const BOONS_HORDE: Readonly<Record<HordeKey, BoonDef>> = {
  // ---- 加護（左 / 右 / ダッシュ / スキル / 奥義） ----
  rallyCall: {
    key: "rallyCall",
    name: "采配",
    desc: `左の通常攻撃が当たると、従魔と砲台が${H.rallyCall.duration}秒間その敵を狙う。`,
    icon: "采",
    tags: ["placed", "melee"],
    keywords: kw([], ["melee"], ["placed"]),
    cursed: false,
    lineage: "horde",
    card: "grace",
    action: "primary",
    changes: "target",
    rules: rulesOf("rallyCall", [
      { when: "onSwingHit", if: [PRIMARY], then: { kind: "retarget", magnitude: NO_AMOUNT, duration: H.rallyCall.duration }, icd: H.rallyCall.icd },
    ]),
  },
  offering: {
    key: "offering",
    name: "供物",
    desc: `戦意を使うと、最も近い自分の設置物が爆ぜる（近接1段目の威力の${pct(H.offering.ratio)}%）。`,
    icon: "供",
    tags: ["placed", "explode"],
    keywords: kw(["explode"], ["placed"]),
    gives: ["explode"],
    cursed: false,
    lineage: "horde",
    card: "grace",
    action: "secondary",
    changes: "press",
    rules: rulesOf("offering", [
      {
        when: "onRelease",
        then: { kind: "detonatePlaced", magnitude: H.offering.ratio, scaleBy: "slashBase", radius: H.offering.radius, count: H.offering.count },
        icd: H.offering.icd,
      },
    ]),
  },
  walkingStake: {
    key: "walkingStake",
    name: "歩く杭",
    // 効果は skills/placed.ts の followDash（ダッシュの終わりを見て設置物を動かす）
    desc: "ダッシュを終えると、最も近い自分の設置物が足元へ移る。",
    icon: "歩",
    tags: ["placed", "dash"],
    keywords: kw([], ["dash"], ["placed"]),
    cursed: false,
    lineage: "horde",
    card: "grace",
    action: "dash",
    changes: "position",
  },
  lingerOn: {
    key: "lingerOn",
    name: "居残り",
    // 符の名前は skills/modifiers.ts の linger（読むと起動時の循環になるので名前だけ書く）
    desc: "装着中の全てのスキルに刻印符「延命」が付く（設置物が長く残る）。",
    icon: "居",
    tags: ["placed", "skill"],
    keywords: kw([], [], ["placed"]),
    cursed: false,
    lineage: "horde",
    card: "grace",
    action: "skill",
    changes: "position",
    grantsModifier: "linger",
  },
  thrall: {
    key: "thrall",
    name: "従魔",
    desc: `奥義を放つと、周りの怯んだ敵を${H.thrall.count}体まで${H.thrall.duration}秒間従える。従魔は他の敵を殴る。`,
    icon: "従",
    tags: ["placed", "stagger", "energy"],
    keywords: kw(["placed"], ["stagger", "energy"]),
    gives: ["placed"],
    cursed: false,
    lineage: "horde",
    card: "grace",
    action: "ultimate",
    changes: "target",
    // 効果量を持たない（半径だけ）ので格の対象を明示する
    graded: true,
    rules: rulesOf("thrall", [
      {
        when: "onBurst",
        then: { kind: "tameEnemy", magnitude: NO_AMOUNT, radius: H.thrall.radius, onlyWith: "stagger", count: H.thrall.count, duration: H.thrall.duration },
      },
    ]),
  },
  // ---- 摂理 ----
  crossfire: {
    key: "crossfire",
    name: "十字砲火",
    // 効果は skills/placed.ts の updateCrossfire
    desc: `自分の設置物どうしが線で結ばれ、線に触れた敵が${H.crossfire.interval}秒ごとに傷つく（近接1段目の威力の${pct(H.crossfire.ratio)}%）。`,
    icon: "十",
    tags: ["placed"],
    keywords: kw(["area"], ["placed"]),
    cursed: false,
    lineage: "horde",
    card: "law",
    changes: "position",
  },
  packLeader: {
    key: "packLeader",
    name: "頭領",
    desc: `従魔・設置物1つにつき与ダメージ+${pct(H.packLeader.amount)}%（最大+${pct(H.packLeader.cap)}%）。`,
    icon: "頭",
    tags: ["placed"],
    keywords: kw([], ["placed"], ["melee", "ranged"]),
    cursed: false,
    lineage: "horde",
    card: "law",
    changes: "watch",
    modifiers: modifiersOf("packLeader", [
      { kind: "increased", tag: "all", amount: H.packLeader.amount, per: { count: { kind: "minions" }, every: H.packLeader.every, cap: H.packLeader.cap } },
    ]),
  },
  guardian: {
    key: "guardian",
    name: "庇い手",
    desc: `従魔・設置物がいる間に被弾すると、失った生命をすぐ取り戻す（${H.guardian.icd}秒に1回）。`,
    icon: "庇",
    tags: ["placed", "hp"],
    keywords: kw(["heal"], ["hurt", "placed"]),
    cursed: false,
    lineage: "horde",
    card: "law",
    changes: "position",
    // 設計の「従魔が肩代わり」は被ダメージの分岐（combat.ts）が要るので、リゲインを取り戻す効果で近似する
    rules: rulesOf("guardian", [{ when: "onHurt", if: [HAS_MINION], then: { kind: "reclaim", magnitude: NO_AMOUNT }, icd: H.guardian.icd }]),
  },
  // ---- 研鑽 ----
  hordeTally: {
    key: "hordeTally",
    name: "軍勢",
    desc: `敵を倒すたび、従魔・設置物の数の最高を記録する。${H.hordeTally.every}につき従魔の与ダメージ×${1 + H.hordeTally.amount}（上限なし）。`,
    icon: "衆",
    tags: ["placed"],
    keywords: kw([], ["kill"], ["placed"]),
    cursed: false,
    lineage: "horde",
    card: "temper",
    changes: "watch",
    rules: rulesOf("hordeTally", [
      { when: "onKill", then: { kind: "tally", magnitude: 1, key: HORDE_TALLY, mode: "max", scaleBy: "counter", counter: { kind: "minions" } } },
    ]),
    modifiers: modifiersOf("hordeTally", [
      { kind: "more", tag: "minion", amount: H.hordeTally.amount, per: { count: { kind: "tally", key: HORDE_TALLY }, every: H.hordeTally.every } },
    ]),
  },
  stakeTally: {
    key: "stakeTally",
    name: "林立",
    desc: `スキルを撃つたび、場の従魔・設置物の数を数える。${H.stakeTally.every}につきスキルの与ダメージ+${pct(H.stakeTally.amount)}%（上限なし）。`,
    icon: "杭",
    tags: ["placed", "skill"],
    keywords: kw([], ["placed"], ["placed"]),
    cursed: false,
    lineage: "horde",
    card: "temper",
    changes: "watch",
    rules: rulesOf("stakeTally", [
      { when: "onSkillCast", then: { kind: "tally", magnitude: 1, key: STAKE_TALLY, scaleBy: "counter", counter: { kind: "minions" } } },
    ]),
    modifiers: modifiersOf("stakeTally", [
      { kind: "increased", tag: "skill", amount: H.stakeTally.amount, per: { count: { kind: "tally", key: STAKE_TALLY }, every: H.stakeTally.every } },
    ]),
  },
  // ---- 真髄 ----
  hundredDemons: {
    key: "hundredDemons",
    name: "百鬼",
    desc: `従魔・設置物がいる間に敵を倒すと、その周りの怯んだ敵が${H.hundredDemons.duration}秒間従う（同時に${H.hundredDemons.count}体まで）。`,
    icon: "鬼",
    tags: ["placed", "stagger"],
    keywords: kw(["placed"], ["kill", "stagger"]),
    gives: ["placed"],
    cursed: false,
    lineage: "horde",
    card: "apex",
    changes: "target",
    graded: true,
    // 設計の「従魔が倒した敵も従う」は倒した敵がもういないので、倒した場所の怯んだ敵を従える形で近似する
    rules: rulesOf("hundredDemons", [
      {
        when: "onKill",
        if: [HAS_MINION],
        then: {
          kind: "tameEnemy",
          magnitude: NO_AMOUNT,
          radius: H.hundredDemons.radius,
          onlyWith: "stagger",
          count: H.hundredDemons.count,
          duration: H.hundredDemons.duration,
        },
      },
    ]),
  },
};
