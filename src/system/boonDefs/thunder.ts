/**
 * 雷鳴の札（docs/ideas/boon-impl.md 2-6。段取り 7b）。boonDefs.ts が BOON_KEYS / BOONS に混ぜる。
 * 旧祝福と同じ key の札は、その key の図鑑の記録を引き継ぐ。
 * ここは型だけを boonDefs.ts から読む（実行時の循環を作らない）
 */

import type { EventKind, EventSource } from "../../core/events";
import { kw } from "../../core/keywords";
import { type Modifier, type Rule, type RuleCondition, type RuleEffect, SCOPE_ANY, ruleId } from "../../core/rules";
import type { StatusKind } from "../../core/status";
import { formatMeters } from "../../core/units";
import { BOON, BOON_LINEAGE, STATUS } from "../../data/tuning";
import type { BoonDef } from "../boonDefs";

export const BOON_KEYS_THUNDER = [
  // ---- 加護（左 / 右 / ダッシュ / スキル / 奥義） ----
  "chargedBlade",
  "boltDrop",
  "staticDash",
  "thunderLeap",
  "thunderDrum",
  // ---- 摂理 ----
  "critChain",
  "thunderMark",
  "collapseChain",
  // ---- 研鑽 ----
  "thunderLink",
  "thunderCharge",
  // ---- 真髄 ----
  "thunderReturn",
] as const;

type ThunderKey = (typeof BOON_KEYS_THUNDER)[number];

const L = BOON_LINEAGE.thunder;

// -----------------------------------------------------------------------------
// 組み立て（確定発動。ICD は BOON.ruleMinIcd 以上。数えだけの Rule は ICD 0 で全部数える）
// -----------------------------------------------------------------------------

interface RuleSpec {
  when: EventKind;
  if?: readonly RuleCondition[];
  then: RuleEffect;
  icd?: number;
}

const ALWAYS = 1;
const PERCENT = 100;

function rulesOf(key: ThunderKey, specs: readonly RuleSpec[]): Rule[] {
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
  }));
}

function modifiersOf(key: ThunderKey, specs: readonly Omit<Modifier, "id" | "owner">[]): Modifier[] {
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

/** 対象の敵から連鎖する雷（対象には飛ばない） */
function chainFromTarget(ratio: number): RuleEffect {
  return { kind: "chainLightning", magnitude: ratio, scaleBy: "slashBase", excludeTarget: true };
}

/** 感電の強さ（感電の連鎖のダメージ）。装備の感電の方が強ければそちら */
function shockOf(ratio: number, stacks: number, duration: number): Pick<RuleEffect, "status" | "magnitude" | "scaleBy" | "statFloor" | "count" | "duration"> {
  return { status: "shock", magnitude: ratio, scaleBy: "slashBase", statFloor: "shockDamage", count: stacks, duration };
}

// -----------------------------------------------------------------------------
// 札
// -----------------------------------------------------------------------------

export const BOONS_THUNDER: Readonly<Record<ThunderKey, BoonDef>> = {
  chargedBlade: {
    key: "chargedBlade",
    name: "帯電の刃",
    desc: `攻撃 1 の振りが当たると、その敵から連鎖する雷が走る（${L.chargedBlade.icd}秒に1回）。`,
    icon: "刃",
    tags: ["shock", "melee", "element"],
    keywords: kw(["shock"], ["melee"]),
    gives: ["shock"],
    cursed: false,
    lineage: "thunder",
    card: "grace",
    action: "primary",
    changes: "target",
    rules: rulesOf("chargedBlade", [{ when: "onSwingHit", if: [PRIMARY], then: chainFromTarget(L.chargedBlade.ratio), icd: L.chargedBlade.icd }]),
  },
  boltDrop: {
    key: "boltDrop",
    name: "雷落とし",
    desc: "応手のたびに相手へ雷が落ち、感電を付ける。",
    icon: "雷",
    tags: ["shock", "counter", "element"],
    // 障壁（構え・無敵）で受けた応手も食う（網の行き止まりにしない。旧 glassJust の食いの後継）
    keywords: kw(["shock"], ["counter", "ward"]),
    gives: ["shock"],
    cursed: false,
    lineage: "thunder",
    card: "grace",
    action: "secondary",
    changes: "timing",
    rules: rulesOf("boltDrop", [
      { when: "onRiposte", then: { kind: "strike", magnitude: L.boltDrop.ratio, scaleBy: "slashBase" }, icd: L.boltDrop.icd },
      {
        when: "onRiposte",
        then: { kind: "afflict", ...shockOf(L.boltDrop.shockRatio, L.boltDrop.stacks, L.boltDrop.duration) },
        icd: L.boltDrop.icd,
      },
    ]),
  },
  staticDash: {
    key: "staticDash",
    name: "静電気",
    desc: "ダッシュの終わりに、自分から連鎖する雷を放つ。",
    icon: "静",
    tags: ["shock", "dash", "element"],
    keywords: kw(["shock"], ["dash"]),
    gives: ["shock"],
    cursed: false,
    lineage: "thunder",
    card: "grace",
    action: "dash",
    changes: "position",
    rules: rulesOf("staticDash", [{ when: "onDashEnd", then: { kind: "chainLightning", magnitude: L.staticDash.ratio, scaleBy: "slashBase" } }]),
  },
  thunderLeap: {
    key: "thunderLeap",
    name: "雷跳ね",
    desc: `スキルが当たると、その敵から連鎖する雷が走る（${L.thunderLeap.icd}秒に1回）。`,
    icon: "迸",
    tags: ["shock", "skill", "element"],
    keywords: kw(["shock"], ["mana"]),
    gives: ["shock"],
    cursed: false,
    lineage: "thunder",
    card: "grace",
    action: "skill",
    changes: "target",
    // 設計は全スロットに刻印符「連鎖」を足す grantsModifier（`skills/modifiers.ts` の連鎖）だが、ここでは同じ効き目の Rule で書いている
    rules: rulesOf("thunderLeap", [{ when: "onSkillHit", then: chainFromTarget(L.thunderLeap.ratio), icd: L.thunderLeap.icd }]),
  },
  thunderDrum: {
    key: "thunderDrum",
    name: "雷神の鼓",
    desc: `奥義で半径${formatMeters(L.thunderDrum.radius)}の敵すべてに感電を${L.thunderDrum.stacks}重ね、自分から連鎖する雷を放つ。`,
    icon: "鼓",
    tags: ["shock", "paralyze", "energy", "element"],
    keywords: kw(["shock"], ["energy"]),
    gives: ["shock"],
    cursed: false,
    lineage: "thunder",
    card: "grace",
    action: "ultimate",
    changes: "timing",
    // 設計の「全方位 6 本」は連鎖雷の本数の口が無いので、範囲の感電（感電の連鎖が周りへ跳ぶ）+ 1 本で近似する
    rules: rulesOf("thunderDrum", [
      {
        when: "onBurst",
        then: {
          kind: "nearbyEnemies",
          ...shockOf(L.thunderDrum.shockRatio, L.thunderDrum.stacks, L.thunderDrum.duration),
          radius: L.thunderDrum.radius,
          color: STATUS.shockColor,
        },
      },
      { when: "onBurst", then: { kind: "chainLightning", magnitude: L.thunderDrum.ratio, scaleBy: "slashBase" } },
    ]),
  },
  critChain: {
    key: "critChain",
    name: "会心雷撃",
    desc: `会心の一撃で、その敵から連鎖する雷が走る（会心のダメージの${pct(L.critChain.critRatio)}%、${L.critChain.icd}秒に1回）。`,
    icon: "A",
    tags: ["crit", "shock", "element"],
    keywords: kw(["shock"], ["crit"]),
    gives: ["shock"],
    cursed: false,
    lineage: "thunder",
    card: "law",
    changes: "target",
    rules: rulesOf("critChain", [
      {
        when: "onCrit",
        then: { kind: "chainLightning", magnitude: L.critChain.critRatio, scaleBy: "eventAmount", excludeTarget: true },
        icd: L.critChain.icd,
      },
    ]),
  },
  thunderMark: {
    key: "thunderMark",
    name: "落雷予告",
    desc: "敵を麻痺させると、その敵に雷が落ちる。",
    icon: "落",
    tags: ["shock", "paralyze", "element"],
    keywords: kw(["shock"], ["shock"]),
    cursed: false,
    lineage: "thunder",
    card: "law",
    changes: "timing",
    // 設計の「1 秒後に落ちる」は遅れて起きる味方の効果が無い（hazardBomb は自分も巻き込む）ので、麻痺の瞬間の追撃で近似する
    rules: rulesOf("thunderMark", [
      { when: "onStatusApplied", if: appliedByMe("paralyze"), then: { kind: "strike", magnitude: L.thunderMark.ratio, scaleBy: "slashBase" } },
    ]),
  },
  collapseChain: {
    key: "collapseChain",
    name: "崩雷",
    desc: `敵を怯ませると、その敵から連鎖する雷が走る（${L.collapseChain.icd}秒に1回）。`,
    icon: "鎖",
    tags: ["stagger", "shock", "element"],
    keywords: kw(["shock"], ["stagger"]),
    gives: ["shock"],
    cursed: false,
    lineage: "thunder",
    card: "law",
    changes: "target",
    rules: rulesOf("collapseChain", [{ when: "onStagger", then: chainFromTarget(L.collapseChain.ratio), icd: L.collapseChain.icd }]),
  },
  thunderLink: {
    key: "thunderLink",
    name: "連雷",
    desc: `感電した敵を倒すたびに育つ。${L.thunderLink.every}体ごとに連鎖係数+${pct(L.thunderLink.perStep)}%（連鎖の先の効果が起きやすい。上限なし）。`,
    icon: "繋",
    tags: ["shock", "element"],
    keywords: kw([], ["shock", "kill"], ["shock"]),
    cursed: false,
    lineage: "thunder",
    card: "temper",
    changes: "watch",
    // 数えと stats は格を持たない（育ち方は行動の数で決まる）
    graded: false,
    // 設計の「連鎖の最長記録」は、数えの Rule から連鎖の長さを読めない（数えは連鎖の外で照合する）ので、感電した敵の撃破で数える
    rules: rulesOf("thunderLink", [{ when: "onKill", if: [targetHas("shock")], then: { kind: "tally", magnitude: 1, key: "thunderLink" } }]),
    temperStat: { tally: "thunderLink", stat: "chainCoefBonus", per: L.thunderLink.perStep, every: L.thunderLink.every },
  },
  thunderCharge: {
    key: "thunderCharge",
    name: "蓄電",
    desc: `感電を付けるたびに育つ。${L.thunderCharge.every}回ごとに、感電した敵への与ダメージ×${1 + L.thunderCharge.perStep}（上限なし）。`,
    icon: "蓄",
    tags: ["shock", "element"],
    keywords: kw([], ["shock"], ["shock"]),
    cursed: false,
    lineage: "thunder",
    card: "temper",
    changes: "watch",
    graded: false,
    rules: rulesOf("thunderCharge", [{ when: "onStatusApplied", if: appliedByMe("shock"), then: { kind: "tally", magnitude: 1, key: "thunderCharge" } }]),
    modifiers: modifiersOf("thunderCharge", [
      {
        kind: "more",
        tag: "all",
        amount: L.thunderCharge.perStep,
        per: { count: { kind: "tally", key: "thunderCharge" }, every: L.thunderCharge.every },
        if: [targetHas("shock")],
      },
    ]),
  },
  thunderReturn: {
    key: "thunderReturn",
    name: "還雷",
    desc: `連鎖する雷が最後の敵から来た道を戻る。連鎖が同じ敵をもう${L.thunderReturn.revisits}度訪れる。`,
    icon: "廻",
    tags: ["shock", "element"],
    keywords: kw(["shock"], ["shock"], ["shock"]),
    cursed: false,
    lineage: "thunder",
    card: "apex",
    changes: "target",
    graded: false,
    // 戻りは statusEffects.ts の chainLightning が stats.chainRevisits（1 以上）を見て起こす
    addStats: { chainRevisits: L.thunderReturn.revisits },
  },
};
