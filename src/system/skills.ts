import type { FrameInput } from "../core/input";
import { type Enemy, type GameState, allocId, pushLog, pushSfx } from "../core/state";
import { type Vec, add, fromAngle, angle, length, normalize, scale, sub } from "../core/vec";
import { screenToWorld } from "../core/view";
import { enemyDef } from "../data/enemies";
import { FEEL, PLAYER } from "../data/tuning";
import { rectCenterPx } from "../map/grid";
import {
  MODIFIERS,
  SKILL,
  SKILL_DEFS,
  activeModifiers,
  canAttach,
  castBurden,
  castInterval,
  resolveCast,
  stoneLabel,
} from "../skills/data";
import { rollRuneModifier } from "../skills/generator";
import { refundMana, skillHit, skillPower, tickCurses } from "../skills/hit";
import { addStone, saveSkillProfile, stoneInSlot } from "../skills/persistence";
import {
  placeMine,
  placeStrikes,
  playerInFrost,
  spawnBullet,
  spawnField,
  spawnWell,
  updatePlacedSkills,
} from "../skills/placed";
import type {
  ActiveCast,
  CastParams,
  EchoCast,
  Ghost,
  ModifierKey,
  SkillDef,
  SkillKey,
  SkillProfile,
  SkillRunState,
  SkillSlotState,
  SkillStone,
} from "../skills/types";
import { buffPotencyMul } from "./attributes";
import { COLOR_JUST, cancelAttack, damagePlayer, gainEnergy, healPlayer, registerComboHit } from "./combat";
import { addFloatingText, shake, spawnBurst, spawnLine, spawnRing } from "./effects";
import { canAffordSkill, payOverclock, paySkillCost } from "./keystones";
import { dropSkillStone } from "./loot";
import { circlesOverlap, moveBody, overlapsWall } from "./physics";
import { enemiesInRadius, playerCanCast } from "./statusEffects";
import { fireTrigger } from "./triggers";

/**
 * アクティブスキルの発動・更新・ドロップ・刻印符。docs/ideas/skills.md「7-4」〜「7-7」。
 * updatePlayer から毎フレーム呼ばれる。乱数は state.rng のみ（決定性）。
 */

const COLOR_NOT_READY = "#808080";
const COLOR_BLOOD = "#ff4040";
const COLOR_WHIRL = "#ffffff";
const COLOR_RAIL = "#ff6060";
const COLOR_LUNGE = "#c0e0ff";
const TEXT_SCALE = 0.9;
const TEXT_LIFE = 0.4;
const LABEL_SCALE = 1;
const LABEL_LIFE = 1.4;
const RING_LIFE = 0.15;
const BEAM_LIFE = 0.2;
const JUST_ENERGY_HITS = 2;
const PARRY_TEXT_SCALE = 1.5;
const PARRY_TEXT_LIFE = 0.7;
/** パリィ成功直後、同じ攻撃の続きで被弾しないための無敵 */
const PARRY_AFTER_INVULN = 0.2;
const PARRY_MOVE_MUL = 0.5;
const SHAKE_SKILL = 3;
const AURA_EVERY_TICKS = 3;
const AURA_SPEED = 30;
const SLOT_COUNT = SKILL.slots;
const COLOR_QUAKE = "#d0a060";
const COLOR_HOOK = "#c0c0d0";
const COLOR_HASTE = "#80ffff";
const COLOR_BROKEN = "#ff8080";
const QUAKE_ARC_POINTS = 7;
const QUAKE_PARTICLES = 3;
const QUAKE_PARTICLE_SPEED = 90;
const HOOK_STEP = 2;
const HOOK_LINE_LIFE = 0.12;
const HASTE_TEXT = "加速";
const SPARK_COUNT = 4;
const SPARK_SPEED = 50;
const SPARK_LIFE = 0.2;
const SPARK_SIZE = 1.5;
const FULL_TURN = Math.PI * 2;
/** 照準地点を使うスキルの最大射程（無いものはグレネードと同じ） */
const CAST_RANGE: Partial<Record<SkillKey, number>> = {
  frag: SKILL.frag.maxRange,
  thunder: SKILL.thunder.maxRange,
  gravityWell: SKILL.gravityWell.maxRange,
  frostField: SKILL.frostField.maxRange,
};

/** 1 スロットぶんの解決結果 */
export interface ResolvedSlot {
  stone: SkillStone;
  def: SkillDef;
  params: CastParams;
  /** CD 型の CD 秒（マナ型は 0） */
  cooldown: number;
  /** マナ型のコスト（CD 型は 0） */
  cost: number;
  /** このスロットの最低間隔（秒） */
  interval: number;
}

export function createSkillRunState(profile: SkillProfile): SkillRunState {
  return {
    profile,
    slots: Array.from({ length: SLOT_COUNT }, () => ({
      modifiers: [],
      cooldownLeft: 0,
      cooldownTotal: 0,
      chargesLeft: 1,
      charging: false,
      chargeTime: 0,
      intervalLeft: 0,
    })),
    active: null,
    pendingSlot: -1,
    pendingTimer: 0,
    grenades: [],
    echoes: [],
    ghosts: [],
    strikes: [],
    wells: [],
    mines: [],
    fields: [],
    bullets: [],
    runes: [],
    floorStones: [],
    frenzy: { time: 0, mul: 1 },
    lifesteal: { time: 0, mul: 0 },
    haste: { time: 0, mul: 1 },
    exhaustTimer: 0,
    curses: new Map(),
    parryTimer: 0,
    parryFailTimer: 0,
    stunTimer: 0,
    lungeComboTimer: 0,
    notReadyTimer: 0,
    enemyHp: new Map(),
    tracking: { depth: null, cleared: [] },
    gcd: 0,
    manaFlash: 0,
  };
}

export function resolveSlot(state: GameState, slot: number): ResolvedSlot | null {
  const rs = state.skills;
  const stone = stoneInSlot(rs.profile, slot);
  const slotState = rs.slots[slot];
  if (!stone || !slotState) return null;
  const def = SKILL_DEFS[stone.skillKey];
  const params = resolveCast(def, stone, slotState.modifiers);
  const burden = castBurden(def, params);
  return { stone, def, params, cooldown: burden.cooldown, cost: burden.cost, interval: castInterval(def, params) };
}

// ---------------------------------------------------------------------------
// player.ts から参照する問い合わせ
// ---------------------------------------------------------------------------

/** 近接・射撃を受け付けないか */
export function skillLocksAttack(state: GameState): boolean {
  const rs = state.skills;
  return rs.active !== null || rs.parryFailTimer > 0 || rs.stunTimer > 0;
}

/** ダッシュを受け付けないか（パリィ失敗・突進の壁激突・加速の反動） */
export function skillLocksDash(state: GameState): boolean {
  const rs = state.skills;
  return rs.parryFailTimer > 0 || rs.stunTimer > 0 || rs.exhaustTimer > 0;
}

/** 入力移動に掛ける倍率 */
export function skillMoveMul(state: GameState): number {
  const rs = state.skills;
  if (rs.parryFailTimer > 0 || rs.stunTimer > 0) return 0;
  const haste = rs.haste.time > 0 ? rs.haste.mul : 1;
  const frost = playerInFrost(state) ? SKILL.frostField.selfMoveMul : 1;
  const charging = rs.slots.some((s) => s.charging) ? SKILL.modifier.charge.moveMul : 1;
  return activeMoveMul(rs.active) * haste * frost * charging;
}

function activeMoveMul(a: ActiveCast | null): number {
  if (!a) return 1;
  switch (a.skillKey) {
    case "whirl":
      return a.phase === "main" ? SKILL.whirl.moveMul : 1;
    case "spiral":
      return SKILL.spiral.moveMul;
    case "lunge":
    case "railshot":
    case "quake":
    case "chainHook":
      return 0;
    case "parry":
      return PARRY_MOVE_MUL;
  }
}

/** 血の契約: 攻撃速度と連射に掛ける倍率 */
export function frenzyMul(state: GameState): number {
  const f = state.skills.frenzy;
  return f.time > 0 ? f.mul : 1;
}

/** 突進斬り直後の近接は 2 段目から。消費したら true */
export function consumeLungeCombo(state: GameState): boolean {
  const rs = state.skills;
  if (rs.lungeComboTimer <= 0) return false;
  rs.lungeComboTimer = 0;
  return true;
}

/** バーストは常にスキルをキャンセルできる */
export function cancelSkills(state: GameState): void {
  cancelActive(state, false);
  state.skills.pendingSlot = -1;
}

/**
 * 血の契約の吸収: 前回計測からの敵 HP の減少を与ダメとして扱う。
 * combat.ts を触らずに全ダメージ源（近接・弾・状態異常）を拾うため、updatePlayer の前後で呼ぶ
 */
export function trackDamageDealt(state: GameState): void {
  const rs = state.skills;
  let dealt = 0;
  for (const e of state.enemies) {
    const before = rs.enemyHp.get(e.id);
    if (before !== undefined) dealt += Math.max(0, before - Math.max(0, e.hp));
  }
  rs.enemyHp.clear();
  for (const e of state.enemies) rs.enemyHp.set(e.id, Math.max(0, e.hp));
  if (dealt <= 0 || rs.lifesteal.time <= 0) return;
  healPlayer(state, dealt * rs.lifesteal.mul, { silent: true });
}

// ---------------------------------------------------------------------------
// メイン更新
// ---------------------------------------------------------------------------

export function updateSkills(state: GameState, input: FrameInput, dt: number): void {
  const rs = state.skills;
  syncTracking(state);
  tickTimers(state, dt);
  for (let i = 0; i < SLOT_COUNT; i++) tickSlot(state, i, dt);

  // ダッシュは発動中のスキルをキャンセルする（CD は消費済み）
  if (rs.active && state.player.dashTimer > 0) cancelActive(state, true);

  const pressed = [input.skill1Pressed, input.skill2Pressed, input.skill3Pressed, input.skill4Pressed];
  pressed.forEach((on, i) => {
    if (!on) return;
    if (hasChargeModifier(state, i)) startCharge(state, i);
    else requestCast(state, i, input);
  });
  tryPending(state, input);
  updateCharging(state, input, dt);

  updateActive(state, dt);
  updateGrenades(state, dt);
  updateEchoes(state, dt);
  updateGhosts(state, dt);
  updatePlacedSkills(state, dt);
  updateHaste(state);
  updateFloorStones(state, dt);
  updateRunes(state, dt);
  spawnAura(state);
}

function tickTimers(state: GameState, dt: number): void {
  const rs = state.skills;
  rs.frenzy.time = Math.max(0, rs.frenzy.time - dt);
  rs.lifesteal.time = Math.max(0, rs.lifesteal.time - dt);
  const hasted = rs.haste.time > 0;
  rs.haste.time = Math.max(0, rs.haste.time - dt);
  rs.exhaustTimer = Math.max(0, rs.exhaustTimer - dt);
  if (hasted && rs.haste.time === 0) rs.exhaustTimer = SKILL.haste.exhaust;
  tickCurses(state, dt);
  rs.parryFailTimer = Math.max(0, rs.parryFailTimer - dt);
  rs.stunTimer = Math.max(0, rs.stunTimer - dt);
  rs.lungeComboTimer = Math.max(0, rs.lungeComboTimer - dt);
  rs.notReadyTimer = Math.max(0, rs.notReadyTimer - dt);
  rs.pendingTimer = Math.max(0, rs.pendingTimer - dt);
  if (rs.pendingTimer === 0) rs.pendingSlot = -1;
  rs.gcd = Math.max(0, rs.gcd - dt);
  rs.manaFlash = Math.max(0, rs.manaFlash - dt);
}

/**
 * 最低間隔を進める。CD 型はチャージ制: 減っている間だけ CD が進み、0 になるたび 1 回復（ダッシュと同じ）。
 * マナ型はチャージを使わないので常に満タン扱い
 */
function tickSlot(state: GameState, index: number, dt: number): void {
  const slot = state.skills.slots[index];
  if (slot) slot.intervalLeft = Math.max(0, slot.intervalLeft - dt);
  const r = resolveSlot(state, index);
  if (!slot || !r) return;
  const max = r.def.resource === "mana" ? 1 : r.params.charges;
  if (slot.chargesLeft >= max) {
    slot.chargesLeft = max;
    slot.cooldownLeft = 0;
    return;
  }
  slot.cooldownLeft = Math.max(0, slot.cooldownLeft - dt);
  if (slot.cooldownLeft > 0) return;
  slot.chargesLeft += 1;
  pushSfx(state, "skillReady");
  if (slot.chargesLeft < max) setCooldown(slot, r.cooldown);
}

function setCooldown(slot: { cooldownLeft: number; cooldownTotal: number }, seconds: number): void {
  slot.cooldownLeft = seconds;
  slot.cooldownTotal = seconds;
}

function notReady(state: GameState, text: string): void {
  const rs = state.skills;
  if (rs.notReadyTimer > 0) return;
  rs.notReadyTimer = SKILL.notReadyTextInterval;
  addFloatingText(state, state.player.body.pos, text, COLOR_NOT_READY, TEXT_SCALE, TEXT_LIFE);
}

/** マナ不足の不発（docs/COMBAT_DESIGN.md B-2 の 4）。何も消費しない。先行入力は破棄 */
function misfire(state: GameState): void {
  const rs = state.skills;
  notReady(state, "マナ不足");
  pushSfx(state, "manaEmpty");
  rs.manaFlash = SKILL.manaFlashTime;
  rs.pendingSlot = -1;
}

/** 共通最低間隔か、このスロットの最低間隔の中か */
function intervalBlocked(state: GameState, index: number): boolean {
  const slot = state.skills.slots[index];
  return state.skills.gcd > 0 || (slot?.intervalLeft ?? 0) > 0;
}

/** 払えるか。払えなければ理由を出して false（何も消費しない） */
function checkAffordable(state: GameState, index: number, r: ResolvedSlot): boolean {
  if (r.def.resource === "mana") {
    if (canAffordSkill(state, r.cost)) return true;
    misfire(state);
    return false;
  }
  if ((state.skills.slots[index]?.chargesLeft ?? 0) > 0) return true;
  notReady(state, "冷却中");
  return false;
}

function attackCommitted(state: GameState): boolean {
  const phase = state.player.attack.phase;
  return phase === "windup" || phase === "active";
}

function requestCast(state: GameState, index: number, input: FrameInput): void {
  const rs = state.skills;
  if (!resolveSlot(state, index)) {
    notReady(state, "スキル未装備");
    return;
  }
  if (rs.parryFailTimer > 0 || rs.stunTimer > 0 || rs.active) return;
  if (state.player.dashTimer > 0 || attackCommitted(state) || intervalBlocked(state, index)) {
    bufferCast(state, index);
    return;
  }
  castSlot(state, index, input);
}

/** 先行入力として保持する（SKILL.inputBuffer 秒） */
function bufferCast(state: GameState, index: number): void {
  const rs = state.skills;
  rs.pendingSlot = index;
  rs.pendingTimer = SKILL.inputBuffer;
}

/** 先行入力: ダッシュ終了・近接の recover・最低間隔の明けた瞬間に発動 */
function tryPending(state: GameState, input: FrameInput): void {
  const rs = state.skills;
  if (rs.pendingSlot < 0 || rs.active) return;
  if (state.player.dashTimer > 0 || attackCommitted(state) || intervalBlocked(state, rs.pendingSlot)) return;
  const index = rs.pendingSlot;
  rs.pendingSlot = -1;
  castSlot(state, index, input);
}

// ---------------------------------------------------------------------------
// Charge（溜め）刻印符
// ---------------------------------------------------------------------------

/** このスロットに Charge が実際に効いているか（リンク数・相性表を通した上で） */
function hasChargeModifier(state: GameState, index: number): boolean {
  const rs = state.skills;
  const stone = stoneInSlot(rs.profile, index);
  const slot = rs.slots[index];
  if (!stone || !slot) return false;
  return activeModifiers(SKILL_DEFS[stone.skillKey], stone.links, slot.modifiers).includes("charge");
}

/**
 * 押した瞬間: 発動はせず溜めを始める（他のスキルが発動中・行動不能なら無視）。
 * マナ型はこの時点でコストを確認するだけで、払うのは離した瞬間（docs/COMBAT_DESIGN.md B-5）
 */
function startCharge(state: GameState, index: number): void {
  const rs = state.skills;
  const slot = rs.slots[index];
  const r = resolveSlot(state, index);
  if (!r) {
    notReady(state, "スキル未装備");
    return;
  }
  if (!slot || !playerCanCast(state) || !checkAffordable(state, index, r)) return;
  if (rs.parryFailTimer > 0 || rs.stunTimer > 0 || rs.active) return;
  slot.charging = true;
  slot.chargeTime = 0;
}

/** 経過秒(0..maxTime) から威力・範囲の倍率を出す。0.15 秒未満は通常発動（倍率 1） */
function chargeBonus(time: number): { damageMul: number; areaMul: number } {
  const c = SKILL.modifier.charge;
  const t = time < c.minTime ? 0 : Math.min(time, c.maxTime);
  const ratio = t / c.maxTime;
  return { damageMul: 1 + (c.maxDamageMul - 1) * ratio, areaMul: 1 + (c.maxAreaMul - 1) * ratio };
}

/** 溜め中のスロットを毎フレーム進め、離された瞬間に倍率付きで発動する */
function updateCharging(state: GameState, input: FrameInput, dt: number): void {
  const rs = state.skills;
  const held = [input.skill1Held, input.skill2Held, input.skill3Held, input.skill4Held];
  const maxTime = SKILL.modifier.charge.maxTime;
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slot = rs.slots[i];
    if (!slot || !slot.charging) continue;
    slot.chargeTime = Math.min(maxTime, slot.chargeTime + dt);
    if (held[i]) continue;
    const time = slot.chargeTime;
    slot.charging = false;
    slot.chargeTime = 0;
    // 溜めている間に行動不能・別スキル発動中になったら不発（チャージ・マナは未消費のまま）
    if (rs.parryFailTimer > 0 || rs.stunTimer > 0 || rs.active) continue;
    // 最低間隔の中で離したら先行入力に回す（溜めの倍率は乗らない。minTime 未満の短押しで起きるのがほとんど）
    if (intervalBlocked(state, i)) {
      bufferCast(state, i);
      continue;
    }
    castSlot(state, i, input, chargeBonus(time));
  }
}

/** HUD 用: 溜めゲージの割合(0..1)。溜めていなければ null */
export function chargeRatio(state: GameState, index: number): number | null {
  const slot = state.skills.slots[index];
  if (!slot || !slot.charging) return null;
  return Math.min(1, slot.chargeTime / SKILL.modifier.charge.maxTime);
}

function aimTarget(state: GameState, input: FrameInput): Vec {
  const p = state.player;
  if (input.aimScreen) return screenToWorld(state.camera, input.aimScreen);
  return add(p.body.pos, scale(p.facing, SKILL.frag.maxRange));
}

/** コスト支払い（HP・コンボ燃料）を済ませた最終パラメータ */
function payCosts(state: GameState, params: CastParams): CastParams {
  const p = state.player;
  if (params.hpCostFraction > 0) p.hp = Math.max(1, p.hp - p.maxHp * params.hpCostFraction);
  payOverclock(state, PLAYER.overclockHpCost);
  const fuel = params.comboFuel;
  if (!fuel) return params;
  const count = state.combo.count;
  const mul = count > 0 ? 1 + Math.min(fuel.cap, count * fuel.perStack) : fuel.emptyMul;
  state.combo.count = 0;
  state.combo.timer = 0;
  return { ...params, damageMul: params.damageMul * mul };
}

/**
 * 発動。成功したら true。chargeMul は Charge 刻印符が離した瞬間に渡す威力・範囲の追加倍率。
 * 最低間隔の中なら何もしない（呼び出し側が先行入力に回す）。払えなければ何も消費せず不発
 */
export function castSlot(
  state: GameState,
  index: number,
  input: FrameInput,
  chargeMul?: { damageMul: number; areaMul: number },
): boolean {
  const rs = state.skills;
  const slot = rs.slots[index];
  const r = resolveSlot(state, index);
  if (!slot || !r) return false;
  // 怯み・沈黙中はスキル不可（docs/COMBAT_DESIGN.md D-5 / E-2）
  if (!playerCanCast(state)) return false;
  if (intervalBlocked(state, index)) return false;
  if (!checkAffordable(state, index, r)) return false;
  if (state.player.attack.phase !== "none") cancelAttack(state);

  const manaPaid = payResource(state, slot, r);
  const costed = payCosts(state, r.params);
  const params: CastParams = {
    ...costed,
    damageMul: costed.damageMul * (chargeMul?.damageMul ?? 1),
    areaMul: costed.areaMul * (chargeMul?.areaMul ?? 1),
    slot: index,
    manaPaid,
  };
  const p = state.player;
  const dir = { ...p.facing };
  const origin = { ...p.body.pos };
  const key = r.def.key;
  const target = clampTarget(state, origin, aimTarget(state, input), CAST_RANGE[key] ?? SKILL.frag.maxRange);
  const remote = { skillKey: key, origin, dir, target };

  if (params.delay) {
    // 遅延: いま何も起きず、発動地点で後から本発動（反響はその時点から数える）
    const time = params.delay.time;
    rs.echoes.push({ ...remote, kind: "delay", timer: time, total: time, params: { ...params, damageMul: params.damageMul * params.delay.damageMul, delay: null } });
  } else {
    CAST[key](state, index, params, dir, target);
    scheduleEcho(state, { ...remote, params });
  }

  applyRecoil(state, dir, params);
  if (r.def.damageKind === "ranged") fireTrigger(state, "onShoot", { pos: origin });
  pushSfx(state, "skillCast");
  return true;
}

/**
 * 資源を払い、共通最低間隔とスロットの最低間隔を立てる。払ったマナを返す（CD 型は 0）。
 * 呼ぶ前に checkAffordable で払えることを確かめておく
 */
function payResource(state: GameState, slot: SkillSlotState, r: ResolvedSlot): number {
  state.skills.gcd = SKILL.gcd;
  slot.intervalLeft = r.interval;
  if (r.def.resource === "mana") {
    // 過負荷（ks_overdraw）はマナ不足を HP で払う
    paySkillCost(state, r.cost);
    return r.cost;
  }
  slot.chargesLeft -= 1;
  if (slot.cooldownLeft <= 0) setCooldown(slot, r.cooldown);
  return 0;
}

/** 反響の予約（params.echo があるときだけ）。反響の反響は起きない */
function scheduleEcho(state: GameState, e: Pick<EchoCast, "skillKey" | "origin" | "dir" | "target" | "params">): void {
  const echo = e.params.echo;
  if (!echo) return;
  state.skills.echoes.push({
    ...e,
    kind: "echo",
    timer: echo.delay,
    total: echo.delay,
    params: { ...e.params, damageMul: e.params.damageMul * echo.damageMul, echo: null },
  });
}

/** 反動: 照準の逆へ跳び、短い無敵 */
function applyRecoil(state: GameState, dir: Vec, params: CastParams): void {
  if (params.recoil <= 0) return;
  const p = state.player;
  p.knock = add(p.knock, scale(dir, -params.recoil));
  p.invulnTimer = Math.max(p.invulnTimer, SKILL.modifier.recoil.invuln);
  spawnBurst(state, p.body.pos, COLOR_HOOK, SPARK_COUNT, SPARK_SPEED, SPARK_LIFE, SPARK_SIZE);
}

type CastFn = (state: GameState, slot: number, params: CastParams, dir: Vec, target: Vec) => void;

function startActive(state: GameState, slot: number, key: ActiveCast["skillKey"], params: CastParams, dir: Vec, time: number): void {
  state.skills.active = {
    slot,
    skillKey: key,
    phase: "main",
    timer: time,
    total: time,
    params,
    dir: { ...dir },
    origin: { ...state.player.body.pos },
    hitIds: new Set(),
    hitsDone: 0,
    startHp: state.player.hp,
    reach: 0,
  };
}

const CAST: Record<SkillKey, CastFn> = {
  whirl: (state, slot, params, dir) => startActive(state, slot, "whirl", params, dir, SKILL.whirl.duration * params.timeMul),
  lunge: (state, slot, params, dir) => {
    startActive(state, slot, "lunge", params, dir, SKILL.lunge.time * params.timeMul);
    spawnBurst(state, state.player.body.pos, COLOR_LUNGE, 6, 60, 0.2, 1.5);
  },
  railshot: (state, slot, params, dir) => startActive(state, slot, "railshot", params, dir, SKILL.railshot.aim * params.timeMul),
  parry: (state, slot, params, dir) => {
    const window = SKILL.parry.window * params.timeMul;
    startActive(state, slot, "parry", params, dir, window);
    const rs = state.skills;
    rs.parryTimer = window;
    const p = state.player;
    p.buffs.invuln = Math.max(p.buffs.invuln, window);
  },
  frag: (state, _slot, params, _dir, target) => throwGrenades(state, state.player.body.pos, target, params),
  bloodPact: (state, _slot, params) => {
    const p = state.player;
    const b = SKILL.bloodPact;
    p.hp = Math.max(1, p.hp - p.maxHp * b.hpFraction);
    const time = b.duration * params.durationMul;
    const potency = params.potencyMul * buffPotencyMul(state.stats);
    state.skills.frenzy = { time, mul: 1 + (b.speedMul - 1) * potency };
    state.skills.lifesteal = { time, mul: b.lifesteal * potency };
    addFloatingText(state, p.body.pos, "血の契約", COLOR_BLOOD, LABEL_SCALE, PARRY_TEXT_LIFE);
    spawnBurst(state, p.body.pos, COLOR_BLOOD, 16, 90, 0.4, 2);
  },
  quake: (state, slot, params, dir) => startActive(state, slot, "quake", params, dir, SKILL.quake.windup * params.timeMul),
  thunder: (state, _slot, params, _dir, target) => placeStrikes(state, target, params),
  gravityWell: (state, _slot, params, _dir, target) => spawnWell(state, target, params),
  mines: (state, _slot, params) => placeMine(state, state.player.body.pos, params),
  haste: (state, _slot, params) => {
    const h = SKILL.haste;
    const p = state.player;
    const potency = params.potencyMul * buffPotencyMul(state.stats);
    state.skills.haste = { time: h.duration * params.durationMul, mul: 1 + h.moveBonus * potency };
    state.skills.exhaustTimer = 0;
    addFloatingText(state, p.body.pos, HASTE_TEXT, COLOR_HASTE, LABEL_SCALE, PARRY_TEXT_LIFE);
    spawnBurst(state, p.body.pos, COLOR_HASTE, 12, 90, 0.35, 1.5);
  },
  chainHook: (state, slot, params, dir) => startActive(state, slot, "chainHook", params, dir, SKILL.chainHook.extendTime * params.timeMul),
  spiral: (state, slot, params, dir) => startActive(state, slot, "spiral", params, dir, SKILL.spiral.duration * params.timeMul),
  frostField: (state, _slot, params, _dir, target) => spawnField(state, target, params),
};

/** 加速中はダッシュのチャージが常に満タン（CD 0） */
function updateHaste(state: GameState): void {
  if (state.skills.haste.time <= 0) return;
  const p = state.player;
  p.dashChargesLeft = state.stats.dashCharges;
  p.dashCooldown = 0;
  if (state.tick % AURA_EVERY_TICKS === 0) spawnBurst(state, p.body.pos, COLOR_HASTE, 1, AURA_SPEED, SPARK_LIFE, SPARK_SIZE);
}

/** 発動中スキルの中断。dashCancel なら撃ち抜き照準中に払ったマナを半分返す */
function cancelActive(state: GameState, dashCancel: boolean): void {
  const rs = state.skills;
  const a = rs.active;
  if (!a) return;
  rs.active = null;
  if (a.skillKey === "parry") rs.parryTimer = 0;
  if (!dashCancel || a.skillKey !== "railshot") return;
  refundMana(state, a.params.manaPaid * SKILL.railshot.cancelRefund, state.player.body.pos);
}

// ---------------------------------------------------------------------------
// 発動中の更新
// ---------------------------------------------------------------------------

function updateActive(state: GameState, dt: number): void {
  const a = state.skills.active;
  if (!a) return;
  switch (a.skillKey) {
    case "whirl":
      updateWhirl(state, a, dt);
      return;
    case "lunge":
      updateLunge(state, a, dt);
      return;
    case "railshot":
      updateRailshot(state, a, dt);
      return;
    case "parry":
      updateParry(state, a, dt);
      return;
    case "quake":
      updateQuake(state, a, dt);
      return;
    case "chainHook":
      updateHook(state, a, dt);
      return;
    case "spiral":
      updateSpiral(state, a, dt);
      return;
  }
}

/** 本動作の後の硬直へ移る */
function toRecover(a: ActiveCast, time: number): void {
  a.phase = "recover";
  a.timer = time;
  a.total = time;
}

/** 硬直中なら時間を進めて true（終われば active を外す） */
function stepRecover(state: GameState, a: ActiveCast, dt: number): boolean {
  if (a.phase !== "recover") return false;
  a.timer -= dt;
  if (a.timer <= 0) state.skills.active = null;
  return true;
}

// ---- 地裂き ----

export function quakeRadius(params: Readonly<CastParams>): number {
  return SKILL.quake.radius * params.areaMul;
}

/** 溜め中は照準に追従。被弾で中断（CD は消費済み） */
function updateQuake(state: GameState, a: ActiveCast, dt: number): void {
  if (stepRecover(state, a, dt)) return;
  const p = state.player;
  a.dir = { ...p.facing };
  if (p.hp < a.startHp) {
    state.skills.active = null;
    addFloatingText(state, p.body.pos, "中断", COLOR_BROKEN, TEXT_SCALE, PARRY_TEXT_LIFE);
    return;
  }
  a.timer -= dt;
  if (a.timer > 0) return;
  quakeRelease(state, p.body.pos, a.dir, a.params);
  toRecover(a, SKILL.quake.recover);
}

/** 前方扇の衝撃波。密着している敵は角度を問わず当たる */
function quakeRelease(state: GameState, center: Vec, dir: Vec, params: CastParams): void {
  const q = SKILL.quake;
  const radius = quakeRadius(params);
  const base = angle(dir);
  for (let i = 0; i < QUAKE_ARC_POINTS; i++) {
    const t = i / (QUAKE_ARC_POINTS - 1);
    const at = add(center, scale(fromAngle(base - q.halfAngle + t * q.halfAngle * 2), radius));
    spawnBurst(state, at, COLOR_QUAKE, QUAKE_PARTICLES, QUAKE_PARTICLE_SPEED, SPARK_LIFE * 2, SPARK_SIZE);
  }
  spawnLine(state, center, add(center, scale(fromAngle(base - q.halfAngle), radius)), COLOR_QUAKE, BEAM_LIFE);
  spawnLine(state, center, add(center, scale(fromAngle(base + q.halfAngle), radius)), COLOR_QUAKE, BEAM_LIFE);
  shake(state, SHAKE_SKILL * 2);
  pushSfx(state, "explode");
  const bodyR = state.player.body.radius;
  for (const e of enemiesInRadius(state, center, radius)) {
    const to = sub(e.body.pos, center);
    const touching = length(to) <= bodyR + e.body.radius;
    if (!touching && Math.abs(angleDiff(angle(to), base)) > q.halfAngle) continue;
    meleeSkillHit(state, e, params, skillPower(state, q.damage, params), to, q.knockback, true);
  }
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= FULL_TURN;
  while (d < -Math.PI) d += FULL_TURN;
  return d;
}

// ---- 鎖鎌 ----

export function hookRange(params: Readonly<CastParams>): number {
  return SKILL.chainHook.range * params.areaMul;
}

interface HookSweep {
  hitIds: Set<number>;
  /** 引き寄せた数 */
  pulled: number;
}

/**
 * 鎖の先端を from → to まで進める。壁か、貫通数を超えて刺さったら true（止まる）。
 * anchor は引き寄せ先（本体ならプレイヤー、反響なら発動地点）
 */
function sweepHook(state: GameState, anchor: Vec, dir: Vec, params: CastParams, from: number, to: number, sw: HookSweep, pullSelf: boolean): boolean {
  const h = SKILL.chainHook;
  for (let d = from; d <= to; d += HOOK_STEP) {
    const tip = add(anchor, scale(dir, d));
    if (overlapsWall(state, tip.x, tip.y, 0)) return true;
    for (const e of state.enemies) {
      if (e.hp <= 0 || e.phase === "spawning" || sw.hitIds.has(e.id)) continue;
      if (length(sub(e.body.pos, tip)) > e.body.radius + h.hitPad) continue;
      sw.hitIds.add(e.id);
      hookEnemy(state, anchor, dir, e, params, pullSelf);
      sw.pulled += 1;
      if (sw.pulled > params.pierce) return true;
    }
  }
  return false;
}

/** 刺さった敵を anchor の前へ引き寄せる。ボスはプレイヤー側が飛ぶ（pullSelf のときだけ） */
function hookEnemy(state: GameState, anchor: Vec, dir: Vec, e: Enemy, params: CastParams, pullSelf: boolean): void {
  const h = SKILL.chainHook;
  const p = state.player;
  spawnLine(state, anchor, e.body.pos, COLOR_HOOK, HOOK_LINE_LIFE);
  const gap = p.body.radius + e.body.radius + h.landGap;
  if (state.boss?.enemyId === e.id) {
    if (pullSelf) {
      const delta = sub(e.body.pos, p.body.pos);
      const move = scale(normalize(delta), Math.max(0, length(delta) - gap));
      moveBody(state, p.body, move.x, move.y);
    }
  } else {
    const dest = add(anchor, scale(dir, gap));
    moveBody(state, e.body, dest.x - e.body.pos.x, dest.y - e.body.pos.y);
  }
  meleeSkillHit(state, e, params, skillPower(state, h.damage, params), scale(dir, -1), h.knockback, true);
}

function updateHook(state: GameState, a: ActiveCast, dt: number): void {
  if (stepRecover(state, a, dt)) return;
  const p = state.player;
  a.timer -= dt;
  const range = hookRange(a.params);
  const next = range * Math.min(1, 1 - Math.max(0, a.timer) / a.total);
  const sw: HookSweep = { hitIds: a.hitIds, pulled: a.hitsDone };
  const stopped = sweepHook(state, p.body.pos, a.dir, a.params, a.reach, next, sw, true);
  a.hitsDone = sw.pulled;
  a.reach = next;
  if (!stopped && a.timer > 0) return;
  if (a.hitsDone === 0) spawnLine(state, p.body.pos, add(p.body.pos, scale(a.dir, a.reach)), COLOR_HOOK, HOOK_LINE_LIFE);
  pushSfx(state, a.hitsDone > 0 ? "hitHeavy" : "wallHit");
  toRecover(a, SKILL.chainHook.recover);
}

/** 反響・遅延: 発動地点から一瞬で鎖を伸ばす */
function hookInstant(state: GameState, origin: Vec, dir: Vec, params: CastParams): void {
  sweepHook(state, origin, dir, params, 0, hookRange(params), { hitIds: new Set(), pulled: 0 }, false);
}

// ---- 回転弾幕 ----

function spiralBulletCount(params: CastParams): number {
  const s = SKILL.spiral;
  return Math.max(s.arms, s.bullets + params.countBonus * s.bulletsPerCount);
}

/** 経過時間に応じて螺旋の弾を出す。本体と残像で共有 */
function stepSpiral(state: GameState, center: Vec, dir: Vec, params: CastParams, elapsed: number, total: number, done: number): number {
  const s = SKILL.spiral;
  const count = spiralBulletCount(params);
  const perArm = Math.ceil(count / s.arms);
  const interval = total / perArm;
  const base = angle(dir);
  let n = done;
  while (n < count && elapsed >= Math.floor(n / s.arms) * interval) {
    const step = Math.floor(n / s.arms);
    const arm = n % s.arms;
    const a = base + (step / perArm) * s.turns * FULL_TURN + (arm * FULL_TURN) / s.arms;
    spawnBullet(state, center, fromAngle(a), params);
    n += 1;
  }
  return n;
}

function updateSpiral(state: GameState, a: ActiveCast, dt: number): void {
  a.timer -= dt;
  a.hitsDone = stepSpiral(state, state.player.body.pos, a.dir, a.params, a.total - a.timer, a.total, a.hitsDone);
  if (a.timer <= 0) state.skills.active = null;
}

function whirlHitCount(params: CastParams): number {
  return Math.max(1, SKILL.whirl.hits + params.countBonus);
}

/** 経過時間に応じて多段ヒットを出す。旋風斬りの本体と残像で共有 */
function stepWhirlHits(state: GameState, center: Vec, params: CastParams, elapsed: number, total: number, done: number): number {
  const hits = whirlHitCount(params);
  const interval = total / hits;
  let n = done;
  while (n < hits && elapsed >= n * interval) {
    whirlHit(state, center, params);
    n += 1;
  }
  return n;
}

function whirlRadius(state: GameState, params: CastParams): number {
  return SKILL.whirl.radius * state.stats.meleeReachMul * params.areaMul;
}

function whirlHit(state: GameState, center: Vec, params: CastParams): void {
  const radius = whirlRadius(state, params);
  const power = skillPower(state, SKILL.whirl.damage, params);
  spawnRing(state, center, radius, COLOR_WHIRL, RING_LIFE);
  for (const e of enemiesInRadius(state, center, radius)) {
    meleeSkillHit(state, e, params, power, sub(e.body.pos, center), SKILL.whirl.knockback, false);
  }
}

function meleeSkillHit(state: GameState, e: Enemy, params: CastParams, base: number, dir: Vec, knockback: number, stagger: boolean): void {
  skillHit(state, e, params, { base, kind: "melee", dir, knockback, stagger });
}

function rangedSkillHit(state: GameState, e: Enemy, params: CastParams, base: number, dir: Vec, knockback: number, stagger: boolean): void {
  skillHit(state, e, params, { base, kind: "ranged", dir, knockback, stagger });
}

function updateWhirl(state: GameState, a: ActiveCast, dt: number): void {
  const rs = state.skills;
  a.timer -= dt;
  if (a.phase === "recover") {
    if (a.timer <= 0) rs.active = null;
    return;
  }
  a.hitsDone = stepWhirlHits(state, state.player.body.pos, a.params, a.total - a.timer, a.total, a.hitsDone);
  if (a.timer > 0) return;
  a.phase = "recover";
  a.timer = SKILL.whirl.recover;
  a.total = SKILL.whirl.recover;
}

function lungeSpeed(state: GameState, params: CastParams): number {
  return (SKILL.lunge.distance * state.stats.dashDistanceMul) / (SKILL.lunge.time * params.timeMul);
}

function lungeHits(state: GameState, center: Vec, a: { hitIds: Set<number>; params: CastParams; dir: Vec }): void {
  const radius = state.player.body.radius + SKILL.lunge.hitPad * a.params.areaMul;
  for (const e of enemiesInRadius(state, center, radius)) {
    if (a.hitIds.has(e.id)) continue;
    a.hitIds.add(e.id);
    meleeSkillHit(state, e, a.params, skillPower(state, SKILL.lunge.damage, a.params), a.dir, SKILL.lunge.knockback, true);
  }
}

function updateLunge(state: GameState, a: ActiveCast, dt: number): void {
  const rs = state.skills;
  const p = state.player;
  const step = lungeSpeed(state, a.params) * Math.min(dt, a.timer);
  a.timer -= dt;
  const hit = moveBody(state, p.body, a.dir.x * step, a.dir.y * step);
  lungeHits(state, p.body.pos, a);
  if (state.tick % 2 === 0) spawnBurst(state, p.body.pos, COLOR_LUNGE, 1, 10, 0.18, 3);
  if (hit.hitX || hit.hitY) {
    rs.active = null;
    rs.stunTimer = SKILL.lunge.wallStun;
    shake(state, SHAKE_SKILL);
    pushSfx(state, "wallHit");
    return;
  }
  if (a.timer > 0) return;
  rs.active = null;
  rs.lungeComboTimer = SKILL.lunge.comboLinkWindow;
}

function updateRailshot(state: GameState, a: ActiveCast, dt: number): void {
  const p = state.player;
  a.dir = { ...p.facing };
  a.timer -= dt;
  if (a.timer > 0) return;
  state.skills.active = null;
  fireRails(state, p.body.pos, a.dir, a.params);
  p.knock = add(p.knock, scale(a.dir, -SKILL.railshot.recoil));
  shake(state, SHAKE_SKILL);
}

function fireRails(state: GameState, origin: Vec, dir: Vec, params: CastParams): void {
  const count = Math.max(1, 1 + params.countBonus);
  const center = (count - 1) / 2;
  const base = angle(dir);
  for (let i = 0; i < count; i++) {
    fireBeam(state, origin, fromAngle(base + (i - center) * SKILL.railshot.spreadRad), params);
  }
  pushSfx(state, "railshot");
}

/** 壁までの線分（stepPx 刻みで走査）の終点 */
export function beamEnd(state: GameState, origin: Vec, dir: Vec): Vec {
  const r = SKILL.railshot;
  let end = { ...origin };
  for (let d = r.stepPx; d <= r.maxLength; d += r.stepPx) {
    const next = add(origin, scale(dir, d));
    if (overlapsWall(state, next.x, next.y, 0)) break;
    end = next;
  }
  return end;
}

/** 点から線分までの距離 */
function distToSegment(pt: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const len2 = ab.x * ab.x + ab.y * ab.y;
  if (len2 === 0) return length(sub(pt, a));
  const t = Math.max(0, Math.min(1, ((pt.x - a.x) * ab.x + (pt.y - a.y) * ab.y) / len2));
  return length(sub(pt, add(a, scale(ab, t))));
}

function fireBeam(state: GameState, origin: Vec, dir: Vec, params: CastParams): void {
  const r = SKILL.railshot;
  const end = beamEnd(state, origin, dir);
  spawnLine(state, origin, end, COLOR_RAIL, BEAM_LIFE);
  for (const e of state.enemies) {
    if (e.hp <= 0 || e.phase === "spawning") continue;
    if (distToSegment(e.body.pos, origin, end) > e.body.radius + r.halfWidth) continue;
    rangedSkillHit(state, e, params, skillPower(state, r.damage, params), dir, r.knockback, false);
  }
  for (const pr of state.projectiles) {
    if (pr.owner !== "enemy" || pr.life <= 0) continue;
    if (distToSegment(pr.pos, origin, end) > pr.radius + r.halfWidth) continue;
    pr.life = 0;
    spawnBurst(state, pr.pos, pr.color, 4, 60, 0.2, 1.5);
  }
}

/** 構え中に届きそうな攻撃（敵弾・突進中の接触）を探して受け止める */
function updateParry(state: GameState, a: ActiveCast, dt: number): void {
  const rs = state.skills;
  a.timer -= dt;
  rs.parryTimer = Math.max(0, a.timer);
  if (catchThreats(state)) {
    parrySuccess(state, a);
    return;
  }
  if (a.timer > 0) return;
  rs.active = null;
  rs.parryTimer = 0;
  rs.parryFailTimer = SKILL.parry.failLock;
}

function catchThreats(state: GameState): boolean {
  const body = state.player.body;
  const reach = body.radius + SKILL.parry.catchPad;
  let caught = false;
  for (const pr of state.projectiles) {
    if (pr.owner !== "enemy" || pr.life <= 0) continue;
    if (!circlesOverlap(pr.pos.x, pr.pos.y, pr.radius, body.pos.x, body.pos.y, reach)) continue;
    pr.life = 0;
    caught = true;
  }
  for (const e of state.enemies) {
    if (e.hp <= 0 || e.phase !== "strike" || enemyDef(e.defKey).contactDamage <= 0) continue;
    if (!circlesOverlap(e.body.pos.x, e.body.pos.y, e.body.radius, body.pos.x, body.pos.y, reach)) continue;
    caught = true;
  }
  return caught;
}

function parrySuccess(state: GameState, a: ActiveCast): void {
  const rs = state.skills;
  const p = state.player;
  rs.active = null;
  rs.parryTimer = 0;
  p.invulnTimer = Math.max(p.invulnTimer, PARRY_AFTER_INVULN);

  // 既存の JUST 回避と同じご褒美
  p.justTimer = state.stats.justDodgeWindow;
  state.slowmo = Math.max(state.slowmo, FEEL.justDodgeSlowmo);
  gainEnergy(state, PLAYER.energyPerHit * JUST_ENERGY_HITS);
  registerComboHit(state);
  addFloatingText(state, p.body.pos, "パリィ！", COLOR_JUST, PARRY_TEXT_SCALE, PARRY_TEXT_LIFE);
  spawnBurst(state, p.body.pos, COLOR_JUST, 14, 120, 0.4, 2);
  state.flash = Math.max(state.flash, 0.2);
  pushSfx(state, "parry");

  const radius = SKILL.parry.radius * a.params.areaMul;
  spawnRing(state, p.body.pos, radius, COLOR_JUST, RING_LIFE * 2);
  for (const e of enemiesInRadius(state, p.body.pos, radius)) {
    meleeSkillHit(state, e, a.params, skillPower(state, SKILL.parry.damage, a.params), sub(e.body.pos, p.body.pos), SKILL.parry.knockback, true);
  }
  fireTrigger(state, "onJustDodge", { pos: { ...p.body.pos } });

  // 成功のご褒美は CD の一部だけ（全回復だと構え直しで固め続けられる。docs/COMBAT_DESIGN.md C-1 の 7）
  const slot = rs.slots[a.slot];
  if (!slot) return;
  slot.cooldownLeft = Math.max(0, slot.cooldownLeft - slot.cooldownTotal * SKILL.parry.successRefund);
}

// ---------------------------------------------------------------------------
// グレネード・反響・残像
// ---------------------------------------------------------------------------

/** 照準位置（最大射程、壁の手前でクランプ） */
function clampTarget(state: GameState, from: Vec, target: Vec, maxRange: number): Vec {
  const f = SKILL.frag;
  const delta = sub(target, from);
  const dir = normalize(delta, state.player.facing);
  const maxD = Math.min(length(delta), maxRange);
  let to = { ...from };
  for (let d = f.wallProbe; d <= maxD; d += f.wallProbe) {
    const next = add(from, scale(dir, d));
    if (overlapsWall(state, next.x, next.y, f.wallProbe)) break;
    to = next;
  }
  return to;
}

function throwGrenades(state: GameState, from: Vec, target: Vec, params: CastParams): void {
  const f = SKILL.frag;
  const to = clampTarget(state, from, target, f.maxRange);
  const count = Math.max(1, 1 + params.countBonus);
  const dir = normalize(sub(to, from), state.player.facing);
  const side = { x: -dir.y, y: dir.x };
  const center = (count - 1) / 2;
  for (let i = 0; i < count; i++) {
    const offset = add(to, scale(side, (i - center) * f.spread));
    const dest = overlapsWall(state, offset.x, offset.y, f.wallProbe) ? to : offset;
    const flight = f.flight * params.timeMul;
    const fuse = f.fuse * params.timeMul;
    state.skills.grenades.push({
      id: allocId(state),
      from: { ...from },
      to: dest,
      flight,
      flightTotal: flight,
      fuse,
      fuseTotal: fuse,
      params,
    });
  }
}

export function grenadeRadius(params: CastParams): number {
  return SKILL.frag.radius * params.areaMul;
}

function updateGrenades(state: GameState, dt: number): void {
  const rs = state.skills;
  for (const g of rs.grenades) {
    if (g.flight > 0) {
      g.flight = Math.max(0, g.flight - dt);
      continue;
    }
    g.fuse -= dt;
    if (g.fuse <= 0) explodeGrenade(state, g.to, g.params);
  }
  rs.grenades = rs.grenades.filter((g) => g.flight > 0 || g.fuse > 0);
}

function explodeGrenade(state: GameState, pos: Vec, params: CastParams): void {
  const f = SKILL.frag;
  const radius = grenadeRadius(params);
  spawnRing(state, pos, radius, COLOR_RAIL, RING_LIFE * 2);
  spawnBurst(state, pos, "#ffb060", 24, 180, 0.45, 2.5);
  shake(state, SHAKE_SKILL);
  pushSfx(state, "explode");
  for (const e of enemiesInRadius(state, pos, radius)) {
    rangedSkillHit(state, e, params, skillPower(state, f.damage, params), sub(e.body.pos, pos), f.knockback, true);
  }
  // 自爆: 無敵中（ダッシュ）なら無効
  const p = state.player;
  if (p.invulnTimer > 0 || p.buffs.invuln > 0) return;
  if (!circlesOverlap(pos.x, pos.y, radius, p.body.pos.x, p.body.pos.y, p.body.radius)) return;
  damagePlayer(state, p.maxHp * f.selfDamageFraction, pos);
}

function updateEchoes(state: GameState, dt: number): void {
  const rs = state.skills;
  const due = [];
  for (const e of rs.echoes) {
    e.timer -= dt;
    if (e.timer <= 0) due.push(e);
  }
  if (due.length === 0) return;
  rs.echoes = rs.echoes.filter((e) => e.timer > 0);
  for (const e of due) {
    executeRemote(state, e);
    // 遅延の本発動に反響が付いていれば、ここから数える
    if (e.kind === "delay") scheduleEcho(state, e);
  }
}

const GHOST_TIME: Record<Ghost["skillKey"], (p: CastParams) => number> = {
  whirl: (p) => SKILL.whirl.duration * p.timeMul,
  lunge: (p) => SKILL.lunge.time * p.timeMul,
  spiral: (p) => SKILL.spiral.duration * p.timeMul,
};

/** 反響・遅延の発動。プレイヤーは動かさず、発動地点・向き・照準地点で起こす */
function executeRemote(state: GameState, e: EchoCast): void {
  switch (e.skillKey) {
    case "whirl":
    case "lunge":
    case "spiral": {
      const total = GHOST_TIME[e.skillKey](e.params);
      state.skills.ghosts.push({
        skillKey: e.skillKey,
        timer: total,
        total,
        pos: { ...e.origin },
        dir: { ...e.dir },
        params: e.params,
        hitIds: new Set(),
        hitsDone: 0,
      });
      return;
    }
    case "frag":
      throwGrenades(state, e.origin, e.target, e.params);
      return;
    case "railshot":
      fireRails(state, e.origin, e.dir, e.params);
      return;
    case "quake":
      quakeRelease(state, e.origin, e.dir, e.params);
      return;
    case "chainHook":
      hookInstant(state, e.origin, e.dir, e.params);
      return;
    case "thunder":
      placeStrikes(state, e.target, e.params);
      return;
    case "gravityWell":
      spawnWell(state, e.target, e.params);
      return;
    case "mines":
      placeMine(state, e.origin, e.params);
      return;
    case "frostField":
      spawnField(state, e.target, e.params);
      return;
    case "parry":
    case "bloodPact":
    case "haste":
      // canAttach で反響・遅延は付かない
      return;
  }
}

/** 反響・遅延の予兆を出す地点（照準地点を使うスキルは照準地点） */
export function remoteAnchor(e: EchoCast): Vec {
  return CAST_RANGE[e.skillKey] !== undefined ? e.target : e.origin;
}

function updateGhosts(state: GameState, dt: number): void {
  const rs = state.skills;
  for (const g of rs.ghosts) updateGhost(state, g, dt);
  rs.ghosts = rs.ghosts.filter((g) => g.timer > 0);
}

function updateGhost(state: GameState, g: Ghost, dt: number): void {
  if (g.skillKey === "spiral") {
    g.timer -= dt;
    g.hitsDone = stepSpiral(state, g.pos, g.dir, g.params, g.total - g.timer, g.total, g.hitsDone);
    return;
  }
  if (g.skillKey === "whirl") {
    g.timer -= dt;
    g.hitsDone = stepWhirlHits(state, g.pos, g.params, g.total - g.timer, g.total, g.hitsDone);
    return;
  }
  const step = lungeSpeed(state, g.params) * Math.min(dt, g.timer);
  g.timer -= dt;
  const body = { pos: g.pos, vel: { x: 0, y: 0 }, radius: state.player.body.radius };
  const hit = moveBody(state, body, g.dir.x * step, g.dir.y * step);
  lungeHits(state, g.pos, g);
  if (hit.hitX || hit.hitY) g.timer = 0;
}

// ---------------------------------------------------------------------------
// ドロップ・拾得・刻印符
// ---------------------------------------------------------------------------

/** 部屋クリアと階層到達を検出する（floor.ts を触らずに済ませる） */
function syncTracking(state: GameState): void {
  const rs = state.skills;
  const t = rs.tracking;
  if (t.depth !== state.depth) {
    const first = t.depth === null;
    t.depth = state.depth;
    t.cleared = state.rooms.map((r) => r.cleared);
    if (first) return;
    // 前の階に残したものは失われる
    rs.runes = [];
    rs.floorStones = [];
    rs.grenades = [];
    rs.echoes = [];
    rs.ghosts = [];
    rs.strikes = [];
    rs.wells = [];
    rs.mines = [];
    rs.fields = [];
    rs.bullets = [];
    rs.curses.clear();
    if (state.rng.chance(SKILL.drop.stoneOnDepth)) {
      const p = state.player.body.pos;
      dropSkillStone(state, { x: p.x, y: p.y + SKILL.drop.depthOffsetY });
    }
    return;
  }
  state.rooms.forEach((room, i) => {
    if (!room.cleared || t.cleared[i]) return;
    t.cleared[i] = true;
    if (!state.rng.chance(SKILL.drop.runeOnRoomClear)) return;
    const c = rectCenterPx(room.rect);
    const pos = { x: c.x + SKILL.drop.runeOffsetX, y: c.y };
    dropRune(state, overlapsWall(state, pos.x, pos.y, 1) ? c : pos);
  });
}

function equippedSkillKeys(state: GameState): SkillKey[] {
  const keys: SkillKey[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const stone = stoneInSlot(state.skills.profile, i);
    if (stone) keys.push(stone.skillKey);
  }
  return keys;
}

export function dropRune(state: GameState, pos: Vec, modifier?: ModifierKey): void {
  const key = modifier ?? rollRuneModifier(state.rng, equippedSkillKeys(state));
  state.skills.runes.push({ id: allocId(state), modifier: key, pos: { ...pos }, bobTime: 0, warned: false });
  pushSfx(state, "lootDrop");
}

/**
 * 刻印符を装着中スキルのリンク枠へ自動で差す。
 * 優先: 同じ修飾子を持たず空きのあるスロット → 同じ修飾子を持たないスロットの最古を押し出す → 同じ修飾子を最新扱いに。
 * 差したスロット番号を返す（付けられる枠が無ければ -1）
 */
export function attachRune(state: GameState, modifier: ModifierKey): number {
  const rs = state.skills;
  const candidates: number[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const stone = stoneInSlot(rs.profile, i);
    if (!stone || stone.links <= 0) continue;
    if (!canAttach(SKILL_DEFS[stone.skillKey], modifier)) continue;
    candidates.push(i);
  }
  if (candidates.length === 0) return -1;

  const usable = (i: number): ModifierKey[] => {
    const stone = stoneInSlot(rs.profile, i);
    const slot = rs.slots[i];
    if (!stone || !slot) return [];
    return slot.modifiers.filter((k) => canAttach(SKILL_DEFS[stone.skillKey], k));
  };
  const linksOf = (i: number): number => stoneInSlot(rs.profile, i)?.links ?? 0;
  const without = candidates.filter((i) => !(rs.slots[i]?.modifiers.includes(modifier) ?? false));

  const free = without.find((i) => usable(i).length < linksOf(i));
  if (free !== undefined) {
    rs.slots[free]?.modifiers.push(modifier);
    return free;
  }
  const target = without[0];
  if (target !== undefined) {
    const slot = rs.slots[target];
    const oldest = usable(target)[0];
    if (!slot || !oldest) return -1;
    slot.modifiers.splice(slot.modifiers.indexOf(oldest), 1);
    slot.modifiers.push(modifier);
    return target;
  }
  // 全候補が既に持っている: 最新扱いにする（重複装着はしない）
  const first = candidates[0] ?? -1;
  const slot = rs.slots[first];
  if (slot) {
    slot.modifiers.splice(slot.modifiers.indexOf(modifier), 1);
    slot.modifiers.push(modifier);
  }
  return first;
}

function updateRunes(state: GameState, dt: number): void {
  const rs = state.skills;
  const body = state.player.body;
  const picked = new Set<number>();
  for (const rune of rs.runes) {
    rune.bobTime += dt;
    if (rune.bobTime < SKILL.drop.pickupDelay) continue;
    if (!circlesOverlap(rune.pos.x, rune.pos.y, SKILL.drop.pickupRadius, body.pos.x, body.pos.y, body.radius)) continue;
    const def = MODIFIERS[rune.modifier];
    const slot = attachRune(state, rune.modifier);
    if (slot < 0) {
      if (!rune.warned) addFloatingText(state, rune.pos, "空き枠なし", COLOR_NOT_READY, LABEL_SCALE, LABEL_LIFE);
      rune.warned = true;
      continue;
    }
    picked.add(rune.id);
    addFloatingText(state, rune.pos, `${def.name} → ${slot + 1}`, def.color, LABEL_SCALE, LABEL_LIFE);
    pushLog(state, `符文「${def.name}」をスキル${slot + 1}に連結した。`, def.color);
    pushSfx(state, "runeAttach");
  }
  if (picked.size > 0) rs.runes = rs.runes.filter((r) => !picked.has(r.id));
}

function updateFloorStones(state: GameState, dt: number): void {
  const rs = state.skills;
  const body = state.player.body;
  const picked = new Set<number>();
  for (const fs of rs.floorStones) {
    fs.bobTime += dt;
    if (fs.bobTime < SKILL.drop.pickupDelay) continue;
    if (!circlesOverlap(fs.pos.x, fs.pos.y, SKILL.drop.pickupRadius, body.pos.x, body.pos.y, body.radius)) continue;
    if (!addStone(rs.profile, fs.stone)) {
      if (!fs.warned) addFloatingText(state, fs.pos, "スキル倉庫が満杯", COLOR_BLOOD, LABEL_SCALE, LABEL_LIFE);
      fs.warned = true;
      continue;
    }
    saveSkillProfile(rs.profile);
    picked.add(fs.id);
    const label = stoneLabel(fs.stone);
    addFloatingText(state, fs.pos, label, SKILL.drop.stoneColor, LABEL_SCALE, LABEL_LIFE);
    pushLog(state, `スキル石: ${label}`, SKILL.drop.stoneColor);
    pushSfx(state, "lootRare");
  }
  if (picked.size > 0) rs.floorStones = rs.floorStones.filter((fs) => !picked.has(fs.id));
}

/** 血の契約中の赤いオーラ */
function spawnAura(state: GameState): void {
  if (state.skills.frenzy.time <= 0 || state.tick % AURA_EVERY_TICKS !== 0) return;
  spawnBurst(state, state.player.body.pos, COLOR_BLOOD, 1, AURA_SPEED, 0.35, 1.5);
}

/** 描画用: 刻印符の装着状況（有効 / 無効）。UI・HUD が使う */
export function slotModifierView(state: GameState, slot: number): { key: ModifierKey; active: boolean }[] {
  const s = state.skills.slots[slot];
  const stone = stoneInSlot(state.skills.profile, slot);
  if (!s) return [];
  if (!stone) return s.modifiers.map((key) => ({ key, active: false }));
  const def = SKILL_DEFS[stone.skillKey];
  let used = 0;
  return s.modifiers.map((key) => {
    const active = canAttach(def, key) && used < stone.links;
    if (active) used += 1;
    return { key, active };
  });
}

/** ツールチップ用の CD 表記（0.1 秒単位） */
export function formatCooldown(seconds: number): string {
  return `${seconds.toFixed(1)}s`;
}
