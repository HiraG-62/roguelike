/**
 * 攻撃ジャンルと属性の型（docs/COMBAT_DESIGN.md A-8）。データのみ。
 * - 攻撃ジャンル = 範囲軸（近接 / 遠距離 / 範囲）× 質軸（物理 / 魔法 / 混成）。質軸が敵の防御と魔防のどちらで受けるかを決め、
 *   参照ステータスの既定表（system/attributes.ts の GENRE_ATTRS）の行を決める
 * - 属性 = 無 / 炎 / 氷 / 雷 / 毒 / 闇 / 光。状態異常とは別の概念で、耐性（−100〜75%）で倍率が変わる
 * 計算は system/combat.ts、敵の値は data/enemyDefense.ts、数値は tuning の GENRE / ELEMENT
 */

export const ELEMENTS = ["none", "fire", "ice", "lightning", "poison", "dark", "light"] as const;
export type Element = (typeof ELEMENTS)[number];

/** 範囲軸 */
export const ATTACK_RANGES = ["melee", "ranged", "area"] as const;
export type AttackRange = (typeof ATTACK_RANGES)[number];

/** 質軸。physical は防御、arcane は魔防、hybrid は両方の平均で受ける */
export const ATTACK_QUALITIES = ["physical", "arcane", "hybrid"] as const;
export type AttackQuality = (typeof ATTACK_QUALITIES)[number];

export interface AttackGenre {
  readonly range: AttackRange;
  readonly quality: AttackQuality;
}

/** 1 つの攻撃の素性（ジャンルと属性） */
export interface AttackProfile {
  readonly genre: AttackGenre;
  readonly element: Element;
}

/** 属性ごとの値。耐性（%、正で軽減・負で弱点）と属性の変換割合（0..1）に使う */
export type ElementTable = Record<Element, number>;

/** 表示名（docs/GLOSSARY.md「属性」） */
export const ELEMENT_LABEL: Readonly<Record<Element, string>> = {
  none: "無",
  fire: "炎",
  ice: "氷",
  lightning: "雷",
  poison: "毒",
  dark: "闇",
  light: "光",
};

/** 弱点の印などに使う色。炎 = 紅 / 氷 = 蒼 / 雷 = 金 / 毒 = 翠 / 闇 = 冥 に寄せた（loot/types.ts の TRAIT_COLOR_HEX に近い色） */
export const ELEMENT_COLOR: Readonly<Record<Element, string>> = {
  none: "#c8c8c8",
  fire: "#ff6a30",
  ice: "#70c8ff",
  lightning: "#ffe050",
  poison: "#80e040",
  dark: "#a060e0",
  light: "#fff4c0",
};

export const RANGE_LABEL: Readonly<Record<AttackRange, string>> = {
  melee: "近接",
  ranged: "遠距離",
  area: "範囲",
};

export const QUALITY_LABEL: Readonly<Record<AttackQuality, string>> = {
  physical: "物理",
  arcane: "魔法",
  hybrid: "混成",
};

/** 「近接・物理」 */
export function genreLabel(genre: AttackGenre): string {
  return `${RANGE_LABEL[genre.range]}・${QUALITY_LABEL[genre.quality]}`;
}

/** 「近接・物理 / 炎属性」。無属性は「無属性」 */
export function attackLabel(attack: AttackProfile): string {
  return `${genreLabel(attack.genre)} / ${ELEMENT_LABEL[attack.element]}属性`;
}

/** 全属性が同じ値の表 */
export function uniformElements(value: number): ElementTable {
  return { none: value, fire: value, ice: value, lightning: value, poison: value, dark: value, light: value };
}

/** 定義表を短く書くための組み立て */
export function attack(range: AttackRange, quality: AttackQuality, element: Element = "none"): AttackProfile {
  return { genre: { range, quality }, element };
}
