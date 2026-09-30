import type { FrameInput } from "../core/input";
import { castSfxName } from "../audio/sfxNames";
import { type Enemy, type GameState, allocId, pushLog, pushSfx } from "../core/state";
import { type Vec, add, length, normalize, scale, sub } from "../core/vec";
import { screenToWorld } from "../core/view";
import { enemyDef } from "../data/enemies";
import { BOON_LINEAGE, ENERGY, FEEL, MANA, PLAYER } from "../data/tuning";
import { recordProvenance } from "../loot/provenance";
import { rectCenterPx } from "../map/grid";
import {
  EXTRA_CAST,
  EXTRA_CAST_RANGE,
  extraCastBlock,
  updateExtraActive,
} from "../skills/actions";
import { WAVE2_CAST, WAVE2_CAST_RANGE, updateStakes, wave2CastBlock } from "../skills/actions2";
import { type ComboDef, findCombo } from "../skills/combos";
import {
  castShape,
  formRecoverMoveMul,
  inAnyForm,
  isFormSkill,
  isShapeKey,
  isToggleOff,
  noteFormStart,
  settleFormEnd,
  shapeCastBlock,
  shapeMoveMul,
  tickFormWait,
  toggleOffShape,
  updateShape,
} from "../skills/forms";
import {
  MODIFIERS,
  SKILL,
  SKILL_DEFS,
  activeModifiers,
  canAttach,
  castBurden,
  castInterval,
  modifierLinkCost,
  modifiersClash,
  resolveCast,
  skillAttack,
  slotLinks,
  wearBudCount,
} from "../skills/data";
import { type RuneDropSource, rollRuneDrop, rollRuneModifier } from "../skills/generator";
import { skillHit, skillPower, tickCurses } from "../skills/hit";
import { saveSkillProfile, stoneInSlot } from "../skills/persistence";
import { placeMine, playerInFrost, spawnField, spawnWell, updatePlacedSkills } from "../skills/placed";
import { updateShots } from "../skills/shots";
import { noteWearCast } from "../skills/wear";
import {
  onGraveFinisher,
  onSpringMeleeHit,
  onTurretShoot,
  updateGraves,
  updateKegs,
  updateSprings,
  updateTurrets,
} from "../skills/summons";
import {
  type ActiveCast,
  type CastParams,
  type EchoCast,
  EXTRA_SKILL_KEYS,
  type ExtraSkillKey,
  type ModifierKey,
  type SkillDef,
  type SkillKey,
  type SkillProfile,
  type SkillResource,
  type SkillRunState,
  type SkillSlotState,
  type SkillStone,
  WAVE2_SKILL_KEYS,
  type Wave2SkillKey,
  type Wave3SkillKey,
} from "../skills/types";
import type { Element } from "../core/element";
import { favoredMovesets } from "../data/jobs";
import { buffMul } from "./attributes";
import { boonGrantedModifiers, boonManaCostMul, hasBoon, onBoonSkillCast } from "./boons";
import { refreshResonance } from "./resonance";
import { FLOW_TURN_TALLY } from "./boonDefs/cycle";
import { COLOR_JUST, cancelAttack, damageEnemy, gainEnergy, healSustained, registerComboHit, rollOutgoing } from "./combat";
import { addFloatingText, spawnBurst, spawnLine, spawnRing } from "./effects";
import { KS, canAffordSkill, hasKeystone, payOverclock, paySkillCost } from "./keystones";
import { dropSkillStone } from "./loot";
import { circlesOverlap, moveBody, overlapsWall } from "./physics";
import { enemiesInRadius, playerCanCast } from "./statusEffects";
import { fireTrigger } from "./triggers";
import { pushPlayerEvent } from "../core/events";
import { noteSkillCombo } from "../meta/runRecord";
import { ART_CAST_RANGE, isArtKey, weaponArtLabel } from "../skills/arts";
import { MOVESETS } from "../data/weapons";
import type { ArtSkillKey } from "../skills/arts/keys";
import { castArt, updateArtQueue } from "../skills/arts/engine";
import { consumeFreeCast, formSkillCooldownMul, freeCastCost, tickTomeBell } from "./tomeBell";

/**
 * アクティブスキルの発動・更新・ドロップ・刻印符。docs/ideas/skills.md「7-4」〜「7-7」。
 * updatePlayer から毎フレーム呼ばれる。乱数は state.rng のみ（決定性）。
 * 全スロット共通の最低間隔（GCD）は無い。各スロットは自分の最低間隔と CD だけで撃て、
 * 同じステップに押した複数スロットは 1→4 の順に発動する。本動作（exclusiveGroup "body"）同士だけが排他
 * （docs/COMBAT_DESIGN.md B-9）。刻印符は所持品から石に付ける（B-10）
 */

const COLOR_NOT_READY = "#808080";
const COLOR_BLOOD = "#ff4040";
const TEXT_SCALE = 0.9;
const TEXT_LIFE = 0.4;
const LABEL_SCALE = 1;
const LABEL_LIFE = 1.4;
const RING_LIFE = 0.15;
const PARRY_TEXT_SCALE = 1.5;
const PARRY_TEXT_LIFE = 0.7;
/** パリィ成功直後、同じ攻撃の続きで被弾しないための無敵 */
const PARRY_AFTER_INVULN = 0.2;
const PARRY_MOVE_MUL = 0.5;
const AURA_EVERY_TICKS = 3;
const AURA_SPEED = 30;
const SLOT_COUNT = SKILL.slots;
const COLOR_HOOK = "#c0c0d0";
const COLOR_HASTE = "#80ffff";
const HOOK_STEP = 2;
const HOOK_LINE_LIFE = 0.12;
const HASTE_TEXT = "加速";
const SPARK_COUNT = 4;
const SPARK_SPEED = 50;
const SPARK_LIFE = 0.2;
const SPARK_SIZE = 1.5;
const COLOR_COMBO = "#ffe070";
const COLOR_FOLLOW = "#ffe0a0";
const COLOR_TRAP = "#c0a0ff";
/** 照準地点を使うスキルの最大射程（無いものは SKILL.defaultCastRange） */
const CAST_RANGE: Partial<Record<SkillKey, number>> = {
  gravityWell: SKILL.gravityWell.maxRange,
  frostField: SKILL.frostField.maxRange,
  ...EXTRA_CAST_RANGE,
  ...WAVE2_CAST_RANGE,
  ...ART_CAST_RANGE,
};

function isExtraKey(key: SkillKey): key is ExtraSkillKey {
  return (EXTRA_SKILL_KEYS as readonly string[]).includes(key);
}

function isWave2Key(key: SkillKey): key is Wave2SkillKey {
  return (WAVE2_SKILL_KEYS as readonly string[]).includes(key);
}

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
  /** 実際に使う資源（刻印符「定刻」「燃料化」で def.resource と変わる） */
  resource: SkillResource;
}

export function createSkillRunState(profile: SkillProfile): SkillRunState {
  const rs: SkillRunState = {
    profile,
    slots: Array.from({ length: SLOT_COUNT }, () => ({
      modifiers: [],
      runModifiers: [],
      cooldownLeft: 0,
      cooldownTotal: 0,
      chargesLeft: 1,
      charging: false,
      chargeTime: 0,
      intervalLeft: 0,
      heat: 0,
      heatTimer: 0,
      elementStep: 0,
    })),
    active: null,
    pendingSlot: -1,
    pendingTimer: 0,
    echoes: [],
    wells: [],
    mines: [],
    fields: [],
    runes: [],
    floorStones: [],
    frenzy: { time: 0, mul: 1 },
    lifesteal: { time: 0, mul: 0 },
    haste: { time: 0, mul: 1 },
    exhaustTimer: 0,
    curses: new Map(),
    parryTimer: 0,
    parryFailTimer: 0,
    notReadyTimer: 0,
    enemyHp: new Map(),
    tracking: { depth: null, cleared: [] },
    manaFlash: 0,
    clock: 0,
    shots: [],
    kegs: [],
    graves: [],
    turrets: [],
    springs: [],
    lastCast: null,
    recentSlots: [],
    lastMeleeHitAt: null,
    marks: new Map(),
    gasps: [],
    debts: [],
    debtOwed: 0,
    history: [],
    historyTimer: 0,
    hurtLog: [],
    lastHp: null,
    formRecover: 0,
    shape: null,
    formWait: 0,
    formWaitTotal: 0,
    formSince: null,
    stakes: [],
    stakeTick: 0,
    traps: [],
  };
  syncSlotModifiers(rs);
  return rs;
}

/**
 * スロットの実効の刻印符 = ラン内の刻印符（古い順。刻印符はセーブに持たない）。
 * granted は祝福（スキルの加護 BoonDef.grantsModifier）が全スロットに足す符。拾った符の後ろに置き、
 * その石に付けられない符・既にある符は足さない（リンクの上限は activeModifiers が他の符と同じに数える）
 */
export function effectiveSlotModifiers(rs: Readonly<SkillRunState>, slot: number, granted: readonly ModifierKey[] = []): ModifierKey[] {
  const stone = stoneInSlot(rs.profile, slot);
  const chosen = [...(rs.slots[slot]?.runModifiers ?? [])];
  if (!stone) return chosen;
  const def = SKILL_DEFS[stone.skillKey];
  return [...chosen, ...granted.filter((k) => !chosen.includes(k) && canAttach(def, k))];
}

/**
 * slot.modifiers をラン内の刻印符と祝福の符から作り直す。updateSkills の先頭で毎ステップ呼ぶ。
 * 装備画面での移す / 外すはここで次のステップから効く（リプレイの装備変更イベントと同じ時点に揃えるため、UI からは呼ばない）。
 * granted は祝福が全スロットに足す符（boonGrantedModifiers）
 */
export function syncSlotModifiers(rs: SkillRunState, granted: readonly ModifierKey[] = []): void {
  rs.slots.forEach((slot, i) => {
    const next = effectiveSlotModifiers(rs, i, granted);
    const same = next.length === slot.modifiers.length && next.every((k, j) => slot.modifiers[j] === k);
    if (!same) slot.modifiers = next;
  });
}

export function resolveSlot(state: GameState, slot: number): ResolvedSlot | null {
  const rs = state.skills;
  const stone = stoneInSlot(rs.profile, slot);
  const slotState = rs.slots[slot];
  if (!stone || !slotState) return null;
  const def = SKILL_DEFS[stone.skillKey];
  const params = cachedCast(def, stone, slotState, slot);
  const burden = castBurden(def, params);
  const dynamic = dynamicBurdenMul(state, slot, def, params);
  // 書の無詠唱は気力を 0 に、書を持つ間は再使用が短い（system/tomeBell.ts）
  const cost = freeCastCost(state, effectiveManaCost(state, burden.cost * dynamic).cost);
  return {
    stone,
    def,
    params,
    cooldown: burden.cooldown * dynamic * formSkillCooldownMul(state),
    cost,
    interval: castInterval(def, params),
    resource: params.resource,
  };
}

/** resolveCast の結果の覚え書き（スロットごと）。石・変異・刻印符が同じなら同じ結果なので毎フレーム作り直さない（リンクはスロットで固定） */
interface CastCache {
  stone: SkillStone;
  /** 使い込みの威力の芽の数（ラン中に芽が出たら作り直す） */
  powerBuds: number;
  variants: SkillStone["variants"];
  modifiers: string;
  params: CastParams;
}

const castCache = new WeakMap<SkillSlotState, CastCache>();

/**
 * 覚え書き付きの resolveCast。返す params は読むだけにする（castSlot は写しを作ってから書き換える）。
 * 決定性には関わらない（入力が同じなら resolveCast と同じ値）
 */
function cachedCast(def: SkillDef, stone: SkillStone, slot: SkillSlotState, index: number): CastParams {
  const modifiers = slot.modifiers.join(",");
  const hit = castCache.get(slot);
  const powerBuds = wearBudCount(stone);
  if (
    hit &&
    hit.stone === stone &&
    hit.powerBuds === powerBuds &&
    hit.variants === stone.variants &&
    hit.modifiers === modifiers
  ) {
    return hit.params;
  }
  const params = resolveCast(def, stone, slot.modifiers, index);
  castCache.set(slot, { stone, powerBuds, variants: stone.variants, modifiers, params });
  return params;
}

/**
 * 状態で変わる負担の倍率（刻印符「渇き撃ち」「刃の給油」「過熱」「巡り」と背水の一閃）。
 * HUD のコスト表示と実際の支払いが同じ値になるよう resolveSlot で掛ける
 */
function dynamicBurdenMul(state: GameState, slot: number, def: SkillDef, params: Readonly<CastParams>): number {
  const m = SKILL.modifier;
  const rs = state.skills;
  const p = state.player;
  let mul = 1;
  if (params.dryFire && p.mana >= state.stats.maxMana * m.dryFire.lowRatio) mul *= m.dryFire.costMul;
  if (params.bladeFeed) mul *= meleeFed(state) ? m.bladeFeed.costMul : m.bladeFeed.missMul;
  if (params.overheat) mul *= m.overheat.stepMul ** (rs.slots[slot]?.heat ?? 0);
  if (params.cycle) mul *= cycleMul(state, slot);
  if (def.key === "lastStand" && p.hp >= p.maxHp * SKILL.lastStand.heavyCostAt) mul *= SKILL.lastStand.heavyCostMul;
  return mul;
}

/** 刃の給油: 直前 window 秒以内に近接を当てたか */
function meleeFed(state: GameState): boolean {
  const at = state.skills.lastMeleeHitAt;
  return at !== null && state.skills.clock - at <= SKILL.modifier.bladeFeed.window;
}

/** 巡り: 直前 2 回が他のスロットなら軽く、直前が同じスロットなら重い */
function cycleMul(state: GameState, slot: number): number {
  const c = SKILL.modifier.cycle;
  const recent = state.skills.recentSlots;
  if (recent[0] === slot) return c.repeatMul;
  if (recent.length >= 2 && recent.every((s) => s !== slot)) return c.freshMul;
  return 1;
}

/**
 * マナ型のコストを最大マナで切り詰める。刻印符やリンクの負担でコストが最大マナを超えると
 * 満タンでも永久に撃てなくなるため。clamped は UI の注記用
 */
export function capManaCost(cost: number, maxMana: number): { cost: number; clamped: boolean } {
  if (cost <= maxMana) return { cost, clamped: false };
  return { cost: Math.max(0, maxMana), clamped: true };
}

/** 実際に払うコスト。誓約「過負荷」は不足分を HP で払えて上限を超えても撃てるので切り詰めない */
export function effectiveManaCost(state: GameState, cost: number): { cost: number; clamped: boolean } {
  const scaled = cost * Math.max(MANA.costMulMin, state.stats.manaCostMul * boonManaCostMul(state));
  if (hasKeystone(state, KS.overdraw)) return { cost: scaled, clamped: false };
  return capManaCost(scaled, state.stats.maxMana);
}

// ---------------------------------------------------------------------------
// player.ts から参照する問い合わせ
// ---------------------------------------------------------------------------

/** 近接・射撃を受け付けないか */
export function skillLocksAttack(state: GameState): boolean {
  const rs = state.skills;
  return rs.active !== null || rs.parryFailTimer > 0;
}

/** ダッシュを受け付けないか（パリィ失敗・加速の反動） */
export function skillLocksDash(state: GameState): boolean {
  const rs = state.skills;
  return rs.parryFailTimer > 0 || rs.exhaustTimer > 0;
}

/** 入力移動に掛ける倍率 */
export function skillMoveMul(state: GameState): number {
  const rs = state.skills;
  if (rs.parryFailTimer > 0) return 0;
  const haste = rs.haste.time > 0 ? rs.haste.mul : 1;
  const frost = playerInFrost(state) ? SKILL.frostField.selfMoveMul : 1;
  return activeMoveMul(rs.active) * haste * frost * chargingMoveMul(state) * formRecoverMoveMul(state) * shapeMoveMul(state);
}

/** 溜め中の移動倍率（段階溜めは溜め符より重い） */
function chargingMoveMul(state: GameState): number {
  const rs = state.skills;
  let mul = 1;
  rs.slots.forEach((s, i) => {
    if (!s.charging) return;
    const staged = chargeKind(state, i) === "staged";
    mul = Math.min(mul, staged ? SKILL.modifier.toStaged.moveMul : SKILL.modifier.charge.moveMul);
  });
  return mul;
}

/** 本動作中の移動倍率。パリィの構えは歩けるが遅く、鎖鎌・連環撃の間は止まる */
function activeMoveMul(a: ActiveCast | null): number {
  if (!a) return 1;
  return a.skillKey === "parry" ? PARRY_MOVE_MUL : 0;
}

/** 血の契約: 攻撃速度と連射に掛ける倍率 */
export function frenzyMul(state: GameState): number {
  const f = state.skills.frenzy;
  return f.time > 0 ? f.mul : 1;
}

/** バーストは常にスキルをキャンセルできる */
export function cancelSkills(state: GameState): void {
  cancelActive(state);
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
  healSustained(state, dealt * rs.lifesteal.mul, { silent: true });
}

// ---------------------------------------------------------------------------
// メイン更新
// ---------------------------------------------------------------------------

export function updateSkills(state: GameState, input: FrameInput, dt: number): void {
  const rs = state.skills;
  syncSlotModifiers(rs, boonGrantedModifiers(state));
  // 符の移し・外し（moveRunModifier は state を持たない）・石の付け替え・改鋳の取得は、ここで次のステップに数え直す。
  // 倍（resonanceModifiers）はすぐ効き、stats に畳む語（ダッシュ・見切りなど）は次の applyStats で追いつく
  // （ここで stats を畳み直すと、テストや QA が直に書いた stats を装備の stats で上書きしてしまう）
  refreshResonance(state);
  rs.clock += dt;
  syncTracking(state);
  const hurt = trackHurt(state);
  recordHistory(state, dt);
  tickTimers(state, dt);
  for (let i = 0; i < SLOT_COUNT; i++) tickSlot(state, i, dt);
  updateDebts(state, dt);
  // 左右クリックを差し替える変身は発動・近接より先に進める。解けていたら共有の待ちを伸ばす（どう積んでも稼働率が上限を超えない）
  updateShape(state, dt);
  settleFormEnd(state);

  // ダッシュは発動中のスキルをキャンセルする（CD は消費済み）
  if (rs.active && state.player.dashTimer > 0) cancelActive(state);

  // 同じステップに押した複数スロットは 1→4 の順で受け付ける（決定性のため順序を固定）
  const pressed = [input.skill1Pressed, input.skill2Pressed, input.skill3Pressed, input.skill4Pressed];
  pressed.forEach((on, i) => {
    if (!on) return;
    if (hasChargeModifier(state, i)) startCharge(state, i);
    else requestCast(state, i, input);
  });
  tryPending(state, input);
  updateCharging(state, input, dt, hurt);

  updateActive(state, dt);
  updateTraps(state, dt);
  updateEchoes(state, dt);
  updateArtQueue(state, dt);
  updateGasps(state);
  updatePlacedSkills(state, dt);
  updateShots(state, dt);
  updateKegs(state, dt);
  updateGraves(state, dt);
  updateTurrets(state, dt);
  updateSprings(state, dt);
  updateStakes(state, dt);
  updateHaste(state);
  updateFloorStones(state, dt);
  updateRunes(state, dt);
  spawnAura(state);
  // 自分で払った HP（血の代償・後払い・自爆）は被ダメに数えないよう、フレームの最後に基準を取り直す
  rs.lastHp = state.player.hp;
}

/** 前フレームの終わりからの HP の減少を被ダメとして記録する（恨み返し）。減った量を返す */
function trackHurt(state: GameState): number {
  const rs = state.skills;
  const hp = state.player.hp;
  const before = rs.lastHp;
  rs.lastHp = hp;
  const since = rs.clock - SKILL.grudge.window;
  rs.hurtLog = rs.hurtLog.filter((h) => h.at >= since);
  if (before === null || hp >= before) return 0;
  rs.hurtLog.push({ at: rs.clock, amount: before - hp });
  return before - hp;
}

/** 巻き戻し用に位置と HP を一定間隔で記録する（巻き戻せる秒 + 1 回ぶんだけ残す） */
function recordHistory(state: GameState, dt: number): void {
  const rs = state.skills;
  const b = SKILL.backflow;
  rs.historyTimer -= dt;
  if (rs.historyTimer > 0) return;
  rs.historyTimer = b.record;
  rs.history.push({ at: rs.clock, pos: { ...state.player.body.pos }, hp: state.player.hp });
  const since = rs.clock - b.rewind - b.record;
  rs.history = rs.history.filter((h) => h.at >= since);
}

/**
 * 後払いの返済。足りない分は HP で払う（HP は 1 未満にならない）。
 * HP でも払いきれない分は返済残（debtOwed）に積む。HP 1 のまま後払いを撃ち続けて踏み倒せないようにするため
 */
function updateDebts(state: GameState, dt: number): void {
  const rs = state.skills;
  if (rs.debts.length === 0) return;
  for (const debt of rs.debts) {
    debt.timer -= dt;
    if (debt.timer > 0) continue;
    const p = state.player;
    const fromMana = Math.min(p.mana, debt.amount);
    p.mana -= fromMana;
    rs.debtOwed += payDebtWithHp(state, debt.amount - fromMana);
  }
  rs.debts = rs.debts.filter((debt) => debt.timer > 0);
}

/** 返済の不足（マナ量）を HP で払い、HP 1 で止まって払えなかったマナ量を返す */
function payDebtWithHp(state: GameState, short: number): number {
  if (short <= 0) return 0;
  const p = state.player;
  const hpPerMana = SKILL.modifier.deferred.hpPerMana * p.maxHp;
  if (hpPerMana <= 0) return short;
  const room = Math.max(0, p.hp - 1);
  const need = short * hpPerMana;
  p.hp = Math.max(1, p.hp - need);
  return need <= room ? 0 : (need - room) / hpPerMana;
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
  rs.notReadyTimer = Math.max(0, rs.notReadyTimer - dt);
  rs.pendingTimer = Math.max(0, rs.pendingTimer - dt);
  if (rs.pendingTimer === 0) rs.pendingSlot = -1;
  rs.manaFlash = Math.max(0, rs.manaFlash - dt);
  tickTomeBell(state, dt);
  tickFormWait(state, dt);
  for (const slot of rs.slots) {
    slot.heatTimer = Math.max(0, slot.heatTimer - dt);
    if (slot.heatTimer === 0) slot.heat = 0;
  }
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
  const max = r.resource === "mana" ? 1 : r.params.charges;
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
  notReady(state, "気力不足");
  pushSfx(state, "manaEmpty");
  rs.manaFlash = SKILL.manaFlashTime;
  rs.pendingSlot = -1;
}

/** このスロットの最低間隔の中か（全スロット共通の最低間隔は無い） */
function intervalBlocked(state: GameState, index: number): boolean {
  return (state.skills.slots[index]?.intervalLeft ?? 0) > 0;
}

/**
 * 本動作の排他: 発動中の本動作（active）がある間、排他グループ body のスキルは撃てない。
 * body 以外（設置・射撃・強化）は本動作を中断せずに並行して撃てる
 */
function bodyBlocked(state: GameState, index: number): boolean {
  if (!state.skills.active) return false;
  const stone = stoneInSlot(state.skills.profile, index);
  return stone !== null && SKILL_DEFS[stone.skillKey].exclusiveGroup === "body";
}

/**
 * HUD 用: いま押せば本動作の排他か変身の規則（変身中・共有の待ち・構え中。skills/forms.ts）で弾かれるか。
 * QA bot もこれで撃てないスロットを飛ばす
 */
export function slotBodyBlocked(state: GameState, index: number): boolean {
  return bodyBlocked(state, index) || slotFormBlock(state, index) !== null;
}

/** 変身の規則でこのスロットが撃てない理由（撃てるなら null） */
function slotFormBlock(state: GameState, index: number): string | null {
  const stone = stoneInSlot(state.skills.profile, index);
  return stone ? shapeCastBlock(state, SKILL_DEFS[stone.skillKey], index) : null;
}

/** いま押すと砲身化・業火の化身を自分で解く操作になるスロットか（QA bot が解かないよう飛ばす） */
export function slotTogglesForm(state: GameState, index: number): boolean {
  const stone = stoneInSlot(state.skills.profile, index);
  return stone !== null && isToggleOff(state, stone.skillKey, index);
}

/** 行動不能（パリィ失敗）か本動作の排他で、このスロットの入力を受け付けないか */
function castLocked(state: GameState, index: number): boolean {
  return state.skills.parryFailTimer > 0 || bodyBlocked(state, index);
}

/** 払えるか。払えなければ理由を出して false（何も消費しない） */
function checkAffordable(state: GameState, index: number, r: ResolvedSlot): boolean {
  if (r.resource === "mana") {
    if (manaAffordable(state, index, r)) return true;
    const reason = manaRuleReason(state, index, r);
    if (reason) notReady(state, reason);
    else misfire(state);
    state.skills.pendingSlot = -1;
    return false;
  }
  if ((state.skills.slots[index]?.chargesLeft ?? 0) > 0) return true;
  notReady(state, "再使用待ち");
  return false;
}

/**
 * マナ型が撃てるか。後払い = 返済待ちでなければいつでも、
 * 血の肩代わり = 不足分を HP で払っても HP が残るなら撃てる
 */
function manaAffordable(state: GameState, index: number, r: ResolvedSlot): boolean {
  const p = state.player;
  if (r.params.deferredMul > 0) return state.skills.debtOwed <= 0 && !state.skills.debts.some((d) => d.slot === index);
  if (canAffordSkill(state, r.cost)) return true;
  if (!r.params.bloodTithe) return false;
  return p.hp - titheHpCost(state, r.cost) >= 1;
}

/** マナ不足以外の理由で撃てないときの浮き文字（後払いの返済待ち）。マナ不足なら null */
function manaRuleReason(state: GameState, index: number, r: ResolvedSlot): string | null {
  if (r.params.deferredMul > 0 && state.skills.debtOwed > 0) return "未払いあり";
  if (r.params.deferredMul > 0 && state.skills.debts.some((d) => d.slot === index)) return "返済待ち";
  return null;
}

/** 血の肩代わり: マナの不足分を HP で払う量 */
function titheHpCost(state: GameState, cost: number): number {
  const short = Math.max(0, cost - state.player.mana);
  return short * SKILL.modifier.bloodTithe.hpPerMana * state.player.maxHp;
}

function attackCommitted(state: GameState): boolean {
  const phase = state.player.attack.phase;
  return phase === "windup" || phase === "active";
}

function requestCast(state: GameState, index: number, input: FrameInput): void {
  if (!resolveSlot(state, index)) {
    notReady(state, "スキル未装備");
    return;
  }
  if (castLocked(state, index)) return;
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

/** 先行入力: ダッシュ終了・近接の recover・最低間隔の明けた瞬間に発動（本動作の排他が解けるまでは保持） */
function tryPending(state: GameState, input: FrameInput): void {
  const rs = state.skills;
  if (rs.pendingSlot < 0 || castLocked(state, rs.pendingSlot)) return;
  if (state.player.dashTimer > 0 || attackCommitted(state) || intervalBlocked(state, rs.pendingSlot)) return;
  const index = rs.pendingSlot;
  rs.pendingSlot = -1;
  castSlot(state, index, input);
}

// ---------------------------------------------------------------------------
// Charge（溜め）刻印符
// ---------------------------------------------------------------------------

/** このスロットの溜めの種類（溜め符 / 段階溜め / 無し）。リンク数・相性表を通した上で */
function chargeKind(state: GameState, index: number): "charge" | "staged" | null {
  const rs = state.skills;
  const stone = stoneInSlot(rs.profile, index);
  const slot = rs.slots[index];
  if (!stone || !slot) return null;
  const active = activeModifiers(SKILL_DEFS[stone.skillKey], slotLinks(index), slot.modifiers);
  if (active.includes("toStaged")) return "staged";
  return active.includes("charge") ? "charge" : null;
}

function hasChargeModifier(state: GameState, index: number): boolean {
  return chargeKind(state, index) !== null;
}

/** 溜めの上限秒（段階溜めは 3 段目の秒） */
function chargeMaxTime(kind: "charge" | "staged" | null): number {
  const stages = SKILL.modifier.toStaged.stages;
  return kind === "staged" ? (stages[stages.length - 1] ?? SKILL.modifier.charge.maxTime) : SKILL.modifier.charge.maxTime;
}

/**
 * 押した瞬間: 発動はせず溜めを始める（他のスキルが発動中・行動不能なら無視）。
 * マナ型はこの時点でコストを確認するだけで、払うのは離した瞬間（docs/COMBAT_DESIGN.md B-5）
 */
function startCharge(state: GameState, index: number): void {
  const slot = state.skills.slots[index];
  const r = resolveSlot(state, index);
  if (!r) {
    notReady(state, "スキル未装備");
    return;
  }
  if (!slot || !playerCanCast(state) || !checkAffordable(state, index, r)) return;
  if (castLocked(state, index)) return;
  slot.charging = true;
  slot.chargeTime = 0;
}

/** 溜めで上乗せするもの（段階溜めの 3 段目は回数と貫通も） */
export interface ChargeBonus {
  damageMul: number;
  areaMul: number;
  countBonus?: number;
  pierce?: number;
}

/** 経過秒(0..maxTime) から威力・範囲の倍率を出す。0.15 秒未満は通常発動（倍率 1） */
function chargeBonus(time: number): ChargeBonus {
  const c = SKILL.modifier.charge;
  const t = time < c.minTime ? 0 : Math.min(time, c.maxTime);
  const ratio = t / c.maxTime;
  return { damageMul: 1 + (c.maxDamageMul - 1) * ratio, areaMul: 1 + (c.maxAreaMul - 1) * ratio };
}

/** 段階溜めの段（0 = 1 段目未満 … 3 = 3 段目） */
export function stagedLevel(time: number): number {
  return SKILL.modifier.toStaged.stages.filter((t) => time >= t).length;
}

/** 段階溜め: 2 段目で範囲、3 段目でさらに回数と貫通 */
function stagedBonus(time: number): ChargeBonus {
  const s = SKILL.modifier.toStaged;
  const level = stagedLevel(time);
  if (level >= 3) return { damageMul: s.stage3.damageMul, areaMul: s.stage3.areaMul, countBonus: s.stage3.countBonus, pierce: s.stage3.pierce };
  if (level === 2) return { damageMul: s.stage2.damageMul, areaMul: s.stage2.areaMul };
  return { damageMul: 1, areaMul: 1 };
}

/** 段階溜めで被弾したら 1 段下げる（その段に入った瞬間の秒へ戻す） */
function dropStage(time: number): number {
  const stages = SKILL.modifier.toStaged.stages;
  const level = stagedLevel(time);
  return level >= 2 ? (stages[level - 2] ?? 0) : 0;
}

/** 溜め中のスロットを毎フレーム進め、離された瞬間に倍率付きで発動する。段階溜めは被弾で段が下がる */
function updateCharging(state: GameState, input: FrameInput, dt: number, hurt: number): void {
  const rs = state.skills;
  const held = [input.skill1Held, input.skill2Held, input.skill3Held, input.skill4Held];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slot = rs.slots[i];
    if (!slot || !slot.charging) continue;
    const kind = chargeKind(state, i);
    if (kind === "staged" && hurt > 0) slot.chargeTime = dropStage(slot.chargeTime);
    slot.chargeTime = Math.min(chargeMaxTime(kind), slot.chargeTime + dt);
    if (held[i]) continue;
    const time = slot.chargeTime;
    slot.charging = false;
    slot.chargeTime = 0;
    // 溜めている間に行動不能・本動作の排他にかかったら不発（チャージ・マナは未消費のまま）
    if (castLocked(state, i)) continue;
    // 最低間隔の中で離したら先行入力に回す（溜めの倍率は乗らない。minTime 未満の短押しで起きるのがほとんど）
    if (intervalBlocked(state, i)) {
      bufferCast(state, i);
      continue;
    }
    castSlot(state, i, input, kind === "staged" ? stagedBonus(time) : chargeBonus(time));
  }
}

/** HUD 用: 溜めゲージの割合(0..1)。溜めていなければ null */
export function chargeRatio(state: GameState, index: number): number | null {
  const slot = state.skills.slots[index];
  if (!slot || !slot.charging) return null;
  return Math.min(1, slot.chargeTime / chargeMaxTime(chargeKind(state, index)));
}

/** HUD 用: 段階溜めの段の区切り（ゲージ上の割合）。段階溜めでなければ空 */
export function chargeStageMarks(state: GameState, index: number): number[] {
  if (chargeKind(state, index) !== "staged") return [];
  const max = chargeMaxTime("staged");
  return SKILL.modifier.toStaged.stages.slice(0, -1).map((t) => t / max);
}

function aimTarget(state: GameState, input: FrameInput): Vec {
  const p = state.player;
  if (input.aimScreen) return screenToWorld(state.camera, input.aimScreen);
  return add(p.body.pos, scale(p.facing, SKILL.defaultCastRange));
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
 * 流転（輪廻の真髄）: 前の発動で払った気力 ÷ 最大気力 × ratio（上限 cap）がこの発動の倍。
 * 次の発動の分は研鑽の数え（boonRun.tallies[FLOW_TURN_TALLY]）に置く（ランの途中だけの値で、保存しない）
 */
export function flowTurnMul(state: GameState, manaPaid: number): number {
  if (!hasBoon(state, "flowTurn")) return 1;
  const f = BOON_LINEAGE.cycle.flowTurn;
  const tallies = state.boonRun.tallies;
  const mul = 1 + (tallies[FLOW_TURN_TALLY] ?? 0);
  tallies[FLOW_TURN_TALLY] = Math.min(f.cap, (manaPaid / Math.max(1, state.stats.maxMana)) * f.ratio);
  return mul;
}

/**
 * 発動。成功したら true。chargeMul は Charge 刻印符が離した瞬間に渡す威力・範囲の追加倍率。
 * 最低間隔の中・本動作の排他にかかるなら何もしない（呼び出し側が先行入力に回す）。払えなければ何も消費せず不発
 */
export function castSlot(state: GameState, index: number, input: FrameInput, chargeMul?: ChargeBonus): boolean {
  const rs = state.skills;
  const slot = rs.slots[index];
  const r = resolveSlot(state, index);
  if (!slot || !r) return false;
  // 怯み・沈黙中はスキル不可（docs/COMBAT_DESIGN.md D-5 / E-2）
  if (!playerCanCast(state)) return false;
  if (intervalBlocked(state, index) || bodyBlocked(state, index)) return false;
  // 砲身化・業火の化身の最中にもう一度撃つと、払わずに解く
  if (isToggleOff(state, r.def.key, index)) {
    toggleOffShape(state);
    slot.intervalLeft = r.interval;
    return true;
  }
  // 変身は同時に 1 つ・共有の待ち、狼化などの間はほかの石も撃てない（払う前に弾く）
  const formBlocked = shapeCastBlock(state, r.def, index);
  if (formBlocked) {
    notReady(state, formBlocked);
    rs.pendingSlot = -1;
    return false;
  }
  // 武器技は装備中の武器種でだけ撃てる（払う前に弾く）
  const weaponBlocked = weaponArtBlock(state, r.def);
  if (weaponBlocked) {
    notReady(state, weaponBlocked);
    rs.pendingSlot = -1;
    return false;
  }
  const p = state.player;
  const dir = { ...p.facing };
  const origin = { ...p.body.pos };
  const key = r.def.key;
  // 型替え符「自己中心化」は照準地点を自分の足元にする
  const aimed = clampTarget(state, origin, aimTarget(state, input), CAST_RANGE[key] ?? SKILL.defaultCastRange);
  const target = r.params.reshape === "toNova" ? { ...origin } : aimed;
  // 対象のいない消費系は何も払わずに弾く
  const blocked = castBlock(state, key, target, r.params);
  if (blocked) {
    notReady(state, blocked);
    rs.pendingSlot = -1;
    return false;
  }
  if (!checkAffordable(state, index, r)) return false;
  if (state.player.attack.phase !== "none") cancelAttack(state);

  const stateMul = castStateMul(state, r);
  const wave2 = wave2CastState(state, r.params);
  const combo = findCombo(state, r.def, target);
  const manaPaid = payResource(state, index, slot, r);
  onBoonSkillCast(state, index, r.resource, manaPaid);
  pushPlayerEvent(state, "onSkillCast", key, { slot: index, source: { kind: "skill", key } });
  recordProvenance(state, { kind: "skillCast" });
  const costed = payCosts(state, r.params);
  const flow = flowTurnMul(state, manaPaid);
  const base: CastParams = {
    ...costed,
    damageMul: costed.damageMul * (chargeMul?.damageMul ?? 1) * stateMul.damage * wave2.mul * flow,
    potencyMul: costed.potencyMul * stateMul.potency * wave2.mul,
    element: wave2.element,
    leyPool: { left: costed.leyline ? SKILL.modifier.leyline.maxPerCast : 0 },
    areaMul: costed.areaMul * (chargeMul?.areaMul ?? 1),
    countBonus: costed.countBonus + (chargeMul?.countBonus ?? 0),
    pierce: costed.pierce + (chargeMul?.pierce ?? 0),
    attuneCrit: stateMul.attuneCrit,
    slot: index,
    manaPaid,
    // 払い戻しの上限は払った額。反響・遅延の写しとも共有する（新しい参照を発動ごとに作る）
    refundPool: { left: manaPaid },
    hitRefundPool: { left: manaPaid * SKILL.modifier.refund.cap },
    gaspPool: { left: costed.lastGasp === null ? 0 : SKILL.modifier.lastGasp.maxPerCast },
    hitLog: new Set(),
    origin,
    combo: combo?.key ?? null,
  };
  const params = combo?.apply ? combo.apply(base) : base;
  if (combo) announceCombo(state, combo);
  const remote = { skillKey: key, origin, dir, target };

  if (params.reshape === "toTrap") {
    // 型替え符「罠化」: いま何も起きず、照準地点に罠を置く（踏まれたら罠の位置から発動。遅延・反響はそこから数える）
    placeTrap(state, key, target, params);
  } else if (params.delay) {
    // 遅延: いま何も起きず、発動地点で後から本発動（反響はその時点から数える）。
    // 投げ刃が付いていれば発動地点は着弾点（自分の位置で遅れて回ると 2 リンク払った型替えが消える）
    const time = params.delay.time;
    const at = params.reshape === "toThrown" ? { ...remote, origin: target } : remote;
    rs.echoes.push({ ...at, kind: "delay", timer: time, total: time, params: { ...params, damageMul: params.damageMul * params.delay.damageMul, delay: null } });
  } else if (params.reshape === "toThrown") {
    // 型替え符「投げ刃」: 刃がカーソル地点へ飛び、着いた所で元の形のまま発動する（着弾点を発動地点にする）
    const flight = SKILL.modifier.toThrown.flight;
    rs.echoes.push({ ...remote, origin: target, kind: "thrown", timer: flight, total: flight, params });
  } else {
    castNow(state, index, key, params, dir, target);
    scheduleEcho(state, { ...remote, params });
  }

  if (isFormSkill(r.def) && inAnyForm(state)) noteFormStart(state, r.def, params);
  recordCast(state, index, key, target, params);
  noteWearCast(state, index);
  applyRecoil(state, dir, params);
  if (r.def.damageKind === "ranged") fireTrigger(state, "onShoot", { pos: origin });
  if (r.def.damageKind === "ranged") pushPlayerEvent(state, "onShoot", key, { pos: { ...origin }, slot: index, source: { kind: "skill", key } });
  pushSfx(state, "skillCast");
  const castSfx = castSfxName(params.element ?? skillAttack(key)?.element ?? "none");
  if (castSfx) pushSfx(state, castSfx);
  return true;
}

/** 武器技が今の武器種で撃てないなら理由（撃てるなら null）。docs/ideas/weapon-skills.md */
export function weaponArtBlock(state: GameState, def: Readonly<SkillDef>): string | null {
  if (def.moveset === undefined || def.moveset === state.stats.moveset) return null;
  return weaponArtLabel(def.moveset);
}

/** 手動の本発動（大拡張のスキルは skills/actions.ts、第 2 弾は skills/actions2.ts、変身は skills/forms.ts、技は skills/arts/engine.ts へ） */
function castNow(state: GameState, index: number, key: SkillKey, params: CastParams, dir: Vec, target: Vec): void {
  if (isArtKey(key)) {
    castArt(state, key, { slot: index, params, origin: { ...state.player.body.pos }, dir, target, remote: false });
    return;
  }
  if (isExtraKey(key)) {
    EXTRA_CAST[key](state, { slot: index, params, origin: { ...state.player.body.pos }, dir, target, remote: false });
    return;
  }
  if (isWave2Key(key)) {
    WAVE2_CAST[key](state, { slot: index, params, origin: { ...state.player.body.pos }, dir, target, remote: false });
    return;
  }
  if (isShapeKey(key)) {
    castShape(state, key, { slot: index, params, origin: { ...state.player.body.pos }, dir, remote: false });
    return;
  }
  CAST[key](state, index, params, dir, target);
}

/** 撃てない理由（対象のいない消費系など）。撃てるなら null */
function castBlock(state: GameState, key: SkillKey, target: Vec, params: Readonly<CastParams>): string | null {
  if (isExtraKey(key)) return extraCastBlock(state, key, target, params);
  if (isWave2Key(key)) return wave2CastBlock(state, key, target, params);
  return null;
}

/**
 * 第 2 弾の刻印符で発動時に決まるもの: 得意（ジョブの得意な武器種か）・化身（変身中か）の倍率と、
 * 武器写しの属性（近接の武器の属性。無属性の武器なら倍率）。変身中の武器種で判定する
 */
function wave2CastState(state: GameState, params: Readonly<CastParams>): { mul: number; element: Element | null } {
  const m = SKILL.modifier;
  let mul = 1;
  let element = params.element;
  if (params.jobMastery) mul *= favoredMovesets(state.job).includes(state.stats.moveset) ? m.jobMastery.favoredMul : m.jobMastery.otherMul;
  if (params.formSurge) mul *= inAnyForm(state) ? m.formSurge.formMul : m.formSurge.otherMul;
  if (params.weaponBond) {
    const weapon = (MOVESETS[state.stats.moveset] ?? MOVESETS.sword).attack.element;
    if (weapon === "none") mul *= m.weaponBond.plainMul;
    else element = weapon;
  }
  return { mul, element };
}

/** 連携の成立を知らせる（浮き文字と効果音） */
function announceCombo(state: GameState, combo: ComboDef): void {
  addFloatingText(state, state.player.body.pos, `連携: ${combo.name}`, COLOR_COMBO, LABEL_SCALE, PARRY_TEXT_LIFE);
  pushSfx(state, "synergy");
  noteSkillCombo(state, combo.key);
}

/** 連携の「直前の発動」と巡りの履歴を残す。パリィは成功した瞬間に残す（構えただけでは連携しない） */
function recordCast(state: GameState, index: number, key: SkillKey, target: Vec, params: CastParams): void {
  const rs = state.skills;
  rs.recentSlots = [index, ...rs.recentSlots].slice(0, 2);
  if (key === "parry") return;
  rs.lastCast = { skillKey: key, slot: index, at: rs.clock, pos: { ...target }, hitIds: params.hitLog };
}

/**
 * 発動時の状態で決まる威力・効果量の倍率（溢れ・渇き撃ち・背水・同調）。
 * 払う前のマナ・HP を見る（溢れは払う前が満タンか）
 */
function castStateMul(state: GameState, r: ResolvedSlot): { damage: number; potency: number; attuneCrit: boolean } {
  const m = SKILL.modifier;
  const p = state.player;
  const params = r.params;
  let damage = 1;
  if (params.spillover) damage *= p.mana >= state.stats.maxMana - SKILL.fullManaEpsilon ? m.spillover.fullMul : m.spillover.otherMul;
  if (params.dryFire && p.mana < state.stats.maxMana * m.dryFire.lowRatio) damage *= m.dryFire.damageMul;
  if (params.desperate) damage *= p.hp < p.maxHp * m.desperate.hpRatio ? m.desperate.lowMul : m.desperate.highMul;
  if (!params.attune) return { damage, potency: 1, attuneCrit: false };
  const match = attuneMatch(state, r.def);
  if (match === "crit") return { damage, potency: 1, attuneCrit: true };
  const mul = match ? m.attune.matchMul : m.attune.missMul;
  return { damage: damage * mul, potency: mul, attuneCrit: false };
}

/**
 * 同調: 色の共鳴は段取り 7d で源と糧の共鳴に置き換わり、読む色が無くなった（同調の符は 7c の H2 で消える）。それまでは合わない扱い
 */
export function attuneMatch(_state: GameState, _def: Readonly<SkillDef>): boolean | "crit" {
  return false;
}

/**
 * 資源を払い、このスロットの最低間隔を立てる（他のスロットには何も立てない）。払ったマナを返す（CD 型は 0）。
 * 呼ぶ前に checkAffordable で払えることを確かめておく
 */
function payResource(state: GameState, index: number, slot: SkillSlotState, r: ResolvedSlot): number {
  slot.intervalLeft = r.interval;
  if (r.resource === "mana") {
    const paid = payMana(state, index, r);
    consumeFreeCast(state);
    heatUp(slot, r);
    return paid;
  }
  slot.chargesLeft -= 1;
  if (slot.cooldownLeft <= 0) setCooldown(slot, r.cooldown);
  return 0;
}

/**
 * マナを払う。後払いは返済を予約して 0、血の肩代わりは不足分を HP で。
 * 過負荷（ks_overdraw）はマナ不足を HP で払う。払い戻しの基準は実際に減ったマナだけ（HP 分をマナで返さない）
 */
function payMana(state: GameState, index: number, r: ResolvedSlot): number {
  const p = state.player;
  if (r.params.deferredMul > 0) {
    state.skills.debts.push({ slot: index, timer: SKILL.modifier.deferred.delay, amount: r.cost * r.params.deferredMul });
    return 0;
  }
  const before = p.mana;
  if (r.params.bloodTithe && !canAffordSkill(state, r.cost)) {
    p.hp = Math.max(1, p.hp - titheHpCost(state, r.cost));
    p.mana = 0;
    return before;
  }
  paySkillCost(state, r.cost);
  return Math.max(0, before - p.mana);
}

/** 過熱: 続けて撃った回数を数え、上限に達したらしばらく撃てない */
function heatUp(slot: SkillSlotState, r: ResolvedSlot): void {
  if (!r.params.overheat) return;
  const o = SKILL.modifier.overheat;
  slot.heat += 1;
  slot.heatTimer = o.window;
  if (slot.heat < o.maxStacks) return;
  slot.heat = 0;
  slot.heatTimer = 0;
  slot.intervalLeft = Math.max(slot.intervalLeft, o.lockTime);
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
    reach: 0,
  };
}

type BaseSkillKey = Exclude<SkillKey, ExtraSkillKey | Wave2SkillKey | Wave3SkillKey | ArtSkillKey>;

const CAST: Record<BaseSkillKey, CastFn> = {
  parry: (state, slot, params, dir) => {
    const window = SKILL.parry.window * params.timeMul;
    startActive(state, slot, "parry", params, dir, window);
    const rs = state.skills;
    rs.parryTimer = window;
    const p = state.player;
    p.buffs.invuln = Math.max(p.buffs.invuln, window);
  },
  bloodPact: (state, _slot, params) => {
    const p = state.player;
    const b = SKILL.bloodPact;
    p.hp = Math.max(1, p.hp - p.maxHp * b.hpFraction);
    const time = b.duration * params.durationMul;
    const potency = params.potencyMul * buffMul(state.stats, SKILL_DEFS.bloodPact.buffScaling);
    state.skills.frenzy = { time, mul: 1 + (b.speedMul - 1) * potency };
    state.skills.lifesteal = { time, mul: b.lifesteal * potency };
    addFloatingText(state, p.body.pos, "血の契約", COLOR_BLOOD, LABEL_SCALE, PARRY_TEXT_LIFE);
    spawnBurst(state, p.body.pos, COLOR_BLOOD, 16, 90, 0.4, 2);
  },
  gravityWell: (state, _slot, params, _dir, target) => spawnWell(state, target, params),
  // 投げ込み（型替え）なら足元ではなく照準地点へ
  mines: (state, _slot, params, _dir, target) => placeMine(state, params.reshape === "toLobbed" ? target : state.player.body.pos, params),
  haste: (state, _slot, params) => {
    const h = SKILL.haste;
    const p = state.player;
    const potency = params.potencyMul * buffMul(state.stats, SKILL_DEFS.haste.buffScaling);
    state.skills.haste = { time: h.duration * params.durationMul, mul: 1 + h.moveBonus * potency };
    state.skills.exhaustTimer = 0;
    addFloatingText(state, p.body.pos, HASTE_TEXT, COLOR_HASTE, LABEL_SCALE, PARRY_TEXT_LIFE);
    spawnBurst(state, p.body.pos, COLOR_HASTE, 12, 90, 0.35, 1.5);
  },
  chainHook: (state, slot, params, dir) => startActive(state, slot, "chainHook", params, dir, SKILL.chainHook.extendTime * params.timeMul),
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

/** 発動中スキルの中断（ダッシュ・バースト）。払った資源は戻らない */
function cancelActive(state: GameState): void {
  const rs = state.skills;
  const a = rs.active;
  if (!a) return;
  rs.active = null;
  if (a.skillKey === "parry") rs.parryTimer = 0;
}

// ---------------------------------------------------------------------------
// 発動中の更新
// ---------------------------------------------------------------------------

function updateActive(state: GameState, dt: number): void {
  const a = state.skills.active;
  if (!a) return;
  if (updateExtraActive(state, a, dt)) return;
  if (a.skillKey === "parry") updateParry(state, a, dt);
  else if (a.skillKey === "chainHook") updateHook(state, a, dt);
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

function meleeSkillHit(state: GameState, e: Enemy, params: CastParams, base: number, dir: Vec, knockback: number, stagger: boolean): void {
  skillHit(state, e, params, { base, kind: "melee", dir, knockback, stagger });
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
  gainEnergy(state, ENERGY.just);
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
  pushPlayerEvent(state, "onJustDodge", "parry", { slot: a.slot, source: { kind: "skill", key: "parry" } });
  rs.lastCast = { skillKey: "parry", slot: a.slot, at: rs.clock, pos: { ...p.body.pos }, hitIds: a.params.hitLog };

  // 成功のご褒美は CD の一部だけ（全回復だと構え直しで固め続けられる。docs/COMBAT_DESIGN.md C-1 の 7）
  const slot = rs.slots[a.slot];
  if (!slot) return;
  slot.cooldownLeft = Math.max(0, slot.cooldownLeft - slot.cooldownTotal * SKILL.parry.successRefund);
}

// ---------------------------------------------------------------------------
// 照準・罠・反響
// ---------------------------------------------------------------------------

/** 照準位置（最大射程、壁の手前でクランプ） */
function clampTarget(state: GameState, from: Vec, target: Vec, maxRange: number): Vec {
  const probe = SKILL.castWallProbe;
  const delta = sub(target, from);
  const dir = normalize(delta, state.player.facing);
  const maxD = Math.min(length(delta), maxRange);
  let to = { ...from };
  for (let d = probe; d <= maxD; d += probe) {
    const next = add(from, scale(dir, d));
    if (overlapsWall(state, next.x, next.y, probe)) break;
    to = next;
  }
  return to;
}

// ---- 型替え符「罠化」 ----

/** 罠を置く。上限を超えたら古いものから消える */
function placeTrap(state: GameState, key: SkillKey, pos: Vec, params: CastParams): void {
  const t = SKILL.modifier.toTrap;
  const rs = state.skills;
  rs.traps.push({ id: allocId(state), pos: { ...pos }, arm: t.arm, life: t.life, skillKey: key, params });
  while (rs.traps.length > t.maxAlive) rs.traps.shift();
  spawnBurst(state, pos, COLOR_TRAP, SPARK_COUNT, SPARK_SPEED, SPARK_LIFE, SPARK_SIZE);
}

/** 起動した罠に敵が近づいたら、罠の位置から最寄りの敵へ向けて元のスキルを発動する（遅延・反響もそこから） */
function updateTraps(state: GameState, dt: number): void {
  const rs = state.skills;
  if (rs.traps.length === 0) return;
  const t = SKILL.modifier.toTrap;
  const sprung = new Set<number>();
  for (const trap of rs.traps) {
    trap.arm = Math.max(0, trap.arm - dt);
    trap.life -= dt;
    if (trap.arm > 0 || trap.life <= 0) continue;
    const prey = enemiesInRadius(state, trap.pos, t.trigger)[0];
    if (!prey) continue;
    sprung.add(trap.id);
    springTrap(state, trap.skillKey, trap.pos, prey.body.pos, trap.params);
  }
  rs.traps = rs.traps.filter((trap) => trap.life > 0 && !sprung.has(trap.id));
}

function springTrap(state: GameState, key: SkillKey, at: Vec, prey: Vec, params: CastParams): void {
  const dir = normalize(sub(prey, at), state.player.facing);
  const remote = { skillKey: key, origin: { ...at }, dir, target: { ...prey } };
  spawnRing(state, at, SKILL.modifier.toTrap.trigger, COLOR_TRAP, RING_LIFE * 2);
  pushSfx(state, "skillCast");
  if (params.delay) {
    const time = params.delay.time;
    state.skills.echoes.push({ ...remote, kind: "delay", timer: time, total: time, params: { ...params, damageMul: params.damageMul * params.delay.damageMul, delay: null } });
    return;
  }
  executeRemote(state, { ...remote, kind: "thrown", timer: 0, total: 0, params });
  scheduleEcho(state, { ...remote, params });
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
    // 遅延の本発動・投げ刃の着弾に反響が付いていれば、ここから数える
    if (e.kind === "delay" || e.kind === "thrown") scheduleEcho(state, e);
  }
}

/** 散り際: 倒した敵の位置で同じスキルを弱く起こす（skills/hit.ts が積んだ予約を捌く） */
function updateGasps(state: GameState): void {
  const rs = state.skills;
  if (rs.gasps.length === 0) return;
  const due = rs.gasps;
  rs.gasps = [];
  for (const g of due) {
    executeRemote(state, { kind: "gasp", timer: 0, total: 0, skillKey: g.params.skillKey, origin: g.pos, dir: g.dir, target: g.pos, params: g.params });
  }
}

/** 反響・遅延・投げ刃・散り際の発動。プレイヤーは動かさず、発動地点・向き・照準地点で起こす */
function executeRemote(state: GameState, e: EchoCast): void {
  const key = e.skillKey;
  if (isArtKey(key)) {
    castArt(state, key, { slot: e.params.slot, params: e.params, origin: e.origin, dir: e.dir, target: e.target, remote: true });
    return;
  }
  if (isExtraKey(key)) {
    EXTRA_CAST[key](state, { slot: e.params.slot, params: e.params, origin: e.origin, dir: e.dir, target: e.target, remote: true });
    return;
  }
  if (isWave2Key(key)) {
    WAVE2_CAST[key](state, { slot: e.params.slot, params: e.params, origin: e.origin, dir: e.dir, target: e.target, remote: true });
    return;
  }
  if (isShapeKey(key)) {
    castShape(state, key, { slot: e.params.slot, params: e.params, origin: e.origin, dir: e.dir, remote: true });
    return;
  }
  switch (key) {
    case "chainHook":
      hookInstant(state, e.origin, e.dir, e.params);
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
    // 前の階に残したものは失われる。床のスキル石は floor.ts の buildFloor が捨てる
    // （ここで捨てると、強欲のが抱えたまま階を移った石〔新しい階の足元へ届く〕まで消える）
    rs.runes = [];
    rs.echoes = [];
    rs.wells = [];
    rs.mines = [];
    rs.fields = [];
    rs.curses.clear();
    rs.shots = [];
    rs.kegs = [];
    rs.graves = [];
    rs.turrets = [];
    rs.springs = [];
    rs.stakes = [];
    rs.traps = [];
    rs.artQueue = [];
    // 石の使い込み（発動・命中の数）は階層ごとに保存する（芽が出たときは wear.ts がその場で保存する）
    saveSkillProfile(rs.profile);
    rs.marks.clear();
    rs.gasps = [];
    rs.history = [];
    // 階層到達のスキル石は初めて着いた階だけ（上り階段の往復で抽選を稼がせない）
    if (state.runEvents.strata.fresh && state.rng.chance(SKILL.drop.stoneOnDepth)) {
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
 * 刻印符を装着中スキルのリンク枠へ自動で差す（床の符を拾ったとき・起点「詠み手」・図書館など。刻印符はラン内だけの物）。
 * 優先: 同じ符を持たず空きのあるスロット → 古い符を押し出して入れる → 同じ符を最新扱いに。
 * 差したスロット番号を返す（付けられる枠が無ければ -1）
 */
export function attachRune(state: GameState, modifier: ModifierKey): number {
  const rs = state.skills;
  const candidates: number[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const stone = stoneInSlot(rs.profile, i);
    if (!stone || slotLinks(i) <= 0) continue;
    if (!canAttach(SKILL_DEFS[stone.skillKey], modifier)) continue;
    candidates.push(i);
  }
  if (candidates.length === 0) return -1;

  const cost = modifierLinkCost(modifier);
  const without = candidates.filter((i) => !effectiveSlotModifiers(rs, i).includes(modifier) && slotLinks(i) >= cost);

  const commit = (i: number): number => {
    syncSlotModifiers(rs);
    refreshResonance(state);
    return i;
  };
  const free = without.find((i) => usedLinks(rs, i) + cost <= slotLinks(i));
  if (free !== undefined) {
    rs.slots[free]?.runModifiers.push(modifier);
    return commit(free);
  }
  for (const target of without) {
    const slot = rs.slots[target];
    if (!slot) continue;
    // 収まるまで古い順に押し出す（型替え符はリンクを 2 本使う）
    while (usedLinks(rs, target) + cost > slotLinks(target) && slot.runModifiers.length > 0) slot.runModifiers.shift();
    if (usedLinks(rs, target) + cost > slotLinks(target)) continue;
    slot.runModifiers.push(modifier);
    return commit(target);
  }
  // 全候補が既に持っている: 最新扱いにする（重複装着はしない）
  const first = candidates.find((i) => rs.slots[i]?.runModifiers.includes(modifier));
  const slot = first === undefined ? undefined : rs.slots[first];
  if (first === undefined || !slot) return -1;
  slot.runModifiers.splice(slot.runModifiers.indexOf(modifier), 1);
  slot.runModifiers.push(modifier);
  return commit(first);
}

/** スロットの符が使っているリンク（石に付けられない符は効かないので数えない） */
export function usedLinks(rs: Readonly<SkillRunState>, slot: number): number {
  const stone = stoneInSlot(rs.profile, slot);
  if (!stone) return 0;
  return effectiveSlotModifiers(rs, slot)
    .filter((k) => canAttach(SKILL_DEFS[stone.skillKey], k))
    .reduce((sum, k) => sum + modifierLinkCost(k), 0);
}

/**
 * 符を移せない理由。noStone = 移し先に石が無い / notFit = 相性表で不可 / duplicate = 同じ符が付いている /
 * noLinks = リンクの空きが無い / reshape = 型替え符は 1 枚まで / clash = 排他の符が付いている
 */
export type RuneMoveBlock = "noStone" | "notFit" | "duplicate" | "noLinks" | "reshape" | "clash";

/** スロット to に modifier を足せるか。足せるなら null */
export function runeMoveBlock(rs: Readonly<SkillRunState>, to: number, modifier: ModifierKey): RuneMoveBlock | null {
  const stone = stoneInSlot(rs.profile, to);
  if (!stone) return "noStone";
  if (!canAttach(SKILL_DEFS[stone.skillKey], modifier)) return "notFit";
  const current = effectiveSlotModifiers(rs, to);
  if (current.includes(modifier)) return "duplicate";
  if (usedLinks(rs, to) + modifierLinkCost(modifier) > slotLinks(to)) return "noLinks";
  if (MODIFIERS[modifier].reshape && current.some((k) => MODIFIERS[k].reshape)) return "reshape";
  if (current.some((k) => modifiersClash(k, modifier))) return "clash";
  return null;
}

/** 符の移し先の結果。missing = 元のスロットにその符が無い（同じスロットへの移しも含む） */
export type RuneMoveResult = "ok" | "missing" | RuneMoveBlock;

/**
 * スロット from のラン内の符 modifier を to へ移す。付けられなければ動かさず理由を返す。
 * slot.modifiers への反映は次のステップの syncSlotModifiers（装備画面の操作をリプレイの装備変更イベントと同じ時点に揃える）
 */
export function moveRunModifier(rs: SkillRunState, from: number, to: number, modifier: ModifierKey): RuneMoveResult {
  const src = rs.slots[from];
  const dst = rs.slots[to];
  if (!src || !dst || from === to) return "missing";
  const idx = src.runModifiers.indexOf(modifier);
  if (idx < 0) return "missing";
  const block = runeMoveBlock(rs, to, modifier);
  if (block) return block;
  src.runModifiers.splice(idx, 1);
  dst.runModifiers.push(modifier);
  return "ok";
}

/** スロットのラン内の符を外す（外した符は消える）。無ければ false。反映は moveRunModifier と同じく次のステップ */
export function removeRunModifier(rs: SkillRunState, slot: number, modifier: ModifierKey): boolean {
  const list = rs.slots[slot]?.runModifiers;
  const idx = list ? list.indexOf(modifier) : -1;
  if (!list || idx < 0) return false;
  list.splice(idx, 1);
  return true;
}

/** 床の刻印符を拾って、付けられるスロットへ入れる。付けられるスキルが無ければ床に残す */
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
      if (!rune.warned) addFloatingText(state, rune.pos, "付ける先なし", COLOR_BLOOD, LABEL_SCALE, LABEL_LIFE);
      rune.warned = true;
      continue;
    }
    picked.add(rune.id);
    addFloatingText(state, rune.pos, def.name, def.color, LABEL_SCALE, LABEL_LIFE);
    pushLog(state, `刻印符「${def.name}」をスキル ${slot + 1} に付けた。`, def.color);
    pushSfx(state, "runeAttach");
  }
  if (picked.size > 0) rs.runes = rs.runes.filter((r) => !picked.has(r.id));
}

function updateFloorStones(state: GameState, dt: number): void {
  // 拾得は注目 + インタラクト（system/loot.ts の updateDropInteract）。ここは揺れの時間だけ進める
  for (const fs of state.skills.floorStones) fs.bobTime += dt;
}

/** 血の契約中の赤いオーラ */
function spawnAura(state: GameState): void {
  if (state.skills.frenzy.time <= 0 || state.tick % AURA_EVERY_TICKS !== 0) return;
  spawnBurst(state, state.player.body.pos, COLOR_BLOOD, 1, AURA_SPEED, 0.35, 1.5);
}

/**
 * 描画用: 刻印符の装着状況（有効 / 無効、拾った符か）。UI・HUD が使う。run = 拾って付けた符（移す / 外すができる）、
 * false = 祝福が足した符。装備画面での操作は次のステップまで slot.modifiers に入らないので、runModifiers から直接作る
 */
export function slotModifierView(state: GameState, slot: number): { key: ModifierKey; active: boolean; run: boolean }[] {
  const rs = state.skills;
  const s = rs.slots[slot];
  const stone = stoneInSlot(rs.profile, slot);
  if (!s) return [];
  const runCount = s.runModifiers.length;
  const keys = effectiveSlotModifiers(rs, slot, boonGrantedModifiers(state));
  const active = stone ? new Set(activeModifiers(SKILL_DEFS[stone.skillKey], slotLinks(slot), keys)) : new Set<ModifierKey>();
  return keys.map((key, i) => ({ key, active: active.has(key), run: i < runCount }));
}

/**
 * 撃破時の刻印符ドロップ（system/loot.ts の rollEnemyDrop から 1 行で呼ぶ）。
 * ボス・エリート・図書館・巣窟の敵は出やすい。落ちた刻印符は拾うと付けられるスロットへ入る
 */
export function rollEnemyRuneDrop(state: GameState, enemy: Enemy): void {
  const key = rollRuneDrop(state.rng, state.depth, runeDropSource(state, enemy), equippedSkillKeys(state));
  if (key) dropRune(state, enemy.body.pos, key);
}

function runeDropSource(state: GameState, enemy: Enemy): RuneDropSource {
  if (state.boss?.enemyId === enemy.id) return "boss";
  if (enemy.elite) return "elite";
  const kind = state.rooms[enemy.roomIndex]?.kind;
  if (kind === "library") return "library";
  if (kind === "nest") return "nest";
  return "normal";
}

// ---------------------------------------------------------------------------
// player.ts から呼ぶフック（近接の命中・射撃）
// ---------------------------------------------------------------------------

/**
 * 通常の近接が敵に当たった瞬間（player.ts の meleeHitEnemy から）。
 * 刃の給油の記録・湧き石のマナ・剣の墓標（3 段目）・追撃の印をここで処理する
 */
export function onSkillMeleeHit(state: GameState, e: Enemy, combo: number): void {
  const rs = state.skills;
  rs.lastMeleeHitAt = rs.clock;
  onSpringMeleeHit(state);
  if (combo >= PLAYER.melee.length - 1) onGraveFinisher(state);
  if (e.hp > 0) popFollowUp(state, e);
}

/** 追撃の印が付いた敵に近接を当てると、印が弾けて追加の一撃 */
function popFollowUp(state: GameState, e: Enemy): void {
  const mark = state.skills.marks.get(e.id);
  if (!mark) return;
  state.skills.marks.delete(e.id);
  const out = rollOutgoing(state, e, mark.power, "proc");
  damageEnemy(state, e, out.amount, sub(e.body.pos, state.player.body.pos), 0, { hitstopSteps: FEEL.hitstopLight });
  spawnBurst(state, e.body.pos, COLOR_FOLLOW, SPARK_COUNT, SPARK_SPEED, SPARK_LIFE, SPARK_SIZE);
}

/** 自分が射撃した瞬間（player.ts の tryShoot から）。砲台が合わせて撃つ */
export function onSkillPlayerShoot(state: GameState): void {
  onTurretShoot(state);
}

/** HUD 用: このスロットでいま成立する連携（無ければ null） */
export function slotComboReady(state: GameState, index: number): ComboDef | null {
  const stone = stoneInSlot(state.skills.profile, index);
  if (!stone) return null;
  return findCombo(state, SKILL_DEFS[stone.skillKey]);
}

/** ツールチップ用の CD 表記（0.1 秒単位） */
export function formatCooldown(seconds: number): string {
  return `${seconds.toFixed(1)}s`;
}
