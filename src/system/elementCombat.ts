import { type AttackProfile, type AttackQuality, type Element, ELEMENTS, attack } from "../core/element";
import { type DamageKind, type Enemy, type GameState, pushSfx } from "../core/state";
import type { StatusKind } from "../core/status";
import { enemyGuard } from "../data/enemyCombat";
import { clampEnemyDefense, enemyResistTable } from "../data/enemyDefense";
import { ARMOR_K, ARMOR_MAX_REDUCTION, ELEMENT, GENRE } from "../data/tuning";
import { MOVESETS, SHOT_TYPES } from "../data/weapons";
import type { PlayerStats } from "../loot/types";
import { addFloatingText } from "./effects";
import { applyStatus } from "./statusEffects";

/**
 * 攻撃ジャンル・属性・防御の計算（docs/COMBAT_DESIGN.md A-8）。combat.ts の rollOutgoing / mitigate から呼ぶ。
 * - 与ダメ: × 敵の防御（質軸で防御 / 魔防 / 平均）× 属性倍率（変換の割合で耐性を按分）
 * - 被ダメ: 敵の攻撃の質で防御（armor）/ 魔防（warding）を選び、属性はプレイヤーの耐性（ソフトキャップ付き）で受ける
 * proc（反射・爆発・状態異常の継続ダメージなど）は素性を持たないので、どちらも掛けない
 */

export type ElementAffinity = "weak" | "resist" | "neutral";

export interface ElementShare {
  element: Element;
  /** 0..1。合計 1 */
  share: number;
}

const PERCENT = 100;
/** 倍率が 1 からこれ以上ずれたら弱点 / 耐性として見せる（浮動小数の誤差を拾わない） */
const AFFINITY_EPS = 1e-6;

/** 属性ごとに関係の深い状態異常（同一視はしない。ELEMENT.affinity の低い確率で付くだけ） */
const ELEMENT_STATUS: Readonly<Partial<Record<Element, keyof typeof ELEMENT.affinity.potency & StatusKind>>> = {
  fire: "burn",
  ice: "chill",
  lightning: "shock",
  poison: "poison",
  dark: "weaken",
  light: "vulnerable",
};

// -----------------------------------------------------------------------------
// 攻撃の素性
// -----------------------------------------------------------------------------

/** 近接は武器種、射撃は射撃の型の素性。スキル由来で素性の指定が無いものは範囲軸だけ合わせた無属性の物理 */
export function resolveAttack(stats: Readonly<PlayerStats>, kind: DamageKind, skill: boolean, explicit?: AttackProfile | null): AttackProfile | null {
  if (explicit !== undefined) return explicit;
  if (kind === "proc") return null;
  if (skill) return attack(kind === "melee" ? "melee" : "ranged", "physical");
  return kind === "melee" ? MOVESETS[stats.moveset].attack : SHOT_TYPES[stats.shot].attack;
}

/**
 * 属性の内訳。通常攻撃（近接・射撃）は属性の変換（infuse）の割合をその属性へ移し、残りが元の属性。
 * スキルは無の刻印（skillNeutral）の割合を無属性へ戻す
 */
export function elementShares(stats: Readonly<PlayerStats>, atk: AttackProfile, skill: boolean): ElementShare[] {
  const moved: ElementShare[] = skill
    ? [{ element: "none", share: stats.skillNeutral }]
    : ELEMENTS.filter((e) => e !== "none").map((e) => ({ element: e, share: stats.infuse[e] }));
  const out = new Map<Element, number>();
  let rest = 1;
  for (const m of moved) {
    const share = Math.min(Math.max(0, m.share), rest);
    if (share <= 0) continue;
    out.set(m.element, (out.get(m.element) ?? 0) + share);
    rest -= share;
  }
  if (rest > 0) out.set(atk.element, (out.get(atk.element) ?? 0) + rest);
  // ELEMENTS の順に並べる（Map の挿入順に依存させない）
  return ELEMENTS.filter((e) => out.has(e)).map((e) => ({ element: e, share: out.get(e) ?? 0 }));
}

/** 割合が最も大きい属性（同率は ELEMENTS の順で先） */
export function dominantElement(shares: readonly ElementShare[]): ElementShare | undefined {
  let best: ElementShare | undefined;
  for (const s of shares) if (!best || s.share > best.share) best = s;
  return best;
}

// -----------------------------------------------------------------------------
// 与ダメ（敵の防御と耐性）
// -----------------------------------------------------------------------------

function stageOf(enemy: Enemy): number {
  return enemy.ai?.stage ?? 0;
}

/** 質軸で受ける敵の防御 %（混成は GENRE.hybridMix で防御と魔防を混ぜる） */
export function enemyDefenseFor(enemy: Enemy, quality: AttackQuality): number {
  const g = enemyGuard(enemy.defKey);
  if (quality === "physical") return clampEnemyDefense(g.defense);
  if (quality === "arcane") return clampEnemyDefense(g.warding);
  return clampEnemyDefense(g.defense * (1 - GENRE.hybridMix) + g.warding * GENRE.hybridMix);
}

export function enemyDefenseMul(enemy: Enemy, quality: AttackQuality): number {
  return 1 - enemyDefenseFor(enemy, quality) / PERCENT;
}

/** 属性倍率 = Σ 割合 × (1 − 耐性%) */
export function enemyElementMul(enemy: Enemy, shares: readonly ElementShare[]): number {
  const table = enemyResistTable(enemyGuard(enemy.defKey), stageOf(enemy));
  return shares.reduce((sum, s) => sum + s.share * (1 - table[s.element] / PERCENT), 0);
}

export function affinityOf(mul: number): ElementAffinity {
  if (mul > 1 + AFFINITY_EPS) return "weak";
  if (mul < 1 - AFFINITY_EPS) return "resist";
  return "neutral";
}

export interface OutgoingElement {
  mul: number;
  affinity: ElementAffinity;
  shares: ElementShare[];
}

/** 与ダメに掛ける倍率（防御 × 属性）と弱点 / 耐性の判定 */
export function outgoingElement(stats: Readonly<PlayerStats>, enemy: Enemy, atk: AttackProfile, skill: boolean): OutgoingElement {
  const shares = elementShares(stats, atk, skill);
  const elementMul = enemyElementMul(enemy, shares);
  return { mul: enemyDefenseMul(enemy, atk.genre.quality) * elementMul, affinity: affinityOf(elementMul), shares };
}

/**
 * 弱点 / 耐性の浮き文字と効果音。同じ敵の近くに同じ文字がまだ濃く残っていれば出さない
 * （多段ヒット・連射で画面を埋めない。state.texts を読むだけで判定できるので状態を増やさない）
 */
export function showAffinity(state: GameState, enemy: Enemy, affinity: ElementAffinity): void {
  if (affinity === "neutral") return;
  const text = affinity === "weak" ? ELEMENT.weakText : ELEMENT.resistText;
  const r2 = ELEMENT.textDedupeRadius * ELEMENT.textDedupeRadius;
  const shown = state.texts.some(
    (t) => t.text === text && t.life > t.maxLife / 2 && (t.pos.x - enemy.body.pos.x) ** 2 + (t.pos.y - enemy.body.pos.y) ** 2 <= r2,
  );
  if (shown) return;
  const color = affinity === "weak" ? ELEMENT.weakColor : ELEMENT.resistColor;
  addFloatingText(state, { x: enemy.body.pos.x, y: enemy.body.pos.y - ELEMENT.mark.offsetY }, text, color, ELEMENT.textScale, ELEMENT.textLife);
  pushSfx(state, affinity === "weak" ? "weakHit" : "resistHit");
}

/** 属性が関係の深い状態異常を低い確率で付ける（属性の割合が minShare 以上のときだけ。無属性は何もしない） */
export function rollElementAffinity(state: GameState, enemy: Enemy, shares: readonly ElementShare[]): void {
  const top = dominantElement(shares);
  if (!top || top.share < ELEMENT.affinity.minShare) return;
  const kind = ELEMENT_STATUS[top.element];
  if (kind === undefined) return;
  if (!state.rng.chance(ELEMENT.affinity.chance)) return;
  const potency = ELEMENT.affinity.potency[kind];
  applyStatus(state, { kind: "enemy", enemy }, { kind, stacks: 1, duration: ELEMENT.affinity.duration, potency }, "player");
}

// -----------------------------------------------------------------------------
// 被ダメ（プレイヤーの防御・魔防・耐性）
// -----------------------------------------------------------------------------

/** 防御 / 魔防の軽減率（armor と同じ逓減式）。0..ARMOR_MAX_REDUCTION */
export function defenseReduction(value: number): number {
  if (value <= 0) return 0;
  return Math.min(ARMOR_MAX_REDUCTION, value / (value + ARMOR_K));
}

/** 質軸で選んだ軽減率。混成は防御と魔防の軽減率を GENRE.hybridMix で混ぜる */
export function playerDefenseReduction(stats: Readonly<PlayerStats>, quality: AttackQuality): number {
  const phys = defenseReduction(stats.armor);
  const arc = defenseReduction(stats.warding);
  if (quality === "physical") return phys;
  if (quality === "arcane") return arc;
  return phys * (1 - GENRE.hybridMix) + arc * GENRE.hybridMix;
}

/** プレイヤーの耐性のソフトキャップ: knee を超えた分は slope 倍、上限 resistMax・下限 resistMin */
export function effectiveResist(raw: number): number {
  const e = ELEMENT;
  const bent = raw > e.resistKnee ? e.resistKnee + (raw - e.resistKnee) * e.resistSlope : raw;
  return Math.min(e.resistMax, Math.max(e.resistMin, bent));
}

/** 被ダメに掛ける倍率（防御 / 魔防 × 耐性）。攻撃の素性が無ければ（罠・地形など）物理・無属性 */
export function playerMitigationMul(stats: Readonly<PlayerStats>, atk: AttackProfile | null): number {
  const quality = atk?.genre.quality ?? "physical";
  const element = atk?.element ?? "none";
  return (1 - playerDefenseReduction(stats, quality)) * (1 - effectiveResist(stats.resist[element]) / PERCENT);
}

/** 敵の攻撃の素性（attacker が無ければ null） */
export function enemyAttackOf(attacker: Enemy | undefined): AttackProfile | null {
  return attacker ? enemyGuard(attacker.defKey).attack : null;
}
