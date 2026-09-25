import { type Enemy, type GameState, type Projectile, pushSfx } from "../core/state";
import { type Vec, add, angle, fromAngle, length, normalize, scale, sub } from "../core/vec";
import { FEEL, MANA } from "../data/tuning";
import type { BulletDef, OrbitDef, RecallHomingDef, ShotRuntime } from "../data/weapons";
import { BULLETS } from "../loot/bullets";
import { damageEnemy, damagePlayer, rollOutgoing } from "./combat";
import { hitstop, markBlastShot, spawnBlast, spawnBurst } from "./effects";
import { deflectProjectile } from "./elites";
import { boonAttackManaMul } from "./boons";
import { onBoonProjectileHit, onBoonProjectileWall } from "./boonRules";
import { attackManaMul } from "./keystones";
import { gainAttackMana } from "./mana";
import { circlesOverlap, overlapsWall } from "./physics";
import { blastMulAt } from "./blast";
import { applyStatus, inflictOnPlayer } from "./statusEffects";
import { placeTerrain, swallowedBySmoke } from "./terrain";

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
/** 周回の弾が撃った位置から周回の半径・位相へ寄る速さ（毎秒の指数。大きいほど早く輪に乗る） */
const ORBIT_EASE = 8;

export function updateProjectiles(state: GameState, dt: number): void {
  groupNewVolley(state);
  for (const pr of state.projectiles) {
    if (pr.life <= 0) continue;
    stepProjectile(state, pr, dt);
    if (pr.life <= 0) leaveTerrain(state, pr);
  }
  state.projectiles = state.projectiles.filter((p) => p.life > 0);
}

/** 弾 1 発の 1 ステップ（動き・壁・煙・命中） */
function stepProjectile(state: GameState, pr: Projectile, dt: number): void {
  pr.life -= dt;
  const def = shotDefOf(pr);
  steerShot(state, pr, def, dt);
  const prev = { ...pr.pos };
  pr.pos.x += pr.vel.x * dt;
  pr.pos.y += pr.vel.y * dt;

  // 周回の弾は自分の周りを回るので壁では消さない（壁際で戦っても輪が残る）
  if (!pr.shot?.orbit && overlapsWall(state, pr.pos.x, pr.pos.y, pr.radius)) {
    if (onBoonProjectileWall(state, pr, dt)) return;
    if (def && hitWallByShot(state, pr, def, prev, dt)) return;
    pr.life = 0;
    spawnBurst(state, pr.pos, pr.color, 4, 60, 0.2, 1.5);
    if (pr.owner === "player") pushSfx(state, "bulletHit");
    return;
  }
  // 煙に入った弾は消える（床に据えた設置弾・山なりに越える曲射は除く）
  if (!def?.mine && !def?.lob && swallowedBySmoke(state, pr)) return;

  if (pr.owner === "player") {
    if (def?.mine) updateMine(state, pr, def);
    else if (def?.lob) updateLob(state, pr, def);
    else hitEnemies(state, pr);
    if (def?.boomerang) catchBoomerang(state, pr, def);
  } else {
    hitPlayer(state, pr);
  }
}

/**
 * 弾が消えた位置に地形を残す（BulletDef.leaves の写し）。命中・壁・炸裂・寿命切れのどれでも置き、
 * 手元へ戻った弾（回転刃の帰り・手元返し）は自分の足元になるので置かない
 */
function leaveTerrain(state: GameState, pr: Projectile): void {
  const rt = pr.shot;
  if (pr.owner !== "player" || !rt?.leaves || rt.left || rt.returning) return;
  rt.left = true;
  placeTerrain(state, pr.pos.x, pr.pos.y, rt.leaves.terrain, rt.leaves.radius, rt.leaves.duration);
}

/** 弾の applies（魔法弾の燃焼・凍結など）を命中した敵へ付ける。倒れた敵には付けない */
function applyShotStatus(state: GameState, pr: Projectile, e: Enemy): void {
  if (!pr.applies || e.hp <= 0) return;
  for (const apply of pr.applies) applyStatus(state, { kind: "enemy", enemy: e }, apply, "player");
}

/** プレイヤー弾の弾の定義（src/loot/bullets.ts）。作業領域を持たない弾は undefined（まっすぐ飛ぶだけ） */
function shotDefOf(pr: Projectile): BulletDef | undefined {
  if (pr.owner !== "player" || !pr.shot) return undefined;
  return BULLETS[pr.shot.key];
}

/**
 * 飛んでいる間の型ごとの動き。周回（持続の奥義）と手元返しの戻りの追尾は作業領域が持つので弾の定義より先に見る。
 * それ以外は弾の定義（追尾の旋回・設置弾の減速・回転刃の折り返し）
 */
function steerShot(state: GameState, pr: Projectile, def: BulletDef | undefined, dt: number): void {
  if (pr.owner !== "player") return;
  if (pr.shot?.orbit) {
    steerOrbit(state, pr, pr.shot, pr.shot.orbit, dt);
    return;
  }
  if (pr.shot?.recallHoming) {
    steerRecall(state, pr, pr.shot.recallHoming, dt);
    return;
  }
  if (!def) return;
  if (def.homing) steerHoming(state, pr, def.homing.turnRate, def.homing.range, dt);
  if (def.mine) slowMine(pr, def.mine.drag, dt);
  if (def.boomerang) steerBoomerang(state, pr, def.boomerang.returnAt);
}

/**
 * 周回: 自分を中心に turnRate で回る。半径と位相のずれは撃った位置から ORBIT_EASE で滑らかに寄せる（撃った直後に跳ばない）。
 * 次のステップの位置へ届く速度を置き、位置の更新は updateProjectiles に任せる。1 周ごとに当てた敵を忘れる
 */
function steerOrbit(state: GameState, pr: Projectile, rt: ShotRuntime, orbit: OrbitDef, dt: number): void {
  if (dt <= 0) return;
  const center = state.player.body.pos;
  const rel = sub(pr.pos, center);
  const ease = 1 - Math.exp(-ORBIT_EASE * dt);
  const phaseStep = (rt.orbitPhase ?? 0) * ease;
  const turn = orbit.turnRate * dt;
  const radius0 = rt.orbitRadius ?? length(rel);
  const radius = radius0 + (orbit.radius - radius0) * ease;
  const next = (rt.orbitAngle ?? angle(rel)) + turn + phaseStep;
  rt.orbitPhase = (rt.orbitPhase ?? 0) - phaseStep;
  rt.orbitRadius = radius;
  rt.orbitAngle = next;
  const target = add(center, scale(fromAngle(next), radius));
  pr.vel = scale(sub(target, pr.pos), 1 / dt);
  countLap(pr, rt, turn);
}

/** 周回の角度を足し、1 周を越えたら当てた敵を忘れる（同じ敵へ 1 周に 1 回当たる） */
function countLap(pr: Projectile, rt: ShotRuntime, turn: number): void {
  const before = rt.orbitTravel ?? 0;
  const after = before + Math.abs(turn);
  rt.orbitTravel = after;
  if (Math.floor(after / FULL_TURN) > Math.floor(before / FULL_TURN)) pr.hitIds.clear();
}

/**
 * 手元返しの戻りの追尾: range 内の近くの敵（まだ当てていない）へ曲がり、いなければ手元へ曲がって手元で収まる。
 * 速さは変えない
 */
function steerRecall(state: GameState, pr: Projectile, homing: RecallHomingDef, dt: number): void {
  const enemy = nearestEnemy(state, pr.pos, homing.range, pr.hitIds);
  if (enemy) {
    turnToward(pr, enemy, homing.turnRate, dt);
    return;
  }
  const hand = state.player.body;
  if (circlesOverlap(pr.pos.x, pr.pos.y, pr.radius, hand.pos.x, hand.pos.y, hand.radius)) {
    pr.life = 0;
    return;
  }
  turnToward(pr, hand.pos, homing.turnRate, dt);
}

/**
 * 回転刃: 寿命が returnAt の割合を切ったら折り返し、以後は毎ステップ手元へ向かう（速さは変えない）。
 * 折り返した瞬間に当てた敵を忘れ、寿命を撃った瞬間の長さに戻す（帰りでもう一度当たり、帰り着くまで消えない）
 */
function steerBoomerang(state: GameState, pr: Projectile, returnAt: number): void {
  const rt = pr.shot;
  if (!rt) return;
  if (!rt.returning && pr.life <= (rt.lifeTotal ?? 0) * returnAt) turnBack(pr);
  if (!rt.returning) return;
  const speed = length(pr.vel);
  pr.vel = scale(normalize(sub(state.player.body.pos, pr.pos), scale(pr.vel, -1)), speed);
}

function turnBack(pr: Projectile): void {
  const rt = pr.shot;
  if (!rt || rt.returning) return;
  rt.returning = true;
  pr.hitIds.clear();
  pr.life = Math.max(pr.life, rt.lifeTotal ?? pr.life);
}

/** 戻ってきた回転刃が手元に触れたら消える */
function catchBoomerang(state: GameState, pr: Projectile, def: BulletDef): void {
  if (!pr.shot?.returning || !def.boomerang) return;
  const p = state.player.body;
  if (circlesOverlap(pr.pos.x, pr.pos.y, pr.radius + def.boomerang.catchRadius, p.pos.x, p.pos.y, p.radius)) pr.life = 0;
}

/** 曲射: 飛んでいる間は当たらず、寿命（照準までの距離）が尽きた地点で炸裂する */
function updateLob(state: GameState, pr: Projectile, def: BulletDef): void {
  if (!def.lob || pr.shot?.detonated || pr.life > 0) return;
  detonateMine(state, pr, def.lob.blastRadius);
}

/** 追尾: range 内で最も近い敵へ、毎秒 turnRate ラジアンまで向きを変える（速さは変えない） */
function steerHoming(state: GameState, pr: Projectile, turnRate: number, range: number, dt: number): void {
  const target = nearestEnemy(state, pr.pos, range, pr.hitIds);
  if (target) turnToward(pr, target, turnRate, dt);
}

/** target へ毎秒 turnRate ラジアンまで向きを変える（速さは変えない） */
function turnToward(pr: Projectile, target: Vec, turnRate: number, dt: number): void {
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

/**
 * 壁に当たった型ごとの処理。弾を残すなら true
 * （跳弾は反射、設置弾は壁際で止まる、回転刃は行きなら折り返す、曲射は壁の手前で炸裂する）
 */
function hitWallByShot(state: GameState, pr: Projectile, def: BulletDef, prev: Vec, dt: number): boolean {
  if (def.mine) {
    pr.pos = prev;
    pr.vel = { x: 0, y: 0 };
    return true;
  }
  if (def.boomerang && pr.shot && !pr.shot.returning) {
    pr.pos = prev;
    turnBack(pr);
    return true;
  }
  if (def.lob && def.lob.blastRadius > 0) {
    pr.pos = prev;
    detonateMine(state, pr, def.lob.blastRadius);
    return true;
  }
  return bounceShot(state, pr, def, prev, dt);
}

/** 跳弾: 当たった軸の速度を反転し、威力と怯み値を上げる。跳ねるたびに同じ敵へもう一度当たれる */
function bounceShot(state: GameState, pr: Projectile, def: BulletDef, prev: Vec, dt: number): boolean {
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
function updateMine(state: GameState, pr: Projectile, def: BulletDef): void {
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
    const mul = blastMulAt(pr.pos, blastRadius, e.body.pos, e.body.radius);
    const out = rollOutgoing(state, e, pr.damage * mul, pr.kind, { attack: pr.attack });
    gainShotMana(state, pr);
    // 設置弾・曲射の炸裂は直撃（擲弾）扱いで bulletHitHeavy
    damageEnemy(state, e, out.amount, normalize(sub(e.body.pos, pr.pos)), MINE_KNOCKBACK * state.stats.knockbackMul * mul, {
      hitstopSteps: MINE_HITSTOP,
      kind: pr.kind,
      crit: out.crit,
      poise: (pr.poise ?? 0) * mul,
      impact: { family: "blunt", weight: "heavy" },
      energy: pr.energy,
    });
    applyShotStatus(state, pr, e);
  }
  // 弾の専用スプライトの爆発で描けるよう、輪に炸裂した弾を結ぶ
  markBlastShot(spawnBlast(state, pr.pos, blastRadius, pr.color, MINE_FX_LIFE), pr);
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
    const out = rollOutgoing(state, e, pr.damage * onBoonProjectileHit(state, pr, e), pr.kind, { attack: pr.attack });
    gainShotMana(state, pr);
    // 砲（溜め撃ち）の直撃だけ重い命中音（bulletHitHeavy）
    const heavy = shotDefOf(pr)?.charge !== undefined;
    damageEnemy(state, e, out.amount, normalize(pr.vel), BULLET_KNOCKBACK * state.stats.knockbackMul, {
      hitstopSteps: BULLET_HITSTOP,
      kind: pr.kind,
      crit: out.crit,
      poise: pr.poise ?? 0,
      impact: heavy ? { family: "blunt", weight: "heavy" } : undefined,
      energy: pr.energy,
    });
    applyShotStatus(state, pr, e);
    // 周回の弾は当てても消えない（1 周に 1 回ずつ当て直す。消えるのは laps 周を回り切ったとき）
    if (pr.shot?.orbit) continue;
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
  if (result === "dodged") hitstop(state, FEEL.hitstopLight);
}
