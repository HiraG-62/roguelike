import type { EliteKind, Enemy, GameState } from "../core/state";
import { enemyDef } from "../data/enemies";
import { enemyCombat } from "../data/enemyCombat";
import { POISE } from "../data/tuning";
import { shieldLeft } from "./elites";
import { applyStatus, hasStatus } from "./statusEffects";

/**
 * 怯み（docs/COMBAT_DESIGN.md D）。攻撃の怯み値を敵ごとに蓄積し、耐性を超えたら状態異常「怯み」を付ける。
 * 怯みそのものは状態異常 stagger が唯一の真実（EnemyPhase には持たない）
 */

/** 自傷の怯み（猪の壁激突など）の印。stagger の potency に入れる。解除後に堅守を付けない */
export const SELF_INFLICTED_POTENCY = 1;

/** 深度で伸びた基礎耐性。表に耐性が無い敵は 0（怯まない） */
export function basePoiseMax(key: string, depth: number): number {
  const base = enemyCombat(key).poise ?? 0;
  return base * (1 + POISE.depthScale * Math.max(0, depth - 1));
}

/** エリートの耐性倍率。迅速は据え置き */
export function elitePoiseMul(kind: EliteKind | undefined): number {
  if (!kind || kind === "hasted") return 1;
  return POISE.eliteMul;
}

/** ボスのダウン回数による耐性の伸び（上限 bossPoiseGrowthMax） */
export function bossPoiseGrowth(downs: number): number {
  return Math.min(POISE.bossPoiseGrowthMax, POISE.bossPoiseGrowth ** downs);
}

/** 生成直後の耐性を入れる（エリート化の前）。エリートは makeElite が倍率を掛ける */
export function initEnemyPoise(e: Enemy, depth: number): void {
  e.poise.max = basePoiseMax(e.defKey, depth);
  e.poise.damage = 0;
  e.poise.sinceHit = 0;
}

export function isStaggered(e: Enemy): boolean {
  return hasStatus(e.status, "stagger");
}

export interface PoiseHitOptions {
  /** 壁叩きつけなど: 強靭を無視する */
  ignoreSuperArmor?: boolean;
}

/** 受け倍率 = 強靭（攻撃中）× 堅守 */
export function poiseTakenMul(e: Enemy, opts: PoiseHitOptions = {}): number {
  const combat = enemyCombat(e.defKey);
  let mul = 1;
  if (!opts.ignoreSuperArmor && e.phase === "windup") mul *= combat.superArmorMul;
  if (!opts.ignoreSuperArmor && e.phase === "strike") mul *= combat.strikeSuperArmorMul ?? combat.superArmorMul;
  if (hasStatus(e.status, "guarded")) mul *= enemyDef(e.defKey).boss ? POISE.bossGuardedMul : POISE.guardedMul;
  return mul;
}

/** 怯み値が溜まらない状態か（耐性なし・出現中・怯み中・障壁が残っている） */
function cannotAccumulate(e: Enemy): boolean {
  return e.poise.max <= 0 || e.hp <= 0 || e.phase === "spawning" || isStaggered(e) || shieldLeft(e) > 0;
}

/**
 * 怯み値を蓄積する。amount は攻撃側の最終値（poiseDamageMul 込み）。
 * 耐性を超えたら怯ませて true
 */
export function addPoise(state: GameState, e: Enemy, amount: number, opts: PoiseHitOptions = {}): boolean {
  if (amount <= 0 || cannotAccumulate(e)) return false;
  const gained = amount * poiseTakenMul(e, opts);
  if (gained <= 0) return false;
  e.poise.damage += gained;
  e.poise.sinceHit = 0;
  if (e.poise.damage < e.poise.max) return false;
  return breakPoise(state, e);
}

/** 耐性を超えた: 怯み（ボスはダウン）。拘束上限で入らなければ蓄積は満杯のまま次の機会を待つ */
function breakPoise(state: GameState, e: Enemy): boolean {
  const combat = enemyCombat(e.defKey);
  e.poise.damage = e.poise.max;
  if (!applyStagger(state, e, combat.staggerTime)) return false;
  e.poise.damage = 0;
  if (enemyDef(e.defKey).boss) {
    e.poise.downs += 1;
    e.poise.max = basePoiseMax(e.defKey, state.depth) * bossPoiseGrowth(e.poise.downs);
  }
  return true;
}

export interface StaggerOptions {
  /** 自傷（壁激突など）。拘束上限を数えず、解除後に堅守を付けない */
  selfInflicted?: boolean;
}

/** 怯み値を通さずに直接怯ませる（障壁破壊・壁激突・盾の破綻） */
export function applyStagger(state: GameState, e: Enemy, time: number, opts: StaggerOptions = {}): boolean {
  if (time <= 0) return false;
  const self = opts.selfInflicted === true;
  return applyStatus(
    state,
    { kind: "enemy", enemy: e },
    { kind: "stagger", stacks: 1, duration: time, potency: self ? SELF_INFLICTED_POTENCY : 0 },
    self ? "env" : "player",
  );
}

/** 怯みが解けた瞬間: 堅守を付ける（自傷の怯みの後は付けない） */
export function onStaggerEnd(state: GameState, e: Enemy, potency: number): void {
  if (potency === SELF_INFLICTED_POTENCY || e.hp <= 0) return;
  const boss = enemyDef(e.defKey).boss === true;
  applyStatus(
    state,
    { kind: "enemy", enemy: e },
    { kind: "guarded", stacks: 1, duration: boss ? POISE.bossGuardedTime : POISE.guardedTime, potency: 0 },
    "env",
  );
}

/** 最後に怯み値を受けてから decayDelay 秒後、毎秒 耐性 × decayRate ずつ減る */
export function decayPoise(e: Enemy, dt: number): void {
  const p = e.poise;
  p.sinceHit += dt;
  if (p.damage <= 0 || p.sinceHit < POISE.decayDelay) return;
  p.damage = Math.max(0, p.damage - p.max * POISE.decayRate * dt);
}

/** 怯みゲージの割合（0..1）。描画用 */
export function poiseRatio(e: Enemy): number {
  if (e.poise.max <= 0) return 0;
  return Math.max(0, Math.min(1, e.poise.damage / e.poise.max));
}
