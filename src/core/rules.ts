import type { EventActor, EventKind, EventSource } from "./events";
import type { StatusKind } from "./status";
import type { TriggerCondition, TriggerEffectKind } from "../loot/types";
import type { SkillKey } from "../skills/types";

/**
 * 統一ルール文法（docs/ideas/synergy-web.md 3-1）。
 * Rule = いつ（when）× もし（if）× 何を（then）。装備の tr: は loot/triggers.ts の ruleFromTrigger でこの形に読み替える。
 * 祝福・スキル石・刻印符・敵は持ち主の定義に rules を置き、src/system/rules.ts の resolveRules が照合する。
 * ここは型と純関数だけ（ロジックは system 側）
 */

export type RuleCondition =
  /** 装備トリガーの条件（loot/types.ts の TriggerCondition）をそのまま使う */
  | { kind: "trigger"; condition: TriggerCondition }
  /** everyNthMeleeHit の読み替え: 近接命中の通算が every の倍数 */
  | { kind: "nthMeleeHit"; every: number }
  /** 対象の敵がこの状態異常を持つ（撃破時は倒れた瞬間の写しを見る） */
  | { kind: "targetHas"; status: StatusKind }
  /** 自分がこの状態異常を持つ */
  | { kind: "selfHas"; status: StatusKind }
  /** 直近 within 秒に event が起きた（今のイベントを含む） */
  | { kind: "recent"; event: EventKind; within: number }
  | { kind: "manaFull" }
  | { kind: "manaLow" }
  /** HP が SYNERGY.lowHpRatio 以下 */
  | { kind: "lowHp" }
  | { kind: "comboAbove"; count: number }
  /** 今の近接の振りが連撃の最終段（終撃）。ジョブ「剣士」が使う */
  | { kind: "finisher" }
  /** 今いる部屋が交戦中（封鎖中を含む。system/engagement.ts の isEngaged）。key は旧名のまま */
  | { kind: "roomLocked" }
  | { kind: "depthAtLeast"; depth: number }
  /** イベントの付随 key（反応の種類・地形の種類など）が一致 */
  | { kind: "eventTag"; tag: string }
  /** イベントを起こした側が一致 */
  | { kind: "actor"; actor: EventActor };

/**
 * 効果の種類。装備トリガーの効果をすべて含み、統一文法で増えたものを足す。
 * spreadStatus = 対象が持っていた状態異常を周囲へ広げる（野火・疫病の形）
 * hazardBomb = 予告付きの爆発（敵の Rule はこれ以外を持てない。テレグラフ原則を型で強制する）
 */
export type RuleEffectKind = TriggerEffectKind | "spreadStatus" | "hazardBomb";

/** 効果量の基準。flat = magnitude そのまま / slashBase = 近接 1 段目の威力 × magnitude */
export type RuleMagnitudeBase = "flat" | "slashBase";

export interface RuleEffect {
  kind: RuleEffectKind;
  /** 効果量（ダメージ・回復量・% など効果ごとに解釈。spreadStatus は元の強さに掛ける倍率） */
  magnitude: number;
  scaleBy?: RuleMagnitudeBase;
  duration?: number;
  count?: number;
  status?: StatusKind;
  /** spreadStatus / hazardBomb の半径 */
  radius?: number;
}

/** 敵の Rule が持てる効果（予告付きハザードのみ） */
export interface HazardRuleEffect extends RuleEffect {
  kind: "hazardBomb";
  /** 予告の秒（爆弾の導火線） */
  duration: number;
  radius: number;
}

/** どのイベントを食うか。スキル石・刻印符の Rule は自分の発動が起こしたイベントだけを食う */
export type RuleScope = { kind: "any" } | { kind: "skill"; key: SkillKey } | { kind: "slot"; slot: number };

export const SCOPE_ANY: RuleScope = { kind: "any" };

export interface Rule {
  /** ICD のキー。持ち主 + 添字で決める（決定性） */
  id: string;
  when: EventKind;
  /** すべて満たすときだけ発動（空 = 常に） */
  if: readonly RuleCondition[];
  then: RuleEffect;
  /** 発動確率 0..1。1 以上なら乱数を引かない */
  chance: number;
  /** Rule ごとの内部 CD（秒） */
  icd: number;
  scope: RuleScope;
  owner: EventSource;
  /** 語ごとの回数上限に数える語。省略時は効果の種類から決める（effectKeyword） */
  keyword?: string;
}

/** 敵の Rule（src/data/enemyCombat.ts）。効果は予告付きハザードに限る */
export interface EnemyRule extends Rule {
  then: HazardRuleEffect;
}

/**
 * 効果の種類 → 語（docs/ideas/synergy-web.md 1-2 の対応表）。語の型は別レーン（共通語彙）が定めるので key の文字列で持つ。
 * 語にしない効果（バフなど）は種類名そのものを語として数える（同じ効果の重ねがけを同じ上限で絞る）
 */
const EFFECT_KEYWORD: Readonly<Partial<Record<RuleEffectKind, string>>> = {
  shockwave: "area",
  spawnBullets: "bullet",
  chainLightning: "shock",
  burnNearby: "burn",
  freezeNearby: "chill",
  explode: "explode",
  heal: "heal",
  energy: "energy",
  invuln: "ward",
  restoreMana: "mana",
  addPoise: "stagger",
  volley: "ranged",
  healMissing: "heal",
  hazardBomb: "explode",
};

export function effectKeyword(rule: Readonly<Rule>): string {
  if (rule.keyword !== undefined) return rule.keyword;
  const { kind, status } = rule.then;
  if ((kind === "inflict" || kind === "spreadStatus") && status !== undefined) return status;
  return EFFECT_KEYWORD[kind] ?? kind;
}

/** 持ち主と添字から Rule の id を作る（同じ定義は常に同じ id） */
export function ruleId(owner: EventSource, index: number): string {
  return `${owner.kind}:${owner.key}:${index}`;
}
