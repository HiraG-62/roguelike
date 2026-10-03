import { type GameState, allocId, pushSfx } from "../core/state";
import { type Vec, add, dist, fromAngle, length, normalize, scale, sub } from "../core/vec";
import { applyChill, enemiesInRadius } from "../system/statusEffects";
import { addSkillFx, shake, spawnBlast, spawnBurst, spawnLine, spawnRing, withSkillFx } from "../system/effects";
import { circlesOverlap, moveBody } from "../system/physics";
import { blastMulAt } from "../system/blast";
import { BOON_LINEAGE } from "../data/tuning";
import { SKILL, SKILL_DEFS } from "./data";
import { castElement, skillHit, skillPower } from "./hit";
import { terrainAt } from "../system/terrain";
import type { CastParams } from "./types";
import { distToSegment } from "./geom";
import { FIXED_DT } from "../core/loop";
import { isAllied } from "../system/rules";
import { slashBase } from "../system/boonRules";
import { damageEnemy, rollOutgoing } from "../system/combat";

/**
 * 設置系スキルの実体（引力球・地雷・氷結地帯・泥沼）。
 * 発動は system/skills.ts、毎フレームの更新は updatePlacedSkills から。
 */

export const COLOR_WELL = "#a070ff";
export const COLOR_MINE = "#ff9040";
export const COLOR_FROST = "#80d0ff";

const RING_LIFE = 0.2;
const COLLAPSE_PARTICLES = 14;
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
const FULL_TURN = Math.PI * 2;

// ---------------------------------------------------------------------------
// 半径（HUD と共有）
// ---------------------------------------------------------------------------

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

export function spawnWell(state: GameState, target: Vec, params: CastParams): void {
  const total = SKILL.gravityWell.duration * params.durationMul;
  state.skills.wells.push({ pos: { ...target }, timer: total, total, tick: 0, params });
  withSkillFx(state, params.skillKey, () => spawnRing(state, target, wellRadius(params), COLOR_WELL, RING_LIFE));
  addSkillFx(state, params.skillKey, "cast", target, { size: wellRadius(params), element: castElement(params) });
}

/** 地雷: 上限を超えたら古いものから不発で消える。照準起点（型替え）は照準地点へ投げ込み、着いた瞬間に爆発する */
export function placeMine(state: GameState, pos: Vec, params: CastParams): void {
  if (params.reshape === "toLobbed") {
    explodeMine(state, pos, params);
    return;
  }
  const rs = state.skills;
  // 起動の遅れは速度（timeMul）、残る時間は持続（durationMul）で変わる
  rs.mines.push({ id: allocId(state), pos: { ...pos }, arm: SKILL.mines.arm * params.timeMul, life: SKILL.mines.life * params.durationMul, params });
  addSkillFx(state, params.skillKey, "cast", pos, { element: castElement(params) });
  const limit = maxMines(params);
  while (rs.mines.length > limit) {
    const old = rs.mines.shift();
    if (old) spawnBurst(state, old.pos, COLOR_MINE, MINE_FIZZLE_PARTICLES, WELL_PARTICLE_SPEED, BURST_LIFE, BURST_SIZE);
  }
}

export function spawnField(state: GameState, target: Vec, params: CastParams): void {
  const total = SKILL.frostField.duration * params.durationMul;
  state.skills.fields.push({ pos: { ...target }, timer: total, total, tick: 0, params });
  withSkillFx(state, "frostField", () => spawnRing(state, target, fieldRadius(params), COLOR_FROST, RING_LIFE));
  addSkillFx(state, "frostField", "cast", target, { size: fieldRadius(params), element: castElement(params) });
  pushSfx(state, "freeze");
}

// ---------------------------------------------------------------------------
// 更新
// ---------------------------------------------------------------------------

export function updatePlacedSkills(state: GameState, dt: number): void {
  updateWells(state, dt);
  updateMines(state, dt);
  updateFields(state, dt);
  updateMires(state, dt);
  followDash(state, dt);
  updateCrossfire(state);
}

/** 自分の設置物の位置（眷属の札が読む。決定性のため固定の順。system/rules.ts の minionCount と同じ置き場） */
function placedItems(state: GameState): { pos: Vec }[] {
  const rs = state.skills;
  return [...rs.kegs, ...rs.graves, ...rs.turrets, ...rs.mines, ...rs.wells, ...rs.fields, ...(rs.mires ?? []), ...rs.springs, ...rs.stakes, ...rs.traps];
}

/** 前のステップの出来事とみなす幅（刻みの 1.5 倍。浮動小数の誤差で 1 刻み前を取りこぼさない） */
const LAST_STEP_SLACK = 1.5;

/**
 * 歩く杭（眷属の加護）: ダッシュを終えた次のステップで、最も近い自分の設置物を足元へ移す。
 * ダッシュの終わりは updateSkills より後に積まれるので、state.recent の記録を 1 ステップ遅れで読む
 */
function followDash(state: GameState, dt: number): void {
  if (!state.boons.includes("walkingStake")) return;
  const ended = state.recent.onDashEnd;
  if (ended === undefined) return;
  const since = state.time - ended.lastTime;
  if (since <= 0 || since > dt * LAST_STEP_SLACK) return;
  const p = state.player.body.pos;
  let nearest: { pos: Vec } | undefined;
  for (const item of placedItems(state)) {
    if (nearest === undefined || dist(p, item.pos) < dist(p, nearest.pos)) nearest = item;
  }
  if (nearest === undefined) return;
  nearest.pos = { ...p };
  const w = BOON_LINEAGE.horde.walkingStake;
  spawnRing(state, p, w.ringRadius, w.color, w.fxLife);
}

/**
 * 十字砲火（眷属の摂理）: 自分の設置物どうしを結ぶ線（長さ maxLength まで）に触れた敵へ、interval 秒ごとに傷。
 * 1 回の刻みで同じ敵は 1 度だけ。従魔（味方にした敵）は傷つけない
 */
function updateCrossfire(state: GameState): void {
  if (!state.boons.includes("crossfire")) return;
  const c = BOON_LINEAGE.horde.crossfire;
  if (state.tick % Math.max(1, Math.round(c.interval / FIXED_DT)) !== 0) return;
  const items = placedItems(state);
  if (items.length < 2) return;
  const hit = new Set<number>();
  const damage = slashBase(state) * c.ratio;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]?.pos;
      const b = items[j]?.pos;
      if (a === undefined || b === undefined || dist(a, b) > c.maxLength) continue;
      spawnLine(state, a, b, c.color, c.fxLife);
      for (const e of state.enemies) {
        if (e.hp <= 0 || hit.has(e.id) || isAllied(state, e)) continue;
        if (distToSegment(e.body.pos, a, b) > e.body.radius + c.width) continue;
        hit.add(e.id);
        const out = rollOutgoing(state, e, damage, "proc");
        damageEnemy(state, e, out.amount, normalize(sub(e.body.pos, a)), 0, { hitstopSteps: 0 });
      }
    }
  }
}

function updateWells(state: GameState, dt: number): void {
  const rs = state.skills;
  const g = SKILL.gravityWell;
  for (const w of rs.wells) {
    w.timer -= dt;
    w.tick -= dt;
    const radius = wellRadius(w.params);
    pullInto(state, w.pos, radius, g.pull * w.params.potencyMul * dt);
    if (state.tick % WELL_PARTICLE_EVERY === 0) withSkillFx(state, w.params.skillKey, () => wellParticle(state, w.pos, radius));
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
  withSkillFx(state, params.skillKey, () => {
    spawnRing(state, pos, radius, COLOR_WELL, RING_LIFE * 2);
    spawnBurst(state, pos, COLOR_WELL, COLLAPSE_PARTICLES, BURST_SPEED, BURST_LIFE, BURST_SIZE);
  });
  addSkillFx(state, params.skillKey, "end", pos, { size: radius, element: castElement(params) });
  shake(state, SHAKE_PLACED);
  pushSfx(state, "explode");
  const power = skillPower(state, g.burstDamage, params);
  for (const e of enemiesInRadius(state, pos, radius)) {
    skillHit(state, e, params, { base: power, kind: "ranged", dir: sub(e.body.pos, pos), knockback: g.burstKnockback, stagger: true, applies: null, minion: true });
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
  withSkillFx(state, params.skillKey, () => {
    spawnBlast(state, pos, radius, COLOR_MINE, RING_LIFE * 2);
    spawnBurst(state, pos, COLOR_MINE, MINE_PARTICLES, BURST_SPEED, BURST_LIFE, BURST_SIZE);
  });
  addSkillFx(state, params.skillKey, "end", pos, { size: radius, element: castElement(params) });
  shake(state, SHAKE_PLACED);
  pushSfx(state, "explode");
  const power = skillPower(state, m.damage, params);
  const poise = SKILL_DEFS[params.skillKey].poise;
  for (const e of enemiesInRadius(state, pos, radius)) {
    const mul = blastMulAt(pos, radius, e.body.pos, e.body.radius);
    skillHit(state, e, params, { base: power * mul, kind: "ranged", dir: sub(e.body.pos, pos), knockback: m.knockback * mul, stagger: true, poise: poise * mul, minion: true });
  }
}

function updateFields(state: GameState, dt: number): void {
  const rs = state.skills;
  const f = SKILL.frostField;
  for (const field of rs.fields) {
    field.timer -= dt;
    field.tick -= dt;
    const radius = fieldRadius(field.params);
    if (state.tick % FIELD_PARTICLE_EVERY === 0) withSkillFx(state, "frostField", () => wellParticle(state, field.pos, radius * state.rng.next()));
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
  for (const field of rs.fields) {
    if (field.timer <= 0) addSkillFx(state, "frostField", "end", field.pos, { size: fieldRadius(field.params), element: castElement(field.params) });
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
      addSkillFx(state, "mire", "act", e.body.pos, { element: castElement(z.params) });
      skillHit(state, e, z.params, { base: power, kind: "ranged", dir: { x: 0, y: 0 }, knockback: 0, stagger: false, poise: m.tickPoise, applies: null, from: z.pos });
    }
  }
  state.skills.mires = zones.filter((z) => z.timer > 0);
}

/**
 * 鈴の打ち鳴らし（system/tomeBell.ts）: center から radius の内側に置いた設置物を今すぐ動かす。
 * 引力球・氷結地帯・泥沼は次の刻みを今にし、地雷はその場で起爆する。
 * 動かした数を返す
 */
export function tollPlaced(state: GameState, center: Vec, radius: number): number {
  const rs = state.skills;
  const near = (pos: Vec): boolean => dist(pos, center) <= radius;
  let count = 0;
  for (const w of rs.wells) {
    if (!near(w.pos)) continue;
    w.tick = 0;
    count += 1;
  }
  for (const f of rs.fields) {
    if (!near(f.pos)) continue;
    f.tick = 0;
    count += 1;
  }
  for (const z of rs.mires ?? []) {
    if (z.map !== state.map || !near(z.pos)) continue;
    z.tick = 0;
    count += 1;
  }
  // 起爆した地雷は次の更新で踏まれて二度爆ぜないよう、先に取り除いてから爆発させる
  const blown = rs.mines.filter((mine) => near(mine.pos));
  rs.mines = rs.mines.filter((mine) => !near(mine.pos));
  for (const mine of blown) explodeMine(state, mine.pos, mine.params);
  return count + blown.length;
}
