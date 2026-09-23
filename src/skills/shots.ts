import { type Enemy, type GameState, allocId, pushSfx } from "../core/state";
import { GOOD_STATUS_KINDS, NEUTRAL_STATUS_KINDS, type StatusApply, type StatusKind } from "../core/status";
import { type Vec, add, dist, normalize, scale } from "../core/vec";
import { STATUS } from "../data/tuning";
import { enemyDef } from "../data/enemies";
import { healPlayer } from "../system/combat";
import { addFloatingText, spawnBurst } from "../system/effects";
import { overlapsWall } from "../system/physics";
import { enemiesInRadius, findStatus, removeStatus } from "../system/statusEffects";
import { SKILL } from "./data";
import { skillHit, skillPower } from "./hit";
import type { CastParams, ShotEffect, SkillShot } from "./types";

/**
 * 大拡張の射撃弾（綻び・毒の収穫・追い討ち・剥奪・跳弾・風切り・散弾符・五彩の礫・砲台）。
 * 回転弾幕の弾（placed.ts の SkillBullet）とは別に持ち、命中の効果を ShotEffect で分ける。
 */

export const SHOT_COLOR: Record<ShotEffect, string> = {
  plain: "#e0e0ff",
  unravel: "#d080ff",
  harvest: "#80e040",
  rout: "#c0c0c0",
  strip: "#a0a0ff",
  ricochet: "#ffe080",
  gale: "#c0ffe0",
  scatter: "#ffc080",
  prism: "#ffffff",
  turret: "#80c0ff",
};

const WALL_PAD = 1;
const HIT_PARTICLES = 3;
const HIT_PARTICLE_SPEED = 40;
const HIT_PARTICLE_LIFE = 0.2;
const HIT_PARTICLE_SIZE = 1.5;
const TEXT_SCALE = 0.9;
const TEXT_LIFE = 0.5;
/** 風切り・手繰り糸のように「全員に当たる」弾の貫通数 */
export const PIERCE_ALL = 999;

export interface ShotSpec {
  effect: ShotEffect;
  power: number;
  speed: number;
  life: number;
  radius: number;
  knockback: number;
  color?: string;
  pierce?: number;
  bounces?: number;
  applies?: readonly StatusApply[] | null;
  heal?: number;
  volley?: Map<number, number>;
}

/** 弾を 1 発出す。貫通は刻印符の貫通（params.pierce）と spec の和 */
export function spawnShot(state: GameState, from: Vec, dir: Vec, params: CastParams, spec: ShotSpec): SkillShot {
  const shot: SkillShot = {
    id: allocId(state),
    effect: spec.effect,
    pos: { ...from },
    vel: scale(normalize(dir, state.player.facing), spec.speed),
    life: spec.life,
    radius: spec.radius,
    power: spec.power,
    knockback: spec.knockback,
    color: spec.color ?? SHOT_COLOR[spec.effect],
    params,
    hitIds: new Set(),
    pierceLeft: params.pierce + (spec.pierce ?? 0),
    bouncesLeft: spec.bounces ?? 0,
    bounced: 0,
    applies: spec.applies,
    heal: spec.heal ?? 0,
    volley: spec.volley,
  };
  state.skills.shots.push(shot);
  return shot;
}

/** 扇状に count 発。spread は隣り合う弾の角度差 */
export function spawnFan(state: GameState, from: Vec, dir: Vec, params: CastParams, count: number, spread: number, spec: (i: number) => ShotSpec): void {
  const base = Math.atan2(dir.y, dir.x);
  const center = (count - 1) / 2;
  for (let i = 0; i < count; i++) {
    const a = base + (i - center) * spread;
    spawnShot(state, from, { x: Math.cos(a), y: Math.sin(a) }, params, spec(i));
  }
}

export function updateShots(state: GameState, dt: number): void {
  const rs = state.skills;
  for (const s of rs.shots) {
    stepShot(state, s, dt);
    if (s.life <= 0) continue;
    if (s.effect === "gale") cutBullets(state, s);
    hitEnemies(state, s);
  }
  rs.shots = rs.shots.filter((s) => s.life > 0);
}

/** 移動と壁。跳弾は当たった軸の速度を反転して跳ね返る */
function stepShot(state: GameState, s: SkillShot, dt: number): void {
  s.life -= dt;
  const next = add(s.pos, scale(s.vel, dt));
  if (!overlapsWall(state, next.x, next.y, WALL_PAD)) {
    s.pos = next;
    return;
  }
  if (s.bouncesLeft <= 0) {
    s.life = 0;
    return;
  }
  const blockedX = overlapsWall(state, next.x, s.pos.y, WALL_PAD);
  const blockedY = overlapsWall(state, s.pos.x, next.y, WALL_PAD);
  s.vel = { x: blockedX || !blockedY ? -s.vel.x : s.vel.x, y: blockedY || !blockedX ? -s.vel.y : s.vel.y };
  s.bouncesLeft -= 1;
  s.bounced += 1;
  pushSfx(state, "wallHit");
}

/** 風切り: 触れた敵弾を消し、消すたびに射程が伸びる */
function cutBullets(state: GameState, s: SkillShot): void {
  const g = SKILL.galeSlash;
  const speed = Math.hypot(s.vel.x, s.vel.y);
  for (const pr of state.projectiles) {
    if (pr.owner !== "enemy" || pr.life <= 0) continue;
    if (dist(pr.pos, s.pos) > pr.radius + s.radius) continue;
    pr.life = 0;
    s.life += speed > 0 ? g.rangePerCut / speed : 0;
    spawnBurst(state, pr.pos, s.color, HIT_PARTICLES, HIT_PARTICLE_SPEED, HIT_PARTICLE_LIFE, HIT_PARTICLE_SIZE);
  }
}

function hitEnemies(state: GameState, s: SkillShot): void {
  for (const e of state.enemies) {
    if (s.life <= 0) return;
    if (e.hp <= 0 || e.phase === "spawning" || s.hitIds.has(e.id)) continue;
    if (dist(s.pos, e.body.pos) > e.body.radius + s.radius) continue;
    s.hitIds.add(e.id);
    hitShot(state, s, e);
    if (s.pierceLeft > 0) s.pierceLeft -= 1;
    else s.life = 0;
  }
}

/** 命中 1 回。効果ごとに威力・怯み値・付与を決め、消費系は敵の状態異常を外す */
function hitShot(state: GameState, s: SkillShot, e: Enemy): void {
  spawnBurst(state, e.body.pos, s.color, HIT_PARTICLES, HIT_PARTICLE_SPEED, HIT_PARTICLE_LIFE, HIT_PARTICLE_SIZE);
  switch (s.effect) {
    case "unravel":
      unravelHit(state, s, e);
      if (s.params.combo === "contagionUnravel") unravelAround(state, s, e);
      return;
    case "harvest":
      harvestHit(state, s, e);
      return;
    case "rout":
      routHit(state, s, e);
      return;
    case "strip":
      stripHit(state, s, e);
      return;
    case "ricochet":
      basicHit(state, s, e, s.power * (1 + SKILL.ricochet.bounceBonus * s.bounced));
      return;
    case "scatter":
      scatterHit(state, s, e);
      return;
    case "prism":
      basicHit(state, s, e, s.power);
      if (s.heal > 0) healPlayer(state, s.heal, { silent: true });
      return;
    case "plain":
    case "gale":
    case "turret":
      basicHit(state, s, e, s.power);
      return;
  }
}

function basicHit(state: GameState, s: SkillShot, e: Enemy, power: number, poise?: number): boolean {
  const kind = s.effect === "gale" ? "melee" : "ranged";
  return skillHit(state, e, s.params, { base: power, kind, dir: s.vel, knockback: s.knockback, stagger: false, poise, applies: s.applies, from: s.pos });
}

/** 状態異常の種類（良い状態・怯み・堅守を除く） */
export function harmfulKinds(e: Enemy): StatusKind[] {
  const kinds = new Set<StatusKind>();
  for (const eff of e.status.effects) {
    if (eff.time <= 0 || GOOD_STATUS_KINDS.has(eff.kind) || NEUTRAL_STATUS_KINDS.has(eff.kind)) continue;
    kinds.add(eff.kind);
  }
  return [...kinds];
}

/** 綻び: 状態異常をすべて外し、種類数ぶん威力と怯み値が伸びる */
function unravelHit(state: GameState, s: SkillShot, e: Enemy): void {
  const u = SKILL.unravel;
  const kinds = harmfulKinds(e);
  for (const k of kinds) removeStatus(state, { kind: "enemy", enemy: e }, k);
  const n = kinds.length;
  const power = s.power + skillPower(state, u.perKind, s.params) * n;
  if (n > 0) addFloatingText(state, e.body.pos, `綻び ${n}`, s.color, TEXT_SCALE, TEXT_LIFE);
  basicHit(state, s, e, power, n > 0 ? u.poise * n : u.poiseEmpty);
}

/** 伝染 → 綻びの連携: 周りの敵もまとめて綻ばせる（撃った弾の命中済みとして数える） */
function unravelAround(state: GameState, s: SkillShot, center: Enemy): void {
  for (const e of enemiesInRadius(state, center.body.pos, SKILL.unravel.comboRadius)) {
    if (e.id === center.id || s.hitIds.has(e.id)) continue;
    s.hitIds.add(e.id);
    unravelHit(state, s, e);
  }
}

/** 毒の収穫: 毒の残りダメージ（最大 HP 割合 × スタック × 残り秒）を即時に。ボスは弱い */
function harvestHit(state: GameState, s: SkillShot, e: Enemy): void {
  const poison = findStatus(e.status, "poison");
  if (!poison) {
    basicHit(state, s, e, s.power);
    return;
  }
  const ratio = poison.potency > 0 ? poison.potency : STATUS.poison.hpRatioPerSec;
  const bossMul = enemyDef(e.defKey).boss ? SKILL.harvest.bossMul : 1;
  const remaining = e.maxHp * ratio * poison.stacks * poison.time * bossMul;
  removeStatus(state, { kind: "enemy", enemy: e }, "poison");
  addFloatingText(state, e.body.pos, "収穫", s.color, TEXT_SCALE, TEXT_LIFE);
  basicHit(state, s, e, s.power + remaining);
}

/** 追い討ち: 恐怖を消して威力と怯み値を大きく */
function routHit(state: GameState, s: SkillShot, e: Enemy): void {
  const r = SKILL.rout;
  if (!findStatus(e.status, "fear")) {
    basicHit(state, s, e, s.power);
    return;
  }
  removeStatus(state, { kind: "enemy", enemy: e }, "fear");
  basicHit(state, s, e, s.power * r.fearDamageMul, r.poise * r.fearPoiseMul);
}

/** 剥奪: 弱体を奪い、その残り秒（上限あり）だけ自分の与ダメを上げる */
function stripHit(state: GameState, s: SkillShot, e: Enemy): void {
  const st = SKILL.strip;
  const weaken = findStatus(e.status, "weaken");
  basicHit(state, s, e, s.power);
  if (!weaken) return;
  const time = Math.min(st.maxBuffTime, weaken.time);
  removeStatus(state, { kind: "enemy", enemy: e }, "weaken");
  const buff = state.player.buffs.damage;
  state.player.buffs.damage = { time: Math.max(buff.time, time), mul: Math.max(buff.time > 0 ? buff.mul : 1, st.buffMul) };
  addFloatingText(state, state.player.body.pos, "剥奪", s.color, TEXT_SCALE, TEXT_LIFE);
}

/** 散弾符: 同じ斉射で 1 体に focusHits 発目が当たった瞬間、怯み値を上乗せ */
function scatterHit(state: GameState, s: SkillShot, e: Enemy): void {
  const sc = SKILL.scatterSigil;
  const volley = s.volley;
  const count = (volley?.get(e.id) ?? 0) + 1;
  volley?.set(e.id, count);
  const focus = count === sc.focusHits;
  basicHit(state, s, e, s.power, focus ? sc.poise * sc.focusPoiseMul : undefined);
}
