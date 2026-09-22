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
  | "utility";

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
 * 適用段階。flat → scale の順に畳み込む（例: max HP % は flat の max HP を全部足した後に掛ける）
 */
export type ApplyStage = "flat" | "scale";
export const APPLY_STAGES: readonly ApplyStage[] = ["flat", "scale"];

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
    label: "+{v} projectiles",
    suffixName: "of Splitting",
    tags: ["ranged"],
    slots: ["gun", "amulet"],
    tiers: [t(30, 2, 2), t(10, 1, 1)],
    apply: (s, v) => {
      s.projectileCount += v;
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
    label: "Reflects {v} damage to melee attackers",
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
];

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

const AFFIX_BY_KEY: ReadonlyMap<string, AffixDef> = new Map(AFFIXES.map((d) => [d.key, d]));
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

interface ResolvedRoll {
  label: string;
  decimals: number;
  decimals2: number;
  stage: ApplyStage;
  apply: ApplyFn;
}

/** affix / implicit のどちらでも同じ扱いにする */
function resolveRoll(key: string): ResolvedRoll | undefined {
  const def = affixDef(key) ?? implicitDef(key);
  if (def === undefined) return undefined;
  return {
    label: def.label,
    decimals: def.decimals ?? 0,
    decimals2: def.decimals2 ?? 0,
    stage: def.stage ?? "flat",
    apply: def.apply,
  };
}

/** 適用段階。未知の key は undefined */
export function rollStage(roll: AffixRoll): ApplyStage | undefined {
  return resolveRoll(roll.key)?.stage;
}

/**
 * ロール済みアフィックス（implicit 含む）を stats に適用する。
 * 未知の key（古いセーブ等）は無視して false を返す。
 */
export function applyRoll(stats: PlayerStats, roll: AffixRoll): boolean {
  const resolved = resolveRoll(roll.key);
  if (resolved === undefined) return false;
  resolved.apply(stats, roll.value, roll.value2 ?? 0);
  return true;
}

/** 表示文字列（tier は含めない。UI 側で付ける）。implicit にも使える */
export function formatAffix(roll: AffixRoll): string {
  const resolved = resolveRoll(roll.key);
  if (resolved === undefined) return `Unknown modifier (${roll.key})`;
  const v = roll.value.toFixed(resolved.decimals);
  const v2 = (roll.value2 ?? 0).toFixed(resolved.decimals2);
  return resolved.label.replaceAll("{v2}", v2).replaceAll("{v}", v);
}
