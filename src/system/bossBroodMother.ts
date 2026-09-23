import { type Enemy, type GameState, pushSfx } from "../core/state";
import { type Vec, add, fromAngle, scale, sub } from "../core/vec";
import { type EnemyDef, depthDamageBonus, enemyDef } from "../data/enemies";
import { BOSS, FEEL } from "../data/tuning";
import { TILE_SIZE } from "../map/grid";
import { shake, spawnBurst } from "./effects";
import { type EnemyTelegraph, createEnemy, moveEnemy, scaledWindup } from "./enemies";
import { findFreeSpot, spawnSpot } from "./enemyTraits";
import { spawnLanding, spawnShockwave } from "./hazards";
import { phaseShift } from "./boss";
import { type BossHooks, lungeStep, resetSequence, runBossCycle, toPlayer, walkToward } from "./bossKit";
import { placeTerrain } from "./terrain";

/**
 * ボス: 群れの母（docs/ideas/enemies.md B1「蟻の女王」の群れ版。沼・草原と結び付く）。
 * 第 1 段階 = 卵を産み（産む間は無防備）、噛みつく / 第 2 段階 = 跳んで着地の衝撃波と酸の沼 /
 * 第 3 段階 = 巣が崩れ、壁際から群れが湧き続ける。
 * 卵は時間で孵る（群れが増える）。卵を割ると母に怯み値が入る（範囲攻撃で卵を割りながら母を崩す）
 */

const STAGE_ONE = 1;
const STAGE_WINGED = 2;
const STAGE_COLLAPSE = 3;
/** ai.move: 技 */
export const BROOD_LAY = 0;
export const BROOD_BITE = 1;
export const BROOD_JUMP = 2;
const SEQUENCE: Readonly<Record<number, readonly number[]>> = {
  [STAGE_ONE]: [BROOD_LAY, BROOD_BITE, BROOD_BITE],
  [STAGE_WINGED]: [BROOD_LAY, BROOD_JUMP, BROOD_BITE],
  [STAGE_COLLAPSE]: [BROOD_JUMP, BROOD_LAY, BROOD_BITE],
};
const FULL_CIRCLE = Math.PI * 2;
const WINGED_TEXT = "羽化";
const COLLAPSE_TEXT = "巣が崩れる";
/** 部屋に同時に置ける卵の上限（産みすぎて部屋が埋まらないように） */
const EGG_MAX = 6;
/** 卵の置き場の影の半径 */
const EGG_MARK_RADIUS = 8;
/** 壁際から湧く位置（部屋の内側 1.5 マス） */
const WALL_INSET = 1.5;

function sequenceOf(e: Enemy): readonly number[] {
  return SEQUENCE[e.ai?.stage ?? STAGE_ONE] ?? SEQUENCE[STAGE_ONE] ?? [];
}

const HOOKS: BossHooks = {
  approach: (state, e, def, dt) => walkToward(state, e, def, dt),
  beginWindup,
  beginStrike,
  tickStrike,
  sequence: sequenceOf,
};

export function updateBroodMother(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  if (!e.ai) return;
  advanceStage(state, e);
  tickSwarm(state, e, dt);
  runBossCycle(state, e, def, dt, HOOKS);
}

function advanceStage(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const b = BOSS.broodMother;
  if (ai.stage === STAGE_ONE && e.hp <= e.maxHp * b.phase2Ratio) {
    phaseShift(state, e, WINGED_TEXT, b.color, STAGE_WINGED);
    resetSequence(e, sequenceOf(e));
    return;
  }
  if (ai.stage === STAGE_WINGED && e.hp <= e.maxHp * b.phase3Ratio) {
    phaseShift(state, e, COLLAPSE_TEXT, b.color, STAGE_COLLAPSE);
    resetSequence(e, sequenceOf(e));
    ai.timer = b.swarmInterval;
  }
}

/** 第 3 段階: 一定間隔で壁際から群れが湧く（出現の魔法陣がそのまま予告） */
function tickSwarm(state: GameState, e: Enemy, dt: number): void {
  const ai = e.ai;
  if (!ai || ai.stage !== STAGE_COLLAPSE) return;
  ai.timer -= dt;
  if (ai.timer > 0) return;
  const b = BOSS.broodMother;
  ai.timer = b.swarmInterval;
  const def = enemyDef("spikeRat");
  for (let i = 0; i < b.swarmCount; i++) {
    const want = wallPoint(state, e);
    const minion = createEnemy(state, def, spawnSpot(state, want, e.body.pos, def.radius), e.roomIndex, true);
    minion.revived = true;
    state.enemies.push(minion);
  }
  pushSfx(state, "ambush");
}

/** 部屋の壁際の 1 点（乱数で辺を選ぶ） */
function wallPoint(state: GameState, e: Enemy): Vec {
  const room = state.rooms[e.roomIndex];
  if (!room) return { ...e.body.pos };
  const r = room.rect;
  const t = state.rng.next();
  const side = state.rng.int(0, 3);
  const x = side === 0 ? r.x + WALL_INSET : side === 1 ? r.x + r.w - WALL_INSET : r.x + WALL_INSET + t * (r.w - WALL_INSET * 2);
  const y = side === 2 ? r.y + WALL_INSET : side === 3 ? r.y + r.h - WALL_INSET : r.y + WALL_INSET + t * (r.h - WALL_INSET * 2);
  return { x: x * TILE_SIZE, y: y * TILE_SIZE };
}

function beginWindup(state: GameState, e: Enemy, def: EnemyDef): void {
  const ai = e.ai;
  if (!ai) return;
  const b = BOSS.broodMother;
  e.strikeDir = toPlayer(state, e);
  switch (ai.move) {
    case BROOD_LAY:
      // 産む間は無防備（強靭 0.5 のまま長い予備動作。卵の置き場は影で見せる）
      e.phaseTimer = scaledWindup(b.layTime, state.depth);
      ai.points = eggPoints(state, e);
      for (const p of ai.points) spawnLanding(state, p, EGG_MARK_RADIUS, e.phaseTimer, e.id);
      return;
    case BROOD_JUMP:
      e.phaseTimer = scaledWindup(def.windup, state.depth);
      ai.target = { ...state.player.body.pos };
      spawnLanding(state, ai.target, b.landRadius, e.phaseTimer, e.id);
      return;
    default:
      e.phaseTimer = scaledWindup(def.windup, state.depth);
      return;
  }
}

function eggPoints(state: GameState, e: Enemy): Vec[] {
  const b = BOSS.broodMother;
  const eggs = state.enemies.filter((o) => o.hp > 0 && o.defKey === "broodEgg").length;
  const count = Math.max(0, Math.min(b.eggCount, EGG_MAX - eggs));
  const points: Vec[] = [];
  for (let i = 0; i < count; i++) {
    const want = add(e.body.pos, scale(fromAngle((i / Math.max(1, count)) * FULL_CIRCLE + state.tick), b.eggSpread));
    points.push(findFreeSpot(state, want, EGG_MARK_RADIUS) ?? { ...e.body.pos });
  }
  return points;
}

function beginStrike(state: GameState, e: Enemy, def: EnemyDef): void {
  const ai = e.ai;
  if (!ai) return;
  const b = BOSS.broodMother;
  switch (ai.move) {
    case BROOD_LAY:
      e.phaseTimer = def.strikeTime;
      layEggs(state, e);
      return;
    case BROOD_JUMP:
      // 空中: 着地点の影は予備動作の影から引き継いで出し直す（飛んでいる間も読める）
      e.phaseTimer = b.jumpTime;
      spawnLanding(state, ai.target, b.landRadius, b.jumpTime);
      spawnBurst(state, e.body.pos, def.color, 10, 90, 0.3, 2);
      return;
    default:
      e.phaseTimer = b.biteTime;
      e.strikeDir = toPlayer(state, e);
      if (e.strikeDir.x !== 0) e.facing = e.strikeDir;
      return;
  }
}

function layEggs(state: GameState, e: Enemy): void {
  const def = enemyDef("broodEgg");
  for (const p of e.ai?.points ?? []) {
    const egg = createEnemy(state, def, p, e.roomIndex, true);
    egg.leaderId = e.id;
    egg.revived = true;
    state.enemies.push(egg);
  }
  pushSfx(state, "enemyWindup");
}

function tickStrike(state: GameState, e: Enemy, def: EnemyDef, dt: number): boolean {
  const ai = e.ai;
  if (!ai) return false;
  if (ai.move === BROOD_BITE) {
    const step = lungeStep(state, e, def, BOSS.broodMother.biteSpeedMul, dt);
    return step.wall || step.touched;
  }
  if (ai.move !== BROOD_JUMP) return false;
  // 着地点へ向かって移動する（壁は抜けない）
  const remaining = Math.max(dt, e.phaseTimer + dt);
  const stepVec = scale(sub(ai.target, e.body.pos), Math.min(1, dt / remaining));
  moveEnemy(state, e, def, stepVec.x, stepVec.y);
  if (e.phaseTimer > 0) return false;
  land(state, e);
  return true;
}

/** 着地: 衝撃波と、酸の沼（毒沼。敵にも効く） */
function land(state: GameState, e: Enemy): void {
  const b = BOSS.broodMother;
  spawnShockwave(state, e.body.pos, b.landRadius, b.landDamage + depthDamageBonus(state.depth), e.id);
  placeTerrain(state, e.body.pos.x, e.body.pos.y, "bog", b.acidRadius);
  shake(state, FEEL.shakeSpecial);
  pushSfx(state, "wallHit");
}

/** 予告の形: 噛みつきは線、跳躍の着地は影、産卵は置き場の影 */
export function broodMotherTelegraph(e: Enemy): EnemyTelegraph {
  return e.ai?.move === BROOD_BITE ? { kind: "line" } : null;
}
