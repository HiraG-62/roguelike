import type { FrameInput } from "../core/input";
import { type Enemy, type GameState, type Player, type Projectile, allocId, pushSfx } from "../core/state";
import { type Vec, add, dist, fromAngle, angle, isZero, normalize, scale, sub, length } from "../core/vec";
import { screenToWorld } from "../core/view";
import type { SfxName } from "../audio/sfxNames";
import { ACTION, FEEL, KEYSTONE, PLAYER } from "../data/tuning";
import { DEFAULT_STATS, type PlayerStats } from "../loot/types";
import { cancelAttack, damageEnemy, gainEnergy, healPlayer, rollOutgoing, tickRegain } from "./combat";
import { addFloatingText, hitstop, shake, spawnBurst, spawnLine } from "./effects";
import { KEYSTONE_NAME, KS, hasKeystone, payOverclock, payOverclockShoot, regenAllowed } from "./keystones";
import { type Box, boxCircleOverlap, circlesOverlap, moveBody } from "./physics";
import { explodeAt } from "./statusEffects";
import {
  cancelSkills,
  consumeLungeCombo,
  frenzyMul,
  skillLocksAttack,
  skillLocksDash,
  skillMoveMul,
  trackDamageDealt,
  updateSkills,
} from "./skills";
import { fireTrigger, tickTriggerCooldowns } from "./triggers";
import {
  boonBlocksMelee,
  boonMoveMul,
  boonSwingCombo,
  canShootWhileDashing,
  foldBoonStats,
  onBoonBurstKills,
  onBoonDash,
  onBoonDashEnd,
  onBoonMeleeHit,
  onBoonShoot,
  onBoonSwing,
  parryEnergyMul,
  tryDashGuard,
} from "./boons";

const KNOCK_DECAY = 14;
const KNOCK_MIN = 2;
const BULLET_COLOR = "#a0e0ff";
const DEG_TO_RAD = Math.PI / 180;
const SLASH_SFX: readonly SfxName[] = ["slash1", "slash2", "slash3"];
const BURST_INVULN = 0.25;
const PACIFIST_COLOR = "#a0a0a0";
/** ks_bladeOath の「撃てない」表示の間隔（秒）。押しっぱなしで連打表示しない */
const BLADE_OATH_TEXT_INTERVAL = 0.6;
/** 装備変更で HP 割合を維持するときの生存中の下限 */
const MIN_ALIVE_HP = 1;
/** 突進斬りから繋がる近接の段（0 始まり） */
const LUNGE_FOLLOW_COMBO = 1;

export function createPlayer(pos: Vec, stats: Readonly<PlayerStats> = DEFAULT_STATS): Player {
  return {
    body: { pos: { ...pos }, vel: { x: 0, y: 0 }, radius: PLAYER.radius },
    hp: stats.maxHp,
    maxHp: stats.maxHp,
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
    dashChargesLeft: stats.dashCharges,
    triggerCooldowns: new Map(),
    buffs: { damage: { time: 0, mul: 1 }, speed: { time: 0, mul: 1 }, invuln: 0 },
    justTimer: 0,
    meleeHitCount: 0,
    overclockShotCount: 0,
    lifeOnHitWindow: { timer: 0, healed: 0 },
    regainPool: 0,
    regainTimer: 0,
    regainStep: 0,
    justCounterTimer: 0,
    justCounterTargetId: null,
    dashAttackQueued: false,
    dashStrike: false,
  };
}

/**
 * 装備変更などで stats が変わったときにプレイヤーへ反映する。
 * maxHp が変わったら現在 HP の割合を維持する
 */
export function applyStats(state: GameState, equipStats: PlayerStats): void {
  const p = state.player;
  const ratio = p.maxHp > 0 ? p.hp / p.maxHp : 1;
  // 祝福（ラン内）は装備の stats に畳み込む。装備画面から呼ばれても祝福が消えない
  state.boonRun.baseStats = equipStats;
  const stats = foldBoonStats(equipStats, state.boons, state.boonRun);
  state.stats = stats;
  p.maxHp = stats.maxHp;
  p.dashChargesLeft = Math.min(p.dashChargesLeft, stats.dashCharges);
  // 死亡中に装備画面を触っても蘇生しない
  if (state.status === "dead") return;
  // 丸めない（付け外しの往復で HP が増える抜け道を作らない）。生存中は最低 1
  p.hp = Math.min(p.maxHp, Math.max(MIN_ALIVE_HP, p.maxHp * ratio));
}

export function isDashing(p: Player): boolean {
  return p.dashTimer > 0;
}

export function isAttacking(p: Player): boolean {
  return p.attack.phase !== "none";
}

export interface MeleeStep {
  windup: number;
  active: number;
  recover: number;
  damage: number;
  reach: number;
  size: number;
  knockback: number;
  stagger: boolean;
}

/** tuning の近接段に stats（攻撃速度・リーチ・ノックバック）を掛けたもの。dashStrike ならダッシュ攻撃 */
export function meleeStep(stats: Readonly<PlayerStats>, combo: number, dashStrike = false): MeleeStep | undefined {
  const base = dashStrike ? ACTION.dashAttack : PLAYER.melee[combo];
  if (!base) return undefined;
  const speed = stats.attackSpeedMul;
  return {
    windup: base.windup / speed,
    active: base.active / speed,
    recover: base.recover / speed,
    damage: base.damage,
    reach: base.reach * stats.meleeReachMul,
    size: base.size * stats.meleeReachMul,
    knockback: base.knockback * stats.knockbackMul,
    stagger: base.stagger,
  };
}

export function dashTime(stats: Readonly<PlayerStats>): number {
  return PLAYER.dash.time * stats.dashDistanceMul;
}

export function dashCooldownTime(stats: Readonly<PlayerStats>): number {
  return PLAYER.dash.cooldown * stats.dashCooldownMul;
}

/** カーソルがこの距離より近いと向きを更新しない（震え防止） */
const AIM_DEADZONE = 2;

export function updatePlayer(state: GameState, input: FrameInput, dt: number): void {
  const p = state.player;
  // 血の契約の吸収は前フレームの敵・弾による与ダメも拾う
  trackDamageDealt(state);
  tickTimers(state, dt);
  const aiming = applyAim(state, input);

  if (input.dashPressed && !skillLocksDash(state)) tryDash(state, input);
  if (input.attackPressed && !skillLocksAttack(state)) tryAttack(state);
  releaseDashAttack(state);
  // バーストは常にスキルをキャンセルできる
  if (input.specialPressed && trySpecial(state)) cancelSkills(state);
  updateSkills(state, input, dt);

  updateAttack(state, dt);
  updateMovement(state, input, dt, aiming);
  if (input.shootHeld && !skillLocksAttack(state)) tryShoot(state);
  if (hasKeystone(state, KS.juggernaut)) p.knock = { x: 0, y: 0 };
  trackDamageDealt(state);
}

/** 近接・射撃の速度に血の契約（frenzy）を乗せた stats。装備の stats は書き換えない */
function actionStats(state: GameState): PlayerStats {
  const mul = frenzyMul(state);
  if (mul === 1) return state.stats;
  return { ...state.stats, attackSpeedMul: state.stats.attackSpeedMul * mul, fireRateMul: state.stats.fireRateMul * mul };
}

/** マウス照準があれば向きをカーソル方向にする。照準していれば true */
function applyAim(state: GameState, input: FrameInput): boolean {
  if (!input.aimScreen) return false;
  const p = state.player;
  const world = screenToWorld(state.camera, input.aimScreen);
  const delta = sub(world, p.body.pos);
  if (length(delta) < AIM_DEADZONE) return true;
  // 攻撃中は振り始めの向きを維持する（振り向き斬りにならないように）
  if (!isAttacking(p) || p.attack.phase === "recover") p.facing = normalize(delta);
  return true;
}

function tickTimers(state: GameState, dt: number): void {
  const p = state.player;
  tickDashCharges(state, dt);
  p.invulnTimer = Math.max(0, p.invulnTimer - dt);
  p.hitFlash = Math.max(0, p.hitFlash - dt);
  p.shootCooldown = Math.max(0, p.shootCooldown - dt);
  p.justTimer = Math.max(0, p.justTimer - dt);
  p.buffs.damage.time = Math.max(0, p.buffs.damage.time - dt);
  p.buffs.speed.time = Math.max(0, p.buffs.speed.time - dt);
  p.buffs.invuln = Math.max(0, p.buffs.invuln - dt);
  p.lifeOnHitWindow.timer = Math.max(0, p.lifeOnHitWindow.timer - dt);
  p.justCounterTimer = Math.max(0, p.justCounterTimer - dt);
  if (p.justCounterTimer === 0) p.justCounterTargetId = null;
  tickRegain(state, dt);
  tickTriggerCooldowns(state, dt);
  tickRegen(state, dt);
  if (p.dashTimer > 0) {
    p.dashTimer = Math.max(0, p.dashTimer - dt);
    // ダッシュが終わった直後、猶予ぶんの無敵を残す
    if (p.dashTimer === 0) {
      p.invulnTimer = Math.max(p.invulnTimer, PLAYER.dash.graceInvuln);
      onBoonDashEnd(state);
    }
  }
}

/** チャージ制: 減っている間だけ cooldown が進み、0 になるたび 1 回復 */
function tickDashCharges(state: GameState, dt: number): void {
  const p = state.player;
  const max = state.stats.dashCharges;
  if (p.dashChargesLeft >= max) {
    p.dashCooldown = 0;
    return;
  }
  p.dashCooldown = Math.max(0, p.dashCooldown - dt);
  if (p.dashCooldown > 0) return;
  p.dashChargesLeft += 1;
  if (p.dashChargesLeft < max) p.dashCooldown = dashCooldownTime(state.stats);
}

function tickRegen(state: GameState, dt: number): void {
  const regen = state.stats.hpRegen;
  if (regen <= 0 || !regenAllowed(state)) return;
  healPlayer(state, regen * dt, { silent: true });
}

function tryDash(state: GameState, input: FrameInput): void {
  const p = state.player;
  if (p.dashChargesLeft <= 0 || isDashing(p)) return;
  p.dashChargesLeft -= 1;
  if (p.dashCooldown <= 0) p.dashCooldown = dashCooldownTime(state.stats);
  if (tryDashGuard(state)) return;
  p.dashDir = isZero(input.move) ? { ...p.facing } : normalize(input.move);
  p.facing = { ...p.dashDir };
  p.knock = { x: 0, y: 0 };
  // ダッシュで攻撃をキャンセルできる（手触り重視）
  cancelAttack(state);
  spawnBurst(state, p.body.pos, "#ffffff", 6, 40, 0.2, 1.5);
  pushSfx(state, "dash");

  if (hasKeystone(state, KS.blink)) {
    blink(state);
  } else {
    const time = dashTime(state.stats);
    p.dashTimer = time;
    p.invulnTimer = Math.max(p.invulnTimer, time);
    p.dodgedThisDash = false;
  }
  onBoonDash(state);
  fireTrigger(state, "onDash", { pos: { ...p.body.pos } });
}

/** ks_blink: ダッシュ距離ぶん一瞬で移動（壁の手前で止まる）、着地点で爆発。無敵なし */
function blink(state: GameState): void {
  const p = state.player;
  const distance = PLAYER.dash.speed * dashTime(state.stats);
  const from = { ...p.body.pos };
  moveBody(state, p.body, p.dashDir.x * distance, p.dashDir.y * distance);
  spawnBurst(state, from, KEYSTONE.blinkColor, 10, 60, 0.3, 2);
  explodeAt(state, p.body.pos, KEYSTONE.blinkRadius, KEYSTONE.blinkDamage);
}

function updateMovement(state: GameState, input: FrameInput, dt: number, aiming: boolean): void {
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
    const attackMul = (isAttacking(p) ? PLAYER.attackMoveMul : 1) * skillMoveMul(state) * boonMoveMul(state);
    const buffMul = p.buffs.speed.time > 0 ? p.buffs.speed.mul : 1;
    vel = scale(input.move, PLAYER.speed * state.stats.moveSpeedMul * attackMul * buffMul);
    if (!aiming && !isZero(input.move) && !isAttacking(p)) p.facing = { ...input.move };
  }

  vel = add(vel, p.knock);
  const decay = Math.exp(-KNOCK_DECAY * dt);
  p.knock = scale(p.knock, decay);
  if (length(p.knock) < KNOCK_MIN) p.knock = { x: 0, y: 0 };

  const hit = moveBody(state, p.body, vel.x * dt, vel.y * dt);
  if (isDashing(p) && (hit.hitX || hit.hitY)) {
    // 壁ダッシュは即終了して次の行動へ
    p.dashTimer = 0;
    p.invulnTimer = Math.max(p.invulnTimer, PLAYER.dash.graceInvuln);
    onBoonDashEnd(state);
  }
  p.body.vel = vel;
  if (!isZero(input.move) && !isDashing(p)) p.walkTime += dt;
}

function tryAttack(state: GameState): void {
  if (hasKeystone(state, KS.pacifist)) {
    addFloatingText(state, state.player.body.pos, KEYSTONE_NAME[KS.pacifist] ?? KS.pacifist, PACIFIST_COLOR, 0.9, 0.4);
    return;
  }
  if (boonBlocksMelee(state)) return;
  if (tryJustCounter(state)) return;
  const p = state.player;
  // ダッシュ中の攻撃はダッシュ終了と同時のダッシュ攻撃として予約する
  if (isDashing(p)) {
    p.dashAttackQueued = true;
    return;
  }
  const a = p.attack;
  if (a.phase === "none") {
    // 突進斬り直後は 2 段目から
    startSwing(state, consumeLungeCombo(state) ? LUNGE_FOLLOW_COMBO : a.combo);
    return;
  }
  // recover / active 中なら先行入力として次段を予約
  if (a.phase === "recover" || a.phase === "active") a.buffered = true;
}

function startSwing(state: GameState, requested: number, dashStrike = false): void {
  const p = state.player;
  const combo = boonSwingCombo(state, requested, dashStrike);
  const step = meleeStep(actionStats(state), combo, dashStrike);
  if (!step) return;
  p.dashStrike = dashStrike;
  p.attack.combo = combo;
  p.attack.phase = "windup";
  p.attack.timer = step.windup;
  p.attack.buffered = false;
  p.attack.hitIds.clear();
  p.attack.dir = { ...p.facing };
  const sfx = SLASH_SFX[combo];
  if (sfx) pushSfx(state, sfx);
  payOverclock(state, PLAYER.overclockHpCost);
  onBoonSwing(state, combo, dashStrike, step.damage);
}

function updateAttack(state: GameState, dt: number): void {
  const p = state.player;
  const a = p.attack;
  if (a.phase === "none") return;
  const step = meleeStep(actionStats(state), a.combo, p.dashStrike);
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
        p.dashStrike = false;
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

function resolveMeleeHits(state: GameState, box: Box, step: MeleeStep): void {
  const p = state.player;
  for (const e of state.enemies) {
    if (p.attack.hitIds.has(e.id) || e.hp <= 0) continue;
    if (!boxCircleOverlap(box, e.body.pos.x, e.body.pos.y, e.body.radius)) continue;
    p.attack.hitIds.add(e.id);
    meleeHitEnemy(state, e, step);
  }
  // 敵弾を斬るとプレイヤー弾として撃ち返す（弾返しパリィ）
  for (const pr of state.projectiles) {
    if (pr.owner !== "enemy" || pr.life <= 0) continue;
    if (!boxCircleOverlap(box, pr.pos.x, pr.pos.y, pr.radius)) continue;
    reflectProjectile(state, pr);
  }
}

/** 近接 1 ヒット。敵の windup 中ならカウンターヒット */
function meleeHitEnemy(state: GameState, e: Enemy, step: MeleeStep): void {
  const p = state.player;
  const counter = isCounterable(e);
  const out = rollOutgoing(state, e, step.damage, "melee");
  const amount = counter ? Math.round(out.amount * ACTION.counter.damageMul) : out.amount;
  const baseHitstop = step.stagger ? FEEL.hitstopHeavy : FEEL.hitstopLight;
  const pos = { ...e.body.pos };
  if (step.stagger) e.wallSplat = true;
  damageEnemy(state, e, amount, p.attack.dir, step.knockback, {
    stagger: step.stagger || counter,
    hitstopSteps: baseHitstop + (counter ? ACTION.counter.hitstopBonus : 0),
    buildsEnergy: true,
    kind: "melee",
    crit: out.crit,
    guardBreak: counter,
  });
  if (counter) showCounter(state, pos);
  p.meleeHitCount += 1;
  fireTrigger(state, "onMeleeHit", { pos, targetId: e.id });
  fireTrigger(state, "everyNthMeleeHit", { pos, targetId: e.id });
  onBoonMeleeHit(state, e);
}

/** カウンターヒットになる敵の状態（予備動作中） */
export function isCounterable(e: Enemy): boolean {
  return e.phase === "windup";
}

function showCounter(state: GameState, pos: Vec): void {
  const c = ACTION.counter;
  addFloatingText(state, pos, c.text, c.color, c.textScale, c.textLife);
  spawnBurst(state, pos, c.color, c.particles, 150, 0.35, 2);
  pushSfx(state, "counter");
}

/** 敵弾をプレイヤー弾に変えて攻撃方向へ撃ち返す（スキルのパリィとは別） */
function reflectProjectile(state: GameState, pr: Projectile): void {
  const r = ACTION.reflect;
  const speed = length(pr.vel) * r.speedMul;
  pr.owner = "player";
  pr.vel = scale(state.player.attack.dir, speed);
  pr.damage = pr.damage * r.damageMul;
  pr.kind = "ranged";
  pr.color = r.color;
  pr.hitIds.clear();
  pr.pierceLeft = r.pierce;
  pr.sourceId = undefined;
  pr.life = Math.max(pr.life, r.minLife);
  gainEnergy(state, r.energy * parryEnergyMul(state));
  addFloatingText(state, pr.pos, r.text, r.color, r.textScale, r.textLife);
  spawnBurst(state, pr.pos, r.color, r.particles, 100, 0.25, 1.5);
  pushSfx(state, "reflect");
}

/** JUST 回避直後の攻撃: 回避した敵の手前へ瞬間移動して重い一撃。出したら true */
function tryJustCounter(state: GameState): boolean {
  const p = state.player;
  if (p.justCounterTimer <= 0 || p.justCounterTargetId === null) return false;
  const targetId = p.justCounterTargetId;
  p.justCounterTimer = 0;
  p.justCounterTargetId = null;
  const target = state.enemies.find((e) => e.id === targetId && e.hp > 0);
  if (!target) return false;
  if (dist(p.body.pos, target.body.pos) > ACTION.justCounter.maxRange) return false;
  justCounterStrike(state, target);
  return true;
}

function justCounterStrike(state: GameState, target: Enemy): void {
  const p = state.player;
  const j = ACTION.justCounter;
  const from = { ...p.body.pos };
  const toEnemy = sub(target.body.pos, p.body.pos);
  const dir = normalize(toEnemy, p.facing);
  // 壁は無視しない（moveBody が壁の手前で止める）。敵の縁の少し手前で止まる
  const travel = Math.max(0, length(toEnemy) - target.body.radius - p.body.radius - j.gap);
  cancelAttack(state);
  p.dashTimer = 0;
  p.knock = { x: 0, y: 0 };
  moveBody(state, p.body, dir.x * travel, dir.y * travel);
  p.facing = { ...dir };

  // 見た目は 3 段目の振り。対象にはここで当てるので hitIds に入れて二重ヒットを防ぐ
  const lastCombo = PLAYER.melee.length - 1;
  startSwing(state, lastCombo);
  p.attack.dir = { ...dir };
  p.attack.hitIds.add(target.id);
  const step = meleeStep(actionStats(state), lastCombo);
  if (!step) return;
  const out = rollOutgoing(state, target, step.damage, "melee");
  const hitPos = { ...target.body.pos };
  target.wallSplat = true;
  damageEnemy(state, target, Math.round(out.amount * j.damageMul), dir, step.knockback, {
    stagger: true,
    hitstopSteps: FEEL.hitstopHeavy + j.hitstopBonus,
    buildsEnergy: true,
    kind: "melee",
    crit: out.crit,
    guardBreak: true,
  });
  p.meleeHitCount += 1;
  spawnLine(state, from, p.body.pos, j.color, j.lineLife);
  spawnBurst(state, p.body.pos, j.color, j.particles, 160, 0.4, 2);
  addFloatingText(state, p.body.pos, j.text, j.color, j.textScale, j.textLife);
  pushSfx(state, "counter");
  fireTrigger(state, "onMeleeHit", { pos: hitPos, targetId: target.id });
  fireTrigger(state, "everyNthMeleeHit", { pos: hitPos, targetId: target.id });
}

/** ダッシュ中に予約した攻撃を、ダッシュが終わった瞬間に出す */
function releaseDashAttack(state: GameState): void {
  const p = state.player;
  if (!p.dashAttackQueued || isDashing(p)) return;
  p.dashAttackQueued = false;
  if (hasKeystone(state, KS.pacifist) || skillLocksAttack(state)) return;
  cancelAttack(state);
  startSwing(state, 0, true);
}

/** n 発を扇状に並べた角度オフセット（ラジアン）。1 発なら [0] */
export function spreadOffsets(count: number): number[] {
  const step = PLAYER.projectileSpreadDeg * DEG_TO_RAD;
  const center = (count - 1) / 2;
  return Array.from({ length: count }, (_, i) => (i - center) * step);
}

function tryShoot(state: GameState): void {
  const p = state.player;
  if (p.shootCooldown > 0 || isAttacking(p)) return;
  if (isDashing(p) && !canShootWhileDashing(state)) return;
  if (hasKeystone(state, KS.bladeOath)) {
    addFloatingText(state, p.body.pos, KEYSTONE_NAME[KS.bladeOath] ?? KS.bladeOath, PACIFIST_COLOR, 0.9, 0.4);
    p.shootCooldown = BLADE_OATH_TEXT_INTERVAL;
    return;
  }
  const s = state.stats;
  p.shootCooldown = PLAYER.shoot.cooldown / (s.fireRateMul * frenzyMul(state));
  const dir = { ...p.facing };
  const muzzle = add(p.body.pos, scale(dir, p.body.radius + 2));
  const baseAngle = angle(dir);
  const speed = PLAYER.shoot.speed * s.projectileSpeedMul;
  const firstShot = state.projectiles.length;
  for (const offset of spreadOffsets(s.projectileCount)) {
    state.projectiles.push({
      id: allocId(state),
      owner: "player",
      pos: { ...muzzle },
      vel: scale(fromAngle(baseAngle + offset), speed),
      radius: PLAYER.shoot.radius,
      damage: PLAYER.shoot.damage,
      life: PLAYER.shoot.life,
      color: BULLET_COLOR,
      kind: "ranged",
      hitIds: new Set(),
      pierceLeft: s.pierce,
    });
  }
  onBoonShoot(state, state.projectiles.slice(firstShot));
  p.knock = add(p.knock, scale(dir, -PLAYER.shoot.recoil));
  spawnBurst(state, muzzle, BULLET_COLOR, 3, 60, 0.12, 1.5);
  shake(state, 1);
  pushSfx(state, "shoot");
  payOverclockShoot(state);
  fireTrigger(state, "onShoot", { pos: muzzle });
}

/** バースト。発動したら true */
function trySpecial(state: GameState): boolean {
  const p = state.player;
  if (p.energy < PLAYER.special.cost) {
    addFloatingText(state, p.body.pos, "未充填", "#808080", 0.9, 0.4);
    return false;
  }
  p.energy = 0;
  cancelAttack(state);
  const s = state.stats;
  const radius = PLAYER.special.radius * s.burstRadiusMul;
  const damage = PLAYER.special.damage * s.burstDamageMul;
  const knockback = PLAYER.special.knockback * s.knockbackMul;
  let kills = 0;
  for (const e of state.enemies) {
    if (!circlesOverlap(p.body.pos.x, p.body.pos.y, radius, e.body.pos.x, e.body.pos.y, e.body.radius)) continue;
    const dir = normalize(sub(e.body.pos, p.body.pos));
    const out = rollOutgoing(state, e, damage, "proc");
    if (damageEnemy(state, e, out.amount, dir, knockback, { stagger: true, hitstopSteps: FEEL.hitstopHeavy })) kills += 1;
  }
  for (const pr of state.projectiles) {
    if (pr.owner === "enemy" && circlesOverlap(p.body.pos.x, p.body.pos.y, radius, pr.pos.x, pr.pos.y, pr.radius)) {
      pr.life = 0;
    }
  }
  spawnBurst(state, p.body.pos, "#ffd75f", 40, 260, 0.5, 3);
  spawnBurst(state, p.body.pos, "#ffffff", 20, 120, 0.3, 2);
  addFloatingText(state, p.body.pos, "バースト！", "#ffd75f", 1.8, 0.8);
  hitstop(state, FEEL.hitstopHeavy);
  shake(state, FEEL.shakeSpecial);
  state.flash = Math.max(state.flash, 0.5);
  p.invulnTimer = Math.max(p.invulnTimer, BURST_INVULN);
  pushSfx(state, "burst");
  onBoonBurstKills(state, kills);
  return true;
}
