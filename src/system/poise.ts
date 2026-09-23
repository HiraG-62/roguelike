import { type EliteKind, type Enemy, type GameState, pushSfx } from "../core/state";
import { enemyTarget, pushEvent } from "../core/events";
import { normalize, sub } from "../core/vec";
import { enemyDef, isBossClass, isExecuteImmune } from "../data/enemies";
import { enemyCombat } from "../data/enemyCombat";
import { POISE, STATUS } from "../data/tuning";
import { addFloatingText, spawnBurst } from "./effects";
import { shieldLeft } from "./elites";
import { gainMana } from "./mana";
import { boonSkipsGuarded, onBoonStagger, onBoonStaggerEnd } from "./boonRules";
import { applyStatus, enemiesInRadius, hasStatus, playerPoiseDealtMul, removeStatus, statusStacks } from "./statusEffects";

/**
 * 怯み（docs/COMBAT_DESIGN.md D）。攻撃の怯み値を敵ごとに蓄積し、耐性を超えたら状態異常「怯み」を付ける。
 * 怯みそのものは状態異常 stagger が唯一の真実（EnemyPhase には持たない）
 */

/** 自傷の怯み（猪の壁激突など）の印。stagger の potency に入れる。解除後に堅守を付けない */
export const SELF_INFLICTED_POTENCY = 1;
const EXECUTE_TEXT = "処刑";
const EXECUTE_COLOR = "#ff4060";
const EXECUTE_TEXT_SCALE = 1.4;
const EXECUTE_PARTICLES = 20;

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
  /** 背面の一撃（addPoise が判定して入れる）: 堅守を無視して × backstabMul */
  fromBehind?: boolean;
  /** 怯みの伝播で入った怯み値（さらに伝播しない） */
  noSpread?: boolean;
  /**
   * 処刑を判定する（damageEnemy の命中だけが true を渡す）。
   * 処刑は HP を 0 にするだけで撃破の処理は damageEnemy に任せるので、伝播・祝福・スキルの
   * addPoise から処刑すると撃破の報酬・トリガーが抜けたまま消える
   */
  canExecute?: boolean;
}

/**
 * 受け倍率 = 強靭（攻撃中）× 堅守 × 状態異常（崩勢・腐食）× 背面。
 * 萎縮（弱体 + 脆弱）は強靭を無視し、背面の一撃は堅守を無視する（堅守を崩す手段）。
 * 背面でも強靭は残す（スライム王の空中のように強靭 0 で「溜まらない」と決めた攻撃を崩さない）
 */
export function poiseTakenMul(e: Enemy, opts: PoiseHitOptions = {}): number {
  const combat = enemyCombat(e.defKey);
  const wither = hasStatus(e.status, "weaken") && hasStatus(e.status, "vulnerable");
  const ignoreArmor = opts.ignoreSuperArmor === true || wither;
  let mul = 1;
  if (!ignoreArmor && e.phase === "windup") mul *= combat.superArmorMul;
  if (!ignoreArmor && e.phase === "strike") mul *= combat.strikeSuperArmorMul ?? combat.superArmorMul;
  if (!opts.fromBehind && hasStatus(e.status, "guarded")) mul *= isBossClass(enemyDef(e.defKey)) ? POISE.bossGuardedMul : POISE.guardedMul;
  if (hasStatus(e.status, "broken")) mul *= STATUS.broken.poiseMul;
  mul *= 1 + STATUS.corrode.poisePerStack * statusStacks(e.status, "corrode");
  if (opts.fromBehind) mul *= POISE.backstabMul;
  return mul;
}

/**
 * 背面の一撃: 攻撃の予備動作〜硬直中の敵を、攻撃の向き（strikeDir）の背後から殴った。
 * 攻撃中に限るのは、向きが確定していて「回り込んだ」と読めるのがその間だけだから
 */
export function isBehind(state: GameState, e: Enemy): boolean {
  if (e.phase !== "windup" && e.phase !== "strike" && e.phase !== "recover") return false;
  const toPlayer = normalize(sub(state.player.body.pos, e.body.pos));
  const facing = normalize(e.strikeDir);
  return facing.x * toPlayer.x + facing.y * toPlayer.y < POISE.backstabDot;
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
  if (amount <= 0) return false;
  if (opts.canExecute === true && tryExecute(state, e, amount)) return true;
  if (cannotAccumulate(e)) return false;
  const hitOpts = opts.fromBehind === undefined ? { ...opts, fromBehind: isBehind(state, e) } : opts;
  const gained = amount * playerPoiseDealtMul(state) * poiseTakenMul(e, hitOpts);
  if (gained <= 0) return false;
  e.poise.damage += gained;
  e.poise.sinceHit = 0;
  if (e.poise.damage < e.poise.max) return false;
  if (!breakPoise(state, e)) return false;
  if (!opts.noSpread) spreadStagger(state, e);
  return true;
}

/**
 * 処刑: 怯み中で HP が executeHpRatio 以下の敵に、怯み値 executeMinPoise 以上の一撃（近接 3 段目など）が当たると即死。
 * ボス・ボスの片割れ・部屋主・変身する敵には効かない（isExecuteImmune）。
 * damageEnemy が HP を減らした後に呼ぶので、ここでは HP を 0 にするだけ（撃破の処理は damageEnemy が 1 回だけ行う）
 */
function tryExecute(state: GameState, e: Enemy, amount: number): boolean {
  if (amount < POISE.executeMinPoise || e.hp <= 0 || !isStaggered(e)) return false;
  if (isExecuteImmune(enemyDef(e.defKey)) || e.hp > e.maxHp * POISE.executeHpRatio) return false;
  e.hp = 0;
  addFloatingText(state, e.body.pos, EXECUTE_TEXT, EXECUTE_COLOR, EXECUTE_TEXT_SCALE, 0.7);
  spawnBurst(state, e.body.pos, EXECUTE_COLOR, EXECUTE_PARTICLES, 180, 0.45, 2.5);
  pushSfx(state, "hitHeavy");
  gainMana(state, POISE.executeMana);
  const fear = { kind: "fear" as const, stacks: 1, duration: POISE.executeFearDuration, potency: 0 };
  for (const other of enemiesInRadius(state, e.body.pos, POISE.executeFearRadius)) {
    if (other.id !== e.id) applyStatus(state, { kind: "enemy", enemy: other }, fear, "player");
  }
  return true;
}

/** 怯みの伝播: 怯んだ瞬間、周囲の敵に怯み値（伝播先からはさらに伝播しない） */
function spreadStagger(state: GameState, e: Enemy): void {
  for (const other of enemiesInRadius(state, e.body.pos, POISE.spreadRadius)) {
    if (other.id === e.id) continue;
    addPoise(state, other, POISE.spreadPoise, { noSpread: true, fromBehind: false });
  }
}

/** 耐性を超えた: 怯み（ボスはダウン）。拘束上限で入らなければ蓄積は満杯のまま次の機会を待つ */
function breakPoise(state: GameState, e: Enemy): boolean {
  const combat = enemyCombat(e.defKey);
  e.poise.damage = e.poise.max;
  if (!applyStagger(state, e, combat.staggerTime)) return false;
  e.poise.damage = 0;
  if (isBossClass(enemyDef(e.defKey))) {
    e.poise.downs += 1;
    e.poise.max = basePoiseMax(e.defKey, state.depth) * bossPoiseGrowth(e.poise.downs);
  }
  onBoonStagger(state, e);
  pushEvent(state, { kind: "onStagger", actor: "player", source: { kind: "player", key: "stagger" }, ...enemyTarget(e) });
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
    self ? "self" : "player",
  );
}

/** 怯みが解けた瞬間: 堅守を付ける（自傷の怯みの後は付けない。崩勢が付いていれば崩勢を消費して付けない = 崩落） */
export function onStaggerEnd(state: GameState, e: Enemy, potency: number): void {
  if (potency === SELF_INFLICTED_POTENCY || e.hp <= 0) return;
  onBoonStaggerEnd(state, e);
  if (boonSkipsGuarded(state, e)) return;
  if (hasStatus(e.status, "broken")) {
    removeStatus(state, { kind: "enemy", enemy: e }, "broken", "consume");
    return;
  }
  const boss = isBossClass(enemyDef(e.defKey));
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
