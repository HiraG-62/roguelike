import { type Enemy, type GameState, pushSfx } from "../core/state";
import { type Vec, add, length, normalize, scale, sub } from "../core/vec";
import { type EnemyDef, depthDamageBonus } from "../data/enemies";
import { FEEL } from "../data/tuning";
import { damagePlayer } from "./combat";
import { shake } from "./effects";
import { moveEnemy } from "./enemies";
import { circlesOverlap } from "./physics";
import { inflictOnPlayer } from "./statusEffects";

/**
 * Wave 3 のボス（油壺の王・群れの母・図書館の司書・鏡の騎士）の共通の骨組み。
 * 状態機械は chase → windup → strike → recover を回し、技の中身は各ボスのファイルが BossHooks で渡す。
 * ai.stage = 段階（1 始まり）/ ai.counter = 段階ごとの技の並びの添字 / ai.move = 今の技
 */

export interface BossHooks {
  /** 追跡中の動き */
  approach(state: GameState, e: Enemy, def: EnemyDef, dt: number): void;
  /** 予備動作に入る（phaseTimer を決め、影などの予告を置く） */
  beginWindup(state: GameState, e: Enemy, def: EnemyDef): void;
  /** 攻撃の出だし（phaseTimer を決める。隙へ直接移るなら phase を変えてよい） */
  beginStrike(state: GameState, e: Enemy, def: EnemyDef): void;
  /** 攻撃中の毎ステップ。true を返すと攻撃を打ち切る */
  tickStrike?(state: GameState, e: Enemy, def: EnemyDef, dt: number): boolean;
  /** 段階ごとの技の並び */
  sequence(e: Enemy): readonly number[];
  /** 攻撃間隔の倍率（激昂など） */
  intervalMul?(e: Enemy): number;
}

export function runBossCycle(state: GameState, e: Enemy, def: EnemyDef, dt: number, h: BossHooks): void {
  switch (e.phase) {
    case "chase":
      h.approach(state, e, def, dt);
      if (e.attackCooldown > 0) return;
      e.phase = "windup";
      pushSfx(state, "enemyWindup");
      h.beginWindup(state, e, def);
      return;
    case "windup":
      e.phaseTimer -= dt;
      if (e.phaseTimer > 0) return;
      e.phase = "strike";
      h.beginStrike(state, e, def);
      return;
    case "strike":
      e.phaseTimer -= dt;
      if (h.tickStrike?.(state, e, def, dt)) e.phaseTimer = 0;
      if (e.phaseTimer > 0 || e.phase !== "strike") return;
      e.phase = "recover";
      e.phaseTimer = def.recover;
      return;
    case "recover":
      e.phaseTimer -= dt;
      if (e.phaseTimer > 0) return;
      e.phase = "chase";
      e.attackCooldown = def.attackInterval * (h.intervalMul?.(e) ?? 1);
      advanceMove(e, h.sequence(e));
      return;
    default:
      return;
  }
}

/** 並びの次の技へ */
function advanceMove(e: Enemy, seq: readonly number[]): void {
  const ai = e.ai;
  if (!ai || seq.length === 0) return;
  ai.counter = (ai.counter + 1) % seq.length;
  ai.move = seq[ai.counter] ?? ai.move;
}

/** 段階が変わったら並びの先頭から */
export function resetSequence(e: Enemy, seq: readonly number[]): void {
  const ai = e.ai;
  if (!ai) return;
  ai.counter = 0;
  ai.move = seq[0] ?? 0;
}

export function toPlayer(state: GameState, e: Enemy): Vec {
  return normalize(sub(state.player.body.pos, e.body.pos));
}

/** keep の距離を保ち、横へふらふら動く */
export function keepDistance(state: GameState, e: Enemy, def: EnemyDef, keep: number, dt: number): void {
  const to = sub(state.player.body.pos, e.body.pos);
  const d = length(to);
  const dir = normalize(to);
  if (dir.x !== 0) e.facing = dir;
  const radial = d < keep * 0.8 ? -1 : d > keep * 1.3 ? 1 : 0;
  const perp = { x: -dir.y, y: dir.x };
  const move = add(scale(dir, radial), scale(perp, Math.sin(e.animTime) * 0.6));
  moveEnemy(state, e, def, move.x * def.speed * dt, move.y * def.speed * dt);
}

/** 素直に寄る */
export function walkToward(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  const dir = toPlayer(state, e);
  if (dir.x !== 0) e.facing = dir;
  moveEnemy(state, e, def, dir.x * def.speed * dt, dir.y * def.speed * dt);
}

/** 突進の 1 ステップ。壁に当たったか / 触れたか を返す */
export function lungeStep(state: GameState, e: Enemy, def: EnemyDef, speedMul: number, dt: number): { wall: boolean; touched: boolean } {
  const speed = def.speed * speedMul;
  const hit = moveEnemy(state, e, def, e.strikeDir.x * speed * dt, e.strikeDir.y * speed * dt);
  return { wall: hit.hitX || hit.hitY, touched: bossTouch(state, e, def) };
}

/** 体が触れたら当てる。当たった（または回避された）なら true */
export function bossTouch(state: GameState, e: Enemy, def: EnemyDef): boolean {
  const p = state.player.body;
  if (!circlesOverlap(e.body.pos.x, e.body.pos.y, e.body.radius, p.pos.x, p.pos.y, p.radius)) return false;
  const result = damagePlayer(state, def.contactDamage + depthDamageBonus(state.depth), e.body.pos, e);
  if (result === "hit") {
    inflictOnPlayer(state, e, "contact");
    shake(state, FEEL.shakeHeavy);
  }
  return result !== "ignored";
}
