import { type Enemy, type GameState, allocId } from "../core/state";
import { type Vec, add, dist, length, normalize, scale, sub } from "../core/vec";
import { type EnemyDef, depthDamageBonus, depthHpScale, enemyDef } from "../data/enemies";
import { FEEL } from "../data/tuning";
import { damagePlayer } from "./combat";
import { shake, spawnBurst } from "./effects";
import { circlesOverlap, moveBody } from "./physics";

const KNOCK_DECAY = 12;
/** 通路からでも気付く距離 */
const NOTICE_RANGE = 110;
const STRIKE_SPEED_MUL: Record<EnemyDef["behavior"], number> = {
  chaser: 4.6,
  shooter: 0,
  charger: 7.5,
};
const SEPARATION_FORCE = 40;
const ENEMY_BULLET_SPEED = 135;
const ENEMY_BULLET_DAMAGE = 8;
const ENEMY_BULLET_COLOR = "#e070ff";

export function createEnemy(state: GameState, def: EnemyDef, pos: Vec, roomIndex: number, spawning: boolean): Enemy {
  const hp = Math.round(def.hp * depthHpScale(state.depth));
  return {
    id: allocId(state),
    defKey: def.key,
    roomIndex,
    body: { pos: { ...pos }, vel: { x: 0, y: 0 }, radius: def.radius },
    hp,
    maxHp: hp,
    facing: { x: 1, y: 0 },
    phase: spawning ? "spawning" : "idle",
    phaseTimer: spawning ? 0.7 : 0,
    strikeDir: { x: 1, y: 0 },
    attackCooldown: def.attackInterval * (0.5 + state.rng.next()),
    hitFlash: 0,
    knock: { x: 0, y: 0 },
    animTime: state.rng.next() * 2,
  };
}

export function updateEnemies(state: GameState, dt: number): void {
  const player = state.player;
  for (const e of state.enemies) {
    if (e.hp <= 0) continue;
    const def = enemyDef(e.defKey);
    e.hitFlash = Math.max(0, e.hitFlash - dt);
    e.animTime += dt;
    e.attackCooldown = Math.max(0, e.attackCooldown - dt);

    applyKnock(state, e, dt);

    const toPlayer = sub(player.body.pos, e.body.pos);
    const d = length(toPlayer);

    switch (e.phase) {
      case "spawning":
        e.phaseTimer -= dt;
        if (e.phaseTimer <= 0) e.phase = "chase";
        break;
      case "idle":
        if (d < NOTICE_RANGE || state.rooms[e.roomIndex]?.locked) e.phase = "chase";
        break;
      case "chase":
        chase(state, e, def, toPlayer, d, dt);
        break;
      case "windup":
        e.phaseTimer -= dt;
        if (e.phaseTimer <= 0) beginStrike(state, e, def, toPlayer);
        break;
      case "strike":
        strike(state, e, def, dt);
        break;
      case "recover":
      case "stagger":
        e.phaseTimer -= dt;
        if (e.phaseTimer <= 0) {
          e.phase = "chase";
          e.attackCooldown = def.attackInterval;
        }
        break;
    }
  }
  separate(state, dt);
  state.enemies = state.enemies.filter((e) => e.hp > 0);
}

function applyKnock(state: GameState, e: Enemy, dt: number): void {
  if (length(e.knock) < 2) {
    e.knock = { x: 0, y: 0 };
    return;
  }
  moveBody(state, e.body, e.knock.x * dt, e.knock.y * dt);
  e.knock = scale(e.knock, Math.exp(-KNOCK_DECAY * dt));
}

function chase(state: GameState, e: Enemy, def: EnemyDef, toPlayer: Vec, d: number, dt: number): void {
  const dir = normalize(toPlayer);
  if (dir.x !== 0) e.facing = dir;

  let move: Vec;
  if (def.behavior === "shooter") {
    // 距離を保ちつつ横にふらふら動く
    const tooClose = d < def.engageRange * 0.5;
    const tooFar = d > def.engageRange;
    const radial = tooClose ? scale(dir, -1) : tooFar ? dir : { x: 0, y: 0 };
    const side = e.id % 2 === 0 ? 1 : -1;
    const strafe = scale({ x: -dir.y, y: dir.x }, side * Math.sin(e.animTime * 1.5) * 0.8);
    move = add(radial, strafe);
  } else {
    move = dir;
  }
  moveBody(state, e.body, move.x * def.speed * dt, move.y * def.speed * dt);

  if (d < def.engageRange && e.attackCooldown <= 0) {
    e.phase = "windup";
    e.phaseTimer = def.windup;
    e.strikeDir = dir;
  }
}

function beginStrike(state: GameState, e: Enemy, def: EnemyDef, toPlayer: Vec): void {
  // 予備動作の終わりで狙いを更新する（完全追尾ではなく、避けた側が勝つ）
  e.strikeDir = normalize(toPlayer, e.strikeDir);
  if (e.strikeDir.x !== 0) e.facing = e.strikeDir;
  e.phase = "strike";
  e.phaseTimer = def.strikeTime;

  if (def.behavior === "shooter") {
    fireAtPlayer(state, e);
    spawnBurst(state, e.body.pos, ENEMY_BULLET_COLOR, 4, 50, 0.15, 1.5);
  } else {
    spawnBurst(state, e.body.pos, def.color, 6, 60, 0.2, 1.5);
  }
}

function strike(state: GameState, e: Enemy, def: EnemyDef, dt: number): void {
  e.phaseTimer -= dt;
  const speed = def.speed * STRIKE_SPEED_MUL[def.behavior];
  if (speed > 0) {
    const hit = moveBody(state, e.body, e.strikeDir.x * speed * dt, e.strikeDir.y * speed * dt);
    if (hit.hitX || hit.hitY) {
      if (def.behavior === "charger") {
        // 壁に激突して隙を晒す
        e.phase = "stagger";
        e.phaseTimer = 0.9;
        shake(state, FEEL.shakeHeavy);
        spawnBurst(state, e.body.pos, "#c0c0c0", 12, 120, 0.4, 2);
        return;
      }
      endStrike(e, def);
      return;
    }
    if (def.contactDamage > 0) {
      const p = state.player.body;
      if (circlesOverlap(e.body.pos.x, e.body.pos.y, e.body.radius, p.pos.x, p.pos.y, p.radius)) {
        const result = damagePlayer(state, def.contactDamage + depthDamageBonus(state.depth), e.body.pos);
        if (result !== "ignored") {
          endStrike(e, def);
          return;
        }
      }
    }
  }
  if (e.phaseTimer <= 0) endStrike(e, def);
}

function endStrike(e: Enemy, def: EnemyDef): void {
  e.phase = "recover";
  e.phaseTimer = def.recover;
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
    life: 3,
    color: ENEMY_BULLET_COLOR,
  });
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
      moveBody(state, a.body, push.x, push.y);
      moveBody(state, b.body, -push.x, -push.y);
    }
  }
}
