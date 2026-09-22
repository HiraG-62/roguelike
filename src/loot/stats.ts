import { STATUS } from "../data/tuning";
import { APPLY_STAGES, applyRoll, isKeystoneKey, resolveKeystones, rollStage } from "./affixes";
import { DEFAULT_STATS, SLOTS, type AffixRoll, type Equipment, type PlayerStats } from "./types";

/** 倍率系の下限（マイナス補正の積み重ねで 0 以下にならないように） */
const MIN_MULTIPLIER = 0.1;
/** 被ダメ倍率の下限（無敵化を防ぐ） */
const MIN_DAMAGE_TAKEN_MUL = 0.3;
const MIN_MAX_HP = 1;
const MIN_PROJECTILES = 1;
const MIN_DASH_CHARGES = 1;
/** 表示・比較用の誤差 */
const EPSILON = 1e-6;
const PERCENT_SCALE = 100;
const DISPLAY_DECIMALS = 1;

/** PlayerStats のうち数値のフィールド（keystones / triggers などの配列は除く） */
type StatKey = {
  [K in keyof PlayerStats]: PlayerStats[K] extends number ? K : never;
}[keyof PlayerStats];

const MULTIPLIER_KEYS: readonly StatKey[] = [
  "moveSpeedMul",
  "dashCooldownMul",
  "dashDistanceMul",
  "meleeDamageMul",
  "attackSpeedMul",
  "meleeReachMul",
  "knockbackMul",
  "damageVsStaggeredMul",
  "rangedDamageMul",
  "fireRateMul",
  "projectileSpeedMul",
  "critMul",
  "energyGainMul",
  "burstDamageMul",
  "burstRadiusMul",
  "justDodgeDamageMul",
];

const PROBABILITY_KEYS: readonly StatKey[] = [
  "critChance",
  "burnChance",
  "chillChance",
  "shockChance",
  "explodeOnKillChance",
];

/** ソフトキャップ: この倍率（= +100%）を超えた分を圧縮する */
export const SOFT_CAP_THRESHOLD = 2;
/**
 * 圧縮の曲率。超過分 x を knee * (sqrt(1 + 2x / knee) - 1) に写す（x = 0 で傾き 1、以降 sqrt で鈍化）。
 * 0.4 なら +300%（x = 2）で 2.93 倍に収まる
 */
const SOFT_CAP_KNEE = 0.4;

/** ソフトキャップ対象（「1 種類を盛る」を鈍らせたい主要倍率） */
const SOFT_CAPPED_KEYS: readonly StatKey[] = [
  "meleeDamageMul",
  "rangedDamageMul",
  "attackSpeedMul",
  "fireRateMul",
  "moveSpeedMul",
];

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** 装備順（SLOTS 順）に implicit → affixes を並べる */
function collectRolls(equipment: Equipment): AffixRoll[] {
  const rolls: AffixRoll[] = [];
  for (const slot of SLOTS) {
    const item = equipment[slot];
    if (item === null) continue;
    if (item.implicit !== null) rolls.push(item.implicit);
    rolls.push(...item.affixes);
  }
  return rolls;
}

/** DEFAULT_STATS のコピー。配列は共有しないよう複製する */
function createBaseStats(): PlayerStats {
  return {
    ...DEFAULT_STATS,
    keystones: [...DEFAULT_STATS.keystones],
    triggers: [...DEFAULT_STATS.triggers],
  };
}

/** +100% を超える部分を sqrt 系の曲線で圧縮する。単調増加・連続・閾値で傾き 1 */
export function softCap(mul: number): number {
  if (mul <= SOFT_CAP_THRESHOLD) return mul;
  const excess = mul - SOFT_CAP_THRESHOLD;
  return SOFT_CAP_THRESHOLD + SOFT_CAP_KNEE * (Math.sqrt(1 + (2 * excess) / SOFT_CAP_KNEE) - 1);
}

function applySoftCaps(stats: PlayerStats): void {
  for (const key of SOFT_CAPPED_KEYS) stats[key] = softCap(stats[key]);
}

/**
 * キーストーンの排他を解決する。同じ exclusiveGroup は装備順で後勝ち、同じ key の重複は 1 つにする。
 * 負けたキーストーンは apply しない（数値効果も keystones への push も起きない）
 */
function filterKeystoneRolls(rolls: readonly AffixRoll[]): AffixRoll[] {
  const keystoneKeys = rolls.filter((r) => isKeystoneKey(r.key)).map((r) => r.key);
  const winners = new Set(resolveKeystones(keystoneKeys));
  const lastIndexByKey = new Map<string, number>();
  rolls.forEach((r, i) => {
    if (isKeystoneKey(r.key)) lastIndexByKey.set(r.key, i);
  });
  return rolls.filter((r, i) => !isKeystoneKey(r.key) || (winners.has(r.key) && lastIndexByKey.get(r.key) === i));
}

/** 整数化・クランプ */
function finalize(stats: PlayerStats): PlayerStats {
  for (const key of MULTIPLIER_KEYS) stats[key] = Math.max(MIN_MULTIPLIER, stats[key]);
  for (const key of PROBABILITY_KEYS) stats[key] = clamp(stats[key], 0, 1);
  stats.damageTakenMul = Math.max(MIN_DAMAGE_TAKEN_MUL, stats.damageTakenMul);
  // chill の上限は STATUS.maxSlow（statusEffects.ts の chillFactor）と 1 箇所に統一する
  stats.chillSlow = clamp(stats.chillSlow, 0, STATUS.maxSlow);
  stats.maxHp = Math.max(MIN_MAX_HP, Math.round(stats.maxHp));
  stats.projectileCount = Math.max(MIN_PROJECTILES, Math.round(stats.projectileCount));
  stats.dashCharges = Math.max(MIN_DASH_CHARGES, Math.round(stats.dashCharges));
  stats.pierce = Math.max(0, Math.round(stats.pierce));
  return stats;
}

/**
 * flat → scale → convert の段階ごとに適用する（max HP % は flat の合算後に掛かる）。
 * convert は変換アフィックス（"A を B に変換"）。盛り終えた値を移すので scale の後、ソフトキャップの前
 */
function applyStaged(stats: PlayerStats, rolls: readonly AffixRoll[]): void {
  for (const stage of APPLY_STAGES) {
    for (const roll of rolls) {
      if (rollStage(roll) === stage) applyRoll(stats, roll);
    }
  }
}

/**
 * 装備から PlayerStats を畳み込む。
 * 1. キーストーンの排他を解決（同グループは装備順で後勝ち）
 * 2. DEFAULT_STATS のコピーに、装備順で implicit → affixes（trigger 含む）を段階適用（flat → scale → convert）
 * 3. 主要倍率にソフトキャップ
 * 4. キーストーンを apply（アイデンティティなのでソフトキャップの対象外。HP 倍率も flat 合算後に掛かる）
 * 5. 整数化・クランプ
 */
export function computeStats(equipment: Equipment): PlayerStats {
  const stats = createBaseStats();
  const rolls = filterKeystoneRolls(collectRolls(equipment));
  applyStaged(stats, rolls.filter((r) => !isKeystoneKey(r.key)));
  applySoftCaps(stats);
  applyStaged(stats, rolls.filter((r) => isKeystoneKey(r.key)));
  return finalize(stats);
}

// ---------------------------------------------------------------------------
// 表示
// ---------------------------------------------------------------------------

/**
 * - flat: 値そのまま（"Max HP 140"）
 * - mul: 基準 1 からの差を %（"Melee Damage +25%"）
 * - percent: 値 × 100 を %（"Crit Chance 12%"）
 * - seconds: 秒（"Combo Window +0.5s"）
 */
type StatStyle = "flat" | "mul" | "percent" | "seconds";

interface StatFormat {
  label: string;
  style: StatStyle;
}

const STAT_FORMATS: Readonly<Record<StatKey, StatFormat>> = {
  maxHp: { label: "Max HP", style: "flat" },
  hpRegen: { label: "HP Regen/s", style: "flat" },
  lifeOnHit: { label: "Life on Hit", style: "flat" },
  lifeOnKill: { label: "Life on Kill", style: "flat" },
  armor: { label: "Armor", style: "flat" },
  damageTakenMul: { label: "Damage Taken", style: "mul" },
  thorns: { label: "Thorns", style: "flat" },

  moveSpeedMul: { label: "Move Speed", style: "mul" },
  dashCooldownMul: { label: "Dash Cooldown", style: "mul" },
  dashCharges: { label: "Dash Charges", style: "flat" },
  dashDistanceMul: { label: "Dash Distance", style: "mul" },

  meleeDamageMul: { label: "Melee Damage", style: "mul" },
  meleeDamageFlat: { label: "Melee Damage (flat)", style: "flat" },
  attackSpeedMul: { label: "Attack Speed", style: "mul" },
  meleeReachMul: { label: "Melee Reach", style: "mul" },
  knockbackMul: { label: "Knockback", style: "mul" },
  damageVsStaggeredMul: { label: "Damage vs Staggered", style: "mul" },

  rangedDamageMul: { label: "Ranged Damage", style: "mul" },
  rangedDamageFlat: { label: "Ranged Damage (flat)", style: "flat" },
  fireRateMul: { label: "Fire Rate", style: "mul" },
  projectileCount: { label: "Projectiles", style: "flat" },
  pierce: { label: "Pierce", style: "flat" },
  projectileSpeedMul: { label: "Projectile Speed", style: "mul" },

  critChance: { label: "Crit Chance", style: "percent" },
  critMul: { label: "Crit Multiplier", style: "percent" },

  energyGainMul: { label: "Energy Gain", style: "mul" },
  burstDamageMul: { label: "Burst Damage", style: "mul" },
  burstRadiusMul: { label: "Burst Radius", style: "mul" },

  comboWindowBonus: { label: "Combo Window", style: "seconds" },
  comboDamagePerStack: { label: "Damage per Combo Stack", style: "percent" },
  comboDamageCap: { label: "Combo Damage Cap", style: "percent" },
  justDodgeDamageMul: { label: "JUST Dodge Damage", style: "mul" },
  justDodgeWindow: { label: "JUST Dodge Window", style: "seconds" },

  burnChance: { label: "Burn Chance", style: "percent" },
  burnDps: { label: "Burn DPS", style: "flat" },
  chillChance: { label: "Chill Chance", style: "percent" },
  chillSlow: { label: "Chill Slow", style: "percent" },
  shockChance: { label: "Shock Chance", style: "percent" },
  shockDamage: { label: "Shock Damage", style: "flat" },
  explodeOnKillChance: { label: "Explode on Kill Chance", style: "percent" },
  explodeDamage: { label: "Explode Damage", style: "flat" },
};

/** 小数 1 桁に丸め、末尾の .0 を落とす */
function num(v: number): string {
  return String(Number(v.toFixed(DISPLAY_DECIMALS)));
}

function signed(v: number): string {
  return v >= 0 ? `+${num(v)}` : num(v);
}

function formatStat(format: StatFormat, value: number): string {
  switch (format.style) {
    case "flat":
      return `${format.label} ${num(value)}`;
    case "mul":
      return `${format.label} ${signed((value - 1) * PERCENT_SCALE)}%`;
    case "percent":
      return `${format.label} ${num(value * PERCENT_SCALE)}%`;
    case "seconds":
      return `${format.label} ${signed(value)}s`;
  }
}

/** DEFAULT_STATS と異なる数値項目だけを表示用文字列で列挙する（keystones / triggers は対象外） */
export function statsSummary(stats: PlayerStats): string[] {
  const keys = Object.keys(STAT_FORMATS) as StatKey[];
  return keys
    .filter((key) => Math.abs(stats[key] - DEFAULT_STATS[key]) > EPSILON)
    .map((key) => formatStat(STAT_FORMATS[key], stats[key]));
}
