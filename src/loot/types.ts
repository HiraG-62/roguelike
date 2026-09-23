import type { StatusKind, StatusProc } from "../core/status";
import type { Vec } from "../core/vec";
import { ATTR, MANA } from "../data/tuning";

/**
 * 装備システム（響き・揺らぎ・来歴）の共有型。docs/LOOT_DESIGN.md を参照。
 * 生成・集計・永続化・UI は全部この型を介してやり取りする。
 */

export const SLOTS = ["weapon", "gun", "armor", "boots", "ring", "amulet"] as const;
export type Slot = (typeof SLOTS)[number];

/**
 * 揺らぎの見た目の分類（旧レアリティ。キーは互換のため英語のまま残す）。
 * 格付けではなく「どれだけ荒れているか」を表す。値の決め方は flux.ts の fluxClassOf。
 * - normal = 静: 揺らぎが小さい
 * - magic = 揺: ほどほどに振れている
 * - rare = 荒: 大きく振れている（上振れも下振れも）
 * - unique = 反転あり: 裏返った性質を 1 つ以上持つ
 */
export const RARITIES = ["normal", "magic", "rare", "unique"] as const;
export type Rarity = (typeof RARITIES)[number];

export const RARITY_COLOR: Record<Rarity, string> = {
  normal: "#e0e0e0",
  magic: "#6a8cff",
  rare: "#ffd75f",
  unique: "#b070ff",
};

/** 揺らぎ分類の表示名 */
export const RARITY_LABEL: Readonly<Record<Rarity, string>> = {
  normal: "静",
  magic: "揺",
  rare: "荒",
  unique: "反転あり",
};

// ---------------------------------------------------------------------------
// 色（響き）。docs/LOOT_DESIGN.md「色と共鳴」
// ---------------------------------------------------------------------------

/** 性質の色。紅 / 蒼 / 翠 / 金 / 冥 */
export const TRAIT_COLORS = ["crimson", "azure", "jade", "gold", "umbra"] as const;
export type TraitColor = (typeof TRAIT_COLORS)[number];

export const TRAIT_COLOR_HEX: Readonly<Record<TraitColor, string>> = {
  crimson: "#e8553a",
  azure: "#3a8ee8",
  jade: "#49c46b",
  gold: "#f2c84b",
  umbra: "#9a5ae0",
};

export const TRAIT_COLOR_LABEL: Readonly<Record<TraitColor, string>> = {
  crimson: "紅",
  azure: "蒼",
  jade: "翠",
  gold: "金",
  umbra: "冥",
};

/** 性質の出自。found = 拾った時点 / bud = 芽吹いた / named = 名のある遺物の固定 */
export type TraitOrigin = "found" | "bud" | "named";

/** @deprecated prefix / suffix は廃止。旧セーブの読み込みとテスト用の型としてだけ残す */
export type AffixKind = "prefix" | "suffix";

/** アイテムに付いた性質の実体（ロール済み） */
export interface AffixRoll {
  key: string;
  /** @deprecated 廃止（旧セーブ互換）。新しい生成では付けない */
  kind?: AffixKind;
  /** @deprecated 廃止（旧セーブ互換）。新しい生成では付けない */
  tier?: number;
  value: number;
  /** 2 値持ちの性質（例: burn は chance と dps） */
  value2?: number;
  /** 色。欠けていれば定義の既定色（colors.ts の traitColorOf） */
  color?: TraitColor;
  /** 発見深度で決まる期待値（表示単位）。value = nominal * (1 + flux) */
  nominal?: number;
  nominal2?: number;
  /** 期待値からの相対的なずれ。-1 を下回ると反転 */
  flux?: number;
  /** 反転（値が負）。色は冥になり、共鳴への重みが 2 倍 */
  inverted?: boolean;
  origin?: TraitOrigin;
}

// ---------------------------------------------------------------------------
// 来歴と芽。docs/LOOT_DESIGN.md「来歴と芽」
// ---------------------------------------------------------------------------

/** 装備中に起きた出来事の記録（そのアイテムを装備していた間だけ数える） */
export interface Provenance {
  kills: number;
  /** 敵種 key → 撃破数 */
  killsByEnemy: Record<string, number>;
  justDodges: number;
  hurtTaken: number;
  bosses: number;
  roomsCleared: number;
  floorsCleared: number;
  /** 装備中に到達した最深 */
  deepest: number;
  // ---- 2026-09 追加（docs/ideas/loot-expansion.md 7 章）。旧セーブは 0 で補う ----
  /** 敵を怯ませた回数（ボスのダウンを含む） */
  staggers: number;
  /** カウンター（予備動作中の敵への近接）の成立回数 */
  counters: number;
  /** スキルの発動回数 */
  skillCasts: number;
  /** エリートの撃破数 */
  eliteKills: number;
  /** 殲滅（封鎖中の部屋の最後の 1 体）の回数 */
  lastKills: number;
}

export function createEmptyProvenance(): Provenance {
  return {
    kills: 0,
    killsByEnemy: {},
    justDodges: 0,
    hurtTaken: 0,
    bosses: 0,
    roomsCleared: 0,
    floorsCleared: 0,
    deepest: 0,
    staggers: 0,
    counters: 0,
    skillCasts: 0,
    eliteKills: 0,
    lastKills: 0,
  };
}

/** 芽の 2 択の履歴 1 件。選ばなかった方も記録する（二度と出ない） */
export interface BudChoice {
  /** 節目の key（例 "kills:50"） */
  milestone: string;
  options: [AffixRoll, AffixRoll];
  chosen: 0 | 1;
}

/** 提示中（未選択）の芽 */
export interface BudOffer {
  milestone: string;
  options: [AffixRoll, AffixRoll];
}

/**
 * GameState.pendingBud: 装備中のアイテムに提示中の芽（UI が 2 択を出し、chooseBud で選ぶ）。
 * 実体は Item.budOffer。これはその参照と表示用の情報
 */
export interface PendingBud {
  itemId: string;
  slot: Slot;
  milestone: string;
  /** 節目の表示名（例「撃破 50」） */
  milestoneLabel: string;
  options: [AffixRoll, AffixRoll];
}

export interface Item {
  /** 永続 ID。seed と生成順から作る */
  id: string;
  seed: number;
  baseKey: string;
  slot: Slot;
  /** 揺らぎの見た目の分類（格付けではない）。RARITIES の説明を参照 */
  rarity: Rarity;
  /** 生成に使った深度（発見深度 + 0..2）。期待値と揺らぎ幅の入力 */
  itemLevel: number;
  /** 表示名。銘があれば銘、名のある遺物は固有名、それ以外は「{色の形容}{ベース名}」 */
  name: string;
  /** ベース固有の暗黙補正（ロール済み）。色の配合には数えない */
  implicit: AffixRoll | null;
  /** 性質 */
  affixes: AffixRoll[];
  foundDepth: number;
  /** epoch ms */
  foundAt: number;
  // ---- 以下は新形式で必ず入る（旧セーブ・テストのリテラルのため optional。profile.ts の migrateItem が補う） ----
  provenance?: Provenance;
  /** 余白: まだ芽吹ける数 */
  margin?: number;
  /** 余白の上限（削ぎで戻せる上限） */
  marginMax?: number;
  /** 到達済みの節目（二度と芽は出ない） */
  milestones?: string[];
  /** 芽の 2 択の履歴 */
  buds?: BudChoice[];
  /** 提示中の芽（未選択）。ランを跨いで残る */
  budOffer?: BudOffer | null;
  /** 銘。余白を使い切ると来歴から刻まれる */
  inscription?: string;
  /** 名のある遺物の key（generator.ts の UNIQUES） */
  namedKey?: string;
}

export interface FloorItem {
  id: number;
  item: Item;
  pos: Vec;
  bobTime: number;
}

export type Equipment = Record<Slot, Item | null>;

/** 1 ラン分の履歴（死亡 or R 再開のたびに記録）。docs は無いので profile.ts の HISTORY_LIMIT を参照 */
export interface RunHistoryEntry {
  /** epoch ms */
  date: number;
  seedText: string;
  depth: number;
  kills: number;
  score: number;
  bestCombo: number;
  durationSec: number;
  /** "defeated"（死亡）/ "abandoned"（R や Restart で中断） */
  cause?: string;
}

export interface ProfileMeta {
  runs: number;
  bestDepth: number;
  totalKills: number;
  bestScore: number;
  /** 追加フィールド。version は変えず、欠けていても loadProfile 側で補う */
  history?: RunHistoryEntry[];
}

export interface Profile {
  version: 1;
  equipment: Equipment;
  stash: Item[];
  meta: ProfileMeta;
}

export function createEmptyEquipment(): Equipment {
  return { weapon: null, gun: null, armor: null, boots: null, ring: null, amulet: null };
}

export function createEmptyProfile(): Profile {
  return {
    version: 1,
    equipment: createEmptyEquipment(),
    stash: [],
    meta: { runs: 0, bestDepth: 0, totalKills: 0, bestScore: 0, history: [] },
  };
}

// ---------------------------------------------------------------------------
// ステータス（素質値）。docs/COMBAT_DESIGN.md A
// ---------------------------------------------------------------------------

/** 筋力 / 技巧 / 体力 / 精神 / 霊力 */
export const ATTR_KEYS = ["str", "dex", "vit", "mnd", "spi"] as const;
export type AttrKey = (typeof ATTR_KEYS)[number];
export type Attributes = Record<AttrKey, number>;

/** 係数表。技の威力 = base + Σ(係数 × 実効値)。base は基礎値のとき現行値と一致するよう逆算する */
export type Scaling = { base: number } & Partial<Record<AttrKey, number>>;

/** 全ステータスが同じ値の Attributes */
export function uniformAttributes(value: number): Attributes {
  return { str: value, dex: value, vit: value, mnd: value, spi: value };
}

/**
 * 装備から畳み込んだ派生ステータス。ゲームロジックはこれだけを見る。
 * 倍率は 1 が基準、確率は 0..1、flat は加算値。
 */
export interface PlayerStats {
  maxHp: number;
  hpRegen: number;
  lifeOnHit: number;
  lifeOnKill: number;
  armor: number;
  damageTakenMul: number;
  thorns: number;

  moveSpeedMul: number;
  dashCooldownMul: number;
  dashCharges: number;
  dashDistanceMul: number;

  meleeDamageMul: number;
  meleeDamageFlat: number;
  attackSpeedMul: number;
  meleeReachMul: number;
  knockbackMul: number;
  damageVsStaggeredMul: number;

  rangedDamageMul: number;
  rangedDamageFlat: number;
  fireRateMul: number;
  projectileCount: number;
  pierce: number;
  projectileSpeedMul: number;

  critChance: number;
  critMul: number;

  energyGainMul: number;
  burstDamageMul: number;
  burstRadiusMul: number;

  comboWindowBonus: number;
  /** コンボ 1 スタックあたりのダメージ倍率加算（上限は comboDamageCap） */
  comboDamagePerStack: number;
  comboDamageCap: number;
  /** JUST 回避後の一定時間、この倍率 */
  justDodgeDamageMul: number;
  justDodgeWindow: number;

  burnChance: number;
  burnDps: number;
  chillChance: number;
  chillSlow: number;
  shockChance: number;
  shockDamage: number;
  explodeOnKillChance: number;
  explodeDamage: number;

  /**
   * 誓約（旧キーストーン）: 遊び方そのものを変える大型改造の key 一覧（例 "glassCannon", "berserker", "blinkDash"）。
   * 同じ key は 1 つまで。相互排他グループは affixes.ts 側で定義する。
   */
  keystones: string[];
  /** trigger × condition × effect 文法で生成された条件付き効果 */
  triggers: TriggeredEffect[];
  /** 装備全体の色の配合で発現した共鳴（resonance.ts）。数値効果は他のフィールドに畳み込み済み */
  resonance: Resonance;

  // ---- 戦闘再設計（docs/COMBAT_DESIGN.md F-1）。既定値は中立 ----
  /** 装備・共鳴・祝福・ラン内振り分けの生の合計（逓減前）。基礎値を含む */
  attributes: Attributes;
  /** 逓減後の実効値。deriveAttributes が埋める。計算はこちらを使う */
  attributesEff: Attributes;
  maxMana: number;
  /** 毎秒 */
  manaRegen: number;
  manaGainMul: number;
  /** スキルのマナコストに掛ける倍率（装備の性質・祝福で下げる。下限は MANA.costMulMin） */
  manaCostMul: number;
  /** 撃破時のマナ回収に足す固定値（MANA.onKill に加算。manaGainMul も掛かる） */
  manaOnKill: number;
  skillDamageMul: number;
  poiseDamageMul: number;
  statusPotencyMul: number;
  /** プレイヤーが受ける状態異常の持続倍率 */
  statusTakenMul: number;
  /** 性質「弾斬り」: 0 より大きければ近接の active で敵弾を消す */
  bulletCut: number;
  statusProcs: StatusProc[];
  /** 性質のルール変更（docs/ideas/loot-expansion.md）。戦闘側は system/traitHooks.ts が読む */
  traits: TraitStats;
}

/**
 * 性質が持ち込むルール変更の数値。すべて 0 が「効果なし」。% 系は 0.01 単位の加算値（+25% なら 0.25）。
 * 数値のフィールドを PlayerStats の直下に増やすと statsSummary の表示表まで広がるので、ここにまとめる
 */
export interface TraitStats {
  // ---- マナ ----
  /** 敵を怯ませた瞬間に戻るマナ */
  manaOnStagger: number;
  /** マナが少ない間（TRIGGER.trait.lowManaRatio 未満）のマナ回収の加算倍率 */
  lowManaGainMul: number;
  /** マナ満タンの間のスキル威力の加算倍率 */
  fullManaSkillMul: number;
  /** 残りマナが 0 に近いほど効くスキル威力の加算倍率（0 で満額） */
  lowManaSkillMul: number;
  /** 身代わり: 被弾時に払うマナ（0 = 無効）。払えれば被ダメージが TRIGGER.trait.manaShieldMul 倍 */
  manaShieldCost: number;
  /** 沈黙中の敵を倒したときに戻るマナ */
  silencedKillMana: number;
  /** 殲滅で戻るマナ（最大マナに対する割合 0..1） */
  lastKillManaRatio: number;
  /** マナ満タンで溢れた回収のうち、必殺ゲージへ移す割合 0..1 */
  manaOverflowToEnergy: number;
  // ---- 与ダメージ（近接・射撃・スキル。proc は対象外） ----
  /** 対象に付いた状態異常 1 種ごと */
  damagePerStatusKind: number;
  /** 自分に付いた状態異常 1 種ごと */
  damagePerSelfStatus: number;
  /** 予備動作中の敵へ / それ以外への減少 */
  windupDamageMul: number;
  offWindupPenalty: number;
  /** 堅守中の敵へ */
  guardedDamageMul: number;
  /** ボスへ / ボス以外への減少 */
  bossDamageMul: number;
  nonBossPenalty: number;
  /** 封鎖中の部屋で / それ以外での減少 */
  lockedDamageMul: number;
  unlockedPenalty: number;
  /** 暗闇フロアの射撃 / それ以外のフロアの射撃の減少 */
  darkRangedMul: number;
  lightRangedPenalty: number;
  /** 死神が出ている間 */
  reaperDamageMul: number;
  // ---- 怯み値 ----
  fearPoiseMul: number;
  silencedPoiseMul: number;
  vulnerablePoiseMul: number;
  guardedPoiseMul: number;
  /** 蓄積が耐性の半分以上の敵へ / 半分未満の敵への減少（楔） */
  wedgePoiseMul: number;
  wedgePenalty: number;
  /** 射撃の怯み値の加算倍率（負で減る） */
  rangedPoiseMul: number;
  /** 会心時の怯み値の加算倍率 */
  critPoiseMul: number;
  /** 堅守による射撃の怯み値の減衰を打ち消す割合 0..1（剥がし撃ち） */
  guardPierce: number;
  /** 敵を怯ませた瞬間、周囲の敵に与える怯み値（崩れの反響） */
  staggerQuake: number;
  // ---- 生存 ----
  healOnStagger: number;
  /** 弱体中の敵から受けるダメージの減少 / 弱体でない敵からの増加 */
  weakenedGuard: number;
  weakenedExposure: number;
  // ---- その他 ----
  /** 1 以上: 殲滅の瞬間に敵弾をすべて消す（目覚め「幕引き」） */
  lastKillClearsBullets: number;
  /** 殲滅で得るエネルギー */
  lastKillEnergy: number;
  // ---- 装備全体の文脈（computeStats が性質の適用前に入れる。性質の apply はこれを読む） ----
  /** 装備全体の残り余白の合計 */
  gearMargin: number;
  /** 装備している遺物の数 */
  gearItems: number;
  /** 銘を持つ遺物の数 */
  gearInscribed: number;
  /** 反転した性質の数 */
  gearInverted: number;
  /** 異色（既定と別の色で生まれた）性質の数 */
  gearOffColor: number;
}

export const DEFAULT_TRAIT_STATS: Readonly<TraitStats> = {
  manaOnStagger: 0,
  lowManaGainMul: 0,
  fullManaSkillMul: 0,
  lowManaSkillMul: 0,
  manaShieldCost: 0,
  silencedKillMana: 0,
  lastKillManaRatio: 0,
  manaOverflowToEnergy: 0,
  damagePerStatusKind: 0,
  damagePerSelfStatus: 0,
  windupDamageMul: 0,
  offWindupPenalty: 0,
  guardedDamageMul: 0,
  bossDamageMul: 0,
  nonBossPenalty: 0,
  lockedDamageMul: 0,
  unlockedPenalty: 0,
  darkRangedMul: 0,
  lightRangedPenalty: 0,
  reaperDamageMul: 0,
  fearPoiseMul: 0,
  silencedPoiseMul: 0,
  vulnerablePoiseMul: 0,
  guardedPoiseMul: 0,
  wedgePoiseMul: 0,
  wedgePenalty: 0,
  rangedPoiseMul: 0,
  critPoiseMul: 0,
  guardPierce: 0,
  staggerQuake: 0,
  healOnStagger: 0,
  weakenedGuard: 0,
  weakenedExposure: 0,
  lastKillClearsBullets: 0,
  lastKillEnergy: 0,
  gearMargin: 0,
  gearItems: 0,
  gearInscribed: 0,
  gearInverted: 0,
  gearOffColor: 0,
};

/**
 * 共鳴の種類。同時に 1 つだけ。
 * dominant = 支配（1 色 >= 50%）/ dual = 二重（上位 2 色が各 >= 30%）/
 * triad = 三和音（上位 3 色が各 >= 22%）/ scatter = 散光（全色 < 30%）/ none = なし
 */
export type ResonanceKind = "dominant" | "dual" | "triad" | "scatter" | "none";

export interface Resonance {
  kind: ResonanceKind;
  /** dominant は 1 色、dual は 2 色、triad は 3 色（TRAIT_COLORS 順）、scatter / none は空 */
  colors: TraitColor[];
  /** 色ごとの配合比（合計 1。性質が無ければ全部 0） */
  ratios: Record<TraitColor, number>;
}

export function createEmptyResonance(): Resonance {
  return { kind: "none", colors: [], ratios: { crimson: 0, azure: 0, jade: 0, gold: 0, umbra: 0 } };
}

export type TriggerKind =
  | "onMeleeHit"
  | "onShoot"
  | "onKill"
  | "onJustDodge"
  | "onDash"
  | "onHurt"
  | "onRoomClear"
  | "everyNthMeleeHit"
  /** 敵を怯ませた瞬間（ボスのダウンを含む） */
  | "onStagger"
  /** カウンター（予備動作中の敵への近接）が成立した瞬間 */
  | "onCounter";

export type TriggerCondition =
  | "always"
  | "aboveHalfHp"
  | "belowHalfHp"
  | "comboAbove10"
  | "roomLocked"
  | "fullEnergy"
  // ---- 2026-09 追加（docs/ideas/loot-expansion.md 6-1）----
  | "manaFull"
  | "manaLow"
  | "selfAfflicted"
  /** 以下は対象（TriggerContext.targetId の敵）を見る。対象の無い起点とは組まない */
  | "targetInWindup"
  | "targetGuarded"
  | "targetMultiStatus"
  | "targetElite";

export type TriggerEffectKind =
  | "shockwave"
  | "spawnBullets"
  | "chainLightning"
  | "burnNearby"
  | "freezeNearby"
  | "explode"
  | "heal"
  | "damageBuff"
  | "speedBuff"
  | "energy"
  | "invuln"
  // ---- 2026-09 追加（docs/ideas/loot-expansion.md 6-2）----
  | "restoreMana"
  | "addPoise"
  /** 状態異常を付ける。種類は TriggeredEffect.status */
  | "inflict"
  | "cleanse"
  | "extendStatus"
  | "skillHaste"
  /** 照準方向へ射撃の弾を撃つ（射撃の性質が乗る） */
  | "volley"
  /** 失った HP の割合を回復する（誓約・性質の固定効果専用。文法からは出ない） */
  | "healMissing";

export interface TriggeredEffect {
  trigger: TriggerKind;
  /** everyNthMeleeHit の N */
  every?: number;
  condition: TriggerCondition;
  effect: TriggerEffectKind;
  /** 効果量（ダメージ・回復量・倍率加算など効果ごとに解釈） */
  magnitude: number;
  /** バフ系の持続秒 */
  duration?: number;
  /** spawnBullets の弾数など */
  count?: number;
  /** 発動確率 0..1 */
  chance: number;
  /** inflict の状態異常 */
  status?: StatusKind;
}

export const DEFAULT_STATS: Readonly<PlayerStats> = {
  maxHp: 100,
  hpRegen: 0,
  lifeOnHit: 0,
  lifeOnKill: 0,
  armor: 0,
  damageTakenMul: 1,
  thorns: 0,

  moveSpeedMul: 1,
  dashCooldownMul: 1,
  dashCharges: 1,
  dashDistanceMul: 1,

  meleeDamageMul: 1,
  meleeDamageFlat: 0,
  attackSpeedMul: 1,
  meleeReachMul: 1,
  knockbackMul: 1,
  damageVsStaggeredMul: 1,

  rangedDamageMul: 1,
  rangedDamageFlat: 0,
  fireRateMul: 1,
  projectileCount: 1,
  pierce: 0,
  projectileSpeedMul: 1,

  critChance: 0.05,
  critMul: 1.5,

  energyGainMul: 1,
  burstDamageMul: 1,
  burstRadiusMul: 1,

  comboWindowBonus: 0,
  comboDamagePerStack: 0,
  comboDamageCap: 0,
  justDodgeDamageMul: 1,
  justDodgeWindow: 0,

  burnChance: 0,
  burnDps: 0,
  chillChance: 0,
  chillSlow: 0,
  shockChance: 0,
  shockDamage: 0,
  explodeOnKillChance: 0,
  explodeDamage: 0,

  keystones: [],
  triggers: [],
  resonance: createEmptyResonance(),

  attributes: uniformAttributes(ATTR.base),
  attributesEff: uniformAttributes(ATTR.base),
  maxMana: MANA.baseMax,
  manaRegen: MANA.baseRegen,
  manaGainMul: 1,
  manaCostMul: 1,
  manaOnKill: 0,
  skillDamageMul: 1,
  poiseDamageMul: 1,
  statusPotencyMul: 1,
  statusTakenMul: 1,
  bulletCut: 0,
  statusProcs: [],
  traits: DEFAULT_TRAIT_STATS,
};
