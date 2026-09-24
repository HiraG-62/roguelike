import { ATTR } from "../data/tuning";
import { ATTR_KEYS, type AttrRatio, type Attributes, type PlayerStats, type Scaling } from "../loot/types";

/**
 * ステータス（筋力 / 技巧 / 体力 / 精神 / 霊力）の実効値と派生。docs/COMBAT_DESIGN.md A。
 * 行動の強さ（威力・怯み値・状態異常の効果量・強化の効果量）は行動ごとの係数だけで決まり、
 * ステータスそのものが決まった行動を伸ばすことはしない（A-10）。ここで畳み込む派生は体の性能（生命・気力・移動）だけ。
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

/**
 * 「基礎値での値」に係数ぶんの上乗せを足す（怯み値・状態異常の効果量・強化の効果量）。
 * ステータスを下げても負にはしない
 */
export function withRatio(stats: Readonly<PlayerStats>, atBase: number, ratio: Readonly<AttrRatio> | undefined): number {
  if (ratio === undefined) return atBase;
  let v = atBase;
  for (const k of ATTR_KEYS) v += (ratio[k] ?? 0) * (stats.attributesEff[k] - ATTR.base);
  return Math.max(0, v);
}

/** 「基礎値での値 + 係数」を Scaling（ステータス 0 のときの値 + 係数）に直す。計算式の表示を威力と揃えるため */
export function ratioToScaling(atBase: number, ratio: Readonly<AttrRatio> | undefined): Scaling {
  const out: Scaling = { base: atBase };
  if (ratio === undefined) return out;
  for (const k of ATTR_KEYS) {
    const r = ratio[k];
    if (r === undefined || r === 0) continue;
    out[k] = r;
    out.base -= r * ATTR.base;
  }
  return out;
}

/** 強化系スキルの効果量の倍率。係数表が無ければ 1（ステータスで伸びない） */
export function buffMul(stats: Readonly<PlayerStats>, s: Readonly<Scaling> | undefined): number {
  if (s === undefined) return 1;
  return Math.max(0, scaled(stats, s));
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
  // 筋力・霊力は体の性能を持たない（行動ごとの係数でだけ効く）
  deriveDex(out, eff.dex - ATTR.base);
  deriveVit(out, eff.vit - ATTR.base);
  deriveMnd(out, eff.mnd - ATTR.base);
  return out;
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

function deriveDex(out: PlayerStats, d: number): void {
  out.moveSpeedMul *= perPointMul(ATTR.dexMove, d);
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
}
