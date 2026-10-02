import { type Enemy, type GameState, type JinzuState, type JinzuStroke, pushSfx } from "../core/state";
import { type Vec, add, clamp, dist, length, normalize, scale, sub } from "../core/vec";
import { type EnemyDef, depthDamage } from "../data/enemies";
import { JIN, JINZU } from "../data/tuning";
import { contactDamageOf } from "./enemyBehaviors";
import { fireEnemyBullet } from "./enemyTraits";
import { moveEnemy, touchPlayer } from "./enemies";
import { jinById } from "./jin";
import { settlePendingStagger, isStaggered } from "./poise";
import { NEVER_TIME } from "./readTiming";
import { isFeared } from "./statusEffects";

/**
 * 陣図に動かされている兵の 1 ステップ（docs/ideas/jinzu-impl.md R3-d・R5）。
 * - 筆を持つ大将と持ち場の兵（stand）は動かず的を向く
 * - 走る兵（run）は phase = strike として画の点列を辿る。これで怯み値の先送り・受け流しの直接の怯み・背面・予告の赤が
 *   1 体の攻撃と同じ規則でそのまま効く（「赤は返せ」が隊の単位でも成り立つ）。当たりは 1 人 1 回まで
 * - 射線の画の射手は走らず、画の向きへ 1 発ずつ撃つ
 * 乱数を引かない。updateEnemies が呼び、true を返したらその敵の通常の AI は回さない
 */

/** 的に最も近い点へ着いたとみなす最小の距離（px）。刻みより小さい端数で止まらない */
const ARRIVE_MIN = 2;
/** 1 ステップに進めた距離がこの割合未満なら、壁・仲間で止まっているとみなす */
const STUCK_MOVE_RATIO = 0.25;
/** 射線の弾が画の終点を越えて飛ぶ余裕（px）。壁に当たらなければ画の先で消える */
const VOLLEY_OVERSHOOT = 40;

/** 的の方を向く（描画の向きだけ。位置は動かさない） */
function faceTarget(e: Enemy, jz: JinzuState): void {
  const dir = normalize(sub(jz.target, e.body.pos));
  if (dir.x !== 0) e.facing = dir;
}

export function stepJinzuMember(state: GameState, e: Enemy, def: EnemyDef, dt: number, speed: number): boolean {
  const run = e.jinzuRun;
  if (!run) return false;
  const jz = jinById(state, run.jin)?.jinzu;
  if (!jz) {
    e.jinzuRun = undefined;
    return false;
  }
  if (run.mode !== "run") {
    faceTarget(e, jz);
    return true;
  }
  const stroke = jz.strokes[run.stroke];
  if (!stroke || stroke.state !== "ink" || isStaggered(e) || isFeared(e)) {
    e.jinzuRun = undefined;
    return false;
  }
  if (run.delay > 0) {
    run.delay -= dt;
    faceTarget(e, jz);
    return true;
  }
  if (stroke.kind === "volley") {
    fireVolley(state, e, def, stroke);
    finishRun(state, e, def, stroke);
    return true;
  }
  if (e.phase !== "strike") beginRun(e);
  stepRun(state, e, def, dt, speed, stroke);
  return true;
}

/** 走り出す: phase を strike にして、赤（確定）から始める。予備動作の時刻は記録しない（黄の出端の判定に残さない） */
function beginRun(e: Enemy): void {
  const run = e.jinzuRun;
  if (!run) return;
  e.phase = "strike";
  e.phaseTimer = JINZU.runMaxSec;
  e.windupTotal = 0;
  e.windupAt = NEVER_TIME;
  e.committedAt = NEVER_TIME;
  e.chainWindup = false;
  run.time = 0;
  run.stuck = 0;
}

/** 走る速さ（敵の速さ × 倍率を上下限で挟む） */
export function runSpeedOf(baseSpeed: number): number {
  return clamp(baseSpeed * JINZU.runSpeedMul, JINZU.runSpeedMin, JINZU.runSpeedMax);
}

function stepRun(state: GameState, e: Enemy, def: EnemyDef, dt: number, speed: number, stroke: JinzuStroke): void {
  const run = e.jinzuRun;
  if (!run) return;
  // 受け流し・怯みで phase が戻った敵は走りを外す（先送りされた怯みは updateEnemies の安全網が払う）
  if (e.phase !== "strike") {
    e.jinzuRun = undefined;
    return;
  }
  run.time += dt;
  const goal = stroke.points[run.next];
  if (!goal) {
    finishRun(state, e, def, stroke);
    return;
  }
  const to = sub(goal, e.body.pos);
  const left = length(to);
  const stepLen = runSpeedOf(speed) * dt;
  const dir = normalize(to, e.strikeDir);
  e.strikeDir = dir;
  if (dir.x !== 0) e.facing = dir;
  const move = left <= Math.max(stepLen, ARRIVE_MIN) ? to : scale(dir, stepLen);
  const before = { ...e.body.pos };
  const hit = moveEnemy(state, e, def, move.x, move.y);
  const moved = dist(before, e.body.pos);
  run.stuck = hit.hitX || hit.hitY || moved < stepLen * STUCK_MOVE_RATIO ? run.stuck + dt : 0;
  if (left <= Math.max(stepLen, ARRIVE_MIN)) advance(e, stroke);
  if (touched(state, e, def, stroke)) return;
  if (run.time >= JINZU.runMaxSec || run.stuck >= JINZU.stuckSec || run.next >= stroke.points.length) finishRun(state, e, def, stroke);
}

/** 次の点へ。隊頭が走り抜けた位置は画の描画が使う */
function advance(e: Enemy, stroke: JinzuStroke): void {
  const run = e.jinzuRun;
  if (!run) return;
  run.next += 1;
  if (stroke.squad[0] !== e.id) return;
  stroke.progress = Math.max(stroke.progress, (run.next - 1) / Math.max(1, stroke.points.length - 1));
}

/**
 * プレイヤーに触れたか。当たり（受け流し・見切りを含む）で走りを終える（1 人 1 回まで）。
 * 受け流しで怯んだ兵は走りを外して（隊頭ならその隊は先頭で詰まる。jinzu.ts）、隙の recover を上書きしない。触れて終えたら true
 */
function touched(state: GameState, e: Enemy, def: EnemyDef, stroke: JinzuStroke): boolean {
  const base = contactDamageOf(e, def) * (e.grade === "strong" ? JIN.strong.damageMul : 1) * JINZU.runDamageMul;
  const damage = Math.round(base);
  if (damage <= 0) return false;
  const result = touchPlayer(state, e, damage);
  if (e.phase !== "strike" || isStaggered(e)) {
    e.jinzuRun = undefined;
    return true;
  }
  if (result === null) return false;
  if (result === "hit") stroke.hit = true;
  finishRun(state, e, def, stroke);
  return true;
}

/** 走り終えた: 隙（recover）へ。先送りされた怯みがあればここで払う（endStrike と同じ） */
function finishRun(state: GameState, e: Enemy, def: EnemyDef, stroke: JinzuStroke): void {
  stroke.finished.push(e.id);
  e.jinzuRun = undefined;
  if (e.phase !== "strike") {
    e.attackCooldown = Math.max(e.attackCooldown, def.attackInterval);
    return;
  }
  if (settlePendingStagger(state, e)) return;
  e.phase = "recover";
  e.phaseTimer = def.recover;
}

/** 射線: 画の向きへ 1 発。弾は射手の位置ではなく、射手から引いた画の線の上から出る（描く線 = 弾の道）。画の長さ + 少しで消える */
function fireVolley(state: GameState, e: Enemy, def: EnemyDef, stroke: JinzuStroke): void {
  const a = stroke.points[0];
  const b = stroke.points[stroke.points.length - 1];
  if (!a || !b) return;
  const dir = normalize(sub(b, a));
  const rel = sub(e.body.pos, a);
  const along = Math.max(0, rel.x * dir.x + rel.y * dir.y);
  const pos: Vec = add(a, scale(dir, along + e.body.radius + 2));
  const speed = JINZU.volleySpeed;
  fireEnemyBullet(state, {
    pos,
    dir,
    speed,
    damage: Math.round(depthDamage(JINZU.volleyDamage, state.depth)),
    color: JINZU.volleyColor,
    radius: JINZU.volleyRadius,
    life: (Math.max(0, dist(a, b) - along) + VOLLEY_OVERSHOOT) / speed,
    sourceId: e.id,
  });
  e.strikeDir = dir;
  if (dir.x !== 0) e.facing = dir;
  e.attackCooldown = Math.max(e.attackCooldown, def.attackInterval);
  pushSfx(state, "enemyShoot");
}
