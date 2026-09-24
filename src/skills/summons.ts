import { type GameState, allocId, pushSfx } from "../core/state";
import { type Vec, add, angle, dist, fromAngle, length, normalize, scale, sub } from "../core/vec";
import { shake, spawnBurst, spawnRing } from "../system/effects";
import { gainMana } from "../system/mana";
import { circlesOverlap, overlapsWall } from "../system/physics";
import { enemiesInRadius } from "../system/statusEffects";
import { SKILL } from "./data";
import { angleDiff } from "./geom";
import { skillHit, skillPower } from "./hit";
import { spawnShot } from "./shots";
import type { BoneRing, CastParams, GraveSword, PowderKeg } from "./types";

/**
 * 大拡張の設置物・連動体（爆薬樽・剣の墓標・砲台・骨片の輪・湧き石）。
 * 連動体は自分では攻撃しない。プレイヤーの近接 3 段目（墓標）・振り（砲台。銃の弾だけでなく近接の振りにも合わせる）に合わせてだけ動く（ヴァンサバ化しない）。
 */

export const COLOR_KEG = "#c07030";
export const COLOR_GRAVE = "#d0d0e0";
export const COLOR_TURRET = "#80c0ff";
export const COLOR_BONE = "#f0f0d0";
export const COLOR_SPRING = "#4aa0ff";

const RING_LIFE = 0.2;
const FIZZLE_PARTICLES = 5;
const FIZZLE_SPEED = 20;
const FIZZLE_LIFE = 0.35;
const BURST_PARTICLES = 20;
const BURST_SPEED = 170;
const BURST_LIFE = 0.4;
const BURST_SIZE = 2.5;
const SHAKE_KEG = 4;
const SPIN_PARTICLES = 6;
const FULL_TURN = Math.PI * 2;
const MANA_PARTICLE_SPEED = 25;

// ---------------------------------------------------------------------------
// 爆薬樽
// ---------------------------------------------------------------------------

export function kegRadius(params: Readonly<CastParams>): number {
  return SKILL.powderKeg.radius * params.areaMul;
}

function maxKegs(params: Readonly<CastParams>): number {
  return Math.max(1, SKILL.powderKeg.maxAlive + params.countBonus);
}

/** 置く。上限を超えたら古いものから不発で消える。投げ込み（型替え）は着いた瞬間に爆発する */
export function placeKeg(state: GameState, pos: Vec, params: CastParams): void {
  if (params.reshape === "toLobbed") {
    explodeKeg(state, pos, params);
    return;
  }
  const rs = state.skills;
  rs.kegs.push({ id: allocId(state), pos: { ...pos }, vel: { x: 0, y: 0 }, rollLeft: 0, life: SKILL.powderKeg.life * params.durationMul, params });
  const limit = maxKegs(params);
  while (rs.kegs.length > limit) {
    const old = rs.kegs.shift();
    if (old) spawnBurst(state, old.pos, COLOR_KEG, FIZZLE_PARTICLES, FIZZLE_SPEED, FIZZLE_LIFE, BURST_SIZE);
  }
}

export function updateKegs(state: GameState, dt: number): void {
  const rs = state.skills;
  const blown = new Set<number>();
  for (const k of rs.kegs) {
    if (blown.has(k.id)) continue;
    k.life -= dt;
    if (kegTriggered(state, k, dt)) {
      blown.add(k.id);
      detonate(state, k, blown);
    }
  }
  rs.kegs = rs.kegs.filter((k) => k.life > 0 && !blown.has(k.id));
}

/** 起爆条件: 転がって何かに当たった / 撃たれた / 敵弾が当たった。近接で叩かれたら転がり始める */
function kegTriggered(state: GameState, k: PowderKeg, dt: number): boolean {
  if (k.rollLeft > 0) return rollKeg(state, k, dt);
  if (shotHitsKeg(state, k)) return true;
  if (meleeHitsKeg(state, k)) {
    const kp = SKILL.powderKeg;
    k.vel = scale(normalize(state.player.attack.dir, state.player.facing), kp.rollSpeed);
    k.rollLeft = kp.rollTime;
    pushSfx(state, "hit");
  }
  return false;
}

/** 転がる。壁・敵に当たるか転がり終えたら起爆 */
function rollKeg(state: GameState, k: PowderKeg, dt: number): boolean {
  k.rollLeft -= dt;
  const next = add(k.pos, scale(k.vel, dt));
  if (overlapsWall(state, next.x, next.y, SKILL.powderKeg.size)) return true;
  k.pos = next;
  const size = SKILL.powderKeg.size;
  const touched = state.enemies.some(
    (e) => e.hp > 0 && e.phase !== "spawning" && circlesOverlap(k.pos.x, k.pos.y, size, e.body.pos.x, e.body.pos.y, e.body.radius),
  );
  return touched || k.rollLeft <= 0;
}

/** 自分の射撃弾・スキルの弾・敵弾が当たったか（当たった弾は消える） */
function shotHitsKeg(state: GameState, k: PowderKeg): boolean {
  const size = SKILL.powderKeg.size;
  for (const pr of state.projectiles) {
    if (pr.life <= 0 || !circlesOverlap(k.pos.x, k.pos.y, size, pr.pos.x, pr.pos.y, pr.radius)) continue;
    pr.life = 0;
    return true;
  }
  for (const s of state.skills.shots) {
    if (s.life <= 0 || !circlesOverlap(k.pos.x, k.pos.y, size, s.pos.x, s.pos.y, s.radius)) continue;
    s.life = 0;
    return true;
  }
  return false;
}

/** 近接の当たり（振りの active 中、攻撃の向きの前方・近接の届く距離） */
function meleeHitsKeg(state: GameState, k: PowderKeg): boolean {
  const p = state.player;
  if (p.attack.phase !== "active") return false;
  const kp = SKILL.powderKeg;
  const to = sub(k.pos, p.body.pos);
  if (length(to) > kp.meleeReach * state.stats.meleeReachMul + kp.size) return false;
  return Math.abs(angleDiff(angle(to), angle(p.attack.dir))) <= kp.meleeHalfAngle;
}

/** 起爆。爆風に入った他の樽も連鎖して爆発する */
function detonate(state: GameState, k: PowderKeg, blown: Set<number>): void {
  explodeKeg(state, k.pos, k.params);
  const radius = kegRadius(k.params);
  for (const other of state.skills.kegs) {
    if (blown.has(other.id) || dist(other.pos, k.pos) > radius) continue;
    blown.add(other.id);
    detonate(state, other, blown);
  }
}

export function explodeKeg(state: GameState, pos: Vec, params: CastParams): void {
  const kp = SKILL.powderKeg;
  const radius = kegRadius(params);
  spawnRing(state, pos, radius, COLOR_KEG, RING_LIFE * 2);
  spawnBurst(state, pos, "#ffb060", BURST_PARTICLES, BURST_SPEED, BURST_LIFE, BURST_SIZE);
  shake(state, SHAKE_KEG);
  pushSfx(state, "explode");
  const power = skillPower(state, kp.damage, params);
  for (const e of enemiesInRadius(state, pos, radius)) {
    skillHit(state, e, params, { base: power, kind: "ranged", dir: sub(e.body.pos, pos), knockback: kp.knockback, stagger: true, from: pos });
  }
}

// ---------------------------------------------------------------------------
// 剣の墓標
// ---------------------------------------------------------------------------

export function graveRadius(params: Readonly<CastParams>): number {
  return SKILL.swordGrave.radius * params.areaMul;
}

export function placeGrave(state: GameState, pos: Vec, params: CastParams): void {
  const g = SKILL.swordGrave;
  const rs = state.skills;
  const sword: GraveSword = { id: allocId(state), pos: { ...pos }, life: g.life * params.durationMul, spin: 0, params };
  rs.graves.push(sword);
  const limit = Math.max(1, g.maxAlive + params.countBonus);
  while (rs.graves.length > limit) rs.graves.shift();
  spawnRing(state, pos, graveRadius(params), COLOR_GRAVE, RING_LIFE);
  if (params.reshape === "toLobbed") spinGrave(state, sword);
}

/** 近接 3 段目の命中で、刺した剣がすべて回る（1 振りで 1 回） */
export function onGraveFinisher(state: GameState): void {
  for (const sword of state.skills.graves) {
    if (sword.spin > SKILL.swordGrave.spinShow - SKILL.swordGrave.spinGap) continue;
    spinGrave(state, sword);
  }
}

function spinGrave(state: GameState, sword: GraveSword): void {
  const g = SKILL.swordGrave;
  sword.spin = g.spinShow;
  const radius = graveRadius(sword.params);
  spawnRing(state, sword.pos, radius, COLOR_GRAVE, RING_LIFE);
  spawnBurst(state, sword.pos, COLOR_GRAVE, SPIN_PARTICLES, BURST_SPEED / 2, FIZZLE_LIFE, BURST_SIZE / 2);
  const power = skillPower(state, g.damage, sword.params);
  for (const e of enemiesInRadius(state, sword.pos, radius)) {
    skillHit(state, e, sword.params, { base: power, kind: "melee", dir: sub(e.body.pos, sword.pos), knockback: g.knockback, stagger: false, from: sword.pos });
  }
}

export function updateGraves(state: GameState, dt: number): void {
  const rs = state.skills;
  for (const sword of rs.graves) {
    sword.life -= dt;
    sword.spin = Math.max(0, sword.spin - dt);
  }
  rs.graves = rs.graves.filter((s) => s.life > 0);
}

// ---------------------------------------------------------------------------
// 砲台
// ---------------------------------------------------------------------------

export function placeTurret(state: GameState, pos: Vec, params: CastParams): void {
  const t = SKILL.turret;
  const rs = state.skills;
  const life = t.life * params.durationMul;
  rs.turrets.push({ id: allocId(state), pos: { ...pos }, life, total: life, params });
  const limit = Math.max(1, t.maxAlive + params.countBonus);
  while (rs.turrets.length > limit) rs.turrets.shift();
  spawnRing(state, pos, t.radius * 4, COLOR_TURRET, RING_LIFE);
}

/** 自分が射撃した瞬間に、各砲台が自分の向きの先を狙って 1 発撃つ */
export function onTurretShoot(state: GameState): void {
  const t = SKILL.turret;
  const p = state.player;
  const aim = add(p.body.pos, scale(p.facing, t.aimReach));
  for (const tur of state.skills.turrets) {
    spawnShot(state, tur.pos, sub(aim, tur.pos), tur.params, {
      effect: "turret",
      power: skillPower(state, t.damage, tur.params),
      speed: t.speed,
      life: t.shotLife,
      radius: t.radius,
      knockback: t.knockback,
    });
  }
}

export function updateTurrets(state: GameState, dt: number): void {
  const rs = state.skills;
  for (const tur of rs.turrets) tur.life -= dt;
  rs.turrets = rs.turrets.filter((tur) => tur.life > 0);
}

/**
 * 近接の振り（onSwing）に合わせて砲台も 1 発撃つ。銃を持たない近接ビルドだと onSkillPlayerShoot（射撃時）
 * だけでは砲台が沈黙するので、ステップの終わりにこちらも見る（system/rules.ts の resolveRules が
 * state.events を空にする直前、core/game.ts から 1 回呼ぶ）
 */
export function syncTurretShots(state: GameState): void {
  if (state.skills.turrets.length === 0) return;
  const swung = state.events.some((e) => e.kind === "onSwing" && e.actor === "player");
  if (swung) onTurretShoot(state);
}

// ---------------------------------------------------------------------------
// 骨片の輪
// ---------------------------------------------------------------------------

export function startBoneRing(state: GameState, params: CastParams): void {
  const b = SKILL.boneRing;
  const bones = Math.max(1, Math.round(b.bones * params.potencyMul) + params.countBonus);
  const time = b.duration * params.durationMul;
  state.skills.boneRing = { bones, timer: time, total: time, params };
}

/** 骨片 i の位置（HUD と共有） */
export function bonePositions(state: GameState, ring: Readonly<BoneRing>): Vec[] {
  const b = SKILL.boneRing;
  const base = state.skills.clock * b.spin;
  const out: Vec[] = [];
  for (let i = 0; i < ring.bones; i++) {
    out.push(add(state.player.body.pos, scale(fromAngle(base + (i * FULL_TURN) / ring.bones), b.orbit)));
  }
  return out;
}

export function updateBoneRing(state: GameState, dt: number): void {
  const rs = state.skills;
  const ring = rs.boneRing;
  if (!ring) return;
  ring.timer -= dt;
  catchWithBones(state, ring);
  if (ring.timer <= 0 || ring.bones <= 0) rs.boneRing = null;
}

/** 骨片に触れた敵弾を 1 発ずつ止める（止めた骨片は砕ける） */
function catchWithBones(state: GameState, ring: BoneRing): void {
  const b = SKILL.boneRing;
  for (const pr of state.projectiles) {
    if (ring.bones <= 0) return;
    if (pr.owner !== "enemy" || pr.life <= 0) continue;
    const hit = bonePositions(state, ring).find((pos) => dist(pos, pr.pos) <= pr.radius + b.catchRadius);
    if (!hit) continue;
    pr.life = 0;
    ring.bones -= 1;
    spawnBurst(state, hit, COLOR_BONE, FIZZLE_PARTICLES, BURST_SPEED / 2, FIZZLE_LIFE, BURST_SIZE / 2);
    pushSfx(state, "parry");
  }
}

// ---------------------------------------------------------------------------
// 湧き石
// ---------------------------------------------------------------------------

export function springRadius(params: Readonly<CastParams>): number {
  return SKILL.manaSpring.radius * params.areaMul;
}

/** 置く（同時に 1 つ。新しく置くと古いものは消える） */
export function placeSpring(state: GameState, pos: Vec, params: CastParams): void {
  const time = SKILL.manaSpring.duration * params.durationMul;
  state.skills.springs = [{ pos: { ...pos }, timer: time, total: time, params }];
  spawnRing(state, pos, springRadius(params), COLOR_SPRING, RING_LIFE);
}

/** 近接の命中ごと: 石の半径内に立っていればマナを余分に回収する */
export function onSpringMeleeHit(state: GameState): void {
  const p = state.player.body.pos;
  const spring = state.skills.springs.find((s) => dist(s.pos, p) <= springRadius(s.params));
  if (!spring) return;
  const gained = gainMana(state, SKILL.manaSpring.manaPerHit * spring.params.potencyMul);
  if (gained > 0) spawnBurst(state, p, COLOR_SPRING, 1, MANA_PARTICLE_SPEED, FIZZLE_LIFE, BURST_SIZE / 2);
}

export function updateSprings(state: GameState, dt: number): void {
  const rs = state.skills;
  for (const s of rs.springs) s.timer -= dt;
  rs.springs = rs.springs.filter((s) => s.timer > 0);
}
