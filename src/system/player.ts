import type { FrameInput } from "../core/input";
import { type Enemy, type GameState, type Player, type Projectile, allocId, pushSfx } from "../core/state";
import { type Vec, add, dist, fromAngle, angle, isZero, normalize, scale, sub, length } from "../core/vec";
import { screenToWorld } from "../core/view";
import type { SfxName } from "../audio/sfxNames";
import { ACTION, BOON, FEEL, KEYSTONE, MANA, PLAYER, WEAPON } from "../data/tuning";
import {
  type ActionKind,
  type ButtonKey,
  type HitShape,
  type MeleeStepDef,
  type MovesetDef,
  type ShotDef,
  type ShotRuntime,
  type TipDef,
  BURST_ATTACK,
  MOVESETS,
  SHOT_TYPES,
  chargeLevelAt,
  matchBranch,
  meleeButton,
  shotButton,
} from "../data/weapons";
import { DEFAULT_STATS, createLootRuntime, type PlayerStats } from "../loot/types";
import { cancelAttack, damageEnemy, gainEnergy, rollOutgoing, tickHpRegen, tickRegain } from "./combat";
import { addFloatingText, hitstop, shake, spawnBurst, spawnLine } from "./effects";
import { KEYSTONE_NAME, KS, attackManaMul, hasKeystone, payOverclock, payOverclockShoot } from "./keystones";
import { type Box, boxCircleOverlap, circlesOverlap, moveBody } from "./physics";
import { explodeAt, hasStatus, playerStatusMoveMul } from "./statusEffects";
import { terrainSlide } from "./terrain";
import { addRunAttributes, deriveAttributes, scaled } from "./attributes";
import { applyRunStats } from "./runSetup";
import { gainAttackMana } from "./mana";
import { createStatusBag } from "../core/status";
import {
  cancelSkills,
  consumeLungeCombo,
  frenzyMul,
  onSkillMeleeHit,
  onSkillPlayerShoot,
  skillLocksAttack,
  skillLocksDash,
  skillMoveMul,
  trackDamageDealt,
  updateSkills,
} from "./skills";
import { fireTrigger, tickTriggerCooldowns } from "./triggers";
import { enemyTarget, pushEvent, pushPlayerEvent } from "../core/events";
import { onTraitCounter } from "./traitHooks";
import {
  boonAttackManaMul,
  boonBlocksMelee,
  boonMoveMul,
  boonNormalAttackBonus,
  boonSwingCombo,
  canShootWhileDashing,
  foldBoonStats,
  hasBoon,
  onBoonBurstKills,
  onBoonDash,
  onBoonDashEnd,
  onBoonMeleeHit,
  onBoonShoot,
  onBoonSwing,
  tryDashGuard,
} from "./boons";
import { boonBlocksShoot, boonCounterable, onBoonShootInput } from "./boonRules";

const KNOCK_DECAY = 14;
const KNOCK_MIN = 2;
const BULLET_COLOR = "#a0e0ff";
const DEG_TO_RAD = Math.PI / 180;
const SLASH_SFX: readonly SfxName[] = ["slash1", "slash2", "slash3"];
const PACIFIST_COLOR = "#a0a0a0";
/** ks_bladeOath の「撃てない」表示の間隔（秒）。押しっぱなしで連打表示しない */
const BLADE_OATH_TEXT_INTERVAL = 0.6;
/** 装備変更で HP 割合を維持するときの生存中の下限 */
const MIN_ALIVE_HP = 1;
/** 突進斬りから繋がる近接の段（0 始まり） */
const LUNGE_FOLLOW_COMBO = 1;
/** 祝福・スキルが「最終段」として読む combo（剣の 3 段目と同じ 2） */
const FINISHER_COMBO = PLAYER.melee.length - 1;
const FULL_TURN = Math.PI * 2;
/** 溜めの段が上がったときの粒 */
const CHARGE_LEVEL_PARTICLES = 8;

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
    attack: {
      combo: 0,
      phase: "none",
      timer: 0,
      buffered: false,
      hitIds: new Set(),
      dir: { x: 1, y: 0 },
      step: 0,
      chargeLevel: 0,
      charging: false,
      chargeTime: 0,
      branch: -1,
      pendingBranch: -1,
      inputs: [],
      inputTimer: 0,
      hitTick: 0,
    },
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
    mana: stats.maxMana,
    status: createStatusBag(),
    loot: createLootRuntime(),
    shotCharging: false,
    shotChargeTime: 0,
    secondaryWasHeld: false,
  };
}

/**
 * 装備変更などで stats が変わったときにプレイヤーへ反映する。
 * maxHp が変わったら現在 HP の割合を維持する。
 * 集計順は 装備 → ラン内振り分け → ステータスの派生 → 祝福（docs/COMBAT_DESIGN.md A-4 から祝福を最後へ移した）
 */
export function applyStats(state: GameState, equipStats: PlayerStats): void {
  const p = state.player;
  const ratio = p.maxHp > 0 ? p.hp / p.maxHp : 1;
  // 起点・縛り・祭壇の誓約（ラン内）を装備の stats に先に足す。装備画面から呼ばれても消えない
  const base = applyRunStats(state, equipStats);
  // 祝福（ラン内）は装備の stats に畳み込む。装備画面から呼ばれても祝福が消えない
  state.boonRun.baseStats = base;
  // 派生 → 祝福の順: 祝福の固定値（硝子の見切りの最大 HP 1 など）を体力の加算で崩さない
  const derived = deriveAttributes(addRunAttributes(base, state.runAttributes.alloc));
  const stats = foldBoonStats(derived, state.boons, state.boonRun);
  state.stats = stats;
  p.maxHp = stats.maxHp;
  // 精神が下がって上限が縮んだときだけ切り詰める（増えたぶんは自然回復で埋める）
  p.mana = Math.min(p.mana, stats.maxMana);
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
  /** ステータスの係数を評価した威力（装備の flat / mul は rollOutgoing が掛ける） */
  damage: number;
  /** 最終の怯み値（poiseDamageMul 込み。カウンターの倍率は含まない） */
  poise: number;
  reach: number;
  size: number;
  knockback: number;
  /** 重いヒットストップと壁叩きつけを起こす段 */
  heavy: boolean;
  /** 当たり判定の形（src/data/weapons.ts の HitShape） */
  shape: HitShape;
  /** 命中 1 体ごとのマナ回収（倍率を掛ける前） */
  mana: number;
  pull: boolean;
  throw: boolean;
  /** 突きの先端判定（槍・鞭）。突き以外の形では持たない */
  tip?: TipDef;
  /** 1 振りの多段ヒット数（1 以上） */
  hits: number;
  /** ヒットストップ（ステップ）。undefined は heavy で決める */
  hitstop?: number;
  shake: number;
  /** 踏み込み距離（px） */
  lunge: number;
  trail?: string;
}

/** 装備中の武器種。武器なしは剣 */
export function currentMoveset(stats: Readonly<PlayerStats>): MovesetDef {
  // 旧形式の stats（moveset を持たない）でも落ちないよう既定へ
  return MOVESETS[stats.moveset] ?? MOVESETS.sword;
}

/** 装備中の射撃の型。銃なしは単発 */
export function currentShot(stats: Readonly<PlayerStats>): ShotDef {
  return SHOT_TYPES[stats.shot] ?? SHOT_TYPES.single;
}

/** 武器種の段 → 祝福・スキルに渡す combo（1 段目 0 / 途中 1 / 最終段 2）。段数が違っても最終段の祝福が最終段で出る */
export function hookCombo(moveset: MovesetDef, step: number): number {
  if (step >= moveset.steps.length - 1) return FINISHER_COMBO;
  return Math.min(step, FINISHER_COMBO - 1);
}

function stepDef(moveset: MovesetDef, step: number, dashStrike: boolean, chargeLevel: number, branch: number): MeleeStepDef | undefined {
  if (dashStrike) return moveset.dashAttack;
  if (branch >= 0) return moveset.branches[branch]?.step;
  if (chargeLevel > 0 && moveset.charge) return moveset.charge.step;
  return moveset.steps[step];
}

/**
 * 武器種の段に stats（ステータス・攻撃速度・リーチ・ノックバック）を掛けたもの。
 * dashStrike ならダッシュ攻撃、chargeLevel > 0 なら溜め攻撃（段の倍率を掛ける）
 */
export function meleeStep(
  stats: Readonly<PlayerStats>,
  step: number,
  dashStrike = false,
  chargeLevel = 0,
  branch = -1,
): MeleeStep | undefined {
  const moveset = currentMoveset(stats);
  const base = stepDef(moveset, step, dashStrike, chargeLevel, branch);
  if (!base) return undefined;
  const level = chargeLevel > 0 ? moveset.charge?.levels[chargeLevel - 1] : undefined;
  const speed = stats.attackSpeedMul;
  const reachMul = stats.meleeReachMul * (level?.reachMul ?? 1);
  return {
    windup: base.windup / speed,
    active: base.active / speed,
    recover: base.recover / speed,
    damage: scaled(stats, base.scaling) * (level?.damageMul ?? 1),
    poise: base.poise * stats.poiseDamageMul * (level?.poiseMul ?? 1),
    reach: base.reach * reachMul,
    size: base.size * reachMul,
    knockback: base.knockback * stats.knockbackMul,
    heavy: base.heavy,
    shape: base.shape,
    mana: base.mana,
    pull: base.pull ?? false,
    throw: base.throw ?? false,
    tip: base.shape.kind === "thrust" ? moveset.tip : undefined,
    hits: Math.max(1, base.hits ?? 1),
    hitstop: base.hitstop,
    shake: base.shake ?? 0,
    lunge: base.lunge ?? 0,
    trail: base.trail,
  };
}

/** 今の振りの段（描画用。振っていなければ undefined） */
export function currentMeleeStep(state: GameState): MeleeStep | undefined {
  const p = state.player;
  if (!isAttacking(p)) return undefined;
  return meleeStep(state.stats, p.attack.step, p.dashStrike, p.attack.chargeLevel, p.attack.branch);
}

/** 射撃 1 発の基礎威力（ステータスの係数を評価した値。射撃の型の倍率は含まない） */
export function shotDamage(stats: Readonly<PlayerStats>): number {
  return scaled(stats, PLAYER.shoot.scaling);
}

/** バーストの威力（ステータスの係数 × burstDamageMul） */
export function burstDamage(stats: Readonly<PlayerStats>): number {
  return scaled(stats, PLAYER.special.scaling) * stats.burstDamageMul;
}

/** 怯み（被弾硬直）中か。移動が遅くなり、攻撃・射撃・ダッシュ・バースト・スキルが出せない（docs/COMBAT_DESIGN.md D-5） */
export function isPlayerStaggered(p: Player): boolean {
  return hasStatus(p.status, "stagger");
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
  const staggered = isPlayerStaggered(p);

  if (!staggered) readActions(state, input);
  updateCharge(state, input, dt);
  releaseDashAttack(state);
  updateSkills(state, staggered ? withoutSkillInput(input) : input, dt);

  updateAttack(state, dt);
  updateMovement(state, input, dt, aiming);
  const shotHeld = shotButtonHeld(state, input);
  onBoonShootInput(state, shotHeld);
  updateShooting(state, shotHeld && !staggered && !skillLocksAttack(state), dt);
  // 右の「押した瞬間」は前フレームとの差で取る（FrameInput は押しっぱなししか持たない）
  p.secondaryWasHeld = input.shootHeld;
  if (hasKeystone(state, KS.juggernaut)) p.knock = { x: 0, y: 0 };
  trackDamageDealt(state);
}

/** ダッシュ・近接・バーストの入力を読む（怯み中は呼ばない） */
function readActions(state: GameState, input: FrameInput): void {
  if (input.dashPressed && !skillLocksDash(state)) tryDash(state, input);
  if (!skillLocksAttack(state)) readAttackButtons(state, input);
  // バーストは常にスキルをキャンセルできる
  if (input.specialPressed && trySpecial(state)) cancelSkills(state);
}

/** 左右のボタンの押した瞬間。武器種の役割（近接 / 射撃 / 溜め）と派生の入力列で振り分ける */
function readAttackButtons(state: GameState, input: FrameInput): void {
  if (input.attackPressed) onButtonPress(state, "primary");
  if (input.shootHeld && !state.player.secondaryWasHeld) onButtonPress(state, "secondary");
}

function onButtonPress(state: GameState, button: ButtonKey): void {
  const moveset = currentMoveset(state.stats);
  logButton(state.player, button);
  if (tryBranch(state, moveset)) return;
  const role = buttonRole(moveset, button);
  if (role !== "shot") tryAttack(state, role === "charge");
}

function buttonRole(moveset: MovesetDef, button: ButtonKey): ActionKind {
  return button === "primary" ? moveset.primary : moveset.secondary;
}

function buttonHeld(input: FrameInput, button: ButtonKey | undefined): boolean {
  if (button === "primary") return input.attackHeld;
  if (button === "secondary") return input.shootHeld;
  return false;
}

/** 射撃の役割を持つボタンの押しっぱなし。剣なら右、杖なら左、どちらも近接の武器種では撃たない */
function shotButtonHeld(state: GameState, input: FrameInput): boolean {
  return buttonHeld(input, shotButton(currentMoveset(state.stats)));
}

/** 派生の入力列に積む。長さは chainMaxInputs まで */
function logButton(p: Player, button: ButtonKey): void {
  const a = p.attack;
  a.inputs.push(button);
  if (a.inputs.length > WEAPON.chainMaxInputs) a.inputs.shift();
  a.inputTimer = WEAPON.chainWindow;
}

/** 入力列が途切れた（窓が切れて振っていない）ら捨てる */
function tickButtonChain(p: Player, dt: number): void {
  const a = p.attack;
  a.inputTimer = Math.max(0, a.inputTimer - dt);
  if (a.inputTimer === 0 && a.phase === "none" && !a.charging) a.inputs.length = 0;
}

/** 近接を出せない状態（不殺・祝福の制限・ダッシュ中） */
function meleeBlocked(state: GameState): boolean {
  return hasKeystone(state, KS.pacifist) || boonBlocksMelee(state) || isDashing(state.player);
}

/**
 * 入力列の末尾が派生に一致したら派生を出す（振っている最中なら今の振りの後に予約）。出したら true。
 * JUST 回避カウンターの受付中は見切り斬りを優先する
 */
function tryBranch(state: GameState, moveset: MovesetDef): boolean {
  const p = state.player;
  const index = matchBranch(moveset, p.attack.inputs);
  if (index === undefined || meleeBlocked(state) || p.justCounterTimer > 0) return false;
  cancelCharge(p);
  if (p.attack.phase === "none") startBranch(state, index);
  else p.attack.pendingBranch = index;
  return true;
}

/** 怯み中はスキルの発動入力だけを消す。CD やチャージの経過は updateSkills に進めさせる */
function withoutSkillInput(input: FrameInput): FrameInput {
  return {
    ...input,
    skill1Pressed: false,
    skill2Pressed: false,
    skill3Pressed: false,
    skill4Pressed: false,
    skill1Held: false,
    skill2Held: false,
    skill3Held: false,
    skill4Held: false,
  };
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
  tickButtonChain(p, dt);
  tickTriggerCooldowns(state, dt);
  tickHpRegen(state, dt);
  if (p.dashTimer > 0) {
    p.dashTimer = Math.max(0, p.dashTimer - dt);
    // ダッシュが終わった直後、猶予ぶんの無敵を残す
    if (p.dashTimer === 0) {
      p.invulnTimer = Math.max(p.invulnTimer, PLAYER.dash.graceInvuln);
      onBoonDashEnd(state);
      pushPlayerEvent(state, "onDashEnd", "dash");
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

function tryDash(state: GameState, input: FrameInput): void {
  const p = state.player;
  if (p.dashChargesLeft <= 0 || isDashing(p)) return;
  p.dashChargesLeft -= 1;
  if (p.dashCooldown <= 0) p.dashCooldown = dashCooldownTime(state.stats);
  if (tryDashGuard(state)) return;
  p.dashDir = isZero(input.move) ? { ...p.facing } : normalize(input.move);
  p.facing = { ...p.dashDir };
  p.knock = { x: 0, y: 0 };
  // ダッシュで攻撃・溜め・予約した派生をキャンセルできる（手触り重視）
  cancelAttack(state);
  cancelCharge(p);
  p.attack.pendingBranch = -1;
  spawnBurst(state, p.body.pos, "#ffffff", 6, 40, 0.2, 1.5);
  pushSfx(state, "dash");

  if (hasKeystone(state, KS.blink)) {
    blink(state);
  } else {
    const time = dashTime(state.stats);
    p.dashTimer = time;
    // 無敵はダッシュの前半だけ。後半は被弾するので、ダッシュを押すタイミングが問われる
    p.invulnTimer = Math.max(p.invulnTimer, Math.min(time, PLAYER.dash.invulnTime));
    p.dodgedThisDash = false;
  }
  onBoonDash(state);
  fireTrigger(state, "onDash", { pos: { ...p.body.pos } });
  pushPlayerEvent(state, "onDash", "dash");
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
    const staggerMul = isPlayerStaggered(p) ? PLAYER.staggerMoveMul : 1;
    const moveset = currentMoveset(state.stats);
    const chargeMul = p.attack.charging ? (moveset.charge?.moveMul ?? 1) : 1;
    const attackMul =
      (isAttacking(p) ? moveset.attackMoveMul : 1) *
      chargeMul *
      skillMoveMul(state) *
      boonMoveMul(state) *
      staggerMul *
      playerStatusMoveMul(state);
    const buffMul = p.buffs.speed.time > 0 ? p.buffs.speed.mul : 1;
    vel = scale(input.move, PLAYER.speed * state.stats.moveSpeedMul * attackMul * buffMul);
    // 氷床の上は慣性で滑る（src/system/terrain.ts）
    vel = terrainSlide(state, p.body.pos, p.body.vel, vel, dt);
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
    pushPlayerEvent(state, "onDashEnd", "dash");
  }
  // 壁に止められた軸の速度は残さない（氷床の滑りが前の速度を引き継ぐので、壁へ押し付けた速度が溜まらないように）
  p.body.vel = { x: hit.hitX ? 0 : vel.x, y: hit.hitY ? 0 : vel.y };
  if (!isZero(input.move) && !isDashing(p)) p.walkTime += dt;
}

/** 近接の連撃ボタン。charge は押したボタンが「溜め」の役割か */
function tryAttack(state: GameState, charge = false): void {
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
    // 溜めのある武器種は押した瞬間には振らず、離したときに段で決める（updateCharge）
    if (charge && currentMoveset(state.stats).charge) {
      // 押し直し（連打）で溜めを最初からにしない
      if (!a.charging) beginCharge(p);
      return;
    }
    startNextSwing(state);
    return;
  }
  // recover / active 中なら先行入力として次段を予約
  if (a.phase === "recover" || a.phase === "active") a.buffered = true;
}

/** 次の段を振る。突進斬り直後は 2 段目から */
function startNextSwing(state: GameState): void {
  startSwing(state, consumeLungeCombo(state) ? LUNGE_FOLLOW_COMBO : state.player.attack.step);
}

function beginCharge(p: Player): void {
  p.attack.charging = true;
  p.attack.chargeTime = 0;
}

function cancelCharge(p: Player): void {
  p.attack.charging = false;
  p.attack.chargeTime = 0;
}

/**
 * 近接の溜め（大剣）。押している間は秒数を積み、離したら段に応じて振る。
 * 段に届かずに離せば通常の段（tap は普通の連撃になる）。怯み・ダッシュ・スキルの硬直で溜めは消える
 */
function updateCharge(state: GameState, input: FrameInput, dt: number): void {
  const p = state.player;
  const a = p.attack;
  if (!a.charging) return;
  const charge = currentMoveset(state.stats).charge;
  if (!charge || isPlayerStaggered(p) || isDashing(p) || skillLocksAttack(state) || isAttacking(p)) {
    cancelCharge(p);
    return;
  }
  if (buttonHeld(input, meleeButton(currentMoveset(state.stats)))) {
    const before = chargeLevelAt(charge.levels, a.chargeTime);
    a.chargeTime += dt;
    const after = chargeLevelAt(charge.levels, a.chargeTime);
    if (after > before) onChargeLevelUp(state, after);
    return;
  }
  const level = chargeLevelAt(charge.levels, a.chargeTime);
  cancelCharge(p);
  if (level === 0) startNextSwing(state);
  else startSwing(state, 0, false, level);
}

/** 溜めの段が上がった合図（音と色の粒）。離すタイミングを目と耳で計れるように */
function onChargeLevelUp(state: GameState, level: number): void {
  const color = WEAPON.chargeRingColors[level] ?? WEAPON.chargeRingColors[0];
  spawnBurst(state, state.player.body.pos, color, CHARGE_LEVEL_PARTICLES, 70, 0.2, 1.5);
  pushSfx(state, "chargeLevel");
}

/** 溜めの段（0 = 段なし）。描画の環に使う */
export function meleeChargeLevel(state: GameState): number {
  const a = state.player.attack;
  const charge = currentMoveset(state.stats).charge;
  if (!a.charging || !charge) return 0;
  return chargeLevelAt(charge.levels, a.chargeTime);
}

/** チャージ射撃の段（0 = 段なし）。描画の環に使う */
export function shotChargeLevel(state: GameState): number {
  const p = state.player;
  const charge = currentShot(state.stats).charge;
  if (!p.shotCharging || !charge) return 0;
  return chargeLevelAt(charge.levels, p.shotChargeTime);
}

/**
 * 振り始め。requested は武器種の段。祝福には段数を丸めた combo（hookCombo）を渡し、
 * 「常に最終段から」の祝福が最終段を返したら武器種の最終段を振る
 */
function startSwing(state: GameState, requested: number, dashStrike = false, chargeLevel = 0): void {
  const moveset = currentMoveset(state.stats);
  const requestedCombo = chargeLevel > 0 ? FINISHER_COMBO : hookCombo(moveset, requested);
  const combo = boonSwingCombo(state, requestedCombo, dashStrike);
  const finisherForced = !dashStrike && chargeLevel === 0 && combo === FINISHER_COMBO;
  const stepIndex = finisherForced ? moveset.steps.length - 1 : requested;
  beginSwing(state, { step: stepIndex, dashStrike, chargeLevel, branch: -1, combo });
}

/**
 * コンボ派生を振る。フィニッシュ（next なし）は祝福に最終段として渡し、
 * 連撃が続く派生（踏み込み斬りなど）は 1 段目として渡す
 */
function startBranch(state: GameState, index: number): void {
  const branch = currentMoveset(state.stats).branches[index];
  if (!branch) return;
  const combo = branch.next === undefined ? FINISHER_COMBO : 0;
  beginSwing(state, { step: state.player.attack.step, dashStrike: false, chargeLevel: 0, branch: index, combo });
}

interface SwingSpec {
  step: number;
  dashStrike: boolean;
  chargeLevel: number;
  branch: number;
  combo: number;
}

function beginSwing(state: GameState, spec: SwingSpec): void {
  const p = state.player;
  const step = meleeStep(actionStats(state), spec.step, spec.dashStrike, spec.chargeLevel, spec.branch);
  if (!step) return;
  const a = p.attack;
  p.dashStrike = spec.dashStrike;
  a.combo = spec.combo;
  a.step = spec.step;
  a.chargeLevel = spec.chargeLevel;
  a.branch = spec.branch;
  a.pendingBranch = -1;
  a.phase = "windup";
  a.timer = step.windup;
  a.buffered = false;
  a.hitIds.clear();
  a.hitTick = 0;
  a.dir = { ...p.facing };
  const sfx = SLASH_SFX[spec.combo];
  if (sfx) pushSfx(state, sfx);
  payOverclock(state, PLAYER.overclockHpCost);
  onBoonSwing(state, spec.combo, spec.dashStrike, step.damage);
}

function updateAttack(state: GameState, dt: number): void {
  const p = state.player;
  const a = p.attack;
  if (a.phase === "none") return;
  const step = meleeStep(actionStats(state), a.step, p.dashStrike, a.chargeLevel, a.branch);
  if (!step) {
    cancelAttack(state);
    return;
  }

  applyLunge(state, step, dt);
  a.timer -= dt;
  if (a.phase === "active") {
    advanceHitTick(p, step);
    resolveMeleeHits(state, step);
  }

  if (a.timer > 0) return;
  switch (a.phase) {
    case "windup":
      a.phase = "active";
      a.timer = step.active;
      spawnTrail(state, step);
      break;
    case "active":
      a.phase = "recover";
      a.timer = step.recover;
      break;
    case "recover":
      endSwing(state);
      break;
  }
}

/** recover の終わり: 予約した派生 → 先行入力の次段 → 連撃の終わり の順に決める */
function endSwing(state: GameState): void {
  const p = state.player;
  const a = p.attack;
  const moveset = currentMoveset(state.stats);
  if (a.pendingBranch >= 0) {
    startBranch(state, a.pendingBranch);
    return;
  }
  const next = nextStepAfter(moveset, a, p.dashStrike);
  if (a.buffered && next !== undefined) {
    startSwing(state, next);
    return;
  }
  a.phase = "none";
  a.combo = 0;
  a.step = 0;
  a.chargeLevel = 0;
  a.branch = -1;
  a.buffered = false;
  p.dashStrike = false;
  if (next !== undefined) return;
  // 最終段・フィニッシュの後は少し間を置き、派生の入力列もここで終わる
  p.shootCooldown = Math.max(p.shootCooldown, PLAYER.comboLockout);
  a.inputs.length = 0;
}

/** 今の振りの後に続けられる段。フィニッシュ・溜め攻撃・最終段なら undefined */
function nextStepAfter(moveset: MovesetDef, a: Player["attack"], dashStrike: boolean): number | undefined {
  if (a.chargeLevel > 0) return undefined;
  if (a.branch >= 0 && !dashStrike) return moveset.branches[a.branch]?.next;
  const next = a.step + 1;
  return next < moveset.steps.length ? next : undefined;
}

/** 踏み込み: windup + active の間に lunge だけ前へ進む（壁の手前で止まる） */
function applyLunge(state: GameState, step: Readonly<MeleeStep>, dt: number): void {
  const p = state.player;
  if (step.lunge <= 0 || (p.attack.phase !== "windup" && p.attack.phase !== "active")) return;
  const total = step.windup + step.active;
  if (total <= 0) return;
  const d = (step.lunge * dt) / total;
  moveBody(state, p.body, p.attack.dir.x * d, p.attack.dir.y * d);
}

/** 多段ヒット: active を hits 等分し、区切りを越えたら当てた敵を忘れてもう一度当てられるようにする */
function advanceHitTick(p: Player, step: Readonly<MeleeStep>): void {
  if (step.hits <= 1 || step.active <= 0) return;
  const a = p.attack;
  const elapsed = step.active - a.timer;
  const tick = Math.min(step.hits - 1, Math.floor(elapsed / (step.active / step.hits)));
  if (tick <= a.hitTick) return;
  a.hitTick = tick;
  a.hitIds.clear();
}

/** 残像: 振りの形に沿った線を短く残す（見た目だけ。乱数を使わない） */
function spawnTrail(state: GameState, step: Readonly<MeleeStep>): void {
  if (!step.trail) return;
  const p = state.player;
  const origin = p.body.pos;
  const base = angle(p.attack.dir);
  const len = step.shape.kind === "box" || step.shape.kind === "circle" ? step.reach + step.size / 2 : step.reach;
  const half = step.shape.kind === "arc" ? (step.shape.deg * DEG_TO_RAD) / 2 : 0;
  const angles = half > 0 ? [base - half, base, base + half] : [base];
  for (const a of angles) spawnLine(state, origin, add(origin, scale(fromAngle(a), len)), step.trail, WEAPON.trailLife);
}

export function meleeBox(p: Player, reach: number, size: number): Box {
  const c = add(p.body.pos, scale(p.attack.dir, reach));
  return { x: c.x - size / 2, y: c.y - size / 2, w: size, h: size };
}

/** 近接の当たり方。tip は突きの先端（穂先・鞭の先） */
export type MeleeContact = "none" | "hit" | "tip";

/** 円（敵・弾）が今の振りの形に入っているか。形ごとの reach / size の意味は HitShape を参照 */
export function meleeContact(p: Player, step: Readonly<MeleeStep>, pos: Vec, radius: number): MeleeContact {
  const origin = p.body.pos;
  const dir = p.attack.dir;
  switch (step.shape.kind) {
    case "box":
      return boxCircleOverlap(meleeBox(p, step.reach, step.size), pos.x, pos.y, radius) ? "hit" : "none";
    case "circle": {
      const c = add(origin, scale(dir, step.reach));
      return circlesOverlap(c.x, c.y, step.size / 2, pos.x, pos.y, radius) ? "hit" : "none";
    }
    case "arc":
      return arcContains(origin, dir, step.reach, step.shape.deg, pos, radius) ? "hit" : "none";
    case "thrust":
      return thrustContact(origin, dir, step, pos, radius);
  }
}

/** 扇: 半径 reach、中心角 deg。円の半径ぶん角度の許容を広げる */
function arcContains(origin: Vec, dir: Vec, reach: number, deg: number, pos: Vec, radius: number): boolean {
  const rel = sub(pos, origin);
  const d = length(rel);
  if (d > reach + radius) return false;
  if (d <= radius) return true;
  const diff = Math.abs(normalizeAngle(angle(rel) - angle(dir)));
  const slack = Math.asin(Math.min(1, radius / d));
  return diff <= (deg * DEG_TO_RAD) / 2 + slack;
}

function normalizeAngle(a: number): number {
  let r = a % FULL_TURN;
  if (r > Math.PI) r -= FULL_TURN;
  if (r < -Math.PI) r += FULL_TURN;
  return r;
}

/** 突き: 攻撃方向へ長さ reach・幅 size の帯。先端 tip.ratio に入れば tip */
function thrustContact(origin: Vec, dir: Vec, step: Readonly<MeleeStep>, pos: Vec, radius: number): MeleeContact {
  const rel = sub(pos, origin);
  const along = rel.x * dir.x + rel.y * dir.y;
  const across = Math.abs(rel.x * dir.y - rel.y * dir.x);
  if (along < -radius || along > step.reach + radius) return "none";
  if (across > step.size / 2 + radius) return "none";
  if (!step.tip) return "hit";
  return along + radius >= step.reach * (1 - step.tip.ratio) ? "tip" : "hit";
}

/** 描画用: 振りの形の中心と大きさ（斬撃スプライトを置く位置） */
export function meleeAnchor(p: Player, step: Readonly<MeleeStep>): { pos: Vec; size: number } {
  const dir = p.attack.dir;
  switch (step.shape.kind) {
    case "box":
    case "circle":
      return { pos: add(p.body.pos, scale(dir, step.reach)), size: step.size };
    case "arc":
      return { pos: add(p.body.pos, scale(dir, step.reach / 2)), size: step.reach * 2 };
    case "thrust":
      return { pos: add(p.body.pos, scale(dir, step.reach / 2)), size: step.reach };
  }
}

function resolveMeleeHits(state: GameState, step: MeleeStep): void {
  const p = state.player;
  for (const e of state.enemies) {
    if (p.attack.hitIds.has(e.id) || e.hp <= 0) continue;
    const contact = meleeContact(p, step, e.body.pos, e.body.radius);
    if (contact === "none") continue;
    p.attack.hitIds.add(e.id);
    meleeHitEnemy(state, e, step, contact === "tip");
  }
  resolveMeleeBullets(state, step);
}

/**
 * 近接の active と敵弾。デフォルトでは素通りする（docs/COMBAT_DESIGN.md C-1 の 5 / 6）。
 * 祝福「弾返し」なら撃ち返し、性質「弾斬り」なら消す。両方あれば撃ち返しを優先する
 */
function resolveMeleeBullets(state: GameState, step: MeleeStep): void {
  const reflect = hasBoon(state, "reflect");
  if (!reflect && state.stats.bulletCut <= 0) return;
  for (const pr of state.projectiles) {
    if (pr.owner !== "enemy" || pr.life <= 0) continue;
    if (meleeContact(state.player, step, pr.pos, pr.radius) === "none") continue;
    if (reflect) reflectProjectile(state, pr);
    else cutProjectile(state, pr);
  }
}

/** 近接 1 ヒット。敵の windup 中ならカウンターヒット。tip は突きの先端に当たった */
function meleeHitEnemy(state: GameState, e: Enemy, step: MeleeStep, tip = false): void {
  const p = state.player;
  const counter = isCounterable(e) || boonCounterable(state, e);
  const tipMul = tipMultipliers(step, tip);
  // 霊刃（spiritBlade）: 通常攻撃に霊力の係数が加わる
  const out = rollOutgoing(state, e, (step.damage + boonNormalAttackBonus(state)) * tipMul.damage, "melee");
  const amount = counter ? Math.round(out.amount * ACTION.counter.damageMul) : out.amount;
  const baseHitstop = step.hitstop ?? (step.heavy ? FEEL.hitstopHeavy : FEEL.hitstopLight);
  if (step.shake > 0) shake(state, step.shake);
  const pos = { ...e.body.pos };
  if (step.heavy) e.wallSplat = true;
  damageEnemy(state, e, amount, knockDirection(p, e, step), step.knockback, {
    poise: counterPoise(step, counter) * tipMul.poise,
    hitstopSteps: baseHitstop + (counter ? ACTION.counter.hitstopBonus : 0),
    buildsEnergy: true,
    kind: "melee",
    crit: out.crit,
    guardBreak: counter,
  });
  if (counter) showCounter(state, pos);
  if (counter) onTraitCounter(state, e);
  if (counter) pushEvent(state, { kind: "onCounter", actor: "player", source: { kind: "player", key: "counter" }, ...enemyTarget(e) });
  gainMeleeMana(state, step.mana * tipMul.mana, counter);
  p.meleeHitCount += 1;
  fireTrigger(state, "onMeleeHit", { pos, targetId: e.id });
  fireTrigger(state, "everyNthMeleeHit", { pos, targetId: e.id });
  onBoonMeleeHit(state, e, counter);
  onSkillMeleeHit(state, e, p.attack.combo);
}

/** 先端判定の倍率。先端判定を持たない段は等倍 */
function tipMultipliers(step: Readonly<MeleeStep>, tip: boolean): { damage: number; poise: number; mana: number } {
  const t = step.tip;
  if (!t) return { damage: 1, poise: 1, mana: 1 };
  if (tip) return { damage: t.damageMul, poise: t.poiseMul, mana: t.manaMul };
  return { damage: t.offDamageMul, poise: 1, mana: t.offManaMul };
}

/** ノックバックの向き。引き寄せ（鎌）は自分の方へ、投げ（拳）は自分の背後へ */
function knockDirection(p: Player, e: Enemy, step: Readonly<MeleeStep>): Vec {
  if (step.pull) return normalize(sub(p.body.pos, e.body.pos), scale(p.attack.dir, -1));
  if (step.throw) return scale(p.attack.dir, -1);
  return p.attack.dir;
}

/**
 * 近接命中のマナ回収（docs/COMBAT_DESIGN.md B-1）。段ごとの量、ダッシュ攻撃は別枠、カウンターなら倍。
 * 1 振りで回収する敵は meleeTargetCap 体まで（群れを薙いで一気に満タンにしない）
 */
function gainMeleeMana(state: GameState, base: number, counter: boolean): void {
  if (state.player.attack.hitIds.size > MANA.meleeTargetCap) return;
  // 静寂の誓い（ks_silentVow）では通常攻撃からマナが戻らない
  const mul = counter ? MANA.onCounterMul : 1;
  gainAttackMana(state, base * mul, attackManaMul(state) * boonAttackManaMul(state));
}

/** 近接 1 ヒットの怯み値。カウンターは確定の怯みではなく怯み値を倍にする（敵の強靭 ×0.5 と相殺して等倍になる） */
export function counterPoise(step: Readonly<MeleeStep>, counter: boolean): number {
  return counter ? step.poise * ACTION.counter.poiseMul : step.poise;
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
  gainEnergy(state, r.energy * BOON.parryEnergyMul);
  addFloatingText(state, pr.pos, r.text, r.color, r.textScale, r.textLife);
  spawnBurst(state, pr.pos, r.color, r.particles, 100, 0.25, 1.5);
  pushSfx(state, "reflect");
}

/** 性質「弾斬り」: 敵弾を斬って消す（撃ち返しはしない） */
function cutProjectile(state: GameState, pr: Projectile): void {
  const c = ACTION.bulletCut;
  pr.life = 0;
  spawnBurst(state, pr.pos, c.color, c.particles, 80, 0.2, 1.5);
}

/** 祝福「見切り斬り」: JUST 回避直後の攻撃で回避した敵の手前へ瞬間移動して重い一撃。出したら true */
function tryJustCounter(state: GameState): boolean {
  const p = state.player;
  if (!hasBoon(state, "justSlash")) return false;
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

  // 見た目は最終段の振り。対象にはここで当てるので hitIds に入れて二重ヒットを防ぐ
  const lastStep = currentMoveset(state.stats).steps.length - 1;
  startSwing(state, lastStep);
  p.attack.dir = { ...dir };
  p.attack.hitIds.add(target.id);
  const step = meleeStep(actionStats(state), lastStep);
  if (!step) return;
  const out = rollOutgoing(state, target, step.damage, "melee");
  const hitPos = { ...target.body.pos };
  target.wallSplat = true;
  damageEnemy(state, target, Math.round(out.amount * j.damageMul), dir, step.knockback, {
    poise: j.poise * state.stats.poiseDamageMul,
    hitstopSteps: FEEL.hitstopHeavy + j.hitstopBonus,
    buildsEnergy: true,
    kind: "melee",
    crit: out.crit,
    guardBreak: true,
  });
  gainMeleeMana(state, step.mana, false);
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
  if (hasKeystone(state, KS.pacifist) || skillLocksAttack(state) || isPlayerStaggered(p)) return;
  cancelAttack(state);
  startSwing(state, 0, true);
}

/** n 発を扇状に並べた角度オフセット（ラジアン）。1 発なら [0]。間隔は射撃の型ごと（既定は PLAYER.projectileSpreadDeg） */
export function spreadOffsets(count: number, spreadDeg: number = PLAYER.projectileSpreadDeg): number[] {
  const step = spreadDeg * DEG_TO_RAD;
  const center = (count - 1) / 2;
  return Array.from({ length: count }, (_, i) => (i - center) * step);
}

/**
 * 射撃の入力。held は怯み・スキル硬直を除いた「撃てる押しっぱなし」。
 * チャージの型は押している間溜め、離したときに撃つ。それ以外は押している間撃ち続ける
 */
function updateShooting(state: GameState, held: boolean, dt: number): void {
  const shot = currentShot(state.stats);
  if (shot.charge) {
    updateShotCharge(state, shot, held, dt);
    return;
  }
  cancelShotCharge(state.player);
  if (held) tryShoot(state);
}

function cancelShotCharge(p: Player): void {
  p.shotCharging = false;
  p.shotChargeTime = 0;
}

function updateShotCharge(state: GameState, shot: ShotDef, held: boolean, dt: number): void {
  const p = state.player;
  const levels = shot.charge?.levels ?? [];
  if (held) {
    if (!p.shotCharging) {
      if (!canShootNow(state) || blockedByBladeOath(state)) return;
      p.shotCharging = true;
      p.shotChargeTime = 0;
      return;
    }
    const before = chargeLevelAt(levels, p.shotChargeTime);
    p.shotChargeTime += dt;
    const after = chargeLevelAt(levels, p.shotChargeTime);
    if (after > before) onChargeLevelUp(state, after);
    return;
  }
  if (!p.shotCharging) return;
  const level = chargeLevelAt(levels, p.shotChargeTime);
  cancelShotCharge(p);
  // 溜めている間に振り始めた・ダッシュしたなどで撃てなくなっていたら溜めを捨てる
  if (!canShootNow(state)) return;
  fireVolley(state, level);
}

/** 射撃できる状態か（再使用待ち・近接中・溜め中・ダッシュ中・祝福の制限） */
function canShootNow(state: GameState): boolean {
  const p = state.player;
  if (p.shootCooldown > 0 || isAttacking(p) || p.attack.charging) return false;
  if (isDashing(p) && !canShootWhileDashing(state)) return false;
  return !boonBlocksShoot(state);
}

/** ks_bladeOath: 撃てないことを浮き文字で伝える。撃てなければ true */
function blockedByBladeOath(state: GameState): boolean {
  if (!hasKeystone(state, KS.bladeOath)) return false;
  const p = state.player;
  addFloatingText(state, p.body.pos, KEYSTONE_NAME[KS.bladeOath] ?? KS.bladeOath, PACIFIST_COLOR, 0.9, 0.4);
  p.shootCooldown = BLADE_OATH_TEXT_INTERVAL;
  return true;
}

function tryShoot(state: GameState): void {
  if (!canShootNow(state)) return;
  if (blockedByBladeOath(state)) return;
  fireVolley(state, 0);
}

/** 1 回の射撃で出す弾の形（射撃の型 × 溜めの段 × 装備） */
interface VolleySpec {
  damage: number;
  poise: number;
  radius: number;
  pierce: number;
  speed: number;
  life: number;
  count: number;
  color: string;
}

function volleySpec(state: GameState, shot: ShotDef, level: number): VolleySpec {
  const s = state.stats;
  const charged = level > 0 ? shot.charge?.levels[level - 1] : undefined;
  const damageMul = charged?.damageMul ?? shot.damageMul;
  return {
    damage: shotDamage(s) * damageMul + boonNormalAttackBonus(state),
    poise: PLAYER.shoot.poise * (charged?.poiseMul ?? shot.poiseMul) * s.poiseDamageMul,
    radius: charged?.radius ?? shot.radius,
    pierce: s.pierce + shot.pierceBonus + (charged?.pierceBonus ?? 0),
    speed: PLAYER.shoot.speed * shot.speedMul * s.projectileSpeedMul,
    life: shot.mine ? shot.mine.fuse : PLAYER.shoot.life * shot.lifeMul,
    count: s.projectileCount + shot.pellets,
    color: shot.mine?.color ?? (level > 0 ? (WEAPON.chargeRingColors[level] ?? BULLET_COLOR) : BULLET_COLOR),
  };
}

/** 連射の弾筋の揺れ（ラジアン）。乱数ではなくゲーム内時間の正弦で決める（決定性） */
function swayOffset(state: GameState, shot: ShotDef): number {
  if (!shot.sway) return 0;
  return Math.sin(state.time * shot.sway.freq * FULL_TURN) * shot.sway.deg * DEG_TO_RAD;
}

/** 弾ごとの型の作業領域。単発は持たない（従来の弾と同じ形のまま） */
function shotRuntime(shot: ShotDef): ShotRuntime | undefined {
  if (shot.key === "single") return undefined;
  return { key: shot.key, bouncesLeft: shot.bounce?.count };
}

function fireVolley(state: GameState, level: number): void {
  const p = state.player;
  const s = state.stats;
  const shot = currentShot(s);
  p.shootCooldown = (PLAYER.shoot.cooldown * shot.cooldownMul) / (s.fireRateMul * frenzyMul(state));
  const dir = { ...p.facing };
  const muzzle = add(p.body.pos, scale(dir, p.body.radius + 2));
  const baseAngle = angle(dir) + swayOffset(state, shot);
  const spec = volleySpec(state, shot, level);
  const firstShot = state.projectiles.length;
  for (const offset of spreadOffsets(spec.count, shot.spreadDeg)) {
    const runtime = shotRuntime(shot);
    state.projectiles.push({
      id: allocId(state),
      owner: "player",
      pos: { ...muzzle },
      vel: scale(fromAngle(baseAngle + offset), spec.speed),
      radius: spec.radius,
      damage: spec.damage,
      life: spec.life,
      color: spec.color,
      kind: "ranged",
      hitIds: new Set(),
      pierceLeft: spec.pierce,
      poise: spec.poise,
      ...(runtime ? { shot: runtime } : {}),
    });
  }
  onBoonShoot(state, state.projectiles.slice(firstShot));
  p.knock = add(p.knock, scale(dir, -PLAYER.shoot.recoil * shot.recoilMul));
  spawnBurst(state, muzzle, spec.color, 3, 60, 0.12, 1.5);
  shake(state, 1);
  pushSfx(state, "shoot");
  payOverclockShoot(state);
  fireTrigger(state, "onShoot", { pos: muzzle });
  pushPlayerEvent(state, "onShoot", "ranged", { pos: { ...muzzle } });
  onSkillPlayerShoot(state);
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
  const damage = burstDamage(s);
  const poise = PLAYER.special.poise * s.poiseDamageMul;
  const knockback = PLAYER.special.knockback * s.knockbackMul;
  let kills = 0;
  for (const e of state.enemies) {
    if (!circlesOverlap(p.body.pos.x, p.body.pos.y, radius, e.body.pos.x, e.body.pos.y, e.body.radius)) continue;
    const dir = normalize(sub(e.body.pos, p.body.pos));
    const out = rollOutgoing(state, e, damage, "proc", { attack: BURST_ATTACK });
    if (damageEnemy(state, e, out.amount, dir, knockback, { poise, hitstopSteps: FEEL.hitstopHeavy })) kills += 1;
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
  p.invulnTimer = Math.max(p.invulnTimer, PLAYER.special.invuln);
  pushSfx(state, "burst");
  onBoonBurstKills(state, kills);
  pushPlayerEvent(state, "onBurst", "burst");
  return true;
}
