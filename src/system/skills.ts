import type { FrameInput } from "../core/input";
import { type Enemy, type GameState, allocId, pushLog, pushSfx } from "../core/state";
import { type Vec, add, fromAngle, angle, length, normalize, scale, sub } from "../core/vec";
import { screenToWorld } from "../core/view";
import { enemyDef } from "../data/enemies";
import { FEEL, PLAYER } from "../data/tuning";
import { rectCenterPx } from "../map/grid";
import { MODIFIERS, SKILL, SKILL_DEFS, canAttach, castCooldown, resolveCast, stoneLabel } from "../skills/data";
import { rollRuneModifier } from "../skills/generator";
import { addStone, saveSkillProfile, stoneInSlot } from "../skills/persistence";
import type {
  ActiveCast,
  CastParams,
  Ghost,
  ModifierKey,
  SkillDef,
  SkillKey,
  SkillProfile,
  SkillRunState,
  SkillStone,
} from "../skills/types";
import {
  COLOR_JUST,
  cancelAttack,
  damageEnemy,
  damagePlayer,
  gainEnergy,
  healPlayer,
  registerComboHit,
  rollOutgoing,
} from "./combat";
import { addFloatingText, shake, spawnBurst, spawnLine, spawnRing } from "./effects";
import { payOverclock } from "./keystones";
import { dropSkillStone } from "./loot";
import { circlesOverlap, moveBody, overlapsWall } from "./physics";
import { enemiesInRadius } from "./statusEffects";
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

/** 1 スロットぶんの解決結果 */
export interface ResolvedSlot {
  stone: SkillStone;
  def: SkillDef;
  params: CastParams;
  cooldown: number;
}

export function createSkillRunState(profile: SkillProfile): SkillRunState {
  return {
    profile,
    slots: Array.from({ length: SLOT_COUNT }, () => ({ modifiers: [], cooldownLeft: 0, cooldownTotal: 0, chargesLeft: 1 })),
    active: null,
    pendingSlot: -1,
    pendingTimer: 0,
    grenades: [],
    echoes: [],
    ghosts: [],
    runes: [],
    floorStones: [],
    frenzy: { time: 0, mul: 1 },
    lifesteal: { time: 0, mul: 0 },
    parryTimer: 0,
    parryFailTimer: 0,
    stunTimer: 0,
    lungeComboTimer: 0,
    notReadyTimer: 0,
    enemyHp: new Map(),
    tracking: { depth: null, cleared: [] },
  };
}

export function resolveSlot(state: GameState, slot: number): ResolvedSlot | null {
  const rs = state.skills;
  const stone = stoneInSlot(rs.profile, slot);
  const slotState = rs.slots[slot];
  if (!stone || !slotState) return null;
  const def = SKILL_DEFS[stone.skillKey];
  const params = resolveCast(def, stone, slotState.modifiers);
  return { stone, def, params, cooldown: castCooldown(def, params) };
}

// ---------------------------------------------------------------------------
// player.ts から参照する問い合わせ
// ---------------------------------------------------------------------------

/** 近接・射撃を受け付けないか */
export function skillLocksAttack(state: GameState): boolean {
  const rs = state.skills;
  return rs.active !== null || rs.parryFailTimer > 0 || rs.stunTimer > 0;
}

/** ダッシュを受け付けないか（パリィ失敗・突進の壁激突） */
export function skillLocksDash(state: GameState): boolean {
  const rs = state.skills;
  return rs.parryFailTimer > 0 || rs.stunTimer > 0;
}

/** 入力移動に掛ける倍率 */
export function skillMoveMul(state: GameState): number {
  const rs = state.skills;
  if (rs.parryFailTimer > 0 || rs.stunTimer > 0) return 0;
  const a = rs.active;
  if (!a) return 1;
  switch (a.skillKey) {
    case "whirl":
      return a.phase === "main" ? SKILL.whirl.moveMul : 1;
    case "lunge":
    case "railshot":
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

  const pressed = [input.skill1Pressed, input.skill2Pressed];
  pressed.forEach((on, i) => {
    if (on) requestCast(state, i, input);
  });
  tryPending(state, input);

  updateActive(state, dt);
  updateGrenades(state, dt);
  updateEchoes(state, dt);
  updateGhosts(state, dt);
  updateFloorStones(state, dt);
  updateRunes(state, dt);
  spawnAura(state);
}

function tickTimers(state: GameState, dt: number): void {
  const rs = state.skills;
  rs.frenzy.time = Math.max(0, rs.frenzy.time - dt);
  rs.lifesteal.time = Math.max(0, rs.lifesteal.time - dt);
  rs.parryFailTimer = Math.max(0, rs.parryFailTimer - dt);
  rs.stunTimer = Math.max(0, rs.stunTimer - dt);
  rs.lungeComboTimer = Math.max(0, rs.lungeComboTimer - dt);
  rs.notReadyTimer = Math.max(0, rs.notReadyTimer - dt);
  rs.pendingTimer = Math.max(0, rs.pendingTimer - dt);
  if (rs.pendingTimer === 0) rs.pendingSlot = -1;
}

/** チャージ制: 減っている間だけ CD が進み、0 になるたび 1 回復（ダッシュと同じ） */
function tickSlot(state: GameState, index: number, dt: number): void {
  const slot = state.skills.slots[index];
  const r = resolveSlot(state, index);
  if (!slot || !r) return;
  const max = r.params.charges;
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

function attackCommitted(state: GameState): boolean {
  const phase = state.player.attack.phase;
  return phase === "windup" || phase === "active";
}

function requestCast(state: GameState, index: number, input: FrameInput): void {
  const rs = state.skills;
  if (!resolveSlot(state, index)) {
    notReady(state, "no skill");
    return;
  }
  if (rs.parryFailTimer > 0 || rs.stunTimer > 0 || rs.active) return;
  if (state.player.dashTimer > 0 || attackCommitted(state)) {
    rs.pendingSlot = index;
    rs.pendingTimer = SKILL.inputBuffer;
    return;
  }
  castSlot(state, index, input);
}

/** 先行入力: ダッシュ終了・近接の recover に入った瞬間に発動 */
function tryPending(state: GameState, input: FrameInput): void {
  const rs = state.skills;
  if (rs.pendingSlot < 0 || rs.active) return;
  if (state.player.dashTimer > 0 || attackCommitted(state)) return;
  const index = rs.pendingSlot;
  rs.pendingSlot = -1;
  castSlot(state, index, input);
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

/** 発動。成功したら true */
export function castSlot(state: GameState, index: number, input: FrameInput): boolean {
  const rs = state.skills;
  const slot = rs.slots[index];
  const r = resolveSlot(state, index);
  if (!slot || !r) return false;
  if (slot.chargesLeft <= 0) {
    notReady(state, "cooling");
    return false;
  }
  if (state.player.attack.phase !== "none") cancelAttack(state);

  const params = payCosts(state, r.params);
  const p = state.player;
  const dir = { ...p.facing };
  const origin = { ...p.body.pos };
  const target = aimTarget(state, input);
  const key = r.def.key;
  CAST[key](state, index, params, dir, target);

  slot.chargesLeft -= 1;
  if (slot.cooldownLeft <= 0) setCooldown(slot, r.cooldown);
  if (params.echo) {
    rs.echoes.push({
      timer: params.echo.delay,
      skillKey: key,
      origin,
      dir,
      target: clampThrowTarget(state, origin, target),
      params: { ...params, damageMul: params.damageMul * params.echo.damageMul, echo: null },
    });
  }
  if (r.def.damageKind === "ranged") fireTrigger(state, "onShoot", { pos: origin });
  pushSfx(state, "skillCast");
  return true;
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
    state.skills.frenzy = { time, mul: 1 + (b.speedMul - 1) * params.potencyMul };
    state.skills.lifesteal = { time, mul: b.lifesteal * params.potencyMul };
    addFloatingText(state, p.body.pos, "BLOOD PACT", COLOR_BLOOD, LABEL_SCALE, PARRY_TEXT_LIFE);
    spawnBurst(state, p.body.pos, COLOR_BLOOD, 16, 90, 0.4, 2);
  },
};

/** 発動中スキルの中断。dashCancel なら撃ち抜き照準中の CD を半分返す */
function cancelActive(state: GameState, dashCancel: boolean): void {
  const rs = state.skills;
  const a = rs.active;
  if (!a) return;
  rs.active = null;
  if (a.skillKey === "parry") rs.parryTimer = 0;
  if (!dashCancel || a.skillKey !== "railshot") return;
  const slot = rs.slots[a.slot];
  if (slot) slot.cooldownLeft = Math.max(0, slot.cooldownLeft - slot.cooldownTotal * SKILL.railshot.cancelRefund);
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
  }
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
  spawnRing(state, center, radius, COLOR_WHIRL, RING_LIFE);
  for (const e of enemiesInRadius(state, center, radius)) {
    meleeSkillHit(state, e, SKILL.whirl.damage * params.damageMul, sub(e.body.pos, center), SKILL.whirl.knockback, false);
  }
}

function meleeSkillHit(state: GameState, e: Enemy, base: number, dir: Vec, knockback: number, stagger: boolean): void {
  const out = rollOutgoing(state, e, base, "melee");
  const pos = { ...e.body.pos };
  damageEnemy(state, e, out.amount, dir, knockback * state.stats.knockbackMul, {
    stagger,
    hitstopSteps: stagger ? FEEL.hitstopHeavy : FEEL.hitstopLight,
    buildsEnergy: true,
    kind: "melee",
    crit: out.crit,
  });
  state.player.meleeHitCount += 1;
  fireTrigger(state, "onMeleeHit", { pos, targetId: e.id });
  fireTrigger(state, "everyNthMeleeHit", { pos, targetId: e.id });
}

function rangedSkillHit(state: GameState, e: Enemy, base: number, dir: Vec, knockback: number, stagger: boolean): void {
  const out = rollOutgoing(state, e, base, "ranged");
  damageEnemy(state, e, out.amount, dir, knockback * state.stats.knockbackMul, {
    stagger,
    hitstopSteps: stagger ? FEEL.hitstopHeavy : FEEL.hitstopLight,
    kind: "ranged",
    crit: out.crit,
  });
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
    meleeSkillHit(state, e, SKILL.lunge.damage * a.params.damageMul, a.dir, SKILL.lunge.knockback, true);
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
    rangedSkillHit(state, e, r.damage * params.damageMul, dir, r.knockback, false);
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
  addFloatingText(state, p.body.pos, "PARRY!", COLOR_JUST, PARRY_TEXT_SCALE, PARRY_TEXT_LIFE);
  spawnBurst(state, p.body.pos, COLOR_JUST, 14, 120, 0.4, 2);
  state.flash = Math.max(state.flash, 0.2);
  pushSfx(state, "parry");

  const radius = SKILL.parry.radius * a.params.areaMul;
  spawnRing(state, p.body.pos, radius, COLOR_JUST, RING_LIFE * 2);
  for (const e of enemiesInRadius(state, p.body.pos, radius)) {
    meleeSkillHit(state, e, SKILL.parry.damage * a.params.damageMul, sub(e.body.pos, p.body.pos), SKILL.parry.knockback, true);
  }
  fireTrigger(state, "onJustDodge", { pos: { ...p.body.pos } });

  const slot = rs.slots[a.slot];
  const r = resolveSlot(state, a.slot);
  if (!slot || !r) return;
  slot.chargesLeft = r.params.charges;
  slot.cooldownLeft = 0;
}

// ---------------------------------------------------------------------------
// グレネード・反響・残像
// ---------------------------------------------------------------------------

/** 照準位置（最大射程、壁の手前でクランプ） */
function clampThrowTarget(state: GameState, from: Vec, target: Vec): Vec {
  const f = SKILL.frag;
  const delta = sub(target, from);
  const dir = normalize(delta, state.player.facing);
  const maxD = Math.min(length(delta), f.maxRange);
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
  const to = clampThrowTarget(state, from, target);
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
    rangedSkillHit(state, e, f.damage * params.damageMul, sub(e.body.pos, pos), f.knockback, true);
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
    switch (e.skillKey) {
      case "whirl":
      case "lunge": {
        const total = e.skillKey === "whirl" ? SKILL.whirl.duration * e.params.timeMul : SKILL.lunge.time * e.params.timeMul;
        rs.ghosts.push({
          skillKey: e.skillKey,
          timer: total,
          total,
          pos: { ...e.origin },
          dir: { ...e.dir },
          params: e.params,
          hitIds: new Set(),
          hitsDone: 0,
        });
        break;
      }
      case "frag":
        throwGrenades(state, e.origin, e.target, e.params);
        break;
      case "railshot":
        fireRails(state, e.origin, e.dir, e.params);
        break;
      case "parry":
      case "bloodPact":
        // canAttach で反響は付かない
        break;
    }
  }
}

function updateGhosts(state: GameState, dt: number): void {
  const rs = state.skills;
  for (const g of rs.ghosts) updateGhost(state, g, dt);
  rs.ghosts = rs.ghosts.filter((g) => g.timer > 0);
}

function updateGhost(state: GameState, g: Ghost, dt: number): void {
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
      if (!rune.warned) addFloatingText(state, rune.pos, "no free link", COLOR_NOT_READY, LABEL_SCALE, LABEL_LIFE);
      rune.warned = true;
      continue;
    }
    picked.add(rune.id);
    addFloatingText(state, rune.pos, `${def.name} -> ${slot + 1}`, def.color, LABEL_SCALE, LABEL_LIFE);
    pushLog(state, `Rune ${def.name} linked to skill ${slot + 1}.`, def.color);
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
      if (!fs.warned) addFloatingText(state, fs.pos, "SKILL STASH FULL", COLOR_BLOOD, LABEL_SCALE, LABEL_LIFE);
      fs.warned = true;
      continue;
    }
    saveSkillProfile(rs.profile);
    picked.add(fs.id);
    const label = stoneLabel(fs.stone);
    addFloatingText(state, fs.pos, label, SKILL.drop.stoneColor, LABEL_SCALE, LABEL_LIFE);
    pushLog(state, `Skill stone: ${label}`, SKILL.drop.stoneColor);
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
