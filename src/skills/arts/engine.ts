import { ELEMENT_COLOR } from "../../core/element";
import { type Enemy, type GameState, pushSfx } from "../../core/state";
import { type Vec, add, fromAngle, length, normalize, scale, sub } from "../../core/vec";
import { enemyDef } from "../../data/enemies";
import { FEEL } from "../../data/tuning";
import { damageEnemy, healPlayer } from "../../system/combat";
import { spawnBlast, spawnBurst, spawnLine, spawnRing } from "../../system/effects";
import { gainMana } from "../../system/mana";
import { circlesOverlap, moveBody } from "../../system/physics";
import { applyStatus, enemiesInRadius, hasStatus, removeStatus } from "../../system/statusEffects";
import { placeTerrain } from "../../system/terrain";
import { detonateOwnMines } from "../../system/weaponArts";
import { type CastCtx, landingShock } from "../actions";
import { SKILL_DEFS } from "../data";
import { enemiesInCone, enemiesOnSegment, enemyNear, rayEnd } from "../geom";
import { applySkillStatuses, castAttack, skillHit, skillPower } from "../hit";
import { spawnFan } from "../shots";
import type { CastParams } from "../types";
import { ART_DEFS } from "./index";
import type { ArtSkillKey } from "./keys";
import type { ArtAct, ArtPending } from "./types";

/**
 * 技の発動（行為の列を出す）。docs/ideas/weapon-skills.md。
 * delay 0 の行為は撃った瞬間に出し、delay のある行為は SkillRunState.artQueue に積んで updateArtQueue が出す。
 * remote（反響・遅延・投げ刃・散り際・罠）ではプレイヤーを動かさず、発動地点・向きで出す。
 * 命中はすべて skills/hit.ts の skillHit を通す（刻印符の命中時の効果・使い込み・連携の記録が乗る）
 */

const DEG_TO_RAD = Math.PI / 180;
const RING_LIFE = 0.22;
const LINE_LIFE = 0.16;
const TELEGRAPH_MIN = 0.12;
const ARC_RAYS = 5;
const DASH_PARTICLES = 8;
const DASH_PARTICLE_SPEED = 60;
const DASH_PARTICLE_LIFE = 0.25;
const DASH_PARTICLE_SIZE = 2;
const BUFF_PARTICLES = 14;
const BUFF_PARTICLE_SPEED = 80;
const BUFF_PARTICLE_LIFE = 0.4;
const BUFF_PARTICLE_SIZE = 2;
const COLOR_BUFF = "#ffe080";
/** 帯に地形を置く間隔（地形の半径の何倍か） */
const TERRAIN_STEP_MUL = 2;
const MIN_TERRAIN_STEP = 8;

/** 1 回の行為の文脈 */
interface ActCtx {
  readonly key: ArtSkillKey;
  readonly params: CastParams;
  /** 行為を出す位置（起点とずらしを反映済み） */
  readonly pos: Vec;
  readonly dir: Vec;
  readonly remote: boolean;
}

function artColor(params: Readonly<CastParams>): string {
  return ELEMENT_COLOR[castAttack(params)?.element ?? "none"];
}

function rotate(dir: Vec, deg: number): Vec {
  if (deg === 0) return dir;
  return fromAngle(Math.atan2(dir.y, dir.x) + deg * DEG_TO_RAD);
}

function isBoss(e: Enemy): boolean {
  const def = enemyDef(e.defKey);
  return def.boss === true || def.bossPart === true;
}

/** 手動の発動（system/skills.ts の castNow / executeRemote から） */
export function castArt(state: GameState, key: ArtSkillKey, ctx: CastCtx): void {
  const art = ART_DEFS[key];
  art.acts.forEach((act, i) => {
    if (act.delay <= 0) {
      runAct(state, act, resolveCtx(state, key, act, ctx.params, ctx.origin, ctx.dir, ctx.target, ctx.remote, false));
      return;
    }
    const delay = act.delay * ctx.params.timeMul;
    queueOf(state).push({ timer: delay, key, act: i, params: ctx.params, origin: { ...ctx.origin }, dir: { ...ctx.dir }, target: { ...ctx.target }, remote: ctx.remote });
    if (act.anchor === "target") telegraph(state, act, ctx.params, ctx.target, delay);
  });
}

function queueOf(state: GameState): ArtPending[] {
  const rs = state.skills;
  if (!rs.artQueue) rs.artQueue = [];
  return rs.artQueue;
}

/** 遅れて落ちる行為の予兆（照準地点に落ちるものだけ） */
function telegraph(state: GameState, act: ArtAct, params: Readonly<CastParams>, at: Vec, life: number): void {
  const radius = act.kind === "ring" || act.kind === "pull" ? act.radius * params.areaMul : act.reach * params.areaMul;
  if (radius <= 0) return;
  spawnRing(state, at, radius, artColor(params), Math.max(TELEGRAPH_MIN, life));
}

/** 遅れて出る行為を進める（updateSkills から毎ステップ） */
export function updateArtQueue(state: GameState, dt: number): void {
  const q = state.skills.artQueue;
  if (!q || q.length === 0) return;
  const due: ArtPending[] = [];
  for (const p of q) {
    p.timer -= dt;
    if (p.timer <= 0) due.push(p);
  }
  if (due.length === 0) return;
  state.skills.artQueue = q.filter((p) => p.timer > 0);
  for (const p of due) {
    const act = ART_DEFS[p.key].acts[p.act];
    if (!act) continue;
    runAct(state, act, resolveCtx(state, p.key, act, p.params, p.origin, p.dir, p.target, p.remote, true));
  }
}

/**
 * 行為を出す位置と向き。自分起点は出る瞬間の自分（遅れて出る行為は出る瞬間の向き）、remote は発動地点、
 * 照準地点起点は撃った瞬間の照準地点。そこから ahead / side だけずらし、向きを angleDeg だけ回す
 */
function resolveCtx(
  state: GameState,
  key: ArtSkillKey,
  act: ArtAct,
  params: CastParams,
  origin: Vec,
  dir: Vec,
  target: Vec,
  remote: boolean,
  late: boolean,
): ActCtx {
  const p = state.player;
  const baseDir = normalize(remote || !late ? dir : p.facing, p.facing);
  const anchor = act.anchor === "target" ? target : remote ? origin : p.body.pos;
  const side = { x: -baseDir.y, y: baseDir.x };
  const pos = add(add(anchor, scale(baseDir, act.ahead)), scale(side, act.side));
  return { key, params, pos, dir: rotate(baseDir, act.angleDeg), remote };
}

function runAct(state: GameState, act: ArtAct, ctx: ActCtx): void {
  switch (act.kind) {
    case "arc":
      runArc(state, act, ctx);
      return;
    case "ring":
      runRing(state, act, ctx);
      return;
    case "line":
      runLine(state, act, ctx);
      return;
    case "dash":
      runDash(state, act, ctx);
      return;
    case "blink":
      runBlink(state, act, ctx);
      return;
    case "shot":
      runShot(state, act, ctx);
      return;
    case "chain":
      runChain(state, act, ctx);
      return;
    case "pull":
      runPull(state, act, ctx);
      return;
    case "buff":
      runBuff(state, act, ctx);
      return;
    case "detonate":
      detonateOwnMines(state);
      return;
  }
}

// ---------------------------------------------------------------------------
// 命中
// ---------------------------------------------------------------------------

/** 1 体へ当てる（狙う状態異常の倍率・多段・止め・消費を畳む）。与ダメを持たない行為は状態異常だけ付ける */
function strike(state: GameState, act: ArtAct, ctx: ActCtx, e: Enemy, from: Vec): void {
  const params = ctx.params;
  const matched = act.vs !== undefined && hasStatus(e.status, act.vs.status);
  const dir = normalize(sub(e.body.pos, from), ctx.dir);
  if (!act.damage) {
    applySkillStatuses(state, e, act.applies, params);
    return;
  }
  const kind = SKILL_DEFS[ctx.key].damageKind === "ranged" ? "ranged" : "melee";
  const base = skillPower(state, act.damage, params) * (matched && act.vs ? act.vs.mul : 1);
  const hits = act.hits > 1 ? act.hits + params.countBonus : act.hits;
  let killed = false;
  for (let i = 0; i < hits && !killed; i++) {
    if (act.heavy) e.wallSplat = true;
    killed = skillHit(state, e, params, {
      base,
      kind,
      dir,
      knockback: act.knockback,
      stagger: act.heavy,
      poise: act.poise,
      // 状態異常は 1 回目だけ（多段で重ねすぎない）
      applies: i === 0 ? act.applies : [],
      from,
    });
  }
  if (killed) return;
  if (matched && act.vs?.consume) removeStatus(state, { kind: "enemy", enemy: e }, act.vs.status);
  if (act.execute !== undefined && !isBoss(e) && e.hp <= e.maxHp * act.execute) {
    damageEnemy(state, e, e.hp, dir, 0, { hitstopSteps: FEEL.hitstopHeavy });
  }
}

function clearBullets(state: GameState, c: Vec, radius: number): void {
  for (const pr of state.projectiles) {
    if (pr.owner === "enemy" && circlesOverlap(c.x, c.y, radius, pr.pos.x, pr.pos.y, pr.radius)) pr.life = 0;
  }
}

function terrainAt(state: GameState, act: ArtAct, ctx: ActCtx, at: Vec): void {
  if (!act.terrain) return;
  const duration = act.terrain.duration === undefined ? undefined : act.terrain.duration * ctx.params.durationMul;
  placeTerrain(state, at.x, at.y, act.terrain.kind, act.terrain.radius * ctx.params.areaMul, duration);
}

/** 帯に沿って地形を置く */
function terrainAlong(state: GameState, act: ArtAct, ctx: ActCtx, from: Vec, to: Vec): void {
  if (!act.terrain) return;
  const d = length(sub(to, from));
  const step = Math.max(MIN_TERRAIN_STEP, act.terrain.radius * ctx.params.areaMul * TERRAIN_STEP_MUL);
  const dir = normalize(sub(to, from), ctx.dir);
  for (let t = 0; t <= d; t += step) terrainAt(state, act, ctx, add(from, scale(dir, t)));
}

// ---------------------------------------------------------------------------
// 形
// ---------------------------------------------------------------------------

function runArc(state: GameState, act: ArtAct, ctx: ActCtx): void {
  const reach = act.reach * ctx.params.areaMul;
  const half = (act.deg * DEG_TO_RAD) / 2;
  for (const e of enemiesInCone(state, ctx.pos, ctx.dir, reach, half)) strike(state, act, ctx, e, ctx.pos);
  if (act.clearsBullets) clearBullets(state, ctx.pos, reach);
  terrainAt(state, act, ctx, add(ctx.pos, scale(ctx.dir, reach / 2)));
  const color = artColor(ctx.params);
  const base = Math.atan2(ctx.dir.y, ctx.dir.x);
  for (let i = 0; i < ARC_RAYS; i++) {
    const a = base - half + (half * 2 * i) / (ARC_RAYS - 1);
    spawnLine(state, ctx.pos, add(ctx.pos, scale(fromAngle(a), reach)), color, LINE_LIFE);
  }
}

function runRing(state: GameState, act: ArtAct, ctx: ActCtx): void {
  const radius = act.radius * ctx.params.areaMul;
  for (const e of enemiesInRadius(state, ctx.pos, radius)) strike(state, act, ctx, e, ctx.pos);
  if (act.clearsBullets) clearBullets(state, ctx.pos, radius);
  terrainAt(state, act, ctx, ctx.pos);
  const color = artColor(ctx.params);
  if (act.anchor === "target") {
    spawnBlast(state, ctx.pos, radius, color);
    pushSfx(state, "explode");
    return;
  }
  spawnRing(state, ctx.pos, radius, color, RING_LIFE);
}

function runLine(state: GameState, act: ArtAct, ctx: ActCtx): void {
  const end = rayEnd(state, ctx.pos, ctx.dir, act.length * ctx.params.areaMul);
  for (const e of enemiesOnSegment(state, ctx.pos, end, (act.width * ctx.params.areaMul) / 2)) strike(state, act, ctx, e, ctx.pos);
  terrainAlong(state, act, ctx, ctx.pos, end);
  spawnLine(state, ctx.pos, end, artColor(ctx.params), LINE_LIFE);
}

/** 踏み込み（distance が負なら後ろへ）。通り道の敵に当て、終点に着地衝撃・地形 */
function runDash(state: GameState, act: ArtAct, ctx: ActCtx): void {
  const p = state.player;
  const back = act.distance < 0;
  const dir = back ? scale(ctx.dir, -1) : ctx.dir;
  const dist = Math.abs(act.distance);
  const start = { ...ctx.pos };
  let end: Vec;
  if (ctx.remote) {
    end = rayEnd(state, start, dir, dist);
  } else {
    moveBody(state, p.body, dir.x * dist, dir.y * dist);
    end = { ...p.body.pos };
    p.invulnTimer = Math.max(p.invulnTimer, act.invuln);
    pushSfx(state, "dash");
  }
  if (act.damage || act.applies.length > 0) {
    for (const e of enemiesOnSegment(state, start, end, (act.width * ctx.params.areaMul) / 2)) strike(state, act, ctx, e, start);
  }
  terrainAt(state, act, ctx, end);
  dashFx(state, start, end, artColor(ctx.params));
  landingShock(state, end, ctx.params);
}

function dashFx(state: GameState, from: Vec, to: Vec, color: string): void {
  spawnLine(state, from, to, color, LINE_LIFE);
  spawnBurst(state, to, color, DASH_PARTICLES, DASH_PARTICLE_SPEED, DASH_PARTICLE_LIFE, DASH_PARTICLE_SIZE);
}

/** 照準地点へ跳ぶ（壁の手前で止まる）。remote では跳ばない */
function runBlink(state: GameState, act: ArtAct, ctx: ActCtx): void {
  if (ctx.remote) return;
  const p = state.player;
  const from = { ...p.body.pos };
  const delta = sub(ctx.pos, from);
  moveBody(state, p.body, delta.x, delta.y);
  p.invulnTimer = Math.max(p.invulnTimer, act.invuln);
  dashFx(state, from, p.body.pos, artColor(ctx.params));
  pushSfx(state, "dash");
  landingShock(state, { ...p.body.pos }, ctx.params);
}

function runShot(state: GameState, act: ArtAct, ctx: ActCtx): void {
  const params = ctx.params;
  const count = act.count + params.countBonus;
  const power = act.damage ? skillPower(state, act.damage, params) : 0;
  const color = artColor(params);
  spawnFan(state, ctx.pos, ctx.dir, params, count, act.spreadDeg * DEG_TO_RAD, () => ({
    effect: act.shot,
    power,
    speed: act.speed,
    life: act.life,
    radius: act.bulletRadius * params.areaMul,
    knockback: act.knockback,
    color,
    pierce: act.pierce,
    bounces: act.bounces,
    applies: act.applies,
  }));
}

/** 連鎖: 起点に最も近い敵から、まだ当てていない近くの敵へ jumps 回跳ぶ */
function runChain(state: GameState, act: ArtAct, ctx: ActCtx): void {
  const first = enemyNear(state, ctx.pos, act.range);
  if (!first) return;
  const color = artColor(ctx.params);
  const hit = new Set<number>();
  let from = ctx.pos;
  let cur: Enemy | null = first;
  for (let i = 0; i <= act.jumps && cur; i++) {
    hit.add(cur.id);
    const at = { ...cur.body.pos };
    spawnLine(state, from, at, color, LINE_LIFE);
    strike(state, act, ctx, cur, from);
    from = at;
    cur = nearestUnhit(state, at, act.jumpRange * ctx.params.areaMul, hit);
  }
}

function nearestUnhit(state: GameState, pos: Vec, range: number, hit: ReadonlySet<number>): Enemy | null {
  let best: Enemy | null = null;
  let bestD = range;
  for (const e of state.enemies) {
    if (e.hp <= 0 || e.phase === "spawning" || hit.has(e.id)) continue;
    const d = length(sub(e.body.pos, pos)) - e.body.radius;
    if (d > bestD) continue;
    best = e;
    bestD = d;
  }
  return best;
}

/** 引き寄せ: 範囲の敵（ボスを除く）を起点の toDistance まで寄せてから当てる */
function runPull(state: GameState, act: ArtAct, ctx: ActCtx): void {
  const color = artColor(ctx.params);
  for (const e of enemiesInRadius(state, ctx.pos, act.radius * ctx.params.areaMul)) {
    if (!isBoss(e)) {
      const rel = sub(e.body.pos, ctx.pos);
      const d = length(rel);
      if (d > act.toDistance) {
        const move = scale(normalize(rel, ctx.dir), act.toDistance - d);
        const from = { ...e.body.pos };
        moveBody(state, e.body, move.x, move.y);
        spawnLine(state, from, e.body.pos, color, LINE_LIFE);
      }
    }
    if (act.damage || act.applies.length > 0) strike(state, act, ctx, e, ctx.pos);
  }
  spawnRing(state, ctx.pos, act.radius * ctx.params.areaMul, color, RING_LIFE);
}

/** 自己強化（remote では出ない）。倍率・回復・気力は効果量（potencyMul）、秒は持続（durationMul）で伸びる */
function runBuff(state: GameState, act: ArtAct, ctx: ActCtx): void {
  if (ctx.remote) return;
  const p = state.player;
  const params = ctx.params;
  const time = act.duration * params.durationMul;
  const grow = (mul: number): number => 1 + (mul - 1) * params.potencyMul;
  if (act.damageMul !== undefined && time > 0) p.buffs.damage = { mul: grow(act.damageMul), time };
  if (act.speedMul !== undefined && time > 0) p.buffs.speed = { mul: grow(act.speedMul), time };
  if (act.invuln > 0) p.invulnTimer = Math.max(p.invulnTimer, act.invuln);
  if (act.heal !== undefined) healPlayer(state, p.maxHp * act.heal * params.potencyMul);
  if (act.mana !== undefined) gainMana(state, act.mana * params.potencyMul);
  for (const s of act.self) applyStatus(state, { kind: "player" }, { ...s, duration: s.duration * params.durationMul }, "player");
  spawnBurst(state, p.body.pos, COLOR_BUFF, BUFF_PARTICLES, BUFF_PARTICLE_SPEED, BUFF_PARTICLE_LIFE, BUFF_PARTICLE_SIZE);
}
