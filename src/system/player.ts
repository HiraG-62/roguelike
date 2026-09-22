import type { FrameInput } from "../core/input";
import { type GameState, type Player, allocId } from "../core/state";
import { type Vec, add, isZero, normalize, scale, sub, length } from "../core/vec";
import { FEEL, PLAYER } from "../data/tuning";
import { cancelAttack, damageEnemy } from "./combat";
import { addFloatingText, hitstop, shake, spawnBurst } from "./effects";
import { type Box, boxCircleOverlap, circlesOverlap, moveBody } from "./physics";

const KNOCK_DECAY = 14;
const BULLET_COLOR = "#a0e0ff";

export function createPlayer(pos: Vec): Player {
  return {
    body: { pos: { ...pos }, vel: { x: 0, y: 0 }, radius: PLAYER.radius },
    hp: PLAYER.maxHp,
    maxHp: PLAYER.maxHp,
    facing: { x: 1, y: 0 },
    dashTimer: 0,
    dashCooldown: 0,
    dashDir: { x: 1, y: 0 },
    invulnTimer: 0,
    hitFlash: 0,
    knock: { x: 0, y: 0 },
    dodgedThisDash: false,
    attack: { combo: 0, phase: "none", timer: 0, buffered: false, hitIds: new Set(), dir: { x: 1, y: 0 } },
    shootCooldown: 0,
    energy: 0,
    maxEnergy: PLAYER.maxEnergy,
    walkTime: 0,
  };
}

export function isDashing(p: Player): boolean {
  return p.dashTimer > 0;
}

export function isAttacking(p: Player): boolean {
  return p.attack.phase !== "none";
}

export function updatePlayer(state: GameState, input: FrameInput, dt: number): void {
  const p = state.player;
  tickTimers(p, dt);

  if (input.dashPressed) tryDash(state, input);
  if (input.attackPressed) tryAttack(state);
  if (input.specialPressed) trySpecial(state);

  updateAttack(state, dt);
  updateMovement(state, input, dt);
  if (input.shootHeld) tryShoot(state);
}

function tickTimers(p: Player, dt: number): void {
  p.dashCooldown = Math.max(0, p.dashCooldown - dt);
  p.invulnTimer = Math.max(0, p.invulnTimer - dt);
  p.hitFlash = Math.max(0, p.hitFlash - dt);
  p.shootCooldown = Math.max(0, p.shootCooldown - dt);
  if (p.dashTimer > 0) {
    p.dashTimer = Math.max(0, p.dashTimer - dt);
    // ダッシュが終わった直後、猶予ぶんの無敵を残す
    if (p.dashTimer === 0) p.invulnTimer = Math.max(p.invulnTimer, PLAYER.dash.graceInvuln);
  }
}

function tryDash(state: GameState, input: FrameInput): void {
  const p = state.player;
  if (p.dashCooldown > 0 || isDashing(p)) return;
  p.dashDir = isZero(input.move) ? { ...p.facing } : { ...input.move };
  p.facing = { ...p.dashDir };
  p.dashTimer = PLAYER.dash.time;
  p.dashCooldown = PLAYER.dash.cooldown;
  p.invulnTimer = Math.max(p.invulnTimer, PLAYER.dash.time);
  p.dodgedThisDash = false;
  p.knock = { x: 0, y: 0 };
  // ダッシュで攻撃をキャンセルできる（手触り重視）
  cancelAttack(state);
  spawnBurst(state, p.body.pos, "#ffffff", 6, 40, 0.2, 1.5);
}

function updateMovement(state: GameState, input: FrameInput, dt: number): void {
  const p = state.player;
  let vel: Vec;
  if (isDashing(p)) {
    vel = scale(p.dashDir, PLAYER.dash.speed);
    // 残像
    if (state.tick % 2 === 0) {
      state.particles.push({
        pos: { ...p.body.pos },
        vel: { x: 0, y: 0 },
        life: 0.18,
        maxLife: 0.18,
        color: "#80c0ff",
        size: 5,
        drag: 1,
      });
    }
  } else {
    const mul = isAttacking(p) ? PLAYER.attackMoveMul : 1;
    vel = scale(input.move, PLAYER.speed * mul);
    if (!isZero(input.move) && !isAttacking(p)) p.facing = { ...input.move };
  }

  vel = add(vel, p.knock);
  const decay = Math.exp(-KNOCK_DECAY * dt);
  p.knock = scale(p.knock, decay);
  if (length(p.knock) < 2) p.knock = { x: 0, y: 0 };

  const hit = moveBody(state, p.body, vel.x * dt, vel.y * dt);
  if (isDashing(p) && (hit.hitX || hit.hitY)) {
    // 壁ダッシュは即終了して次の行動へ
    p.dashTimer = 0;
    p.invulnTimer = Math.max(p.invulnTimer, PLAYER.dash.graceInvuln);
  }
  p.body.vel = vel;
  if (!isZero(input.move) && !isDashing(p)) p.walkTime += dt;
}

function tryAttack(state: GameState): void {
  const a = state.player.attack;
  if (a.phase === "none") {
    startSwing(state, a.combo);
    return;
  }
  // recover の後半なら先行入力として次段を予約
  const step = PLAYER.melee[a.combo];
  if (a.phase === "recover" && step && a.timer <= step.recover * (1 - PLAYER.bufferWindow)) {
    a.buffered = true;
  } else if (a.phase === "recover" || a.phase === "active") {
    a.buffered = true;
  }
}

function startSwing(state: GameState, combo: number): void {
  const p = state.player;
  const step = PLAYER.melee[combo];
  if (!step) return;
  p.attack.combo = combo;
  p.attack.phase = "windup";
  p.attack.timer = step.windup;
  p.attack.buffered = false;
  p.attack.hitIds.clear();
  p.attack.dir = { ...p.facing };
}

function updateAttack(state: GameState, dt: number): void {
  const p = state.player;
  const a = p.attack;
  if (a.phase === "none") return;
  const step = PLAYER.melee[a.combo];
  if (!step) {
    cancelAttack(state);
    return;
  }

  a.timer -= dt;
  if (a.phase === "active") resolveMeleeHits(state, meleeBox(p, step.reach, step.size), step);

  if (a.timer > 0) return;
  switch (a.phase) {
    case "windup":
      a.phase = "active";
      a.timer = step.active;
      break;
    case "active":
      a.phase = "recover";
      a.timer = step.recover;
      break;
    case "recover": {
      const last = a.combo >= PLAYER.melee.length - 1;
      if (a.buffered && !last) {
        startSwing(state, a.combo + 1);
      } else {
        a.phase = "none";
        a.combo = 0;
        a.buffered = false;
        // 最終段の後は少し間を置く
        if (last) p.shootCooldown = Math.max(p.shootCooldown, PLAYER.comboLockout);
      }
      break;
    }
  }
}

export function meleeBox(p: Player, reach: number, size: number): Box {
  const c = add(p.body.pos, scale(p.attack.dir, reach));
  return { x: c.x - size / 2, y: c.y - size / 2, w: size, h: size };
}

function resolveMeleeHits(state: GameState, box: Box, step: (typeof PLAYER.melee)[number]): void {
  const p = state.player;
  for (const e of state.enemies) {
    if (p.attack.hitIds.has(e.id) || e.hp <= 0) continue;
    if (!boxCircleOverlap(box, e.body.pos.x, e.body.pos.y, e.body.radius)) continue;
    p.attack.hitIds.add(e.id);
    damageEnemy(state, e, step.damage, p.attack.dir, step.knockback, {
      stagger: step.stagger,
      hitstopSteps: step.stagger ? FEEL.hitstopHeavy : FEEL.hitstopLight,
      buildsEnergy: true,
    });
  }
  // 敵弾を斬り落とせる
  for (const pr of state.projectiles) {
    if (pr.owner !== "enemy") continue;
    if (!boxCircleOverlap(box, pr.pos.x, pr.pos.y, pr.radius)) continue;
    pr.life = 0;
    spawnBurst(state, pr.pos, pr.color, 5, 80, 0.25, 1.5);
    state.player.energy = Math.min(state.player.maxEnergy, state.player.energy + 4);
  }
}

function tryShoot(state: GameState): void {
  const p = state.player;
  if (p.shootCooldown > 0 || isDashing(p) || isAttacking(p)) return;
  p.shootCooldown = PLAYER.shoot.cooldown;
  const dir = { ...p.facing };
  const muzzle = add(p.body.pos, scale(dir, p.body.radius + 2));
  state.projectiles.push({
    id: allocId(state),
    owner: "player",
    pos: muzzle,
    vel: scale(dir, PLAYER.shoot.speed),
    radius: PLAYER.shoot.radius,
    damage: PLAYER.shoot.damage,
    life: PLAYER.shoot.life,
    color: BULLET_COLOR,
  });
  p.knock = add(p.knock, scale(dir, -PLAYER.shoot.recoil));
  spawnBurst(state, muzzle, BULLET_COLOR, 3, 60, 0.12, 1.5);
  shake(state, 1);
}

function trySpecial(state: GameState): void {
  const p = state.player;
  if (p.energy < PLAYER.special.cost) {
    addFloatingText(state, p.body.pos, "not ready", "#808080", 0.9, 0.4);
    return;
  }
  p.energy = 0;
  cancelAttack(state);
  const { radius, damage, knockback } = PLAYER.special;
  for (const e of state.enemies) {
    if (!circlesOverlap(p.body.pos.x, p.body.pos.y, radius, e.body.pos.x, e.body.pos.y, e.body.radius)) continue;
    const dir = normalize(sub(e.body.pos, p.body.pos));
    damageEnemy(state, e, damage, dir, knockback, { stagger: true, hitstopSteps: FEEL.hitstopHeavy });
  }
  for (const pr of state.projectiles) {
    if (pr.owner === "enemy" && circlesOverlap(p.body.pos.x, p.body.pos.y, radius, pr.pos.x, pr.pos.y, pr.radius)) {
      pr.life = 0;
    }
  }
  spawnBurst(state, p.body.pos, "#ffd75f", 40, 260, 0.5, 3);
  spawnBurst(state, p.body.pos, "#ffffff", 20, 120, 0.3, 2);
  addFloatingText(state, p.body.pos, "BURST!", "#ffd75f", 1.8, 0.8);
  hitstop(state, FEEL.hitstopHeavy);
  shake(state, FEEL.shakeSpecial);
  state.flash = Math.max(state.flash, 0.5);
  p.invulnTimer = Math.max(p.invulnTimer, 0.25);
}
