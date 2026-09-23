import { type Enemy, type EnemyAi, type GameState, allocId, pushSfx } from "../core/state";
import { type Vec, add, dist, length, normalize, scale, sub } from "../core/vec";
import { type EnemyBehavior, type EnemyDef, depthDamageBonus, depthHpScale, enemyDef } from "../data/enemies";
import { ACTION, ENEMY_AI, ENEMY_TEMPO, FEEL, POISE } from "../data/tuning";
import { type PlayerHitResult, damageEnemy, damagePlayer, rollOutgoing } from "./combat";
import { shake, spawnBurst } from "./effects";
import { eliteSpeedMul, eliteWindupMul, onEliteDeath, updateElites } from "./elites";
import { explodeHostile, laserEnd, spawnBomb, spawnLaser, spawnShockwave } from "./hazards";
import { circlesOverlap, moveBody, overlapsWall } from "./physics";
import { chillFactor, createPoiseState, inflictOnPlayer, isFeared, isHalted, isSilenced } from "./statusEffects";
import { applyStagger, initEnemyPoise } from "./poise";
import { createStatusBag } from "../core/status";
import { onBossDeath, updateBossEnemy } from "./boss";
import { TILE_SIZE } from "../map/grid";

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
};
const SEPARATION_FORCE = 40;
const ENEMY_BULLET_SPEED = 135;
const ENEMY_BULLET_DAMAGE = 8;
const ENEMY_BULLET_COLOR = "#e070ff";
const ENEMY_BULLET_LIFE = 3;
const SPAWN_TIME = 0.7;
/** 沈黙中は予備動作に入れない（射撃・レーザー・爆弾） */
const SILENCED_BEHAVIORS: ReadonlySet<EnemyBehavior> = new Set<EnemyBehavior>(["shooter", "laser", "bomber"]);

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
  return { target: { x: 0, y: 0 }, timer: 0, counter: 0, stage: 1, move: 0 };
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
  return enemy;
}

export function updateEnemies(state: GameState, dt: number): void {
  updateElites(state);
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

    if (def.boss) {
      updateBossEnemy(state, e, def, edt);
      continue;
    }

    const toPlayer = sub(player.body.pos, e.body.pos);
    const d = length(toPlayer);

    switch (e.phase) {
      case "spawning":
        e.phaseTimer -= edt;
        if (e.phaseTimer <= 0) e.phase = "chase";
        break;
      case "idle":
        if (d < NOTICE_RANGE || state.rooms[e.roomIndex]?.locked) e.phase = "chase";
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

/** 死亡した敵の後処理（配列から消す直前に 1 回） */
function handleDeaths(state: GameState): void {
  for (const e of state.enemies) {
    if (e.hp > 0) continue;
    const def = enemyDef(e.defKey);
    onEliteDeath(state, e);
    if (def.behavior === "bomber") {
      // 持っていた爆弾がその場で爆発する
      const b = ENEMY_AI.bomber;
      explodeHostile(state, e.body.pos, b.radius, b.damage + depthDamageBonus(state.depth), b.color);
    }
    if (def.behavior === "wisp") {
      // 即時爆発だと近接で倒しても避けられないので、bomb と同じ仕組みでテレグラフしてから爆発させる
      const w = ENEMY_AI.wisp;
      spawnBomb(state, e.body.pos, w.deathExplodeDamage, e.id, w.deathExplodeFuse, w.deathExplodeRadius);
    }
    if (def.boss) onBossDeath(state, e);
  }
}

function applyKnock(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  if (def.boss || length(e.knock) < 2) {
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
  const away = normalize(sub(e.body.pos, state.player.body.pos));
  if (away.x !== 0) e.facing = scale(away, -1);
  const speed = enemySpeed(e, def);
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
}

/** 壁すり抜け（wisp）はマップ外にだけ出ないようにして直接動かす */
export function moveEnemy(state: GameState, e: Enemy, def: EnemyDef, dx: number, dy: number): { hitX: boolean; hitY: boolean } {
  if (!def.phasing) return moveBody(state, e.body, dx, dy);
  const maxX = state.map.width * TILE_SIZE - e.body.radius;
  const maxY = state.map.height * TILE_SIZE - e.body.radius;
  e.body.pos.x = Math.max(e.body.radius, Math.min(maxX, e.body.pos.x + dx));
  e.body.pos.y = Math.max(e.body.radius, Math.min(maxY, e.body.pos.y + dy));
  return { hitX: false, hitY: false };
}

function toChase(e: Enemy, def: EnemyDef): void {
  e.phase = "chase";
  e.attackCooldown = def.attackInterval;
}

function enemySpeed(e: Enemy, def: EnemyDef): number {
  return def.speed * eliteSpeedMul(e);
}

function chase(state: GameState, e: Enemy, def: EnemyDef, toPlayer: Vec, d: number, dt: number): void {
  const dir = normalize(toPlayer);
  if (dir.x !== 0) e.facing = dir;
  // 盾持ちは常にプレイヤーへ正面を向ける
  if (def.behavior === "knight") e.facing = dir;

  const move = chaseMove(e, def, dir, d);
  const speed = enemySpeed(e, def);
  moveEnemy(state, e, def, move.x * speed * dt, move.y * speed * dt);

  if (d >= def.engageRange || e.attackCooldown > 0) return;
  if (isSilenced(e) && SILENCED_BEHAVIORS.has(def.behavior)) return;
  beginWindup(state, e, def, dir);
}

function chaseMove(e: Enemy, def: EnemyDef, dir: Vec, d: number): Vec {
  const side = e.id % 2 === 0 ? 1 : -1;
  const perp = { x: -dir.y, y: dir.x };
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
    default:
      return dir;
  }
}

/** 1 撃目の予備動作。連続攻撃の残り回数を入れ直し、近くの敵の攻撃開始をずらす */
function beginWindup(state: GameState, e: Enemy, def: EnemyDef, dir: Vec): void {
  if (e.ai) e.ai.counter = followUpOf(def.key, state.depth)?.count ?? 0;
  startWindup(state, e, def, dir, def.windup);
  coordinateNearby(state, e, def);
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

/** 予備動作に入る（1 撃目・2 撃目以降の共通）。base は深度前の基準秒 */
function startWindup(state: GameState, e: Enemy, def: EnemyDef, dir: Vec, base: number): void {
  e.phase = "windup";
  e.phaseTimer = scaledWindup(base, state.depth, eliteWindupMul(e));
  e.strikeDir = dir;
  if (def.behavior === "laser" && e.ai) {
    // 狙いはチャージ開始時のプレイヤー位置で固定（動けば避けられる）
    e.ai.target = laserEnd(state, e.body.pos, dir, ENEMY_AI.laser.length);
  }
  pushSfx(state, "enemyWindup");
  if (def.behavior === "laser") pushSfx(state, "laserCharge");
}

function windup(state: GameState, e: Enemy, def: EnemyDef, toPlayer: Vec, dt: number): void {
  e.phaseTimer -= dt;
  const mul = WINDUP_MOVE_MUL[def.behavior];
  if (mul > 0) {
    const dir = normalize(toPlayer);
    const speed = enemySpeed(e, def) * mul;
    moveEnemy(state, e, def, dir.x * speed * dt, dir.y * speed * dt);
  }
  if (e.phaseTimer <= 0) beginStrike(state, e, def, toPlayer);
}

function beginStrike(state: GameState, e: Enemy, def: EnemyDef, toPlayer: Vec): void {
  // 予備動作の終わりで狙いを更新する（完全追尾ではなく、避けた側が勝つ）。laser は固定
  if (def.behavior !== "laser") e.strikeDir = normalize(toPlayer, e.strikeDir);
  if (e.strikeDir.x !== 0) e.facing = e.strikeDir;
  e.phase = "strike";
  e.phaseTimer = def.strikeTime;
  const dmgBonus = depthDamageBonus(state.depth);

  switch (def.behavior) {
    case "shooter":
      fireAtPlayer(state, e);
      spawnBurst(state, e.body.pos, ENEMY_BULLET_COLOR, 4, 50, 0.15, 1.5);
      return;
    case "bomber":
      throwBomb(state, e, dmgBonus);
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
    case "golem": {
      const g = ENEMY_AI.golem;
      spawnShockwave(state, e.body.pos, g.ringRadius, g.damage + dmgBonus, e.id);
      spawnBurst(state, e.body.pos, g.color, 16, 120, 0.4, 2.5);
      shake(state, FEEL.shakeHeavy);
      pushSfx(state, "wallHit");
      return;
    }
    default:
      spawnBurst(state, e.body.pos, def.color, 6, 60, 0.2, 1.5);
  }
}

function throwBomb(state: GameState, e: Enemy, dmgBonus: number): void {
  const b = ENEMY_AI.bomber;
  const target = add(e.body.pos, scale(e.strikeDir, b.throwDist));
  const pos = overlapsWall(state, target.x, target.y, 2) ? { ...e.body.pos } : target;
  spawnBomb(state, pos, b.damage + dmgBonus, e.id);
  spawnBurst(state, e.body.pos, b.color, 4, 40, 0.15, 1.5);
}

function strike(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  e.phaseTimer -= dt;
  const speed = enemySpeed(e, def) * STRIKE_SPEED_MUL[def.behavior];
  if (speed > 0) {
    const hit = moveEnemy(state, e, def, e.strikeDir.x * speed * dt, e.strikeDir.y * speed * dt);
    if (hit.hitX || hit.hitY) {
      if (def.behavior === "charger") {
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
    if (def.contactDamage > 0 && touchPlayer(state, e, def.contactDamage) !== null) {
      endStrike(state, e, def);
      return;
    }
  }
  if (e.phaseTimer <= 0) endStrike(state, e, def);
}

/** 接触していればダメージ（当たれば ENEMY_COMBAT の接触の状態異常も付く）。接触していなければ null */
function touchPlayer(state: GameState, e: Enemy, damage: number): PlayerHitResult | null {
  const p = state.player.body;
  if (!circlesOverlap(e.body.pos.x, e.body.pos.y, e.body.radius, p.pos.x, p.pos.y, p.radius)) return null;
  const result = damagePlayer(state, damage + depthDamageBonus(state.depth), e.body.pos, e);
  if (result === "hit") inflictOnPlayer(state, e, "contact");
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
    const speed = enemySpeed(e, def) * ENEMY_AI.bat.retreatMul;
    moveEnemy(state, e, def, away.x * speed * dt, away.y * speed * dt);
  }
  if (e.phaseTimer <= 0) toChase(e, def);
}

/** 攻撃の終わり。連続攻撃が残っていれば次の予備動作へ、無ければ隙（recover） */
function endStrike(state: GameState, e: Enemy, def: EnemyDef, byWall = false): void {
  if (tryFollowUp(state, e, def, byWall)) return;
  e.phase = "recover";
  e.phaseTimer = def.recover;
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
  state.projectiles.push({
    id: allocId(state),
    owner: "enemy",
    pos: add(e.body.pos, scale(dir, e.body.radius + 2)),
    vel: scale(dir, ENEMY_BULLET_SPEED),
    radius: 3,
    damage: ENEMY_BULLET_DAMAGE + depthDamageBonus(state.depth),
    life: ENEMY_BULLET_LIFE,
    color: ENEMY_BULLET_COLOR,
    kind: "proc",
    hitIds: new Set(),
    pierceLeft: 0,
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
      moveEnemy(state, a, enemyDef(a.defKey), push.x, push.y);
      moveEnemy(state, b, enemyDef(b.defKey), -push.x, -push.y);
    }
  }
}
