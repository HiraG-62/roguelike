import { type Enemy, type GameState, pushSfx } from "../core/state";
import { type Vec, add, fromAngle, length, normalize, scale, sub } from "../core/vec";
import { type EnemyDef, depthDamageBonus, enemyDef } from "../data/enemies";
import { BOSS, FEEL } from "../data/tuning";
import { addFloatingText, shake, spawnBurst } from "./effects";
import { type EnemyTelegraph, createEnemy, moveEnemy, scaledWindup } from "./enemies";
import { blastBoth } from "./enemyTerrain";
import { fanDirections, fireEnemyBullet, spawnSpot } from "./enemyTraits";
import { spawnLanding } from "./hazards";
import { overlapsWall } from "./physics";
import { applyStagger } from "./poise";
import { phaseShift } from "./boss";
import { type BossHooks, lungeStep, resetSequence, runBossCycle, toPlayer, walkToward } from "./bossKit";
import { placeTerrain } from "./terrain";

/**
 * ボス: 盗賊王（docs/ideas/enemies.md B3「逃げるボス」。3 部屋が連なる形は見送り、1 部屋の中で逃げ回る）。
 * 第 1 段階 = 距離を取って逃げながら短剣の扇・地雷・煙玉 / 第 2 段階 = 取り巻きを呼び、地雷を多く撒く /
 * 第 3 段階 = 開き直って突進と短剣で全力で戦う（逃げない）。
 * 部屋のギミック: 逃げ道が壁で塞がれた（壁際・角）ままプレイヤーに詰め寄られ続けると、追い詰められてダウンする。
 * 逃げ場の無い位置へ押し込むほど早く崩れる。予告: 短剣 = 扇 / 地雷 = 落下点の影 / 煙玉 = 足元の輪 / 突進 = 線
 */

const STAGE_ONE = 1;
const STAGE_TRAPS = 2;
const STAGE_CORNERED = 3;
/** ai.move: 技 */
export const THIEF_KNIFE = 0;
export const THIEF_MINE = 1;
export const THIEF_SMOKE = 2;
export const THIEF_DASH = 3;
const SEQUENCE: Readonly<Record<number, readonly number[]>> = {
  [STAGE_ONE]: [THIEF_KNIFE, THIEF_MINE, THIEF_KNIFE, THIEF_SMOKE],
  [STAGE_TRAPS]: [THIEF_MINE, THIEF_SMOKE, THIEF_KNIFE, THIEF_MINE],
  [STAGE_CORNERED]: [THIEF_DASH, THIEF_KNIFE, THIEF_DASH, THIEF_MINE],
};
const FULL_CIRCLE = Math.PI * 2;
const TRAPS_TEXT = "手下ども、出番だ";
const CORNERED_TEXT = "開き直った";
const DOWN_TEXT = "追い詰めた";
const MINION_KEY = "thief";
const MINE_KEY = "enemyMine";
/** 投げる技の攻撃の長さ（strikeTime に対する割合。すぐ隙へ移る） */
const QUICK_STRIKE_RATIO = 0.3;
/** 地雷の落下点の影の半径（落ちるまでの予告。地雷そのものの炸裂は踏まれてから別に予告する） */
const MINE_MARK_RADIUS = 8;
/** 追い詰められかけている間の焦りの汗（予告）の間隔（ステップ）と色 */
const SWEAT_EVERY = 6;
const SWEAT_COLOR = "#c0e0ff";
const SWEAT_PARTICLES = 3;
/** 浮き文字の持ち上げ（px） */
const TEXT_LIFT = 20;

function sequenceOf(e: Enemy): readonly number[] {
  return SEQUENCE[e.ai?.stage ?? STAGE_ONE] ?? SEQUENCE[STAGE_ONE] ?? [];
}

const HOOKS: BossHooks = {
  approach,
  beginWindup,
  beginStrike,
  tickStrike,
  sequence: sequenceOf,
};

export function updateThiefKing(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  const ai = e.ai;
  if (!ai) return;
  ai.timer = Math.max(0, ai.timer - dt);
  advanceStage(state, e);
  runBossCycle(state, e, def, dt, HOOKS);
}

function advanceStage(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const k = BOSS.thiefKing;
  if (ai.stage === STAGE_ONE && e.hp <= e.maxHp * k.phase2Ratio) {
    phaseShift(state, e, TRAPS_TEXT, k.color, STAGE_TRAPS);
    resetSequence(e, sequenceOf(e));
    summonThieves(state, e, k.minions[1] ?? 0);
    return;
  }
  if (ai.stage === STAGE_TRAPS && e.hp <= e.maxHp * k.phase3Ratio) {
    phaseShift(state, e, CORNERED_TEXT, k.color, STAGE_CORNERED);
    resetSequence(e, sequenceOf(e));
    summonThieves(state, e, k.minions[2] ?? 0);
    ai.cornered = 0;
  }
}

/** ボス部屋に最初から手下を置く（部屋の封鎖と同時に動き出す） */
export function setupThiefKingRoom(state: GameState, boss: Enemy): void {
  summonThieves(state, boss, BOSS.thiefKing.minions[0] ?? 0, false);
}

/** 取り巻きの盗賊を王の周りに呼ぶ。戦いの最中は出現の魔法陣（spawning）がそのまま予告になる */
function summonThieves(state: GameState, e: Enemy, count: number, spawning = true): void {
  const def = enemyDef(MINION_KEY);
  const k = BOSS.thiefKing;
  for (let i = 0; i < count; i++) {
    const want = add(e.body.pos, scale(fromAngle((i / Math.max(1, count)) * FULL_CIRCLE + e.id), k.minionSpread));
    const minion = createEnemy(state, def, spawnSpot(state, want, e.body.pos, def.radius), e.roomIndex, spawning);
    minion.leaderId = e.id;
    // 蘇生と同じ扱い: ドロップ・撃破数を出さない（呼ばせ続けて稼がせない）
    minion.revived = true;
    state.enemies.push(minion);
  }
  if (spawning && count > 0) pushSfx(state, "ambush");
}

// -----------------------------------------------------------------------------
// 追跡中: 第 1・2 段階は逃げる（追い詰めるとダウン）、第 3 段階は寄る
// -----------------------------------------------------------------------------

function approach(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  if (e.ai?.stage === STAGE_CORNERED) {
    walkToward(state, e, def, dt);
    return;
  }
  flee(state, e, def, dt);
}

/**
 * プレイヤーから keepAway まで離れる。逃げる向きへ進めなかった（壁際・角で塞がれた）まま詰め寄られていれば
 * 追い詰められた秒が溜まる。壁沿いに滑れても、逃げる向きへの進みで測るので壁際は塞がれた扱いになる
 */
function flee(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  const k = BOSS.thiefKing;
  const to = sub(state.player.body.pos, e.body.pos);
  const d = length(to);
  const dir = normalize(to, e.facing);
  if (dir.x !== 0) e.facing = dir;
  if (d >= k.keepAway) {
    easeCornered(e, dt);
    return;
  }
  const away = scale(dir, -1);
  const want = def.speed * k.fleeSpeedMul * dt;
  const before = { ...e.body.pos };
  moveEnemy(state, e, def, away.x * want, away.y * want);
  const moved = sub(e.body.pos, before);
  const progress = moved.x * away.x + moved.y * away.y;
  const blocked = want > 0 && progress < want * k.stuckRatio;
  if (blocked && d <= k.cornerRadius) {
    pressCornered(state, e, dt);
    return;
  }
  easeCornered(e, dt);
}

function easeCornered(e: Enemy, dt: number): void {
  const ai = e.ai;
  if (!ai) return;
  ai.cornered = Math.max(0, (ai.cornered ?? 0) - dt);
}

/** 追い詰められている秒を溜める。焦りの汗が予告。溜まり切るとダウン（間隔つき。ai.timer） */
function pressCornered(state: GameState, e: Enemy, dt: number): void {
  const ai = e.ai;
  if (!ai) return;
  const k = BOSS.thiefKing;
  ai.cornered = (ai.cornered ?? 0) + dt;
  if (state.tick % SWEAT_EVERY === 0) {
    spawnBurst(state, { x: e.body.pos.x, y: e.body.pos.y - e.body.radius }, SWEAT_COLOR, SWEAT_PARTICLES, 40, 0.3, 1.5);
  }
  if (ai.cornered < k.cornerTime || ai.timer > 0) return;
  ai.cornered = 0;
  ai.timer = k.cornerCooldown;
  addFloatingText(state, { x: e.body.pos.x, y: e.body.pos.y - TEXT_LIFT }, DOWN_TEXT, k.color, 1.5, 1.1);
  shake(state, FEEL.shakeHeavy);
  pushSfx(state, "wallHit");
  applyStagger(state, e, k.cornerStagger, { selfInflicted: true });
}

/** 追い詰められかけている割合（0..1。描画・テスト用） */
export function thiefKingCornered(e: Enemy): number {
  return Math.min(1, (e.ai?.cornered ?? 0) / BOSS.thiefKing.cornerTime);
}

// -----------------------------------------------------------------------------
// 技
// -----------------------------------------------------------------------------

function beginWindup(state: GameState, e: Enemy, def: EnemyDef): void {
  const ai = e.ai;
  if (!ai) return;
  const k = BOSS.thiefKing;
  e.strikeDir = toPlayer(state, e);
  switch (ai.move) {
    case THIEF_MINE:
      e.phaseTimer = scaledWindup(k.mineFall, state.depth);
      ai.points = minePoints(state, e);
      for (const p of ai.points) spawnLanding(state, p, MINE_MARK_RADIUS, e.phaseTimer, e.id);
      return;
    case THIEF_SMOKE:
      e.phaseTimer = scaledWindup(k.smokeFall, state.depth);
      // 煙玉は自分の足元に叩きつける。影は王に付いて動く（逃げながら投げる）
      spawnLanding(state, e.body.pos, k.smokeRadius, e.phaseTimer, e.id, true);
      return;
    default:
      e.phaseTimer = scaledWindup(def.windup, state.depth);
      return;
  }
}

/** 地雷の落下点: プレイヤーとの間に扇状に並べる（追ってくる道を塞ぐ）。壁に掛かる点は捨てる */
function minePoints(state: GameState, e: Enemy): Vec[] {
  const k = BOSS.thiefKing;
  const count = e.ai?.stage === STAGE_ONE ? k.mineCount : k.mineCountLate;
  const points: Vec[] = [];
  for (const dir of fanDirections(e.strikeDir, count, k.knifeSpreadDeg * 2)) {
    const q = add(e.body.pos, scale(dir, k.mineSpread));
    if (!overlapsWall(state, q.x, q.y, MINE_MARK_RADIUS)) points.push(q);
  }
  return points;
}

function beginStrike(state: GameState, e: Enemy, def: EnemyDef): void {
  const ai = e.ai;
  if (!ai) return;
  const k = BOSS.thiefKing;
  switch (ai.move) {
    case THIEF_KNIFE:
      e.phaseTimer = def.strikeTime * QUICK_STRIKE_RATIO;
      throwKnives(state, e);
      return;
    case THIEF_MINE:
      e.phaseTimer = def.strikeTime * QUICK_STRIKE_RATIO;
      for (const p of ai.points ?? []) dropMine(state, e, p);
      pushSfx(state, "bombFuse");
      return;
    case THIEF_SMOKE: {
      e.phaseTimer = def.strikeTime * QUICK_STRIKE_RATIO;
      const source = { defKey: e.defKey, roomIndex: e.roomIndex };
      blastBoth(state, e.body.pos, k.smokeRadius, k.smokeDamage + depthDamageBonus(state.depth), k.color, source, e.id);
      placeTerrain(state, e.body.pos.x, e.body.pos.y, "smoke", k.smokeRadius, k.smokeTime);
      pushSfx(state, "smokeBomb");
      return;
    }
    default:
      e.phaseTimer = k.dashTime;
      e.strikeDir = toPlayer(state, e);
      if (e.strikeDir.x !== 0) e.facing = e.strikeDir;
      return;
  }
}

function throwKnives(state: GameState, e: Enemy): void {
  const k = BOSS.thiefKing;
  const count = e.ai?.stage === STAGE_CORNERED ? k.rageKnifeCount : k.knifeCount;
  const damage = k.knifeDamage + depthDamageBonus(state.depth);
  for (const dir of fanDirections(e.strikeDir, count, k.knifeSpreadDeg)) {
    fireEnemyBullet(state, { pos: add(e.body.pos, scale(dir, e.body.radius + 2)), dir, speed: k.knifeSpeed, damage, color: k.color, sourceId: e.id });
  }
  pushSfx(state, "enemyShoot");
}

/** 地雷を置く（自分の地雷が上限なら置かない）。王自身は踏んでも起爆しない（leaderId） */
function dropMine(state: GameState, e: Enemy, pos: Vec): void {
  const alive = state.enemies.filter((o) => o.hp > 0 && o.defKey === MINE_KEY && o.leaderId === e.id).length;
  if (alive >= BOSS.thiefKing.mineMax) return;
  const def = enemyDef(MINE_KEY);
  const mine = createEnemy(state, def, spawnSpot(state, pos, e.body.pos, def.radius), e.roomIndex, false);
  mine.leaderId = e.id;
  mine.revived = true;
  mine.phase = "chase";
  state.enemies.push(mine);
}

/** 第 3 段階の突進: 壁に激突すると怯む */
function tickStrike(state: GameState, e: Enemy, def: EnemyDef, dt: number): boolean {
  if (e.ai?.move !== THIEF_DASH) return false;
  const k = BOSS.thiefKing;
  const step = lungeStep(state, e, def, k.dashSpeedMul, dt);
  if (step.wall) {
    shake(state, FEEL.shakeHeavy);
    pushSfx(state, "wallHit");
    applyStagger(state, e, k.wallStagger, { selfInflicted: true });
    return true;
  }
  return step.touched;
}

/** 予告の形: 短剣は扇、突進は線（地雷と煙玉は影） */
export function thiefKingTelegraph(e: Enemy): EnemyTelegraph {
  const k = BOSS.thiefKing;
  if (e.ai?.move === THIEF_KNIFE) return { kind: "cone", range: k.knifeRange, halfDeg: k.knifeSpreadDeg / 2 };
  if (e.ai?.move === THIEF_DASH) return { kind: "line" };
  return null;
}
