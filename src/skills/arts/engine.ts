import { ELEMENT_COLOR } from "../../core/element";
import { type Enemy, type GameState, pushSfx } from "../../core/state";
import { type Vec, add, dist, fromAngle, length, normalize, scale, sub } from "../../core/vec";
import { enemyDef } from "../../data/enemies";
import type { FormKey } from "../../data/weaponForms";
import { MOVESETS } from "../../data/weapons";
import { FEEL } from "../../data/tuning";
import { damageEnemy, healPlayer } from "../../system/combat";
import { addSkillFx, spawnBlast, spawnBurst, spawnLine, spawnRing, withSkillFx } from "../../system/effects";
import { gainMana } from "../../system/mana";
import { currentForm } from "../../system/morale";
import { circlesOverlap, moveBody, overlapsWall } from "../../system/physics";
import { applyStatus, enemiesInRadius, hasStatus, removeStatus } from "../../system/statusEffects";
import { placeTerrain } from "../../system/terrain";
import { detonateOwnMines } from "../../system/weaponArts";
import type { CastCtx } from "../actions";
import { MODIFIERS, NO_NUMBERS, SKILL, SKILL_DEFS } from "../data";
import { enemiesInCone, enemiesOnSegment, enemyNear, rayEnd } from "../geom";
import { LEYLINE_TERRAIN, applySkillStatuses, castAttack, castElement, skillHit, skillPower } from "../hit";
import { spawnFan } from "../shots";
import type { CastParams, ModifierKey, ShotPath, ShotSteer, SkillShot } from "../types";
import { ART_DEFS } from "./index";
import type { ArtSkillKey } from "./keys";
import { ART_TRANSFORMS, TRANSFORM_NUMBERS, transformActs } from "./transform";
import type { ArtAct, ArtPending } from "./types";

/**
 * 技の発動（行為の列を出す）。docs/ideas/weapon-skills.md・docs/ideas/skills-7c-plan.md 4〜5 章。
 * 撃つ瞬間に今の武器の型で行為の列を作り替え（skills/arts/transform.ts）、続けて刻印符の transform（分裂・重ね打ち …）を
 * 付けた順に当ててから、その列を出す。
 * delay 0 の行為は撃った瞬間に出し、delay のある行為は SkillRunState.artQueue に積んで updateArtQueue が出す。
 * remote（反響・分身・遅延・据え置き）ではプレイヤーを動かさず、発動地点・向きで出す。
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

/** 扇の絵の選び分けの境（度）。これ以上は広い扇（arcWide）・ほぼ一周（arcFull） */
const ARC_WIDE_DEG = 160;
const ARC_FULL_DEG = 300;

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

/**
 * 行為の見た目の出来事（render/fxSkill.ts が技の絵の表の acts[variant] で描く）。ロジックは変えない。
 * variant は行為の種類と、絵を分けたい細分（arcWide / ringTarget / dashBack …）
 */
function actFx(state: GameState, ctx: ActCtx, variant: string, pos: Vec, opts: { to?: Vec; size?: number; angle?: number } = {}): void {
  addSkillFx(state, ctx.key, "act", pos, {
    variant,
    to: opts.to,
    size: opts.size,
    angle: opts.angle ?? Math.atan2(ctx.dir.y, ctx.dir.x),
    element: castElement(ctx.params),
  });
}

function arcVariant(deg: number): string {
  if (deg >= ARC_FULL_DEG) return "arcFull";
  return deg >= ARC_WIDE_DEG ? "arcWide" : "arc";
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
  const form = currentForm(state).key;
  const acts = runeActs(transformActs(form, ART_DEFS[key].acts), ctx.params.artTransforms);
  const params = formParams(state, form, ctx.params);
  for (const act of acts) {
    if (act.delay <= 0) {
      runAct(state, act, resolveCtx(state, key, act, params, ctx.origin, ctx.dir, ctx.target, ctx.remote, false));
      continue;
    }
    const delay = act.delay * params.timeMul;
    queueOf(state).push({ timer: delay, key, act, params, origin: { ...ctx.origin }, dir: { ...ctx.dir }, target: { ...ctx.target }, remote: ctx.remote });
    if (act.anchor === "target") telegraph(state, act, params, ctx.target, delay);
  }
}

/** 刻印符の transform を付けた順に当てる（型の変形の後。遅れて出る行為の予約も作り替えた列を持ち運ぶ） */
function runeActs(acts: readonly ArtAct[], keys: readonly ModifierKey[]): readonly ArtAct[] {
  let out = acts;
  for (const k of keys) {
    const t = MODIFIERS[k].transform;
    if (t) out = t(out, NO_NUMBERS);
  }
  return out;
}

/**
 * 型が発動の素性を変えるもの（杖: 攻撃の属性を装備の武器の属性に、無属性の武器なら威力を上げる）。
 * 刻印符などで属性が既に決まっていればそちらを優先する（属性の上書きを 2 重にしない）
 */
function formParams(state: GameState, form: FormKey, params: CastParams): CastParams {
  if (ART_TRANSFORMS[form].element !== "weapon" || params.element !== null) return params;
  const weapon = (MOVESETS[state.stats.moveset] ?? MOVESETS.sword).attack.element;
  if (weapon !== "none") return { ...params, element: weapon };
  return { ...params, damageMul: params.damageMul * (TRANSFORM_NUMBERS[form].plainMul ?? 1) };
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
  for (const p of due) runAct(state, p.act, resolveCtx(state, p.key, p.act, p.params, p.origin, p.dir, p.target, p.remote, true));
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
      actFx(state, ctx, "detonate", ctx.pos);
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
      poise: act.poiseMul === 1 ? act.poise : (act.poise ?? SKILL_DEFS[ctx.key].poise) * act.poiseMul,
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
  withSkillFx(state, ctx.key, () => {
    for (let i = 0; i < ARC_RAYS; i++) {
      const a = base - half + (half * 2 * i) / (ARC_RAYS - 1);
      spawnLine(state, ctx.pos, add(ctx.pos, scale(fromAngle(a), reach)), color, LINE_LIFE);
    }
  });
  actFx(state, ctx, arcVariant(act.deg), ctx.pos, { size: reach });
}

function runRing(state: GameState, act: ArtAct, ctx: ActCtx): void {
  const radius = act.radius * ctx.params.areaMul;
  for (const e of enemiesInRadius(state, ctx.pos, radius)) strike(state, act, ctx, e, ctx.pos);
  if (act.clearsBullets) clearBullets(state, ctx.pos, radius);
  terrainAt(state, act, ctx, ctx.pos);
  const color = artColor(ctx.params);
  if (act.anchor === "target") {
    withSkillFx(state, ctx.key, () => spawnBlast(state, ctx.pos, radius, color));
    actFx(state, ctx, "ringTarget", ctx.pos, { size: radius });
    pushSfx(state, "explode");
    return;
  }
  withSkillFx(state, ctx.key, () => spawnRing(state, ctx.pos, radius, color, RING_LIFE));
  actFx(state, ctx, "ring", ctx.pos, { size: radius });
}

function runLine(state: GameState, act: ArtAct, ctx: ActCtx): void {
  const end = rayEnd(state, ctx.pos, ctx.dir, act.length * ctx.params.areaMul);
  for (const e of enemiesOnSegment(state, ctx.pos, end, (act.width * ctx.params.areaMul) / 2)) strike(state, act, ctx, e, ctx.pos);
  terrainAlong(state, act, ctx, ctx.pos, end);
  withSkillFx(state, ctx.key, () => spawnLine(state, ctx.pos, end, artColor(ctx.params), LINE_LIFE));
  actFx(state, ctx, "line", ctx.pos, { to: end, size: act.width * ctx.params.areaMul });
}

/** 踏み込み（distance が負なら後ろへ）。通り道の敵に当て、終点に地形（軌跡なら通り道にも） */
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
  trailAlong(state, ctx.params, start, end);
  withSkillFx(state, ctx.key, () => dashFx(state, start, end, artColor(ctx.params)));
  actFx(state, ctx, back ? "dashBack" : "dash", start, { to: end, size: act.width * ctx.params.areaMul, angle: Math.atan2(dir.y, dir.x) });
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
  trailAlong(state, ctx.params, from, p.body.pos);
  withSkillFx(state, ctx.key, () => dashFx(state, from, p.body.pos, artColor(ctx.params)));
  actFx(state, ctx, "blink", from, { to: p.body.pos, angle: Math.atan2(p.body.pos.y - from.y, p.body.pos.x - from.x) });
  pushSfx(state, "dash");
}

/** 刻印符「軌跡」: 踏み込み・跳躍の通り道に攻撃の属性の地形を置く */
function trailAlong(state: GameState, params: Readonly<CastParams>, from: Vec, to: Vec): void {
  if (!params.trail) return;
  const t = SKILL.modifier.trail;
  const kind = LEYLINE_TERRAIN[castAttack(params)?.element ?? "none"];
  const d = length(sub(to, from));
  const dir = normalize(sub(to, from), state.player.facing);
  for (let s = 0; s <= d; s += t.step) {
    const at = add(from, scale(dir, s));
    placeTerrain(state, at.x, at.y, kind, t.radius, t.time);
  }
}

function runShot(state: GameState, act: ArtAct, ctx: ActCtx): void {
  const params = ctx.params;
  const count = act.count + params.countBonus;
  const power = act.damage ? skillPower(state, act.damage, params) : 0;
  const color = artColor(params);
  const before = state.skills.shots.length;
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
  actFx(state, ctx, "shot", ctx.pos);
  if (params.shotPath) steerShots(state, state.skills.shots.slice(before), params.shotPath);
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
    const segFrom = from;
    withSkillFx(state, ctx.key, () => spawnLine(state, segFrom, at, color, LINE_LIFE));
    actFx(state, ctx, "chain", from, { to: at, angle: Math.atan2(at.y - from.y, at.x - from.x) });
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
        withSkillFx(state, ctx.key, () => spawnLine(state, from, e.body.pos, color, LINE_LIFE));
      }
    }
    if (act.damage || act.applies.length > 0) strike(state, act, ctx, e, ctx.pos);
  }
  withSkillFx(state, ctx.key, () => spawnRing(state, ctx.pos, act.radius * ctx.params.areaMul, color, RING_LIFE));
  actFx(state, ctx, "pull", ctx.pos, { size: act.radius * ctx.params.areaMul });
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
  withSkillFx(state, ctx.key, () => spawnBurst(state, p.body.pos, COLOR_BUFF, BUFF_PARTICLES, BUFF_PARTICLE_SPEED, BUFF_PARTICLE_LIFE, BUFF_PARTICLE_SIZE));
  actFx(state, ctx, "buff", p.body.pos);
}

// ---------------------------------------------------------------------------
// 弾の操り（刻印符「旋回」「戻り刃」）
// ---------------------------------------------------------------------------

/** 出したばかりの弾を操る対象にする。旋回は出た向きから回り始め、戻り刃は元の寿命のぶん飛んでから折り返す */
function steerShots(state: GameState, shots: readonly SkillShot[], path: ShotPath): void {
  const rs = state.skills;
  const list = rs.steers ?? [];
  const r = SKILL.modifier.recall;
  for (const s of shots) {
    const timer = path === "orbit" ? SKILL.modifier.orbit.rehit : s.life / r.lifeMul;
    list.push({ shotId: s.id, path, angle: Math.atan2(s.vel.y, s.vel.x), timer, returning: false });
  }
  rs.steers = list;
}

/** 旋回・戻り刃の弾を動かす（updateSkills から、updateShots の直前に毎ステップ）。消えた弾の操りは捨てる */
export function updateShotSteers(state: GameState, dt: number): void {
  const rs = state.skills;
  const steers = rs.steers;
  if (!steers || steers.length === 0) return;
  const byId = new Map(rs.shots.map((s) => [s.id, s]));
  rs.steers = steers.filter((st) => {
    const shot = byId.get(st.shotId);
    if (!shot || shot.life <= 0) return false;
    if (st.path === "orbit") steerOrbit(state, shot, st, dt);
    else steerRecall(state, shot, st, dt);
    return shot.life > 0;
  });
}

/**
 * 旋回: 自分の周りの円周上を回る。弾の移動（skills/shots.ts）が vel × dt 進めるので、進んだ先が円周上に来るよう
 * 位置を戻しておく。行き先が壁なら止まって待つ（壁で消さない）。rehit 秒ごとに同じ敵へもう一度当たれる
 */
function steerOrbit(state: GameState, shot: SkillShot, st: ShotSteer, dt: number): void {
  const o = SKILL.modifier.orbit;
  const center = state.player.body.pos;
  st.angle += o.turnRate * dt;
  const next = add(center, scale(fromAngle(st.angle), o.radius));
  st.timer -= dt;
  if (st.timer <= 0) {
    st.timer = o.rehit;
    shot.hitIds.clear();
  }
  if (overlapsWall(state, next.x, next.y, shot.radius)) {
    shot.vel = { x: 0, y: 0 };
    return;
  }
  const tangent = fromAngle(st.angle + Math.PI / 2);
  shot.vel = scale(tangent, o.radius * o.turnRate);
  shot.pos = sub(next, scale(shot.vel, dt));
}

/** 戻り刃: 元の寿命のぶん飛んだら折り返して自分へ戻る（帰りは行きで当てた敵にもまた当たる）。手元に着いたら消える */
function steerRecall(state: GameState, shot: SkillShot, st: ShotSteer, dt: number): void {
  if (!st.returning) {
    st.timer -= dt;
    if (st.timer > 0) return;
    st.returning = true;
    shot.hitIds.clear();
  }
  const home = state.player.body.pos;
  if (dist(shot.pos, home) <= state.player.body.radius + shot.radius) {
    shot.life = 0;
    return;
  }
  const speed = length(shot.vel);
  shot.vel = scale(normalize(sub(home, shot.pos), shot.vel), speed);
}
