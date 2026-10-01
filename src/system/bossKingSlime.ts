import { type Enemy, type GameState, pushSfx } from "../core/state";
import { type Vec, add, dist, fromAngle, scale, sub } from "../core/vec";
import { type EnemyDef, depthDamage, enemyDef } from "../data/enemies";
import { BOSS, FEEL } from "../data/tuning";
import { TILE_SIZE, rectCenterPx } from "../map/grid";
import { damagePlayer } from "./combat";
import { addFloatingText, shake, spawnBurst } from "./effects";
import { type EnemyTelegraph, createEnemy, moveEnemy, scaledWindup } from "./enemies";
import { seedTerrain } from "./enemyTerrain";
import { spawnLanding, spawnShockwave } from "./hazards";
import { circlesOverlap, overlapsWall } from "./physics";
import { inflictOnPlayer } from "./statusEffects";
import { phaseShift } from "./boss";
import { type BossHooks, type PlayerRead, readPlayer, runBossCycle, signatureOf, toPlayer } from "./bossKit";

/**
 * ボス: スライム王（章 1。docs/ideas/boss-impl.md 2-2）。
 * 第 1 段階（跳躍）= 影の予告の後に着地の衝撃波。止まっている相手には着地の直後にもう 1 度跳ぶ /
 * 第 2 段階（分裂）= HP で分裂体を出し、着地点に毒沼を残す。間隔ごとに分裂体を呑み、消化し終えると回復する
 * （消化中は動かない隙。怯ませると吐き出して回復しない）/
 * 第 3 段階（膨張）= 分裂体が 0 体になると（倒されても呑まれても）HP に関わらず来る。部屋の中央で膨らみ、
 * 四隅だけが安全な衝撃波を重ねる。膨張の後は長い硬直。
 * 予告: 跳躍 = 着地点の影 / 呑み = 小さな輪と着地点の影 / 膨張 = 衝撃波の届く範囲の影
 */

const STAGE_JUMP = 1;
const STAGE_SPLIT = 2;
const STAGE_INFLATE = 3;
/** ai.move: 技 */
export const KS_JUMP = 0;
export const KS_SWALLOW = 1;
/** 部屋の中央へ跳ぶ（膨張の前段。続けて KS_INFLATE） */
export const KS_CENTER = 2;
export const KS_INFLATE = 3;
const FULL_CIRCLE = Math.PI * 2;
const SPLIT_TEXT = "分裂！";
const INFLATE_TEXT = "膨張";
const SWALLOW_TEXT = "呑み込み";
const SPIT_TEXT = "吐き出し";
const SPLIT_TEXT_COLOR = "#80ff80";
const SWALLOW_TEXT_COLOR = "#c0ffb0";
const HEAL_COLOR = "#60ff90";
const MINION_KEY = "slime";
/** 着地直下でのダメージ判定半径（衝撃波の半径に対する割合） */
const SLAM_CORE_RATIO = 0.4;
const SPLIT_OFFSET = 18;
/** 中央に着いたとみなす距離（px） */
const CENTER_TOLERANCE = TILE_SIZE;
/** 浮き文字の持ち上げ（px） */
const TEXT_LIFT = 18;
/** 衝撃波の時刻の比較の余裕（浮動小数の積み上げで最後の 1 重を落とさない） */
const WAVE_EPSILON = 1e-6;

const HOOKS: BossHooks = {
  approach,
  beginWindup,
  beginStrike,
  tickStrike,
  pickMove,
  followUp,
  chainWindupMul: (_e, next) => (next === KS_INFLATE ? 1 : BOSS.rules.chainWindupMul),
  recoverTime,
  onRecoverEnd,
};

export function updateKingSlime(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  const ai = e.ai;
  if (!ai) return;
  // 前の呑み（か分裂）からの秒。第 2 段階の技の枝が読む
  ai.timer += dt;
  spitIfInterrupted(state, e);
  advanceStage(state, e);
  runBossCycle(state, e, def, dt, HOOKS);
}

function speedMul(e: Enemy): number {
  return (e.ai?.stage ?? STAGE_JUMP) >= STAGE_SPLIT ? BOSS.kingSlime.phase2SpeedMul : 1;
}

// -----------------------------------------------------------------------------
// 段階
// -----------------------------------------------------------------------------

function advanceStage(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const ks = BOSS.kingSlime;
  if (ai.stage === STAGE_JUMP && e.hp <= e.maxHp * ks.phase2Ratio) {
    splitKingSlime(state, e);
    return;
  }
  // 規則 1: 分裂体を片付けた時点で HP に関わらず膨張へ（HP は保険）
  if (ai.stage === STAGE_SPLIT && (splitsOf(state, e).length === 0 || e.hp <= e.maxHp * ks.phase3Ratio)) {
    phaseShift(state, e, INFLATE_TEXT, kingColor(), STAGE_INFLATE);
  }
}

function kingColor(): string {
  return enemyDef("kingSlime").color;
}

function splitKingSlime(state: GameState, e: Enemy): void {
  phaseShift(state, e, SPLIT_TEXT, SPLIT_TEXT_COLOR, STAGE_SPLIT);
  const ai = e.ai;
  if (ai) ai.timer = 0;
  const ks = BOSS.kingSlime;
  const slime = enemyDef(MINION_KEY);
  for (let i = 0; i < ks.splitCount; i++) {
    const a = (i / ks.splitCount) * FULL_CIRCLE;
    const pos = add(e.body.pos, scale(fromAngle(a), SPLIT_OFFSET));
    const safe = overlapsWall(state, pos.x, pos.y, slime.radius) ? { ...e.body.pos } : pos;
    const minion = createEnemy(state, slime, safe, e.roomIndex, true);
    minion.leaderId = e.id;
    state.enemies.push(minion);
  }
}

/** 生きている分裂体 */
export function splitsOf(state: GameState, e: Enemy): Enemy[] {
  return state.enemies.filter((o) => o.hp > 0 && o.leaderId === e.id && o.defKey === MINION_KEY);
}

// -----------------------------------------------------------------------------
// 技の選び（乱数なし）
// -----------------------------------------------------------------------------

function pickMove(state: GameState, e: Enemy, read: PlayerRead): number {
  const ai = e.ai;
  const stage = ai?.stage ?? STAGE_JUMP;
  if (stage === STAGE_SPLIT) {
    const due = (ai?.timer ?? 0) >= BOSS.kingSlime.swallowEvery;
    return due && splitsOf(state, e).length > 0 ? KS_SWALLOW : KS_JUMP;
  }
  if (stage === STAGE_INFLATE) {
    // 遠くで様子を見ている相手には跳んで詰める（その後また中央へ戻る）
    if (read.band === "far") return KS_JUMP;
    return atCenter(state, e) ? KS_INFLATE : KS_CENTER;
  }
  return KS_JUMP;
}

/** 連撃: 第 1 段階は止まっている相手へもう 1 度跳ぶ。中央に着いたら膨張 */
function followUp(state: GameState, e: Enemy, done: number): number | null {
  const ai = e.ai;
  if (!ai) return null;
  if (done === KS_CENTER) return KS_INFLATE;
  if (done !== KS_JUMP || ai.stage !== STAGE_JUMP) return null;
  if ((ai.chain ?? 0) >= BOSS.kingSlime.stillJumpChain) return null;
  return readPlayer(state, e).stillSec >= BOSS.rules.stillSec ? KS_JUMP : null;
}

function recoverTime(_state: GameState, e: Enemy, def: EnemyDef): number {
  const ks = BOSS.kingSlime;
  const move = e.ai?.move;
  if (move === KS_INFLATE) return ks.exhaustTime;
  if (move === KS_SWALLOW && (e.ai?.digest ?? 0) > 0) return ks.digestTime;
  return def.recover / speedMul(e);
}

/** 消化し終えた: 呑んだ数だけ回復する */
function onRecoverEnd(state: GameState, e: Enemy): void {
  const ai = e.ai;
  const digest = ai?.digest ?? 0;
  if (!ai || digest <= 0) return;
  ai.digest = 0;
  const heal = Math.round(digest * BOSS.kingSlime.swallowHealRatio * e.maxHp);
  e.hp = Math.min(e.maxHp, e.hp + heal);
  spawnBurst(state, e.body.pos, HEAL_COLOR, 16, 80, 0.5, 2);
  pushSfx(state, "heal");
}

/** 消化中に怯まされた（硬直の外へ出された）なら、呑んだものを吐き出して回復しない */
function spitIfInterrupted(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai || (ai.digest ?? 0) <= 0) return;
  if (e.phase === "recover" && ai.move === KS_SWALLOW) return;
  ai.digest = 0;
  addFloatingText(state, { x: e.body.pos.x, y: e.body.pos.y - TEXT_LIFT }, SPIT_TEXT, SWALLOW_TEXT_COLOR, 1.5, 1.1);
  spawnBurst(state, e.body.pos, kingColor(), 14, 120, 0.4, 2);
}

// -----------------------------------------------------------------------------
// 状態機械のフック
// -----------------------------------------------------------------------------

function approach(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  const dir = toPlayer(state, e);
  if (dir.x !== 0) e.facing = dir;
  // 膨張は中央で待つ（歩くと四隅の安全が崩れる）
  if (e.ai?.move === KS_INFLATE) return;
  const speed = def.speed * speedMul(e) * dt;
  moveEnemy(state, e, def, dir.x * speed, dir.y * speed);
}

function beginWindup(state: GameState, e: Enemy, def: EnemyDef): void {
  const ai = e.ai;
  if (!ai) return;
  e.strikeDir = toPlayer(state, e);
  if (ai.move === KS_INFLATE) {
    e.phaseTimer = scaledWindup(BOSS.kingSlime.inflateWindup, state.depth);
    // 衝撃波の届く範囲を影で見せる（部屋で半径が変わるので、形の予告ではなく影で出す）
    spawnLanding(state, e.body.pos, inflateRadius(state, e), e.phaseTimer, e.id);
    return;
  }
  // 第 2 段階の速さと深度の短縮を掛けても、基準の 60% は残す（scaledWindup の下限）
  e.phaseTimer = scaledWindup(def.windup, state.depth, 1 / speedMul(e));
}

function beginStrike(state: GameState, e: Enemy, def: EnemyDef): void {
  const ai = e.ai;
  if (!ai) return;
  const ks = BOSS.kingSlime;
  switch (ai.move) {
    case KS_INFLATE:
      ai.counter = 0;
      e.phaseTimer = Math.max(0, ks.waveCount - 1) * ks.waveGap;
      fireInflateWaves(state, e);
      return;
    case KS_SWALLOW: {
      ai.timer = 0;
      const prey = nearest(splitsOf(state, e), e.body.pos);
      leap(state, e, def, prey ? prey.body.pos : e.body.pos, ks.swallowHopTime, ks.swallowRingRadius);
      return;
    }
    case KS_CENTER:
      leap(state, e, def, roomCenter(state, e), jumpTime(e), ks.swallowRingRadius);
      return;
    default:
      leap(state, e, def, state.player.body.pos, jumpTime(e), ks.shockRadius);
      return;
  }
}

function jumpTime(e: Enemy): number {
  const ks = BOSS.kingSlime;
  return (e.ai?.stage ?? STAGE_JUMP) >= STAGE_SPLIT ? ks.phase2JumpTime : ks.jumpTime;
}

/** 跳ぶ: 着地点を決めて影を出す（影の間は空中で無害） */
function leap(state: GameState, e: Enemy, def: EnemyDef, to: Vec, time: number, shadow: number): void {
  const ai = e.ai;
  if (!ai) return;
  ai.target = { ...to };
  e.phaseTimer = time;
  spawnLanding(state, ai.target, shadow, time);
  spawnBurst(state, e.body.pos, def.color, 10, 90, 0.3, 2);
}

function tickStrike(state: GameState, e: Enemy, def: EnemyDef, dt: number): boolean {
  const ai = e.ai;
  if (!ai) return false;
  if (ai.move === KS_INFLATE) {
    fireInflateWaves(state, e);
    return false;
  }
  // 空中: 着地点へ向かって移動する（壁は無視しない）。phaseTimer は runBossCycle が減らした後
  const remaining = Math.max(dt, e.phaseTimer + dt);
  const step = scale(sub(ai.target, e.body.pos), Math.min(1, dt / remaining));
  moveEnemy(state, e, def, step.x, step.y);
  if (e.phaseTimer > 0) return false;
  land(state, e, def);
  return true;
}

function land(state: GameState, e: Enemy, def: EnemyDef): void {
  switch (e.ai?.move) {
    case KS_SWALLOW:
      swallow(state, e);
      return;
    case KS_CENTER:
      spawnBurst(state, e.body.pos, def.color, 16, 120, 0.4, 2);
      shake(state, FEEL.shakeHeavy);
      pushSfx(state, "wallHit");
      return;
    default:
      slam(state, e, def);
      return;
  }
}

/** 跳躍の着地: 衝撃波 + 真下の潰し。第 2 段階は着地点に毒沼（床が減る） */
function slam(state: GameState, e: Enemy, def: EnemyDef): void {
  const ks = BOSS.kingSlime;
  const dmg = depthDamage(ks.shockDamage, state.depth);
  spawnShockwave(state, e.body.pos, ks.shockRadius, dmg, e.id);
  spawnBurst(state, e.body.pos, def.color, 24, 160, 0.5, 3);
  shake(state, FEEL.shakeSpecial);
  pushSfx(state, "wallHit");
  const p = state.player.body;
  if (circlesOverlap(e.body.pos.x, e.body.pos.y, ks.shockRadius * SLAM_CORE_RATIO, p.pos.x, p.pos.y, p.radius)) {
    if (damagePlayer(state, dmg, e.body.pos, e) === "hit") inflictOnPlayer(state, e, "shockwave");
  }
  if (e.ai?.stage === STAGE_SPLIT) {
    seedTerrain(state, e.body.pos, "bog", ks.acidRadius, { delay: 0, duration: ks.acidTime, quiet: true });
  }
}

/** 呑み: 着地点の近くの分裂体を 1 体消す（撃破に数えない）。消化の硬直へ */
function swallow(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const reach = BOSS.kingSlime.swallowRingRadius;
  const prey = nearest(
    splitsOf(state, e).filter((o) => dist(o.body.pos, e.body.pos) <= reach + o.body.radius),
    e.body.pos,
  );
  if (!prey) return;
  prey.hp = 0;
  prey.vanished = true;
  ai.digest = (ai.digest ?? 0) + 1;
  addFloatingText(state, { x: e.body.pos.x, y: e.body.pos.y - TEXT_LIFT }, SWALLOW_TEXT, SWALLOW_TEXT_COLOR, 1.5, 1.1);
  spawnBurst(state, prey.body.pos, kingColor(), 14, 90, 0.4, 2);
  pushSfx(state, "wallHit");
}

/** 膨張: 攻撃の始まりから waveGap 秒ごとに衝撃波を waveCount 重（ai.counter = 出した数） */
function fireInflateWaves(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const ks = BOSS.kingSlime;
  const total = Math.max(0, ks.waveCount - 1) * ks.waveGap;
  const elapsed = total - e.phaseTimer;
  const radius = inflateRadius(state, e);
  const dmg = depthDamage(ks.waveDamage, state.depth);
  while (ai.counter < ks.waveCount && elapsed + WAVE_EPSILON >= ai.counter * ks.waveGap) {
    spawnShockwave(state, e.body.pos, radius, dmg, e.id);
    ai.counter += 1;
    shake(state, FEEL.shakeSpecial);
  }
}

/** 膨張の衝撃波の半径: 部屋の最も近い角までの距離 × cornerSafeRatio（四隅だけ届かない） */
export function inflateRadius(state: GameState, e: Enemy): number {
  const room = state.rooms[e.roomIndex];
  if (!room) return BOSS.kingSlime.shockRadius;
  const r = room.rect;
  const xs = [r.x * TILE_SIZE, (r.x + r.w) * TILE_SIZE];
  const ys = [r.y * TILE_SIZE, (r.y + r.h) * TILE_SIZE];
  let nearestCorner = Number.POSITIVE_INFINITY;
  for (const x of xs) for (const y of ys) nearestCorner = Math.min(nearestCorner, dist(e.body.pos, { x, y }));
  return nearestCorner * BOSS.kingSlime.cornerSafeRatio;
}

function roomCenter(state: GameState, e: Enemy): Vec {
  const room = state.rooms[e.roomIndex];
  return room ? rectCenterPx(room.rect) : { ...e.body.pos };
}

function atCenter(state: GameState, e: Enemy): boolean {
  return dist(e.body.pos, roomCenter(state, e)) <= CENTER_TOLERANCE;
}

function nearest(list: readonly Enemy[], from: Vec): Enemy | undefined {
  let best: Enemy | undefined;
  let bestD = Number.POSITIVE_INFINITY;
  for (const o of list) {
    const d = dist(o.body.pos, from);
    if (d < bestD) {
      best = o;
      bestD = d;
    }
  }
  return best;
}

/** 空中の総秒（描画の跳ねの高さ用）。空中でない（膨張・地上）なら null */
export function kingSlimeAirTime(e: Enemy): number | null {
  if (e.phase !== "strike") return null;
  switch (e.ai?.move) {
    case KS_INFLATE:
      return null;
    case KS_SWALLOW:
      return BOSS.kingSlime.swallowHopTime;
    default:
      return jumpTime(e);
  }
}

/** 予告の形: 呑みは小さな輪（跳躍と膨張は影） */
export function kingSlimeTelegraph(e: Enemy): EnemyTelegraph {
  if (e.ai?.move === KS_SWALLOW) return { kind: "ring", radius: BOSS.kingSlime.swallowRingRadius };
  return null;
}

/** 署名の技（最深の主の第三の顔が借りる）: 第 1 段階の跳躍 */
export const KING_SLIME_SIGNATURE = signatureOf("kingSlime", KS_JUMP, HOOKS);
