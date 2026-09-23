/**
 * 状態異常の型と一覧（docs/COMBAT_DESIGN.md E-1）。
 * プレイヤーと敵で共通の入れ物を使う。ロジックは src/system/statusEffects.ts に置く
 */

export const STATUS_KINDS = [
  "burn",
  "chill",
  "freeze",
  "shock",
  "paralyze",
  "poison",
  "bleed",
  "vulnerable",
  "weaken",
  "fear",
  "silence",
  "stagger",
  "guarded",
] as const;
export type StatusKind = (typeof STATUS_KINDS)[number];

/** 付けた側。player 由来だけが装備・祝福のフック（野火・氷砕など）を起こす */
export type StatusSource = "player" | "enemy" | "env";

export interface StatusEffect {
  kind: StatusKind;
  stacks: number;
  /** 残り秒 */
  time: number;
  /** HUD の減り方用: 付与・延長時の持続 */
  maxTime: number;
  /** 種類ごとに解釈（burn = dps、poison = 最大 HP 割合 / 秒、bleed = 10px あたりダメージ …） */
  potency: number;
  source: StatusSource;
  /** DoT の端数（既存 BurnEffect.acc と同じ） */
  acc: number;
  /** 周期効果（感電の連鎖）のタイマー */
  tick: number;
}

export interface StatusBag {
  effects: StatusEffect[];
  /** 種類 → 免疫の残り秒 */
  immune: Partial<Record<StatusKind, number>>;
  /** on-hit 付与の内部 CD（既存 EnemyEffects.onHitCooldown） */
  procIcd: number;
  /** 拘束上限: 直近 ccWindow 秒に入った行動停止の合計秒 */
  ccSpent: number;
  ccWindowLeft: number;
  /** 出血の移動距離を測る基準点（前ステップの位置）。出血中だけ持つ */
  bleedFrom?: { x: number; y: number };
}

export interface StatusApply {
  kind: StatusKind;
  stacks: number;
  duration: number;
  potency: number;
}

/** 装備の性質が持つ on-hit 付与（docs/COMBAT_DESIGN.md E-5） */
export interface StatusProc {
  kind: StatusKind;
  /** 0..1 */
  chance: number;
  stacks: number;
  duration: number;
  potency: number;
  /** どの攻撃で判定するか */
  on: "melee" | "ranged" | "skill" | "any";
  /** crit: 会心時のみ */
  requiresCrit?: boolean;
}

export function createStatusBag(): StatusBag {
  return { effects: [], immune: {}, procIcd: 0, ccSpent: 0, ccWindowLeft: 0 };
}
