/**
 * 霜枷の札（docs/ideas/boon-impl.md 2-6。段取り 7b）。boonDefs.ts が BOON_KEYS / BOONS に混ぜる。
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

export const BOON_KEYS_FROST = [
  // ---- 加護（左 / 右 / ダッシュ / スキル / 奥義） ----
  "frostBreath",
  "shatterBell",
  "frostFeet",
  "frostPierce",
  "eternalWinter",
  // ---- 摂理 ----
  "chillShatter",
  "frostRead",
  "iceRelay",
  // ---- 研鑽 ----
  "frostShards",
  "frostDeep",
  // ---- 真髄 ----
  "frostPrison",
] as const;

type FrostKey = (typeof BOON_KEYS_FROST)[number];

const L = BOON_LINEAGE.frost;

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
/** 量を持たない効果（地形・凍結・冷気を移す）の magnitude。格は半径にだけ掛かる */
const NO_AMOUNT = 0;
const PERCENT = 100;
/**
 * ICD を持たない効果: 数え（全部数える）と溜めの解放（敵ごとの溜めなので、同じステップの複数の砕きで取りこぼさない。
 * 解放の一撃は凍結の解けた敵に入るので砕きを起こさず、環にならない）
 */
const UNLIMITED_EFFECTS: ReadonlySet<RuleEffect["kind"]> = new Set<RuleEffect["kind"]>(["tally", "releaseVault"]);

function rulesOf(key: FrostKey, specs: readonly RuleSpec[]): Rule[] {
  const owner: EventSource = { kind: "boon", key };
  return specs.map((s, i) => ({
    id: ruleId(owner, i),
    when: s.when,
    if: s.if ?? [],
    then: s.then,
    chance: ALWAYS,
    icd: UNLIMITED_EFFECTS.has(s.then.kind) ? 0 : Math.max(BOON.ruleMinIcd, s.icd ?? 0),
    scope: SCOPE_ANY,
    owner,
  }));
}

function modifiersOf(key: FrostKey, specs: readonly Omit<Modifier, "id" | "owner">[]): Modifier[] {
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

/** 半径内の敵へ冷気を stacks 重ねる（対象の敵は除く） */
function chillAround(stacks: number, radius: number, duration: number): RuleEffect {
  return { kind: "nearbyEnemies", status: "chill", count: stacks, magnitude: NO_AMOUNT, radius, duration, color: STATUS.chillColor };
}

// -----------------------------------------------------------------------------
// 札
// -----------------------------------------------------------------------------

export const BOONS_FROST: Readonly<Record<FrostKey, BoonDef>> = {
  frostBreath: {
    key: "frostBreath",
    name: "霜息",
    desc: `攻撃 1 の振りが当たると冷気を付ける（${L.frostBreath.duration}秒）。`,
    icon: "霜",
    tags: ["chill", "melee", "element"],
    keywords: kw(["chill"], ["melee"]),
    gives: ["chill"],
    cursed: false,
    lineage: "frost",
    card: "grace",
    action: "primary",
    changes: "target",
    rules: rulesOf("frostBreath", [
      {
        when: "onSwingHit",
        if: [PRIMARY],
        then: { kind: "afflict", status: "chill", count: L.frostBreath.stacks, magnitude: L.frostBreath.slow, duration: L.frostBreath.duration },
      },
    ]),
  },
  shatterBell: {
    key: "shatterBell",
    name: "砕氷の鐘",
    desc: `放出で半径${formatMeters(L.shatterBell.radius)}の凍った敵すべてに一撃を与えて砕く。`,
    icon: "鐘",
    tags: ["chill", "freeze", "element"],
    keywords: kw(["reaction"], ["chill"]),
    cursed: false,
    lineage: "frost",
    card: "grace",
    action: "secondary",
    changes: "timing",
    rules: rulesOf("shatterBell", [
      {
        when: "onRelease",
        then: {
          kind: "nearbyEnemies",
          magnitude: L.shatterBell.ratio,
          scaleBy: "slashBase",
          radius: L.shatterBell.radius,
          onlyWith: "freeze",
          color: STATUS.chillColor,
        },
      },
    ]),
  },
  frostFeet: {
    key: "frostFeet",
    name: "凍て足",
    desc:
      `ダッシュの始まりの場所に半径${formatMeters(L.frostFeet.radius)}の氷床を置く（${L.frostFeet.duration}秒）。` +
      `ダッシュの終わりに半径${formatMeters(L.frostFeet.chillRadius)}の敵へ冷気を付ける。`,
    icon: "凍",
    tags: ["chill", "dash", "terrain", "element"],
    keywords: kw(["placed", "chill"], ["dash"]),
    gives: ["chill", "terrain"],
    cursed: false,
    lineage: "frost",
    card: "grace",
    action: "dash",
    changes: "position",
    graded: true,
    // 通り抜けた敵を拾うイベントが無いので、終わりの位置の周りへ冷気で近似する
    rules: rulesOf("frostFeet", [
      {
        when: "onDash",
        then: { kind: "placeTerrain", terrain: "ice", magnitude: NO_AMOUNT, radius: L.frostFeet.radius, duration: L.frostFeet.duration },
      },
      { when: "onDashEnd", then: chillAround(L.frostFeet.stacks, L.frostFeet.chillRadius, STATUS.chill.duration) },
    ]),
  },
  frostPierce: {
    key: "frostPierce",
    name: "凍て刺し",
    desc: `スキルで凍った敵を砕くと、半径${formatMeters(L.frostPierce.radius)}の敵へ冷気を${L.frostPierce.stacks}重ねる。`,
    icon: "N",
    tags: ["chill", "skill", "element"],
    keywords: kw(["chill"], ["reaction"]),
    gives: ["chill"],
    cursed: false,
    lineage: "frost",
    card: "grace",
    action: "skill",
    changes: "target",
    graded: true,
    // 当たった瞬間に凍結は砕けて消えるので「凍った敵へのスキル」は照合の時点で読めない。砕きと同じステップのスキルの命中で見る
    rules: rulesOf("frostPierce", [
      {
        when: "onShatter",
        if: [{ kind: "recent", event: "onSkillHit", within: L.frostPierce.window }],
        then: chillAround(L.frostPierce.stacks, L.frostPierce.radius, L.frostPierce.duration),
      },
    ]),
  },
  eternalWinter: {
    key: "eternalWinter",
    name: "永冬",
    desc: `奥義で半径${formatMeters(L.eternalWinter.radius)}の敵を凍結させる（ボスを除く）。`,
    icon: "冬",
    tags: ["chill", "freeze", "energy", "element"],
    keywords: kw(["chill"], ["energy"]),
    gives: ["freeze"],
    cursed: false,
    lineage: "frost",
    card: "grace",
    action: "ultimate",
    changes: "timing",
    graded: true,
    rules: rulesOf("eternalWinter", [
      {
        when: "onBurst",
        then: {
          kind: "nearbyEnemies",
          status: "freeze",
          magnitude: NO_AMOUNT,
          duration: L.eternalWinter.duration,
          radius: L.eternalWinter.radius,
          skipBoss: true,
          color: STATUS.chillColor,
        },
      },
    ]),
  },
  chillShatter: {
    key: "chillShatter",
    name: "氷砕",
    desc: `凍った敵を砕くと、その場から氷の破片が${L.chillShatter.shards}方向へ飛ぶ。`,
    icon: "*",
    tags: ["chill", "freeze", "element"],
    keywords: kw(["bullet", "area"], ["reaction"]),
    cursed: false,
    lineage: "frost",
    card: "law",
    changes: "target",
    rules: rulesOf("chillShatter", [
      { when: "onShatter", then: { kind: "shards", magnitude: L.chillShatter.ratio, scaleBy: "slashBase", count: L.chillShatter.shards } },
    ]),
  },
  frostRead: {
    key: "frostRead",
    name: "霜読み",
    desc: `冷えた敵が予備動作に入ると、冷気をさらに${L.frostRead.stacks}重ねる（予備動作が延びる）。`,
    icon: "読",
    tags: ["chill", "counter", "element"],
    keywords: kw(["chill"], ["chill"], ["counter"]),
    gives: ["chill"],
    cursed: false,
    lineage: "frost",
    card: "law",
    changes: "timing",
    rules: rulesOf("frostRead", [
      {
        when: "onEnemyWindup",
        if: [targetHas("chill")],
        then: { kind: "afflict", status: "chill", count: L.frostRead.stacks, magnitude: L.frostRead.slow, duration: L.frostRead.duration },
      },
    ]),
  },
  iceRelay: {
    key: "iceRelay",
    name: "氷継ぎ",
    desc: `冷えた敵を倒すと、残りの冷気を半径${formatMeters(L.iceRelay.radius)}で最も近い敵へ移す。`,
    icon: "伝",
    tags: ["chill", "element"],
    keywords: kw(["chill"], ["chill", "kill"]),
    gives: ["chill"],
    cursed: false,
    lineage: "frost",
    card: "law",
    changes: "target",
    graded: true,
    rules: rulesOf("iceRelay", [
      {
        when: "onKill",
        if: [targetHas("chill")],
        then: { kind: "passStatus", status: "chill", magnitude: NO_AMOUNT, radius: L.iceRelay.radius, color: STATUS.chillColor },
      },
    ]),
  },
  frostShards: {
    key: "frostShards",
    name: "砕片",
    desc: `凍った敵を砕くたびに育つ。${L.frostShards.every}回ごとに、冷えた敵への与ダメージ×${1 + L.frostShards.perStep}（上限なし）。`,
    icon: "片",
    tags: ["chill", "freeze", "element"],
    keywords: kw([], ["reaction"], ["chill"]),
    cursed: false,
    lineage: "frost",
    card: "temper",
    changes: "watch",
    // 数えと常時の倍は格を持たない（育ち方は行動の数で決まる）
    graded: false,
    rules: rulesOf("frostShards", [{ when: "onShatter", then: { kind: "tally", magnitude: 1, key: "frostShards" } }]),
    modifiers: modifiersOf("frostShards", [
      {
        kind: "more",
        tag: "all",
        amount: L.frostShards.perStep,
        per: { count: { kind: "tally", key: "frostShards" }, every: L.frostShards.every },
        if: [targetHas("chill")],
      },
    ]),
  },
  frostDeep: {
    key: "frostDeep",
    name: "厳寒",
    desc: `敵を凍結させるたびに育つ。${L.frostDeep.every}回ごとに、凍った敵への与ダメージ+${pct(L.frostDeep.perStep)}%（上限なし）。`,
    icon: "凛",
    tags: ["chill", "freeze", "element"],
    keywords: kw([], ["chill"], ["chill"]),
    cursed: false,
    lineage: "frost",
    card: "temper",
    changes: "watch",
    graded: false,
    // 設計の「凍結の持続」は stats に口が無いので、凍った敵（砕く一撃）への増で近似する
    rules: rulesOf("frostDeep", [{ when: "onStatusApplied", if: appliedByMe("freeze"), then: { kind: "tally", magnitude: 1, key: "frostDeep" } }]),
    modifiers: modifiersOf("frostDeep", [
      {
        kind: "increased",
        tag: "all",
        amount: L.frostDeep.perStep,
        per: { count: { kind: "tally", key: "frostDeep" }, every: L.frostDeep.every },
        if: [targetHas("freeze")],
      },
    ]),
  },
  frostPrison: {
    key: "frostPrison",
    name: "氷獄",
    desc: `凍った敵に与えた傷は溜まり、砕くと溜めた傷の${pct(L.frostPrison.releaseMul)}%をもう一度与える。`,
    icon: "獄",
    tags: ["chill", "freeze", "element"],
    keywords: kw([], ["reaction", "chill"], ["chill"]),
    cursed: false,
    lineage: "frost",
    card: "apex",
    changes: "timing",
    // 溜めは combat.ts の damageEnemy が「溜めを出す Rule（releaseVault ice）を持つ」ときだけ積む
    rules: rulesOf("frostPrison", [{ when: "onShatter", then: { kind: "releaseVault", vault: "ice", magnitude: L.frostPrison.releaseMul } }]),
  },
};
