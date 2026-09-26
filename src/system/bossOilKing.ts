import { FIXED_DT } from "../core/loop";
import { type Enemy, type GameState, pushSfx } from "../core/state";
import { type Vec, add, fromAngle, scale } from "../core/vec";
import { type EnemyDef, depthDamageBonus } from "../data/enemies";
import { BOSS, FEEL } from "../data/tuning";
import { TILE_SIZE } from "../map/grid";
import { addFloatingText, shake, spawnBurst } from "./effects";
import { type EnemyTelegraph, scaledWindup } from "./enemies";
import { blastBoth, seedTerrain } from "./enemyTerrain";
import { spawnLanding, spawnShockwave } from "./hazards";
import { overlapsWall } from "./physics";
import { applyStagger } from "./poise";
import { phaseShift } from "./boss";
import { type BossHooks, lungeStep, resetSequence, runBossCycle, toPlayer, walkToward } from "./bossKit";
import { igniteTerrainAt, placeTerrain, terrainAt } from "./terrain";

/**
 * ボス: 油壺の王（docs/ideas/enemies.md 3 章の未実装分から。油の坑道・熔鉱炉と結び付く）。
 * 第 1 段階 = 油壺を投げる（影の予告 → 割れて油溜まり）と突進 / 第 2 段階 = 火炎瓶で油に火を点ける /
 * 第 3 段階 = 体から油を垂らしながら、叩きつけで周りの油に火を点ける。
 * 部屋のギミック: 燃える床に立つと自分に引火して怯む（ダウンの窓）。油を撒くのは王自身なので、油の上へ誘って火を点けさせる。
 * 突進で壁に激突しても怯む
 */

const STAGE_ONE = 1;
const STAGE_FIRE = 2;
const STAGE_DRENCHED = 3;
/** ai.move: 技 */
export const OIL_JAR = 0;
export const OIL_CHARGE = 1;
export const OIL_FIREBOMB = 2;
export const OIL_SLAM = 3;
const SEQUENCE: Readonly<Record<number, readonly number[]>> = {
  [STAGE_ONE]: [OIL_JAR, OIL_CHARGE],
  [STAGE_FIRE]: [OIL_JAR, OIL_CHARGE, OIL_FIREBOMB],
  [STAGE_DRENCHED]: [OIL_CHARGE, OIL_SLAM, OIL_FIREBOMB, OIL_JAR],
};
const FULL_CIRCLE = Math.PI * 2;
const FIRE_TEXT = "着火";
const DRENCH_TEXT = "油まみれ";
const IGNITE_TEXT = "引火";
/** 投げる・叩く技の攻撃の長さ（strikeTime に対する割合。すぐ隙へ移る） */
const QUICK_STRIKE_RATIO = 0.3;
const SLAM_STRIKE_RATIO = 0.5;
/** 部屋に最初から置く油溜まりの数と、中心からの距離（部屋の短辺に対する割合） */
const ROOM_PUDDLES = 4;
const ROOM_PUDDLE_RATIO = 0.3;

function sequenceOf(e: Enemy): readonly number[] {
  return SEQUENCE[e.ai?.stage ?? STAGE_ONE] ?? SEQUENCE[STAGE_ONE] ?? [];
}

const HOOKS: BossHooks = {
  approach: (state, e, def, dt) => {
    walkToward(state, e, def, dt);
    dripOil(state, e);
  },
  beginWindup,
  beginStrike,
  tickStrike,
  sequence: sequenceOf,
};

export function updateOilKing(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  const ai = e.ai;
  if (!ai) return;
  advanceStage(state, e);
  checkIgnite(state, e, dt);
  runBossCycle(state, e, def, dt, HOOKS);
}

function advanceStage(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const k = BOSS.oilKing;
  if (ai.stage === STAGE_ONE && e.hp <= e.maxHp * k.phase2Ratio) {
    phaseShift(state, e, FIRE_TEXT, k.color, STAGE_FIRE);
    resetSequence(e, sequenceOf(e));
    return;
  }
  if (ai.stage === STAGE_FIRE && e.hp <= e.maxHp * k.phase3Ratio) {
    phaseShift(state, e, DRENCH_TEXT, k.color, STAGE_DRENCHED);
    resetSequence(e, sequenceOf(e));
  }
}

/** 燃える床に立つと引火して怯む（間隔つき。ai.timer を使う） */
function checkIgnite(state: GameState, e: Enemy, dt: number): void {
  const ai = e.ai;
  if (!ai) return;
  ai.timer = Math.max(0, ai.timer - dt);
  if (ai.timer > 0 || terrainAt(state, e.body.pos.x, e.body.pos.y) !== "fire") return;
  const k = BOSS.oilKing;
  ai.timer = k.igniteCooldown;
  addFloatingText(state, { x: e.body.pos.x, y: e.body.pos.y - 18 }, IGNITE_TEXT, "#ff8030", 1.5, 1.1);
  spawnBurst(state, e.body.pos, "#ff8030", 24, 150, 0.5, 2.5);
  shake(state, FEEL.shakeHeavy);
  pushSfx(state, "burn");
  applyStagger(state, e, k.igniteStagger, { selfInflicted: true });
}

/** 第 3 段階: 歩いた跡に油を垂らす（ai.counter とは別に、経過時間の区切りで置く） */
function dripOil(state: GameState, e: Enemy): void {
  if (e.ai?.stage !== STAGE_DRENCHED) return;
  const k = BOSS.oilKing;
  const ticks = Math.max(1, Math.round(k.trailInterval / FIXED_DT));
  if (state.tick % ticks !== 0) return;
  placeTerrain(state, e.body.pos.x, e.body.pos.y, "oil", k.trailRadius);
}

function beginWindup(state: GameState, e: Enemy, def: EnemyDef): void {
  const ai = e.ai;
  if (!ai) return;
  const k = BOSS.oilKing;
  e.strikeDir = toPlayer(state, e);
  switch (ai.move) {
    case OIL_JAR: {
      e.phaseTimer = scaledBossWindup(state, k.jarFall);
      ai.points = jarPoints(state, e);
      for (const p of ai.points) spawnLanding(state, p, k.jarRadius, e.phaseTimer, e.id);
      return;
    }
    case OIL_FIREBOMB:
      e.phaseTimer = scaledBossWindup(state, def.windup);
      ai.target = { ...state.player.body.pos };
      spawnLanding(state, ai.target, k.fireBombRadius, e.phaseTimer, e.id);
      return;
    default:
      e.phaseTimer = scaledBossWindup(state, def.windup);
      return;
  }
}

function scaledBossWindup(state: GameState, base: number): number {
  return scaledWindup(base, state.depth);
}

/** プレイヤーの足元と、その周りに油壺の落下点 */
function jarPoints(state: GameState, e: Enemy): Vec[] {
  const k = BOSS.oilKing;
  const center = state.player.body.pos;
  const points: Vec[] = [{ ...center }];
  for (let i = 1; i < k.jarCount; i++) {
    const q = add(center, scale(fromAngle((i / k.jarCount) * FULL_CIRCLE + e.id + state.tick), k.jarSpread));
    if (!overlapsWall(state, q.x, q.y, 2)) points.push(q);
  }
  return points;
}

function beginStrike(state: GameState, e: Enemy, def: EnemyDef): void {
  const ai = e.ai;
  if (!ai) return;
  const k = BOSS.oilKing;
  const bonus = depthDamageBonus(state.depth);
  const source = { defKey: e.defKey, roomIndex: e.roomIndex };
  switch (ai.move) {
    case OIL_JAR:
      e.phaseTimer = def.strikeTime * QUICK_STRIKE_RATIO;
      for (const p of ai.points ?? []) {
        blastBoth(state, p, k.jarBlast, k.jarDamage + bonus, def.color, source, e.id);
        placeTerrain(state, p.x, p.y, "oil", k.jarRadius);
      }
      pushSfx(state, "oilSplash");
      return;
    case OIL_FIREBOMB:
      e.phaseTimer = def.strikeTime * QUICK_STRIKE_RATIO;
      blastBoth(state, ai.target, k.fireBombRadius, k.fireBombDamage + bonus, "#ff6020", source, e.id);
      placeTerrain(state, ai.target.x, ai.target.y, "fire", k.fireBombRadius / 2);
      igniteTerrainAt(state, ai.target.x, ai.target.y, k.fireBombRadius);
      return;
    case OIL_SLAM:
      e.phaseTimer = def.strikeTime * SLAM_STRIKE_RATIO;
      spawnShockwave(state, e.body.pos, k.slamRadius, k.slamDamage + bonus, e.id);
      igniteTerrainAt(state, e.body.pos.x, e.body.pos.y, k.slamRadius);
      shake(state, FEEL.shakeSpecial);
      pushSfx(state, "wallHit");
      return;
    default:
      e.phaseTimer = k.chargeTime;
      e.strikeDir = toPlayer(state, e);
      if (e.strikeDir.x !== 0) e.facing = e.strikeDir;
      return;
  }
}

/** 突進: 壁に激突すると怯む（ダウンの窓）。第 3 段階は突進の跡にも油が残る */
function tickStrike(state: GameState, e: Enemy, def: EnemyDef, dt: number): boolean {
  if (e.ai?.move !== OIL_CHARGE) return false;
  const k = BOSS.oilKing;
  const step = lungeStep(state, e, def, k.chargeSpeedMul, dt);
  dripOil(state, e);
  if (step.wall) {
    shake(state, FEEL.shakeHeavy);
    pushSfx(state, "wallHit");
    applyStagger(state, e, k.wallStagger, { selfInflicted: true });
    return true;
  }
  return step.touched;
}

/** 予告の形: 突進は線、叩きつけは輪（油壺と火炎瓶は影） */
export function oilKingTelegraph(e: Enemy): EnemyTelegraph {
  if (e.ai?.move === OIL_CHARGE) return { kind: "line" };
  if (e.ai?.move === OIL_SLAM) return { kind: "ring", radius: BOSS.oilKing.slamRadius };
  return null;
}

/** ボス部屋に最初から油溜まりを置く（王を燃やすための仕掛け。予告は要らない: 戦いの前からある床） */
export function setupOilKingRoom(state: GameState, roomIndex: number): void {
  const room = state.rooms[roomIndex];
  if (!room) return;
  const r = room.rect;
  const center = { x: (r.x + r.w / 2) * TILE_SIZE, y: (r.y + r.h / 2) * TILE_SIZE };
  const dist = Math.min(r.w, r.h) * TILE_SIZE * ROOM_PUDDLE_RATIO;
  for (let i = 0; i < ROOM_PUDDLES; i++) {
    const p = add(center, scale(fromAngle((i / ROOM_PUDDLES) * FULL_CIRCLE + Math.PI / 4), dist));
    seedTerrain(state, p, "oil", BOSS.oilKing.jarRadius, { delay: 0, duration: 0, quiet: true });
  }
}
