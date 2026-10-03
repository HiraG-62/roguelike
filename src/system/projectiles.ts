import { type Enemy, type GameState, type Projectile, pushSfx } from "../core/state";
import { type Vec, add, angle, dist, fromAngle, length, normalize, scale, sub } from "../core/vec";
import { ACTION, FEEL } from "../data/tuning";
import { type ArcDef, type BulletDef, type OrbitDef, type ShotArc, type ShotRuntime, type ShotTrip, MOVESETS } from "../data/weapons";
import { BULLETS } from "../loot/bullets";
import { damageEnemy, damagePlayer, rollOutgoing } from "./combat";
import { hitstop, markBlastShot, spawnBlast, spawnBurst } from "./effects";
import { deflectProjectile } from "./elites";
import { isAllied } from "./rules";
import { merchantSheltered } from "./merchantAi";
import { bossOnAnswer } from "./boss";
import { fireDebana } from "./debana";
import { gainMorale, noteBlast } from "./morale";
import { stickPin } from "./pins";
import { circlesOverlap, overlapsShotWall } from "./physics";
import { yellowAt } from "./readTiming";
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
/** 弧の区間の長さの下限（px。カーソルが足元でも 0 秒の区間にしない） */
const ARC_MIN_SPAN = 16;
/** 弧の弾の寿命の余り（秒）。区間の秒が尽きる前に寿命で消えないように */
const ARC_LIFE_PAD = 0.5;

/**
 * 自分の弾の命中・炸裂では気力も奥義ゲージも増やさない（遠距離の攻撃は資源を戻さない。docs/ideas/gun-bases-review.md 0-2）。
 * 銃・投擲・魔弾・右レーン・奥義・設置弾のどれも同じ。資源は近接の振りの命中（player.ts の meleeHitEnemy）で戻す
 */
export function updateProjectiles(state: GameState, dt: number): void {
  for (const pr of state.projectiles) {
    if (pr.life <= 0) continue;
    stepProjectile(state, pr, dt);
    if (pr.life <= 0) leaveTerrain(state, pr);
  }
  state.projectiles = state.projectiles.filter((p) => p.life > 0);
}

/** 弾 1 発の 1 ステップ（動き・壁・煙・命中） */
function stepProjectile(state: GameState, pr: Projectile, dt: number): void {
  // 食い込んでいる間は寿命を減らさず、食い込んだ敵の上で回数ぶん当てる
  if (isGrinding(pr)) {
    stepGrind(state, pr, dt);
    return;
  }
  pr.life -= dt;
  const def = shotDefOf(pr);
  steerShot(state, pr, def, dt);
  const prev = { ...pr.pos };
  pr.pos.x += pr.vel.x * dt;
  pr.pos.y += pr.vel.y * dt;

  // 周回の弾は自分の周りを回るので壁では消さない（壁際で戦っても輪が残る）。帰りの弧の輪も壁を抜けて手元へ戻る
  // （跳ね返されて敵の弾になった輪は弧で飛ばないので、普通の弾として壁で消える）
  if (!pr.shot?.orbit && !playerArc(pr)?.back && overlapsShotWall(state, pr.pos.x, pr.pos.y, pr.radius)) {
    if (hitWallByShot(state, pr, def, prev, dt)) return;
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
    if (pr.shot?.arc) settleArc(state, pr, pr.shot.arc);
  } else {
    hitPlayer(state, pr);
  }
}

/**
 * 弾が消えた位置に地形を残す（BulletDef.leaves の写し）。命中・壁・炸裂・寿命切れのどれでも置き、
 * 手元へ戻った弾（回転刃の帰り）は自分の足元になるので置かない
 */
function leaveTerrain(state: GameState, pr: Projectile): void {
  const rt = pr.shot;
  if (pr.owner !== "player" || !rt?.leaves || rt.left || rt.returning || rt.arc?.back) return;
  rt.left = true;
  placeTerrain(state, pr.pos.x, pr.pos.y, rt.leaves.terrain, rt.leaves.radius, rt.leaves.duration);
}

/** 弾の applies（魔法弾の燃焼・凍結など）を命中した敵へ付ける。倒れた敵には付けない */
function applyShotStatus(state: GameState, pr: Projectile, e: Enemy): void {
  if (!pr.applies || e.hp <= 0) return;
  for (const apply of pr.applies) applyStatus(state, { kind: "enemy", enemy: e }, apply, "player");
}

/** 墨印を記す弾（書の左の字）。記すだけで、同じ命中で墨印を読まない（statusReactions.ts の recite の条件） */
function inscribesInk(pr: Projectile): boolean {
  return pr.applies?.some((a) => a.kind === "inkMark") === true;
}

/** プレイヤー弾の弾の定義（src/loot/bullets.ts）。作業領域を持たない弾は undefined（まっすぐ飛ぶだけ） */
function shotDefOf(pr: Projectile): BulletDef | undefined {
  if (pr.owner !== "player" || !pr.shot) return undefined;
  return BULLETS[pr.shot.key];
}

/**
 * 飛んでいる間の型ごとの動き。周回（持続の奥義）は作業領域が持つので弾の定義より先に見る。
 * それ以外は弾の定義（追尾の旋回・設置弾の減速・回転刃の折り返し）
 */
function steerShot(state: GameState, pr: Projectile, def: BulletDef | undefined, dt: number): void {
  if (pr.owner !== "player") return;
  if (pr.shot?.orbit) {
    steerOrbit(state, pr, pr.shot, pr.shot.orbit, dt);
    return;
  }
  if (pr.shot?.arc) {
    steerArc(state, pr, pr.shot.arc, dt);
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
    if (e.hp <= 0 || e.hidden || skip.has(e.id) || isAllied(state, e)) continue;
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

/** 自分の弾の弧の飛び方。跳ね返されて敵の弾になった輪（elites.ts の deflectProjectile）は弧を辿らないので undefined */
function playerArc(pr: Projectile): ShotArc | undefined {
  return pr.owner === "player" ? pr.shot?.arc : undefined;
}

/** 壁に当たった弾を残すか。弧の行きの輪はその場で帰りへ折り返す。弾の定義を持つ弾は型ごとの処理（hitWallByDef） */
function hitWallByShot(state: GameState, pr: Projectile, def: BulletDef | undefined, prev: Vec, dt: number): boolean {
  const arc = playerArc(pr);
  if (arc && !arc.back) {
    pr.pos = prev;
    beginArcBack(state, pr, arc);
    return true;
  }
  return def !== undefined && hitWallByDef(state, pr, def, prev, dt);
}

/**
 * 壁に当たった型ごとの処理。弾を残すなら true
 * （跳弾は反射、設置弾は壁際で止まる、回転刃は行きなら折り返す、曲射は壁の手前で炸裂する）
 */
function hitWallByDef(state: GameState, pr: Projectile, def: BulletDef, prev: Vec, dt: number): boolean {
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
  const hitX = overlapsShotWall(state, prev.x + pr.vel.x * dt, prev.y, pr.radius);
  const hitY = overlapsShotWall(state, prev.x, prev.y + pr.vel.y * dt, pr.radius);
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
  let hits = 0;
  for (const e of state.enemies) {
    if (e.hp <= 0 || e.hidden || isAllied(state, e)) continue;
    if (!circlesOverlap(pr.pos.x, pr.pos.y, blastRadius, e.body.pos.x, e.body.pos.y, e.body.radius)) continue;
    hits += 1;
    const mul = blastMulAt(pr.pos, blastRadius, e.body.pos, e.body.radius);
    const out = rollOutgoing(state, e, pr.damage * mul, pr.kind, { attack: pr.attack });
    // 設置弾・曲射の炸裂は直撃（擲弾）扱いで bulletHitHeavy
    damageEnemy(state, e, out.amount, normalize(sub(e.body.pos, pr.pos)), MINE_KNOCKBACK * state.stats.knockbackMul * mul, {
      hitstopSteps: MINE_HITSTOP,
      kind: pr.kind,
      crit: out.crit,
      poise: (pr.poise ?? 0) * mul,
      impact: { family: "blunt", weight: "heavy" },
    });
    applyShotStatus(state, pr, e);
  }
  // 弾の専用スプライトの爆発で描けるよう、輪に炸裂した弾を結ぶ
  markBlastShot(spawnBlast(state, pr.pos, blastRadius, pr.color, MINE_FX_LIFE), pr);
  spawnBurst(state, pr.pos, pr.color, MINE_PARTICLES, 120, 0.3, 2);
  pushSfx(state, "explode");
  // 敵を巻き込んだ自分の炸裂だけ擲弾の戦意「炸裂」に数える
  if (pr.owner === "player") noteBlast(state, hits);
}

/**
 * 貫通: 当てた敵は hitIds に積み、pierceLeft が尽きたら消える。周回の弾は消えず、刺さる弾は刺さって消え、
 * 食い込む弾は最初の敵で止まり、弧の輪は行きで貫通が尽きたら折り返す（帰りは貫いて手元へ戻る）
 */
function hitEnemies(state: GameState, pr: Projectile): void {
  for (const e of state.enemies) {
    // 従魔（眷属）と、交戦中で身を守っている商人は撃ち抜く（貫通を減らさず、傷つけない）
    if (e.hp <= 0 || pr.hitIds.has(e.id) || isAllied(state, e) || merchantSheltered(state, e)) continue;
    if (!circlesOverlap(pr.pos.x, pr.pos.y, pr.radius, e.body.pos.x, e.body.pos.y, e.body.radius)) continue;
    pr.hitIds.add(e.id);
    // knight の盾 / Reflective の反射
    if (deflectProjectile(state, pr, e)) return;
    const amount = strikeEnemy(state, pr, e);
    if (!afterShotHit(state, pr, e, amount)) return;
  }
}

/** 命中の後の弾の行方。まだ飛び続けて次の敵へ当たれるなら true */
function afterShotHit(state: GameState, pr: Projectile, e: Enemy, amount: number): boolean {
  const rt = pr.shot;
  // 周回の弾は当てても消えない（1 周に 1 回ずつ当て直す。消えるのは laps 周を回り切ったとき）
  if (rt?.orbit) return true;
  if (rt?.pin) {
    pr.life = 0;
    stickPin(state, e, rt.pin, angle(pr.vel), amount);
    return false;
  }
  if (rt?.grind && rt.grind.done === 0) {
    beginGrind(pr, e);
    return false;
  }
  if (rt?.arc?.back) return true;
  if (pr.pierceLeft > 0) {
    pr.pierceLeft -= 1;
    return true;
  }
  if (rt?.arc) {
    beginArcBack(state, pr, rt.arc);
    return false;
  }
  pr.life = 0;
  return false;
}

/** 弾 1 発の命中の傷（出端・状態異常・投げの組も数える）。入れた威力を返す（刺さる弾の叩き込みの元） */
function strikeEnemy(state: GameState, pr: Projectile, e: Enemy): number {
  // 出端: 放出の弾を撃った時に、この敵の予告が下絵だった（弾の飛ぶ間に墨入れへ入っていても。system/readTiming.ts）
  const debana = pr.release !== undefined && pr.firedAt !== undefined && yellowAt(e, pr.firedAt);
  const out = rollOutgoing(state, e, pr.damage, pr.kind, { attack: pr.attack, release: pr.release !== undefined, forceCrit: pr.release?.crit, counter: debana });
  const amount = debana ? Math.round(out.amount * ACTION.counter.damageMul) : out.amount;
  // 砲（溜め撃ち）の直撃だけ重い命中音（bulletHitHeavy）
  const heavy = shotDefOf(pr)?.charge !== undefined;
  const pos = { ...e.body.pos };
  // 食い込んで止まっている弾は速度を持たないので、敵を撃った向き（自分から敵へ）に押す
  const knockDir = length(pr.vel) > 0 ? normalize(pr.vel) : normalize(sub(e.body.pos, state.player.body.pos));
  damageEnemy(state, e, amount, knockDir, BULLET_KNOCKBACK * state.stats.knockbackMul, {
    hitstopSteps: BULLET_HITSTOP,
    kind: pr.kind,
    crit: out.crit,
    poise: (pr.poise ?? 0) * (debana ? ACTION.counter.poiseMul : 1),
    guardBreak: debana,
    readStart: debana,
    counterStop: debana,
    impact: heavy ? { family: "blunt", weight: "heavy" } : undefined,
    // 放出の弾（終撃）とレーン（双撃）は system/moments.ts が読む
    finisher: pr.release?.finisher,
    release: pr.release !== undefined,
    lane: pr.lane,
    inscribes: inscribesInk(pr),
  });
  if (debana) {
    fireDebana(state, e, pos);
    bossOnAnswer(state, e, "debana");
  }
  applyShotStatus(state, pr, e);
  noteTrip(state, pr, e);
  return amount;
}

// ---------------------------------------------------------------------------
// 投げの組（行きと帰りの両方で当てた敵）
// ---------------------------------------------------------------------------

/** 手元へ戻る弾の帰りの最中か（弧の帰り・回転刃の帰り） */
function isReturning(pr: Projectile): boolean {
  return pr.shot?.arc?.back === true || pr.shot?.returning === true;
}

/** 投げの組に命中を数える。帰りに当てた敵が行きでも当たっていれば 1 体につき 1 回だけ「往復」（戦輪の戦意） */
function noteTrip(state: GameState, pr: Projectile, e: Enemy): void {
  const trip = pr.shot?.trip;
  if (!trip) return;
  if (!isReturning(pr)) {
    trip.out.add(e.id);
    return;
  }
  if (!trip.out.has(e.id) || trip.scored.has(e.id)) return;
  trip.scored.add(e.id);
  gainMorale(state, "roundTrip");
}

/** 新しい投げの組（同じ 1 回の投げの弾がすべて同じオブジェクトを持つ） */
export function newShotTrip(): ShotTrip {
  return { out: new Set(), scored: new Set() };
}

/** 撃った弾が手元へ戻る形か（弧・回転刃）。戻る弾だけが投げの組を持つ */
export function returnsToHand(shot: Readonly<BulletDef>): boolean {
  return shot.arc !== undefined || shot.boomerang !== undefined;
}

/**
 * 自分の武器が投げた輪（手元へ戻る、レーンに属する自分の弾）が飛んでいるか。戻るまで投げられない武器種
 * （MovesetDef.waitForReturn）だけが数える。player.ts（左の射撃・連撃を止める）と render（手ぶらに描く）が同じものを読む
 */
export function ringsInFlight(state: Readonly<GameState>): boolean {
  if (MOVESETS[state.stats.moveset]?.waitForReturn !== true) return false;
  return state.projectiles.some((pr) => pr.owner === "player" && pr.life > 0 && pr.lane !== undefined && heldRing(pr));
}

function heldRing(pr: Readonly<Projectile>): boolean {
  if (!pr.shot) return false;
  if (pr.shot.arc) return true;
  return BULLETS[pr.shot.key]?.boomerang !== undefined;
}

// ---------------------------------------------------------------------------
// 食い込む弾（大手裏剣・牙輪）
// ---------------------------------------------------------------------------

function isGrinding(pr: Projectile): boolean {
  return pr.owner === "player" && pr.shot?.grind?.targetId !== undefined;
}

/** 最初に当たった敵で止まる（その命中を 1 回目に数える） */
function beginGrind(pr: Projectile, e: Enemy): void {
  const g = pr.shot?.grind;
  if (!g) return;
  g.targetId = e.id;
  g.done = 1;
  g.elapsed = 0;
  pr.pos = { ...e.body.pos };
  pr.vel = { x: 0, y: 0 };
}

/**
 * 食い込んでいる間の 1 ステップ: 敵の上に留まり、sec を hits 等分した区切りごとにもう一度当てる。当て終えたか、
 * 敵が倒れた・消えたら離れる（離れた後は二度と食い込まない）
 */
function stepGrind(state: GameState, pr: Projectile, dt: number): void {
  const g = pr.shot?.grind;
  if (!g) return;
  const target = state.enemies.find((e) => e.id === g.targetId);
  if (!target || target.hp <= 0 || target.hidden) {
    releaseGrind(state, pr);
    return;
  }
  pr.pos = { ...target.body.pos };
  pr.vel = { x: 0, y: 0 };
  g.elapsed += dt;
  const interval = g.hits > 0 ? g.sec / g.hits : g.sec;
  while (g.done < g.hits && g.elapsed >= g.done * interval && target.hp > 0) {
    g.done += 1;
    strikeEnemy(state, pr, target);
  }
  if (g.elapsed >= g.sec || target.hp <= 0) releaseGrind(state, pr);
}

/** 食い込みを終えて離れる: 弧の輪は帰りへ、回転刃は折り返し、戻らない弾は消える */
function releaseGrind(state: GameState, pr: Projectile): void {
  const g = pr.shot?.grind;
  if (!g) return;
  g.targetId = undefined;
  g.done = Math.max(g.done, g.hits, 1);
  const arc = pr.shot?.arc;
  if (arc) {
    beginArcBack(state, pr, arc);
    return;
  }
  if (shotDefOf(pr)?.boomerang) {
    turnBack(pr);
    return;
  }
  pr.life = 0;
}

// ---------------------------------------------------------------------------
// 弧で飛ぶ弾と 2 枚投げ（戦輪）
// ---------------------------------------------------------------------------

/** 1 回の射撃で出す枚数ぶんの横のずらしの向き。2 枚投げは上下（+1 / -1）、それ以外は 0 */
export function pairSides(shot: Readonly<BulletDef>): readonly number[] {
  return shot.pair ? [1, -1] : [0];
}

/** 進む向きに直交する向き（side +1 の側） */
function sideOf(dir: Vec): Vec {
  return { x: -dir.y, y: dir.x };
}

/**
 * 1 枚の出どころと弧の飛び方（player.ts の emitVolley が弾ごとに呼ぶ）。2 枚投げは口元を side の側へ offset ずらす。
 * 弧の弾は行きの区間（口元 → 頂点 → カーソル。カーソルは最大射程 = 速さ × 寿命で頭打ち、固定の射程があればそれ）を作り、
 * 寿命は行きの秒に余りを足した長さにする（帰りは折り返すときに延ばす）
 */
export function launchThrow(
  state: Readonly<GameState>,
  shot: Readonly<BulletDef>,
  muzzle: Vec,
  fireAngle: number,
  side: number,
  speed: number,
  life: number,
  aim: number | undefined,
): { pos: Vec; life: number; arc?: ShotArc } {
  const dir = fromAngle(fireAngle);
  const pos = add(muzzle, scale(sideOf(dir), side * (shot.pair?.offset ?? 0)));
  if (!shot.arc || speed <= 0) return { pos, life };
  const arc = outboundArc(state, shot.arc, pos, dir, side >= 0 ? 1 : -1, speed, life, aim);
  return { pos, life: arc.dur + ARC_LIFE_PAD, arc };
}

function outboundArc(state: Readonly<GameState>, def: Readonly<ArcDef>, from: Vec, dir: Vec, side: 1 | -1, speed: number, life: number, aim: number | undefined): ShotArc {
  const maxRange = speed * life;
  const range = Math.max(ARC_MIN_SPAN, Math.min(maxRange, def.range ?? aim ?? maxRange));
  const to = add(state.player.body.pos, scale(dir, range));
  const dur = Math.max(ARC_MIN_SPAN, dist(from, to)) / speed;
  return { from: { ...from }, to, side, bulge: def.bulge, t: 0, dur, back: false, speed, catchRadius: def.catchRadius };
}

/** 二次ベジエの弧の上の点（区間の始点 → 頂点（中点 + 横 × bulge）→ 終点） */
export function arcPoint(arc: Readonly<ShotArc>, end: Vec, t: number): Vec {
  const chord = sub(end, arc.from);
  const mid = add(arc.from, scale(chord, 0.5));
  const apex = add(mid, scale(sideOf(normalize(chord, { x: 1, y: 0 })), arc.side * arc.bulge));
  const u = 1 - t;
  return add(add(scale(arc.from, u * u), scale(apex, 2 * u * t)), scale(end, t * t));
}

/** 弧の区間を dt 進め、次の点へ届く速度を置く（位置の更新は updateProjectiles。周回と同じ流儀）。帰りの終点は今の自分の位置 */
function steerArc(state: GameState, pr: Projectile, arc: ShotArc, dt: number): void {
  if (dt <= 0 || arc.dur <= 0) return;
  arc.t = Math.min(1, arc.t + dt / arc.dur);
  const end = arc.back ? state.player.body.pos : arc.to;
  pr.vel = scale(sub(arcPoint(arc, end, arc.t), pr.pos), 1 / dt);
}

/** 区間の終わり: 行きならカーソルで折り返し、帰りなら手元（catchRadius）で収まって消える */
function settleArc(state: GameState, pr: Projectile, arc: ShotArc): void {
  if (pr.life <= 0) return;
  if (!arc.back) {
    if (arc.t >= 1) beginArcBack(state, pr, arc);
    return;
  }
  const p = state.player.body;
  if (arc.t >= 1 || circlesOverlap(pr.pos.x, pr.pos.y, pr.radius + arc.catchRadius, p.pos.x, p.pos.y, p.radius)) pr.life = 0;
}

/**
 * 帰りの区間を今の位置から始める。当てた敵を忘れて帰りでもう一度当たれるようにする（折り返した瞬間に触れている敵は、
 * 同じ位置で行きと帰りを続けて当てないよう覚えたまま）。寿命は帰りの秒に余りを足して延ばす
 */
function beginArcBack(state: GameState, pr: Projectile, arc: ShotArc): void {
  arc.back = true;
  arc.from = { ...pr.pos };
  arc.t = 0;
  arc.dur = Math.max(ARC_MIN_SPAN, dist(pr.pos, state.player.body.pos)) / arc.speed;
  pr.vel = { x: 0, y: 0 };
  const touching = state.enemies.filter((e) => pr.hitIds.has(e.id) && circlesOverlap(pr.pos.x, pr.pos.y, pr.radius, e.body.pos.x, e.body.pos.y, e.body.radius));
  pr.hitIds.clear();
  for (const e of touching) pr.hitIds.add(e.id);
  pr.life = Math.max(pr.life, arc.dur + ARC_LIFE_PAD);
}

function hitPlayer(state: GameState, pr: Projectile): void {
  // 霊体化（skills/forms.ts）は敵弾をすり抜ける（弾は消えずに飛び続ける）
  if (state.skills.shape?.key === "wraithForm") return;
  const p = state.player.body;
  if (!circlesOverlap(pr.pos.x, pr.pos.y, pr.radius, p.pos.x, p.pos.y, p.radius)) return;
  const attacker = pr.sourceId === undefined ? undefined : state.enemies.find((e) => e.id === pr.sourceId);
  const result = damagePlayer(state, pr.damage, pr.pos, attacker, { cause: { kind: "shot" } });
  if (result === "hit") inflictOnPlayer(state, attacker, "bullet");
  // 被弾したか回避したら弾は消える。被弾後無敵中はすり抜ける
  if (result === "ignored") return;
  pr.life = 0;
  spawnBurst(state, pr.pos, pr.color, 6, 90, 0.25, 1.5);
  if (result === "dodged") hitstop(state, FEEL.hitstopLight);
}
