import { type Enemy, type GameState, pushSfx } from "../core/state";
import { STATUS_KINDS, type StatusKind } from "../core/status";
import { TERRAIN_KINDS } from "../core/terrain";
import { type Vec, add, dist, fromAngle, length, normalize, scale, sub } from "../core/vec";
import { type EnemyDef, depthDamageBonus, enemyDef } from "../data/enemies";
import { BOSS, ENEMY_AI } from "../data/tuning";
import { TILE_SIZE } from "../map/grid";
import { SKILL_DEFS } from "../skills/data";
import { damagePlayer } from "./combat";
import { addFloatingText, shake, spawnBurst, spawnLine, spawnRing } from "./effects";
import { createEnemy } from "./enemies";
import { growBody, strikeShockRing } from "./enemyBehaviors";
import { blastBoth, rallyAround, seedTerrain } from "./enemyTerrain";
import { PACK_DONE, PACK_PENDING, fanDirections, findFreeSpot, fireEnemyBullet, spawnSpot } from "./enemyTraits";
import { laserEnd, segmentCircleHit, spawnLanding, spawnLaser } from "./hazards";
import { applyStagger } from "./poise";
import { type InflictSource, applyStatus, findStatus, hasStatus, removeStatus } from "./statusEffects";
import { placeTerrain, terrainAtIndex } from "./terrain";

/**
 * Wave 3 の behavior の中身（docs/ideas/enemies.md）。状態機械（chase → windup → strike → recover）は enemies.ts が回し、
 * ここは各段の中身だけを持つ。地形・両陣営に当たる炸裂・鼓舞は enemyTerrain.ts。
 * ai の使い方は behavior ごとに下の定数の近くに書く（move = 次の技 / counter = 溜め / timer = 間隔）
 */

const FULL_CIRCLE = Math.PI * 2;
const DEG_TO_RAD = Math.PI / 180;
/** 置いた物（旗・地雷・卵・砲台・金床）を足元から離す距離 */
const PLACE_OFFSET = 12;
/** 吸い込み・食事・写しの浮き文字 */
const TEXT_SCALE = 1;
const TEXT_LIFE = 0.8;

/** 付与元（倒された後も種類で引ける形） */
export function sourceOf(e: Enemy): InflictSource {
  return { defKey: e.defKey, roomIndex: e.roomIndex };
}

/** 置いた物: 蘇生体と同じ扱いにして、撃破数・ドロップ・死骸を出さない（湧き続ける物で稼がせない） */
function spawnFixture(state: GameState, key: string, want: Vec, owner: Enemy, spawning: boolean): Enemy {
  const def = enemyDef(key);
  const pos = spawnSpot(state, want, owner.body.pos, def.radius);
  const fixture = createEnemy(state, def, pos, owner.roomIndex, spawning);
  fixture.leaderId = owner.id;
  fixture.revived = true;
  if (!spawning) fixture.phase = "chase";
  state.enemies.push(fixture);
  return fixture;
}

function fixturesOf(state: GameState, owner: Enemy, key: string): Enemy[] {
  return state.enemies.filter((o) => o.hp > 0 && o.defKey === key && o.leaderId === owner.id);
}

/** 点が扇（中心 dir・半角 halfDeg・届く range）の中か */
export function inCone(from: Vec, dir: Vec, range: number, halfDeg: number, point: Vec): boolean {
  const to = sub(point, from);
  const d = length(to);
  if (d > range) return false;
  if (d === 0) return true;
  const a = normalize(to);
  const b = normalize(dir);
  return a.x * b.x + a.y * b.y >= Math.cos(halfDeg * DEG_TO_RAD);
}

// -----------------------------------------------------------------------------
// 状態機械の前に毎ステップ（enemies.ts の beforeAct から）
// -----------------------------------------------------------------------------

export function beforeActWave3(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  switch (def.behavior) {
    case "oiler":
      tickOiler(state, e, dt);
      return;
    case "mineLayer":
      tickMineLayer(state, e, dt);
      return;
    case "absorber":
      absorbShots(state, e);
      return;
    case "flameEater":
      tickFlameEater(state, e, def, dt);
      return;
    case "burrower":
      tickBurrowDust(state, e, dt);
      return;
    case "hollow":
      // 固まっている間は動きの絵も止める（灰色の彫像のように）
      if (hollowFrozen(state, e)) e.animTime -= dt;
      return;
    case "scribeImp":
      copyLastSkill(state, e);
      return;
    case "egg":
      tickEgg(state, e, dt);
      return;
    case "giantToad":
      makePondOnce(state, e);
      return;
    case "forgeMaster":
      watchAnvil(state, e);
      return;
    case "turretMaster":
      tickTurretMaster(state, e);
      return;
    case "shadowStalker":
      // 怯み・恐怖で予備動作が取り消されたら、潜ったままにせず姿を見せる（当たらない敵を残さない）
      if (e.hidden && e.phase !== "windup") e.hidden = false;
      return;
    default:
      return;
  }
}

// -----------------------------------------------------------------------------
// 山なりに吐く（毒吐き蛙・霜蛙・熔岩蛙）: 着弾点の影 → 炸裂 + 地形
// -----------------------------------------------------------------------------

export function telegraphLob(state: GameState, e: Enemy, def: EnemyDef): void {
  const lob = def.lob;
  const ai = e.ai;
  if (!lob || !ai) return;
  ai.target = { ...state.player.body.pos };
  spawnLanding(state, ai.target, Math.max(lob.blastRadius, lob.terrainRadius), e.phaseTimer, e.id);
}

/** 着弾: 両陣営に当たる炸裂と、跡の地形（影の予告は予備動作で済んでいる） */
export function strikeLob(state: GameState, e: Enemy, def: EnemyDef): void {
  const lob = def.lob;
  if (!lob) return;
  const target = e.ai?.target ?? state.player.body.pos;
  blastBoth(state, target, lob.blastRadius, lob.damage + depthDamageBonus(state.depth), lob.color, sourceOf(e), e.id);
  placeTerrain(state, target.x, target.y, lob.terrain, lob.terrainRadius);
  pushSfx(state, "oilSplash");
}

// -----------------------------------------------------------------------------
// 油壺運び: 走りながら油を撒く（油の上で燃焼が起きると炎。炎は敵にも当たる）
// -----------------------------------------------------------------------------

function tickOiler(state: GameState, e: Enemy, dt: number): void {
  const ai = e.ai;
  if (!ai || e.phase !== "chase") return;
  ai.timer -= dt;
  if (ai.timer > 0) return;
  const o = ENEMY_AI.oiler;
  ai.timer = o.dropInterval;
  seedTerrain(state, e.body.pos, "oil", o.dropRadius);
}

// -----------------------------------------------------------------------------
// 呼び鈴小鬼: 鐘を鳴らすと周りの敵の攻撃間隔が縮む（予備動作は縮めない）
// -----------------------------------------------------------------------------

export function strikeBell(state: GameState, e: Enemy): void {
  const b = ENEMY_AI.bellImp;
  const count = rallyAround(state, e, "hastened", b.radius, b.rallyTime);
  spawnRing(state, e.body.pos, b.radius, b.color, 0.4);
  addFloatingText(state, { x: e.body.pos.x, y: e.body.pos.y - 10 }, `攻撃加速 ${count} 体`, b.color, TEXT_SCALE, TEXT_LIFE);
  pushSfx(state, "enemyWindup");
}

// -----------------------------------------------------------------------------
// 旗持ち: 旗が無ければ立てる（旗の周りの敵は被ダメージが減る）。旗があれば殴りに来る
// -----------------------------------------------------------------------------

/** ai.move: 次の技（旗を立てる / 殴る） */
export const BANNER_PLANT = 1;
const BANNER_MELEE = 0;

export function bannerAlive(state: GameState, e: Enemy): boolean {
  return fixturesOf(state, e, "banner").length > 0;
}

export function telegraphBanner(state: GameState, e: Enemy): void {
  if (e.ai) e.ai.move = bannerAlive(state, e) ? BANNER_MELEE : BANNER_PLANT;
}

/** 旗を立てたら true（隙へ移る）。殴るときは false（通常の突進に任せる） */
export function strikeBanner(state: GameState, e: Enemy): boolean {
  if (e.ai?.move !== BANNER_PLANT) return false;
  const want = add(e.body.pos, scale(e.facing, -PLACE_OFFSET));
  spawnFixture(state, "banner", want, e, true);
  spawnRing(state, e.body.pos, ENEMY_AI.banner.radius, ENEMY_AI.banner.color, 0.5);
  pushSfx(state, "enemyWindup");
  return true;
}

// -----------------------------------------------------------------------------
// 土潜り・天井吊り・影踏み: 潜行（描かれず当たらない）→ 影の予告 → 飛び出す
// -----------------------------------------------------------------------------

function tickBurrowDust(state: GameState, e: Enemy, dt: number): void {
  const ai = e.ai;
  if (!ai || !e.hidden) return;
  ai.timer -= dt;
  if (ai.timer > 0) return;
  ai.timer = ENEMY_AI.burrower.dustInterval;
  // 盛り上がった土だけが見える（位置の手がかり）
  spawnBurst(state, e.body.pos, ENEMY_AI.burrower.color, 2, 25, 0.35, 1.5);
}

export function telegraphBurrow(state: GameState, e: Enemy): void {
  spawnLanding(state, e.body.pos, ENEMY_AI.burrower.emergeRadius, e.phaseTimer, e.id, true);
  spawnBurst(state, e.body.pos, ENEMY_AI.burrower.color, 8, 50, 0.4, 1.5);
}

/** 飛び出し: 足元が炸裂し、姿を晒して長い隙になる */
export function strikeBurrow(state: GameState, e: Enemy): void {
  const b = ENEMY_AI.burrower;
  e.hidden = false;
  blastBoth(state, e.body.pos, b.emergeRadius, b.damage + depthDamageBonus(state.depth), b.color, sourceOf(e), e.id);
  e.phase = "recover";
  e.phaseTimer = b.exposeTime;
}

export function telegraphDrop(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai || !e.hidden) return;
  ai.target = { ...state.player.body.pos };
  spawnLanding(state, ai.target, ENEMY_AI.dropper.radius, e.phaseTimer, e.id);
}

/** 天井から落ちる。落ちたら true（隙へ移る）。姿を見せた後は通常の噛みつき（false） */
export function strikeDrop(state: GameState, e: Enemy, def: EnemyDef): boolean {
  const ai = e.ai;
  if (!ai || !e.hidden) return false;
  const d = ENEMY_AI.dropper;
  e.body.pos = findFreeSpot(state, ai.target, def.radius) ?? e.body.pos;
  e.hidden = false;
  blastBoth(state, ai.target, d.radius, d.damage + depthDamageBonus(state.depth), d.color, sourceOf(e), e.id);
  e.phase = "recover";
  e.phaseTimer = def.recover;
  return true;
}

export function telegraphStalk(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const s = ENEMY_AI.shadowStalker;
  const p = state.player;
  const behind = add(p.body.pos, scale(normalize(p.facing, { x: 1, y: 0 }), -s.behind));
  ai.target = findFreeSpot(state, behind, e.body.radius) ?? { ...p.body.pos };
  e.hidden = true;
  spawnBurst(state, e.body.pos, s.color, 14, 80, 0.4, 2);
  spawnLanding(state, ai.target, s.radius, e.phaseTimer, e.id);
}

/** 影から出て斬る。予告が取り消されて潜ったままにならないよう、ここで必ず姿を見せる */
export function strikeStalk(state: GameState, e: Enemy): void {
  const s = ENEMY_AI.shadowStalker;
  const target = e.ai?.target ?? e.body.pos;
  e.body.pos = { ...target };
  e.hidden = false;
  blastBoth(state, target, s.radius, s.damage + depthDamageBonus(state.depth), s.color, sourceOf(e), e.id);
  e.phase = "recover";
  e.phaseTimer = s.exposeTime;
}

/** 隙が明けたときの後始末（土潜りは潜り直す） */
export function onRecoverEndWave3(e: Enemy, def: EnemyDef): void {
  if (def.behavior === "burrower") e.hidden = true;
  // 影踏みは予備動作が取り消されても潜ったままにしない
  if (def.behavior === "shadowStalker") e.hidden = false;
}

// -----------------------------------------------------------------------------
// 吸い込み蟲: 近くのプレイヤーの弾を吸い、吸った数だけ扇に吐き返す
// -----------------------------------------------------------------------------

function absorbShots(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const a = ENEMY_AI.absorber;
  for (const pr of state.projectiles) {
    if (pr.owner !== "player" || pr.life <= 0 || dist(pr.pos, e.body.pos) > a.radius) continue;
    pr.life = 0;
    ai.counter = Math.min(a.maxShots, ai.counter + 1);
    spawnLine(state, pr.pos, e.body.pos, a.color, 0.15);
  }
}

export function absorberReady(e: Enemy): boolean {
  return (e.ai?.counter ?? 0) > 0;
}

export function strikeAbsorber(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const a = ENEMY_AI.absorber;
  const count = ai.counter;
  ai.counter = 0;
  const damage = a.bulletDamage + depthDamageBonus(state.depth);
  for (const dir of fanDirections(e.strikeDir, count, a.spreadDeg)) {
    const pos = add(e.body.pos, scale(dir, e.body.radius + 2));
    fireEnemyBullet(state, { pos, dir, speed: a.bulletSpeed, damage, color: a.color, sourceId: e.id });
  }
  pushSfx(state, "enemyShoot");
}

// -----------------------------------------------------------------------------
// ホムンクルス: プレイヤーの状態異常を 1 つ吸い取り、炸裂に乗せて返す（炸裂は敵にも当たる）
// -----------------------------------------------------------------------------

/** 吸い取る順（悪い状態のうち、返されて困るものから） */
const STEALABLE: readonly StatusKind[] = ["burn", "chill", "poison", "bleed", "shock", "vulnerable", "weaken", "wet", "oiled", "corrode"];

/** 吸った状態異常（ai.counter に STATUS_KINDS の添字 + 1。0 は無し） */
export function stolenStatus(e: Enemy): StatusKind | undefined {
  const c = e.ai?.counter ?? 0;
  return c > 0 ? STATUS_KINDS[c - 1] : undefined;
}

export function telegraphHomunculus(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const h = ENEMY_AI.homunculus;
  stealStatus(state, e);
  const center = { ...state.player.body.pos };
  const points: Vec[] = [center];
  for (let i = 1; i < h.blasts; i++) {
    const q = add(center, scale(fromAngle((i / (h.blasts - 1)) * FULL_CIRCLE + e.id), h.spread));
    points.push(q);
  }
  ai.points = points;
  for (const p of points) spawnLanding(state, p, h.radius, e.phaseTimer, e.id);
}

function stealStatus(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const bag = state.player.status;
  const kind = STEALABLE.find((k) => hasStatus(bag, k));
  if (!kind) {
    ai.counter = 0;
    return;
  }
  ai.counter = STATUS_KINDS.indexOf(kind) + 1;
  ai.timer = findStatus(bag, kind)?.stacks ?? 1;
  removeStatus(state, { kind: "player" }, kind);
  spawnLine(state, state.player.body.pos, e.body.pos, ENEMY_AI.homunculus.color, 0.3);
  addFloatingText(state, state.player.body.pos, "状態異常吸収", ENEMY_AI.homunculus.color, TEXT_SCALE, TEXT_LIFE);
}

export function strikeHomunculus(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const h = ENEMY_AI.homunculus;
  const kind = stolenStatus(e);
  const stacks = Math.max(1, Math.round(ai.timer));
  const damage = h.damage + depthDamageBonus(state.depth);
  for (const p of ai.points ?? []) {
    const hitsPlayer = playerOpenAt(state, p, h.radius);
    blastBoth(state, p, h.radius, damage, h.color, sourceOf(e), e.id);
    if (!kind) continue;
    const apply = { kind, stacks, duration: h.fallbackDuration, potency: 0 };
    if (hitsPlayer) applyStatus(state, { kind: "player" }, apply, "enemy");
    // 返した状態異常は炸裂に巻き込まれた敵にも付く（群れの中へ誘えば武器になる）
    for (const o of state.enemies) {
      if (o === e || o.hp <= 0 || dist(o.body.pos, p) > h.radius + o.body.radius) continue;
      applyStatus(state, { kind: "enemy", enemy: o }, apply, "env");
    }
  }
  ai.points = [];
  ai.counter = 0;
}

/** プレイヤーが半径内にいて、無敵でない（炸裂が当たる） */
function playerOpenAt(state: GameState, pos: Vec, radius: number): boolean {
  const p = state.player;
  if (p.invulnTimer > 0 || p.buffs.invuln > 0) return false;
  return dist(p.body.pos, pos) < radius + p.body.radius;
}

// -----------------------------------------------------------------------------
// 写本の小悪魔: プレイヤーが最後に撃ったスキルの種類を写し、弱い版で撃ち返す
// -----------------------------------------------------------------------------

/** ai.move: 写した技の種類 */
export const SCRIBE_BULLETS = 0;
export const SCRIBE_RING = 1;
export const SCRIBE_BLASTS = 2;
export const SCRIBE_DASH = 3;

/** スキル石の種類（tags）を写しの技に読み替える */
export function scribeMoveOf(skillKey: string): number {
  const def = Object.values(SKILL_DEFS).find((d) => d.key === skillKey);
  if (!def) return SCRIBE_BULLETS;
  if (def.tags.includes("placed")) return SCRIBE_BLASTS;
  if (def.tags.includes("area")) return SCRIBE_RING;
  if (def.tags.includes("movement") || def.tags.includes("melee")) return SCRIBE_DASH;
  return SCRIBE_BULLETS;
}

function copyLastSkill(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const cast = [...state.events].reverse().find((ev) => ev.kind === "onSkillCast" && ev.source.kind === "skill");
  if (!cast) return;
  const move = scribeMoveOf(cast.source.key);
  if (move === ai.move && ai.stage === PACK_DONE) return;
  ai.move = move;
  ai.stage = PACK_DONE;
  addFloatingText(state, { x: e.body.pos.x, y: e.body.pos.y - 10 }, "模倣", ENEMY_AI.scribeImp.color, TEXT_SCALE, TEXT_LIFE);
}

export function telegraphScribe(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const s = ENEMY_AI.scribeImp;
  const center = { ...state.player.body.pos };
  if (ai.move === SCRIBE_RING) {
    ai.points = [center];
    spawnLanding(state, center, s.ringRadius, e.phaseTimer, e.id);
    return;
  }
  if (ai.move !== SCRIBE_BLASTS) return;
  const points: Vec[] = [];
  for (let i = 0; i < s.blastCount; i++) points.push(add(center, scale(fromAngle((i / s.blastCount) * FULL_CIRCLE + e.id), i === 0 ? 0 : s.blastSpread)));
  ai.points = points;
  for (const p of points) spawnLanding(state, p, s.blastRadius, e.phaseTimer, e.id);
}

/** 写しの技を撃つ。突進（SCRIBE_DASH）は enemies.ts の突進に任せる（false） */
export function strikeScribe(state: GameState, e: Enemy): boolean {
  const ai = e.ai;
  if (!ai) return true;
  const s = ENEMY_AI.scribeImp;
  const bonus = depthDamageBonus(state.depth);
  switch (ai.move) {
    case SCRIBE_DASH:
      return false;
    case SCRIBE_RING:
      for (const p of ai.points ?? []) blastBoth(state, p, s.ringRadius, s.ringDamage + bonus, s.color, sourceOf(e), e.id);
      return true;
    case SCRIBE_BLASTS:
      for (const p of ai.points ?? []) blastBoth(state, p, s.blastRadius, s.blastDamage + bonus, s.color, sourceOf(e), e.id);
      return true;
    default:
      for (const dir of fanDirections(e.strikeDir, s.bulletCount, s.spreadDeg)) {
        const pos = add(e.body.pos, scale(dir, e.body.radius + 2));
        fireEnemyBullet(state, { pos, dir, speed: s.bulletSpeed, damage: s.bulletDamage + bonus, color: s.color, sourceId: e.id });
      }
      pushSfx(state, "enemyShoot");
      return true;
  }
}

// -----------------------------------------------------------------------------
// 十字ゴーレム: 十字（と、1 回おきに斜め十字）の 4 本の線。円を避けるゴーレムと読み方が逆になる
// -----------------------------------------------------------------------------

/** ai.move: 0 = 縦横の十字 / 1 = 斜めの十字 */
export function telegraphCross(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const base = ai.move === 1 ? Math.PI / 4 : 0;
  ai.points = [0, 1, 2, 3].map((i) => laserEnd(state, e.body.pos, fromAngle(base + (i * Math.PI) / 2), ENEMY_AI.crossGolem.length));
}

export function strikeCross(state: GameState, e: Enemy, def: EnemyDef): void {
  const ai = e.ai;
  if (!ai) return;
  const damage = ENEMY_AI.crossGolem.damage + depthDamageBonus(state.depth);
  for (const end of ai.points ?? []) spawnLaser(state, e.body.pos, end, def.strikeTime, damage, e.id);
  ai.move = ai.move === 1 ? 0 : 1;
  shake(state, 3);
  pushSfx(state, "laserFire");
}

// -----------------------------------------------------------------------------
// 風吹き: 扇の風でプレイヤー・敵・弾を押し流す（敵を壁に叩きつける道具にもなる）
// -----------------------------------------------------------------------------

function pushCapped(knock: Vec, dir: Vec, amount: number, cap: number): Vec {
  const next = add(knock, scale(dir, amount));
  const len = length(next);
  return len > cap ? scale(next, cap / len) : next;
}

/** 攻撃中（strike）の毎ステップ */
export function blowWind(state: GameState, e: Enemy, dt: number): void {
  const w = ENEMY_AI.windSprite;
  const dir = e.strikeDir;
  const push = w.push * dt;
  const half = w.arcDeg / 2;
  const p = state.player;
  if (inCone(e.body.pos, dir, w.range, half, p.body.pos)) p.knock = pushCapped(p.knock, dir, push, w.maxPush);
  for (const o of state.enemies) {
    if (o === e || o.hp <= 0 || o.hidden || !inCone(e.body.pos, dir, w.range, half, o.body.pos)) continue;
    const od = enemyDef(o.defKey);
    if (od.boss || od.speed <= 0) continue;
    o.knock = pushCapped(o.knock, dir, push, w.maxPush);
    // 強く流された敵は壁に当たると叩きつけになる（風上から敵を壁へ押し込む遊び）
    o.wallSplat = true;
  }
  for (const pr of state.projectiles) {
    if (!inCone(e.body.pos, dir, w.range, half, pr.pos)) continue;
    pr.vel = add(pr.vel, scale(dir, w.bulletPush * dt));
  }
  if (state.tick % 4 === 0) {
    const q = add(e.body.pos, scale(dir, e.body.radius + 4));
    spawnBurst(state, q, w.color, 1, w.range, 0.4, 1);
  }
}

// -----------------------------------------------------------------------------
// 地雷撒き・地雷: 逃げながら見える地雷を落とす。踏むと（敵が踏んでも）予告の後に爆ぜる
// -----------------------------------------------------------------------------

function tickMineLayer(state: GameState, e: Enemy, dt: number): void {
  const ai = e.ai;
  if (!ai) return;
  const m = ENEMY_AI.mineLayer;
  ai.timer -= dt;
  if (ai.timer > 0) return;
  ai.timer = m.dropInterval;
  if (fixturesOf(state, e, "enemyMine").length >= m.max) return;
  spawnFixture(state, "enemyMine", e.body.pos, e, false);
  pushSfx(state, "bombFuse");
}

/** 地雷を踏んだのは誰か: プレイヤーか、撒いた本人と地雷以外の敵 */
export function mineTriggered(state: GameState, e: Enemy): boolean {
  const r = ENEMY_AI.mine.trigger;
  if (dist(state.player.body.pos, e.body.pos) < r + state.player.body.radius) return true;
  return state.enemies.some(
    (o) =>
      o !== e &&
      o.hp > 0 &&
      o.id !== e.leaderId &&
      !o.hidden &&
      o.phase !== "spawning" &&
      enemyDef(o.defKey).behavior !== "mine" &&
      dist(o.body.pos, e.body.pos) < r + o.body.radius,
  );
}

export function telegraphMine(state: GameState, e: Enemy): void {
  spawnLanding(state, e.body.pos, ENEMY_AI.mine.radius, e.phaseTimer, e.id, true);
}

export function strikeMine(state: GameState, e: Enemy): void {
  const m = ENEMY_AI.mine;
  blastBoth(state, e.body.pos, m.radius, m.damage + depthDamageBonus(state.depth), m.color, sourceOf(e), e.id);
  e.vanished = true;
  e.hp = 0;
}

// -----------------------------------------------------------------------------
// 鎖の番人・大蝦蟇: 線の予告 → 当たると引き寄せ → 続けて叩きつけ
// -----------------------------------------------------------------------------

/** ai.move: 鎖（舌）/ 叩きつけ（噛みつき）/ 吐く（大蝦蟇だけ） */
export const HOOK_PULL = 0;
export const HOOK_SLAM = 1;
export const HOOK_LOB = 2;

export function telegraphHook(state: GameState, e: Enemy, dir: Vec, reach: number): void {
  const ai = e.ai;
  if (!ai || ai.move !== HOOK_PULL) return;
  ai.target = laserEnd(state, e.body.pos, dir, reach);
}

/** 鎖が当たったら引き寄せて、次を叩きつけにする。当たったか */
export function strikeHook(state: GameState, e: Enemy, pull: number, damage: number): boolean {
  const ai = e.ai;
  if (!ai) return false;
  const p = state.player;
  spawnLine(state, e.body.pos, ai.target, ENEMY_AI.chainWarden.color, 0.25);
  pushSfx(state, "chainThrow");
  // 霊体化（skills/forms.ts）は鎖もすり抜ける（投げる見た目と音は残す）
  if (state.skills.shape?.key === "wraithForm") return false;
  if (!segmentCircleHit(e.body.pos, ai.target, 3, p.body.pos, p.body.radius)) return false;
  if (damagePlayer(state, damage + depthDamageBonus(state.depth), e.body.pos, e) !== "hit") return false;
  p.knock = scale(normalize(sub(e.body.pos, p.body.pos)), pull);
  ai.move = HOOK_SLAM;
  return true;
}

/** 引き寄せた後の叩きつけの予備動作（秒）。続けないなら null（enemies.ts の endStrike が読む） */
export function hookFollowUp(e: Enemy, def: EnemyDef): number | null {
  if (def.behavior !== "chainWarden" && def.behavior !== "giantToad") return null;
  if (e.ai?.move !== HOOK_SLAM || e.phase !== "strike") return null;
  return ENEMY_AI.chainWarden.slamWindup;
}

export function strikeWarden(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const c = ENEMY_AI.chainWarden;
  if (ai.move === HOOK_SLAM) {
    strikeShockRing(state, e, c.slamRadius, c.slamDamage, c.color);
    ai.move = HOOK_PULL;
    return;
  }
  strikeHook(state, e, c.pull, c.pullDamage);
}

/** 大蝦蟇: 舌 → （当たれば噛みつき）→ 吐く、を回す。周りに浅瀬を作ってから戦う */
export function strikeToad(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  const g = ENEMY_AI.giantToad;
  if (ai.move === HOOK_SLAM) {
    strikeShockRing(state, e, g.biteRadius, g.biteDamage, g.color);
    ai.move = HOOK_LOB;
    return;
  }
  if (ai.move === HOOK_LOB) {
    const target = ai.target;
    blastBoth(state, target, g.biteRadius, g.biteDamage / 2 + depthDamageBonus(state.depth), g.color, sourceOf(e), e.id);
    placeTerrain(state, target.x, target.y, "water", g.pondRadius / 2);
    pushSfx(state, "oilSplash");
    ai.move = HOOK_PULL;
    return;
  }
  if (!strikeHook(state, e, g.pull, 0)) ai.move = HOOK_LOB;
}

export function telegraphToad(state: GameState, e: Enemy, dir: Vec): void {
  const ai = e.ai;
  if (!ai) return;
  if (ai.move === HOOK_LOB) {
    ai.target = { ...state.player.body.pos };
    spawnLanding(state, ai.target, ENEMY_AI.giantToad.biteRadius, e.phaseTimer, e.id);
    return;
  }
  telegraphHook(state, e, dir, ENEMY_AI.giantToad.tongueLength);
}

function makePondOnce(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai || ai.stage !== PACK_PENDING) return;
  ai.stage = PACK_DONE;
  seedTerrain(state, e.body.pos, "water", ENEMY_AI.giantToad.pondRadius);
}

// -----------------------------------------------------------------------------
// 虚ろ: 照準（向き）を向けられている間は固まる。背を向けると寄ってくる
// -----------------------------------------------------------------------------

export function hollowFrozen(state: GameState, e: Enemy): boolean {
  const p = state.player;
  return inCone(p.body.pos, p.facing, Infinity, ENEMY_AI.hollow.freezeArcDeg, e.body.pos);
}

// -----------------------------------------------------------------------------
// 火喰い: 燃えている床・敵へ寄って食べ、回復して育つ（燃焼が効かない）
// -----------------------------------------------------------------------------

const FIRE_CODE = TERRAIN_KINDS.indexOf("fire");

/** 一番近い火（燃える床のセルの中心か、燃えている敵の位置） */
export function nearestFire(state: GameState, e: Enemy): Vec | undefined {
  const f = ENEMY_AI.flameEater;
  let best: Vec | undefined;
  let bestD: number = f.seekRadius;
  const layer = state.terrain;
  if (layer.map === state.map) {
    for (const i of layer.active) {
      if ((layer.kinds[i] ?? 0) !== FIRE_CODE) continue;
      const q = { x: ((i % state.map.width) + 0.5) * TILE_SIZE, y: (Math.floor(i / state.map.width) + 0.5) * TILE_SIZE };
      const d = dist(q, e.body.pos);
      if (d >= bestD) continue;
      best = q;
      bestD = d;
    }
  }
  for (const o of state.enemies) {
    if (o === e || o.hp <= 0 || !hasStatus(o.status, "burn")) continue;
    const d = dist(o.body.pos, e.body.pos);
    if (d >= bestD) continue;
    best = { ...o.body.pos };
    bestD = d;
  }
  return best;
}

function tickFlameEater(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  const ai = e.ai;
  if (!ai) return;
  ai.timer = Math.max(0, ai.timer - dt);
  if (ai.timer > 0 || e.phase !== "chase") return;
  const f = ENEMY_AI.flameEater;
  const reach = e.body.radius + f.eatRadius;
  if (eatFireCell(state, e, reach) || eatBurningEnemy(state, e, reach)) {
    ai.timer = f.eatCooldown;
    feed(state, e, def);
  }
}

function eatFireCell(state: GameState, e: Enemy, reach: number): boolean {
  const layer = state.terrain;
  if (layer.map !== state.map) return false;
  for (const i of layer.active) {
    if (terrainAtIndex(state, i) !== "fire") continue;
    const q = { x: ((i % state.map.width) + 0.5) * TILE_SIZE, y: (Math.floor(i / state.map.width) + 0.5) * TILE_SIZE };
    if (dist(q, e.body.pos) > reach) continue;
    // 炎のセルを空にする（none を置くと消える）
    placeTerrain(state, q.x, q.y, "none", 1, 0);
    return true;
  }
  return false;
}

function eatBurningEnemy(state: GameState, e: Enemy, reach: number): boolean {
  const o = state.enemies.find((x) => x !== e && x.hp > 0 && hasStatus(x.status, "burn") && dist(x.body.pos, e.body.pos) <= reach + x.body.radius);
  if (!o) return false;
  removeStatus(state, { kind: "enemy", enemy: o }, "burn");
  spawnLine(state, o.body.pos, e.body.pos, ENEMY_AI.flameEater.color, 0.25);
  return true;
}

/** 食べた: HP が戻り、段が上がると体が大きくなる（壁際で育てなければ HP だけ戻る） */
function feed(state: GameState, e: Enemy, def: EnemyDef): void {
  const ai = e.ai;
  if (!ai) return;
  const f = ENEMY_AI.flameEater;
  e.hp = Math.min(e.maxHp, e.hp + Math.round(e.maxHp * f.heal));
  e.lastHp = e.hp;
  addFloatingText(state, e.body.pos, "捕食", f.color, TEXT_SCALE, TEXT_LIFE);
  spawnBurst(state, e.body.pos, f.color, 10, 70, 0.3, 1.5);
  if (ai.counter >= f.maxGrowth) return;
  if (growBody(state, e, def.radius + (ai.counter + 1) * f.radiusPerGrowth)) ai.counter += 1;
}

// -----------------------------------------------------------------------------
// 石化の蜥蜴: 睨みの扇の中で止まっていると冷気が溜まる（動き続ければ無害）
// -----------------------------------------------------------------------------

/** ai.move: 睨み / 噛みつき を交互に */
export const BASILISK_GAZE = 0;
export const BASILISK_BITE = 1;

export function nextBasiliskMove(e: Enemy): void {
  if (e.ai) e.ai.move = e.ai.move === BASILISK_GAZE ? BASILISK_BITE : BASILISK_GAZE;
}

/** 睨みの最中（strike）の毎ステップ */
export function tickGaze(state: GameState, e: Enemy, dt: number): void {
  const ai = e.ai;
  if (!ai || ai.move !== BASILISK_GAZE) return;
  const b = ENEMY_AI.basilisk;
  ai.timer -= dt;
  if (ai.timer > 0) return;
  ai.timer = b.chillEvery;
  const p = state.player;
  if (!inCone(e.body.pos, e.strikeDir, b.range, b.arcDeg / 2, p.body.pos)) return;
  if (length(p.body.vel) > b.stillSpeed) return;
  applyStatus(state, { kind: "player" }, { kind: "chill", stacks: 1, duration: 2, potency: 0 }, "enemy");
  spawnBurst(state, p.body.pos, b.color, 4, 40, 0.3, 1.5);
}

// -----------------------------------------------------------------------------
// 炎の鍛冶: 金床を叩くと燃える刃を飛ばし、金床の周りが燃える。金床を壊すと怯み、怒る
// -----------------------------------------------------------------------------

/** ai.move: 金床を壊されて怒っている */
const FORGE_ENRAGED = 1;

export function forgeEnraged(e: Enemy): boolean {
  return e.ai?.move === FORGE_ENRAGED;
}

function watchAnvil(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai || ai.stage !== PACK_DONE || ai.move === FORGE_ENRAGED) return;
  if (fixturesOf(state, e, "anvil").length > 0) return;
  const f = ENEMY_AI.forgeMaster;
  ai.move = FORGE_ENRAGED;
  addFloatingText(state, { x: e.body.pos.x, y: e.body.pos.y - 14 }, "金床破壊", f.color, 1.3, 1);
  pushSfx(state, "guardBreak");
  applyStagger(state, e, f.anvilBreakStagger, { selfInflicted: true });
}

export function strikeForge(state: GameState, e: Enemy): void {
  const f = ENEMY_AI.forgeMaster;
  const damage = f.bladeDamage + depthDamageBonus(state.depth);
  for (const dir of fanDirections(e.strikeDir, f.bladeCount, f.spreadDeg)) {
    const pos = add(e.body.pos, scale(dir, e.body.radius + 2));
    fireEnemyBullet(state, { pos, dir, speed: f.bladeSpeed, damage, color: f.color, sourceId: e.id });
  }
  const anvil = fixturesOf(state, e, "anvil")[0];
  if (anvil) seedTerrain(state, anvil.body.pos, "fire", f.fireRadius);
  pushSfx(state, "wallHit");
}

// -----------------------------------------------------------------------------
// 砲台長: 部屋の四隅に砲台を置く。砲台が壊れるたびに怯む
// -----------------------------------------------------------------------------

function tickTurretMaster(state: GameState, e: Enemy): void {
  const ai = e.ai;
  if (!ai) return;
  if (ai.stage === PACK_PENDING) {
    placeTurrets(state, e);
    ai.stage = PACK_DONE;
    ai.counter = fixturesOf(state, e, "turret").length;
    return;
  }
  const alive = fixturesOf(state, e, "turret").length;
  if (alive >= ai.counter) return;
  ai.counter = alive;
  applyStagger(state, e, ENEMY_AI.turretMaster.turretBreakStagger, { selfInflicted: true });
  addFloatingText(state, { x: e.body.pos.x, y: e.body.pos.y - 14 }, `砲台 残り ${alive}`, ENEMY_AI.turretMaster.color, 1.1, 0.9);
}

/** 部屋の四隅（内側 1.5 マス）。壁に掛かれば砲台長の近くの空きへ */
function placeTurrets(state: GameState, e: Enemy): void {
  const room = state.rooms[e.roomIndex];
  const n = ENEMY_AI.turretMaster.turrets;
  const corners: Vec[] = room
    ? [
        { x: room.rect.x + 1.5, y: room.rect.y + 1.5 },
        { x: room.rect.x + room.rect.w - 1.5, y: room.rect.y + 1.5 },
        { x: room.rect.x + 1.5, y: room.rect.y + room.rect.h - 1.5 },
        { x: room.rect.x + room.rect.w - 1.5, y: room.rect.y + room.rect.h - 1.5 },
      ].map((c) => scale(c, TILE_SIZE))
    : [];
  for (let i = 0; i < n; i++) {
    const want = corners[i] ?? add(e.body.pos, scale(fromAngle((i / n) * FULL_CIRCLE), PLACE_OFFSET * 3));
    spawnFixture(state, "turret", want, e, true);
  }
}

export function strikeTurretMaster(state: GameState, e: Enemy): void {
  const t = ENEMY_AI.turretMaster;
  const damage = t.orbDamage + depthDamageBonus(state.depth);
  for (const dir of fanDirections(e.strikeDir, 3, 40)) {
    fireEnemyBullet(state, { pos: add(e.body.pos, scale(dir, e.body.radius + 2)), dir, speed: t.orbSpeed, damage, color: t.color, sourceId: e.id });
  }
  pushSfx(state, "enemyShoot");
}

export function strikeTurret(state: GameState, e: Enemy): void {
  const t = ENEMY_AI.turret;
  const pos = add(e.body.pos, scale(e.strikeDir, e.body.radius + 2));
  fireEnemyBullet(state, { pos, dir: e.strikeDir, speed: t.bulletSpeed, damage: t.bulletDamage + depthDamageBonus(state.depth), color: "#e0e0ff", sourceId: e.id });
  pushSfx(state, "enemyShoot");
}

// -----------------------------------------------------------------------------
// 卵（群れの母）: 時間で孵る。割られると母に怯み値が入る（boss 側が読む）
// -----------------------------------------------------------------------------

function tickEgg(state: GameState, e: Enemy, dt: number): void {
  const ai = e.ai;
  if (!ai) return;
  ai.timer += dt;
  if (ai.timer < BOSS.broodMother.eggHatch) return;
  const mother = state.enemies.find((o) => o.id === e.leaderId && o.hp > 0);
  const key = (mother?.ai?.stage ?? 1) >= 2 ? "spikeRat" : "sproutSlime";
  const def = enemyDef(key);
  const hatchling = createEnemy(state, def, findFreeSpot(state, e.body.pos, def.radius) ?? e.body.pos, e.roomIndex, true);
  hatchling.revived = true;
  state.enemies.push(hatchling);
  spawnBurst(state, e.body.pos, "#e0e0a0", 10, 70, 0.35, 1.5);
  e.vanished = true;
  e.hp = 0;
}

