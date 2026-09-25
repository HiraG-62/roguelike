import type { FrameInput } from "../core/input";
import { type Enemy, type GameState, type Player, type Projectile, allocId, pushSfx } from "../core/state";
import { type Vec, add, dist, fromAngle, angle, isZero, normalize, scale, sub, length } from "../core/vec";
import { screenToWorld } from "../core/view";
import type { SfxName } from "../audio/sfxNames";
import { ACTION, BOON, FEEL, KEYSTONE, MANA, PLAYER, WEAPON } from "../data/tuning";
import {
  type ButtonKey,
  type HitShape,
  type MeleeStepDef,
  type MovesetDef,
  type BulletDef,
  type ShotRuntime,
  type TipDef,
  type CastDef,
  type MeleeChargeDef,
  MOVESETS,
  chargeButton,
  bulletFeatures,
  chargeLevelAt,
  isGun,
  laneLength,
  laneSwing,
  matchBranch,
  meleeChargeOf,
  withExtraBranch,
} from "../data/weapons";
import type { AttackProfile } from "../core/element";
import { type JobKey, jobBranch } from "../data/jobs";
import { DEFAULT_STATS, createLootRuntime, type PlayerStats, type Scaling } from "../loot/types";
import { cancelAttack, damageEnemy, gainEnergy, meleeHitEnergy, rollOutgoing, shotHitEnergy, tickHpRegen, tickRegain } from "./combat";
import { addFloatingText, shake, spawnBurst, spawnLine } from "./effects";
import { chargeUpFx, onSwingFx, shotSfxName } from "./effects";
import { type HitWeight, hitFamily } from "./effects";
import { currentBullet } from "../loot/bullets";
import { KS, attackManaMul, hasKeystone, payOverclock, payOverclockShoot } from "./keystones";
import { type Box, boxCircleOverlap, circlesOverlap, moveBody } from "./physics";
import { applyStatus, explodeAt, hasStatus, playerStatusMoveMul } from "./statusEffects";
import { terrainSlide } from "./terrain";
import { addRunAttributes, deriveAttributes, scaled, withRatio } from "./attributes";
import { applyRunStats } from "./runSetup";
import { gainAttackMana } from "./mana";
import { type StatusApply, createStatusBag } from "../core/status";
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
import { enemyTarget, pushEvent, pushPlayerEvent, pushSwingEvent, pushSwingHitEvent } from "../core/events";
import { onTraitCounter } from "./traitHooks";
import {
  boonAttackManaMul,
  boonMoveMul,
  boonNormalAttackBonus,
  boonSwingCombo,
  canShootWhileDashing,
  foldBoonStats,
  hasBoon,
  onBoonDash,
  onBoonDashEnd,
  onBoonMeleeHit,
  onBoonShoot,
  onBoonSwing,
  tryDashGuard,
} from "./boons";
import { boonCounterable, onBoonShootInput } from "./boonRules";
import { onShapeMeleeHit, shapeButtonPress, shapeLocksShot, shapeMoveset, shrugStagger } from "../skills/forms";
import {
  actionCooldownLeft,
  artLocksActions,
  artMoveMul,
  emitArtVolley,
  endArtHold,
  finishArtHold,
  isInstantStep,
  onBranchStart,
  onLaneSwingStart,
  startLaneArt,
  updateArt,
} from "./weaponArts";
import { createUltimateState, tryUltimate, ultimateFireRateMul, ultimateMoveMul, ultimateMoveset, ultimateShot, updateUltimate, endUltimate } from "./ultimates";
import { ultimateOnSwing, ultimateOnSwingHit } from "./ultimates";

const KNOCK_DECAY = 14;
const KNOCK_MIN = 2;
const BULLET_COLOR = "#a0e0ff";
/** 発射の粒の既定数（弾の look.particles で上書き） */
const MUZZLE_PARTICLES = 3;
const DEG_TO_RAD = Math.PI / 180;
const SLASH_SFX: readonly SfxName[] = ["slash1", "slash2", "slash3"];
/** 溜め中の回しの 1 打ち（1 段目の振りと同じ軽い音） */
const SPIN_SFX: SfxName = "slash1";
/** 装備変更で HP 割合を維持するときの生存中の下限 */
const MIN_ALIVE_HP = 1;
/** 突進斬りから繋がる近接の段（0 始まり） */
const LUNGE_FOLLOW_COMBO = 1;
/** 祝福・スキルが「最終段」として読む combo（剣の 3 段目と同じ 2） */
const FINISHER_COMBO = PLAYER.melee.length - 1;
const FULL_TURN = Math.PI * 2;
/** 溜めの段が上がったときの粒 */
const CHARGE_LEVEL_PARTICLES = 8;
/** 周回の弾の位相をずらす角（黄金角。何発目でも輪の上に偏りなく散らばる） */
const ORBIT_GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** 三点の間隔の比較の許容（dt の足し引きの丸め誤差で 1 ステップ遅れないように） */
const BURST_EPSILON = 1e-6;

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
      lane: "primary",
      bufferedLane: "primary",
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
    shotBurst: { left: 0, timer: 0, side: 1 },
    swingImpact: 0,
    art: { cooldown: 0, holding: false, holdTime: 0, recover: 0, cooldowns: new Map() },
    ultimate: createUltimateState(),
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
  // 武器種が変わったら持続の奥義を終える（別の武器種の型に同じ差し替えを畳まない）
  const movesetChanged = state.stats.moveset !== stats.moveset;
  state.stats = stats;
  if (movesetChanged) endUltimate(state, "manual");
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
  /** 命中した敵に付ける状態異常（無ければ空） */
  applies: readonly StatusApply[];
  /** recover のキャンセル猶予（省略は PLAYER.recoverCancel。docs/ideas/combat-feel-design.md D-4） */
  cancel?: number;
  /** 振り始めから付く無敵（秒。0 なら無し） */
  invuln: number;
  /** active に入った瞬間に撃つ弾（MeleeStepDef.cast） */
  cast?: CastDef;
  /** 弾返し・弾斬りが無くても敵弾を消す（MeleeStepDef.cutsBullets） */
  cutsBullets: boolean;
}

/** 装備中の武器種。武器なしは剣 */
export function currentMoveset(stats: Readonly<PlayerStats>): MovesetDef {
  // 旧形式の stats（moveset を持たない）でも落ちないよう既定へ
  return MOVESETS[stats.moveset] ?? MOVESETS.sword;
}

/**
 * いま振る近接の型。狼化・鉄塊化の最中は変身の型（skills/forms.ts）、それ以外は装備の武器種に
 * 持続の奥義の差し替え（system/ultimates.ts）→ ジョブ固有の派生の順に重ねた型
 */
export function playerMoveset(state: GameState): MovesetDef {
  // 奥義の差し替えはジョブ派生の後に畳む（ジョブの合成の cache は武器種の key で引くので、差し替えた型を渡すと古い型が返る）
  return shapeMoveset(state) ?? ultimateMoveset(state, withJobBranch(currentMoveset(state.stats), state.job));
}

/** ジョブ × 武器種ごとの合成済みの型。毎ステップ新しいオブジェクトを作らない（中身は定義から決まるので決定性に影響しない） */
const JOB_MOVESET_CACHE = new Map<string, MovesetDef>();

/** 装備の武器種にジョブ固有の派生（data/jobs.ts の JOB_BRANCHES）を 1 本足す。見習いはそのまま */
export function withJobBranch(moveset: MovesetDef, job: JobKey): MovesetDef {
  const branch = jobBranch(job);
  if (!branch) return moveset;
  const cacheKey = `${job}:${moveset.key}`;
  const cached = JOB_MOVESET_CACHE.get(cacheKey);
  if (cached) return cached;
  const merged = withExtraBranch(moveset, branch);
  JOB_MOVESET_CACHE.set(cacheKey, merged);
  return merged;
}

/** 装備中の銃の弾（src/loot/bullets.ts）。銃なしは既定の弾 */
export function currentShot(stats: Readonly<PlayerStats>): BulletDef {
  return currentBullet(stats);
}

/**
 * 武器種の段 → 祝福・スキルに渡す combo（1 段目 0 / 途中 1 / 最終段 2）。段数が違っても最終段の祝福が最終段で出る。
 * lane は振ったレーン（右レーンの最終段も終撃）。段の無いレーン（銃の家系の左 = 反転撃ち）は連撃ではないので 0
 */
export function hookCombo(moveset: MovesetDef, step: number, lane: ButtonKey = "primary"): number {
  const length = laneLength(moveset, lane);
  if (length === 0) return 0;
  if (step >= length - 1) return FINISHER_COMBO;
  return Math.min(step, FINISHER_COMBO - 1);
}

function stepDef(moveset: MovesetDef, step: number, dashStrike: boolean, chargeLevel: number, branch: number, lane: ButtonKey): MeleeStepDef | undefined {
  if (dashStrike) return moveset.dashAttack;
  if (branch >= 0) return moveset.branches[branch]?.step;
  const charge = meleeChargeOf(moveset);
  if (chargeLevel > 0 && charge) return charge.step;
  return laneSwing(moveset, lane, step);
}

/**
 * 武器種の段に stats（ステータス・攻撃速度・リーチ・ノックバック）を掛けたもの。
 * dashStrike ならダッシュ攻撃、chargeLevel > 0 なら溜め攻撃（段の倍率を掛ける）。
 * moveset は変身で差し替えた型（省略時は装備の武器種）、lane は左（steps）/ 右（steps2 の振りの段）
 */
export function meleeStep(
  stats: Readonly<PlayerStats>,
  step: number,
  dashStrike = false,
  chargeLevel = 0,
  branch = -1,
  moveset: MovesetDef = currentMoveset(stats),
  lane: ButtonKey = "primary",
): MeleeStep | undefined {
  const base = stepDef(moveset, step, dashStrike, chargeLevel, branch, lane);
  if (!base) return undefined;
  const level = chargeLevel > 0 ? meleeChargeOf(moveset)?.levels[chargeLevel - 1] : undefined;
  return scaleStep(stats, base, moveset, level);
}

/** 段の定義に stats と溜めの段の倍率を掛ける（meleeStep と溜め中の回しが使う） */
function scaleStep(stats: Readonly<PlayerStats>, base: MeleeStepDef, moveset: MovesetDef, level?: MeleeChargeDef["levels"][number]): MeleeStep {
  const speed = stats.attackSpeedMul;
  const reachMul = stats.meleeReachMul * (level?.reachMul ?? 1);
  return {
    windup: base.windup / speed,
    active: base.active / speed,
    recover: base.recover / speed,
    damage: scaled(stats, base.scaling) * (level?.damageMul ?? 1),
    poise: withRatio(stats, base.poise, base.poiseRatio) * stats.poiseDamageMul * (level?.poiseMul ?? 1),
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
    applies: base.applies ?? [],
    cancel: base.cancel,
    invuln: base.invuln ?? 0,
    cast: base.cast,
    cutsBullets: base.cutsBullets ?? false,
  };
}

/** 今の振りの段（描画用。振っていなければ undefined） */
export function currentMeleeStep(state: GameState): MeleeStep | undefined {
  const p = state.player;
  if (!isAttacking(p)) return undefined;
  return meleeStep(state.stats, p.attack.step, p.dashStrike, p.attack.chargeLevel, p.attack.branch, playerMoveset(state), p.attack.lane);
}

/** 射撃 1 発の基礎威力（今の銃の弾の係数を評価した値。銃の弾の damageMul は含まない） */
export function shotDamage(stats: Readonly<PlayerStats>): number {
  return scaled(stats, shotScaling(stats));
}

/** 今の弾の係数表（弾が持たなければ共通の PLAYER.shoot.scaling） */
export function shotScaling(stats: Readonly<PlayerStats>): Scaling {
  return currentBullet(stats).scaling ?? PLAYER.shoot.scaling;
}

/** 射撃 1 発の怯み値（ステータスが基礎値のときの値に型の係数を足す。poiseDamageMul は含まない） */
function shotPoise(stats: Readonly<PlayerStats>, shot: Readonly<BulletDef>, poiseMul: number): number {
  return withRatio(stats, PLAYER.shoot.poise * poiseMul, shot.poiseRatio);
}

/** 怯み（被弾硬直）中か。移動が遅くなり、攻撃・射撃・ダッシュ・奥義・スキルが出せない（docs/COMBAT_DESIGN.md D-5） */
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
  // 鉄塊化は被弾硬直を受けない（敵の攻撃が付けた怯みを判定より先に外す）
  shrugStagger(state);
  const staggered = isPlayerStaggered(p);

  if (!staggered) readActions(state, input);
  updateCharge(state, input, dt);
  updateArt(state, input, dt);
  updateUltimate(state, dt);
  releaseDashAttack(state);
  updateSkills(state, staggered ? withoutSkillInput(input) : input, dt);

  updateAttack(state, dt);
  updateMovement(state, input, dt, aiming);
  const shotHeld = shotButtonHeld(state, input);
  onBoonShootInput(state, shotHeld);
  // 射撃は銃の家系だけ（docs/ideas/weapon-redesign.md 0 章）。持ち替えたら溜め撃ち・三点の残りを捨てる
  const canShoot = shotHeld && !staggered && !skillLocksAttack(state) && !artLocksActions(state);
  if (isGun(playerMoveset(state))) updateShooting(state, canShoot, dt, aimDistance(state, input));
  else resetShooting(p);
  // 右の「押した瞬間」は前フレームとの差で取る（FrameInput は押しっぱなししか持たない）
  p.secondaryWasHeld = input.shootHeld;
  if (hasKeystone(state, KS.juggernaut)) p.knock = { x: 0, y: 0 };
  trackDamageDealt(state);
}

/** ダッシュ・近接・奥義の入力を読む（怯み中は呼ばない） */
function readActions(state: GameState, input: FrameInput): void {
  if (input.dashPressed && !skillLocksDash(state)) tryDash(state, input);
  if (!skillLocksAttack(state) && !artLocksActions(state)) readAttackButtons(state, input);
  // 奥義は常にスキルをキャンセルできる
  if (input.specialPressed && tryUltimate(state)) cancelSkills(state);
}

/**
 * 左右のボタンの押した瞬間。左はアクション 1（武器種の役割: 連撃 / 溜め / 射撃）、右はアクション 2（右レーンの連撃）。
 * 段カウンタは左右で共有し、派生の入力列が先（docs/ideas/ougi-and-dual-actions.md 4.2）
 */
function readAttackButtons(state: GameState, input: FrameInput): void {
  if (input.attackPressed) onButtonPress(state, "primary");
  if (input.shootHeld && !state.player.secondaryWasHeld) onButtonPress(state, "secondary");
}

function onButtonPress(state: GameState, button: ButtonKey): void {
  // 変身が左右クリックを差し替えていれば（遠吠え・砲撃）そちらが引き受ける
  if (shapeButtonPress(state, button)) return;
  const p = state.player;
  const moveset = playerMoveset(state);
  // 振っている最中に派生を予約済みなら、その派生が出るまで次の押下は受けない（予約の上書きで列と技がずれないように）
  if (p.attack.pendingBranch >= 0 && p.attack.phase !== "none") return;
  // 再使用中の右段は何も起こさない（派生に当たる右は妨げない）
  if (button === "secondary" && laneStepBlocked(state, moveset)) return;
  // 構え中の押下は構えを解いて段を進めてから通常の流れへ（受け流し → 返し斬り / 受け流し → 左の 2 段目）
  if (p.art.holding) finishArtHold(state);
  if (tryBranch(state, moveset, button)) return;
  pressLane(state, moveset, button);
}

/**
 * 派生の照合に使う入力列: この連撃で実際に出た段のボタン列（AttackState.inputs）に、先行入力で予約中の段を
 * 「出る予定」として 1 つだけ足したもの。HUD の派生の案内（render/comboUi.ts）も同じ列を読む
 */
export function plannedInputs(state: GameState): ButtonKey[] {
  const a = state.player.attack;
  return a.buffered && a.phase !== "none" ? [...a.inputs, a.bufferedLane] : [...a.inputs];
}

/**
 * 次に押すと出る段の添字（左右共有の段カウンタ）。構え中は構えの次の段、振っていなければ今の段、
 * 振っている最中は先行入力で出る段（lane のレーンで数える。続かなければ undefined）。HUD の案内も読む
 */
export function nextLaneIndex(state: GameState, moveset: MovesetDef = playerMoveset(state), lane: ButtonKey = "secondary"): number | undefined {
  const p = state.player;
  const a = p.attack;
  if (p.art.holding) return a.step + 1;
  if (a.phase === "none") return a.step;
  return nextStepAfter(moveset, a, p.dashStrike, lane);
}

/** 押した右が出す右レーンの段が再使用中か。派生に当たる右（左左右の十字断ちなど）は妨げない */
function laneStepBlocked(state: GameState, moveset: MovesetDef): boolean {
  if (matchBranch(moveset, [...plannedInputs(state), "secondary"]) !== undefined) return false;
  const index = nextLaneIndex(state, moveset);
  const s = index === undefined ? undefined : moveset.steps2[index];
  return s !== undefined && actionCooldownLeft(state, s) > 0;
}

/** 派生に当たらなかった押下。左は武器種の役割、右は右レーンの段 */
function pressLane(state: GameState, moveset: MovesetDef, button: ButtonKey): void {
  const p = state.player;
  if (button === "secondary") {
    pressSecondary(state, moveset);
    return;
  }
  if (!isGun(moveset)) {
    tryAttack(state, moveset.primary === "charge");
    return;
  }
  // 銃の家系はダッシュ中の押下を反転撃ち（ダッシュ攻撃）として予約する
  if (isDashing(p)) {
    p.dashAttackQueued = true;
    return;
  }
  // 左の射撃は振りの最中でなければ段として数える（振りの最中の押下は何も出ないので派生の列に入れない）。
  // 再使用待ちの押下は押している間に撃つので数える（連打が再使用より速くても列が抜けないように）
  if (!isAttacking(p) && !p.attack.charging) logButton(p, "primary");
}

/**
 * 右の押下。振っていなければ今の段を出し、振っている最中は先行入力にする。
 * 次の段が弾・手元返しなら recover 中は振りを打ち切ってすぐ出す（先行入力と同じ手触り）
 */
function pressSecondary(state: GameState, moveset: MovesetDef): void {
  const p = state.player;
  const a = p.attack;
  if (isDashing(p)) return;
  if (a.phase === "none") {
    startLaneStep(state, moveset, a.step);
    return;
  }
  const next = nextStepAfter(moveset, a, p.dashStrike, "secondary");
  const s = next === undefined ? undefined : moveset.steps2[next];
  if (next !== undefined && s !== undefined && isInstantStep(s) && a.phase === "recover") {
    cancelAttack(state);
    resetSwing(state);
    startLaneStep(state, moveset, next);
    return;
  }
  if (a.phase !== "recover" && a.phase !== "active") return;
  a.buffered = true;
  a.bufferedLane = "secondary";
}

/** 右レーンの index 段目を出す（振っていないとき）。振りは連撃の経路、居合は溜めの経路、それ以外は weaponArts.ts */
function startLaneStep(state: GameState, moveset: MovesetDef, index: number): void {
  const s = moveset.steps2[index];
  if (!s) return;
  const p = state.player;
  switch (s.kind) {
    case "swing":
      startSwing(state, index, false, 0, "secondary");
      return;
    case "charge":
      p.attack.step = index;
      if (!p.attack.charging) beginCharge(p);
      return;
    default:
      startLaneArt(state, s, index);
  }
}

function buttonHeld(input: FrameInput, button: ButtonKey | undefined): boolean {
  if (button === "primary") return input.attackHeld;
  if (button === "secondary") return input.shootHeld;
  return false;
}

/** 射撃の押しっぱなし。銃の家系の左だけ（近接の武器種は撃たない） */
function shotButtonHeld(state: GameState, input: FrameInput): boolean {
  if (shapeLocksShot(state)) return false;
  return isGun(playerMoveset(state)) && input.attackHeld;
}

/** 実際に出た段のボタンを派生の入力列に積む。長さは chainMaxInputs まで */
export function logButton(p: Player, button: ButtonKey): void {
  const a = p.attack;
  a.inputs.push(button);
  if (a.inputs.length > WEAPON.chainMaxInputs) a.inputs.shift();
  a.inputTimer = WEAPON.chainWindow;
}

/** 入力列が途切れた（窓が切れて振っていない）ら捨て、段カウンタも 1 段目へ戻す（構え中は構えの段を保つ） */
function tickButtonChain(p: Player, dt: number): void {
  const a = p.attack;
  a.inputTimer = Math.max(0, a.inputTimer - dt);
  if (a.inputTimer > 0 || a.phase !== "none" || a.charging) return;
  a.inputs.length = 0;
  if (!p.art.holding) a.step = 0;
}

/** 近接を出せない状態（ダッシュ中） */
function meleeBlocked(state: GameState): boolean {
  return isDashing(state.player);
}

/**
 * 出た段の列（予約中の段を含む）に今の押下を足した列の末尾が派生に一致したら派生を出す
 * （振っている最中なら今の振りの後に予約）。出したら true。JUST 回避カウンターの受付中は見切り斬りを優先する
 */
function tryBranch(state: GameState, moveset: MovesetDef, button: ButtonKey): boolean {
  const p = state.player;
  const index = matchBranch(moveset, [...plannedInputs(state), button]);
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
  const p = state.player;
  // 左射撃以外の弾（派生・右レーン・狙い撃ち）も曲射の落下点をカーソルに合わせられるよう距離を持っておく
  p.aimDistance = aimDistance(state, input);
  if (!input.aimScreen) return false;
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
  p.swingImpact = Math.max(0, p.swingImpact - dt);
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
  endArtHold(state);
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
    const moveset = playerMoveset(state);
    const chargeMul = p.attack.charging ? (meleeChargeOf(moveset)?.moveMul ?? 1) : 1;
    const attackMul =
      (isAttacking(p) ? moveset.attackMoveMul : 1) *
      chargeMul *
      artMoveMul(state) *
      ultimateMoveMul(state) *
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
    if (charge && meleeChargeOf(playerMoveset(state))) {
      // 押し直し（連打）で溜めを最初からにしない
      if (!a.charging) beginCharge(p);
      return;
    }
    startNextSwing(state);
    return;
  }
  // recover / active 中なら先行入力として次段を予約
  if (a.phase !== "recover" && a.phase !== "active") return;
  a.buffered = true;
  a.bufferedLane = "primary";
}

/** 次の段を振る。突進斬り直後は 2 段目から。logAs は派生の列に積むボタン（省略は振りのレーン） */
function startNextSwing(state: GameState, logAs?: ButtonKey): void {
  startSwing(state, consumeLungeCombo(state) ? LUNGE_FOLLOW_COMBO : state.player.attack.step, false, 0, "primary", logAs);
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
  const charge = meleeChargeOf(playerMoveset(state));
  if (!charge || isPlayerStaggered(p) || isDashing(p) || skillLocksAttack(state) || isAttacking(p)) {
    cancelCharge(p);
    return;
  }
  if (buttonHeld(input, chargeButton(playerMoveset(state)))) {
    const before = chargeLevelAt(charge.levels, a.chargeTime);
    const heldBefore = a.chargeTime;
    a.chargeTime += dt;
    const after = chargeLevelAt(charge.levels, a.chargeTime);
    if (after > before) onChargeLevelUp(state, after);
    spinWhileCharging(state, charge, heldBefore, a.chargeTime);
    return;
  }
  const level = chargeLevelAt(charge.levels, a.chargeTime);
  cancelCharge(p);
  // 段に届かない居合（右の溜め）は左の段を振るが、派生の列には押したボタン（右）として積む
  if (level === 0) startNextSwing(state, chargeButton(playerMoveset(state)));
  else startSwing(state, 0, false, level, chargeButton(playerMoveset(state)) ?? "primary");
}

/**
 * 溜め中の回し（MeleeChargeDef.spinning。チェーンアレイ）: 押している秒が interval の区切りを越えるたびに回しの段の当たり判定を 1 回出す。
 * 振りの状態（phase）は none のまま（離せば溜め段の一撃）。当てた敵の記録は区切りごとに空にする
 */
function spinWhileCharging(state: GameState, charge: MeleeChargeDef, before: number, after: number): void {
  const spin = charge.spinning;
  if (!spin || Math.floor(after / spin.interval) <= Math.floor(before / spin.interval)) return;
  const p = state.player;
  const step = scaleStep(actionStats(state), spin.step, playerMoveset(state));
  p.attack.dir = { ...p.facing };
  p.attack.hitIds.clear();
  resolveMeleeHits(state, step);
  spawnTrail(state, step);
  pushSfx(state, SPIN_SFX);
}

/** 溜めの段が上がった合図（音と色の粒）。離すタイミングを目と耳で計れるように */
function onChargeLevelUp(state: GameState, level: number): void {
  const color = WEAPON.chargeRingColors[level] ?? WEAPON.chargeRingColors[0] ?? "#ffffff";
  spawnBurst(state, state.player.body.pos, color, CHARGE_LEVEL_PARTICLES, 70, 0.2, 1.5);
  pushSfx(state, "chargeLevel");
  chargeUpFx(state, level, color);
}

/** 溜めの段（0 = 段なし）。描画の環に使う */
export function meleeChargeLevel(state: GameState): number {
  const a = state.player.attack;
  const charge = meleeChargeOf(playerMoveset(state));
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
 * 振り始め。requested は lane のレーンの段。祝福には段数を丸めた combo（hookCombo）を渡し、
 * 「常に最終段から」の祝福が最終段を返したらそのレーンの最終段を振る
 */
function startSwing(state: GameState, requested: number, dashStrike = false, chargeLevel = 0, lane: ButtonKey = "primary", logAs?: ButtonKey): void {
  const moveset = playerMoveset(state);
  const requestedCombo = chargeLevel > 0 ? FINISHER_COMBO : hookCombo(moveset, requested, lane);
  const combo = boonSwingCombo(state, requestedCombo, dashStrike);
  const finisherForced = !dashStrike && chargeLevel === 0 && combo === FINISHER_COMBO;
  const stepIndex = finisherForced ? finisherIndex(moveset, lane, requested) : requested;
  beginSwing(state, { step: stepIndex, dashStrike, chargeLevel, branch: -1, combo, lane, logAs });
}

/** レーンの最終段（振りでない右の最終段・段の無いレーンなら requested のまま） */
function finisherIndex(moveset: MovesetDef, lane: ButtonKey, requested: number): number {
  const last = laneLength(moveset, lane) - 1;
  return laneSwing(moveset, lane, last) ? last : requested;
}

/**
 * コンボ派生を振る。フィニッシュ（next なし）は祝福に最終段として渡し、
 * 連撃が続く派生（踏み込み斬りなど）は 1 段目として渡す
 */
function startBranch(state: GameState, index: number): void {
  const branch = playerMoveset(state).branches[index];
  if (!branch) return;
  const combo = branch.next === undefined ? FINISHER_COMBO : 0;
  // 派生のレーンは最後に押したボタン（Rule の lane 条件・終撃の判定が読む）
  const lane = branch.sequence[branch.sequence.length - 1] ?? "primary";
  beginSwing(state, { step: state.player.attack.step, dashStrike: false, chargeLevel: 0, branch: index, combo, lane });
  // 派生が出たら列を捨てる（次の派生は派生の後に実際に出た段から数え直す）。
  // 構えを離した振り（art: release）は構えの右（beginHold で積んだ段）の続きなので捨てない（右右左の派生が構えから繋がる）
  if (branch.art !== "release") state.player.attack.inputs.length = 0;
  // 弾・付随効果は振り始めに出す（予約のまま捨てられた派生では出さない）
  onBranchStart(state, branch);
  // 派生成立の合図（docs/ideas/combat-feel-design.md D-1）
  addFloatingText(state, state.player.body.pos, branch.name, FEEL.branchTextColor, FEEL.branchTextScale, FEEL.branchTextLife);
  pushSfx(state, "branch");
}

/** 構えから派生を振る（盾の構えを離した盾押し。weaponArts.ts から）。振っている最中なら今の振りの後に予約する */
export function startArtBranch(state: GameState, index: number): void {
  const p = state.player;
  if (p.attack.phase === "none") startBranch(state, index);
  else p.attack.pendingBranch = index;
}

interface SwingSpec {
  step: number;
  dashStrike: boolean;
  chargeLevel: number;
  branch: number;
  combo: number;
  lane: ButtonKey;
  /** 派生の列に積むボタン（省略は lane） */
  logAs?: ButtonKey;
}

function beginSwing(state: GameState, spec: SwingSpec): void {
  const p = state.player;
  const moveset = playerMoveset(state);
  const step = meleeStep(actionStats(state), spec.step, spec.dashStrike, spec.chargeLevel, spec.branch, moveset, spec.lane);
  if (!step) return;
  const a = p.attack;
  // 派生の照合は実際に出た段で行う（派生そのものは startBranch が列を捨てる）
  if (spec.branch < 0) logButton(p, spec.logAs ?? spec.lane);
  p.dashStrike = spec.dashStrike;
  a.combo = spec.combo;
  a.step = spec.step;
  a.lane = spec.lane;
  a.chargeLevel = spec.chargeLevel;
  a.branch = spec.branch;
  a.pendingBranch = -1;
  a.phase = "windup";
  a.timer = step.windup;
  a.buffered = false;
  a.bufferedLane = "primary";
  // 右レーンの振りの段は振り始めに再使用と付随効果（零距離砲の反動・起爆）を立てる
  const laneDef = spec.lane === "secondary" && spec.branch < 0 && spec.chargeLevel === 0 && !spec.dashStrike ? moveset.steps2[spec.step] : undefined;
  if (laneDef?.kind === "swing") onLaneSwingStart(state, laneDef);
  a.hitIds.clear();
  a.hitTick = 0;
  a.dir = { ...p.facing };
  if (step.invuln > 0) p.invulnTimer = Math.max(p.invulnTimer, step.invuln);
  const sfx = SLASH_SFX[spec.combo];
  if (sfx) pushSfx(state, sfx);
  onSwingFx(state);
  payOverclock(state, PLAYER.overclockHpCost);
  onBoonSwing(state, spec.combo, spec.dashStrike);
  pushSwingEvent(state, spec.combo, spec.dashStrike, step.damage);
  ultimateOnSwing(state);
}

function updateAttack(state: GameState, dt: number): void {
  const p = state.player;
  const a = p.attack;
  if (a.phase === "none") return;
  const step = meleeStep(actionStats(state), a.step, p.dashStrike, a.chargeLevel, a.branch, playerMoveset(state), a.lane);
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

  // recover の後半に先行入力があれば前倒しで終える（docs/ideas/combat-feel-design.md D-4）
  if (a.phase === "recover" && shouldCancelRecover(playerMoveset(state), step, a, p.dashStrike)) {
    endSwing(state);
    return;
  }

  if (a.timer > 0) return;
  switch (a.phase) {
    case "windup":
      a.phase = "active";
      a.timer = step.active;
      spawnTrail(state, step);
      // 詠唱の弾は active の瞬間に 1 回だけ（予約のまま捨てられた振りでは出さない）
      if (step.cast) emitArtVolley(state, step.cast.throw);
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

/**
 * recover 中に前倒しで振りを終えるか。残りが recoverCancel（段ごとの上書きは MeleeStepDef.cancel）を
 * 切っていて、次段の先行入力か派生の予約があるとき true。最終段（next === undefined）は前倒ししない
 */
function shouldCancelRecover(moveset: MovesetDef, step: Readonly<MeleeStep>, a: Player["attack"], dashStrike: boolean): boolean {
  if (step.recover <= 0) return false;
  const threshold = step.recover * (step.cancel ?? PLAYER.recoverCancel);
  if (a.timer > threshold) return false;
  if (a.pendingBranch >= 0) return true;
  if (!a.buffered) return false;
  return nextStepAfter(moveset, a, dashStrike, a.bufferedLane) !== undefined;
}

/** recover の終わり: 予約した派生 → 先行入力の次段 → 連撃の終わり の順に決める */
function endSwing(state: GameState): void {
  const p = state.player;
  const a = p.attack;
  const moveset = playerMoveset(state);
  const next = nextStepAfter(moveset, a, p.dashStrike, a.bufferedLane);
  const lane = a.bufferedLane;
  const chainEnds = nextStepAfter(moveset, a, p.dashStrike, a.lane) === undefined;
  // 派生の照合に含めた予約中の段は先に出し、派生はその後に出す（出ていない段で派生を成立させない）
  if (a.buffered && next !== undefined) {
    const pending = a.pendingBranch;
    continueLane(state, moveset, lane, next);
    if (pending >= 0) followWithBranch(state, pending);
    return;
  }
  if (a.pendingBranch >= 0) {
    startBranch(state, a.pendingBranch);
    return;
  }
  resetSwing(state);
  if (!chainEnds) return;
  // 最終段・フィニッシュの後は少し間を置く。効くのは銃の家系（右レーンの振りの後に撃てる）だけ
  if (isGun(moveset)) p.shootCooldown = Math.max(p.shootCooldown, PLAYER.comboLockout);
  a.inputs.length = 0;
}

/** 予約中の段の後に出す派生。段が振りならその振りの後に予約し直し、振り以外（弾・構え）ならすぐ出す */
function followWithBranch(state: GameState, index: number): void {
  if (state.player.attack.phase === "none") startBranch(state, index);
  else state.player.attack.pendingBranch = index;
}

/** 振りを終えて待機に戻す（段カウンタは 0 から） */
function resetSwing(state: GameState): void {
  const p = state.player;
  const a = p.attack;
  a.phase = "none";
  a.combo = 0;
  a.step = 0;
  a.lane = "primary";
  a.chargeLevel = 0;
  a.branch = -1;
  a.buffered = false;
  a.bufferedLane = "primary";
  p.dashStrike = false;
}

/** 先行入力の段を出す。右の振り以外の段（弾・構えなど）は振りを終えてから段の添字を渡す */
function continueLane(state: GameState, moveset: MovesetDef, lane: ButtonKey, next: number): void {
  const s = lane === "secondary" ? moveset.steps2[next] : undefined;
  if (s === undefined || s.kind === "swing") {
    startSwing(state, next, false, 0, lane);
    return;
  }
  resetSwing(state);
  state.player.attack.step = next;
  startLaneStep(state, moveset, next);
}

/** 今の振りの後に lane のボタンで続けられる段。フィニッシュ・溜め攻撃・そのレーンの最終段なら undefined */
function nextStepAfter(moveset: MovesetDef, a: Player["attack"], dashStrike: boolean, lane: ButtonKey): number | undefined {
  if (a.chargeLevel > 0) return undefined;
  const next = a.branch >= 0 && !dashStrike ? moveset.branches[a.branch]?.next : a.step + 1;
  if (next === undefined) return undefined;
  return next < laneLength(moveset, lane) ? next : undefined;
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
  for (const a of angles) spawnLine(state, origin, add(origin, scale(fromAngle(a), len)), step.trail, WEAPON.trailLife, true);
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
 * 祝福「弾返し」なら撃ち返し、性質「弾斬り」か段の cutsBullets（扇子の払い）なら消す。両方あれば撃ち返しを優先する
 */
function resolveMeleeBullets(state: GameState, step: MeleeStep): void {
  const reflect = hasBoon(state, "reflect");
  if (!reflect && state.stats.bulletCut <= 0 && !step.cutsBullets) return;
  for (const pr of state.projectiles) {
    if (pr.owner !== "enemy" || pr.life <= 0) continue;
    if (meleeContact(state.player, step, pr.pos, pr.radius) === "none") continue;
    if (reflect) reflectProjectile(state, pr);
    else cutProjectile(state, pr);
  }
}

/** 命中音の重さ: 終撃・重い段は heavy、1 段目は light、それ以外は mid（docs/recipes/audio.md） */
function meleeHitWeight(step: Readonly<MeleeStep>, combo: number): HitWeight {
  if (step.heavy || combo === FINISHER_COMBO) return "heavy";
  return combo === 0 ? "light" : "mid";
}

/** 近接 1 命中の奥義ゲージ。段の基礎秒（攻撃速度の倍率を掛ける前。速くしても 1 秒あたりの得は残る）で決める */
function stepHitEnergy(state: GameState, step: Readonly<MeleeStep>): number {
  const baseSec = (step.windup + step.active + step.recover) * actionStats(state).attackSpeedMul;
  return meleeHitEnergy(baseSec, step.hits);
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
  // 武器種の最終段・フィニッシュ派生の命中（docs/ideas/combat-feel-design.md D-1 / D-5）
  const finisher = p.attack.combo === FINISHER_COMBO;
  p.swingImpact = FEEL.swingImpact;
  if (finisher) pushSfx(state, "finisherHit");
  damageEnemy(state, e, amount, knockDirection(p, e, step), step.knockback, {
    poise: counterPoise(step, counter) * tipMul.poise,
    hitstopSteps: baseHitstop + (counter ? ACTION.counter.hitstopBonus : 0),
    energy: stepHitEnergy(state, step),
    kind: "melee",
    crit: out.crit,
    guardBreak: counter,
    finisher,
    impact: { family: hitFamily(playerMoveset(state).key), weight: meleeHitWeight(step, p.attack.combo) },
  });
  if (counter) showCounter(state, pos);
  if (counter) onTraitCounter(state, e);
  if (counter) pushEvent(state, { kind: "onCounter", actor: "player", source: { kind: "player", key: "counter" }, ...enemyTarget(e) });
  gainMeleeMana(state, step.mana * tipMul.mana, counter);
  p.meleeHitCount += 1;
  fireTrigger(state, "onMeleeHit", { pos, targetId: e.id });
  fireTrigger(state, "everyNthMeleeHit", { pos, targetId: e.id });
  onBoonMeleeHit(state, e, counter);
  pushSwingHitEvent(state, e, p.attack.combo, p.dashStrike);
  ultimateOnSwingHit(state, e);
  onSkillMeleeHit(state, e, p.attack.combo);
  onShapeMeleeHit(state, e);
  applyStepStatus(state, e, step);
}

/** 段の applies（斧の出血・分銅の崩勢・ジョブの派生の弱体など）を命中した敵へ付ける。倒れた敵には付けない */
function applyStepStatus(state: GameState, e: Enemy, step: Readonly<MeleeStep>): void {
  if (e.hp <= 0) return;
  for (const apply of step.applies) applyStatus(state, { kind: "enemy", enemy: e }, apply, "player");
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
  const lastStep = playerMoveset(state).steps.length - 1;
  startSwing(state, lastStep);
  p.attack.dir = { ...dir };
  p.attack.hitIds.add(target.id);
  const step = meleeStep(actionStats(state), lastStep, false, 0, -1, playerMoveset(state), "primary");
  if (!step) return;
  const out = rollOutgoing(state, target, step.damage, "melee");
  const hitPos = { ...target.body.pos };
  target.wallSplat = true;
  damageEnemy(state, target, Math.round(out.amount * j.damageMul), dir, step.knockback, {
    poise: j.poise * state.stats.poiseDamageMul,
    hitstopSteps: FEEL.hitstopHeavy + j.hitstopBonus,
    energy: stepHitEnergy(state, step),
    kind: "melee",
    crit: out.crit,
    guardBreak: true,
    impact: { family: hitFamily(playerMoveset(state).key), weight: "heavy" },
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
  if (skillLocksAttack(state) || isPlayerStaggered(p)) return;
  cancelAttack(state);
  startSwing(state, 0, true);
}

/** n 発を扇状に並べた角度オフセット（ラジアン）。1 発なら [0]。間隔は銃の弾ごと（既定は PLAYER.projectileSpreadDeg） */
export function spreadOffsets(count: number, spreadDeg: number = PLAYER.projectileSpreadDeg): number[] {
  const step = spreadDeg * DEG_TO_RAD;
  const center = (count - 1) / 2;
  return Array.from({ length: count }, (_, i) => (i - center) * step);
}

/**
 * 射撃の入力。held は怯み・スキル硬直を除いた「撃てる押しっぱなし」。
 * チャージの型は押している間溜め、離したときに撃つ。それ以外は押している間撃ち続ける
 */
function updateShooting(state: GameState, held: boolean, dt: number, aim?: number): void {
  const shot = currentShot(state.stats);
  updateBurst(state, shot, dt);
  if (shot.charge) {
    updateShotCharge(state, shot, held, dt, aim);
    return;
  }
  cancelShotCharge(state.player);
  if (held) tryShoot(state, aim);
}

/** 照準（カーソル）までの距離。曲射の着弾点に使う。照準していなければ undefined（射程いっぱい） */
function aimDistance(state: GameState, input: FrameInput): number | undefined {
  if (!input.aimScreen) return undefined;
  return dist(screenToWorld(state.camera, input.aimScreen), state.player.body.pos);
}

/**
 * 三点の続きの弾。1 発目は fireVolley が撃ち、残りを interval 秒おきに出す。
 * 近接・怯み・撃てないダッシュ・射撃を禁じる祝福・型の付け替えで残りは捨てる
 */
function updateBurst(state: GameState, shot: BulletDef, dt: number): void {
  const p = state.player;
  const b = p.shotBurst;
  if (b.left <= 0) return;
  if (!shot.burst || !canContinueBurst(state)) {
    b.left = 0;
    return;
  }
  b.timer -= dt;
  if (b.timer > BURST_EPSILON) return;
  b.left -= 1;
  b.timer += shot.burst.interval;
  emitVolley(state, shot, 0, undefined, { energy: gunShotEnergy(state, shot, 0) });
}

function canContinueBurst(state: GameState): boolean {
  const p = state.player;
  if (isAttacking(p) || isPlayerStaggered(p)) return false;
  return !isDashing(p) || canShootWhileDashing(state);
}

/** 銃を持っていない間は射撃の途中経過を持ち越さない */
function resetShooting(p: Player): void {
  cancelShotCharge(p);
  p.shotBurst.left = 0;
}

function cancelShotCharge(p: Player): void {
  p.shotCharging = false;
  p.shotChargeTime = 0;
}

function updateShotCharge(state: GameState, shot: BulletDef, held: boolean, dt: number, aim?: number): void {
  const p = state.player;
  const levels = shot.charge?.levels ?? [];
  if (held) {
    if (!p.shotCharging) {
      if (!canShootNow(state)) return;
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
  fireVolley(state, level, aim);
}

/** 射撃できる状態か（再使用待ち・近接中・溜め中・ダッシュ中） */
function canShootNow(state: GameState): boolean {
  const p = state.player;
  if (p.shootCooldown > 0 || isAttacking(p) || p.attack.charging) return false;
  return !isDashing(p) || canShootWhileDashing(state);
}

function tryShoot(state: GameState, aim?: number): void {
  if (!canShootNow(state)) return;
  fireVolley(state, 0, aim);
}

/** 1 回の射撃で出す弾の形（銃の弾 × 溜めの段 × 装備） */
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

/**
 * 今の銃の弾とは別に弾を出す経路（右レーンの投擲・魔弾・乱れ撃ち、短銃の狙い撃ち、派生の弾）が差し替える値。
 * damage / poise は最終値（省略は銃の弾の値）、damageMul / pierceBonus は銃の弾の値に掛ける・足す
 */
export interface VolleyOverride {
  damage?: number;
  poise?: number;
  damageMul?: number;
  pierceBonus?: number;
  count?: number;
  spreadDeg?: number;
  /** 弾の素性（ジャンル・属性）。弾の型の既定から変えるもの */
  attack?: AttackProfile;
  /** false なら反動を付けない（全周へ撒く技など） */
  recoil?: boolean;
  /** 弾の代わりに武器の絵を回して描く（斧の投擲など。ThrowArtDef.sprite） */
  sprite?: string;
  /** 弾 1 発が命中で溜める奥義ゲージ（銃の射撃だけ。省略は溜めない） */
  energy?: number;
  /** 命中・炸裂で付ける状態異常（ThrowArtDef.applies） */
  applies?: readonly StatusApply[];
}

function volleySpec(state: GameState, shot: BulletDef, level: number, aim?: number, override: VolleyOverride = {}): VolleySpec {
  const s = state.stats;
  const charged = level > 0 ? shot.charge?.levels[level - 1] : undefined;
  const damageMul = (charged?.damageMul ?? shot.damageMul) * (override.damageMul ?? 1);
  const speed = PLAYER.shoot.speed * shot.speedMul * s.projectileSpeedMul;
  return {
    damage: override.damage ?? shotDamage(s) * damageMul + boonNormalAttackBonus(state),
    poise: override.poise ?? shotPoise(s, shot, charged?.poiseMul ?? shot.poiseMul) * s.poiseDamageMul,
    radius: charged?.radius ?? shot.radius,
    pierce: s.pierce + shot.pierceBonus + (charged?.pierceBonus ?? 0) + (override.pierceBonus ?? 0),
    speed,
    life: shotLife(shot, speed, aim),
    count: override.count ?? s.projectileCount + shot.pellets,
    color: shot.mine?.color ?? shot.lob?.color ?? (level > 0 ? (WEAPON.chargeRingColors[level] ?? BULLET_COLOR) : (shot.look?.color ?? BULLET_COLOR)),
  };
}

/** 弾の寿命。設置弾は信管、曲射は照準の距離（minRange〜射程）を飛び切る秒、それ以外は射程 */
function shotLife(shot: BulletDef, speed: number, aim: number | undefined): number {
  // 周回の弾は laps 周を回り切る秒（射程ではなく周回で消える）
  if (shot.orbit && shot.orbit.turnRate > 0) return (shot.orbit.laps * FULL_TURN) / shot.orbit.turnRate;
  if (shot.mine) return shot.mine.fuse;
  const life = PLAYER.shoot.life * shot.lifeMul;
  if (!shot.lob || speed <= 0) return life;
  const maxRange = life * speed;
  const range = Math.min(maxRange, Math.max(shot.lob.minRange, aim ?? maxRange));
  return range / speed;
}

/** 連射の弾筋の揺れ（ラジアン）。乱数ではなくゲーム内時間の正弦で決める（決定性） */
function swayOffset(state: GameState, shot: BulletDef): number {
  if (!shot.sway) return 0;
  return Math.sin(state.time * shot.sway.freq * FULL_TURN) * shot.sway.deg * DEG_TO_RAD;
}

/** 弾ごとの作業領域。挙動の性質も周回も持たない弾は持たない（従来の弾と同じ形のまま）。回転刃・曲射は撃った瞬間の寿命を覚える */
function shotRuntime(shot: BulletDef, life: number, fireAngle: number, orbitIndex: number): ShotRuntime | undefined {
  if (bulletFeatures(shot).length === 0 && !shot.orbit && !shot.look && !shot.leaves) return undefined;
  const lifeTotal = shot.boomerang || shot.lob ? { lifeTotal: life } : {};
  const orbit = shot.orbit ? { orbit: { ...shot.orbit }, orbitAngle: fireAngle, orbitPhase: orbitPhaseOf(orbitIndex), orbitTravel: 0 } : {};
  const extra = { ...(shot.leaves ? { leaves: shot.leaves } : {}), ...(shot.look ? { look: shot.look } : {}) };
  return { key: shot.key, bouncesLeft: shot.bounce?.count, ...lifeTotal, ...orbit, ...extra };
}

/**
 * 周回の弾の位相のずれ（-π〜π）。回っている弾の数（発射順）× 黄金角で、何発目でも輪の上に散らばる
 * （同じ向きへ続けて撃っても同じ角度に重ならない）
 */
function orbitPhaseOf(index: number): number {
  let phase = (index * ORBIT_GOLDEN_ANGLE) % FULL_TURN;
  if (phase > Math.PI) phase -= FULL_TURN;
  return phase;
}

/** いま回っている自分の周回の弾の数（次に撃つ周回の弾の発射順） */
function orbitingCount(state: GameState): number {
  return state.projectiles.filter((pr) => pr.owner === "player" && pr.life > 0 && pr.shot?.orbit !== undefined).length;
}

/** 射撃 1 回（再使用時間を立てる）。三点なら残りの弾を予約する */
function fireVolley(state: GameState, level: number, aim?: number): void {
  const p = state.player;
  const s = state.stats;
  const shot = ultimateShot(state, currentShot(s));
  p.shootCooldown = (PLAYER.shoot.cooldown * shot.cooldownMul) / (s.fireRateMul * frenzyMul(state) * ultimateFireRateMul(state));
  emitVolley(state, shot, level, aim, { energy: gunShotEnergy(state, shot, level) });
  if (!shot.burst) return;
  p.shotBurst.left = shot.burst.count - 1;
  p.shotBurst.timer = shot.burst.interval;
}

/** 銃の射撃 1 発の奥義ゲージ。射撃間隔の基礎秒（溜め撃ちは溜めの秒も足す）を 1 回に出る弾数（散弾・三点）で割る */
function gunShotEnergy(state: GameState, shot: BulletDef, level: number): number {
  const chargeSec = level > 0 ? (shot.charge?.levels[level - 1]?.time ?? 0) : 0;
  const bullets = (state.stats.projectileCount + shot.pellets) * (shot.burst?.count ?? 1);
  return shotHitEnergy(PLAYER.shoot.cooldown * shot.cooldownMul + chargeSec, bullets);
}

/** 銃口の位置。二丁拳銃は撃つたびに左右の銃口を入れ替える */
function muzzleAt(state: GameState, dir: Vec): Vec {
  const p = state.player;
  const front = add(p.body.pos, scale(dir, p.body.radius + 2));
  if (playerMoveset(state).key !== "gunner") return front;
  const side = p.shotBurst.side;
  p.shotBurst.side = -side;
  return add(front, scale({ x: -dir.y, y: dir.x }, WEAPON.movesets.gunner.muzzleOffset * side));
}

/** 弾を出す（再使用時間は触らない。三点の続きの弾・右レーンと派生の弾もここを通る）。出したら true */
export function emitVolley(state: GameState, shot: BulletDef, level: number, aim?: number, override: VolleyOverride = {}): boolean {
  const p = state.player;
  const dir = { ...p.facing };
  const muzzle = muzzleAt(state, dir);
  const baseAngle = angle(dir) + swayOffset(state, shot);
  const spec = volleySpec(state, shot, level, aim, override);
  const firstShot = state.projectiles.length;
  let orbitIndex = shot.orbit ? orbitingCount(state) : 0;
  for (const offset of spreadOffsets(spec.count, override.spreadDeg ?? shot.spreadDeg)) {
    const runtime = shotRuntime(shot, spec.life, baseAngle + offset, orbitIndex);
    orbitIndex += 1;
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
      // 右レーンの弾（魔弾の光など）は段の素性を持つ。無ければ elementCombat が stats.bullet から引く
      ...(override.attack ? { attack: override.attack } : {}),
      ...(override.sprite ? { sprite: override.sprite } : {}),
      // 周回する弾は 1 周ごとに当て直すので、持続の奥義が終わった後に奥義ゲージを溜め直させない
      ...(override.energy !== undefined && !shot.orbit ? { energy: override.energy } : {}),
      ...(override.applies && override.applies.length > 0 ? { applies: override.applies } : {}),
    });
  }
  onBoonShoot(state, state.projectiles.slice(firstShot));
  if (override.recoil !== false) p.knock = add(p.knock, scale(dir, -PLAYER.shoot.recoil * shot.recoilMul));
  spawnBurst(state, muzzle, spec.color, shot.look?.particles ?? MUZZLE_PARTICLES, 60, 0.12, 1.5);
  shake(state, 1);
  // 右レーンの弾も弾の性質で音を選ぶ（docs/ideas/weapon-redesign.md 6 章）
  pushSfx(state, shotSfxName(shot));
  payOverclockShoot(state);
  fireTrigger(state, "onShoot", { pos: muzzle });
  pushPlayerEvent(state, "onShoot", "ranged", { pos: { ...muzzle } });
  onSkillPlayerShoot(state);
  return true;
}
