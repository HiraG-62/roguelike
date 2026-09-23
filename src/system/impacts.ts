import type { GameState } from "../core/state";
import { pushSfx } from "../core/state";
import { type Vec, normalize, sub } from "../core/vec";
import { RUN_EVENT } from "../data/tuning";
import { damageEnemy, damagePlayer } from "./combat";
import { shake, spawnBurst } from "./effects";
import { circlesOverlap } from "./physics";

/**
 * 予告つきの落下物（地震・流星群・天井の崩落）。円が満ちきった瞬間に、範囲内のプレイヤーと敵の両方に当たる。
 * 敵へのダメージは RUN_EVENT.impactEnemyMul 倍（敵を落下点へ誘導するのが報酬になる）
 */

export interface Impact {
  pos: Vec;
  radius: number;
  /** 着弾までの残り秒 */
  timer: number;
  /** 予告の全長（描画の満ち具合に使う） */
  telegraph: number;
  damage: number;
}

export function pushImpact(state: GameState, pos: Vec, radius: number, telegraph: number, damage: number): void {
  state.runEvents.impacts.push({ pos: { ...pos }, radius, timer: telegraph, telegraph, damage });
}

const IMPACT_SHAKE = 2;
const IMPACT_KNOCK = 120;
const IMPACT_PARTICLES = 10;
const IMPACT_PARTICLE_SPEED = 80;
const IMPACT_PARTICLE_LIFE = 0.4;

export function updateImpacts(state: GameState, dt: number): void {
  const list = state.runEvents.impacts;
  if (list.length === 0) return;
  for (const impact of list) {
    impact.timer -= dt;
    if (impact.timer <= 0) land(state, impact);
  }
  state.runEvents.impacts = list.filter((i) => i.timer > 0);
}

function land(state: GameState, impact: Impact): void {
  const p = state.player.body;
  if (circlesOverlap(impact.pos.x, impact.pos.y, impact.radius, p.pos.x, p.pos.y, p.radius)) {
    damagePlayer(state, impact.damage, impact.pos);
  }
  for (const e of state.enemies) {
    if (e.hp <= 0 || e.phase === "spawning") continue;
    if (!circlesOverlap(impact.pos.x, impact.pos.y, impact.radius, e.body.pos.x, e.body.pos.y, e.body.radius)) continue;
    damageEnemy(state, e, impact.damage * RUN_EVENT.impactEnemyMul, normalize(sub(e.body.pos, impact.pos)), IMPACT_KNOCK);
  }
  shake(state, IMPACT_SHAKE);
  spawnBurst(state, impact.pos, RUN_EVENT.impactColor, IMPACT_PARTICLES, IMPACT_PARTICLE_SPEED, IMPACT_PARTICLE_LIFE, 2);
  pushSfx(state, "shockwave");
}
