import { type Enemy, type GameState, pushSfx } from "../core/state";
import { type Vec, add, fromAngle, normalize, scale, sub } from "../core/vec";
import { type EnemyDef, depthDamageBonus, enemyDef } from "../data/enemies";
import { BOSS, FEEL } from "../data/tuning";
import { damagePlayer } from "./combat";
import { addFloatingText, shake, spawnBurst } from "./effects";
import { createEnemy, moveEnemy, scaledWindup } from "./enemies";
import { followersOf } from "./enemyTraits";
import { explodeHostile, spawnLanding, spawnShockwave } from "./hazards";
import { circlesOverlap, overlapsWall } from "./physics";
import { applyStagger } from "./poise";
import { inflictOnPlayer } from "./statusEffects";
import { phaseShift } from "./boss";

/**
 * ボス: 霜の巨人（docs/ideas/enemies.md B7）。
 * 第 1 段階 = 叩きつけ（輪の予告 → 冷気の衝撃波）/ 第 2 段階 = つららの雨を混ぜる（影の予告 → 落下）/
 * 第 3 段階 = 氷の鎧。周りの氷柱を全部割るまでダメージを受けず、割り切るとダウン（armorBreakDown 秒）
 */

const STAGE_ONE = 1;
const STAGE_ICICLES = 2;
const STAGE_ARMOR = 3;
/** ai.move: 次の技（enemies.ts の enemyTelegraph が叩きつけのときだけ輪を描く） */
export const GIANT_MOVE_SLAM = 0;
export const GIANT_MOVE_ICICLE = 1;
/** ai.counter: 氷の鎧をまとっている */
const ARMORED = 1;
const UNARMORED = 0;
const FULL_CIRCLE = Math.PI * 2;
const ICICLE_ATTEMPTS = 4;
/** 氷柱を置く距離の候補（pillarDistance に対する割合。壁に掛かれば近い方へ寄せる） */
const PILLAR_DISTANCE_RATIOS: readonly number[] = [1, 0.75, 0.5, 0.3];
const ICICLE_TEXT = "つららの雨";
const ARMOR_TEXT = "氷の鎧";
const ARMOR_BREAK_TEXT = "鎧が砕けた";

export function updateFrostGiant(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  const ai = e.ai;
  if (!ai) return;
  advanceStage(state, e);
  checkArmor(state, e);
  const dir = normalize(sub(state.player.body.pos, e.body.pos));
  switch (e.phase) {
    case "chase":
      if (dir.x !== 0) e.facing = dir;
      moveEnemy(state, e, def, dir.x * def.speed * dt, dir.y * def.speed * dt);
      if (e.attackCooldown > 0) return;
      beginWindup(state, e, def);
      return;
    case "windup":
      e.phaseTimer -= dt;
      if (e.phaseTimer <= 0) beginStrike(state, e, def);
      return;
    case "strike":
      e.phaseTimer -= dt;
      if (e.phaseTimer > 0) return;
      e.phase = "recover";
      e.phaseTimer = def.recover;
      return;
    case "recover":
      e.phaseTimer -= dt;
      if (e.phaseTimer > 0) return;
      e.phase = "chase";
      e.attackCooldown = def.attackInterval;
      ai.move = nextMove(e);
      return;
    default:
      return;
  }
}

function advanceStage(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const g = BOSS.frostGiant;
  if (ai.stage === STAGE_ONE && e.hp <= e.maxHp * g.phase2Ratio) {
    phaseShift(state, e, ICICLE_TEXT, g.color, STAGE_ICICLES);
    return;
  }
  if (ai.stage === STAGE_ICICLES && e.hp <= e.maxHp * g.phase3Ratio) {
    phaseShift(state, e, ARMOR_TEXT, g.color, STAGE_ARMOR);
    raisePillars(state, e);
  }
}

/** 第 2 段階からは叩きつけとつららを交互に */
function nextMove(e: Enemy): number {
  const ai = e.ai;
  if (!ai || ai.stage === STAGE_ONE) return GIANT_MOVE_SLAM;
  return ai.move === GIANT_MOVE_SLAM ? GIANT_MOVE_ICICLE : GIANT_MOVE_SLAM;
}

function beginWindup(state: GameState, e: Enemy, def: EnemyDef): void {
  const ai = e.ai;
  if (!ai) return;
  e.phase = "windup";
  pushSfx(state, "enemyWindup");
  if (ai.move === GIANT_MOVE_SLAM) {
    e.phaseTimer = scaledWindup(def.windup, state.depth);
    return;
  }
  // つらら: 影が出てから落ちるまでがそのまま予備動作（深度で縮めても下限は守る）
  e.phaseTimer = scaledWindup(BOSS.frostGiant.icicleFall, state.depth);
  ai.points = pickIciclePoints(state);
  for (const p of ai.points) spawnLanding(state, p, BOSS.frostGiant.icicleRadius, e.phaseTimer, e.id);
}

/** プレイヤーの足元と、その周りにつららの落下点を選ぶ */
function pickIciclePoints(state: GameState): Vec[] {
  const g = BOSS.frostGiant;
  const center = state.player.body.pos;
  const points: Vec[] = [{ ...center }];
  for (let i = 1; i < g.icicleCount; i++) {
    for (let k = 0; k < ICICLE_ATTEMPTS; k++) {
      const q = add(center, scale(fromAngle(state.rng.next() * FULL_CIRCLE), state.rng.next() * g.icicleSpread));
      if (overlapsWall(state, q.x, q.y, 2)) continue;
      points.push(q);
      break;
    }
  }
  return points;
}

function beginStrike(state: GameState, e: Enemy, def: EnemyDef): void {
  const ai = e.ai;
  e.phase = "strike";
  e.phaseTimer = def.strikeTime;
  if (ai?.move === GIANT_MOVE_ICICLE) {
    dropIcicles(state, e);
    return;
  }
  slam(state, e, def);
}

/** 叩きつけ: 冷気の衝撃波。真下にいたら潰される */
function slam(state: GameState, e: Enemy, def: EnemyDef): void {
  const g = BOSS.frostGiant;
  const damage = g.slamDamage + depthDamageBonus(state.depth);
  spawnShockwave(state, e.body.pos, g.slamRadius, damage, e.id);
  spawnBurst(state, e.body.pos, def.color, 24, 150, 0.5, 3);
  shake(state, FEEL.shakeSpecial);
  pushSfx(state, "wallHit");
  const p = state.player.body;
  if (!circlesOverlap(e.body.pos.x, e.body.pos.y, g.slamRadius * g.slamCoreRatio, p.pos.x, p.pos.y, p.radius)) return;
  if (damagePlayer(state, damage, e.body.pos, e) === "hit") inflictOnPlayer(state, e, "shockwave");
}

function dropIcicles(state: GameState, e: Enemy): void {
  const g = BOSS.frostGiant;
  const damage = g.icicleDamage + depthDamageBonus(state.depth);
  const source = { defKey: e.defKey, roomIndex: e.roomIndex };
  for (const p of e.ai?.points ?? []) explodeHostile(state, p, g.icicleRadius, damage, g.color, source);
  if (e.ai) e.ai.points = [];
}

// -----------------------------------------------------------------------------
// 氷の鎧と氷柱
// -----------------------------------------------------------------------------

function raisePillars(state: GameState, e: Enemy): void {
  const g = BOSS.frostGiant;
  const def = enemyDef("icePillar");
  for (let i = 0; i < g.pillarCount; i++) {
    const angle = (i / g.pillarCount) * FULL_CIRCLE + Math.PI / 4;
    const pos = pillarPos(state, e, angle, def.radius);
    const pillar = createEnemy(state, def, pos, e.roomIndex, true);
    pillar.leaderId = e.id;
    state.enemies.push(pillar);
  }
  if (e.ai) e.ai.counter = ARMORED;
}

/**
 * 氷柱の置き場所: 巨人から angle の向きに、壁に掛からない一番遠い距離。どれも壁なら巨人の足元。
 * 壁の中の氷柱は割れず、鎧が永久に解けなくなる（詰み）ので、必ず床の上に置く
 */
function pillarPos(state: GameState, e: Enemy, angle: number, radius: number): Vec {
  const dir = fromAngle(angle);
  for (const ratio of PILLAR_DISTANCE_RATIOS) {
    const want = add(e.body.pos, scale(dir, BOSS.frostGiant.pillarDistance * ratio));
    if (!overlapsWall(state, want.x, want.y, radius)) return want;
  }
  return { ...e.body.pos };
}

/** 氷柱を割り切ったら鎧が砕けてダウン */
function checkArmor(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai || ai.counter !== ARMORED) return;
  if (followersOf(state, e).length > 0) return;
  ai.counter = UNARMORED;
  const g = BOSS.frostGiant;
  addFloatingText(state, { x: e.body.pos.x, y: e.body.pos.y - 18 }, ARMOR_BREAK_TEXT, g.color, 1.5, 1.2);
  spawnBurst(state, e.body.pos, g.color, 30, 180, 0.6, 2.5);
  shake(state, FEEL.shakeSpecial);
  pushSfx(state, "guardBreak");
  // 自傷扱い（拘束上限を数えない）で確実に窓を開ける
  applyStagger(state, e, g.armorBreakDown, { selfInflicted: true });
}

/** 氷の鎧が効いているか（氷柱が 1 本でも残っている間） */
export function frostGiantArmored(state: GameState, e: Enemy): boolean {
  if (e.ai?.counter !== ARMORED) return false;
  return followersOf(state, e).length > 0;
}
