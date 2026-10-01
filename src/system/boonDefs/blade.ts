/**
 * 刃鳴の札（docs/ideas/boon-impl.md 2-6。段取り 7b）。boonDefs.ts が BOON_KEYS / BOONS に混ぜる。
 * 旧祝福と同じ key の札は、その key の図鑑の記録を引き継ぐ。
 * ここは型だけを boonDefs.ts から読む（実行時の循環を作らない）
 *
 * 軸は コンボ・手数・分身。分身の追撃は Rule の strike（対象の敵へ素性なしの追撃）で表す。
 * 抜き胴（すり抜けた敵を斬る）と専心（連撃が常に最終段）は、同じ key の旧フック（boonRules.ts の updateDashThrough /
 * boons.ts の boonSwingCombo）がそのまま効く（すり抜けと振りの段を読むイベントが無いため）
 */

import type { EventKind, EventSource } from "../../core/events";
import { kw } from "../../core/keywords";
import { type Modifier, type Rule, type RuleCondition, type RuleEffect, SCOPE_ANY, ruleId } from "../../core/rules";
import { BOON, BOON_LINEAGE } from "../../data/tuning";
import type { BoonDef } from "../boonDefs";

export const BOON_KEYS_BLADE = [
  // ---- 加護（左 / 右 / ダッシュ / スキル / 奥義） ----
  "layeredEdge",
  "finisherWave",
  "passCut",
  "bladeLayered",
  "hundredBlades",
  // ---- 摂理 ----
  "finisherOnly",
  "bladeTwinWave",
  "comboWave",
  // ---- 研鑽 ----
  "bladeStreak",
  "bladeShadow",
  // ---- 真髄 ----
  "comboKeeper",
] as const;

type BladeKey = (typeof BOON_KEYS_BLADE)[number];

const B = BOON_LINEAGE.blade;
const ALWAYS = 1;
const PERCENT = 100;

// -----------------------------------------------------------------------------
// 組み立て
// -----------------------------------------------------------------------------

interface RuleSpec {
  when: EventKind;
  if?: readonly RuleCondition[];
  then: RuleEffect;
  icd?: number;
  /** 命中ごとの追撃（連鎖に数えない。範囲の命中でも全員に出す） */
  direct?: true;
}

/** 確定発動の Rule。連鎖に乗るものは ICD を BOON.ruleMinIcd 以上に、数えと直接の追撃は ICD 0 */
function rulesOf(key: BladeKey, specs: readonly RuleSpec[]): Rule[] {
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

function modifiersOf(key: BladeKey, specs: readonly Omit<Modifier, "id" | "owner">[]): Modifier[] {
  const owner: EventSource = { kind: "boon", key };
  return specs.map((s, i) => ({ ...s, id: ruleId(owner, i), owner }));
}

function pct(ratio: number): number {
  return Math.round(ratio * PERCENT);
}

function strike(ratio: number): RuleEffect {
  return { kind: "strike", magnitude: ratio, scaleBy: "slashBase" };
}

function wave(ratio: number): RuleEffect {
  return { kind: "wave", magnitude: ratio, scaleBy: "slashBase" };
}

const PRIMARY: RuleCondition = { kind: "lane", lane: "primary" };

/** 重畳: スキルの命中に重ねる追撃の数（1 撃を 3 段に） */
const LAYERED_EXTRA_HITS = 2;

/** 影打: 撃破 every 体ごとに分身が 1 体（段 i は数えが every × i 以上で追撃する） */
function shadowRules(): RuleSpec[] {
  const tallied: RuleSpec = { when: "onKill", then: { kind: "tally", magnitude: 1, key: "bladeShadow" } };
  const shadows = Array.from({ length: B.bladeShadow.max }, (_, i): RuleSpec => ({
    when: "onSwingHit",
    if: [{ kind: "counter", counter: { kind: "tally", key: "bladeShadow" }, atLeast: B.bladeShadow.every * (i + 1) }],
    then: strike(B.bladeShadow.strikeRatio),
    icd: B.bladeShadow.icd,
  }));
  return [tallied, ...shadows];
}

// -----------------------------------------------------------------------------
// 札
// -----------------------------------------------------------------------------

export const BOONS_BLADE: Readonly<Record<BladeKey, BoonDef>> = {
  // ---- 加護 ----
  layeredEdge: {
    key: "layeredEdge",
    name: "重ね刃",
    desc: "左の連撃が当たるたび、分身が同じ敵へ追撃する。",
    icon: "層",
    tags: ["melee", "combo"],
    keywords: kw(["melee"], ["melee"]),
    cursed: false,
    lineage: "blade",
    card: "grace",
    action: "primary",
    changes: "press",
    rules: rulesOf("layeredEdge", [{ when: "onSwingHit", if: [PRIMARY], then: strike(B.layeredEdge.strikeRatio), icd: B.layeredEdge.icd }]),
  },
  finisherWave: {
    key: "finisherWave",
    name: "断裂波",
    desc: "右の放出で照準方向へ貫通する衝撃波。",
    icon: "裁",
    tags: ["melee"],
    keywords: kw(["area", "wall"], ["melee"]),
    cursed: false,
    lineage: "blade",
    card: "grace",
    action: "secondary",
    changes: "position",
    rules: rulesOf("finisherWave", [{ when: "onRelease", then: wave(B.finisherWave.waveRatio), icd: B.finisherWave.icd }]),
  },
  passCut: {
    key: "passCut",
    // 効果は boonRules.ts の updateDashThrough（旧フック。格は boonGradeMul で掛かる）
    graded: true,
    name: "抜き胴",
    desc: "ダッシュですり抜けた敵すべてを斬る。",
    icon: "胴",
    tags: ["dash", "melee"],
    keywords: kw(["melee"], ["dash"]),
    cursed: false,
    lineage: "blade",
    card: "grace",
    action: "dash",
    changes: "position",
  },
  bladeLayered: {
    key: "bladeLayered",
    name: "重畳",
    desc: `スキルが当たるたび、同じ敵へ分身の追撃が${LAYERED_EXTRA_HITS}回重なる。`,
    icon: "畳",
    tags: ["skill", "melee"],
    keywords: kw(["melee"], ["mana"]),
    cursed: false,
    lineage: "blade",
    card: "grace",
    action: "skill",
    changes: "press",
    rules: rulesOf(
      "bladeLayered",
      Array.from({ length: LAYERED_EXTRA_HITS }, (): RuleSpec => ({ when: "onSkillHit", then: strike(B.bladeLayered.strikeRatio), direct: true })),
    ),
  },
  hundredBlades: {
    key: "hundredBlades",
    name: "百刃",
    desc: `奥義を撃った後${B.hundredBlades.window}秒、振りが当たるたび分身が追撃する。`,
    icon: "百",
    tags: ["melee", "energy"],
    keywords: kw(["melee"], ["energy"]),
    cursed: false,
    lineage: "blade",
    card: "grace",
    action: "ultimate",
    changes: "timing",
    rules: rulesOf("hundredBlades", [
      {
        when: "onSwingHit",
        if: [{ kind: "recent", event: "onBurst", within: B.hundredBlades.window }],
        then: strike(B.hundredBlades.strikeRatio),
        icd: B.hundredBlades.icd,
      },
    ]),
  },
  // ---- 摂理 ----
  finisherOnly: {
    key: "finisherOnly",
    // 効果は boons.ts の boonSwingCombo（旧フック）
    name: "専心",
    desc: "近接の振りが常に連撃の最終段になる（ダッシュ攻撃は除く）。",
    icon: "専",
    tags: ["melee"],
    keywords: kw(["finisher"], ["melee"], ["finisher"]),
    cursed: false,
    lineage: "blade",
    card: "law",
    changes: "press",
  },
  bladeTwinWave: {
    key: "bladeTwinWave",
    name: "双撃波",
    desc: "左右を交互に当てる（双撃）たび、照準方向へ貫通する衝撃波。",
    icon: "双",
    tags: ["melee", "combo"],
    keywords: kw(["area"], ["melee"]),
    cursed: false,
    lineage: "blade",
    card: "law",
    changes: "timing",
    rules: rulesOf("bladeTwinWave", [{ when: "onTwinStrike", then: wave(B.bladeTwinWave.waveRatio), icd: B.bladeTwinWave.icd }]),
  },
  comboWave: {
    key: "comboWave",
    name: "連撃波",
    desc: `コンボが${B.comboWave.every}の倍数に届くたび、照準方向へ貫通する衝撃波。`,
    icon: "撃",
    tags: ["melee", "combo"],
    keywords: kw(["area"], ["combo"]),
    cursed: false,
    lineage: "blade",
    card: "law",
    changes: "watch",
    rules: rulesOf("comboWave", [
      { when: "onComboHit", if: [{ kind: "amountEvery", every: B.comboWave.every }], then: wave(B.comboWave.waveRatio), icd: B.comboWave.icd },
    ]),
  },
  // ---- 研鑽 ----
  bladeStreak: {
    key: "bladeStreak",
    name: "連綿",
    desc: `この探索の最大コンボ${B.bladeStreak.every}につき近接の与ダメ+${pct(B.bladeStreak.amount)}%（上限なし）。`,
    icon: "綿",
    tags: ["melee", "combo"],
    keywords: kw([], ["combo"], ["melee"]),
    cursed: false,
    lineage: "blade",
    card: "temper",
    changes: "watch",
    rules: rulesOf("bladeStreak", [{ when: "onComboHit", then: { kind: "tally", magnitude: 1, scaleBy: "eventAmount", mode: "max", key: "bladeStreak" } }]),
    modifiers: modifiersOf("bladeStreak", [
      { kind: "increased", tag: "melee", amount: B.bladeStreak.amount, per: { count: { kind: "tally", key: "bladeStreak" }, every: B.bladeStreak.every }, if: [] },
    ]),
  },
  bladeShadow: {
    key: "bladeShadow",
    name: "影打",
    desc: `撃破${B.bladeShadow.every}体ごとに分身が 1 体増え（最大${B.bladeShadow.max}体）、振りが当たるたび分身が追撃する。`,
    icon: "打",
    tags: ["melee"],
    keywords: kw(["melee"], ["kill"]),
    cursed: false,
    lineage: "blade",
    card: "temper",
    changes: "watch",
    rules: rulesOf("bladeShadow", shadowRules()),
  },
  // ---- 真髄 ----
  comboKeeper: {
    key: "comboKeeper",
    // 被弾で半分残るのは boons.ts の comboAfterHurt（旧フック）。時間で切れないのは addStats でコンボの猶予を延ばす
    name: "不断",
    desc: "コンボが時間で切れない。被弾しても半分残る。",
    icon: "不",
    tags: ["combo"],
    keywords: kw([], ["hurt"], ["combo"]),
    cursed: false,
    lineage: "blade",
    card: "apex",
    changes: "timing",
    graded: false,
    addStats: { comboWindowBonus: B.comboKeeper.windowBonus },
  },
};
