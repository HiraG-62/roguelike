import { type DamageKind, type Enemy, type GameState, type PoiseState, pushSfx } from "../core/state";
import type { StatusApply, StatusBag, StatusEffect, StatusKind, StatusSource } from "../core/status";
import { type Vec, dist, sub } from "../core/vec";
import { type EnemyBehavior, enemyDef } from "../data/enemies";
import { type EnemyAttackKind, enemyCombat } from "../data/enemyCombat";
import { STATUS } from "../data/tuning";
import { damageEnemy, damagePlayerDot, rollOutgoing } from "./combat";
import { shake, spawnBurst, spawnLine, spawnRing } from "./effects";
import { circlesOverlap } from "./physics";
import { decayPoise, onStaggerEnd } from "./poise";

/**
 * 状態異常の統一システム（docs/COMBAT_DESIGN.md E）。プレイヤーと敵が同じ StatusBag を持ち、
 * 付与（免疫・拘束上限・スタック規則・相互作用）は applyStatus の 1 か所で処理する
 */

const BURN_PARTICLE_SPEED = 30;
const BURN_PARTICLE_LIFE = 0.35;
const EXPLODE_PARTICLES = 24;
const EXPLODE_SPEED = 180;
const SHOCK_PARTICLES = 4;
const CHILL_PARTICLES = 5;
const VAPOR_COLOR = "#e8f0ff";
const VAPOR_PARTICLES = 10;
/** 拘束上限で切り詰めた残りがこれ未満なら付与しない（一瞬だけ止まる不自然さを避ける） */
const CC_MIN_DURATION = 0.05;

/**
 * 行動停止系。拘束上限（STATUS.ccBudget）の対象。
 * 恐怖は外す: 解除後 6 秒の恐怖免疫で永久に止まらないうえ、鬼火の「2 倍の時間」が上限 2 秒で消えてしまうため
 */
const CC_KINDS: ReadonlySet<StatusKind> = new Set<StatusKind>(["stagger", "freeze", "paralyze"]);
/** 出現中の敵に付かないもの（出現演出を止めない） */
const SPAWN_IMMUNE: ReadonlySet<StatusKind> = new Set<StatusKind>(["stagger", "freeze", "paralyze", "fear"]);
/** プレイヤーに付かないもの（操作を奪いすぎる） */
const PLAYER_IMMUNE: ReadonlySet<StatusKind> = new Set<StatusKind>(["freeze", "paralyze", "fear"]);
/** 付いている間は付け直さない（持続も延ばさない）。行動停止を付け直しで延命させない */
const NO_REFRESH: ReadonlySet<StatusKind> = new Set<StatusKind>(["stagger", "freeze", "paralyze", "fear"]);
/** 沈黙で予備動作を取り消せる（射撃・レーザー・爆弾） */
const SILENCEABLE_WINDUP: ReadonlySet<EnemyBehavior> = new Set<EnemyBehavior>(["shooter", "laser", "bomber"]);

/** 怯みの蓄積の初期値。耐性は enemies.ts の createEnemy が ENEMY_COMBAT から入れる */
export function createPoiseState(): PoiseState {
  return { max: 0, damage: 0, sinceHit: 0, downs: 0 };
}

/** 状態異常の付与先（docs/COMBAT_DESIGN.md E-1） */
export type StatusTarget = { kind: "enemy"; enemy: Enemy } | { kind: "player" };

// -----------------------------------------------------------------------------
// 読み出し
// -----------------------------------------------------------------------------

/** その種類の状態異常が残り時間つきで付いているか */
export function hasStatus(bag: Readonly<StatusBag>, kind: StatusKind): boolean {
  return bag.effects.some((e) => e.kind === kind && e.time > 0);
}

/** その種類のスタック数。付いていなければ 0 */
export function statusStacks(bag: Readonly<StatusBag>, kind: StatusKind): number {
  const effect = findStatus(bag, kind);
  return effect ? effect.stacks : 0;
}

/** 残り時間のある効果を 1 つ返す（種類ごとに 1 つしか持たない） */
export function findStatus(bag: Readonly<StatusBag>, kind: StatusKind): StatusEffect | undefined {
  return bag.effects.find((e) => e.kind === kind && e.time > 0);
}

/** 行動停止中か（怯み・凍結・麻痺）。AI は何もしない */
export function isHalted(e: Enemy): boolean {
  return hasStatus(e.status, "stagger") || hasStatus(e.status, "freeze") || hasStatus(e.status, "paralyze");
}

export function isFeared(e: Enemy): boolean {
  return hasStatus(e.status, "fear");
}

/** 沈黙中の敵は射撃・レーザー・爆弾・ボスの弾幕を出せない（接触・突進は出せる） */
export function isSilenced(e: Enemy): boolean {
  return hasStatus(e.status, "silence");
}

/** 敵が与えるダメージの倍率（弱体） */
export function enemyDamageMul(e: Enemy | undefined): number {
  if (!e || !hasStatus(e.status, "weaken")) return 1;
  return 1 - STATUS.weaken.mul;
}

/** chill 中の時間倍率（移動と phaseTimer の進行に掛ける）。遅さは 0.12 × スタックか付与時の値の大きい方 */
export function chillFactor(enemy: Enemy): number {
  const c = findStatus(enemy.status, "chill");
  if (!c) return 1;
  const slow = Math.max(c.potency, STATUS.chill.slowPerStack * c.stacks);
  const cap = enemyDef(enemy.defKey).boss ? STATUS.chill.bossMaxSlow : STATUS.maxSlow;
  return 1 - Math.min(cap, slow);
}

/** プレイヤーの冷気による移動倍率。怯みの移動倍率は player.ts（PLAYER.staggerMoveMul）が持つ */
export function playerStatusMoveMul(state: GameState): number {
  const chill = statusStacks(state.player.status, "chill");
  if (chill <= 0) return 1;
  return 1 - Math.min(STATUS.maxSlow, STATUS.chill.slowPerStack * chill);
}

/** プレイヤーがスキルを撃てるか（怯み・沈黙中は不可） */
export function playerCanCast(state: GameState): boolean {
  const bag = state.player.status;
  return !hasStatus(bag, "stagger") && !hasStatus(bag, "silence");
}

// -----------------------------------------------------------------------------
// 付与
// -----------------------------------------------------------------------------

function bagOf(state: GameState, target: StatusTarget): StatusBag {
  return target.kind === "enemy" ? target.enemy.status : state.player.status;
}

function targetAlive(state: GameState, target: StatusTarget): boolean {
  if (target.kind === "enemy") return target.enemy.hp > 0;
  return state.status === "playing" && state.player.hp > 0;
}

function targetPos(state: GameState, target: StatusTarget): Vec {
  return target.kind === "enemy" ? target.enemy.body.pos : state.player.body.pos;
}

function isBossTarget(target: StatusTarget): boolean {
  return target.kind === "enemy" && enemyDef(target.enemy.defKey).boss === true;
}

function isImmune(target: StatusTarget, bag: StatusBag, kind: StatusKind): boolean {
  if ((bag.immune[kind] ?? 0) > 0) return true;
  if (target.kind === "player") return PLAYER_IMMUNE.has(kind);
  const e = target.enemy;
  if (e.phase === "spawning" && SPAWN_IMMUNE.has(kind)) return true;
  return enemyCombat(e.defKey).immune?.includes(kind) === true;
}

/** 種類と対象ごとの持続の補正（プレイヤーは体力で短く、鬼火の恐怖は長く、ボスの麻痺は短く） */
function resolveDuration(state: GameState, target: StatusTarget, apply: Readonly<StatusApply>): number {
  if (target.kind === "player") return apply.duration * state.stats.statusTakenMul;
  const def = enemyDef(target.enemy.defKey);
  if (apply.kind === "fear" && def.behavior === "wisp") return apply.duration * STATUS.fear.wispMul;
  if (apply.kind === "paralyze" && def.boss) return Math.min(apply.duration, STATUS.paralyze.bossDuration);
  return apply.duration;
}

function maxStacks(target: StatusTarget, kind: StatusKind): number {
  const player = target.kind === "player";
  switch (kind) {
    case "chill":
      return player ? STATUS.chill.playerMaxStacks : STATUS.chill.maxStacks;
    case "poison":
      return player ? STATUS.poison.playerMaxStacks : STATUS.poison.maxStacks;
    case "shock":
      return STATUS.shock.maxStacks;
    case "bleed":
      return STATUS.bleed.maxStacks;
    default:
      return 1;
  }
}

/** 拘束上限の残り。窓が閉じていれば満額 */
function ccAllowance(bag: StatusBag): number {
  if (bag.ccWindowLeft <= 0) return STATUS.ccBudget;
  return Math.max(0, STATUS.ccBudget - bag.ccSpent);
}

function spendCc(bag: StatusBag, duration: number): void {
  if (bag.ccWindowLeft <= 0) {
    bag.ccWindowLeft = STATUS.ccWindow;
    bag.ccSpent = 0;
  }
  bag.ccSpent += duration;
}

/**
 * 統一の状態異常を付与する。免疫・拘束上限・スタック規則・相互作用をここ 1 か所で処理する。
 * 付与できたら true（蒸発のように相互作用で消費された場合も true）
 */
export function applyStatus(
  state: GameState,
  target: StatusTarget,
  apply: Readonly<StatusApply>,
  source: StatusSource,
): boolean {
  if (!targetAlive(state, target) || apply.duration <= 0 || apply.stacks <= 0) return false;
  const bag = bagOf(state, target);
  if (isImmune(target, bag, apply.kind)) return false;
  const potency = source === "player" ? apply.potency * state.stats.statusPotencyMul : apply.potency;
  let duration = resolveDuration(state, target, apply);

  const reaction = react(state, target, apply.kind, potency, duration);
  if (reaction === "consumed") return true;
  if (reaction === "blocked") return false;

  // 自傷（env）は拘束上限を数えない。プレイヤーの連打で敵を永久に止めないための上限なので
  const limited = CC_KINDS.has(apply.kind) && source !== "env";
  if (limited) {
    duration = Math.min(duration, ccAllowance(bag));
    if (duration < CC_MIN_DURATION) return false;
  }
  if (!mergeEffect(state, target, bag, apply, potency, duration, source)) return false;
  if (limited) spendCc(bag, duration);
  afterApply(state, target, apply.kind, source);
  return true;
}

type Reaction = "none" | "consumed" | "blocked";

/** 付与の前の相互作用（E-3）: 蒸発 / 凍結中の燃焼 / 凍結中の冷気 */
function react(state: GameState, target: StatusTarget, kind: StatusKind, potency: number, duration: number): Reaction {
  const bag = bagOf(state, target);
  if (kind === "burn") {
    if (hasStatus(bag, "freeze")) {
      // 凍結は解ける（砕きなし）。燃焼はそのまま付く
      removeStatus(state, target, "freeze");
      return "none";
    }
    if (!hasStatus(bag, "chill")) return "none";
    removeStatus(state, target, "chill");
    vaporize(state, target, potency * duration);
    return "consumed";
  }
  if (kind === "chill") {
    if (hasStatus(bag, "freeze")) return "blocked";
    const burn = findStatus(bag, "burn");
    if (!burn) return "none";
    const remaining = burn.potency * burn.time;
    removeStatus(state, target, "burn");
    vaporize(state, target, remaining);
    return "consumed";
  }
  return "none";
}

/** 蒸発: 燃焼の残りダメージの一部を即時に与える */
function vaporize(state: GameState, target: StatusTarget, burnLeft: number): void {
  const amount = Math.round(burnLeft * STATUS.vaporizeRatio);
  const pos = targetPos(state, target);
  spawnBurst(state, pos, VAPOR_COLOR, VAPOR_PARTICLES, 70, 0.4, 2);
  pushSfx(state, "burn");
  if (amount <= 0) return;
  if (target.kind === "player") {
    damagePlayerDot(state, amount);
    return;
  }
  damageEnemy(state, target.enemy, amount, { x: 0, y: 0 }, 0, { hitstopSteps: 0 });
}

/** スタック規則（E-2）。新規なら積む。付け直しできない種類なら false */
function mergeEffect(
  state: GameState,
  target: StatusTarget,
  bag: StatusBag,
  apply: Readonly<StatusApply>,
  potency: number,
  duration: number,
  source: StatusSource,
): boolean {
  const existing = findStatus(bag, apply.kind);
  if (!existing) {
    bag.effects = bag.effects.filter((e) => e.kind !== apply.kind);
    bag.effects.push({
      kind: apply.kind,
      stacks: Math.min(maxStacks(target, apply.kind), apply.stacks),
      time: duration,
      maxTime: duration,
      potency,
      source,
      acc: 0,
      tick: 0,
    });
    if (apply.kind === "bleed") bag.bleedFrom = { ...targetPos(state, target) };
    return true;
  }
  if (NO_REFRESH.has(apply.kind)) return false;
  existing.stacks = Math.min(maxStacks(target, apply.kind), existing.stacks + apply.stacks);
  // 燃焼は強い dps を採用、冷気は付与時の遅さの大きい方、他も強い方を残す
  existing.potency = Math.max(existing.potency, potency);
  existing.time = Math.max(existing.time, duration);
  existing.maxTime = existing.time;
  existing.source = source;
  return true;
}

/** 付与の後: 冷気 5 で凍結、感電 3 で麻痺、怯み・恐怖・沈黙の攻撃取り消し、演出 */
function afterApply(state: GameState, target: StatusTarget, kind: StatusKind, source: StatusSource): void {
  if (target.kind !== "enemy") return;
  const e = target.enemy;
  switch (kind) {
    case "burn":
      pushSfx(state, "burn");
      return;
    case "chill":
      spawnBurst(state, e.body.pos, STATUS.chillColor, CHILL_PARTICLES, 50, 0.3, 1.5);
      pushSfx(state, "freeze");
      // ボスは凍結しない（冷気の遅さの上限 bossMaxSlow で止まる）
      if (isBossTarget(target)) return;
      if (statusStacks(e.status, "chill") >= STATUS.chill.maxStacks) convert(state, target, "chill", "freeze", STATUS.freeze.duration, source);
      return;
    case "shock":
      if (statusStacks(e.status, "shock") >= STATUS.shock.maxStacks) convert(state, target, "shock", "paralyze", STATUS.paralyze.duration, source);
      return;
    case "stagger":
    case "fear":
      cancelEnemyAttack(e);
      return;
    case "silence":
      if (e.phase === "windup" && SILENCEABLE_WINDUP.has(enemyDef(e.defKey).behavior)) cancelEnemyAttack(e);
      return;
    default:
      return;
  }
}

/** 積み切った状態異常を上位の状態異常へ変える（冷気 → 凍結、感電 → 麻痺） */
function convert(state: GameState, target: StatusTarget, from: StatusKind, to: StatusKind, duration: number, source: StatusSource): void {
  removeStatus(state, target, from);
  applyStatus(state, target, { kind: to, stacks: 1, duration, potency: 0 }, source);
}

/** 予備動作・攻撃を取り消し、追跡から出直させる（解除後は attackInterval を待つ） */
function cancelEnemyAttack(e: Enemy): void {
  if (e.phase !== "windup" && e.phase !== "strike" && e.phase !== "recover") return;
  e.phase = "chase";
  e.attackCooldown = enemyDef(e.defKey).attackInterval;
}

/** 状態異常を外す（解除時の免疫・堅守も付く） */
export function removeStatus(state: GameState, target: StatusTarget, kind: StatusKind): void {
  const bag = bagOf(state, target);
  const removed = bag.effects.filter((e) => e.kind === kind);
  if (removed.length === 0) return;
  bag.effects = bag.effects.filter((e) => e.kind !== kind);
  for (const effect of removed) {
    const wasActive = effect.time > 0;
    effect.time = 0;
    if (wasActive) endEffect(state, target, effect);
  }
}

/** 解除の瞬間: 凍結 → 冷気免疫、麻痺 → 感電免疫、恐怖 → 恐怖免疫、怯み → 堅守 */
function endEffect(state: GameState, target: StatusTarget, effect: StatusEffect): void {
  const bag = bagOf(state, target);
  switch (effect.kind) {
    case "freeze":
      bag.immune.chill = STATUS.freeze.chillImmuneAfter;
      return;
    case "paralyze":
      bag.immune.shock = STATUS.paralyze.shockImmuneAfter;
      return;
    case "fear":
      bag.immune.fear = STATUS.fear.immuneAfter;
      return;
    case "bleed":
      delete bag.bleedFrom;
      return;
    case "stagger":
      if (target.kind === "enemy") onStaggerEnd(state, target.enemy, effect.potency);
      return;
    default:
      return;
  }
}

// -----------------------------------------------------------------------------
// 敵 → プレイヤー（E-4）
// -----------------------------------------------------------------------------

/** 付与元の敵。倒されていても種類で引けるよう key を持つ */
export interface InflictSource {
  defKey: string;
  /** ボス部屋の敵（スライム王の分裂した子）は深度条件を無視する。不明なら -1 */
  roomIndex: number;
}

/** 敵の攻撃が当たったとき、ENEMY_COMBAT の inflicts をプレイヤーに付ける */
export function inflictOnPlayer(state: GameState, source: InflictSource | undefined, on: EnemyAttackKind): void {
  if (!source) return;
  const bossRoom = state.boss !== null && state.boss.roomIndex === source.roomIndex;
  for (const inflict of enemyCombat(source.defKey).inflicts) {
    if (inflict.on !== on) continue;
    if (inflict.minDepth !== undefined && state.depth < inflict.minDepth && !bossRoom) continue;
    applyStatus(state, { kind: "player" }, inflict, "enemy");
  }
}

// -----------------------------------------------------------------------------
// on-hit（E-5）
// -----------------------------------------------------------------------------

export interface OnHitContext {
  kind?: DamageKind;
  /** スキル由来の命中 */
  skill?: boolean;
  crit?: boolean;
}

function procMatches(on: "melee" | "ranged" | "skill" | "any", ctx: OnHitContext): boolean {
  if (on === "any") return true;
  if (on === "skill") return ctx.skill === true;
  return ctx.skill !== true && ctx.kind === on;
}

/**
 * 近接 / 射撃ヒット時に stats の確率で状態異常を付ける。
 * 同じ敵に対して STATUS.onHitIcd 秒に 1 回までしか判定しない
 * （多段ヒット・弾の同時ヒットで burn/chill/shock が乱発されないように）
 */
export function applyOnHitStatus(state: GameState, enemy: Enemy, ctx: OnHitContext = {}): void {
  if (enemy.status.procIcd > 0) return;
  const s = state.stats;
  if (enemy.hp > 0 && s.burnChance > 0 && s.burnDps > 0 && state.rng.chance(s.burnChance)) {
    applyBurn(state, enemy, s.burnDps, STATUS.burnDuration);
  }
  if (enemy.hp > 0 && s.chillChance > 0 && s.chillSlow > 0 && state.rng.chance(s.chillChance)) {
    applyChill(state, enemy, s.chillSlow, STATUS.chillDuration);
  }
  if (s.shockChance > 0 && s.shockDamage > 0 && state.rng.chance(s.shockChance)) {
    chainLightning(state, enemy.body.pos, s.shockDamage, enemy.id);
    const shock = { kind: "shock" as const, stacks: 1, duration: STATUS.shock.duration, potency: s.shockDamage };
    applyStatus(state, { kind: "enemy", enemy }, shock, "player");
  }
  for (const proc of s.statusProcs) {
    if (enemy.hp <= 0) break;
    if (!procMatches(proc.on, ctx) || (proc.requiresCrit && !ctx.crit)) continue;
    if (!state.rng.chance(proc.chance)) continue;
    applyStatus(state, { kind: "enemy", enemy }, proc, "player");
  }
  enemy.status.procIcd = STATUS.onHitIcd;
}

/** 燃焼を付ける（強い方の dps を採用し、持続は延長する） */
export function applyBurn(state: GameState, enemy: Enemy, dps: number, duration: number): void {
  applyStatus(state, { kind: "enemy", enemy }, { kind: "burn", stacks: 1, duration, potency: dps }, "player");
}

/** 冷気を 1 スタック付ける。slow は遅さの下限（0.12 × スタックより大きければそちら） */
export function applyChill(state: GameState, enemy: Enemy, slow: number, duration: number): void {
  applyStatus(state, { kind: "enemy", enemy }, { kind: "chill", stacks: 1, duration, potency: slow }, "player");
}

// -----------------------------------------------------------------------------
// 雷・爆発（既存の proc）
// -----------------------------------------------------------------------------

/**
 * 連鎖雷: origin から半径内で一番近い未命中の敵へ飛び、そこからまた次へ（最大 shockMaxTargets 体）。
 * excludeId は起点の敵（自分自身には飛ばない）
 */
export function chainLightning(state: GameState, origin: Vec, damage: number, excludeId?: number): void {
  const hit = new Set<number>();
  if (excludeId !== undefined) hit.add(excludeId);
  let from = { ...origin };
  let jumps = 0;
  for (let i = 0; i < STATUS.shockMaxTargets; i++) {
    const next = nearestEnemy(state, from, STATUS.shockRadius, hit);
    if (!next) break;
    hit.add(next.id);
    zap(state, from, next, damage, origin);
    from = { ...next.body.pos };
    jumps += 1;
  }
  if (jumps > 0) pushSfx(state, "shock");
}

function zap(state: GameState, from: Vec, target: Enemy, damage: number, origin: Vec): void {
  spawnLine(state, from, target.body.pos, STATUS.shockColor, STATUS.fxLife);
  spawnBurst(state, target.body.pos, STATUS.shockColor, SHOCK_PARTICLES, 60, 0.2, 1.5);
  const out = rollOutgoing(state, target, damage, "proc");
  damageEnemy(state, target, out.amount, sub(target.body.pos, origin), 0, { hitstopSteps: 0 });
}

function nearestEnemy(state: GameState, from: Vec, radius: number, exclude: ReadonlySet<number>): Enemy | null {
  let best: Enemy | null = null;
  let bestD = radius;
  for (const e of state.enemies) {
    if (e.hp <= 0 || e.phase === "spawning" || exclude.has(e.id)) continue;
    const d = dist(from, e.body.pos);
    if (d > bestD) continue;
    best = e;
    bestD = d;
  }
  return best;
}

/** 半径内の敵を列挙する（出現中は対象外） */
export function enemiesInRadius(state: GameState, pos: Vec, radius: number): Enemy[] {
  return state.enemies.filter(
    (e) =>
      e.hp > 0 &&
      e.phase !== "spawning" &&
      circlesOverlap(pos.x, pos.y, radius, e.body.pos.x, e.body.pos.y, e.body.radius),
  );
}

/** 範囲爆発。excludeId の敵は巻き込まない */
export function explodeAt(state: GameState, pos: Vec, radius: number, damage: number, excludeId?: number): void {
  spawnRing(state, pos, radius, STATUS.explodeColor, STATUS.fxLife);
  spawnBurst(state, pos, STATUS.explodeColor, EXPLODE_PARTICLES, EXPLODE_SPEED, 0.4, 2.5);
  shake(state, 3);
  pushSfx(state, "explode");
  for (const e of enemiesInRadius(state, pos, radius)) {
    if (e.id === excludeId) continue;
    const out = rollOutgoing(state, e, damage, "proc");
    damageEnemy(state, e, out.amount, sub(e.body.pos, pos), STATUS.explodeKnockback, { hitstopSteps: 0 });
  }
}

/** 撃破時の確率爆発 */
export function explodeOnKill(state: GameState, enemy: Enemy): void {
  const s = state.stats;
  if (s.explodeOnKillChance <= 0 || s.explodeDamage <= 0) return;
  if (!state.rng.chance(s.explodeOnKillChance)) return;
  explodeAt(state, enemy.body.pos, STATUS.explodeRadius, s.explodeDamage, enemy.id);
}

// -----------------------------------------------------------------------------
// 時間経過
// -----------------------------------------------------------------------------

/** 敵とプレイヤーの状態異常を進める（継続ダメージ・感電の周期・出血・免疫・拘束上限の窓・怯みの減衰） */
export function updateStatusEffects(state: GameState, dt: number): void {
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    tickBag(state, { kind: "enemy", enemy: e }, dt);
    decayPoise(e, dt);
  }
  if (state.status === "playing") tickBag(state, { kind: "player" }, dt);
}

function tickBag(state: GameState, target: StatusTarget, dt: number): void {
  const bag = bagOf(state, target);
  bag.procIcd = Math.max(0, bag.procIcd - dt);
  tickCcWindow(bag, dt);
  tickImmunity(bag, dt);
  const staggered = hasStatus(bag, "stagger");
  for (const effect of [...bag.effects]) {
    if (!targetAlive(state, target)) return;
    if (effect.time <= 0) continue;
    // 恐怖中に怯んだら怯みが優先し、恐怖の残りは止まる
    if (effect.kind === "fear" && staggered) continue;
    const t = Math.min(dt, effect.time);
    tickEffect(state, target, effect, t);
    effect.time -= t;
  }
  expire(state, target);
}

function expire(state: GameState, target: StatusTarget): void {
  const bag = bagOf(state, target);
  const ended = bag.effects.filter((e) => e.time <= 0);
  if (ended.length === 0) return;
  bag.effects = bag.effects.filter((e) => e.time > 0);
  for (const effect of ended) endEffect(state, target, effect);
}

function tickCcWindow(bag: StatusBag, dt: number): void {
  if (bag.ccWindowLeft <= 0) return;
  bag.ccWindowLeft = Math.max(0, bag.ccWindowLeft - dt);
  if (bag.ccWindowLeft === 0) bag.ccSpent = 0;
}

function tickImmunity(bag: StatusBag, dt: number): void {
  for (const kind of Object.keys(bag.immune) as StatusKind[]) {
    const left = (bag.immune[kind] ?? 0) - dt;
    if (left > 0) bag.immune[kind] = left;
    else delete bag.immune[kind];
  }
}

function tickEffect(state: GameState, target: StatusTarget, effect: StatusEffect, dt: number): void {
  switch (effect.kind) {
    case "burn":
      burnParticles(state, target);
      dealDot(state, target, effect, effect.potency * dt);
      return;
    case "poison":
      dealDot(state, target, effect, targetMaxHp(state, target) * poisonRatio(target, effect.potency) * effect.stacks * dt);
      return;
    case "bleed":
      tickBleed(state, target, effect);
      return;
    case "shock":
      if (target.kind === "enemy") tickShock(state, target.enemy, effect, dt);
      return;
    default:
      return;
  }
}

function targetMaxHp(state: GameState, target: StatusTarget): number {
  return target.kind === "enemy" ? target.enemy.maxHp : state.player.maxHp;
}

/**
 * 毒の 1 スタック / 秒の最大 HP 割合。potency > 0（性質の statusProcs・霊力込み）ならそれを通常敵の割合として使い、
 * ボスは bossHpRatioPerSec / hpRatioPerSec の比で弱める。potency 0 は既定値
 */
function poisonRatio(target: StatusTarget, potency: number): number {
  if (target.kind === "player") return potency > 0 ? potency : STATUS.poison.playerHpRatioPerSec;
  const base = potency > 0 ? potency : STATUS.poison.hpRatioPerSec;
  if (!isBossTarget(target)) return base;
  return base * (STATUS.poison.bossHpRatioPerSec / STATUS.poison.hpRatioPerSec);
}

function burnParticles(state: GameState, target: StatusTarget): void {
  if (state.tick % STATUS.burnParticleInterval !== 0) return;
  spawnBurst(state, targetPos(state, target), STATUS.burnColor, 1, BURN_PARTICLE_SPEED, BURN_PARTICLE_LIFE, 1.5);
}

/** 継続ダメージ。端数は貯めて整数ぶんだけ減らす（数字は出さず HP バーだけ減る） */
function dealDot(state: GameState, target: StatusTarget, effect: StatusEffect, amount: number): void {
  effect.acc += amount;
  const whole = Math.floor(effect.acc);
  if (whole < 1) return;
  effect.acc -= whole;
  if (target.kind === "player") {
    damagePlayerDot(state, whole);
    return;
  }
  damageEnemy(state, target.enemy, whole, { x: 0, y: 0 }, 0, { silent: true });
}

/** 出血: 移動 bleed.distance px ごとに potency × スタック（毒があれば × poisonMul）。ノックバック・ダッシュも数える */
function tickBleed(state: GameState, target: StatusTarget, effect: StatusEffect): void {
  const bag = bagOf(state, target);
  const pos = targetPos(state, target);
  const from = bag.bleedFrom ?? pos;
  const moved = dist(from, pos);
  bag.bleedFrom = { ...pos };
  if (moved <= 0) return;
  const poisonMul = hasStatus(bag, "poison") ? STATUS.bleed.poisonMul : 1;
  dealDot(state, target, effect, (moved / STATUS.bleed.distance) * effect.potency * effect.stacks * poisonMul);
}

/** 感電: 周期ごとに近くの別の敵 1 体へ連鎖。冷気もあれば冷気 +1（凍結が早まる） */
function tickShock(state: GameState, e: Enemy, effect: StatusEffect, dt: number): void {
  effect.tick += dt;
  if (effect.tick < STATUS.shock.interval) return;
  effect.tick -= STATUS.shock.interval;
  const next = nearestEnemy(state, e.body.pos, STATUS.shock.radius, new Set([e.id]));
  if (next && effect.potency > 0) {
    zap(state, e.body.pos, next, effect.potency, e.body.pos);
    pushSfx(state, "shock");
  }
  if (e.hp <= 0 || !hasStatus(e.status, "chill")) return;
  const chill = { kind: "chill" as const, stacks: 1, duration: STATUS.chill.duration, potency: 0 };
  applyStatus(state, { kind: "enemy", enemy: e }, chill, effect.source);
}
