import type { FrameInput } from "../core/input";
import { type BurstEntry, type Enemy, type GameState, type Player, type Projectile, allocId, pushSfx, runOver } from "../core/state";
import { type Vec, add, dist, fromAngle, angle, isZero, normalize, scale, sub, length } from "../core/vec";
import { screenToWorld } from "../core/view";
import type { SfxName } from "../audio/sfxNames";
import { emitNoise } from "./noise";
import { ACTION, BOON_LINEAGE, ECONOMY, FEEL, FORM, KEYSTONE, MANA, PLAYER, WEAPON } from "../data/tuning";
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
  laneLength,
  laneSwing,
  matchBranch,
  meleeChargeOf,
  shootsPrimary,
  firesByHand,
  withExtraBranch,
} from "../data/weapons";
import type { AttackProfile } from "../core/element";
import { type JobKey, jobBranch } from "../data/jobs";
import { enemyDef } from "../data/enemies";
import { withReforges } from "../data/reforges";
import { DEFAULT_STATS, createLootRuntime, type PlayerStats, type Scaling } from "../loot/types";
import { cancelAttack, damageEnemy, meleeHitEnergy, rollOutgoing, tickDelayedDamage, tickHpRegen, tickRegain } from "./combat";
import { EARTH_WALL_SLAM_KEY } from "./boonDefs/earth";
import { markShotBullet, shake, spawnBurst, spawnLine, addHeadLabel } from "./effects";
import { chargeUpFx, onSwingFx, shotSfxName } from "./effects";
import { type HitWeight, hitFamily } from "./effects";
import { currentBullet } from "../loot/bullets";
import { KS, attackManaMul, hasKeystone, payOverclock, payOverclockShoot } from "./keystones";
import { type Box, boxCircleOverlap, circlesOverlap, moveBody } from "./physics";
import { applyStatus, explodeAt, hasStatus, playerStatusMoveMul } from "./statusEffects";
import { terrainSlide } from "./terrain";
import { deriveAttributes, scaled, withRatio } from "./attributes";
import { applyRunStats } from "./runSetup";
import { applyResonance } from "./resonance";
import { gainWeaponMana } from "./mana";
import { type StatusApply, createStatusBag } from "../core/status";
import {
  cancelSkills,
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
import { pushPlayerEvent, pushSwingEvent, pushSwingHitEvent } from "../core/events";
import { bossOnAnswer } from "./boss";
import { fireDebana, noteCommittedHit } from "./debana";
import { NEVER_TIME, yellowAt } from "./readTiming";
import { boonMoveMul, boonSwingCombo, foldBoonStats, hasBoon, onBoonDash } from "./boons";
import { isDeepDepth } from "./chapters";
import { isAllied } from "./rules";
import { noteShapeSwing, onShapeMeleeHit, shapeButtonPress, shapeLocksShot, shapeMoveset, shrugStagger } from "../skills/forms";
import {
  actionCooldownLeft,
  artLocksActions,
  artMoveMul,
  castOverride,
  emitArtVolley,
  endArtHold,
  finishArtHold,
  isInstantStep,
  nearestOwnMine,
  onBranchStart,
  onLaneSwingStart,
  startLaneArt,
  updateArt,
} from "./weaponArts";
import { parryLocksDash, startParry, tickParry } from "./parry";
import { createUltimateState, tryUltimate, ultimateFireRateMul, ultimateMoveMul, ultimateMoveset, ultimateShot, updateUltimate, endUltimate } from "./ultimates";
import { ultimateOnSwing, ultimateOnSwingHit, ultimatePinDriveMul } from "./ultimates";
import { KUNAI_SENBON, formCutsBullets, formOf, formReleaseCast } from "../data/weaponForms";
import { onFormMeleeHit } from "./formMarks";
import { type ReleaseMul, createMorale, gainMorale, releaseIsFinisher, resetMorale, swingReleaseMul, timedAttackSpeedMul } from "./morale";
import { createMoment, noteRiposte, startShotMoments, startSwingMoments, tickFormState } from "./moments";
import { type HandIndex, canFireAny, createMagazineFor, nextFireHand, pressTrigger, reloadMoveMul, spendRounds, tickMagazine } from "./magazine";
import { pressHand, tickDualPistols } from "./dualPistols";
import { relicBlocksSwing, relicStride, tickNamedRelics } from "./namedRelics";
import { dashDirection, dashIgnoresSwingLock, dashKeepsChain, dashLocksActions, dashSpeed, keepChainThroughDash, replaceDash, runDashForm, tickDashForm } from "./dashForms";
import { attackHitManaMul, noteMeleeHitMana } from "./manaSources";
import { drivePins } from "./pins";
import { launchThrow, newShotTrip, pairSides, returnsToHand, ringsInFlight } from "./projectiles";

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
    flasks: Math.min(ECONOMY.flask.start, stats.flaskMax),
    flaskReadyAt: 0,
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
      startedAt: NEVER_TIME,
      readIds: new Set(),
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
    dashAttackQueued: false,
    dashStrike: false,
    mana: stats.maxMana,
    status: createStatusBag(),
    loot: createLootRuntime(),
    shotCharging: false,
    shotChargeTime: 0,
    secondaryWasHeld: false,
    shotBurst: { queue: [], side: 1 },
    swingImpact: 0,
    art: { cooldown: 0, holding: false, holdTime: 0, recover: 0, cooldowns: new Map() },
    parry: { window: 0, recover: 0 },
    ultimate: createUltimateState(),
    morale: createMorale(),
    magazine: createMagazineFor(stats),
    moment: createMoment(),
  };
}

/**
 * 装備変更などで stats が変わったときにプレイヤーへ反映する。
 * maxHp が変わったら現在 HP の割合を維持する。
 * 集計順は 装備 → ステータスの派生 → 祝福（docs/COMBAT_DESIGN.md A-4 から祝福を最後へ移した）
 */
export function applyStats(state: GameState, equipStats: PlayerStats): void {
  const p = state.player;
  const ratio = p.maxHp > 0 ? p.hp / p.maxHp : 1;
  // 起点・縛り・祭壇の誓約（ラン内）を装備の stats に先に足す。装備画面から呼ばれても消えない
  const base = applyRunStats(state, equipStats);
  // 祝福（ラン内）は装備の stats に畳み込む。装備画面から呼ばれても祝福が消えない
  state.boonRun.baseStats = base;
  // 派生 → 祝福の順: 祝福の固定値（硝子の見切りの最大 HP 1 など）を体力の加算で崩さない
  const derived = deriveAttributes(base);
  const stats = foldBoonStats(derived, state.boons, state.boonRun, isDeepDepth(state.depth));
  applyResonance(state, stats);
  // 武器種が変わったら持続の奥義を終える（別の武器種の型に同じ差し替えを畳まない）
  const movesetChanged = state.stats.moveset !== stats.moveset;
  state.stats = stats;
  if (movesetChanged) endUltimate(state, "manual");
  if (movesetChanged) resetMorale(p);
  p.maxHp = stats.maxHp;
  // 精神が下がって上限が縮んだときだけ切り詰める（増えたぶんは自然回復で埋める）
  p.mana = Math.min(p.mana, stats.maxMana);
  p.dashChargesLeft = Math.min(p.dashChargesLeft, stats.dashCharges);
  p.flasks = Math.min(p.flasks, Math.max(0, Math.floor(stats.flaskMax)));
  // 死亡中に装備画面を触っても蘇生しない
  if (runOver(state)) return;
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
  /** 先端判定（槍・鞭の突き、棍は薙ぎ・回しも。stepTip）。持たない段は根元と先端を区別しない */
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
  /** 命中した敵を飛ばす向き（MeleeStepDef.knockToward） */
  knockToward?: MeleeStepDef["knockToward"];
  /** 戦意を使った放出の振り（system/morale.ts。与ダメのタグ release・終撃の判定） */
  release?: boolean;
  /** 命中した敵の刺さりを叩き込む（MeleeStepDef.drivePins。true = 全部、数 = 古い順にその本数） */
  drivePins?: true | number;
  /** 抜け斬り（MeleeStepDef.passThrough） */
  passThrough?: boolean;
  /** 斬った敵 1 体ごとの気力（MeleeStepDef.manaPerTarget） */
  manaPerTarget?: number;
}

/** 装備中の武器種。武器なしは剣 */
export function currentMoveset(stats: Readonly<PlayerStats>): MovesetDef {
  // 旧形式の stats（moveset を持たない）でも落ちないよう既定へ
  return MOVESETS[stats.moveset] ?? MOVESETS.sword;
}

/**
 * いま振る近接の型。狼化・鉄塊化の最中は変身の型（skills/forms.ts）、それ以外は装備の武器種に
 * 持続の奥義の差し替え（system/ultimates.ts）→ 改鋳（data/reforges.ts）→ ジョブ固有の派生の順に重ねた型
 */
export function playerMoveset(state: GameState): MovesetDef {
  // 奥義の差し替えはジョブ派生の後に畳む（ジョブの合成の cache は武器種の key で引くので、差し替えた型を渡すと古い型が返る）
  return shapeMoveset(state) ?? ultimateMoveset(state, withReforges(withJobBranch(currentMoveset(state.stats), state.job), state.reforges));
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
  release?: ReleaseMul,
): MeleeStep | undefined {
  const base = stepDef(moveset, step, dashStrike, chargeLevel, branch, lane);
  if (!base) return undefined;
  const level = chargeLevel > 0 ? meleeChargeOf(moveset)?.levels[chargeLevel - 1] : undefined;
  return scaleStep(stats, base, moveset, level, release);
}

/**
 * 段の定義に stats と溜めの段の倍率を掛ける（meleeStep と溜め中の回しが使う）。
 * release は戦意の放出の倍率（system/morale.ts。放出の段の振りだけ）
 */
function scaleStep(
  stats: Readonly<PlayerStats>,
  base: MeleeStepDef,
  moveset: MovesetDef,
  level?: MeleeChargeDef["levels"][number],
  release?: ReleaseMul,
): MeleeStep {
  const speed = stats.attackSpeedMul;
  const reachMul = stats.meleeReachMul * (level?.reachMul ?? 1) * (release?.reachMul ?? 1);
  const weight = WEAPON.weightClass[moveset.weight];
  return {
    windup: base.windup / speed,
    active: base.active / speed,
    recover: (base.recover * weight.recoverMul) / speed,
    damage: scaled(stats, base.scaling) * (level?.damageMul ?? 1) * weight.damageMul * (release?.damageMul ?? 1),
    poise: withRatio(stats, base.poise, base.poiseRatio) * stats.poiseDamageMul * (level?.poiseMul ?? 1) * weight.poiseMul * (release?.poiseMul ?? 1),
    reach: base.reach * reachMul,
    size: base.size * reachMul,
    knockback: base.knockback * stats.knockbackMul * (release?.knockbackMul ?? 1),
    heavy: base.heavy,
    shape: base.shape,
    mana: base.mana,
    pull: base.pull ?? false,
    throw: base.throw ?? false,
    tip: stepTip(moveset.tip, base.shape),
    hits: Math.max(1, base.hits ?? 1) + (release?.hitsAdd ?? 0),
    hitstop: base.hitstop,
    shake: base.shake ?? 0,
    lunge: base.lunge ?? 0,
    trail: base.trail,
    applies: base.applies ?? [],
    cancel: base.cancel,
    invuln: base.invuln ?? 0,
    // 長柄: 放出の突きは貫く穂先の弾を撃ち、穂先を持つ突きは敵弾を払う（data/weaponForms.ts）
    cast: base.cast ?? formReleaseCast(moveset, base, release !== undefined),
    cutsBullets: (base.cutsBullets ?? false) || formCutsBullets(moveset, base),
    ...(base.knockToward ? { knockToward: base.knockToward } : {}),
    ...(release ? { release: true } : {}),
    ...(base.drivePins !== undefined ? { drivePins: base.drivePins } : {}),
    ...(base.passThrough ? { passThrough: true } : {}),
    ...(base.manaPerTarget !== undefined ? { manaPerTarget: base.manaPerTarget } : {}),
  };
}

/** 段が持つ先端判定。突きの段と、sweep の武器種（棍）の薙ぎ・回しの段だけが持つ */
function stepTip(tip: TipDef | undefined, shape: Readonly<HitShape>): TipDef | undefined {
  if (!tip) return undefined;
  if (shape.kind === "thrust") return tip;
  return tip.sweep === true && (shape.kind === "arc" || shape.kind === "circle") ? tip : undefined;
}

/** 今の振りの段（描画用。振っていなければ undefined） */
export function currentMeleeStep(state: GameState): MeleeStep | undefined {
  const p = state.player;
  if (!isAttacking(p)) return undefined;
  return meleeStep(state.stats, p.attack.step, p.dashStrike, p.attack.chargeLevel, p.attack.branch, playerMoveset(state), p.attack.lane, swingReleaseMul(state));
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
  // 銃の弾倉（込めは振り・ダッシュ・怯みの最中も進む。弾が替わったら作り直す）
  tickMagazine(state, input, dt);
  // 戦意と共通の瞬間（止まっている秒を数えるので入力を渡す）
  tickFormState(state, input, dt);
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
  relicStride(state, dt);
  tickNamedRelics(state);
  const shotHeld = shotButtonHeld(state, input);
  // 射撃は左で撃つ武器種だけ（docs/ideas/weapon-redesign.md 0 章）。持ち替えたら溜め撃ち・三点の残りを捨てる
  const canShoot = shotHeld && !staggered && !skillLocksAttack(state) && !artLocksActions(state);
  if (shootsPrimary(playerMoveset(state))) updateShooting(state, canShoot, dt, aimDistance(state, input));
  else {
    resetShooting(p);
    // 技の弾の連射（手裏剣の左の 3 連射）は左で撃たない武器種でも続ける
    updateBurst(state, dt);
  }
  // 右の「押した瞬間」は前フレームとの差で取る（FrameInput は押しっぱなししか持たない）
  p.secondaryWasHeld = input.shootHeld;
  if (state.stats.traits.unmoving > 0) p.knock = { x: 0, y: 0 };
  trackDamageDealt(state);
}

/** ダッシュ・近接・奥義の入力を読む（怯み中は呼ばない） */
function readActions(state: GameState, input: FrameInput): void {
  releaseFrozenInput(state);
  if (input.dashPressed && !skillLocksDash(state) && !parryLocksDash(state)) tryDash(state, input);
  if (input.parryPressed) startParry(state);
  if (!skillLocksAttack(state) && !artLocksActions(state) && !dashLocksActions(state)) {
    readAttackButtons(state, input);
    // 二丁拳銃の覚えておいた押下（振りの最中・手の間に押した分）を出せるようになったら出す
    tickDualPistols(state);
  }
  // 奥義は常にスキルをキャンセルできる
  if (input.specialPressed && tryUltimate(state)) cancelSkills(state);
}

/**
 * ヒットストップ中の押下を覚える（core/game.ts の止めの分岐から毎ステップ）。止まっている間は updatePlayer が通らず、
 * 押した瞬間の入力が 1 ステップで消えるので、受け流し・ダッシュは守りの席へ、攻撃はボタンだけ覚える。
 * 後から押した方だけ残す。外した受け流しの硬直中・怯み中の押下は今どおり捨てる（連打の罰を消さない）
 */
export function latchFrozenInput(state: GameState, input: FrameInput): void {
  const p = state.player;
  // 右は押しっぱなししか来ないので、止めの間も前のステップとの差で押した瞬間を取る（押しっぱなしで毎ステップ覚え直し、
  // 後から押した受け流し・ダッシュを消さないように）
  const secondaryPressed = input.shootHeld && !p.secondaryWasHeld;
  p.secondaryWasHeld = input.shootHeld;
  if (isPlayerStaggered(p)) return;
  if (input.dashPressed) {
    p.guardBuffer = { kind: "dash", input: { ...input } };
    p.frozenAttack = undefined;
  } else if (input.parryPressed && p.parry.recover <= 0) {
    p.guardBuffer = { kind: "parry", input: { ...input } };
    p.frozenAttack = undefined;
  }
  const attack: ButtonKey | undefined = input.attackPressed ? "primary" : secondaryPressed ? "secondary" : undefined;
  if (attack === undefined) return;
  p.frozenAttack = attack;
  p.guardBuffer = undefined;
}

/** 止めが明けた最初のステップで、覚えていた押下を出す（readActions の頭。守りが先、攻撃が後で、後から押した方だけが残っている） */
function releaseFrozenInput(state: GameState): void {
  const p = state.player;
  const guard = p.guardBuffer;
  const attack = p.frozenAttack;
  p.guardBuffer = undefined;
  p.frozenAttack = undefined;
  if (guard?.kind === "dash" && !skillLocksDash(state) && !parryLocksDash(state)) tryDash(state, guard.input);
  if (guard?.kind === "parry") startParry(state);
  if (attack === undefined || skillLocksAttack(state) || artLocksActions(state) || dashLocksActions(state)) return;
  onButtonPress(state, attack);
  // 右は「前フレームとの差」で押した瞬間を取るので、続く readAttackButtons が同じ押下をもう一度拾わないようにする
  if (attack === "secondary") p.secondaryWasHeld = true;
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
  // 二丁拳銃は左右とも手の銃（左 = 左手、右 = 右手）。連続・同時押し・弾切れの手は system/dualPistols.ts が決める
  if (firesByHand(moveset)) {
    pressHand(state, button === "primary" ? 0 : 1);
    return;
  }
  // 込めの最中の短銃の左は早込め（押下を使う）。撃てない引き金は空撃ちの音
  if (button === "primary" && shootsPrimary(moveset) && pressTrigger(state)) return;
  // 投げた輪が戻るまでは左も右も何も出さない（戦輪。受け流しとダッシュは別の入力なので出せる）
  if (waitingForReturn(state, moveset)) return;
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
  if (!shootsPrimary(moveset)) {
    tryAttack(state, moveset.primary === "charge");
    return;
  }
  // 左で撃つ武器種はダッシュ中の押下を反転撃ち（ダッシュ攻撃）として予約する
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
 * 次の段が弾（volley）なら recover 中は振りを打ち切ってすぐ出す（先行入力と同じ手触り）
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

/** 戻るまで投げられない武器種（MovesetDef.waitForReturn）で、投げた輪がまだ飛んでいるか */
function waitingForReturn(state: GameState, moveset: MovesetDef): boolean {
  return moveset.waitForReturn === true && ringsInFlight(state);
}

/** 射撃の押しっぱなし。左で撃つ武器種の左だけ（近接の武器種は撃たない。二丁拳銃は 1 クリック 1 発なので押しっぱなしで撃たない） */
function shotButtonHeld(state: GameState, input: FrameInput): boolean {
  if (shapeLocksShot(state)) return false;
  const moveset = playerMoveset(state);
  return shootsPrimary(moveset) && !firesByHand(moveset) && input.attackHeld;
}

/** 実際に出た段のボタンを派生の入力列に積む。長さは chainMaxInputs まで */
export function logButton(p: Player, button: ButtonKey): void {
  const a = p.attack;
  a.inputs.push(button);
  if (a.inputs.length > WEAPON.chainMaxInputs) a.inputs.shift();
  a.inputTimer = WEAPON.chainWindow;
}

/**
 * 入力列が途切れた（窓が切れて振っていない）ら捨て、段カウンタも 1 段目へ戻す（構え中は構えの段を保つ）。
 * 窓は振っていない・溜めていない間だけ減らす（振り終わり・撃ち終わりから数える）: 振りが窓より長い重い武器や、
 * 撃つ溜め（火縄銃・手砲）を溜め切ってから撃っても連撃を続けられる（P3。docs/ideas/gun-bases-review.md 0-4）
 */
function tickButtonChain(p: Player, dt: number, paused: boolean): void {
  const a = p.attack;
  // 投げた輪が戻るのを待つ間（戦輪）も窓を減らさない（戻ってから続きを出せる）
  if (a.phase !== "none" || a.charging || p.shotCharging || paused) return;
  a.inputTimer = Math.max(0, a.inputTimer - dt);
  if (a.inputTimer > 0) return;
  a.inputs.length = 0;
  if (!p.art.holding) a.step = 0;
}

/** 近接を出せない状態（ダッシュ中） */
function meleeBlocked(state: GameState): boolean {
  return isDashing(state.player);
}

/**
 * 出た段の列（予約中の段を含む）に今の押下を足した列の末尾が派生に一致したら派生を出す
 * （振っている最中なら今の振りの後に予約）。出したら true
 */
function tryBranch(state: GameState, moveset: MovesetDef, button: ButtonKey): boolean {
  const p = state.player;
  const index = matchBranch(moveset, [...plannedInputs(state), button]);
  if (index === undefined || meleeBlocked(state)) return false;
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
  // 連ね投げ（時間の放出）の間は振りも射撃も速い
  const mul = frenzyMul(state) * timedAttackSpeedMul(state);
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
  tickParry(state, dt);
  p.invulnTimer = Math.max(0, p.invulnTimer - dt);
  p.hitFlash = Math.max(0, p.hitFlash - dt);
  p.swingImpact = Math.max(0, p.swingImpact - dt);
  p.shootCooldown = Math.max(0, p.shootCooldown - dt);
  p.justTimer = Math.max(0, p.justTimer - dt);
  p.buffs.damage.time = Math.max(0, p.buffs.damage.time - dt);
  p.buffs.speed.time = Math.max(0, p.buffs.speed.time - dt);
  p.buffs.invuln = Math.max(0, p.buffs.invuln - dt);
  p.lifeOnHitWindow.timer = Math.max(0, p.lifeOnHitWindow.timer - dt);
  tickRegain(state, dt);
  tickButtonChain(p, dt, waitingForReturn(state, playerMoveset(state)));
  tickTriggerCooldowns(state, dt);
  tickHpRegen(state, dt);
  tickDelayedDamage(state);
  if (p.dashTimer > 0) {
    tickDashForm(state);
    p.dashTimer = Math.max(0, p.dashTimer - dt);
    // ダッシュが終わった直後、猶予ぶんの無敵を残す
    if (p.dashTimer === 0) {
      p.invulnTimer = Math.max(p.invulnTimer, PLAYER.dash.graceInvuln);
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

/**
 * 振っている最中にダッシュで取り消せるか（武器の重さ。docs/ideas/combat-core-impl.md 2-5）。
 * 発生（windup）は全重さで取り消せない。持続（active）は lockActive、硬直（recover）は最初の lockRecoverRatio まで取り消せない。
 * 振っていない・溜め中・構え中（振りの相ではない）は常に取り消せる
 */
export function canDashCancel(state: GameState): boolean {
  const p = state.player;
  if (!isAttacking(p)) return true;
  // 詰め足（剣士の流儀）は持続・硬直の途中でも出せる
  if (dashIgnoresSwingLock(state)) return true;
  const step = currentMeleeStep(state);
  if (!step) return true;
  const weight = WEAPON.weightClass[playerMoveset(state).weight];
  if (p.attack.phase === "windup") return false;
  if (p.attack.phase === "active") return !weight.lockActive;
  return p.attack.timer <= step.recover * (1 - weight.lockRecoverRatio);
}

function tryDash(state: GameState, input: FrameInput): void {
  const p = state.player;
  if (p.dashChargesLeft <= 0 || isDashing(p)) return;
  // 取り消せない相の入力は捨てる（回数も減らさない。手触りで不満が出たら先行入力を足す）
  if (!canDashCancel(state)) return;
  p.dashChargesLeft -= 1;
  if (p.dashCooldown <= 0) p.dashCooldown = dashCooldownTime(state.stats);
  // 流儀の不退（と祝福「鉄壁の構え」）はダッシュの代わりにその場で構える
  if (replaceDash(state)) return;
  p.dashDir = dashDirection(state, input);
  p.facing = { ...p.dashDir };
  p.knock = { x: 0, y: 0 };
  // ダッシュで攻撃・溜め・予約した派生をキャンセルできる（手触り重視）。詰め足は取り消す前に次の段を覚える
  keepChainThroughDash(state);
  cancelAttack(state);
  cancelCharge(p);
  endArtHold(state);
  p.attack.pendingBranch = -1;
  spawnBurst(state, p.body.pos, "#ffffff", 6, 40, 0.2, 1.5);
  pushSfx(state, "dash");
  emitNoise(state, p.body.pos, "dash");

  // 秒・無敵・始まりの効果は流儀のダッシュの形が決める（system/dashForms.ts）
  if (hasKeystone(state, KS.blink)) blink(state);
  else runDashForm(state);
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

/**
 * 攻撃中の移動倍率。武器種の attackMoveMul を重さの帯に丸め、終撃（最終段・フィニッシュ派生）は重さごとの倍率で上書きする。
 * 溜め中（chargeMul）・構え中（artMoveMul）は呼び出し側で別に掛ける
 */
export function attackMoveMulOf(moveset: MovesetDef, combo: number): number {
  const w = WEAPON.weightClass[moveset.weight];
  if (combo === FINISHER_COMBO && w.finisherMoveMul >= 0) return w.finisherMoveMul;
  return Math.min(w.moveMulMax, Math.max(w.moveMulMin, moveset.attackMoveMul));
}

function updateMovement(state: GameState, input: FrameInput, dt: number, aiming: boolean): void {
  const p = state.player;
  let vel: Vec;
  if (isDashing(p)) {
    vel = scale(p.dashDir, dashSpeed(state));
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
      (isAttacking(p) ? attackMoveMulOf(moveset, p.attack.combo) : 1) *
      chargeMul *
      artMoveMul(state) *
      ultimateMoveMul(state) *
      skillMoveMul(state) *
      boonMoveMul(state) *
      // 銃の込めの最中の足（武器種の reloadMoveMul）
      reloadMoveMul(state) *
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
    pushPlayerEvent(state, "onDashEnd", "dash");
  }
  // 壁に止められた軸の速度は残さない（氷床の滑りが前の速度を引き継ぐので、壁へ押し付けた速度が溜まらないように）
  p.body.vel = { x: hit.hitX ? 0 : vel.x, y: hit.hitY ? 0 : vel.y };
  if (!isZero(input.move) && !isDashing(p)) p.walkTime += dt;
}

/** 近接の連撃ボタン。charge は押したボタンが「溜め」の役割か */
function tryAttack(state: GameState, charge = false): void {
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

/**
 * 二丁拳銃の手の技（蹴り・回し蹴り・銃把打ち）を lane の index 段目として振る（system/dualPistols.ts）。
 * 段は共有の段カウンタではなく手の連続で決まるので、終撃かは呼び手が渡す（祝福の「常に最終段」は掛けない）
 */
export function startHandSwing(state: GameState, lane: ButtonKey, index: number, finisher: boolean): void {
  if (isDashing(state.player)) return;
  beginSwing(state, { step: index, dashStrike: false, chargeLevel: 0, branch: -1, combo: finisher ? FINISHER_COMBO : 0, lane });
}

/** 次の段を振る。logAs は派生の列に積むボタン（省略は振りのレーン） */
function startNextSwing(state: GameState, logAs?: ButtonKey): void {
  startSwing(state, state.player.attack.step, false, 0, "primary", logAs);
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
  // 回しは区切りごとが 1 つの突き。その時点の予告の色で出端を判定する
  p.attack.startedAt = state.time;
  p.attack.readIds.clear();
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
  addHeadLabel(state, state.player.body.pos, branch.name, FEEL.branchTextColor, FEEL.branchTextLife);
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
  if (relicBlocksSwing(state, spec.dashStrike)) return;
  const p = state.player;
  const moveset = playerMoveset(state);
  const plain = meleeStep(actionStats(state), spec.step, spec.dashStrike, spec.chargeLevel, spec.branch, moveset, spec.lane);
  if (!plain) return;
  // 放出の段なら戦意を振りの開始で使う（空振りでも消える）。その振りの間は放出の倍率で数える
  const release = startSwingMoments(state, moveset, spec);
  const step = release ? (meleeStep(actionStats(state), spec.step, spec.dashStrike, spec.chargeLevel, spec.branch, moveset, spec.lane, release) ?? plain) : plain;
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
  // 振り始めで三点の続きを捨てる（振りの最中に撃ち続けない）。派生の弾の三点は振り始めの後（onBranchStart）に積むので残る
  p.shotBurst.queue.length = 0;
  a.hitIds.clear();
  a.readIds.clear();
  a.startedAt = state.time;
  a.hitTick = 0;
  a.dir = { ...p.facing };
  // 抜け斬りは振り始めの位置から今の位置までの道筋で斬る。斬った敵ごとの気力は頭打ちを外す
  a.passFrom = step.passThrough ? { ...p.body.pos } : undefined;
  a.uncappedMana = step.manaPerTarget !== undefined ? true : undefined;
  if (step.invuln > 0) p.invulnTimer = Math.max(p.invulnTimer, step.invuln);
  const sfx = SLASH_SFX[spec.combo];
  if (sfx) pushSfx(state, sfx);
  onSwingFx(state);
  payOverclock(state, PLAYER.overclockHpCost);
  pushSwingEvent(state, spec.combo, spec.dashStrike, step.damage);
  ultimateOnSwing(state);
}

function updateAttack(state: GameState, dt: number): void {
  const p = state.player;
  const a = p.attack;
  if (a.phase === "none") return;
  const step = meleeStep(actionStats(state), a.step, p.dashStrike, a.chargeLevel, a.branch, playerMoveset(state), a.lane, swingReleaseMul(state));
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
      noteShapeSwing(state);
      // 詠唱の弾は active の瞬間に 1 回だけ（予約のまま捨てられた振りでは出さない）
      if (step.cast) emitArtVolley(state, step.cast.throw, castOverride(state, a.lane));
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
  // 投げた輪が戻るまでは先行入力も派生の予約も出さず、次の段を覚えて待つ（戦輪）
  if (holdChainForReturn(state, moveset)) return;
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
  // 最終段・フィニッシュの後は少し間を置く。効くのは左で撃つ武器種（右レーンの振りの後に撃てる）だけ
  if (shootsPrimary(moveset)) p.shootCooldown = Math.max(p.shootCooldown, PLAYER.comboLockout);
  a.inputs.length = 0;
}

/**
 * 戻るまで投げられない武器種（戦輪）で、この振りが投げた輪がまだ飛んでいるなら、連撃を終えずに次の段を覚えて待つ
 * （先行入力は捨てる。輪が戻ってから押すと続きの段が出る。窓は戻るまで減らない）。待ったら true
 */
function holdChainForReturn(state: GameState, moveset: MovesetDef): boolean {
  const p = state.player;
  const a = p.attack;
  if (!waitingForReturn(state, moveset)) return false;
  const next = nextStepAfter(moveset, a, p.dashStrike, "secondary") ?? nextStepAfter(moveset, a, p.dashStrike, "primary");
  if (next === undefined) return false;
  resetSwing(state);
  a.pendingBranch = -1;
  a.step = next;
  a.inputTimer = WEAPON.chainWindow;
  return true;
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
  a.passFrom = undefined;
  a.uncappedMana = undefined;
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
  // 交互の連撃（手裏剣）: 同じ手を続けても段はそのまま、左右を替えたときだけ進む
  // 最後の段は同じ手でも続かない（大手裏剣を押しっぱなしの連打で出し続けない）
  const stay = moveset.chainAdvance === "alternate" && a.branch < 0 && !dashStrike && lane === a.lane && a.step + 1 < laneLength(moveset, lane);
  const next = a.branch >= 0 && !dashStrike ? moveset.branches[a.branch]?.next : stay ? a.step : a.step + 1;
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

/** 近接の当たり方。tip は先端（穂先・鞭の先・棍の棒先） */
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
      if (!circlesOverlap(c.x, c.y, step.size / 2, pos.x, pos.y, radius)) return "none";
      return rimContact(step, length(sub(pos, c)) + radius, step.size / 2);
    }
    case "arc":
      if (!arcContains(origin, dir, step.reach, step.shape.deg, pos, radius)) return "none";
      return rimContact(step, length(sub(pos, origin)) + radius, step.reach);
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

/** 薙ぎ・回しの先端（棍）: 中心からの遠い縁 far が外周 tip.ratio に入れば tip。先端判定の無い段は hit */
function rimContact(step: Readonly<MeleeStep>, far: number, rim: number): MeleeContact {
  if (!step.tip) return "hit";
  return far >= rim * (1 - step.tip.ratio) ? "tip" : "hit";
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
    // 従魔（眷属）は斬り抜ける（命中・ヒットストップ・気力を起こさない）
    if (p.attack.hitIds.has(e.id) || e.hp <= 0 || isAllied(state, e)) continue;
    const contact = passContact(p, e) ? "hit" : meleeContact(p, step, e.body.pos, e.body.radius);
    if (contact === "none") continue;
    p.attack.hitIds.add(e.id);
    meleeHitEnemy(state, e, step, contact === "tip");
  }
  resolveMeleeBullets(state, step);
}

/** 抜け斬りの道筋（振り始めの位置 → 今の位置）で自分の体が敵の体に重なったか */
function passContact(p: Player, e: Enemy): boolean {
  const from = p.attack.passFrom;
  if (!from) return false;
  const to = p.body.pos;
  const seg = sub(to, from);
  const len2 = seg.x * seg.x + seg.y * seg.y;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((e.body.pos.x - from.x) * seg.x + (e.body.pos.y - from.y) * seg.y) / len2)) : 0;
  const nearest = add(from, scale(seg, t));
  return circlesOverlap(nearest.x, nearest.y, p.body.radius, e.body.pos.x, e.body.pos.y, e.body.radius);
}

/**
 * 近接の active と敵弾。デフォルトでは素通りする（docs/COMBAT_DESIGN.md C-1 の 5 / 6）。
 * 性質「弾斬り」か段の cutsBullets（扇子の払い）なら消す
 */
function resolveMeleeBullets(state: GameState, step: MeleeStep): void {
  if (state.stats.bulletCut <= 0 && !step.cutsBullets) return;
  for (const pr of state.projectiles) {
    if (pr.owner !== "enemy" || pr.life <= 0) continue;
    if (meleeContact(state.player, step, pr.pos, pr.radius) === "none") continue;
    cutProjectile(state, pr);
    // 敵弾を消した: 扇の風と応手
    gainMorale(state, "bulletCut");
    noteRiposte(state, "bulletCut");
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

/**
 * 近接 1 ヒット。予告が下絵の間に振り始めた一撃なら出端（命中の瞬間に墨入れへ入っていても。system/readTiming.ts）。tip は先端に当たった。
 * 威力・怯み値は多段の命中ごとに掛かるが、出来事（音・イベント・応手）は 1 振り × 1 体に 1 回
 */
function meleeHitEnemy(state: GameState, e: Enemy, step: MeleeStep, tip = false): void {
  const p = state.player;
  const counter = yellowAt(e, p.attack.startedAt);
  const firstOnEnemy = !p.attack.readIds.has(e.id);
  p.attack.readIds.add(e.id);
  const tipMul = tipMultipliers(step, tip);
  // 型の印（穂先の戦意・鎖の繋ぎ・裂きが開く傷。system/formMarks.ts）
  const formMul = onFormMeleeHit(state, e, step, tip, counter);
  const out = rollOutgoing(state, e, step.damage * tipMul.damage * formMul.damage, "melee", { release: step.release, counter });
  const amount = counter ? Math.round(out.amount * ACTION.counter.damageMul) : out.amount;
  const weight = WEAPON.weightClass[playerMoveset(state).weight];
  const baseHitstop = step.hitstop ?? (step.heavy ? FEEL.hitstopHeavy : weight.hitstop);
  if (step.shake > 0) shake(state, step.shake);
  const pos = { ...e.body.pos };
  const slam = releaseSlamMul(state, step);
  if (step.heavy || slam > 1) e.wallSplat = true;
  // 武器種の最終段・フィニッシュ派生・終撃になる放出の命中（docs/ideas/combat-feel-design.md D-1 / D-5）
  const finisher = p.attack.combo === FINISHER_COMBO || (step.release === true && releaseIsFinisher(state));
  p.swingImpact = FEEL.swingImpact;
  if (finisher) pushSfx(state, "finisherHit");
  // 重さの補償の副次（docs/ideas/weapon-forms-impl.md 3-5）: 終撃は重いほど押し、重い武器の終撃は堅守を崩す
  damageEnemy(state, e, amount, knockDirection(state, e, step), step.knockback * (finisher ? weight.finisherKnockbackMul : 1) * slam, {
    poise: counterPoise(step, counter) * tipMul.poise * formMul.poise,
    hitstopSteps: baseHitstop,
    readStart: counter,
    counterStop: counter && firstOnEnemy,
    energy: stepHitEnergy(state, step),
    kind: "melee",
    crit: out.crit,
    guardBreak: counter || (finisher && weight.finisherGuardBreak),
    finisher,
    finisherHitstop: weight.hitstopFinisher,
    release: step.release,
    lane: p.attack.lane,
    impact: { family: hitFamily(playerMoveset(state).key), weight: meleeHitWeight(step, p.attack.combo), weapon: playerMoveset(state).key },
  });
  if (firstOnEnemy) noteReadOutcome(state, e, pos, counter);
  // 通常の振りの命中の戦意は多段の区切りごとに 1 回（群れを薙いで一気に満たさない）
  if (p.attack.hitIds.size === 1) gainMorale(state, "meleeHit");
  // 抜け斬りは斬った敵 1 体ごとに決まった気力（多段で重ねない）
  if (step.manaPerTarget === undefined) gainMeleeMana(state, step.mana * tipMul.mana, counter);
  else if (firstOnEnemy) gainMeleeMana(state, step.manaPerTarget, counter);
  noteMeleeHitMana(state, tip, p.dashStrike);
  p.meleeHitCount += 1;
  fireTrigger(state, "onMeleeHit", { pos, targetId: e.id });
  fireTrigger(state, "everyNthMeleeHit", { pos, targetId: e.id });
  pushSwingHitEvent(state, e, p.attack.combo, p.dashStrike);
  ultimateOnSwingHit(state, e);
  onSkillMeleeHit(state, e, p.attack.combo);
  onShapeMeleeHit(state, e);
  applyStepStatus(state, e, step);
  // 叩き込み（クナイ）: 刺さった飛び物を 1 振り × 1 体に 1 回叩き込む（段が決めた本数。true は全部）
  if (step.drivePins !== undefined && firstOnEnemy && e.hp > 0) drivePins(state, e, p.attack.dir, { max: step.drivePins === true ? undefined : step.drivePins, mul: ultimatePinDriveMul(state) });
}

/** 壁際（大地の加護）: 放出の一撃は大きく弾き、壁に当たれば叩きつけにする。吹き飛ばしの倍率（持っていない・放出でなければ 1） */
export function releaseSlamMul(state: GameState, step: Readonly<MeleeStep>): number {
  if (step.release !== true || !hasBoon(state, EARTH_WALL_SLAM_KEY)) return 1;
  return BOON_LINEAGE.earth.earthWallSlam.knockMul;
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

/** ノックバックの向き。引き寄せ（鎌）は自分の方へ、投げ（拳）は自分の背後へ、蹴り込み（仕掛け）は一番近い自分の設置弾の方へ */
function knockDirection(state: GameState, e: Enemy, step: Readonly<MeleeStep>): Vec {
  const p = state.player;
  if (step.pull) return normalize(sub(p.body.pos, e.body.pos), scale(p.attack.dir, -1));
  if (step.throw) return scale(p.attack.dir, -1);
  // 抜け斬りは前へ押さず、道筋の脇へ払う（すり抜けた敵を押して連れて行かない）
  if (step.passThrough) return sideAway(p.attack.dir, sub(e.body.pos, p.body.pos));
  if (step.knockToward === "ownMine") {
    const mine = nearestOwnMine(state, e.body.pos);
    if (mine) return normalize(sub(mine, e.body.pos), p.attack.dir);
  }
  return p.attack.dir;
}

/** 向き dir の道筋から見て rel（自分 → 敵）の側へ直交する向き（真正面なら左手側） */
function sideAway(dir: Vec, rel: Vec): Vec {
  const left = { x: -dir.y, y: dir.x };
  return rel.x * left.x + rel.y * left.y >= 0 ? left : scale(left, -1);
}

/**
 * 近接命中のマナ回収（docs/COMBAT_DESIGN.md B-1）。段ごとの量、ダッシュ攻撃は別枠、カウンターなら倍。
 * 1 振りで回収する敵は meleeTargetCap 体まで（群れを薙いで一気に満タンにしない）
 */
function gainMeleeMana(state: GameState, base: number, counter: boolean): void {
  // 抜け斬り（manaPerTarget）は斬った敵の数だけ戻すので頭打ちしない
  if (state.player.attack.uncappedMana !== true && state.player.attack.hitIds.size > MANA.meleeTargetCap) return;
  // 静寂の誓い（ks_silentVow）では通常攻撃からマナが戻らない
  const mul = counter ? MANA.onCounterMul : 1;
  // 流儀の下地（見習いは 1、他は JOB.manaBaseMul。system/manaSources.ts）
  gainWeaponMana(state, base * mul * attackHitManaMul(state), attackManaMul(state));
}

/** 近接 1 ヒットの怯み値。カウンターは確定の怯みではなく怯み値を倍にする（敵の強靭 ×0.5 と相殺して等倍になる） */
export function counterPoise(step: Readonly<MeleeStep>, counter: boolean): number {
  return counter ? step.poise * ACTION.counter.poiseMul : step.poise;
}

/**
 * 命中の読みの結果の出来事（1 振り × 1 体に 1 回）。出端なら音・粒・白黒・墨の飛沫と起点・応手、
 * 墨入れの間の普通の命中なら鈍い打音だけ（倍も盾抜けも無いと音で伝える）
 */
function noteReadOutcome(state: GameState, e: Enemy, pos: Vec, counter: boolean): void {
  const p = state.player;
  if (!counter) {
    noteCommittedHit(state, e);
    return;
  }
  fireDebana(state, e, pos);
  // ボスには答えとして届ける（damageEnemy の後。怯み値で先に怯んでいても答えは数える）
  bossOnAnswer(state, e, "debana");
  // 右の溜め（居合）を離した振りの出端は居合の応手、それ以外はカウンターの応手
  noteRiposte(state, p.attack.chargeLevel > 0 && p.attack.lane === "secondary" ? "iai" : "counter", e);
}

/** 性質「弾斬り」: 敵弾を斬って消す（撃ち返しはしない） */
function cutProjectile(state: GameState, pr: Projectile): void {
  const c = ACTION.bulletCut;
  pr.life = 0;
  spawnBurst(state, pr.pos, c.color, c.particles, 80, 0.2, 1.5);
}

/** ダッシュ中に予約した攻撃を、ダッシュが終わった瞬間に出す */
function releaseDashAttack(state: GameState): void {
  const p = state.player;
  if (!p.dashAttackQueued || isDashing(p)) return;
  p.dashAttackQueued = false;
  if (skillLocksAttack(state) || isPlayerStaggered(p)) return;
  cancelAttack(state);
  // 詰め足（剣士の流儀）はダッシュ攻撃にせず、覚えた段から連撃を続ける
  if (dashKeepsChain(state)) startNextSwing(state);
  else startSwing(state, 0, true);
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
  updateBurst(state, dt);
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
 * 三点の続きの弾。1 本目は fireVolley（派生の弾は emitShotRounds）が撃ち、残りを向きごとに interval 秒おきに出す。
 * 続きも 1 本目と同じ射撃として、撃った弾（持続の奥義の差し替え済み）と放出の倍率を持ち越す（P4）。終撃は 1 本目だけ。
 * 怯み・撃てないダッシュ・器の付け替えで残りは捨てる（振り始めは beginSwing が捨てる）
 */
function updateBurst(state: GameState, dt: number): void {
  const b = state.player.shotBurst;
  if (b.queue.length === 0) return;
  if (!canContinueBurst(state)) {
    b.queue.length = 0;
    return;
  }
  const equipped = currentShot(state.stats).key;
  for (const entry of b.queue) stepBurstEntry(state, entry, equipped, dt);
  b.queue = b.queue.filter((entry) => entry.left > 0);
}

/** 三点の続き 1 つぶんを進め、間が来たら 1 本撃つ。器を付け替えていたら残りを捨てる */
function stepBurstEntry(state: GameState, entry: BurstEntry, equipped: string, dt: number): void {
  if (entry.art !== true && entry.shot.key !== equipped) {
    entry.left = 0;
    return;
  }
  entry.timer -= dt;
  if (entry.timer > BURST_EPSILON) return;
  entry.left -= 1;
  entry.timer += entry.shot.burst?.interval ?? 0;
  emitVolley(state, entry.shot, 0, undefined, { ...entry.override, angleOffset: entry.angle });
}

function canContinueBurst(state: GameState): boolean {
  const p = state.player;
  if (isPlayerStaggered(p)) return false;
  return !isDashing(p);
}

/**
 * 三点の器なら、向き（facing からのずれ）ごとに続きの弾を積む。続きは 1 本目の上書きから、放出の印（終撃・会心）と
 * レーン・扇を外したもの（放出の倍率は残し、揺れも掛けない。続きは左の射撃 1 回に数えない）
 */
function queueBurst(state: GameState, shot: BulletDef, angles: readonly number[], override: VolleyOverride, art = false): void {
  const burst = shot.burst;
  if (!burst || burst.count <= 1) return;
  const follow = burstFollowOverride(override);
  for (const angle of angles) {
    state.player.shotBurst.queue.push({ shot, angle, override: { ...follow }, left: burst.count - 1, timer: burst.interval, ...(art ? { art: true as const } : {}) });
  }
}

/** 技の弾（振りの cast・弾の段）が連射の弾（BulletDef.burst）なら、続きを積む（手裏剣の左の 3 連射。system/weaponArts.ts の emitArtVolley） */
export function queueArtBurst(state: GameState, shot: BulletDef, override: VolleyOverride): void {
  queueBurst(state, shot, [0], override, true);
}

/** 三点の続きが 1 本目から持ち越す上書き */
function burstFollowOverride(override: VolleyOverride): VolleyOverride {
  const follow: VolleyOverride = { ...override };
  delete follow.release;
  delete follow.lane;
  delete follow.fan;
  delete follow.angleOffset;
  if (override.release || override.steady) follow.steady = true;
  return follow;
}

/** 銃を持っていない間は射撃の途中経過を持ち越さない（技の弾の連射は残す） */
function resetShooting(p: Player): void {
  cancelShotCharge(p);
  if (p.shotBurst.queue.some((e) => e.art !== true)) p.shotBurst.queue = p.shotBurst.queue.filter((e) => e.art === true);
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

/** 射撃できる状態か（再使用待ち・近接中・溜め中・ダッシュ中・弾倉が空か込めの最中） */
function canShootNow(state: GameState): boolean {
  const p = state.player;
  if (p.shootCooldown > 0 || isAttacking(p) || p.attack.charging || !canFireAny(state)) return false;
  if (waitingForReturn(state, playerMoveset(state))) return false;
  return !isDashing(p);
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
 * 今の銃の弾とは別に弾を出す経路（右レーンの投擲・魔弾・乱れ撃ち、派生の弾、砲の詰めの 1 発）が差し替える値。
 * damage / poise は最終値（省略は銃の弾の値）、damageMul / pierceBonus は銃の弾の値に掛ける・足す
 */
export interface VolleyOverride {
  damage?: number;
  poise?: number;
  damageMul?: number;
  /** 銃の弾の怯み値に掛ける（短銃の強装填・装薬の詰め） */
  poiseMul?: number;
  pierceBonus?: number;
  count?: number;
  spreadDeg?: number;
  /** 弾の素性（ジャンル・属性）。弾の型の既定から変えるもの */
  attack?: AttackProfile;
  /** false なら反動を付けない（全周へ撒く技など） */
  recoil?: boolean;
  /** 弾の代わりに武器の絵を回して描く（斧の投擲など。ThrowArtDef.sprite） */
  sprite?: string;
  /** 命中・炸裂で付ける状態異常（ThrowArtDef.applies） */
  applies?: readonly StatusApply[];
  /** 撃ったレーン（双撃の判定。Projectile.lane） */
  lane?: ButtonKey;
  /** 放出の弾（Projectile.release） */
  release?: { finisher: boolean; crit: boolean };
  /** 弾の半径に掛ける（放出の倍率 reachMul。弾の当たりと絵が大きくなる） */
  radiusMul?: number;
  /** 向き（facing）からのずれ（ラジアン）。三点の続きが撃った回の向きを保つ */
  angleOffset?: number;
  /** 同じ形の 1 回を count 回、spreadDeg（度）ずつ扇にずらして同時に出す（派生の弾。省略は 1 回） */
  fan?: { count: number; spreadDeg: number };
  /** 揺れ（BulletDef.sway）を掛けない。放出の弾（release を持つ弾と、その三点の続き）は狙ったとおりに飛ぶ（P7） */
  steady?: boolean;
  /** 撃った手（二丁拳銃。その手の銃口から出す。省略は撃つたびに左右を入れ替える） */
  hand?: HandIndex;
}

function volleySpec(state: GameState, shot: BulletDef, level: number, aim?: number, override: VolleyOverride = {}): VolleySpec {
  const s = state.stats;
  const charged = level > 0 ? shot.charge?.levels[level - 1] : undefined;
  const damageMul = (charged?.damageMul ?? shot.damageMul) * (override.damageMul ?? 1);
  const speed = PLAYER.shoot.speed * shot.speedMul * s.projectileSpeedMul;
  return {
    damage: override.damage ?? shotDamage(s) * damageMul,
    poise: override.poise ?? shotPoise(s, shot, charged?.poiseMul ?? shot.poiseMul) * s.poiseDamageMul * (override.poiseMul ?? 1),
    radius: (charged?.radius ?? shot.radius) * (override.radiusMul ?? 1),
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
  if (bulletFeatures(shot).length === 0 && !shot.orbit && !shot.look && !shot.leaves && !shot.grind) return undefined;
  const lifeTotal = shot.boomerang || shot.lob ? { lifeTotal: life } : {};
  const orbit = shot.orbit ? { orbit: { ...shot.orbit }, orbitAngle: fireAngle, orbitPhase: orbitPhaseOf(orbitIndex), orbitTravel: 0 } : {};
  const extra = { ...(shot.leaves ? { leaves: shot.leaves } : {}), ...(shot.look ? { look: shot.look } : {}) };
  // 刺さる・食い込むは撃った瞬間の定義を写す（BULLETS に無い差し替えの弾でも効く）
  const thrown = { ...(shot.pin ? { pin: shot.pin } : {}), ...(shot.grind ? { grind: { sec: shot.grind.sec, hits: shot.grind.hits, done: 0, elapsed: 0 } } : {}) };
  return { key: shot.key, bouncesLeft: shot.bounce?.count, ...lifeTotal, ...orbit, ...extra, ...thrown };
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

/** 射撃 1 回（再使用時間を立てる。弾倉を 1 回ぶん使う）。三点なら残りの弾を予約する */
function fireVolley(state: GameState, level: number, aim?: number): void {
  const p = state.player;
  const s = state.stats;
  // 引き金 1 回で弾倉を 1 減らす（散弾の粒・三点の続きは数えない）。二丁拳銃は撃てる手の銃口から
  const hand = nextFireHand(state);
  // リロード後の 1 発目か（撃つと消えるので撃つ前に読む。長銃の関門・短銃の強装填の 1 発目）
  const fresh = p.magazine.fresh;
  if (hand === undefined || spendRounds(state, hand, 1) <= 0) return;
  const shot = ultimateShot(state, currentShot(s));
  p.shootCooldown = shotInterval(state, shot);
  // 放出の 1 発（長銃の満ちた 1 発・装薬の詰めた 1 発）と短銃の強装填の弾倉。放出の弾には揺れを掛けない（P7）
  const { powder, ...moments } = startShotMoments(state, { level, chargeLevels: shot.charge?.levels.length ?? 0, fresh });
  const steady = moments.release ? { steady: true } : {};
  // 装薬は詰めた段ぶん散弾の粒が増える
  const pellets = powder ? { count: s.projectileCount + shot.pellets + powder.pelletsAdd } : {};
  // 千本（苦無の放出）は扇に投げ、刺さりの上限を超えて全部刺さる
  const senbon = moments.release && formOf(playerMoveset(state)).key === "dart" ? KUNAI_SENBON : undefined;
  const override: VolleyOverride = { lane: "primary", ...moments, ...pellets, ...steady, ...(senbon ? { fan: { count: senbon.count, spreadDeg: senbon.spreadDeg } } : {}) };
  emitVolley(state, senbon && shot.pin ? { ...shot, pin: { ...shot.pin, max: senbon.pinMax } } : shot, level, aim, override);
  // 装薬の反動は詰めた段の距離だけ後ろへ跳ぶ（押しの速さは減衰で距離 = 速さ / KNOCK_DECAY。動きの当たりで壁に止まる）
  if (powder) p.knock = add(p.knock, scale(p.facing, -powder.recoilPx * KNOCK_DECAY));
  queueBurst(state, shot, [0], override);
}

/** 射撃 1 回の後の再使用の秒（連射の速さ・血の契約・持続の奥義を掛ける） */
function shotInterval(state: GameState, shot: BulletDef): number {
  const s = state.stats;
  return (PLAYER.shoot.cooldown * shot.cooldownMul) / (s.fireRateMul * frenzyMul(state) * ultimateFireRateMul(state) * timedAttackSpeedMul(state));
}

/**
 * 二丁拳銃の手 1 本の 1 発（system/dualPistols.ts）。その手の弾倉から 1 発使い、その手の銃口から撃つ。
 * 撃つ間（再使用）は手ごとに持つ（もう片方の手はすぐ撃てる）。撃てたら true
 */
export function fireHandVolley(state: GameState, hand: HandIndex): boolean {
  if (spendRounds(state, hand, 1) <= 0) return false;
  const shot = ultimateShot(state, currentShot(state.stats));
  state.player.magazine.hands[hand].cooldown = shotInterval(state, shot);
  const override: VolleyOverride = { lane: hand === 0 ? "primary" : "secondary", hand };
  emitVolley(state, shot, 0, state.player.aimDistance, override);
  queueBurst(state, shot, [0], override);
  return true;
}

/**
 * 普段の射撃を rounds.count 回、回ごとに扇へ spreadDeg（省略は弾の spreadDeg）ずつずらして同時に撃つ（派生の弾。
 * docs/ideas/gun-bases-review.md 0-3 の A 案）。1 回の形（1 + 装備の弾数 + 散弾の粒）は捨てず、三点の器は回の向きごとに三点の続きを積む。
 * 再使用時間は触らない。出したら true
 */
export function emitShotRounds(state: GameState, shot: BulletDef, rounds: { count: number; spreadDeg?: number }, override: VolleyOverride = {}): boolean {
  const fan = { count: Math.max(1, rounds.count), spreadDeg: rounds.spreadDeg ?? shot.spreadDeg };
  if (!emitVolley(state, shot, 0, state.player.aimDistance, { ...override, fan })) return false;
  queueBurst(state, shot, spreadOffsets(fan.count, fan.spreadDeg), override);
  return true;
}

/** 1 回の弾の角度（扇の回のずれ + 回の中の散らし）。fan が無ければ 1 回ぶん */
function volleyOffsets(count: number, spreadDeg: number, fan: VolleyOverride["fan"]): number[] {
  const inRound = spreadOffsets(count, spreadDeg);
  if (!fan || fan.count <= 1) return inRound;
  return spreadOffsets(fan.count, fan.spreadDeg).flatMap((round) => inRound.map((offset) => round + offset));
}

/**
 * 銃口の位置。二丁拳銃は撃った手（hand）の銃口で、手が無ければ撃つたびに左右を入れ替える。
 * 左右のずれは向きの右手側が正（render/renderMath.ts の offhandOffset と同じ）なので、左手は負の側
 */
function muzzleAt(state: GameState, dir: Vec, hand?: HandIndex): Vec {
  const p = state.player;
  const front = add(p.body.pos, scale(dir, p.body.radius + 2));
  if (playerMoveset(state).key !== "gunner") return front;
  const side = hand === undefined ? p.shotBurst.side : hand === 0 ? -1 : 1;
  p.shotBurst.side = -side;
  return add(front, scale({ x: -dir.y, y: dir.x }, WEAPON.movesets.gunner.muzzleOffset * side));
}

/** 短銃（型 pistol）が、盾持ちの零距離（FORM.pistol.zeroDistance）で撃ったか。盾を抜ける弾の印（docs/ideas/reading-core-impl.md 2-5） */
function shotIsPointBlank(state: GameState, muzzle: Vec): boolean {
  if (formOf(playerMoveset(state)).key !== "pistol") return false;
  return state.enemies.some((e) => e.hp > 0 && enemyDef(e.defKey).blocks === true && dist(e.body.pos, muzzle) <= FORM.pistol.zeroDistance);
}

/** 弾を出す（再使用時間は触らない。三点の続きの弾・右レーンと派生の弾もここを通る）。出したら true */
export function emitVolley(state: GameState, shot: BulletDef, level: number, aim?: number, override: VolleyOverride = {}): boolean {
  const p = state.player;
  const dir = { ...p.facing };
  const muzzle = muzzleAt(state, dir, override.hand);
  // 放出の弾には揺れを掛けない（P7。docs/ideas/gun-bases-review.md 0-3）
  const sway = override.steady || override.release ? 0 : swayOffset(state, shot);
  const baseAngle = angle(dir) + (override.angleOffset ?? 0) + sway;
  const spec = volleySpec(state, shot, level, aim, override);
  const firstShot = state.projectiles.length;
  const pointBlank = shotIsPointBlank(state, muzzle);
  let orbitIndex = shot.orbit ? orbitingCount(state) : 0;
  // 手元へ戻る弾は 1 回の投げの弾がすべて同じ組を持つ（行きと帰りの両方で当てた敵を数える）
  const trip = returnsToHand(shot) ? newShotTrip() : undefined;
  const offsets = volleyOffsets(spec.count, override.spreadDeg ?? shot.spreadDeg, override.fan);
  for (const offset of offsets) {
    for (const side of pairSides(shot)) {
      const runtime = shotRuntime(shot, spec.life, baseAngle + offset, orbitIndex);
      orbitIndex += 1;
      // 2 枚投げは口元を上下へずらし、弧の弾は行きの区間を作る
      const flight = launchThrow(state, shot, muzzle, baseAngle + offset, side, spec.speed, spec.life, aim);
      if (runtime && flight.arc) runtime.arc = flight.arc;
      if (runtime && trip) runtime.trip = trip;
      state.projectiles.push({
        id: allocId(state),
        owner: "player",
        pos: flight.pos,
        vel: scale(fromAngle(baseAngle + offset), spec.speed),
        radius: spec.radius,
        damage: spec.damage,
        life: flight.life,
        color: spec.color,
        kind: "ranged",
        hitIds: new Set(),
        pierceLeft: spec.pierce,
        poise: spec.poise,
        ...(runtime ? { shot: runtime } : {}),
        // 右レーンの弾（魔弾の光など）は段の素性を持つ。無ければ elementCombat が stats.bullet から引く
        ...(override.attack ? { attack: override.attack } : {}),
        ...(override.sprite ? { sprite: override.sprite } : {}),
        ...(override.applies && override.applies.length > 0 ? { applies: override.applies } : {}),
        ...(override.lane ? { lane: override.lane } : {}),
        // 放出の弾は撃った時刻を持つ（出端: 撃った時に敵が下絵だったか。system/readTiming.ts）
        ...(override.release ? { release: { ...override.release }, firedAt: state.time } : {}),
        ...(pointBlank ? { pointBlank: true } : {}),
      });
    }
  }
  const fired = state.projectiles.slice(firstShot);
  for (const pr of fired) markShotBullet(pr, shot.key);
  if (override.recoil !== false) p.knock = add(p.knock, scale(dir, -PLAYER.shoot.recoil * shot.recoilMul));
  const sparks = shot.look?.particles ?? MUZZLE_PARTICLES;
  spawnBurst(state, muzzle, spec.color, sparks, 60, 0.12, 1.5);
  // 描いた銃は胸の高さで前へ伸びるので、描画側が粒を描いた銃口へ付け替えられるよう生まれた位置を持たせる
  // （上限で古い粒が先頭から消えても、今出した粒は末尾に並ぶ）
  if (sparks > 0) for (const pt of state.particles.slice(-sparks)) pt.muzzleFrom = { ...muzzle };
  shake(state, 1);
  // 右レーンの弾も弾の性質で音を選ぶ（docs/ideas/weapon-redesign.md 6 章）
  pushSfx(state, shotSfxName(shot));
  payOverclockShoot(state);
  fireTrigger(state, "onShoot", { pos: muzzle });
  pushPlayerEvent(state, "onShoot", "ranged", { pos: { ...muzzle } });
  onSkillPlayerShoot(state);
  return true;
}
