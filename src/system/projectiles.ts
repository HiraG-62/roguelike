import { type GameState, type Projectile, pushSfx } from "../core/state";
import { normalize } from "../core/vec";
import { FEEL, MANA } from "../data/tuning";
import { damageEnemy, damagePlayer, rollOutgoing } from "./combat";
import { spawnBurst } from "./effects";
import { deflectProjectile } from "./elites";
import { boonAttackManaMul } from "./boons";
import { onBoonProjectileHit, onBoonProjectileWall } from "./boonRules";
import { attackManaMul } from "./keystones";
import { gainAttackMana } from "./mana";
import { circlesOverlap, overlapsWall } from "./physics";
import { inflictOnPlayer } from "./statusEffects";

const BULLET_KNOCKBACK = 60;
const BULLET_HITSTOP = 1;

export function updateProjectiles(state: GameState, dt: number): void {
  groupNewVolley(state);
  for (const pr of state.projectiles) {
    if (pr.life <= 0) continue;
    pr.life -= dt;
    pr.pos.x += pr.vel.x * dt;
    pr.pos.y += pr.vel.y * dt;

    if (overlapsWall(state, pr.pos.x, pr.pos.y, pr.radius)) {
      if (onBoonProjectileWall(state, pr, dt)) continue;
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

/**
 * 前回の更新から増えたプレイヤーの射撃弾を 1 回の射撃としてまとめる。
 * 射撃は 1 フレームに 1 回までなので、未分類の弾はすべて同じ射撃で出たもの
 */
function groupNewVolley(state: GameState): void {
  let volley: { manaHits: number } | null = null;
  for (const pr of state.projectiles) {
    if (pr.owner !== "player" || pr.kind !== "ranged" || pr.volley) continue;
    volley ??= { manaHits: 0 };
    pr.volley = volley;
  }
}

/** 射撃弾の命中 1 体ごとにマナを回収する。1 回の射撃で MANA.shotVolleyCap 回まで */
function gainShotMana(state: GameState, pr: Projectile): void {
  if (pr.kind !== "ranged") return;
  const volley = pr.volley ?? { manaHits: 0 };
  pr.volley = volley;
  if (volley.manaHits >= MANA.shotVolleyCap) return;
  volley.manaHits += 1;
  // 静寂の誓い（ks_silentVow）では通常攻撃の命中でマナが戻らない
  gainAttackMana(state, MANA.onShot, attackManaMul(state) * boonAttackManaMul(state));
}

/** 貫通: 当てた敵は hitIds に積み、pierceLeft が尽きたら消える */
function hitEnemies(state: GameState, pr: Projectile): void {
  for (const e of state.enemies) {
    if (e.hp <= 0 || pr.hitIds.has(e.id)) continue;
    if (!circlesOverlap(pr.pos.x, pr.pos.y, pr.radius, e.body.pos.x, e.body.pos.y, e.body.radius)) continue;
    pr.hitIds.add(e.id);
    // knight の盾 / Reflective の反射
    if (deflectProjectile(state, pr, e)) return;
    const out = rollOutgoing(state, e, pr.damage * onBoonProjectileHit(state, pr, e), pr.kind);
    gainShotMana(state, pr);
    damageEnemy(state, e, out.amount, normalize(pr.vel), BULLET_KNOCKBACK * state.stats.knockbackMul, {
      hitstopSteps: BULLET_HITSTOP,
      kind: pr.kind,
      crit: out.crit,
      poise: pr.poise ?? 0,
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
  if (result === "hit") inflictOnPlayer(state, attacker, "bullet");
  // 被弾したか回避したら弾は消える。被弾後無敵中はすり抜ける
  if (result === "ignored") return;
  pr.life = 0;
  spawnBurst(state, pr.pos, pr.color, 6, 90, 0.25, 1.5);
  if (result === "dodged") state.hitstop = Math.max(state.hitstop, FEEL.hitstopLight);
}
