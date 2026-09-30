import { FIXED_DT } from "../core/loop";
import { type Enemy, type GameState, pushSfx } from "../core/state";
import { type Vec, add, fromAngle, scale } from "../core/vec";
import { type EnemyDef, depthDamage } from "../data/enemies";
import { BOSS, FEEL } from "../data/tuning";
import { TILE_SIZE } from "../map/grid";
import { shake, spawnBurst } from "./effects";
import { type EnemyTelegraph, scaledWindup } from "./enemies";
import { blastBoth, seedTerrain } from "./enemyTerrain";
import { spawnLanding, spawnShockwave } from "./hazards";
import { overlapsWall } from "./physics";
import { isStaggered } from "./poise";
import { phaseShift } from "./boss";
import { type BossHooks, type PlayerRead, bossDown, lungeStep, runBossCycle, signatureOf, toPlayer, walkToward } from "./bossKit";
import { igniteTerrainAt, placeTerrain, terrainAt } from "./terrain";

/**
 * ボス: 油壺の王（章 3。docs/ideas/boss-impl.md 2-4）。技はプレイヤーの状態で選ぶ（乱数なし）。
 * 第 1 段階（投げ）= 遠いと油壺（影の予告 → 割れて油溜まり）、近いと突進 /
 * 第 2 段階（着火）= 始まりに最初の油溜まりへ火を点ける。足元が油か止まっている相手には火炎瓶 /
 * 第 3 段階（油まみれ）= 体から油を垂らしながら、近いと叩きつけ（周りの油に火を点ける）。突進は壁に当たらなければ続けて出す。
 * 第 3 段階へは HP の他に、王を燃える床へ誘って引火させた回数でも進む（行為で進む段階）。
 * 部屋のギミック: 燃える床に立つと自分に引火して怯む（見えるダウン）。油を撒くのは王自身なので、油の上へ誘って火を点けさせる。
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
const FULL_CIRCLE = Math.PI * 2;
const FIRE_TEXT = "着火";
const DRENCH_TEXT = "油まみれ";
const IGNITE_TEXT = "引火";
const SLAM_TEXT = "激突";
const IGNITE_COLOR = "#ff8030";
/** 投げる・叩く技の攻撃の長さ（strikeTime に対する割合。すぐ隙へ移る） */
const QUICK_STRIKE_RATIO = 0.3;
const SLAM_STRIKE_RATIO = 0.5;
/** 部屋に最初から置く油溜まりの数と、中心からの距離（部屋の短辺に対する割合） */
const ROOM_PUDDLES = 4;
const ROOM_PUDDLE_RATIO = 0.3;

const HOOKS: BossHooks = {
  approach: (state, e, def, dt) => {
    walkToward(state, e, def, dt);
    dripOil(state, e);
  },
  beginWindup,
  beginStrike,
  tickStrike,
  pickMove,
  followUp,
};

export function updateOilKing(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  const ai = e.ai;
  if (!ai) return;
  // 引火で数えが満ちたら、その場で油まみれへ（怯みが解けるのを待たない）
  checkIgnite(state, e, dt);
  advanceStage(state, e);
  runBossCycle(state, e, def, dt, HOOKS);
}

function advanceStage(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const k = BOSS.oilKing;
  if (ai.stage === STAGE_ONE && e.hp <= e.maxHp * k.phase2Ratio) {
    phaseShift(state, e, FIRE_TEXT, k.color, STAGE_FIRE);
    // 引火の数えは着火の間だけ（第 1 段階の偶然の引火で油まみれを早めない）
    ai.progress = 0;
    igniteRoomPuddles(state, e.roomIndex);
    return;
  }
  // 規則 1: 王を火へ誘って ignitesToDrench 回引火させると、HP に関わらず油まみれ（HP は保険）
  const drenched = (ai.progress ?? 0) >= k.ignitesToDrench || e.hp <= e.maxHp * k.phase3Ratio;
  if (ai.stage === STAGE_FIRE && drenched) phaseShift(state, e, DRENCH_TEXT, k.color, STAGE_DRENCHED);
}

/** 燃える床に立つと引火して怯む（間隔つき。ai.timer を使う） */
function checkIgnite(state: GameState, e: Enemy, dt: number): void {
  const ai = e.ai;
  if (!ai) return;
  ai.timer = Math.max(0, ai.timer - dt);
  if (ai.timer > 0 || terrainAt(state, e.body.pos.x, e.body.pos.y) !== "fire") return;
  const k = BOSS.oilKing;
  ai.timer = k.igniteCooldown;
  ai.progress = (ai.progress ?? 0) + 1;
  spawnBurst(state, e.body.pos, IGNITE_COLOR, 24, 150, 0.5, 2.5);
  pushSfx(state, "burn");
  bossDown(state, e, k.igniteStagger, IGNITE_TEXT, IGNITE_COLOR);
}

// -----------------------------------------------------------------------------
// 技の選び（乱数なし）
// -----------------------------------------------------------------------------

function pickMove(_state: GameState, e: Enemy, read: PlayerRead): number {
  const stage = e.ai?.stage ?? STAGE_ONE;
  const onOil = read.terrain === "oil";
  if (stage === STAGE_DRENCHED) {
    if (read.band === "near") return OIL_SLAM;
    return onOil ? OIL_FIREBOMB : OIL_CHARGE;
  }
  if (stage === STAGE_FIRE) {
    // 油の上と、立ち止まっている相手には火を投げる。遠ければ油壺で足場を汚す
    if (onOil || read.stillSec >= BOSS.rules.stillSec) return OIL_FIREBOMB;
    return read.band === "far" ? OIL_JAR : OIL_CHARGE;
  }
  return read.band === "far" ? OIL_JAR : OIL_CHARGE;
}

/** 連撃: 油まみれの突進は、壁に当たって怯まなければ chargeChain 回まで続けて出す */
function followUp(_state: GameState, e: Enemy, done: number): number | null {
  const ai = e.ai;
  if (!ai || done !== OIL_CHARGE || ai.stage !== STAGE_DRENCHED) return null;
  if (isStaggered(e) || (ai.chain ?? 0) >= BOSS.oilKing.chargeChain) return null;
  return OIL_CHARGE;
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
  const source = { defKey: e.defKey, roomIndex: e.roomIndex };
  switch (ai.move) {
    case OIL_JAR:
      e.phaseTimer = def.strikeTime * QUICK_STRIKE_RATIO;
      for (const p of ai.points ?? []) {
        blastBoth(state, p, k.jarBlast, depthDamage(k.jarDamage, state.depth), def.color, source, e.id);
        placeTerrain(state, p.x, p.y, "oil", k.jarRadius);
      }
      pushSfx(state, "oilSplash");
      return;
    case OIL_FIREBOMB:
      e.phaseTimer = def.strikeTime * QUICK_STRIKE_RATIO;
      blastBoth(state, ai.target, k.fireBombRadius, depthDamage(k.fireBombDamage, state.depth), "#ff6020", source, e.id);
      placeTerrain(state, ai.target.x, ai.target.y, "fire", k.fireBombRadius / 2);
      igniteTerrainAt(state, ai.target.x, ai.target.y, k.fireBombRadius);
      return;
    case OIL_SLAM:
      e.phaseTimer = def.strikeTime * SLAM_STRIKE_RATIO;
      spawnShockwave(state, e.body.pos, k.slamRadius, depthDamage(k.slamDamage, state.depth), e.id);
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
    bossDown(state, e, k.wallStagger, SLAM_TEXT, k.color);
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

/** 部屋に最初から置く油溜まりの位置（部屋の幾何だけで決まる。着火の段階でも同じ場所を読む） */
function roomPuddlePoints(state: GameState, roomIndex: number): Vec[] {
  const room = state.rooms[roomIndex];
  if (!room) return [];
  const r = room.rect;
  const center = { x: (r.x + r.w / 2) * TILE_SIZE, y: (r.y + r.h / 2) * TILE_SIZE };
  const dist = Math.min(r.w, r.h) * TILE_SIZE * ROOM_PUDDLE_RATIO;
  const points: Vec[] = [];
  for (let i = 0; i < ROOM_PUDDLES; i++) points.push(add(center, scale(fromAngle((i / ROOM_PUDDLES) * FULL_CIRCLE + Math.PI / 4), dist)));
  return points;
}

/** ボス部屋に最初から油溜まりを置く（王を燃やすための仕掛け。予告は要らない: 戦いの前からある床） */
export function setupOilKingRoom(state: GameState, roomIndex: number): void {
  for (const p of roomPuddlePoints(state, roomIndex)) {
    seedTerrain(state, p, "oil", BOSS.oilKing.jarRadius, { delay: 0, duration: 0, quiet: true });
  }
}

/** 着火の始まり: 最初の油溜まりに火を点ける（床が燃え、王を誘い込む機会になる） */
function igniteRoomPuddles(state: GameState, roomIndex: number): void {
  for (const p of roomPuddlePoints(state, roomIndex)) igniteTerrainAt(state, p.x, p.y, BOSS.oilKing.jarRadius);
}

/** 署名の技（最深の主の第三の顔が借りる）: 油壺（影 → 割れて油溜まり） */
export const OIL_KING_SIGNATURE = signatureOf("oilKing", OIL_JAR, HOOKS);
