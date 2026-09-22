import type { TimedMul } from "../core/state";
import type { Vec } from "../core/vec";

/**
 * スキルシステムの共有型。docs/ideas/skills.md「6-1」「7. 最小実装の仕様」。
 * 永続（スキル石 / SkillProfile）とラン内（SkillRunState）を分ける。
 */

export const SKILL_TAGS = [
  "melee",
  "projectile",
  "area",
  "movement",
  "defense",
  "buff",
  "placed",
  "channel",
  "fire",
  "cold",
  "lightning",
] as const;
export type SkillTag = (typeof SKILL_TAGS)[number];

/** 最小実装の 6。追加はここへ */
export const SKILL_KEYS = ["whirl", "lunge", "frag", "railshot", "parry", "bloodPact"] as const;
export type SkillKey = (typeof SKILL_KEYS)[number];

/** 最小実装の 4 */
export const MODIFIER_KEYS = ["multiCharge", "bloodPrice", "comboFuel", "echo"] as const;
export type ModifierKey = (typeof MODIFIER_KEYS)[number];

/** rollOutgoing に渡す種別。none は与ダメを持たない（buff） */
export type SkillDamageKind = "melee" | "ranged" | "none";

export const VARIANT_AXES = [
  "areaVsDamage",
  "cooldownVsDamage",
  "speedVsDamage",
  "countVsDamage",
  "durationVsPotency",
] as const;
export type VariantAxis = (typeof VARIANT_AXES)[number];

export interface SkillDef {
  key: SkillKey;
  name: string;
  /** HUD の 1 文字アイコン */
  icon: string;
  /** ツールチップ先頭の動詞 1 行 */
  verb: string;
  tags: readonly SkillTag[];
  damageKind: SkillDamageKind;
  cooldown: number;
  charges: number;
  /** この石にロールされうる変異軸（得失が意味を持つものだけ） */
  axes: readonly VariantAxis[];
}

/** 1 回の発動の最終パラメータ。変異・リンク・修飾子を畳み込んだ結果 */
export interface CastParams {
  damageMul: number;
  /** buff 系の効果量倍率 */
  potencyMul: number;
  areaMul: number;
  /** 予備動作・持続（旋風の回転・照準・導火線）の時間倍率 */
  timeMul: number;
  /** buff の持続倍率 */
  durationMul: number;
  cooldownMul: number;
  charges: number;
  /** 回数 / 弾数の加算 */
  countBonus: number;
  /** 発動時に払う最大 HP 割合（0 なら無し） */
  hpCostFraction: number;
  comboFuel: { perStack: number; cap: number; emptyMul: number } | null;
  echo: { delay: number; damageMul: number } | null;
}

export interface ModifierDef {
  key: ModifierKey;
  name: string;
  verb: string;
  /** HUD のドット色 */
  color: string;
  /** このタグを 1 つでも持つスキルには付けられない */
  excludesTags: readonly SkillTag[];
  apply(p: Readonly<CastParams>): CastParams;
}

// ---- 永続（スキル石） ----

export interface VariantRoll {
  axis: VariantAxis;
  /** -1..1。正で前者（範囲・CD 短縮・速度・回数・持続）を伸ばし、威力 / 効果量を削る */
  value: number;
}

export interface SkillStone {
  id: string;
  seed: number;
  skillKey: SkillKey;
  variants: VariantRoll[];
  /** 刻印符を差せる数。多いほど素の CD が長い */
  links: number;
  foundDepth: number;
  /** epoch ms */
  foundAt: number;
}

export interface SkillProfile {
  version: 1;
  /** スキルスロット i に装着した石の id */
  loadout: (string | null)[];
  stones: SkillStone[];
}

// ---- ラン内 ----

export interface SkillSlotState {
  /** ラン内修飾子。石ではなくスロットに属する（古い順） */
  modifiers: ModifierKey[];
  cooldownLeft: number;
  /** HUD のマスク用: 直近にセットした CD の長さ */
  cooldownTotal: number;
  chargesLeft: number;
}

export type ActiveSkillKey = "whirl" | "lunge" | "railshot" | "parry";

/** 発動中のスキル（同時に 1 つ） */
export interface ActiveCast {
  slot: number;
  skillKey: ActiveSkillKey;
  /** main: 本動作 / recover: 終わりの隙 */
  phase: "main" | "recover";
  timer: number;
  total: number;
  params: CastParams;
  dir: Vec;
  origin: Vec;
  hitIds: Set<number>;
  /** 旋風斬りの経過ヒット数 */
  hitsDone: number;
}

export interface Grenade {
  id: number;
  from: Vec;
  to: Vec;
  flight: number;
  flightTotal: number;
  fuse: number;
  fuseTotal: number;
  params: CastParams;
}

/** 反響の予約。timer が尽きたら同じ地点・向きで再発動 */
export interface EchoCast {
  timer: number;
  skillKey: SkillKey;
  origin: Vec;
  dir: Vec;
  target: Vec;
  params: CastParams;
}

/** 反響の残像（旋風斬り・突進斬り）。プレイヤーは動かない */
export interface Ghost {
  skillKey: "whirl" | "lunge";
  timer: number;
  total: number;
  pos: Vec;
  dir: Vec;
  params: CastParams;
  hitIds: Set<number>;
  hitsDone: number;
}

export interface RuneTablet {
  id: number;
  modifier: ModifierKey;
  pos: Vec;
  bobTime: number;
  /** 付けられる枠が無いことを一度表示したか */
  warned: boolean;
}

export interface FloorStone {
  id: number;
  stone: SkillStone;
  pos: Vec;
  bobTime: number;
  /** stash 満杯を一度表示したか */
  warned: boolean;
}

export interface SkillRunState {
  /** 永続。main.ts がラン間で同じオブジェクトを渡す */
  profile: SkillProfile;
  slots: SkillSlotState[];
  active: ActiveCast | null;
  /** ダッシュ中・近接中に押されたスロットの先行入力（-1 で無し） */
  pendingSlot: number;
  pendingTimer: number;
  grenades: Grenade[];
  echoes: EchoCast[];
  ghosts: Ghost[];
  runes: RuneTablet[];
  floorStones: FloorStone[];
  frenzy: TimedMul;
  lifesteal: TimedMul;
  parryTimer: number;
  parryFailTimer: number;
  /** 突進斬りの壁激突による行動不能 */
  stunTimer: number;
  /** 突進斬り後、この間の近接は 2 段目から */
  lungeComboTimer: number;
  notReadyTimer: number;
  /** 吸収用: 前回計測時の敵 HP */
  enemyHp: Map<number, number>;
  /** 部屋クリア・階層到達の検出用。depth が null なら未同期 */
  tracking: { depth: number | null; cleared: boolean[] };
}
