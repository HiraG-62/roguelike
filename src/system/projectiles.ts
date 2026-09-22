import { type GameState, type Projectile, pushSfx } from "../core/state";
import { normalize } from "../core/vec";
import { FEEL } from "../data/tuning";
import { damageEnemy, damagePlayer, rollOutgoing } from "./combat";
import { spawnBurst } from "./effects";
import { deflectProjectile } from "./elites";
import { circlesOverlap, overlapsWall } from "./physics";

const BULLET_KNOCKBACK = 60;
const BULLET_HITSTOP = 1;

export function updateProjectiles(state: GameState, dt: number): void {
  for (const pr of state.projectiles) {
    if (pr.life <= 0) continue;
    pr.life -= dt;
    pr.pos.x += pr.vel.x * dt;
    pr.pos.y += pr.vel.y * dt;

    if (overlapsWall(state, pr.pos.x, pr.pos.y, pr.radius)) {
      pr.life = 0;
      spawnBurst(state, pr.pos, pr.color, 4, 60, 0.2, 1.5);
      if (pr.owner === "player") pushSfx(state, "bulletHit");
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

/** 貫通: 当てた敵は hitIds に積み、pierceLeft が尽きたら消える */
function hitEnemies(state: GameState, pr: Projectile): void {
  for (const e of state.enemies) {
    if (e.hp <= 0 || pr.hitIds.has(e.id)) continue;
    if (!circlesOverlap(pr.pos.x, pr.pos.y, pr.radius, e.body.pos.x, e.body.pos.y, e.body.radius)) continue;
    pr.hitIds.add(e.id);
    // knight の盾 / Reflective の反射
    if (deflectProjectile(state, pr, e)) return;
    const out = rollOutgoing(state, e, pr.damage, pr.kind);
    damageEnemy(state, e, out.amount, normalize(pr.vel), BULLET_KNOCKBACK * state.stats.knockbackMul, {
      hitstopSteps: BULLET_HITSTOP,
      kind: pr.kind,
      crit: out.crit,
    });
    if (pr.pierceLeft > 0) {
      pr.pierceLeft -= 1;
      continue;
    }
    pr.life = 0;
    return;
  }
}

function hitPlayer(state: GameState, pr: Projectile): void {
  const p = state.player.body;
  if (!circlesOverlap(pr.pos.x, pr.pos.y, pr.radius, p.pos.x, p.pos.y, p.radius)) return;
  const attacker = pr.sourceId === undefined ? undefined : state.enemies.find((e) => e.id === pr.sourceId);
  const result = damagePlayer(state, pr.damage, pr.pos, attacker);
  // 被弾したか回避したら弾は消える。被弾後無敵中はすり抜ける
  if (result === "ignored") return;
  pr.life = 0;
  spawnBurst(state, pr.pos, pr.color, 6, 90, 0.25, 1.5);
  if (result === "dodged") state.hitstop = Math.max(state.hitstop, FEEL.hitstopLight);
}
