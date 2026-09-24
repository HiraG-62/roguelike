import { type GameState, allocId, pushSfx } from "../core/state";
import { type Vec, add, dist, fromAngle, length, normalize, scale, sub } from "../core/vec";
import { applyChill, chainLightning, enemiesInRadius } from "../system/statusEffects";
import { shake, spawnBurst, spawnLine, spawnRing } from "../system/effects";
import { circlesOverlap, moveBody, overlapsWall } from "../system/physics";
import { STATUS } from "../data/tuning";
import { SKILL } from "./data";
import { COMBO_TUNING } from "./tuning";
import { skillHit, skillPower } from "./hit";
import { terrainAt } from "../system/terrain";
import type { CastParams } from "./types";

/**
 * 設置・飛翔系スキルの実体（雷撃・引力球・地雷・氷結地帯・回転弾幕の弾）。
 * 発動は system/skills.ts、毎フレームの更新は updatePlacedSkills から。
 */

export const COLOR_THUNDER = "#ffff60";
export const COLOR_WELL = "#a070ff";
export const COLOR_MINE = "#ff9040";
export const COLOR_FROST = "#80d0ff";
export const COLOR_BULLET = "#60ffe0";

const RING_LIFE = 0.2;
const BOLT_HEIGHT = 70;
const BOLT_LIFE = 0.15;
const THUNDER_PARTICLES = 14;
const BURST_SPEED = 150;
const BURST_LIFE = 0.35;
const BURST_SIZE = 2;
const WELL_PARTICLE_EVERY = 2;
const WELL_PARTICLE_SPEED = 20;
const MINE_PARTICLES = 18;
const MINE_FIZZLE_PARTICLES = 5;
const FIELD_PARTICLE_EVERY = 4;
const SHAKE_PLACED = 3;
/** 引力球: ボスは引きにくい */
const BOSS_PULL_MUL = 0.3;
/** 引力球: 敵弾の引き込みは敵本体より弱い */
const BULLET_PULL_MUL = 0.5;
const BULLET_WALL_PAD = 1;
const FULL_TURN = Math.PI * 2;

// ---------------------------------------------------------------------------
// 半径（HUD と共有）
// ---------------------------------------------------------------------------

export function thunderRadius(params: Readonly<CastParams>): number {
  return SKILL.thunder.radius * params.areaMul;
}

export function wellRadius(params: Readonly<CastParams>): number {
  return SKILL.gravityWell.radius * params.areaMul;
}

export function mineRadius(params: Readonly<CastParams>): number {
  return SKILL.mines.radius * params.areaMul;
}

export function fieldRadius(params: Readonly<CastParams>): number {
  return SKILL.frostField.radius * params.areaMul;
}

/** 地雷の同時設置上限（回数の変異で増減） */
export function maxMines(params: Readonly<CastParams>): number {
  return Math.max(1, SKILL.mines.maxAlive + params.countBonus);
}

/** 氷結地帯のどれかに立っているか（自分も遅くなる） */
export function playerInFrost(state: GameState): boolean {
  const p = state.player.body;
  return state.skills.fields.some((f) => circlesOverlap(f.pos.x, f.pos.y, fieldRadius(f.params), p.pos.x, p.pos.y, 0));
}

// ---------------------------------------------------------------------------
// 設置
// ---------------------------------------------------------------------------

/** 連携「渦雷」（引力球 → 雷撃）: 感電を 1 つ多く付ける */
const WELL_THUNDER_APPLIES = [
  {
    kind: "shock",
    stacks: SKILL.thunder.shockStacks + COMBO_TUNING.wellThunder.shockBonus,
    duration: STATUS.shock.duration,
    potency: SKILL.thunder.shockPotency,
  },
] as const;

/**
 * 連携「渦雷」: 雷の落下点を最寄りの引力球の中心へ吸い寄せ、半径を球の大きさまで広げる。
 * 成立していなければ照準地点と params をそのまま返す
 */
export function wellThunderTarget(state: GameState, target: Vec, params: CastParams): { target: Vec; params: CastParams } {
  if (params.combo !== "wellThunder") return { target, params };
  let best = state.skills.wells[0];
  for (const w of state.skills.wells) if (best && dist(w.pos, target) < dist(best.pos, target)) best = w;
  if (!best) return { target, params };
  const areaMul = Math.max(params.areaMul, wellRadius(best.params) / SKILL.thunder.radius);
  return { target: { ...best.pos }, params: { ...params, areaMul, countBonus: 0 } };
}

/** 雷撃: 中心に 1 本、回数ぶん周囲へ時間差で追加 */
export function placeStrikes(state: GameState, target: Vec, params: CastParams): void {
  const t = SKILL.thunder;
  const count = Math.max(1, 1 + params.countBonus);
  const delay = t.delay * params.timeMul;
  for (let i = 0; i < count; i++) {
    const pos = i === 0 ? { ...target } : add(target, scale(fromAngle((FULL_TURN * (i - 1)) / (count - 1)), t.extraOffset));
    const safe = overlapsWall(state, pos.x, pos.y, 0) ? { ...target } : pos;
    const timer = delay + i * t.extraGap;
    state.skills.strikes.push({ pos: safe, timer, total: timer, params });
  }
}

export function spawnWell(state: GameState, target: Vec, params: CastParams): void {
  const total = SKILL.gravityWell.duration * params.durationMul;
  state.skills.wells.push({ pos: { ...target }, timer: total, total, tick: 0, params });
  spawnRing(state, target, wellRadius(params), COLOR_WELL, RING_LIFE);
}

/** 地雷: 上限を超えたら古いものから不発で消える。投げ込み（型替え）は着いた瞬間に爆発する */
export function placeMine(state: GameState, pos: Vec, params: CastParams): void {
  if (params.reshape === "toLobbed") {
    explodeMine(state, pos, params);
    return;
  }
  const rs = state.skills;
  // 起動の遅れは速度（timeMul）、残る時間は延長（durationMul）で変わる
  rs.mines.push({ id: allocId(state), pos: { ...pos }, arm: SKILL.mines.arm * params.timeMul, life: SKILL.mines.life * params.durationMul, params });
  const limit = maxMines(params);
  while (rs.mines.length > limit) {
    const old = rs.mines.shift();
    if (old) spawnBurst(state, old.pos, COLOR_MINE, MINE_FIZZLE_PARTICLES, WELL_PARTICLE_SPEED, BURST_LIFE, BURST_SIZE);
  }
}

export function spawnField(state: GameState, target: Vec, params: CastParams): void {
  const total = SKILL.frostField.duration * params.durationMul;
  state.skills.fields.push({ pos: { ...target }, timer: total, total, tick: 0, params });
  spawnRing(state, target, fieldRadius(params), COLOR_FROST, RING_LIFE);
  pushSfx(state, "freeze");
}

/** 回転弾幕の 1 発 */
export function spawnBullet(state: GameState, from: Vec, dir: Vec, params: CastParams): void {
  const s = SKILL.spiral;
  state.skills.bullets.push({
    pos: { ...from },
    vel: scale(dir, s.speed),
    life: s.life * params.areaMul,
    params,
    hitIds: new Set(),
    pierceLeft: params.pierce,
  });
}

// ---------------------------------------------------------------------------
// 更新
// ---------------------------------------------------------------------------

export function updatePlacedSkills(state: GameState, dt: number): void {
  updateStrikes(state, dt);
  updateWells(state, dt);
  updateMines(state, dt);
  updateFields(state, dt);
  updateMires(state, dt);
  updateBullets(state, dt);
}

function updateStrikes(state: GameState, dt: number): void {
  const rs = state.skills;
  for (const s of rs.strikes) {
    s.timer -= dt;
    if (s.timer <= 0) strike(state, s.pos, s.params);
  }
  rs.strikes = rs.strikes.filter((s) => s.timer > 0);
}

function strike(state: GameState, pos: Vec, params: CastParams): void {
  const t = SKILL.thunder;
  const radius = thunderRadius(params);
  spawnLine(state, { x: pos.x, y: pos.y - BOLT_HEIGHT }, pos, COLOR_THUNDER, BOLT_LIFE);
  spawnRing(state, pos, radius, COLOR_THUNDER, RING_LIFE);
  spawnBurst(state, pos, COLOR_THUNDER, THUNDER_PARTICLES, BURST_SPEED, BURST_LIFE, BURST_SIZE);
  shake(state, SHAKE_PLACED);
  pushSfx(state, "shock");
  const power = skillPower(state, t.damage, params);
  const applies = params.combo === "wellThunder" ? WELL_THUNDER_APPLIES : undefined;
  let first: number | null = null;
  for (const e of enemiesInRadius(state, pos, radius)) {
    first ??= e.id;
    skillHit(state, e, params, { base: power, kind: "ranged", dir: sub(e.body.pos, pos), knockback: 0, stagger: true, applies, from: pos });
  }
  if (first !== null) chainLightning(state, pos, power * t.shockMul, first);
}

function updateWells(state: GameState, dt: number): void {
  const rs = state.skills;
  const g = SKILL.gravityWell;
  for (const w of rs.wells) {
    w.timer -= dt;
    w.tick -= dt;
    const radius = wellRadius(w.params);
    pullInto(state, w.pos, radius, g.pull * w.params.potencyMul * dt);
    if (state.tick % WELL_PARTICLE_EVERY === 0) wellParticle(state, w.pos, radius);
    if (w.tick <= 0) {
      w.tick = g.tickEvery;
      const power = skillPower(state, g.tickDamage, w.params);
      // tick は怯ませず、引いている間の沈黙だけを付け直す（怯み値は破裂で入れる）
      for (const e of enemiesInRadius(state, w.pos, radius)) {
        skillHit(state, e, w.params, { base: power, kind: "ranged", dir: sub(w.pos, e.body.pos), knockback: 0, stagger: false, poise: 0 });
      }
    }
    if (w.timer <= 0) collapseWell(state, w.pos, radius, w.params);
  }
  rs.wells = rs.wells.filter((w) => w.timer > 0);
}

function pullInto(state: GameState, center: Vec, radius: number, amount: number): void {
  const core = SKILL.gravityWell.core;
  for (const e of enemiesInRadius(state, center, radius)) {
    const delta = sub(center, e.body.pos);
    const d = length(delta);
    if (d <= core) continue;
    const mul = state.boss?.enemyId === e.id ? BOSS_PULL_MUL : 1;
    const step = scale(normalize(delta), Math.min(amount * mul, d - core));
    moveBody(state, e.body, step.x, step.y);
  }
  // 敵弾も集まる（中心が弾幕になるリスク）
  for (const pr of state.projectiles) {
    if (pr.owner !== "enemy" || pr.life <= 0) continue;
    const delta = sub(center, pr.pos);
    const d = length(delta);
    if (d > radius || d <= core) continue;
    pr.pos = add(pr.pos, scale(normalize(delta), Math.min(amount * BULLET_PULL_MUL, d - core)));
  }
}

function wellParticle(state: GameState, center: Vec, radius: number): void {
  const a = state.rng.next() * FULL_TURN;
  const from = add(center, scale(fromAngle(a), radius));
  spawnBurst(state, from, COLOR_WELL, 1, WELL_PARTICLE_SPEED, BURST_LIFE, BURST_SIZE / 2);
}

function collapseWell(state: GameState, pos: Vec, radius: number, params: CastParams): void {
  const g = SKILL.gravityWell;
  spawnRing(state, pos, radius, COLOR_WELL, RING_LIFE * 2);
  spawnBurst(state, pos, COLOR_WELL, THUNDER_PARTICLES, BURST_SPEED, BURST_LIFE, BURST_SIZE);
  shake(state, SHAKE_PLACED);
  pushSfx(state, "explode");
  const power = skillPower(state, g.burstDamage, params);
  for (const e of enemiesInRadius(state, pos, radius)) {
    skillHit(state, e, params, { base: power, kind: "ranged", dir: sub(e.body.pos, pos), knockback: g.burstKnockback, stagger: true, applies: null });
  }
}

function updateMines(state: GameState, dt: number): void {
  const rs = state.skills;
  const m = SKILL.mines;
  const blown = new Set<number>();
  for (const mine of rs.mines) {
    mine.arm = Math.max(0, mine.arm - dt);
    mine.life -= dt;
    if (mine.arm > 0) continue;
    const stepped = state.enemies.some(
      (e) =>
        e.hp > 0 &&
        e.phase !== "spawning" &&
        circlesOverlap(mine.pos.x, mine.pos.y, m.trigger, e.body.pos.x, e.body.pos.y, e.body.radius),
    );
    if (!stepped) continue;
    blown.add(mine.id);
    explodeMine(state, mine.pos, mine.params);
  }
  rs.mines = rs.mines.filter((mine) => mine.life > 0 && !blown.has(mine.id));
}

function explodeMine(state: GameState, pos: Vec, params: CastParams): void {
  const m = SKILL.mines;
  const radius = mineRadius(params);
  spawnRing(state, pos, radius, COLOR_MINE, RING_LIFE * 2);
  spawnBurst(state, pos, COLOR_MINE, MINE_PARTICLES, BURST_SPEED, BURST_LIFE, BURST_SIZE);
  shake(state, SHAKE_PLACED);
  pushSfx(state, "explode");
  const power = skillPower(state, m.damage, params);
  for (const e of enemiesInRadius(state, pos, radius)) {
    skillHit(state, e, params, { base: power, kind: "ranged", dir: sub(e.body.pos, pos), knockback: m.knockback, stagger: true });
  }
}

function updateFields(state: GameState, dt: number): void {
  const rs = state.skills;
  const f = SKILL.frostField;
  for (const field of rs.fields) {
    field.timer -= dt;
    field.tick -= dt;
    const radius = fieldRadius(field.params);
    if (state.tick % FIELD_PARTICLE_EVERY === 0) wellParticle(state, field.pos, radius * state.rng.next());
    if (field.tick > 0) continue;
    field.tick = f.tickEvery;
    const slow = Math.min(f.maxSlow, f.slow * field.params.potencyMul);
    const power = skillPower(state, f.tickDamage, field.params);
    for (const e of enemiesInRadius(state, field.pos, radius)) {
      // 冷気 1 / tick は applyChill 経由（L3 が中身を applyStatus へ移す。SkillDef.applies と二重に付けない）
      applyChill(state, e, slow, f.chillTime);
      skillHit(state, e, field.params, { base: power, kind: "ranged", dir: sub(e.body.pos, field.pos), knockback: 0, stagger: false });
    }
  }
  rs.fields = rs.fields.filter((field) => field.timer > 0);
}

/**
 * 泥沼: 周期ごとに、領域の中で泥の上に立っている敵へ小さな命中（怯み値つき）。
 * 泥が燃えて固まった・別の地形で上書きされたマスの敵には入らない。階を移った領域は捨てる
 */
function updateMires(state: GameState, dt: number): void {
  const zones = state.skills.mires;
  if (!zones || zones.length === 0) return;
  const m = SKILL.mire;
  for (const z of zones) {
    if (z.map !== state.map) {
      z.timer = 0;
      continue;
    }
    z.timer -= dt;
    z.tick -= dt;
    if (z.tick > 0) continue;
    z.tick = m.tickEvery;
    const power = skillPower(state, m.tickDamage, z.params);
    for (const e of enemiesInRadius(state, z.pos, m.radius * z.params.areaMul)) {
      if (terrainAt(state, e.body.pos.x, e.body.pos.y) !== "mud") continue;
      skillHit(state, e, z.params, { base: power, kind: "ranged", dir: { x: 0, y: 0 }, knockback: 0, stagger: false, poise: m.tickPoise, applies: null, from: z.pos });
    }
  }
  state.skills.mires = zones.filter((z) => z.timer > 0);
}

function updateBullets(state: GameState, dt: number): void {
  const rs = state.skills;
  const s = SKILL.spiral;
  for (const b of rs.bullets) {
    b.pos = add(b.pos, scale(b.vel, dt));
    b.life -= dt;
    if (overlapsWall(state, b.pos.x, b.pos.y, BULLET_WALL_PAD)) {
      b.life = 0;
      continue;
    }
    for (const e of state.enemies) {
      if (b.life <= 0) break;
      if (e.hp <= 0 || e.phase === "spawning" || b.hitIds.has(e.id)) continue;
      if (dist(b.pos, e.body.pos) > e.body.radius + s.radius) continue;
      b.hitIds.add(e.id);
      skillHit(state, e, b.params, { base: skillPower(state, s.damage, b.params), kind: "ranged", dir: b.vel, knockback: s.knockback, stagger: false });
      if (b.pierceLeft > 0) b.pierceLeft -= 1;
      else b.life = 0;
    }
  }
  rs.bullets = rs.bullets.filter((b) => b.life > 0);
}
