import { type GameState, type Projectile, pushSfx } from "../core/state";
import { type Vec, angle, fromAngle, length, normalize, scale, sub } from "../core/vec";
import { FEEL, MANA } from "../data/tuning";
import { SHOT_TYPES, type ShotDef } from "../data/weapons";
import { damageEnemy, damagePlayer, rollOutgoing } from "./combat";
import { spawnBurst, spawnRing } from "./effects";
import { deflectProjectile } from "./elites";
import { boonAttackManaMul } from "./boons";
import { onBoonProjectileHit, onBoonProjectileWall } from "./boonRules";
import { attackManaMul } from "./keystones";
import { gainAttackMana } from "./mana";
import { circlesOverlap, overlapsWall } from "./physics";
import { inflictOnPlayer } from "./statusEffects";
import { swallowedBySmoke } from "./terrain";

const BULLET_KNOCKBACK = 60;
const BULLET_HITSTOP = 1;
/** 設置弾の炸裂のノックバックとヒットストップ */
const MINE_KNOCKBACK = 180;
const MINE_HITSTOP = 2;
const MINE_PARTICLES = 14;
const MINE_FX_LIFE = 0.25;
/** 床で止まったとみなす速さ（これ未満は 0 にする） */
const MINE_REST_SPEED = 2;
const FULL_TURN = Math.PI * 2;

export function updateProjectiles(state: GameState, dt: number): void {
  groupNewVolley(state);
  for (const pr of state.projectiles) {
    if (pr.life <= 0) continue;
    pr.life -= dt;
    const def = shotDefOf(pr);
    if (def) steerShot(state, pr, def, dt);
    const prev = { ...pr.pos };
    pr.pos.x += pr.vel.x * dt;
    pr.pos.y += pr.vel.y * dt;

    if (overlapsWall(state, pr.pos.x, pr.pos.y, pr.radius)) {
      if (onBoonProjectileWall(state, pr, dt)) continue;
      if (def && hitWallByShot(state, pr, def, prev, dt)) continue;
      pr.life = 0;
      spawnBurst(state, pr.pos, pr.color, 4, 60, 0.2, 1.5);
      if (pr.owner === "player") pushSfx(state, "bulletHit");
      continue;
    }
    // 煙に入った弾は消える（床に据えた設置弾は除く）
    if (!def?.mine && swallowedBySmoke(state, pr)) continue;

    if (pr.owner === "player") {
      if (def?.mine) updateMine(state, pr, def);
      else hitEnemies(state, pr);
    } else {
      hitPlayer(state, pr);
    }
  }
  state.projectiles = state.projectiles.filter((p) => p.life > 0);
}

/** プレイヤー弾の射撃の型（src/data/weapons.ts）。型を持たない弾は undefined（単発と同じ動き） */
function shotDefOf(pr: Projectile): ShotDef | undefined {
  if (pr.owner !== "player" || !pr.shot) return undefined;
  return SHOT_TYPES[pr.shot.key];
}

/** 飛んでいる間の型ごとの動き（追尾の旋回・設置弾の減速） */
function steerShot(state: GameState, pr: Projectile, def: ShotDef, dt: number): void {
  if (def.homing) steerHoming(state, pr, def.homing.turnRate, def.homing.range, dt);
  if (def.mine) slowMine(pr, def.mine.drag, dt);
}

/** 追尾: range 内で最も近い敵へ、毎秒 turnRate ラジアンまで向きを変える（速さは変えない） */
function steerHoming(state: GameState, pr: Projectile, turnRate: number, range: number, dt: number): void {
  const target = nearestEnemy(state, pr.pos, range, pr.hitIds);
  if (!target) return;
  const speed = length(pr.vel);
  const current = angle(pr.vel);
  const wanted = angle(sub(target, pr.pos));
  const diff = wrapAngle(wanted - current);
  const maxTurn = turnRate * dt;
  const turn = Math.max(-maxTurn, Math.min(maxTurn, diff));
  pr.vel = scale(fromAngle(current + turn), speed);
}

function wrapAngle(a: number): number {
  let r = a % FULL_TURN;
  if (r > Math.PI) r -= FULL_TURN;
  if (r < -Math.PI) r += FULL_TURN;
  return r;
}

/** 生きていて見えている敵のうち range 内で最も近いもの。既に当てた敵は追わない。同距離は配列順（決定性） */
function nearestEnemy(state: GameState, pos: Vec, range: number, skip: ReadonlySet<number>): Vec | undefined {
  let best: Vec | undefined;
  let bestDist = range;
  for (const e of state.enemies) {
    if (e.hp <= 0 || e.hidden || skip.has(e.id)) continue;
    const d = length(sub(e.body.pos, pos));
    if (d >= bestDist) continue;
    bestDist = d;
    best = e.body.pos;
  }
  return best;
}

/** 設置弾: 床を滑って止まる */
function slowMine(pr: Projectile, drag: number, dt: number): void {
  pr.vel = scale(pr.vel, Math.exp(-drag * dt));
  if (length(pr.vel) < MINE_REST_SPEED) pr.vel = { x: 0, y: 0 };
}

/** 壁に当たった型ごとの処理。弾を残すなら true（跳弾は反射、設置弾は壁際で止まる） */
function hitWallByShot(state: GameState, pr: Projectile, def: ShotDef, prev: Vec, dt: number): boolean {
  if (def.mine) {
    pr.pos = prev;
    pr.vel = { x: 0, y: 0 };
    return true;
  }
  return bounceShot(state, pr, def, prev, dt);
}

/** 跳弾: 当たった軸の速度を反転し、威力と怯み値を上げる。跳ねるたびに同じ敵へもう一度当たれる */
function bounceShot(state: GameState, pr: Projectile, def: ShotDef, prev: Vec, dt: number): boolean {
  const left = pr.shot?.bouncesLeft ?? 0;
  if (!def.bounce || !pr.shot || left <= 0) return false;
  const hitX = overlapsWall(state, prev.x + pr.vel.x * dt, prev.y, pr.radius);
  const hitY = overlapsWall(state, prev.x, prev.y + pr.vel.y * dt, pr.radius);
  // 角に真っ直ぐ入ったとき（どちらの軸単独でも当たらない）は両方を返す
  const flipBoth = !hitX && !hitY;
  pr.pos = prev;
  pr.vel = { x: hitX || flipBoth ? -pr.vel.x : pr.vel.x, y: hitY || flipBoth ? -pr.vel.y : pr.vel.y };
  pr.shot.bouncesLeft = left - 1;
  pr.damage *= def.bounce.mul;
  pr.poise = (pr.poise ?? 0) * def.bounce.mul;
  pr.hitIds.clear();
  spawnBurst(state, pr.pos, pr.color, 3, 50, 0.15, 1.2);
  pushSfx(state, "bulletHit");
  return true;
}

/** 設置弾: 敵が近づくか信管が尽きたら炸裂する */
function updateMine(state: GameState, pr: Projectile, def: ShotDef): void {
  const mine = def.mine;
  if (!mine || pr.shot?.detonated) return;
  const near = state.enemies.some(
    (e) => e.hp > 0 && !e.hidden && circlesOverlap(pr.pos.x, pr.pos.y, pr.radius + mine.triggerRadius, e.body.pos.x, e.body.pos.y, e.body.radius),
  );
  if (!near && pr.life > 0) return;
  detonateMine(state, pr, mine.blastRadius);
}

function detonateMine(state: GameState, pr: Projectile, blastRadius: number): void {
  if (pr.shot) pr.shot.detonated = true;
  pr.life = 0;
  for (const e of state.enemies) {
    if (e.hp <= 0 || e.hidden) continue;
    if (!circlesOverlap(pr.pos.x, pr.pos.y, blastRadius, e.body.pos.x, e.body.pos.y, e.body.radius)) continue;
    const out = rollOutgoing(state, e, pr.damage, pr.kind);
    gainShotMana(state, pr);
    damageEnemy(state, e, out.amount, normalize(sub(e.body.pos, pr.pos)), MINE_KNOCKBACK * state.stats.knockbackMul, {
      hitstopSteps: MINE_HITSTOP,
      kind: pr.kind,
      crit: out.crit,
      poise: pr.poise ?? 0,
    });
  }
  spawnRing(state, pr.pos, blastRadius, pr.color, MINE_FX_LIFE);
  spawnBurst(state, pr.pos, pr.color, MINE_PARTICLES, 120, 0.3, 2);
  pushSfx(state, "explode");
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
  // 霊体化（skills/forms.ts）は敵弾をすり抜ける（弾は消えずに飛び続ける）
  if (state.skills.shape?.key === "wraithForm") return;
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
