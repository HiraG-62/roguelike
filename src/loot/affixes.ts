import { decodeTriggerRoll, formatTrigger, isTriggerKey } from "./triggers";
import type { AffixKind, AffixRoll, PlayerStats, Slot } from "./types";

/**
 * アフィックス定義（データ駆動）。docs/LOOT_DESIGN.md の「アフィックス」を参照。
 * 値はすべて「表示単位」で保持する（+25% なら value = 25）。apply で PlayerStats の単位に変換する。
 * - 倍率系: % × 0.01 を *Mul に加算
 * - flat 系: そのまま加算
 * - 確率系: % × 0.01（0..1）
 */

/** % 表示値 → 内部値 */
const PERCENT = 0.01;

export type AffixTag =
  | "damage"
  | "melee"
  | "ranged"
  | "life"
  | "defense"
  | "speed"
  | "mobility"
  | "critical"
  | "burst"
  | "combo"
  | "elemental"
  | "utility"
  /** 変換（A を B に変換する。"convert" 段階で適用） */
  | "conversion"
  /** 代償付き（label に代償も出す）。純粋な上位互換を作らないための枠 */
  | "tradeoff";

/** ロール幅。value2 を持つアフィックスは min2/max2 も持つ */
export interface RollRange {
  min: number;
  max: number;
  min2?: number;
  max2?: number;
}

export interface AffixTier extends RollRange {
  /** この tier が抽選対象になる最低 itemLevel */
  minLevel: number;
}

/**
 * 適用段階。flat → scale → convert の順に畳み込む（例: max HP % は flat の max HP を全部足した後に掛ける）。
 * convert は変換アフィックス用で、scale の後・ソフトキャップとキーストーンの前に掛かる
 * （「盛った結果」を別の軸へ移す。キーストーンの数値効果は変換されない）
 */
export type ApplyStage = "flat" | "scale" | "convert";
export const APPLY_STAGES: readonly ApplyStage[] = ["flat", "scale", "convert"];

export type ApplyFn = (stats: PlayerStats, value: number, value2: number) => void;

interface AffixDefCommon {
  key: string;
  /** 表示テンプレ。{v} と {v2} を値で置換する */
  label: string;
  tags: readonly AffixTag[];
  slots: readonly Slot[];
  /** index 0 = T1（最上位）。index が大きいほど低 tier・低 minLevel */
  tiers: readonly AffixTier[];
  /** value の小数桁（省略時 0 = 整数） */
  decimals?: number;
  /** value2 の小数桁（省略時 0 = 整数） */
  decimals2?: number;
  /** 省略時 "flat" */
  stage?: ApplyStage;
  apply: ApplyFn;
}

export interface PrefixDef extends AffixDefCommon {
  kind: "prefix";
  /** magic 命名用（"Vicious Longsword"） */
  prefixName: string;
}

export interface SuffixDef extends AffixDefCommon {
  kind: "suffix";
  /** magic 命名用（"Longsword of the Storm"） */
  suffixName: string;
}

export type AffixDef = PrefixDef | SuffixDef;

/** ベース固有の暗黙補正。アフィックスと同じ仕組みで適用・表示する */
export interface ImplicitDef {
  key: string;
  label: string;
  range: RollRange;
  decimals?: number;
  decimals2?: number;
  stage?: ApplyStage;
  apply: ApplyFn;
}

// ---------------------------------------------------------------------------
// 定義用ヘルパー
// ---------------------------------------------------------------------------

function prefix(def: Omit<PrefixDef, "kind">): PrefixDef {
  return { ...def, kind: "prefix" };
}

function suffix(def: Omit<SuffixDef, "kind">): SuffixDef {
  return { ...def, kind: "suffix" };
}

/** 1 値 tier */
function t(minLevel: number, min: number, max: number): AffixTier {
  return { minLevel, min, max };
}

/** 2 値 tier */
function t2(minLevel: number, min: number, max: number, min2: number, max2: number): AffixTier {
  return { minLevel, min, max, min2, max2 };
}

const pct = (v: number): number => v * PERCENT;

// スロットのよく使う組み合わせ
const MELEE_SLOTS: readonly Slot[] = ["weapon", "ring", "amulet"];
const RANGED_SLOTS: readonly Slot[] = ["gun", "ring", "amulet"];
const ATTACK_SLOTS: readonly Slot[] = ["weapon", "gun", "ring"];
const OFFENSE_SLOTS: readonly Slot[] = ["weapon", "gun", "ring", "amulet"];
const JEWELRY_SLOTS: readonly Slot[] = ["ring", "amulet"];

// ---------------------------------------------------------------------------
// アフィックス一覧
// ---------------------------------------------------------------------------

export const AFFIXES: readonly AffixDef[] = [
  // ---- 近接 ----
  prefix({
    key: "meleeDamagePct",
    label: "+{v}% melee damage",
    prefixName: "Vicious",
    tags: ["damage", "melee"],
    slots: MELEE_SLOTS,
    tiers: [t(26, 50, 60), t(19, 40, 49), t(13, 30, 39), t(8, 21, 29), t(4, 13, 20), t(1, 6, 12)],
    apply: (s, v) => {
      s.meleeDamageMul += pct(v);
    },
  }),
  prefix({
    key: "meleeDamageFlat",
    label: "+{v} melee damage",
    prefixName: "Heavy",
    tags: ["damage", "melee"],
    slots: ["weapon", "ring"],
    tiers: [t(26, 14, 18), t(19, 10, 13), t(13, 7, 9), t(8, 5, 6), t(4, 3, 4), t(1, 1, 2)],
    apply: (s, v) => {
      s.meleeDamageFlat += v;
    },
  }),
  suffix({
    key: "attackSpeed",
    label: "+{v}% attack speed",
    suffixName: "of Haste",
    tags: ["speed", "melee"],
    slots: MELEE_SLOTS,
    tiers: [t(24, 14, 16), t(15, 10, 13), t(8, 7, 9), t(3, 4, 6), t(1, 2, 3)],
    apply: (s, v) => {
      s.attackSpeedMul += pct(v);
    },
  }),
  suffix({
    key: "meleeReach",
    label: "+{v}% melee reach",
    suffixName: "of Reach",
    tags: ["melee", "utility"],
    slots: ["weapon", "amulet"],
    tiers: [t(18, 13, 18), t(8, 8, 12), t(1, 4, 7)],
    apply: (s, v) => {
      s.meleeReachMul += pct(v);
    },
  }),
  suffix({
    key: "knockback",
    label: "+{v}% knockback",
    suffixName: "of Force",
    tags: ["melee", "utility"],
    slots: ["weapon", "armor"],
    tiers: [t(16, 25, 40), t(8, 15, 24), t(1, 8, 14)],
    apply: (s, v) => {
      s.knockbackMul += pct(v);
    },
  }),
  prefix({
    key: "damageVsStaggered",
    label: "+{v}% damage vs staggered enemies",
    prefixName: "Brutal",
    tags: ["damage", "melee"],
    slots: ["weapon", "ring"],
    tiers: [t(26, 40, 55), t(16, 25, 39), t(8, 15, 24), t(1, 8, 14)],
    apply: (s, v) => {
      s.damageVsStaggeredMul += pct(v);
    },
  }),

  // ---- 射撃 ----
  prefix({
    key: "rangedDamagePct",
    label: "+{v}% ranged damage",
    prefixName: "Deadeye's",
    tags: ["damage", "ranged"],
    slots: RANGED_SLOTS,
    tiers: [t(26, 50, 60), t(19, 40, 49), t(13, 30, 39), t(8, 21, 29), t(4, 13, 20), t(1, 6, 12)],
    apply: (s, v) => {
      s.rangedDamageMul += pct(v);
    },
  }),
  prefix({
    key: "rangedDamageFlat",
    label: "+{v} ranged damage",
    prefixName: "Barbed",
    tags: ["damage", "ranged"],
    slots: ["gun", "ring"],
    tiers: [t(28, 7, 9), t(20, 5, 7), t(12, 3, 5), t(6, 2, 3), t(1, 1, 2)],
    apply: (s, v) => {
      s.rangedDamageFlat += v;
    },
  }),
  suffix({
    key: "fireRate",
    label: "+{v}% fire rate",
    suffixName: "of Rapidity",
    tags: ["speed", "ranged"],
    slots: RANGED_SLOTS,
    tiers: [t(24, 14, 16), t(15, 10, 13), t(8, 7, 9), t(3, 4, 6), t(1, 2, 3)],
    apply: (s, v) => {
      s.fireRateMul += pct(v);
    },
  }),
  suffix({
    key: "projectiles",
    label: "+{v} projectiles, -{v2}% ranged damage",
    suffixName: "of Splitting",
    tags: ["ranged", "tradeoff"],
    slots: ["gun", "amulet"],
    tiers: [t2(30, 2, 2, 30, 40), t2(10, 1, 1, 15, 25)],
    apply: (s, v, v2) => {
      s.projectileCount += v;
      s.rangedDamageMul -= pct(v2);
    },
  }),
  suffix({
    key: "pierce",
    label: "+{v} pierce",
    suffixName: "of Piercing",
    tags: ["ranged"],
    slots: ["gun"],
    tiers: [t(18, 2, 2), t(3, 1, 1)],
    apply: (s, v) => {
      s.pierce += v;
    },
  }),
  suffix({
    key: "projectileSpeed",
    label: "+{v}% projectile speed",
    suffixName: "of Velocity",
    tags: ["ranged", "speed"],
    slots: ["gun", "ring"],
    tiers: [t(18, 19, 28), t(8, 11, 18), t(1, 6, 10)],
    apply: (s, v) => {
      s.projectileSpeedMul += pct(v);
    },
  }),

  // ---- 生存 ----
  prefix({
    key: "maxLife",
    label: "+{v} max HP",
    prefixName: "Stalwart",
    tags: ["life"],
    slots: ["armor", "boots", "ring", "amulet"],
    tiers: [t(32, 61, 80), t(24, 46, 60), t(16, 31, 45), t(10, 21, 30), t(5, 11, 20), t(1, 5, 10)],
    apply: (s, v) => {
      s.maxHp += v;
    },
  }),
  prefix({
    key: "maxLifePct",
    label: "+{v}% max HP",
    prefixName: "Vigorous",
    tags: ["life"],
    slots: ["armor", "amulet"],
    tiers: [t(30, 14, 18), t(20, 10, 13), t(12, 6, 9), t(5, 3, 5)],
    stage: "scale",
    apply: (s, v) => {
      s.maxHp *= 1 + pct(v);
    },
  }),
  suffix({
    key: "hpRegen",
    label: "+{v} HP regenerated per second",
    suffixName: "of Regrowth",
    tags: ["life"],
    slots: ["armor", "boots", "ring", "amulet"],
    tiers: [t(28, 2.9, 4), t(20, 1.9, 2.8), t(12, 1.1, 1.8), t(6, 0.6, 1), t(1, 0.2, 0.5)],
    decimals: 1,
    apply: (s, v) => {
      s.hpRegen += v;
    },
  }),
  suffix({
    key: "lifeOnHit",
    label: "+{v} life on hit",
    suffixName: "of the Leech",
    tags: ["life"],
    slots: ATTACK_SLOTS,
    tiers: [t(26, 4, 5), t(16, 3, 3), t(8, 2, 2), t(1, 1, 1)],
    apply: (s, v) => {
      s.lifeOnHit += v;
    },
  }),
  suffix({
    key: "lifeOnKill",
    label: "+{v} life on kill",
    suffixName: "of Feasting",
    tags: ["life"],
    slots: ["weapon", "gun", "armor", "ring", "amulet"],
    tiers: [t(25, 11, 15), t(15, 7, 10), t(7, 4, 6), t(1, 1, 3)],
    apply: (s, v) => {
      s.lifeOnKill += v;
    },
  }),
  prefix({
    key: "armorFlat",
    label: "+{v} armor",
    prefixName: "Reinforced",
    tags: ["defense"],
    slots: ["armor", "boots", "ring"],
    tiers: [t(28, 12, 16), t(20, 8, 11), t(12, 5, 7), t(6, 3, 4), t(1, 1, 2)],
    apply: (s, v) => {
      s.armor += v;
    },
  }),
  prefix({
    key: "damageTaken",
    label: "-{v}% damage taken",
    prefixName: "Warded",
    tags: ["defense"],
    slots: ["armor", "amulet"],
    tiers: [t(24, 6, 8), t(14, 4, 5), t(6, 2, 3)],
    apply: (s, v) => {
      s.damageTakenMul -= pct(v);
    },
  }),
  prefix({
    key: "thorns",
    label: "Reflects {v} damage to attackers",
    prefixName: "Thorned",
    tags: ["defense", "damage"],
    slots: ["armor", "boots"],
    tiers: [t(26, 17, 25), t(16, 10, 16), t(8, 5, 9), t(1, 2, 4)],
    apply: (s, v) => {
      s.thorns += v;
    },
  }),

  // ---- 機動 ----
  prefix({
    key: "moveSpeed",
    label: "+{v}% movement speed",
    prefixName: "Swift",
    tags: ["mobility", "speed"],
    slots: ["boots", "amulet"],
    tiers: [t(30, 21, 25), t(22, 15, 20), t(13, 10, 14), t(6, 6, 9), t(1, 3, 5)],
    apply: (s, v) => {
      s.moveSpeedMul += pct(v);
    },
  }),
  suffix({
    key: "dashCooldown",
    label: "-{v}% dash cooldown",
    suffixName: "of the Wind",
    tags: ["mobility"],
    slots: ["boots", "amulet"],
    tiers: [t(26, 19, 25), t(16, 13, 18), t(8, 8, 12), t(1, 4, 7)],
    apply: (s, v) => {
      s.dashCooldownMul -= pct(v);
    },
  }),
  suffix({
    key: "dashCharge",
    label: "+{v} dash charge",
    suffixName: "of Blinking",
    tags: ["mobility"],
    slots: ["boots"],
    tiers: [t(15, 1, 1)],
    apply: (s, v) => {
      s.dashCharges += v;
    },
  }),
  suffix({
    key: "dashDistance",
    label: "+{v}% dash distance",
    suffixName: "of Leaping",
    tags: ["mobility"],
    slots: ["boots"],
    tiers: [t(18, 16, 24), t(8, 10, 15), t(1, 5, 9)],
    apply: (s, v) => {
      s.dashDistanceMul += pct(v);
    },
  }),

  // ---- クリティカル ----
  suffix({
    key: "critChance",
    label: "+{v}% critical strike chance",
    suffixName: "of Precision",
    tags: ["critical"],
    slots: OFFENSE_SLOTS,
    tiers: [t(30, 7, 10), t(20, 5, 7), t(12, 3, 5), t(6, 2, 3), t(1, 1, 2)],
    apply: (s, v) => {
      s.critChance += pct(v);
    },
  }),
  suffix({
    key: "critMultiplier",
    label: "+{v}% critical strike multiplier",
    suffixName: "of Ruin",
    tags: ["critical", "damage"],
    slots: OFFENSE_SLOTS,
    tiers: [t(30, 39, 50), t(22, 28, 38), t(13, 19, 27), t(6, 11, 18), t(1, 5, 10)],
    apply: (s, v) => {
      s.critMul += pct(v);
    },
  }),

  // ---- 必殺 ----
  suffix({
    key: "energyGain",
    label: "+{v}% energy gain",
    suffixName: "of Focus",
    tags: ["burst"],
    slots: ["weapon", "armor", "ring", "amulet"],
    tiers: [t(25, 25, 35), t(15, 16, 24), t(7, 10, 15), t(1, 5, 9)],
    apply: (s, v) => {
      s.energyGainMul += pct(v);
    },
  }),
  prefix({
    key: "burstDamage",
    label: "+{v}% burst damage",
    prefixName: "Cataclysmic",
    tags: ["burst", "damage"],
    slots: ["weapon", "amulet"],
    tiers: [t(25, 40, 60), t(15, 25, 39), t(7, 15, 24), t(1, 8, 14)],
    apply: (s, v) => {
      s.burstDamageMul += pct(v);
    },
  }),
  suffix({
    key: "burstRadius",
    label: "+{v}% burst radius",
    suffixName: "of Expansion",
    tags: ["burst"],
    slots: ["armor", "amulet"],
    tiers: [t(18, 17, 25), t(8, 10, 16), t(1, 5, 9)],
    apply: (s, v) => {
      s.burstRadiusMul += pct(v);
    },
  }),

  // ---- コンボ ----
  suffix({
    key: "comboWindow",
    label: "+{v}s combo window",
    suffixName: "of Momentum",
    tags: ["combo"],
    slots: ["weapon", "boots", "ring", "amulet"],
    tiers: [t(18, 0.9, 1.3), t(8, 0.5, 0.8), t(1, 0.2, 0.4)],
    decimals: 1,
    apply: (s, v) => {
      s.comboWindowBonus += v;
    },
  }),
  prefix({
    key: "comboDamage",
    label: "+{v}% damage per combo stack (up to {v2}%)",
    prefixName: "Relentless",
    tags: ["combo", "damage"],
    slots: MELEE_SLOTS,
    tiers: [t2(20, 2.3, 3, 26, 40), t2(10, 1.6, 2.2, 16, 25), t2(3, 1, 1.5, 10, 15)],
    decimals: 1,
    apply: (s, v, v2) => {
      s.comboDamagePerStack += pct(v);
      s.comboDamageCap += pct(v2);
    },
  }),
  prefix({
    key: "justDodgeDamage",
    label: "+{v}% damage for {v2}s after a JUST dodge",
    prefixName: "Opportunist's",
    tags: ["combo", "damage"],
    slots: ["boots", "ring", "amulet"],
    tiers: [t2(20, 36, 55, 2, 3), t2(10, 21, 35, 1.5, 2), t2(1, 10, 20, 1, 1.5)],
    decimals2: 1,
    apply: (s, v, v2) => {
      s.justDodgeDamageMul += pct(v);
      s.justDodgeWindow += v2;
    },
  }),

  // ---- 元素 / on-hit ----
  prefix({
    key: "burn",
    label: "{v}% chance to burn for {v2} damage per second",
    prefixName: "Smoldering",
    tags: ["elemental", "damage"],
    slots: ATTACK_SLOTS,
    tiers: [t2(26, 18, 25, 15, 22), t2(16, 12, 17, 9, 14), t2(8, 7, 11, 5, 8), t2(1, 3, 6, 2, 4)],
    apply: (s, v, v2) => {
      s.burnChance += pct(v);
      s.burnDps += v2;
    },
  }),
  prefix({
    key: "chill",
    label: "{v}% chance to chill, slowing by {v2}%",
    prefixName: "Frozen",
    tags: ["elemental", "utility"],
    slots: ATTACK_SLOTS,
    tiers: [t2(18, 12, 18, 23, 30), t2(9, 7, 11, 16, 22), t2(1, 3, 6, 10, 15)],
    apply: (s, v, v2) => {
      s.chillChance += pct(v);
      s.chillSlow += pct(v2);
    },
  }),
  prefix({
    key: "shock",
    label: "{v}% chance to shock, chaining {v2} damage",
    prefixName: "Crackling",
    tags: ["elemental", "damage"],
    slots: ATTACK_SLOTS,
    tiers: [t2(18, 12, 18, 13, 20), t2(9, 7, 11, 7, 12), t2(1, 3, 6, 3, 6)],
    apply: (s, v, v2) => {
      s.shockChance += pct(v);
      s.shockDamage += v2;
    },
  }),
  suffix({
    key: "explodeOnKill",
    label: "{v}% chance for slain enemies to explode for {v2} damage",
    suffixName: "of Detonation",
    tags: ["elemental", "damage"],
    slots: ["weapon", "gun", "amulet"],
    tiers: [t2(23, 16, 24, 21, 32), t2(13, 10, 15, 13, 20), t2(5, 5, 9, 8, 12)],
    apply: (s, v, v2) => {
      s.explodeOnKillChance += pct(v);
      s.explodeDamage += v2;
    },
  }),

  // ---- ハイブリッド ----
  prefix({
    key: "hybridDamage",
    label: "+{v}% melee and ranged damage",
    prefixName: "Savage",
    tags: ["damage", "melee", "ranged"],
    slots: JEWELRY_SLOTS,
    tiers: [t(26, 19, 25), t(16, 13, 18), t(8, 8, 12), t(1, 4, 7)],
    apply: (s, v) => {
      s.meleeDamageMul += pct(v);
      s.rangedDamageMul += pct(v);
    },
  }),
  prefix({
    key: "hybridDefense",
    label: "+{v} max HP and +{v2} armor",
    prefixName: "Bulwark",
    tags: ["life", "defense"],
    slots: ["armor", "boots"],
    tiers: [t2(18, 16, 24, 4, 6), t2(9, 9, 15, 2, 3), t2(1, 4, 8, 1, 1)],
    apply: (s, v, v2) => {
      s.maxHp += v;
      s.armor += v2;
    },
  }),
  suffix({
    key: "hybridSpeed",
    label: "+{v}% attack speed and fire rate",
    suffixName: "of Fury",
    tags: ["speed", "melee", "ranged"],
    slots: JEWELRY_SLOTS,
    tiers: [t(18, 8, 11), t(9, 5, 7), t(1, 2, 4)],
    apply: (s, v) => {
      s.attackSpeedMul += pct(v);
      s.fireRateMul += pct(v);
    },
  }),

  // ---- トレードオフ（value2 = 代償側の値）。同系統の純粋アフィックスより伸び幅が大きい ----
  prefix({
    key: "crushing",
    label: "+{v}% melee damage, -{v2}% attack speed",
    prefixName: "Crushing",
    tags: ["damage", "melee", "tradeoff"],
    slots: ["weapon"],
    tiers: [t2(22, 55, 70, 12, 15), t2(12, 35, 50, 10, 12), t2(4, 20, 30, 8, 10)],
    apply: (s, v, v2) => {
      s.meleeDamageMul += pct(v);
      s.attackSpeedMul -= pct(v2);
    },
  }),
  suffix({
    key: "frenzied",
    label: "+{v}% attack speed, -{v2}% melee damage",
    suffixName: "of Frenzy",
    tags: ["speed", "melee", "tradeoff"],
    slots: ["weapon", "ring"],
    tiers: [t2(20, 20, 26, 10, 12), t2(10, 14, 19, 8, 10), t2(2, 8, 13, 6, 8)],
    apply: (s, v, v2) => {
      s.attackSpeedMul += pct(v);
      s.meleeDamageMul -= pct(v2);
    },
  }),
  prefix({
    key: "overcharged",
    label: "+{v}% ranged damage, -{v2}% fire rate",
    prefixName: "Overcharged",
    tags: ["damage", "ranged", "tradeoff"],
    slots: ["gun"],
    tiers: [t2(22, 55, 70, 12, 15), t2(12, 35, 50, 10, 12), t2(4, 20, 30, 8, 10)],
    apply: (s, v, v2) => {
      s.rangedDamageMul += pct(v);
      s.fireRateMul -= pct(v2);
    },
  }),
  prefix({
    key: "reckless",
    label: "+{v}% movement speed, -{v2} max HP",
    prefixName: "Reckless",
    tags: ["mobility", "speed", "tradeoff"],
    slots: ["boots", "amulet"],
    tiers: [t2(20, 18, 24, 15, 20), t2(10, 12, 17, 10, 15), t2(1, 7, 11, 5, 10)],
    apply: (s, v, v2) => {
      s.moveSpeedMul += pct(v);
      s.maxHp -= v2;
    },
  }),
  prefix({
    key: "bloodbound",
    label: "+{v}% critical strike multiplier, -{v2} max HP",
    prefixName: "Bloodbound",
    tags: ["critical", "damage", "tradeoff"],
    slots: JEWELRY_SLOTS,
    tiers: [t2(22, 45, 60, 15, 20), t2(12, 30, 44, 10, 15), t2(3, 18, 29, 6, 10)],
    apply: (s, v, v2) => {
      s.critMul += pct(v);
      s.maxHp -= v2;
    },
  }),
  prefix({
    key: "ironclad",
    label: "-{v}% damage taken, -{v2}% movement speed",
    prefixName: "Ironclad",
    tags: ["defense", "tradeoff"],
    slots: ["armor"],
    tiers: [t2(20, 10, 14, 8, 10), t2(10, 7, 9, 6, 8), t2(3, 4, 6, 4, 6)],
    apply: (s, v, v2) => {
      s.damageTakenMul -= pct(v);
      s.moveSpeedMul -= pct(v2);
    },
  }),
  suffix({
    key: "razor",
    label: "+{v}% critical strike chance, +{v2}% damage taken",
    suffixName: "of the Razor",
    tags: ["critical", "tradeoff"],
    slots: ["weapon", "ring"],
    tiers: [t2(20, 8, 12, 8, 10), t2(10, 5, 7, 6, 8), t2(2, 3, 4, 4, 6)],
    apply: (s, v, v2) => {
      s.critChance += pct(v);
      s.damageTakenMul += pct(v2);
    },
  }),
  suffix({
    key: "pike",
    label: "+{v}% melee reach, -{v2}% attack speed",
    suffixName: "of the Pike",
    tags: ["melee", "utility", "tradeoff"],
    slots: ["weapon"],
    tiers: [t2(16, 25, 35, 8, 10), t2(6, 15, 24, 5, 7), t2(1, 10, 14, 4, 5)],
    apply: (s, v, v2) => {
      s.meleeReachMul += pct(v);
      s.attackSpeedMul -= pct(v2);
    },
  }),
  suffix({
    key: "flickering",
    label: "-{v}% dash cooldown, -{v2}% dash distance",
    suffixName: "of Flickering",
    tags: ["mobility", "tradeoff"],
    slots: ["boots"],
    tiers: [t2(18, 30, 40, 15, 20), t2(8, 20, 29, 10, 15), t2(1, 12, 19, 8, 10)],
    apply: (s, v, v2) => {
      s.dashCooldownMul -= pct(v);
      s.dashDistanceMul -= pct(v2);
    },
  }),
];

// ---------------------------------------------------------------------------
// 変換アフィックス: 「A を B に変換する」でビルドの向きを変える（BiS を潰す主力）。
// 通常の抽選プール（affixesFor）には入らず、rare の枠で CONVERSION_AFFIX_CHANCE（generator.ts）、
// unique の固定セット、クラフトの Corrupt からのみ付く。stage は "convert"（scale の後）。
// value は変換割合（%）など。value が負（Corrupt でも負にはしない）の変換は何もしない。
// ---------------------------------------------------------------------------

export const CONVERSION_KEY_PREFIX = "cv_";

/** 変換割合（%）の共通 tier。高 tier ほど多く移す */
const CONVERSION_TIERS: readonly AffixTier[] = [t(24, 56, 70), t(12, 43, 55), t(1, 30, 42)];
/** 近接ダメージ倍率 1.0 を移したときの burn DPS */
const BURN_DPS_PER_MELEE_MUL = 10;
/** 変換割合 1.0 あたりの burn 付与確率 */
const BURN_CHANCE_PER_FRACTION = 0.5;
/** 失った max HP 1 あたりの armor（armor 10 ≒ 被ダメ -17%） */
const ARMOR_PER_HP = 1 / 3;
/** 移した life on hit 1 あたりの energy gain 倍率 */
const ENERGY_PER_LIFE_ON_HIT = 0.15;
/** 移した life on kill 1 あたりの energy gain 倍率 */
const ENERGY_PER_LIFE_ON_KILL = 0.03;
/** 移したコンボ上限 1.0 あたりの JUST 回避ダメージ倍率 */
const JUST_PER_COMBO_CAP = 1.5;
/** 移した crit chance 1.0 あたりの burn chance */
const BURN_CHANCE_PER_CRIT = 2;
/** 移した crit chance 1.0 あたりの burn DPS */
const BURN_DPS_PER_CRIT = 50;
/** 分割→貫通: ダメージ倍率の下限（弾が多すぎても 0 にしない） */
const MIN_SPLIT_DAMAGE_FACTOR = 0.2;
const BASE_MULTIPLIER = 1;
const BASE_PROJECTILES = 1;
const REMAINING_DASH_CHARGES = 1;

/** 変換割合（0..1）。負の値は 0 */
const fraction = (v: number): number => Math.max(0, pct(v));

export const CONVERSION_AFFIXES: readonly AffixDef[] = [
  prefix({
    key: "cv_meleeToBurn",
    label: "Converts {v}% of melee damage into burn",
    prefixName: "Smoldering",
    tags: ["conversion", "melee", "elemental"],
    slots: MELEE_SLOTS,
    tiers: CONVERSION_TIERS,
    stage: "convert",
    apply: (s, v) => {
      const f = fraction(v);
      const moved = s.meleeDamageMul * f;
      s.meleeDamageMul -= moved;
      s.burnChance += f * BURN_CHANCE_PER_FRACTION;
      s.burnDps += moved * BURN_DPS_PER_MELEE_MUL;
    },
  }),
  suffix({
    key: "cv_splitToPierce",
    label: "Converts spread into penetration: -{v}% ranged damage per extra projectile, +{v2} pierce",
    suffixName: "of the Needle",
    tags: ["conversion", "ranged"],
    slots: RANGED_SLOTS,
    tiers: [t2(24, 10, 14, 3, 3), t2(12, 15, 20, 2, 2), t2(1, 21, 25, 1, 1)],
    stage: "convert",
    apply: (s, v, v2) => {
      const extra = Math.max(0, s.projectileCount - BASE_PROJECTILES);
      const factor = Math.max(MIN_SPLIT_DAMAGE_FACTOR, 1 - fraction(v) * extra);
      s.rangedDamageMul *= factor;
      s.pierce += v2;
    },
  }),
  prefix({
    key: "cv_critToMultiplier",
    label: "Converts all critical strike chance into critical multiplier (+{v}% per 1%)",
    prefixName: "Executioner's",
    tags: ["conversion", "critical"],
    slots: OFFENSE_SLOTS,
    tiers: [t(24, 5, 6), t(12, 4, 4), t(1, 3, 3)],
    stage: "convert",
    apply: (s, v) => {
      s.critMul += s.critChance * Math.max(0, v);
      s.critChance = 0;
    },
  }),
  suffix({
    key: "cv_speedToAttack",
    label: "Converts {v}% of bonus movement speed into attack speed",
    suffixName: "of the Whirlwind",
    tags: ["conversion", "speed", "melee"],
    slots: ["boots", "ring", "amulet"],
    tiers: CONVERSION_TIERS,
    stage: "convert",
    apply: (s, v) => {
      const moved = Math.max(0, s.moveSpeedMul - BASE_MULTIPLIER) * fraction(v);
      s.moveSpeedMul -= moved;
      s.attackSpeedMul += moved;
    },
  }),
  prefix({
    key: "cv_lifeToArmor",
    label: "Converts {v}% of maximum HP into armor",
    prefixName: "Petrified",
    tags: ["conversion", "life", "defense"],
    slots: ["armor", "amulet"],
    tiers: [t(24, 36, 45), t(12, 26, 35), t(1, 18, 25)],
    stage: "convert",
    apply: (s, v) => {
      const moved = s.maxHp * fraction(v);
      s.maxHp -= moved;
      s.armor += moved * ARMOR_PER_HP;
    },
  }),
  suffix({
    key: "cv_chargesToDistance",
    label: "Consumes all dash charges but one: +{v}% dash distance per charge",
    suffixName: "of the Long Stride",
    tags: ["conversion", "mobility"],
    slots: ["boots"],
    tiers: [t(24, 86, 100), t(12, 66, 85), t(1, 50, 65)],
    stage: "convert",
    apply: (s, v) => {
      s.dashDistanceMul += fraction(v) * s.dashCharges;
      s.dashCharges = REMAINING_DASH_CHARGES;
    },
  }),
  suffix({
    key: "cv_leechToEnergy",
    label: "Converts {v}% of life on hit and life on kill into energy gain",
    suffixName: "of the Dynamo",
    tags: ["conversion", "life", "burst"],
    slots: ["weapon", "gun", "ring", "amulet"],
    tiers: CONVERSION_TIERS,
    stage: "convert",
    apply: (s, v) => {
      const f = fraction(v);
      const onHit = s.lifeOnHit * f;
      const onKill = s.lifeOnKill * f;
      s.lifeOnHit -= onHit;
      s.lifeOnKill -= onKill;
      s.energyGainMul += onHit * ENERGY_PER_LIFE_ON_HIT + onKill * ENERGY_PER_LIFE_ON_KILL;
    },
  }),
  prefix({
    key: "cv_comboToJust",
    label: "Converts {v}% of combo damage into JUST dodge damage",
    prefixName: "Patient",
    tags: ["conversion", "combo"],
    slots: ["boots", "ring", "amulet"],
    tiers: CONVERSION_TIERS,
    stage: "convert",
    apply: (s, v) => {
      const f = fraction(v);
      const movedCap = s.comboDamageCap * f;
      s.comboDamagePerStack -= s.comboDamagePerStack * f;
      s.comboDamageCap -= movedCap;
      s.justDodgeDamageMul += movedCap * JUST_PER_COMBO_CAP;
    },
  }),
  suffix({
    key: "cv_meleeToRanged",
    label: "Converts {v}% of bonus melee damage into ranged damage",
    suffixName: "of the Crossing",
    tags: ["conversion", "melee", "ranged"],
    slots: JEWELRY_SLOTS,
    tiers: CONVERSION_TIERS,
    stage: "convert",
    apply: (s, v) => {
      const moved = Math.max(0, s.meleeDamageMul - BASE_MULTIPLIER) * fraction(v);
      s.meleeDamageMul -= moved;
      s.rangedDamageMul += moved;
    },
  }),
  suffix({
    key: "cv_critToBurn",
    label: "Converts {v}% of critical strike chance into twice as much burn chance",
    suffixName: "of Kindling",
    tags: ["conversion", "critical", "elemental"],
    slots: ATTACK_SLOTS,
    tiers: CONVERSION_TIERS,
    stage: "convert",
    apply: (s, v) => {
      const moved = s.critChance * fraction(v);
      s.critChance -= moved;
      s.burnChance += moved * BURN_CHANCE_PER_CRIT;
      s.burnDps += moved * BURN_DPS_PER_CRIT;
    },
  }),
];

export function isConversionKey(key: string): boolean {
  return key.startsWith(CONVERSION_KEY_PREFIX);
}

/** slot / kind に付けられ、itemLevel で最低 1 tier が解禁されている変換アフィックス（kind 省略時は両方） */
export function conversionsFor(slot: Slot, itemLevel: number, kind?: AffixKind): AffixDef[] {
  return CONVERSION_AFFIXES.filter(
    (d) => (kind === undefined || d.kind === kind) && d.slots.includes(slot) && lowestTierLevel(d) <= itemLevel,
  );
}

// ---------------------------------------------------------------------------
// マーカー: 数値効果を持たない AffixRoll（types.ts を変えずにアイテムの状態を持たせる）。
// "cr_corrupted" は Corrupt 済み（以降クラフト不可）を表す。枠数には数えない。
// ---------------------------------------------------------------------------

export const CORRUPTED_KEY = "cr_corrupted";
const MARKER_TIER = 1;
const MARKER_VALUE = 0;

export function isMarkerKey(key: string): boolean {
  return key === CORRUPTED_KEY;
}

export function corruptedMarkerRoll(): AffixRoll {
  return { key: CORRUPTED_KEY, kind: "suffix", tier: MARKER_TIER, value: MARKER_VALUE };
}

// ---------------------------------------------------------------------------
// キーストーン: 遊び方を変える大型改造。
// AffixRoll としては { kind: "suffix", tier: 1, value: 0, key: "ks_xxx" } で保存する。
// apply で stats.keystones に key を積み、数値効果も掛ける（"scale" 段階。flat の合算後）。
// メカニクスの変更は戦闘側（src/system/keystones.ts）が stats.keystones.includes(key) で実装する。
// 同じ exclusiveGroup は同時に成立しない。computeStats は装備順で後勝ちの 1 つだけを apply する。
// ---------------------------------------------------------------------------

export const KEYSTONE_KEY_PREFIX = "ks_";
const KEYSTONE_TIER = 1;
const KEYSTONE_VALUE = 0;

export type KeystoneGroup = "body" | "tempo" | "style";

export interface KeystoneDef {
  key: string;
  name: string;
  description: string;
  exclusiveGroup: KeystoneGroup;
  /** 数値効果（メカニクスは戦闘側）。stats.keystones への push は共通処理が行う */
  apply: (stats: PlayerStats) => void;
}

const noNumericEffect = (): void => {};

export const KEYSTONES: readonly KeystoneDef[] = [
  {
    key: "ks_glassCannon",
    name: "Glass Cannon",
    description: "Double melee and ranged damage. Maximum HP is quartered.",
    exclusiveGroup: "body",
    apply: (s) => {
      s.meleeDamageMul += 1;
      s.rangedDamageMul += 1;
      s.maxHp *= 0.25;
    },
  },
  {
    key: "ks_juggernaut",
    name: "Juggernaut",
    description: "Take half damage and ignore knockback. -35% movement speed.",
    exclusiveGroup: "body",
    apply: (s) => {
      s.moveSpeedMul -= 0.35;
      s.damageTakenMul -= 0.5;
    },
  },
  {
    key: "ks_vampire",
    name: "Vampire",
    description: "+3 life on hit. No HP regeneration, hearts cannot be picked up, -30% maximum HP.",
    exclusiveGroup: "body",
    apply: (s) => {
      s.lifeOnHit += 3;
      s.maxHp *= 0.7;
    },
  },
  {
    key: "ks_berserker",
    name: "Berserker",
    description: "Up to +100% damage as you lose HP. No HP regeneration and healing is halved.",
    exclusiveGroup: "tempo",
    apply: noNumericEffect,
  },
  {
    key: "ks_gambler",
    name: "Gambler",
    description: "Every hit deals a random 0.2x to 3x damage. +10% critical strike chance.",
    exclusiveGroup: "tempo",
    apply: (s) => {
      s.critChance += 0.1;
    },
  },
  {
    key: "ks_overclock",
    name: "Overclock",
    description: "+60% attack speed and fire rate. Every attack costs 1 HP.",
    exclusiveGroup: "tempo",
    apply: (s) => {
      s.attackSpeedMul += 0.6;
      s.fireRateMul += 0.6;
    },
  },
  {
    key: "ks_blink",
    name: "Blink",
    description: "Your dash teleports and explodes on landing, but grants no invulnerability. -30% dash cooldown.",
    exclusiveGroup: "style",
    apply: (s) => {
      s.dashCooldownMul -= 0.3;
    },
  },
  {
    key: "ks_pacifist",
    name: "Pacifist",
    description: "You cannot melee. Triple ranged damage and +1 projectile.",
    exclusiveGroup: "style",
    apply: (s) => {
      s.rangedDamageMul += 2;
      s.projectileCount += 1;
    },
  },
  {
    key: "ks_bladeOath",
    name: "Blade Oath",
    description: "You cannot shoot. Double melee damage and +20% attack speed.",
    exclusiveGroup: "style",
    apply: (s) => {
      s.meleeDamageMul += 1;
      s.attackSpeedMul += 0.2;
    },
  },
  {
    key: "ks_windWalker",
    name: "Wind Walker",
    description: "+2 dash charges. +50% dash cooldown.",
    exclusiveGroup: "style",
    apply: (s) => {
      s.dashCharges += 2;
      s.dashCooldownMul += 0.5;
    },
  },
];

const KEYSTONE_BY_KEY: ReadonlyMap<string, KeystoneDef> = new Map(KEYSTONES.map((k) => [k.key, k]));

export function keystoneDef(key: string): KeystoneDef | undefined {
  return KEYSTONE_BY_KEY.get(key);
}

export function isKeystoneKey(key: string): boolean {
  return key.startsWith(KEYSTONE_KEY_PREFIX);
}

export function keystoneToRoll(def: KeystoneDef): AffixRoll {
  return { key: def.key, kind: "suffix", tier: KEYSTONE_TIER, value: KEYSTONE_VALUE };
}

/**
 * 排他グループを解決する。同じグループは後に出たものが勝ち、同じ key の重複と未知の key は落とす。
 * 結果は勝者の（最後の）出現順。
 */
export function resolveKeystones(keys: readonly string[]): string[] {
  const winnerByGroup = new Map<KeystoneGroup, { key: string; index: number }>();
  keys.forEach((key, index) => {
    const def = keystoneDef(key);
    if (def === undefined) return;
    winnerByGroup.set(def.exclusiveGroup, { key, index });
  });
  return [...winnerByGroup.values()].sort((a, b) => a.index - b.index).map((w) => w.key);
}

/** UI 警告用: 同じ排他グループに異なるキーストーンが 2 つ以上あるグループの一覧 */
export function keystoneConflicts(keys: readonly string[]): KeystoneDef[][] {
  const byGroup = new Map<KeystoneGroup, KeystoneDef[]>();
  for (const key of new Set(keys)) {
    const def = keystoneDef(key);
    if (def === undefined) continue;
    byGroup.set(def.exclusiveGroup, [...(byGroup.get(def.exclusiveGroup) ?? []), def]);
  }
  return [...byGroup.values()].filter((defs) => defs.length > 1);
}

// ---------------------------------------------------------------------------
// implicit（ベース固有）。key は "implicit." 始まりでアフィックスと衝突させない
// ---------------------------------------------------------------------------

export const IMPLICITS: readonly ImplicitDef[] = [
  // weapon
  {
    key: "implicit.dagger",
    label: "+{v}% attack speed, +3% critical strike chance, -20% melee damage, -15% melee reach",
    range: { min: 20, max: 30 },
    apply: (s, v) => {
      s.attackSpeedMul += pct(v);
      s.critChance += pct(3);
      s.meleeDamageMul -= pct(20);
      s.meleeReachMul -= pct(15);
    },
  },
  {
    key: "implicit.shortsword",
    label: "+{v}% melee damage",
    range: { min: 8, max: 12 },
    apply: (s, v) => {
      s.meleeDamageMul += pct(v);
    },
  },
  {
    key: "implicit.longsword",
    label: "+{v}% melee damage, +10% melee reach, -5% attack speed",
    range: { min: 15, max: 22 },
    apply: (s, v) => {
      s.meleeDamageMul += pct(v);
      s.meleeReachMul += pct(10);
      s.attackSpeedMul -= pct(5);
    },
  },
  {
    key: "implicit.spear",
    label: "+{v}% melee reach, +15% knockback, -10% melee damage",
    range: { min: 30, max: 40 },
    apply: (s, v) => {
      s.meleeReachMul += pct(v);
      s.knockbackMul += pct(15);
      s.meleeDamageMul -= pct(10);
    },
  },
  {
    key: "implicit.greatsword",
    label: "+{v}% melee damage, +20% melee reach, -25% attack speed",
    range: { min: 35, max: 45 },
    apply: (s, v) => {
      s.meleeDamageMul += pct(v);
      s.meleeReachMul += pct(20);
      s.attackSpeedMul -= pct(25);
    },
  },
  // gun
  {
    key: "implicit.pistol",
    label: "+{v}% ranged damage",
    range: { min: 5, max: 10 },
    apply: (s, v) => {
      s.rangedDamageMul += pct(v);
    },
  },
  {
    key: "implicit.smg",
    label: "+{v}% fire rate, -30% ranged damage",
    range: { min: 40, max: 60 },
    apply: (s, v) => {
      s.fireRateMul += pct(v);
      s.rangedDamageMul -= pct(30);
    },
  },
  {
    key: "implicit.rifle",
    label: "+{v}% ranged damage, +1 pierce, +25% projectile speed, -20% fire rate",
    range: { min: 30, max: 40 },
    apply: (s, v) => {
      s.rangedDamageMul += pct(v);
      s.pierce += 1;
      s.projectileSpeedMul += pct(25);
      s.fireRateMul -= pct(20);
    },
  },
  {
    key: "implicit.shotgun",
    label: "+{v} projectiles, -40% ranged damage, -30% fire rate, -25% projectile speed",
    range: { min: 2, max: 3 },
    apply: (s, v) => {
      s.projectileCount += v;
      s.rangedDamageMul -= pct(40);
      s.fireRateMul -= pct(30);
      s.projectileSpeedMul -= pct(25);
    },
  },
  // armor
  {
    key: "implicit.cloth",
    label: "+{v} max HP, +5% movement speed",
    range: { min: 5, max: 10 },
    apply: (s, v) => {
      s.maxHp += v;
      s.moveSpeedMul += pct(5);
    },
  },
  {
    key: "implicit.leather",
    label: "+{v} max HP",
    range: { min: 12, max: 20 },
    apply: (s, v) => {
      s.maxHp += v;
    },
  },
  {
    key: "implicit.chain",
    label: "+{v} max HP, +{v2} armor",
    range: { min: 20, max: 30, min2: 3, max2: 5 },
    apply: (s, v, v2) => {
      s.maxHp += v;
      s.armor += v2;
    },
  },
  {
    key: "implicit.plate",
    label: "+{v} armor, +20 max HP, -8% movement speed",
    range: { min: 8, max: 12 },
    apply: (s, v) => {
      s.armor += v;
      s.maxHp += 20;
      s.moveSpeedMul -= pct(8);
    },
  },
  // boots
  {
    key: "implicit.sandals",
    label: "+{v}% movement speed",
    range: { min: 4, max: 7 },
    apply: (s, v) => {
      s.moveSpeedMul += pct(v);
    },
  },
  {
    key: "implicit.boots",
    label: "+{v}% dash distance",
    range: { min: 10, max: 15 },
    apply: (s, v) => {
      s.dashDistanceMul += pct(v);
    },
  },
  {
    key: "implicit.greaves",
    label: "-{v}% dash cooldown, +3 armor",
    range: { min: 10, max: 15 },
    apply: (s, v) => {
      s.dashCooldownMul -= pct(v);
      s.armor += 3;
    },
  },
  {
    key: "implicit.wingedBoots",
    label: "+1 dash charge, +{v}% movement speed",
    range: { min: 3, max: 5 },
    apply: (s, v) => {
      s.dashCharges += 1;
      s.moveSpeedMul += pct(v);
    },
  },
  // ring
  {
    key: "implicit.ironRing",
    label: "+{v} max HP",
    range: { min: 5, max: 10 },
    apply: (s, v) => {
      s.maxHp += v;
    },
  },
  {
    key: "implicit.rubyRing",
    label: "+{v}% melee damage",
    range: { min: 4, max: 8 },
    apply: (s, v) => {
      s.meleeDamageMul += pct(v);
    },
  },
  {
    key: "implicit.sapphireRing",
    label: "+{v}% ranged damage",
    range: { min: 4, max: 8 },
    apply: (s, v) => {
      s.rangedDamageMul += pct(v);
    },
  },
  {
    key: "implicit.goldRing",
    label: "+{v}% critical strike chance",
    range: { min: 1, max: 3 },
    apply: (s, v) => {
      s.critChance += pct(v);
    },
  },
  {
    key: "implicit.bloodRing",
    label: "+{v} life on kill",
    range: { min: 1, max: 3 },
    apply: (s, v) => {
      s.lifeOnKill += v;
    },
  },
  // amulet
  {
    key: "implicit.jadeAmulet",
    label: "+{v}% energy gain",
    range: { min: 5, max: 10 },
    apply: (s, v) => {
      s.energyGainMul += pct(v);
    },
  },
  {
    key: "implicit.amberAmulet",
    label: "+{v} HP regenerated per second",
    range: { min: 0.2, max: 0.5 },
    decimals: 1,
    apply: (s, v) => {
      s.hpRegen += v;
    },
  },
  {
    key: "implicit.onyxAmulet",
    label: "+{v}% critical strike multiplier",
    range: { min: 8, max: 15 },
    apply: (s, v) => {
      s.critMul += pct(v);
    },
  },
  {
    key: "implicit.lapisAmulet",
    label: "+{v}% burst radius",
    range: { min: 10, max: 15 },
    apply: (s, v) => {
      s.burstRadiusMul += pct(v);
    },
  },
  {
    key: "implicit.coralAmulet",
    label: "+{v}% movement speed",
    range: { min: 3, max: 5 },
    apply: (s, v) => {
      s.moveSpeedMul += pct(v);
    },
  },
];

// ---------------------------------------------------------------------------
// 参照 API
// ---------------------------------------------------------------------------

/** 通常アフィックス + 変換アフィックス（変換は affixesFor の抽選プールには入らない） */
const AFFIX_BY_KEY: ReadonlyMap<string, AffixDef> = new Map(
  [...AFFIXES, ...CONVERSION_AFFIXES].map((d) => [d.key, d]),
);
const IMPLICIT_BY_KEY: ReadonlyMap<string, ImplicitDef> = new Map(IMPLICITS.map((d) => [d.key, d]));

export function affixDef(key: string): AffixDef | undefined {
  return AFFIX_BY_KEY.get(key);
}

export function implicitDef(key: string): ImplicitDef | undefined {
  return IMPLICIT_BY_KEY.get(key);
}

/** 最下位 tier（= 最も早く出る tier）の minLevel */
export function lowestTierLevel(def: AffixDef): number {
  const lowest = def.tiers[def.tiers.length - 1];
  return lowest === undefined ? Number.POSITIVE_INFINITY : lowest.minLevel;
}

/** slot / kind に付けられ、itemLevel で最低 1 tier が解禁されているアフィックス */
export function affixesFor(slot: Slot, kind: AffixKind, itemLevel: number): AffixDef[] {
  return AFFIXES.filter(
    (d) => d.kind === kind && d.slots.includes(slot) && lowestTierLevel(d) <= itemLevel,
  );
}

export type AffixSource = "affix" | "conversion" | "implicit" | "keystone" | "trigger" | "marker";

/**
 * ロール済みアフィックスの振る舞い。固定テーブル（affix / implicit / keystone）に無い
 * 動的 key（トリガー文法 "tr_..."）も復元できる。
 */
export interface ResolvedAffix {
  key: string;
  source: AffixSource;
  stage: ApplyStage;
  apply: (stats: PlayerStats, roll: AffixRoll) => void;
  format: (roll: AffixRoll) => string;
}

/** 符号付きテンプレ（"+{v}%" / "-{v}%"）に負の値が入ったとき（Corrupt のネガティブ化）の符号を整える */
function fixSigns(text: string): string {
  return text.replaceAll("+-", "-").replaceAll("--", "+");
}

function fillTemplate(label: string, roll: AffixRoll, decimals: number, decimals2: number): string {
  const v = roll.value.toFixed(decimals);
  const v2 = (roll.value2 ?? 0).toFixed(decimals2);
  return fixSigns(label.replaceAll("{v2}", v2).replaceAll("{v}", v));
}

function resolveTable(def: AffixDef | ImplicitDef, source: AffixSource): ResolvedAffix {
  const decimals = def.decimals ?? 0;
  const decimals2 = def.decimals2 ?? 0;
  return {
    key: def.key,
    source,
    stage: def.stage ?? "flat",
    apply: (stats, roll) => def.apply(stats, roll.value, roll.value2 ?? 0),
    format: (roll) => fillTemplate(def.label, roll, decimals, decimals2),
  };
}

const KEYSTONE_LABEL = "[Keystone]";
const CORRUPTED_LABEL = "Corrupted: cannot be crafted";

const MARKER_RESOLVED: ResolvedAffix = {
  key: CORRUPTED_KEY,
  source: "marker",
  stage: "flat",
  apply: () => {},
  format: () => CORRUPTED_LABEL,
};

function resolveKeystone(def: KeystoneDef): ResolvedAffix {
  return {
    key: def.key,
    source: "keystone",
    stage: "scale",
    apply: (stats) => {
      stats.keystones.push(def.key);
      def.apply(stats);
    },
    format: () => `${KEYSTONE_LABEL} ${def.name}: ${def.description}`,
  };
}

function resolveTrigger(roll: AffixRoll): ResolvedAffix | undefined {
  const effect = decodeTriggerRoll(roll);
  if (effect === null) return undefined;
  return {
    key: roll.key,
    source: "trigger",
    stage: "flat",
    apply: (stats, r) => {
      const decoded = decodeTriggerRoll(r);
      if (decoded !== null) stats.triggers.push(decoded);
    },
    format: (r) => {
      const decoded = decodeTriggerRoll(r);
      return decoded === null ? `Unknown modifier (${r.key})` : formatTrigger(decoded);
    },
  };
}

/** AffixRoll から振る舞いを復元する。未知の key は undefined */
export function affixDefForRoll(roll: AffixRoll): ResolvedAffix | undefined {
  const affix = affixDef(roll.key);
  if (affix !== undefined) return resolveTable(affix, isConversionKey(affix.key) ? "conversion" : "affix");
  const implicit = implicitDef(roll.key);
  if (implicit !== undefined) return resolveTable(implicit, "implicit");
  const keystone = keystoneDef(roll.key);
  if (keystone !== undefined) return resolveKeystone(keystone);
  if (isTriggerKey(roll.key)) return resolveTrigger(roll);
  if (isMarkerKey(roll.key)) return MARKER_RESOLVED;
  return undefined;
}

/** 適用段階。未知の key は undefined */
export function rollStage(roll: AffixRoll): ApplyStage | undefined {
  return affixDefForRoll(roll)?.stage;
}

/**
 * ロール済みアフィックス（implicit / keystone / trigger 含む）を stats に適用する。
 * 未知の key（古いセーブ等）は無視して false を返す。
 */
export function applyRoll(stats: PlayerStats, roll: AffixRoll): boolean {
  const resolved = affixDefForRoll(roll);
  if (resolved === undefined) return false;
  resolved.apply(stats, roll);
  return true;
}

/** 表示文字列（tier は含めない。UI 側で付ける）。implicit / keystone / trigger にも使える */
export function formatAffix(roll: AffixRoll): string {
  const resolved = affixDefForRoll(roll);
  if (resolved === undefined) return `Unknown modifier (${roll.key})`;
  return resolved.format(roll);
}
