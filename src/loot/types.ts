import type { Vec } from "../core/vec";

/**
 * 装備システムの共有型。docs/LOOT_DESIGN.md を参照。
 * 生成・集計・永続化・UI は全部この型を介してやり取りする。
 */

export const SLOTS = ["weapon", "gun", "armor", "boots", "ring", "amulet"] as const;
export type Slot = (typeof SLOTS)[number];

export const RARITIES = ["normal", "magic", "rare", "unique"] as const;
export type Rarity = (typeof RARITIES)[number];

export const RARITY_COLOR: Record<Rarity, string> = {
  normal: "#e0e0e0",
  magic: "#6a8cff",
  rare: "#ffd75f",
  unique: "#ff9040",
};

export type AffixKind = "prefix" | "suffix";

/** アイテムに付いたアフィックスの実体（ロール済み） */
export interface AffixRoll {
  key: string;
  kind: AffixKind;
  /** 1 が最上位 */
  tier: number;
  value: number;
  /** 2 値持ちのアフィックス（例: burn は chance と dps） */
  value2?: number;
}

export interface Item {
  /** 永続 ID。seed と生成順から作る */
  id: string;
  seed: number;
  baseKey: string;
  slot: Slot;
  rarity: Rarity;
  itemLevel: number;
  name: string;
  /** ベース固有の暗黙補正（ロール済み） */
  implicit: AffixRoll | null;
  affixes: AffixRoll[];
  foundDepth: number;
  /** epoch ms */
  foundAt: number;
}

export interface FloorItem {
  id: number;
  item: Item;
  pos: Vec;
  bobTime: number;
}

export type Equipment = Record<Slot, Item | null>;

export interface ProfileMeta {
  runs: number;
  bestDepth: number;
  totalKills: number;
  bestScore: number;
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
    meta: { runs: 0, bestDepth: 0, totalKills: 0, bestScore: 0 },
  };
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
   * キーストーン: 遊び方そのものを変える大型改造の key 一覧（例 "glassCannon", "berserker", "blinkDash"）。
   * 同じ key は 1 つまで。相互排他グループは affixes.ts 側で定義する。
   */
  keystones: string[];
  /** trigger × condition × effect 文法で生成された条件付き効果 */
  triggers: TriggeredEffect[];
}

export type TriggerKind =
  | "onMeleeHit"
  | "onShoot"
  | "onKill"
  | "onJustDodge"
  | "onDash"
  | "onHurt"
  | "onRoomClear"
  | "everyNthMeleeHit";

export type TriggerCondition =
  | "always"
  | "aboveHalfHp"
  | "belowHalfHp"
  | "comboAbove10"
  | "roomLocked"
  | "fullEnergy";

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
  | "invuln";

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
};
