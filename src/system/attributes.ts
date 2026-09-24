import type { AttackGenre, AttackQuality, AttackRange } from "../core/element";
import { ATTR, GENRE } from "../data/tuning";
import { ATTR_KEYS, type AttrKey, type Attributes, type PlayerStats, type Scaling } from "../loot/types";

/**
 * ステータス（筋力 / 技巧 / 体力 / 精神 / 霊力）の実効値と派生。docs/COMBAT_DESIGN.md A。
 * 派生は「実効値 − 基礎値」の差分で既存の PlayerStats に畳み込むので、基礎値なら何も変わらない
 */

/** 最大 HP の下限（体力を下げても 0 以下にしない） */
const MIN_MAX_HP = 1;

/**
 * 逓減後の実効値。20 までは等倍、40 までは傾き 0.5、それ以降は 0.25。
 * 1 つに盛るより 2 つに分けた方が合計の実効値が高くなる
 */
export function effectiveAttr(a: number): number {
  if (a <= 0) return 0;
  if (a <= ATTR.knee1) return a;
  if (a <= ATTR.knee2) return ATTR.knee1 + (a - ATTR.knee1) * ATTR.slope1;
  const atKnee2 = ATTR.knee1 + (ATTR.knee2 - ATTR.knee1) * ATTR.slope1;
  return atKnee2 + (a - ATTR.knee2) * ATTR.slope2;
}

/** 技の威力 = base + Σ(係数 × 実効値) */
export function scaled(stats: Readonly<PlayerStats>, s: Readonly<Scaling>): number {
  let v = s.base;
  for (const k of ATTR_KEYS) v += (s[k] ?? 0) * stats.attributesEff[k];
  return v;
}

// ---------------------------------------------------------------------------
// 攻撃ジャンルの参照ステータス（docs/COMBAT_DESIGN.md A-8）
// ---------------------------------------------------------------------------

export interface GenreAttrs {
  /** 主に伸ばすステータス。そのジャンルの攻撃は主か副の係数を持つ（data 側のテストで検査する） */
  readonly primary: AttrKey;
  /** 副に伸ばすステータス */
  readonly secondary: AttrKey;
}

/**
 * ジャンルごとの参照ステータスの既定表。筋力 = 物理の力、技巧 = 物理の狙い、霊力 = 魔法、精神 = 魔法の広がり、
 * 体力 = 地を揺らす範囲の物理。混成は物理と魔法の主を 1 つずつ。
 * 盾・体当たり・自傷など体力で伸ばしたい攻撃は、個々の Scaling で上書きする（既定表はあくまで揃えの目安）
 */
export const GENRE_ATTRS: Readonly<Record<AttackRange, Readonly<Record<AttackQuality, GenreAttrs>>>> = {
  melee: {
    physical: { primary: "str", secondary: "dex" },
    arcane: { primary: "spi", secondary: "str" },
    hybrid: { primary: "str", secondary: "spi" },
  },
  ranged: {
    physical: { primary: "dex", secondary: "str" },
    arcane: { primary: "spi", secondary: "mnd" },
    hybrid: { primary: "dex", secondary: "spi" },
  },
  area: {
    physical: { primary: "str", secondary: "vit" },
    arcane: { primary: "spi", secondary: "mnd" },
    hybrid: { primary: "str", secondary: "spi" },
  },
};

export function genreAttrs(genre: AttackGenre): GenreAttrs {
  return GENRE_ATTRS[genre.range][genre.quality];
}

/**
 * ジャンルの既定表から Scaling を作る。atBase = ステータスが基礎値（各 5）のときの威力、primaryCoef = 主の係数。
 * 副の係数は主 × GENRE.secondaryRatio。base は atBase に一致するよう逆算する（既存の数値を壊さない）
 */
export function genreScaling(genre: AttackGenre, atBase: number, primaryCoef: number): Scaling {
  const { primary, secondary } = genreAttrs(genre);
  const secondaryCoef = primaryCoef * GENRE.secondaryRatio;
  return { base: atBase - ATTR.base * (primaryCoef + secondaryCoef), [primary]: primaryCoef, [secondary]: secondaryCoef };
}

/**
 * Scaling がジャンルの主か副のステータスを参照しているか（「ジャンルごとに参照ステータスをある程度揃える」の検査）。
 * 双剣（技巧）のように副だけで伸びる攻撃も揃っているとみなす。体力参照など表の外は呼び出し側で上書きを宣言する
 */
export function scalingFitsGenre(s: Readonly<Scaling>, genre: AttackGenre): boolean {
  const { primary, secondary } = genreAttrs(genre);
  return (s[primary] ?? 0) > 0 || (s[secondary] ?? 0) > 0;
}

/** ステータスが基礎値（各 5）のときの威力 */
export function scaledAtBase(s: Readonly<Scaling>): number {
  let v = s.base;
  for (const k of ATTR_KEYS) v += (s[k] ?? 0) * ATTR.base;
  return v;
}

/** ラン内の振り分けを生のステータスに足す（逓減前）。入力は書き換えない */
export function addRunAttributes(stats: Readonly<PlayerStats>, alloc: Readonly<Attributes>): PlayerStats {
  const attributes = { ...stats.attributes };
  for (const k of ATTR_KEYS) attributes[k] += alloc[k];
  return { ...stats, attributes };
}

/**
 * 実効値を計算し、基礎値からの差分を既存フィールドへ畳み込む（docs/COMBAT_DESIGN.md A-1）。
 * 装備のソフトキャップの後に掛けるので二重には潰さない。入力は書き換えない
 */
export function deriveAttributes(stats: Readonly<PlayerStats>): PlayerStats {
  const eff = effectiveAttributes(stats.attributes);
  const out: PlayerStats = { ...stats, attributes: { ...stats.attributes }, attributesEff: eff };
  deriveStr(out, eff.str - ATTR.base);
  deriveDex(out, eff.dex - ATTR.base);
  deriveVit(out, eff.vit - ATTR.base);
  deriveMnd(out, eff.mnd - ATTR.base);
  deriveSpi(out, eff.spi - ATTR.base);
  return out;
}

/** buff 系スキル（血の契約・加速）の効果量倍率。霊力で伸びる（docs/COMBAT_DESIGN.md B-4） */
export function buffPotencyMul(stats: Readonly<PlayerStats>): number {
  return Math.max(0, 1 + ATTR.spiBuffPotency * (stats.attributesEff.spi - ATTR.base));
}

function effectiveAttributes(raw: Readonly<Attributes>): Attributes {
  return {
    str: effectiveAttr(raw.str),
    dex: effectiveAttr(raw.dex),
    vit: effectiveAttr(raw.vit),
    mnd: effectiveAttr(raw.mnd),
    spi: effectiveAttr(raw.spi),
  };
}

/** 1 点あたりの割合を倍率にする。ステータスを下げても負の倍率にはしない */
function perPointMul(perPoint: number, d: number): number {
  return Math.max(0, 1 + perPoint * d);
}

function deriveStr(out: PlayerStats, d: number): void {
  out.poiseDamageMul *= perPointMul(ATTR.strPoise, d);
  out.knockbackMul *= perPointMul(ATTR.strKnockback, d);
}

function deriveDex(out: PlayerStats, d: number): void {
  out.moveSpeedMul *= perPointMul(ATTR.dexMove, d);
  out.fireRateMul *= perPointMul(ATTR.dexFireRate, d);
  out.dashCooldownMul *= Math.max(ATTR.dexDashCooldownMin, 1 - ATTR.dexDashCooldown * d);
}

function deriveVit(out: PlayerStats, d: number): void {
  // 逓減の傾き 0.5 / 0.25 で端数が出る。HUD の HP 表示を整数に保つ
  out.maxHp = Math.max(MIN_MAX_HP, Math.round(out.maxHp + ATTR.vitMaxHp * d));
  const taken = ATTR.vitStatusTakenBase / (ATTR.vitStatusTakenBase + ATTR.vitStatusTaken * d);
  out.statusTakenMul *= Math.max(ATTR.vitStatusTakenMin, taken);
}

function deriveMnd(out: PlayerStats, d: number): void {
  out.maxMana = Math.max(0, out.maxMana + ATTR.mndMaxMana * d);
  out.manaRegen = Math.max(0, out.manaRegen + ATTR.mndManaRegen * d);
  out.critChance = Math.min(1, Math.max(0, out.critChance + ATTR.mndCrit * d));
}

function deriveSpi(out: PlayerStats, d: number): void {
  out.statusPotencyMul *= perPointMul(ATTR.spiStatusPotency, d);
}
