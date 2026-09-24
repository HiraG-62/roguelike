import { type Enemy, type EnemyAi, type GameState, allocId, pushSfx } from "../core/state";
import { enemyTarget, pushEvent } from "../core/events";
import { type Vec, add, dist, fromAngle, length, normalize, scale, sub } from "../core/vec";
import { type EnemyBehavior, type EnemyDef, depthDamageBonus, depthHpScale, enemyDef } from "../data/enemies";
import { ACTION, BOSS, ELITE, ENEMY_AI, ENEMY_TEMPO, FEEL, POISE } from "../data/tuning";
import { type PlayerHitResult, damageEnemy, damagePlayer, rollOutgoing } from "./combat";
import { shake, spawnBurst } from "./effects";
import { commandNearby, eliteKnockImmune, eliteSpeedMul, eliteWindupMul, onEliteDeath, takeEliteEcho, updateElites, updateGreedy } from "./elites";
import { chipBoneWallsByShots, damageBoneWalls, laserEnd, spawnBomb, spawnBoneWall, spawnLaser, spawnShockwave } from "./hazards";
import { circlesOverlap, moveBody, overlapsWall } from "./physics";
import { chillFactor, createPoiseState, hasStatus, inflictOnPlayer, isFeared, isHalted, isSilenced } from "./statusEffects";
import { applyStagger, initEnemyPoise } from "./poise";
import { boonWindupMul } from "./boonRules";
import { createStatusBag } from "../core/status";
import { bossTelegraph, isBossDriven, onBossDeath, updateBossEnemy } from "./boss";
import { TILE_SIZE } from "../map/grid";
import { chaseHeading, lineOfSight } from "../map/pathing";
import { onRallyContact, seedTerrain, terrainSpeedMul, tickSpores, updateRallies, updateTerrainSeeds } from "./enemyTerrain";
import { placeTerrain, terrainMoveMul } from "./terrain";
import {
  BASILISK_BITE,
  BASILISK_GAZE,
  HOOK_LOB,
  HOOK_SLAM,
  SCRIBE_BLASTS,
  SCRIBE_DASH,
  SCRIBE_RING,
  absorberReady,
  bannerAlive,
  beforeActWave3,
  blowWind,
  forgeEnraged,
  hollowFrozen,
  hookFollowUp,
  mineTriggered,
  nearestFire,
  nextBasiliskMove,
  onRecoverEndWave3,
  strikeAbsorber,
  strikeBanner,
  strikeBell,
  strikeBurrow,
  strikeCross,
  strikeDrop,
  strikeForge,
  strikeHomunculus,
  strikeLob,
  strikeMine,
  strikeScribe,
  strikeStalk,
  strikeToad,
  strikeTurret,
  strikeTurretMaster,
  strikeWarden,
  telegraphBanner,
  telegraphBurrow,
  telegraphCross,
  telegraphDrop,
  telegraphHomunculus,
  telegraphHook,
  telegraphLob,
  telegraphMine,
  telegraphScribe,
  telegraphStalk,
  telegraphToad,
  tickGaze,
} from "./enemyWave3";
import { twinTelegraphIsLine } from "./bossTwins";
import { GIANT_MOVE_SLAM } from "./bossFrostGiant";
import {
  PACK_PENDING,
  fanDirections,
  fireEnemyBullet,
  frenzyMul,
  onEnemyDeath,
  spawnPackOnce,
  stealMana,
  tickTwinRevive,
  updateCorpses,
  updateTimid,
} from "./enemyTraits";
import {
  conductorVolley,
  contactDamageOf,
  detonate,
  finishEating,
  frostCrusherReady,
  isMimicTongue,
  nextMimicMove,
  planDoubleCharge,
  rallyFollowers,
  recordTrail,
  ringBell,
  scavengerHeading,
  strikeEcho,
  strikeShockRing,
  strikeSilence,
  steerDoubleCharge,
  telegraphEcho,
  telegraphKamikaze,
  telegraphSilence,
  transformIfBroken,
  tryStartEating,
} from "./enemyBehaviors";

const KNOCK_DECAY = 12;
/** 通路からでも気付く距離 */
const NOTICE_RANGE = 110;
/** strike 中の移動速度倍率（def.speed に掛ける）。0 はその場で攻撃 */
const STRIKE_SPEED_MUL: Record<EnemyBehavior, number> = {
  chaser: 4.6,
  shooter: 0,
  charger: 7.5,
  knight: ENEMY_AI.knight.lungeSpeedMul,
  bomber: 0,
  laser: 0,
  golem: 0,
  bat: 3.2,
  wisp: 3,
  kingSlime: 0,
  boneLord: 0,
  kamikaze: 0,
  echoStriker: 0,
  packLeader: 4.6,
  conductor: 0,
  manaLeech: 4.6,
  scavenger: 4.6,
  graveBell: 0,
  silencer: 0,
  frostCrusher: 0,
  twinShade: 4.6,
  mimic: ENEMY_AI.mimic.biteSpeedMul,
  hollowArmor: 0,
  inert: 0,
  twinBlade: 0,
  twinBow: 0,
  frostGiant: 0,
  lobber: 0,
  oiler: 4.6,
  bellImp: 0,
  bannerBearer: 4.6,
  burrower: 0,
  dropper: 4.6,
  absorber: 0,
  homunculus: 0,
  scribeImp: 0,
  crossGolem: 0,
  windSprite: 0,
  mineLayer: 0,
  mine: 0,
  chainWarden: 0,
  hollow: 5,
  flameEater: 4.6,
  egg: 0,
  turret: 0,
  giantToad: 0,
  forgeMaster: 0,
  turretMaster: 0,
  basilisk: 0,
  shadowStalker: 0,
  oilKing: 0,
  broodMother: 0,
  librarian: 0,
  mirrorKnight: 0,
  thiefKing: 0,
};
/** 予備動作中も動けるか（laser はチャージ中に止まる） */
const WINDUP_MOVE_MUL: Record<EnemyBehavior, number> = {
  chaser: 0,
  shooter: 0,
  charger: 0,
  knight: 0,
  bomber: 0,
  laser: 0,
  golem: 0,
  bat: 0.3,
  wisp: 0.3,
  kingSlime: 0,
  boneLord: 0,
  kamikaze: 0,
  echoStriker: 0,
  packLeader: 0,
  conductor: 0,
  manaLeech: 0,
  scavenger: 0,
  graveBell: 0,
  silencer: 0,
  frostCrusher: 0,
  twinShade: 0,
  mimic: 0,
  hollowArmor: 0,
  inert: 0,
  twinBlade: 0,
  twinBow: 0,
  frostGiant: 0,
  lobber: 0,
  oiler: 0,
  bellImp: 0,
  bannerBearer: 0,
  burrower: 0,
  dropper: 0,
  absorber: 0,
  homunculus: 0,
  scribeImp: 0,
  crossGolem: 0,
  windSprite: 0,
  mineLayer: 0,
  mine: 0,
  chainWarden: 0,
  hollow: 0,
  flameEater: 0,
  egg: 0,
  turret: 0,
  giantToad: 0,
  forgeMaster: 0,
  turretMaster: 0,
  basilisk: 0,
  shadowStalker: 0,
  oilKing: 0,
  broodMother: 0,
  librarian: 0,
  mirrorKnight: 0,
  thiefKing: 0,
};
/** 距離を保って動く（射撃・詠唱する）behavior と、その保つ距離 */
const KEEP_AWAY: Partial<Record<EnemyBehavior, number>> = {
  echoStriker: ENEMY_AI.echoStriker.keepAway,
  silencer: ENEMY_AI.silencer.keepAway,
  conductor: ENEMY_AI.conductor.keepAway,
  lobber: ENEMY_AI.lobber.keepAway,
  bellImp: ENEMY_AI.bellImp.keepAway,
  homunculus: ENEMY_AI.homunculus.keepAway,
  scribeImp: ENEMY_AI.scribeImp.keepAway,
  windSprite: ENEMY_AI.windSprite.keepAway,
  mineLayer: ENEMY_AI.mineLayer.keepAway,
  forgeMaster: ENEMY_AI.forgeMaster.keepAway,
};
/** その場から動かない behavior */
const STATIONARY: ReadonlySet<EnemyBehavior> = new Set<EnemyBehavior>(["graveBell", "inert", "absorber", "mine", "egg", "turret"]);
/** 旗持ちが旗を立てた後に殴りに来る距離 */
const BANNER_MELEE_RANGE = 44;
const SEPARATION_FORCE = 40;
const ENEMY_BULLET_SPEED = 135;
const ENEMY_BULLET_DAMAGE = 8;
const ENEMY_BULLET_COLOR = "#e070ff";
const SPAWN_TIME = 0.7;
const DEG_TO_RAD = Math.PI / 180;
/** 沈黙中は予備動作に入れない（射撃・レーザー・爆弾・詠唱・鐘・指揮） */
const SILENCED_BEHAVIORS: ReadonlySet<EnemyBehavior> = new Set<EnemyBehavior>([
  "shooter",
  "laser",
  "bomber",
  "echoStriker",
  "silencer",
  "graveBell",
  "conductor",
  "lobber",
  "bellImp",
  "homunculus",
  "scribeImp",
  "windSprite",
  "turret",
  "turretMaster",
  "basilisk",
]);

/** 連続攻撃の定義（ENEMY_TEMPO.followUps の 1 行） */
export interface FollowUpDef {
  minDepth: number;
  /** 追加の撃数 */
  count: number;
  /** 2 撃目以降の予備動作の基準（秒） */
  windup: number;
  /** 壁に激突したときだけ続ける（猪） */
  onWallOnly: boolean;
}
const FOLLOW_UPS: Readonly<Record<string, FollowUpDef | undefined>> = ENEMY_TEMPO.followUps;

/** 深度による予備動作の倍率。1 階で 1、深くなるほど短く windupDepthMin で止まる */
export function depthWindupMul(depth: number): number {
  return Math.max(ENEMY_TEMPO.windupDepthMin, 1 - ENEMY_TEMPO.windupDepthStep * Math.max(0, depth - 1));
}

/**
 * 基準の予備動作に深度と追加の倍率（迅速エリート・ボスの段階）を掛ける。
 * 掛け合わせても基準の windupFloor 倍を下回らせない（テレグラフが読めなくなるため。原則 3）
 */
export function scaledWindup(base: number, depth: number, extraMul = 1): number {
  return base * Math.max(ENEMY_TEMPO.windupFloor, depthWindupMul(depth) * extraMul);
}

/** その深度で使える連続攻撃。無ければ undefined */
export function followUpOf(key: string, depth: number): FollowUpDef | undefined {
  const f = FOLLOW_UPS[key];
  if (!f || depth < f.minDepth) return undefined;
  return f;
}

export function createAi(): EnemyAi {
  return { target: { x: 0, y: 0 }, timer: 0, counter: 0, stage: PACK_PENDING, move: 0 };
}

export function createEnemy(state: GameState, def: EnemyDef, pos: Vec, roomIndex: number, spawning: boolean): Enemy {
  const hp = Math.round(def.hp * depthHpScale(state.depth));
  const enemy: Enemy = {
    id: allocId(state),
    defKey: def.key,
    roomIndex,
    body: { pos: { ...pos }, vel: { x: 0, y: 0 }, radius: def.radius },
    hp,
    maxHp: hp,
    facing: { x: 1, y: 0 },
    phase: spawning ? "spawning" : "idle",
    phaseTimer: spawning ? SPAWN_TIME : 0,
    strikeDir: { x: 1, y: 0 },
    attackCooldown: def.attackInterval * (0.5 + state.rng.next()),
    hitFlash: 0,
    knock: { x: 0, y: 0 },
    animTime: state.rng.next() * 2,
    lastHp: hp,
    ai: createAi(),
    status: createStatusBag(),
    poise: createPoiseState(),
  };
  initEnemyPoise(enemy, state.depth);
  // 土潜り・天井吊りは潜んだ状態で湧く（描かれず当たらない。影の予告の後に姿を見せる）
  if (def.behavior === "burrower" || def.behavior === "dropper") enemy.hidden = true;
  return enemy;
}

export function updateEnemies(state: GameState, dt: number): void {
  updateElites(state, dt);
  updateCorpses(state, dt);
  updateRallies(state, dt);
  updateTerrainSeeds(state, dt);
  chipBoneWallsByShots(state, dt);
  const player = state.player;
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    const def = enemyDef(e.defKey);
    // chill 中は移動も攻撃の進行も遅くなる
    const edt = dt * chillFactor(e);
    e.hitFlash = Math.max(0, e.hitFlash - dt);
    applyKnock(state, e, def, dt);
    // 行動停止（怯み・凍結・麻痺）中は AI も攻撃間隔も止まる。予備動作は怯みなら取り消し済み、麻痺・凍結なら一時停止
    if (isHalted(e)) continue;
    e.animTime += edt;
    e.attackCooldown = Math.max(0, e.attackCooldown - edt);
    if (isFeared(e) && e.phase !== "spawning") {
      flee(state, e, def, edt);
      continue;
    }

    if (isBossDriven(def)) {
      updateBossEnemy(state, e, def, edt);
      continue;
    }
    if (updateTimid(state, e, def, edt)) continue;
    if (updateGreedy(state, e, def, edt, enemySpeed(state, e, def))) continue;
    if (transformIfBroken(state, e, def)) continue;
    beforeAct(state, e, def, edt);

    const toPlayer = sub(player.body.pos, e.body.pos);
    const d = length(toPlayer);

    switch (e.phase) {
      case "spawning":
        e.phaseTimer -= edt;
        if (e.phaseTimer <= 0) e.phase = "chase";
        break;
      case "idle":
        // 開放型フロア: 壁越しには気付かない（気付いた敵が壁に張り付いたまま動けなくなるため）
        if ((d < NOTICE_RANGE && lineOfSight(state.map, e.body.pos, player.body.pos)) || state.rooms[e.roomIndex]?.locked) e.phase = "chase";
        break;
      case "chase":
        chase(state, e, def, toPlayer, d, edt);
        break;
      case "windup":
        windup(state, e, def, toPlayer, edt);
        break;
      case "strike":
        strike(state, e, def, edt);
        break;
      case "recover":
        recover(state, e, def, toPlayer, edt);
        break;
    }
    if (def.behavior === "wisp") touchWisp(state, e, def);
  }
  separate(state, dt);
  handleDeaths(state);
  state.enemies = state.enemies.filter((e) => e.hp > 0);
}

/** 状態機械の前に毎ステップ行う behavior 固有の下準備（取り巻きを呼ぶ・位置を記録する・蘇生の時計） */
function beforeAct(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  if (e.phase !== "chase" && e.phase !== "windup" && e.phase !== "strike" && e.phase !== "recover") return;
  if (def.pack) spawnPackOnce(state, e, def);
  if (def.behavior === "echoStriker") recordTrail(state, e, dt);
  if (def.behavior === "twinShade") tickTwinRevive(state, e, dt);
  if (def.sporeOnHit) tickSpores(state, e, def, dt);
  beforeActWave3(state, e, def, dt);
  if (forgeEnraged(e)) e.attackCooldown = Math.min(e.attackCooldown, def.attackInterval * ENEMY_AI.forgeMaster.enrageMul);
}

/** 死亡した敵の後処理（配列から消す直前に 1 回） */
function handleDeaths(state: GameState): void {
  for (const e of state.enemies) {
    if (e.hp > 0) continue;
    const def = enemyDef(e.defKey);
    onEliteDeath(state, e);
    if (def.behavior === "bomber" && !e.vanished) {
      // 持っていた爆弾がその場に落ち、予告の後に爆ぜる（即時の爆発は近接で倒すと避けられない。テレグラフ原則）
      const b = ENEMY_AI.bomber;
      spawnBomb(state, e.body.pos, b.damage + depthDamageBonus(state.depth), e.id, b.deathFuse, b.radius);
    }
    if (def.behavior === "wisp" && !e.vanished) {
      // 即時爆発だと近接で倒しても避けられないので、bomb と同じ仕組みでテレグラフしてから爆発させる
      const w = ENEMY_AI.wisp;
      spawnBomb(state, e.body.pos, w.deathExplodeDamage, e.id, w.deathExplodeFuse, w.deathExplodeRadius);
    }
    onEnemyDeath(state, e, def);
    // 双子の騎士は、先に倒れた方からボスの座が相方へ移る（boss.ts）ので id でも見る
    if (def.boss || state.boss?.enemyId === e.id) onBossDeath(state, e);
  }
}

function applyKnock(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  if (isBossDriven(def) || eliteKnockImmune(e) || STATIONARY.has(def.behavior) || length(e.knock) < 2) {
    e.knock = { x: 0, y: 0 };
    e.wallSplat = false;
    return;
  }
  const hit = moveEnemy(state, e, def, e.knock.x * dt, e.knock.y * dt);
  if (e.wallSplat && (hit.hitX || hit.hitY)) {
    wallSplat(state, e);
    return;
  }
  e.knock = scale(e.knock, Math.exp(-KNOCK_DECAY * dt));
}

/** 恐怖: プレイヤーから逃げ、攻撃しない（予備動作は付与時に取り消し済み） */
function flee(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  if (STATIONARY.has(def.behavior)) return;
  const away = normalize(sub(e.body.pos, state.player.body.pos));
  if (away.x !== 0) e.facing = scale(away, -1);
  const speed = enemySpeed(state, e, def);
  moveEnemy(state, e, def, away.x * speed * dt, away.y * speed * dt);
}

/** 壁叩きつけ: 強く吹き飛んだ敵が壁に激突すると追加ダメージ + 強靭を無視した怯み値 */
function wallSplat(state: GameState, e: Enemy): void {
  const w = ACTION.wallSplat;
  const back = scale(e.knock, -1);
  e.wallSplat = false;
  e.knock = { x: 0, y: 0 };
  spawnBurst(state, e.body.pos, w.color, w.particles, 120, 0.4, 2);
  shake(state, FEEL.shakeHeavy);
  pushSfx(state, "wallHit");
  const out = rollOutgoing(state, e, w.damage, "proc");
  const poise = w.poise * state.stats.poiseDamageMul;
  damageEnemy(state, e, out.amount, back, 0, { poise, ignoreSuperArmor: true, hitstopSteps: w.hitstop });
  // 叩きつけた先が骨の壁なら壁ごと崩す（docs/ideas/enemies.md H6）
  damageBoneWalls(state, e.body.pos, e.body.radius + TILE_SIZE / 2, BOSS.boneLord.wallHp);
}

/** 壁すり抜け（wisp）はマップ外にだけ出ないようにして直接動かす */
export function moveEnemy(state: GameState, e: Enemy, def: EnemyDef, dx: number, dy: number): { hitX: boolean; hitY: boolean } {
  if (!phasesNow(state, e, def)) return moveBody(state, e.body, dx, dy);
  const maxX = state.map.width * TILE_SIZE - e.body.radius;
  const maxY = state.map.height * TILE_SIZE - e.body.radius;
  e.body.pos.x = Math.max(e.body.radius, Math.min(maxX, e.body.pos.x + dx));
  e.body.pos.y = Math.max(e.body.radius, Math.min(maxY, e.body.pos.y + dy));
  return { hitX: false, hitY: false };
}

/**
 * 壁を抜けられるか。冷気・凍結の間は実体化して壁に阻まれる（docs/ideas/enemies.md H2: 状態異常ビルドの答え）。
 * ただし壁の中にいる間は抜け出せるよう、すり抜けを続ける（閉じ込めない）
 */
function phasesNow(state: GameState, e: Enemy, def: EnemyDef): boolean {
  if (!def.phasing) return false;
  const chilled = hasStatus(e.status, "chill") || hasStatus(e.status, "freeze");
  if (!chilled) return true;
  return overlapsWall(state, e.body.pos.x, e.body.pos.y, e.body.radius);
}

function toChase(e: Enemy, def: EnemyDef): void {
  e.phase = "chase";
  e.attackCooldown = def.attackInterval;
}

function enemySpeed(state: GameState, e: Enemy, def: EnemyDef): number {
  const base = def.speed * eliteSpeedMul(e) * frenzyMul(state, def) * terrainSpeedMul(state, e, def) * wave3SpeedMul(state, e, def);
  // 泥の中は歩きも突進も遅い（system/terrain.ts）
  return base * terrainMoveMul(state, e.body.pos);
}

/** Wave 3 の足の倍率: 虚ろは照準を向けられると止まる、潜った土潜りは速い */
function wave3SpeedMul(state: GameState, e: Enemy, def: EnemyDef): number {
  if (def.behavior === "hollow" && hollowFrozen(state, e)) return 0;
  if (def.behavior === "burrower" && e.hidden) return ENEMY_AI.burrower.burrowSpeedMul;
  return 1;
}

function chase(state: GameState, e: Enemy, def: EnemyDef, toPlayer: Vec, d: number, dt: number): void {
  const dir = normalize(toPlayer);
  if (dir.x !== 0) e.facing = dir;
  // 盾持ちは常にプレイヤーへ正面を向ける
  if (def.blocks) e.facing = dir;
  if (def.behavior === "scavenger" && tryStartEating(state, e)) return;

  const move = chaseMove(state, e, def, chaseHeading(state.map, e.body.pos, state.player.body.pos, dir), d);
  const speed = enemySpeed(state, e, def);
  moveEnemy(state, e, def, move.x * speed * dt, move.y * speed * dt);

  if (!wantsEngage(state, e, def, d) || e.attackCooldown > 0) return;
  if (!canBeginAttack(state, e, def, d)) return;
  beginWindup(state, e, def, dir);
}

/** 攻撃に入る距離か。地雷はプレイヤーだけでなく敵が踏んでも爆ぜる */
function wantsEngage(state: GameState, e: Enemy, def: EnemyDef, d: number): boolean {
  if (def.behavior === "mine") return mineTriggered(state, e);
  return d < def.engageRange;
}

/** behavior ごとの攻撃開始の条件（沈黙・霜砕きの冷え待ち・骨拾いの食事優先・Wave 3 の条件） */
function canBeginAttack(state: GameState, e: Enemy, def: EnemyDef, d: number): boolean {
  if (isSilenced(e) && SILENCED_BEHAVIORS.has(def.behavior)) return false;
  switch (def.behavior) {
    case "frostCrusher":
      return frostCrusherReady(state);
    case "scavenger":
      return scavengerHeading(state, e) === undefined;
    case "absorber":
      return absorberReady(e);
    case "mineLayer":
      return false;
    case "hollow":
      return !hollowFrozen(state, e);
    case "bannerBearer":
      return !bannerAlive(state, e) || d < BANNER_MELEE_RANGE;
    default:
      return true;
  }
}

function chaseMove(state: GameState, e: Enemy, def: EnemyDef, dir: Vec, d: number): Vec {
  const side = e.id % 2 === 0 ? 1 : -1;
  const perp = { x: -dir.y, y: dir.x };
  if (STATIONARY.has(def.behavior)) return { x: 0, y: 0 };
  const keep = KEEP_AWAY[def.behavior];
  if (keep !== undefined) return keepAwayMove(dir, perp, side, d, keep, e.animTime);
  switch (def.behavior) {
    case "shooter":
    case "laser": {
      // 距離を保ちつつ横にふらふら動く
      const tooClose = d < def.engageRange * 0.5;
      const tooFar = d > def.engageRange;
      const radial = tooClose ? scale(dir, -1) : tooFar ? dir : { x: 0, y: 0 };
      return add(radial, scale(perp, side * Math.sin(e.animTime * 1.5) * 0.8));
    }
    case "bomber": {
      const b = ENEMY_AI.bomber;
      const radial = d < b.keepAway ? scale(dir, -1) : d > def.engageRange ? dir : { x: 0, y: 0 };
      return add(radial, scale(perp, side * 0.5));
    }
    case "bat": {
      const bat = ENEMY_AI.bat;
      return add(dir, scale(perp, Math.sin(e.animTime * bat.zigzagFreq + e.id) * bat.zigzagAmount));
    }
    case "scavenger":
      return scavengerHeading(state, e) ?? dir;
    case "flameEater": {
      const fire = nearestFire(state, e);
      return fire ? normalize(sub(fire, e.body.pos), dir) : dir;
    }
    case "oiler":
      // 油壺運びはふらふら走り回って床に油を広げる
      return normalize(add(dir, scale(perp, Math.sin(e.animTime * 2 + e.id) * 1.2)));
    default:
      // 狼は遠いうちは横へ回り込み、近づいたら素直に飛びかかる
      if (def.flank && d > ENEMY_AI.flank.minDist) return normalize(add(dir, scale(perp, side * def.flank)));
      return dir;
  }
}

/** keep の距離を保ち、横へふらふら動く（詠唱・指揮する敵） */
function keepAwayMove(dir: Vec, perp: Vec, side: number, d: number, keep: number, animTime: number): Vec {
  const radial = d < keep * 0.8 ? scale(dir, -1) : d > keep * 1.3 ? dir : { x: 0, y: 0 };
  return add(radial, scale(perp, side * Math.sin(animTime * 1.2) * 0.6));
}

/** 1 撃目の予備動作。連続攻撃の残り回数を入れ直し、近くの敵の攻撃開始をずらす */
function beginWindup(state: GameState, e: Enemy, def: EnemyDef, dir: Vec): void {
  const follow = followUpOf(def.key, state.depth);
  if (e.ai && follow) e.ai.counter = follow.count;
  // 三叉光線眼は 1 本目（中央）から
  if (e.ai && def.laserBeams) e.ai.move = 0;
  if (def.behavior === "mimic") nextMimicMove(e);
  if (def.behavior === "basilisk") nextBasiliskMove(e);
  startWindup(state, e, def, dir, def.windup);
  coordinateNearby(state, e, def);
  // 号令の: 周りの敵の予備動作を自分に揃える（予告 1 つで全員の攻撃が読める）
  commandNearby(state, e, (o, od) => beginRalliedWindup(state, o, od, normalize(sub(state.player.body.pos, o.body.pos), o.strikeDir)));
}

/** 群れの長・楽団長が取り巻きを一斉に動かすときの入口（連携ずらしはしない。揃うのが号令の意味なので） */
function beginRalliedWindup(state: GameState, e: Enemy, def: EnemyDef, dir: Vec): void {
  const follow = followUpOf(def.key, state.depth);
  if (e.ai && follow) e.ai.counter = follow.count;
  startWindup(state, e, def, dir, def.windup);
}

/**
 * 連携ずらし: 近くで攻撃しかけている敵の予備動作を遅らせる。
 * 同時に振りかぶらせないことで、ダッシュ 1 回で全部を避けられないようにする（予備動作は個別に見える）
 */
function coordinateNearby(state: GameState, e: Enemy, def: EnemyDef): void {
  const t = ENEMY_TEMPO;
  for (const o of state.enemies) {
    if (o === e || o.hp <= 0 || o.phase !== "chase") continue;
    if (o.attackCooldown > t.coordCooldownMax) continue;
    if (dist(o.body.pos, e.body.pos) > t.coordRadius) continue;
    const other = enemyDef(o.defKey);
    if (other.boss) continue;
    const delay = def.behavior === "bat" && other.behavior === "bat" ? t.batCoordDelay : t.coordDelay;
    o.attackCooldown = Math.max(o.attackCooldown, delay);
  }
}

/** dir を deg 度回す */
function rotate(dir: Vec, deg: number): Vec {
  const a = Math.atan2(dir.y, dir.x) + deg * DEG_TO_RAD;
  return fromAngle(a);
}

/** 三叉光線眼の n 本目の角度（中央 → 左 → 右） */
function beamOffsetDeg(def: EnemyDef, index: number): number {
  const b = def.laserBeams;
  if (!b || index <= 0) return 0;
  return index % 2 === 1 ? -b.spreadDeg : b.spreadDeg;
}

/** 予備動作に入る（1 撃目・2 撃目以降の共通）。base は深度前の基準秒 */
function startWindup(state: GameState, e: Enemy, def: EnemyDef, dir: Vec, base: number): void {
  e.phase = "windup";
  e.phaseTimer = scaledWindup(base, state.depth, eliteWindupMul(e)) * boonWindupMul(state, e);
  e.strikeDir = dir;
  telegraphWindup(state, e, def, dir);
  pushSfx(state, "enemyWindup");
  pushEvent(state, { kind: "onEnemyWindup", actor: "enemy", source: { kind: "enemy", key: e.defKey }, ...enemyTarget(e) });
  if (def.behavior === "laser" || (def.behavior === "mimic" && isMimicTongue(e))) pushSfx(state, "laserCharge");
}

/** 予備動作の始まりに、狙いと予告（影・線）を置く */
function telegraphWindup(state: GameState, e: Enemy, def: EnemyDef, dir: Vec): void {
  const ai = e.ai;
  switch (def.behavior) {
    case "laser":
      if (!ai) return;
      // 狙いはチャージ開始時のプレイヤー位置で固定（動けば避けられる）
      e.strikeDir = rotate(dir, beamOffsetDeg(def, ai.move));
      ai.target = laserEnd(state, e.body.pos, e.strikeDir, ENEMY_AI.laser.length);
      return;
    case "mimic":
      if (ai && isMimicTongue(e)) ai.target = laserEnd(state, e.body.pos, dir, ENEMY_AI.mimic.tongueLength);
      return;
    case "kamikaze":
      telegraphKamikaze(state, e, def);
      return;
    case "echoStriker":
      telegraphEcho(state, e);
      return;
    case "silencer":
      telegraphSilence(state, e);
      return;
    case "charger":
      if (def.doubleCharge) planDoubleCharge(state, e, dir);
      return;
    default:
      telegraphWave3(state, e, def, dir);
      return;
  }
}

/** Wave 3 の予告（影・線・扇）。予告の形は enemyTelegraph が描画側へ伝える */
function telegraphWave3(state: GameState, e: Enemy, def: EnemyDef, dir: Vec): void {
  switch (def.behavior) {
    case "lobber":
      telegraphLob(state, e, def);
      return;
    case "burrower":
      telegraphBurrow(state, e);
      return;
    case "dropper":
      telegraphDrop(state, e);
      return;
    case "shadowStalker":
      telegraphStalk(state, e);
      return;
    case "homunculus":
      telegraphHomunculus(state, e);
      return;
    case "scribeImp":
      telegraphScribe(state, e);
      return;
    case "crossGolem":
      telegraphCross(state, e);
      return;
    case "mine":
      telegraphMine(state, e);
      return;
    case "bannerBearer":
      telegraphBanner(state, e);
      return;
    case "chainWarden":
      telegraphHook(state, e, dir, ENEMY_AI.chainWarden.length);
      return;
    case "giantToad":
      telegraphToad(state, e, dir);
      return;
    default:
      return;
  }
}

function windup(state: GameState, e: Enemy, def: EnemyDef, toPlayer: Vec, dt: number): void {
  // 予備動作の途中で沈黙したら詠唱・チャージを取り消す（docs/ideas/enemies.md H4。付与の瞬間の取り消しは statusEffects.ts）
  if (isSilenced(e) && SILENCED_BEHAVIORS.has(def.behavior)) {
    toChase(e, def);
    return;
  }
  e.phaseTimer -= dt;
  const mul = WINDUP_MOVE_MUL[def.behavior];
  if (mul > 0) {
    const dir = normalize(toPlayer);
    const speed = enemySpeed(state, e, def) * mul;
    moveEnemy(state, e, def, dir.x * speed * dt, dir.y * speed * dt);
  }
  if (e.phaseTimer > 0) return;
  if (strikeSlotsFull(state, e)) {
    e.phaseTimer = ENEMY_AI.strikerHoldTime;
    return;
  }
  beginStrike(state, e, def, toPlayer);
}

/**
 * 同時攻撃の上限: すでに strike の敵が上限に達していれば待たせる。
 * 敵は配列順（id 順）に更新されるので、同じステップで予備動作が終わった敵は id の若い方が先に枠を取る（決定的）。
 * ボスは数えない: ボスは自前の AI（boss*.ts）で動いてこの上限を受けず、技の strike も長いので、数えると
 * ボスが技を出している間ずっと取り巻きが予備動作のまま固まる（ボスの予告は取り巻きと重なる前提で作ってある）
 */
function strikeSlotsFull(state: GameState, e: Enemy): boolean {
  let striking = 0;
  for (const o of state.enemies) {
    if (o !== e && o.hp > 0 && o.phase === "strike" && !isBossDriven(enemyDef(o.defKey))) striking++;
  }
  return striking >= ENEMY_AI.maxSimultaneousStrikers;
}

/** 狙いを予備動作の始まりで固定する（避けた側が勝つ）behavior */
function aimFixedAtWindup(e: Enemy, def: EnemyDef): boolean {
  switch (def.behavior) {
    case "laser":
    case "chainWarden":
    case "giantToad":
    case "windSprite":
    case "basilisk":
      return true;
    case "mimic":
      return isMimicTongue(e);
    case "charger":
      // 二度突きの猪は予告した折れ線をそのまま走る
      return def.doubleCharge === true;
    default:
      return false;
  }
}

function beginStrike(state: GameState, e: Enemy, def: EnemyDef, toPlayer: Vec): void {
  // 予備動作の終わりで狙いを更新する（完全追尾ではなく、避けた側が勝つ）。laser は固定
  if (!aimFixedAtWindup(e, def)) e.strikeDir = normalize(toPlayer, e.strikeDir);
  if (e.strikeDir.x !== 0) e.facing = e.strikeDir;
  e.phase = "strike";
  e.phaseTimer = def.strikeTime;
  const dmgBonus = depthDamageBonus(state.depth);

  switch (def.behavior) {
    case "shooter":
      fireVolley(state, e, def);
      spawnBurst(state, e.body.pos, ENEMY_BULLET_COLOR, 4, 50, 0.15, 1.5);
      return;
    case "bomber":
      throwBombs(state, e, def, dmgBonus);
      return;
    case "laser": {
      const l = ENEMY_AI.laser;
      const target = e.ai?.target ?? add(e.body.pos, scale(e.strikeDir, l.length));
      spawnLaser(state, e.body.pos, target, def.strikeTime, l.damage + dmgBonus, e.id);
      shake(state, FEEL.shakeLight);
      pushSfx(state, "enemyShoot");
      pushSfx(state, "laserFire");
      return;
    }
    case "turret":
      strikeTurret(state, e);
      return;
    case "golem": {
      const g = ENEMY_AI.golem;
      spawnShockwave(state, e.body.pos, g.ringRadius, g.damage + dmgBonus, e.id);
      spawnBurst(state, e.body.pos, g.color, 16, 120, 0.4, 2.5);
      shake(state, FEEL.shakeHeavy);
      pushSfx(state, "wallHit");
      return;
    }
    default:
      if (beginStrikeWave2(state, e, def)) return;
      if (beginStrikeWave3(state, e, def)) return;
      spawnBurst(state, e.body.pos, def.color, 6, 60, 0.2, 1.5);
  }
}

/** Wave 3 の behavior の攻撃の出だし。処理したら true（隙へ直接移るものは中で phase を変える） */
function beginStrikeWave3(state: GameState, e: Enemy, def: EnemyDef): boolean {
  switch (def.behavior) {
    case "lobber":
      strikeLob(state, e, def);
      return true;
    case "bellImp":
      strikeBell(state, e);
      return true;
    case "bannerBearer":
      return strikeBanner(state, e) && toRecover(e, def);
    case "burrower":
      strikeBurrow(state, e);
      return true;
    case "dropper":
      return strikeDrop(state, e, def);
    case "shadowStalker":
      strikeStalk(state, e);
      return true;
    case "absorber":
      strikeAbsorber(state, e);
      return true;
    case "homunculus":
      strikeHomunculus(state, e);
      return true;
    case "scribeImp":
      return strikeScribe(state, e);
    case "crossGolem":
      strikeCross(state, e, def);
      return true;
    case "mine":
      strikeMine(state, e);
      return true;
    case "chainWarden":
      strikeWarden(state, e);
      return true;
    case "giantToad":
      strikeToad(state, e);
      return true;
    case "forgeMaster":
      strikeForge(state, e);
      return true;
    case "turretMaster":
      strikeTurretMaster(state, e);
      return true;
    case "windSprite":
      pushSfx(state, "windGust");
      return true;
    case "basilisk":
      // 睨みは strikeTime の間ずっと続く。噛みつきは短い突進
      if (e.ai?.move === BASILISK_GAZE) return true;
      e.phaseTimer = ENEMY_AI.basilisk.biteTime;
      return false;
    default:
      return false;
  }
}

/** 攻撃の出だしで隙へ移す（旗を立てた） */
function toRecover(e: Enemy, def: EnemyDef): boolean {
  e.phase = "recover";
  e.phaseTimer = def.recover;
  return true;
}

/** 追加した behavior の攻撃の出だし。処理したら true */
function beginStrikeWave2(state: GameState, e: Enemy, def: EnemyDef): boolean {
  switch (def.behavior) {
    case "kamikaze":
      detonate(state, e, def);
      return true;
    case "echoStriker":
      strikeEcho(state, e, def);
      return true;
    case "silencer":
      strikeSilence(state, e);
      return true;
    case "frostCrusher": {
      const f = ENEMY_AI.frostCrusher;
      strikeShockRing(state, e, f.ringRadius, f.damage, f.color);
      pushSfx(state, "wallHit");
      return true;
    }
    case "hollowArmor": {
      const h = ENEMY_AI.hollowArmor;
      strikeShockRing(state, e, h.ringRadius, h.damage, h.color);
      pushSfx(state, "wallHit");
      return true;
    }
    case "graveBell":
      ringBell(state, e);
      return true;
    case "conductor":
      conductorVolley(state, e);
      rallyFollowers(state, e, beginRalliedWindup);
      return true;
    case "packLeader":
      // 遠吠え: 群れが一斉に飛びかかる。長自身も突っ込む
      rallyFollowers(state, e, beginRalliedWindup);
      pushSfx(state, "enemyWindup");
      return false;
    case "mimic":
      if (!isMimicTongue(e)) return false;
      spawnLaser(state, e.body.pos, e.ai?.target ?? e.body.pos, def.strikeTime, ENEMY_AI.mimic.tongueDamage, e.id);
      pushSfx(state, "laserFire");
      return true;
    default:
      return false;
  }
}

/** 射撃: 1 発か、volley の扇（双眼・氷眼・投網兵） */
function fireVolley(state: GameState, e: Enemy, def: EnemyDef): void {
  if (!def.volley) {
    fireAtPlayer(state, e);
    return;
  }
  const v = def.volley;
  const speed = ENEMY_BULLET_SPEED * (v.speedMul ?? 1);
  const damage = Math.round((ENEMY_BULLET_DAMAGE + depthDamageBonus(state.depth)) * (v.damageMul ?? 1));
  for (const dir of fanDirections(e.strikeDir, v.count, v.spreadDeg)) {
    const pos = add(e.body.pos, scale(dir, e.body.radius + 2));
    fireEnemyBullet(state, { pos, dir, speed, damage, color: def.color, radius: v.radius, sourceId: e.id });
  }
  pushSfx(state, "enemyShoot");
}

/** 爆弾を投げる。volley があれば扇に並べて複数（連投ゴブリン） */
function throwBombs(state: GameState, e: Enemy, def: EnemyDef, dmgBonus: number): void {
  const b = ENEMY_AI.bomber;
  const v = def.volley;
  const dirs = v ? fanDirections(e.strikeDir, v.count, v.spreadDeg) : [e.strikeDir];
  const damage = Math.round((b.damage + dmgBonus) * (v?.damageMul ?? 1));
  for (const dir of dirs) {
    const target = add(e.body.pos, scale(dir, b.throwDist));
    const pos = overlapsWall(state, target.x, target.y, 2) ? { ...e.body.pos } : target;
    spawnBomb(state, pos, damage, e.id);
    // 煤ゴブリン: 爆発の跡に地形（爆弾の円がそのまま予告になる）
    if (def.bombTerrain) seedTerrain(state, pos, def.bombTerrain.kind, def.bombTerrain.radius, { delay: b.fuse, quiet: true });
  }
  spawnBurst(state, e.body.pos, b.color, 4, 40, 0.15, 1.5);
}

function strike(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  e.phaseTimer -= dt;
  if (def.behavior === "windSprite") blowWind(state, e, dt);
  if (def.behavior === "basilisk") tickGaze(state, e, dt);
  // 氷猪: 突進の跡が氷床になる（突進の予告線がそのまま予告）
  if (def.chargeTrail === "ice") placeTerrain(state, e.body.pos.x, e.body.pos.y, "ice", ENEMY_AI.iceTrail.radius);
  const speed = enemySpeed(state, e, def) * strikeSpeedMul(e, def);
  if (speed > 0) {
    const hit = moveEnemy(state, e, def, e.strikeDir.x * speed * dt, e.strikeDir.y * speed * dt);
    if (hit.hitX || hit.hitY) {
      if (def.behavior === "charger") {
        leaveChargeTrail(state, e, def, true);
        // 氷猪は壁に激突しても怯まずに滑って止まる（隙は通常の隙だけ）
        if (def.chargeTrail === "ice") {
          endStrike(state, e, def, true);
          return;
        }
        if (tryFollowUp(state, e, def, true)) {
          shake(state, FEEL.shakeLight);
          pushSfx(state, "wallHit");
          return;
        }
        // 壁に激突して隙を晒す（自傷の怯み: 拘束上限を数えず、解除後に堅守も付かない）
        applyStagger(state, e, POISE.chargerWallStagger, { selfInflicted: true });
        shake(state, FEEL.shakeHeavy);
        spawnBurst(state, e.body.pos, "#c0c0c0", 12, 120, 0.4, 2);
        pushSfx(state, "wallHit");
        return;
      }
      endStrike(state, e, def, true);
      return;
    }
    if (def.doubleCharge && steerDoubleCharge(state, e)) {
      endStrike(state, e, def);
      return;
    }
    const damage = contactDamageOf(e, def);
    if (damage > 0) {
      const result = touchPlayer(state, e, damage);
      if (result !== null) {
        if (result === "hit" && def.behavior === "manaLeech") stealMana(state, e);
        endStrike(state, e, def);
        return;
      }
    }
  }
  if (e.phaseTimer <= 0) endStrike(state, e, def);
}

/** strike 中の移動倍率。喰らう宝箱は舌のときはその場、写本の小悪魔は突進を写したときだけ、蜥蜴は噛みつきだけ動く */
function strikeSpeedMul(e: Enemy, def: EnemyDef): number {
  if (def.behavior === "mimic" && isMimicTongue(e)) return 0;
  if (def.behavior === "scribeImp" && e.ai?.move === SCRIBE_DASH) return ENEMY_AI.mimic.biteSpeedMul;
  if (def.behavior === "basilisk" && e.ai?.move === BASILISK_BITE) return ENEMY_AI.mimic.biteSpeedMul;
  return STRIKE_SPEED_MUL[def.behavior];
}

/** 接触していればダメージ（当たれば ENEMY_COMBAT の接触の状態異常も付く）。接触していなければ null */
function touchPlayer(state: GameState, e: Enemy, damage: number): PlayerHitResult | null {
  // 霊体化（skills/forms.ts）は敵の体と近接をすり抜ける
  if (state.skills.shape?.key === "wraithForm") return null;
  const p = state.player.body;
  if (!circlesOverlap(e.body.pos.x, e.body.pos.y, e.body.radius, p.pos.x, p.pos.y, p.radius)) return null;
  const result = damagePlayer(state, damage + depthDamageBonus(state.depth), e.body.pos, e);
  if (result === "hit") {
    inflictOnPlayer(state, e, "contact");
    onRallyContact(state, e);
  }
  return result === "ignored" ? null : result;
}

/** wisp は strike 以外でも触れると燃やす（燃焼は ENEMY_COMBAT の接触の付与） */
function touchWisp(state: GameState, e: Enemy, def: EnemyDef): void {
  if (e.phase === "spawning" || e.phase === "idle" || e.phase === "strike") return;
  touchPlayer(state, e, def.contactDamage);
}

function recover(state: GameState, e: Enemy, def: EnemyDef, toPlayer: Vec, dt: number): void {
  e.phaseTimer -= dt;
  if (def.behavior === "bat") {
    // 一撃離脱: 噛んだら離れる
    const away = scale(normalize(toPlayer), -1);
    const speed = enemySpeed(state, e, def) * ENEMY_AI.bat.retreatMul;
    moveEnemy(state, e, def, away.x * speed * dt, away.y * speed * dt);
  }
  if (e.phaseTimer > 0) return;
  if (def.behavior === "scavenger") finishEating(state, e, def);
  onRecoverEndWave3(e, def);
  toChase(e, def);
}

/** 攻撃の終わり。連続攻撃・残響・次の光線が残っていれば次の予備動作へ、無ければ隙（recover） */
function endStrike(state: GameState, e: Enemy, def: EnemyDef, byWall = false): void {
  if (def.behavior === "charger" && !byWall) leaveChargeTrail(state, e, def, false);
  // 鎖の番人・大蝦蟇: 引き寄せが当たったら続けて叩きつけ（2 段の読み）
  const hook = hookFollowUp(e, def);
  if (hook !== null) {
    startWindup(state, e, def, normalize(sub(state.player.body.pos, e.body.pos), e.strikeDir), hook);
    return;
  }
  if (tryFollowUp(state, e, def, byWall)) return;
  if (tryNextBeam(state, e, def)) return;
  if (e.hp > 0 && takeEliteEcho(e)) {
    startWindup(state, e, def, e.strikeDir, ELITE.echoWindup);
    return;
  }
  e.phase = "recover";
  e.phaseTimer = def.recover;
}

/** 三叉光線眼: 撃ち終えたら次の 1 本へ（中央 → 左 → 右） */
function tryNextBeam(state: GameState, e: Enemy, def: EnemyDef): boolean {
  const b = def.laserBeams;
  const ai = e.ai;
  if (!b || !ai || ai.move >= b.count - 1) return false;
  ai.move += 1;
  const dir = normalize(sub(state.player.body.pos, e.body.pos), e.strikeDir);
  startWindup(state, e, def, dir, b.followWindup);
  return true;
}

/** 突進の終わりに残すもの。骨の壁は止まった場所に、落石は壁に激突したときだけ */
function leaveChargeTrail(state: GameState, e: Enemy, def: EnemyDef, byWall: boolean): void {
  if (def.chargeTrail === "boneWall") raiseTrailWall(state, e);
  if (def.chargeTrail === "rockfall" && byWall) dropRocks(state, e);
}

/** 骨猪: 突進の終点の 1 マス後ろに、進行方向と直交する骨の壁を 3 マス */
function raiseTrailWall(state: GameState, e: Enemy): void {
  const back = add(e.body.pos, scale(e.strikeDir, -TILE_SIZE));
  const perp = { x: -e.strikeDir.y, y: e.strikeDir.x };
  for (let i = -1; i <= 1; i++) {
    const q = add(back, scale(perp, i * TILE_SIZE));
    const tx = Math.floor(q.x / TILE_SIZE);
    const ty = Math.floor(q.y / TILE_SIZE);
    if (overlapsWall(state, (tx + 0.5) * TILE_SIZE, (ty + 0.5) * TILE_SIZE, 1)) continue;
    spawnBoneWall(state, tx, ty);
  }
}

/** 角甲虫: 壁に激突すると天井から石が落ちる（予告の影付き。落下は爆弾と同じ扱い） */
function dropRocks(state: GameState, e: Enemy): void {
  const r = ENEMY_AI.rockfall;
  const center = state.player.body.pos;
  for (let i = 0; i < r.count; i++) {
    const a = state.rng.next() * Math.PI * 2;
    const q = add(center, scale(fromAngle(a), state.rng.next() * r.spread));
    if (overlapsWall(state, q.x, q.y, 2)) continue;
    spawnBomb(state, q, r.damage + depthDamageBonus(state.depth), e.id, r.fuse, r.radius);
  }
}

/**
 * 連続攻撃の次の撃へ。2 撃目以降も予備動作を挟む（ダッシュ CD を跨がせつつ、読めば避けられる）。
 * 壁で止まったときは来た方向へ向き直す（狙いは予備動作の終わりにプレイヤーへ更新される）
 */
function tryFollowUp(state: GameState, e: Enemy, def: EnemyDef, byWall: boolean): boolean {
  const f = followUpOf(def.key, state.depth);
  const ai = e.ai;
  if (!f || !ai || ai.counter <= 0) return false;
  if (f.onWallOnly && !byWall) {
    ai.counter = 0;
    return false;
  }
  ai.counter -= 1;
  const dir = byWall ? scale(e.strikeDir, -1) : e.strikeDir;
  startWindup(state, e, def, dir, f.windup);
  return true;
}

function fireAtPlayer(state: GameState, e: Enemy): void {
  const dir = e.strikeDir;
  fireEnemyBullet(state, {
    pos: add(e.body.pos, scale(dir, e.body.radius + 2)),
    dir,
    speed: ENEMY_BULLET_SPEED,
    damage: ENEMY_BULLET_DAMAGE + depthDamageBonus(state.depth),
    color: ENEMY_BULLET_COLOR,
    sourceId: e.id,
  });
  pushSfx(state, "enemyShoot");
}

/** 敵同士が重ならないよう軽く押し合う */
function separate(state: GameState, dt: number): void {
  const list = state.enemies;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a || a.hp <= 0) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (!b || b.hp <= 0) continue;
      const d = dist(a.body.pos, b.body.pos);
      const minD = a.body.radius + b.body.radius;
      if (d >= minD || d === 0) continue;
      const push = scale(normalize(sub(a.body.pos, b.body.pos)), SEPARATION_FORCE * dt);
      pushApart(state, a, push);
      pushApart(state, b, scale(push, -1));
    }
  }
}

/** 動かない敵（鐘・氷柱）は押されない */
function pushApart(state: GameState, e: Enemy, push: Vec): void {
  const def = enemyDef(e.defKey);
  if (STATIONARY.has(def.behavior)) return;
  moveEnemy(state, e, def, push.x, push.y);
}

// -----------------------------------------------------------------------------
// 描画向けの読み出し（render は state を読むだけ）
// -----------------------------------------------------------------------------

/** 予備動作中に描く予告の種類 */
export type EnemyTelegraph =
  | { kind: "line" }
  | { kind: "laser" }
  | { kind: "ring"; radius: number }
  /** 十字の線（ai.points の各点へ。十字ゴーレム） */
  | { kind: "cross" }
  /** 扇（strikeDir を中心に range・半角 halfDeg。風吹き・石化の蜥蜴） */
  | { kind: "cone"; range: number; halfDeg: number }
  | null;

/** その敵の予備動作の予告。影（landing）で見せるものは hazards 側が描くので null */
export function enemyTelegraph(e: Enemy, def: EnemyDef): EnemyTelegraph {
  switch (def.behavior) {
    case "charger":
      // 二度突きの猪の折れ線は render/chargeLineUi.ts が e.doubleCharge を読んで描く
      return def.doubleCharge ? null : { kind: "line" };
    case "laser":
      return { kind: "laser" };
    case "mimic":
      return isMimicTongue(e) ? { kind: "laser" } : { kind: "line" };
    case "golem":
      return { kind: "ring", radius: ENEMY_AI.golem.ringRadius };
    case "frostCrusher":
      return { kind: "ring", radius: ENEMY_AI.frostCrusher.ringRadius };
    case "hollowArmor":
      return { kind: "ring", radius: ENEMY_AI.hollowArmor.ringRadius };
    case "twinBlade":
    case "twinBow":
      return twinTelegraphIsLine(e) ? { kind: "line" } : null;
    case "frostGiant":
      return e.ai?.move === GIANT_MOVE_SLAM ? { kind: "ring", radius: BOSS.frostGiant.slamRadius } : null;
    default:
      return enemyTelegraphWave3(e, def) ?? bossTelegraph(e, def);
  }
}

/** Wave 3 の予告の形。影（landing）で見せるものは null */
function enemyTelegraphWave3(e: Enemy, def: EnemyDef): EnemyTelegraph {
  const move = e.ai?.move;
  switch (def.behavior) {
    case "crossGolem":
      return { kind: "cross" };
    case "windSprite":
      return { kind: "cone", range: ENEMY_AI.windSprite.range, halfDeg: ENEMY_AI.windSprite.arcDeg / 2 };
    case "basilisk":
      return move === BASILISK_GAZE ? { kind: "cone", range: ENEMY_AI.basilisk.range, halfDeg: ENEMY_AI.basilisk.arcDeg / 2 } : { kind: "line" };
    case "chainWarden":
      return move === HOOK_SLAM ? { kind: "ring", radius: ENEMY_AI.chainWarden.slamRadius } : { kind: "laser" };
    case "giantToad":
      if (move === HOOK_SLAM) return { kind: "ring", radius: ENEMY_AI.giantToad.biteRadius };
      return move === HOOK_LOB ? null : { kind: "laser" };
    case "bellImp":
      return { kind: "ring", radius: ENEMY_AI.bellImp.radius };
    case "bannerBearer":
    case "hollow":
    case "absorber":
    case "turret":
    case "forgeMaster":
    case "turretMaster":
      return { kind: "line" };
    case "scribeImp":
      return move === SCRIBE_RING || move === SCRIBE_BLASTS ? null : { kind: "line" };
    default:
      return null;
  }
}

/** 攻撃中も見せ続ける範囲（風の扇・睨みの扇）。無ければ null */
export function enemyActiveArea(e: Enemy, def: EnemyDef): EnemyTelegraph {
  if (e.phase !== "strike") return null;
  if (def.behavior === "windSprite") return { kind: "cone", range: ENEMY_AI.windSprite.range, halfDeg: ENEMY_AI.windSprite.arcDeg / 2 };
  if (def.behavior === "basilisk" && e.ai?.move === BASILISK_GAZE) {
    return { kind: "cone", range: ENEMY_AI.basilisk.range, halfDeg: ENEMY_AI.basilisk.arcDeg / 2 };
  }
  return null;
}
