import { type Enemy, type EnemyEffects, type GameState, pushSfx } from "../core/state";
import { type Vec, dist, sub } from "../core/vec";
import { STATUS } from "../data/tuning";
import { damageEnemy, rollOutgoing } from "./combat";
import { shake, spawnBurst, spawnLine, spawnRing } from "./effects";
import { circlesOverlap } from "./physics";

/** 状態異常（burn / chill / shock / explodeOnKill）。docs/LOOT_DESIGN.md のアフィックスに対応 */

const BURN_PARTICLE_SPEED = 30;
const BURN_PARTICLE_LIFE = 0.35;
const EXPLODE_PARTICLES = 24;
const EXPLODE_SPEED = 180;
const SHOCK_PARTICLES = 4;

export function createEnemyEffects(): EnemyEffects {
  return {
    burn: { time: 0, dps: 0, acc: 0 },
    chill: { time: 0, slow: 0 },
  };
}

/** chill 中の時間倍率（移動と phaseTimer の進行に掛ける） */
export function chillFactor(enemy: Enemy): number {
  const c = enemy.effects.chill;
  if (c.time <= 0) return 1;
  return 1 - Math.min(STATUS.maxSlow, c.slow);
}

/** 近接 / 射撃ヒット時に stats の確率で状態異常を付ける */
export function applyOnHitStatus(state: GameState, enemy: Enemy): void {
  const s = state.stats;
  if (enemy.hp > 0 && s.burnChance > 0 && s.burnDps > 0 && state.rng.chance(s.burnChance)) {
    applyBurn(state, enemy, s.burnDps, STATUS.burnDuration);
  }
  if (enemy.hp > 0 && s.chillChance > 0 && s.chillSlow > 0 && state.rng.chance(s.chillChance)) {
    applyChill(state, enemy, s.chillSlow, STATUS.chillDuration);
  }
  if (s.shockChance > 0 && s.shockDamage > 0 && state.rng.chance(s.shockChance)) {
    chainLightning(state, enemy.body.pos, s.shockDamage, enemy.id);
  }
}

/** burn: 強い方の dps を採用し、持続は延長する */
export function applyBurn(state: GameState, enemy: Enemy, dps: number, duration: number): void {
  if (enemy.hp <= 0) return;
  const b = enemy.effects.burn;
  b.dps = b.time > 0 ? Math.max(b.dps, dps) : dps;
  b.time = Math.max(b.time, duration);
  pushSfx(state, "burn");
}

export function applyChill(state: GameState, enemy: Enemy, slow: number, duration: number): void {
  if (enemy.hp <= 0) return;
  const c = enemy.effects.chill;
  c.slow = c.time > 0 ? Math.max(c.slow, slow) : slow;
  c.time = Math.max(c.time, duration);
  spawnBurst(state, enemy.body.pos, STATUS.chillColor, 5, 50, 0.3, 1.5);
  pushSfx(state, "freeze");
}

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
    spawnLine(state, from, next.body.pos, STATUS.shockColor, STATUS.fxLife);
    spawnBurst(state, next.body.pos, STATUS.shockColor, SHOCK_PARTICLES, 60, 0.2, 1.5);
    const out = rollOutgoing(state, next, damage, "proc");
    from = { ...next.body.pos };
    damageEnemy(state, next, out.amount, sub(next.body.pos, origin), 0, { hitstopSteps: 0 });
    jumps += 1;
  }
  if (jumps > 0) pushSfx(state, "shock");
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

/** burn の継続ダメージと各効果の時間経過 */
export function updateStatusEffects(state: GameState, dt: number): void {
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    tickChill(e, dt);
    tickBurn(state, e, dt);
  }
}

function tickChill(e: Enemy, dt: number): void {
  const c = e.effects.chill;
  if (c.time <= 0) return;
  c.time = Math.max(0, c.time - dt);
  if (c.time === 0) c.slow = 0;
}

function tickBurn(state: GameState, e: Enemy, dt: number): void {
  const b = e.effects.burn;
  if (b.time <= 0) return;
  const t = Math.min(dt, b.time);
  b.time -= t;
  b.acc += b.dps * t;
  if (state.tick % STATUS.burnParticleInterval === 0) {
    spawnBurst(state, e.body.pos, STATUS.burnColor, 1, BURN_PARTICLE_SPEED, BURN_PARTICLE_LIFE, 1.5);
  }
  // 端数は貯めて整数ぶんだけ減らす（数字は出さず HP バーだけ減る）
  const whole = Math.floor(b.acc);
  if (whole >= 1) {
    b.acc -= whole;
    damageEnemy(state, e, whole, { x: 0, y: 0 }, 0, { silent: true });
  }
  if (b.time <= 0) {
    b.time = 0;
    b.dps = 0;
    b.acc = 0;
  }
}
