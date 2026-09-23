import type { TimedMul } from "../core/state";
import type { StatusApply } from "../core/status";
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

/** 最小実装の 6 + 追加の 8。追加はここへ */
export const SKILL_KEYS = [
  "whirl",
  "lunge",
  "frag",
  "railshot",
  "parry",
  "bloodPact",
  "quake",
  "thunder",
  "gravityWell",
  "mines",
  "haste",
  "chainHook",
  "spiral",
  "frostField",
] as const;
export type SkillKey = (typeof SKILL_KEYS)[number];

/** 最小実装の 4 + 追加の 6 */
export const MODIFIER_KEYS = [
  "multiCharge",
  "bloodPrice",
  "comboFuel",
  "echo",
  "pierce",
  "recoil",
  "chainReset",
  "curse",
  "delay",
  "expand",
  "charge",
] as const;
export type ModifierKey = (typeof MODIFIER_KEYS)[number];

/** rollOutgoing に渡す種別。none は与ダメを持たない（buff） */
export type SkillDamageKind = "melee" | "ranged" | "none";

export const VARIANT_AXES = [
  "areaVsDamage",
  "cooldownVsDamage",
  "speedVsDamage",
  "countVsDamage",
  "durationVsPotency",
  "cooldownVsPotency",
] as const;
export type VariantAxis = (typeof VARIANT_AXES)[number];

/** スキルの資源（docs/COMBAT_DESIGN.md B-4）。mana = マナ消費 / cooldown = 既存の CD とチャージ */
export type SkillResource = "mana" | "cooldown";

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
  // ---- 戦闘再設計（docs/COMBAT_DESIGN.md B-4）。値は段階 1 の L2 が入れる。段階 0 は中立 ----
  resource: SkillResource;
  /** マナ型のコスト（CD 型は 0） */
  manaCost: number;
  /** このスロットだけの連打下限（秒） */
  minInterval: number;
  /** 1 ヒットの基礎怯み値 */
  poise: number;
  /** 命中した敵に付ける状態異常 */
  applies?: readonly StatusApply[];
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
  /** 貫通数（弾・鎖が追加で抜ける敵の数） */
  pierce: number;
  /** 反動: 発動時に照準の逆へ跳ぶ速度（0 なら無し） */
  recoil: number;
  /** 連鎖: このスキルで敵を倒すとチャージ +1 */
  killRefund: boolean;
  /** 呪い: ヒットした敵に刻印。刻印中の敵へのスキル被ダメ倍率 */
  curse: { duration: number; bonus: number } | null;
  /** 遅延: この秒数後に発動地点で発動する */
  delay: { time: number; damageMul: number } | null;
  /** 発動したスロット（連鎖の返却先）。resolveCast の時点では -1 */
  slot: number;
  /** マナ型の最低間隔倍率（多重）。段階 1 の L2 が読む */
  intervalMul: number;
  /** 連鎖（マナ型）: 撃破でコストのこの割合を返す。0 なら無し。段階 1 の L2 が読む */
  killManaRefund: number;
}

export interface ModifierDef {
  key: ModifierKey;
  name: string;
  verb: string;
  /** HUD のドット色 */
  color: string;
  /** このタグを 1 つでも持つスキルには付けられない */
  excludesTags: readonly SkillTag[];
  /** 指定があれば、このタグを 1 つ以上持つスキルにだけ付けられる */
  requiresTags?: readonly SkillTag[];
  /** 個別に付けられないスキル（効果が既に内蔵されているもの） */
  excludesSkills?: readonly SkillKey[];
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
  /** Charge 刻印符: 現在溜め中か */
  charging: boolean;
  /** Charge 刻印符: 溜め始めてからの経過秒（溜めていなければ 0） */
  chargeTime: number;
  /** 最低間隔の残り秒（docs/COMBAT_DESIGN.md B-2） */
  intervalLeft: number;
}

export type ActiveSkillKey = "whirl" | "lunge" | "railshot" | "parry" | "quake" | "chainHook" | "spiral";

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
  /** 旋風斬りの経過ヒット数 / 回転弾幕の発射数 / 鎖鎌の引き寄せ数 */
  hitsDone: number;
  /** 地裂き: 溜め開始時の HP（被弾で中断） */
  startHp: number;
  /** 鎖鎌: 鎖の先端の距離 */
  reach: number;
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
  /** echo: 反響の再発動 / delay: 遅延の本発動（予兆の円を出す） */
  kind: "echo" | "delay";
  total: number;
  skillKey: SkillKey;
  origin: Vec;
  dir: Vec;
  target: Vec;
  params: CastParams;
}

/** 反響の残像（旋風斬り・突進斬り・回転弾幕）。プレイヤーは動かない */
export interface Ghost {
  skillKey: "whirl" | "lunge" | "spiral";
  timer: number;
  total: number;
  pos: Vec;
  dir: Vec;
  params: CastParams;
  hitIds: Set<number>;
  hitsDone: number;
}

/** 雷撃の落雷予約。timer が尽きたら落ちる */
export interface ThunderStrike {
  pos: Vec;
  timer: number;
  total: number;
  params: CastParams;
}

/** 引力球 */
export interface GravityWell {
  pos: Vec;
  timer: number;
  total: number;
  tick: number;
  params: CastParams;
}

/** 地雷。arm が 0 になると踏まれて爆発する */
export interface Mine {
  id: number;
  pos: Vec;
  arm: number;
  life: number;
  params: CastParams;
}

/** 氷結地帯 */
export interface FrostField {
  pos: Vec;
  timer: number;
  total: number;
  tick: number;
  params: CastParams;
}

/** 回転弾幕の弾（projectiles.ts を通さず、ここで当たり判定する） */
export interface SkillBullet {
  pos: Vec;
  vel: Vec;
  life: number;
  params: CastParams;
  hitIds: Set<number>;
  pierceLeft: number;
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
  strikes: ThunderStrike[];
  wells: GravityWell[];
  mines: Mine[];
  fields: FrostField[];
  bullets: SkillBullet[];
  runes: RuneTablet[];
  floorStones: FloorStone[];
  frenzy: TimedMul;
  lifesteal: TimedMul;
  /** 加速: 移動倍率と残り秒。効果中はダッシュの CD が 0 */
  haste: TimedMul;
  /** 加速の反動: この間ダッシュ不可 */
  exhaustTimer: number;
  /** 呪い: 敵 id → 残り秒と倍率 */
  curses: Map<number, { time: number; bonus: number }>;
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
  /** 共通最低間隔の残り秒（docs/COMBAT_DESIGN.md B-2） */
  gcd: number;
  /** HUD: マナ不足の点滅の残り秒 */
  manaFlash: number;
}
