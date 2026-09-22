import type { GameState } from "../core/state";
import { normalize } from "../core/vec";
import { FEEL } from "../data/tuning";
import { damageEnemy, damagePlayer } from "./combat";
import { spawnBurst } from "./effects";
import { circlesOverlap, overlapsWall } from "./physics";

const BULLET_KNOCKBACK = 60;

export function updateProjectiles(state: GameState, dt: number): void {
  for (const pr of state.projectiles) {
    if (pr.life <= 0) continue;
    pr.life -= dt;
    pr.pos.x += pr.vel.x * dt;
    pr.pos.y += pr.vel.y * dt;

    if (overlapsWall(state, pr.pos.x, pr.pos.y, pr.radius)) {
      pr.life = 0;
      spawnBurst(state, pr.pos, pr.color, 4, 60, 0.2, 1.5);
      continue;
    }

    if (pr.owner === "player") {
      hitEnemies(state, pr);
    } else {
      hitPlayer(state, pr);
    }
  }
  state.projectiles = state.projectiles.filter((p) => p.life > 0);
}

function hitEnemies(state: GameState, pr: GameState["projectiles"][number]): void {
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    if (!circlesOverlap(pr.pos.x, pr.pos.y, pr.radius, e.body.pos.x, e.body.pos.y, e.body.radius)) continue;
    damageEnemy(state, e, pr.damage, normalize(pr.vel), BULLET_KNOCKBACK, { hitstopSteps: 1 });
    pr.life = 0;
    return;
  }
}

function hitPlayer(state: GameState, pr: GameState["projectiles"][number]): void {
  const p = state.player.body;
  if (!circlesOverlap(pr.pos.x, pr.pos.y, pr.radius, p.pos.x, p.pos.y, p.radius)) return;
  const result = damagePlayer(state, pr.damage, pr.pos);
  // 被弾したか回避したら弾は消える。被弾後無敵中はすり抜ける
  if (result === "ignored") return;
  pr.life = 0;
  spawnBurst(state, pr.pos, pr.color, 6, 90, 0.25, 1.5);
  if (result === "dodged") state.hitstop = Math.max(state.hitstop, FEEL.hitstopLight);
}
