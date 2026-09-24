import type { Element } from "./element";
import type { EventActor, EventKind, EventSource } from "./events";
import type { FloorKind, RoomKind } from "./state";
import type { StatusKind } from "./status";
import type { TerrainKind } from "./terrain";
import type { JobKey } from "../data/jobs";
import type { MovesetKey, ShotKey } from "../data/weapons";
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
  | { kind: "actor"; actor: EventActor }
  // ---- 2026-09-24 追加（祝福 第 2 弾: 武器種・射撃の型・ジョブ・地形・属性・部屋） ----
  /** 中の条件を満たさない */
  | { kind: "not"; condition: RuleCondition }
  /** 今の武器種がどれか */
  | { kind: "moveset"; movesets: readonly MovesetKey[] }
  /** 今の射撃の型がどれか */
  | { kind: "shot"; shots: readonly ShotKey[] }
  /** 今の振りが武器種の段 atLeast 以上（0 始まり。双剣の 5 段目 = 4）。AttackState.step */
  | { kind: "swingStep"; atLeast: number }
  /** 今の振りの溜めの段が atLeast 以上（0 = 溜めなし） */
  | { kind: "chargedSwing"; atLeast: number }
  /** 近接の溜めの最中（大剣の長押し） */
  | { kind: "charging" }
  /** 今の振りがコンボ派生 */
  | { kind: "branchSwing" }
  | { kind: "job"; jobs: readonly JobKey[] }
  /** 今の武器種がジョブの得意 */
  | { kind: "favoredWeapon" }
  /** 自分が立つ地形。any = 地形の上ならどれでも */
  | { kind: "selfOnTerrain"; terrain: TerrainKind | "any" }
  /** イベントの位置（対象の敵の足元）の地形。撃破でも倒れた位置で見る */
  | { kind: "targetOnTerrain"; terrain: TerrainKind | "any" }
  /** 対象の敵が、via の攻撃（近接 = 武器種 / 射撃 = 射撃の型、属性の変換込み）を弱点 / 耐性で受ける */
  | { kind: "targetAffinity"; affinity: "weak" | "resist"; via: RuleAttackVia }
  /** via の攻撃の主な属性（変換の割合が最も大きいもの） */
  | { kind: "attackElement"; element: Element; via: RuleAttackVia }
  /** 交戦中の部屋の種類がどれか（巣窟・伏兵など） */
  | { kind: "engagedIn"; rooms: readonly RoomKind[] }
  /** 対象の敵が徘徊（どの部屋にも属さない）。撃破は倒れた瞬間の所属で見る */
  | { kind: "targetRoamer" }
  /** 今の階の種類（分岐路で選んだバイオーム）がどれか */
  | { kind: "floorKind"; kinds: readonly FloorKind[] };

/** 属性・弱点の条件がどの攻撃の素性を見るか */
export type RuleAttackVia = "melee" | "ranged";

/**
 * 効果の種類。装備トリガーの効果をすべて含み、統一文法で増えたものを足す。
 * spreadStatus = 対象が持っていた状態異常を周囲へ広げる（野火・疫病の形）
 * hazardBomb = 予告付きの爆発（敵の Rule はこれ以外を持てない。テレグラフ原則を型で強制する）
 */
export type RuleEffectKind =
  | TriggerEffectKind
  | "spreadStatus"
  | "hazardBomb"
  // ---- 2026-09-24 追加（祝福 第 2 弾） ----
  /** イベントの位置に地形を置く（terrain / radius / duration） */
  | "placeTerrain"
  /** イベントの位置の油・草に火をつけ、氷を溶かす（radius） */
  | "igniteTerrain"
  /** イベントの位置の地形を半径 radius に広げる（地形の無い所では何もしない） */
  | "spreadTerrain"
  /** 自分に状態異常を付ける（status / count = スタック / duration / magnitude = 強さ）。呪いの代償にも使う */
  | "selfStatus"
  /** 対象の敵へ追撃（素性なしの proc ダメージ = magnitude） */
  | "strike"
  /** 照準方向へ貫通する衝撃波（祝福の断裂波と同じ弾。magnitude = ダメージ） */
  | "wave"
  /** ダッシュの回数を count だけ戻す */
  | "refillDash";

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
  /** spreadStatus / hazardBomb / 地形の効果の半径 */
  radius?: number;
  /** placeTerrain の地形 */
  terrain?: TerrainKind;
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
  placeTerrain: "placed",
  igniteTerrain: "burn",
  spreadTerrain: "placed",
  strike: "melee",
  wave: "area",
  refillDash: "dash",
};

export function effectKeyword(rule: Readonly<Rule>): string {
  if (rule.keyword !== undefined) return rule.keyword;
  const { kind, status } = rule.then;
  if ((kind === "inflict" || kind === "spreadStatus" || kind === "selfStatus") && status !== undefined) return status;
  return EFFECT_KEYWORD[kind] ?? kind;
}

/** 持ち主と添字から Rule の id を作る（同じ定義は常に同じ id） */
export function ruleId(owner: EventSource, index: number): string {
  return `${owner.kind}:${owner.key}:${index}`;
}
