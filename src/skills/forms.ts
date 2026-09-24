import { attack } from "../core/element";
import { kw } from "../core/keywords";
import { type Enemy, type GameState, pushSfx } from "../core/state";
import type { StatusProc } from "../core/status";
import { type Vec, add, scale } from "../core/vec";
import { STATUS } from "../data/tuning";
import { type ButtonKey, type MeleeStepDef, type MovesetDef, type MovesetKey, defineMoveset } from "../data/weapons";
import { ATTR_KEYS, type AttrRatio, type Scaling } from "../loot/types";
import { cancelAttack } from "../system/combat";
import { carryContractPatch } from "../system/contractors";
import { addFloatingText, shake, spawnBurst, spawnRing } from "../system/effects";
import { canAffordSkill, paySkillCost } from "../system/keystones";
import { circlesOverlap } from "../system/physics";
import { applyStatus, enemiesInRadius, hasStatus, removeStatus } from "../system/statusEffects";
import { SKILL } from "./data";
import { skillPower } from "./hit";
import { spawnShot } from "./shots";
import { SHAPE_TUNING as S } from "./tuning3";
import { type CastParams, type ShapeFormState, type SkillDef, type SkillKey, WAVE3_SKILL_KEYS, type Wave3SkillKey } from "./types";

/**
 * 変身（docs/ideas/skills-expansion.md 1-H #56〜#60）。左右クリックの動作そのものを差し替える 5 種の状態遷移と、
 * 第 2 弾の 3 種（剛 / 迅 / 霊の型。skills/actions2.ts）も含めた変身 8 種の共通規則（同時に 1 つ・共有の待ち）を持つ。
 *
 * - 狼化・鉄塊化は近接の型（MovesetDef）を差し替える。player.ts は shapeMoveset を装備の武器種より先に読む
 * - 右クリックの差し替え（遠吠え・砲撃）は player.ts が shapeButtonPress に先に渡す
 * - 霊体化のすり抜け・与ダメ倍率、鉄塊化の押されない・振りが止まらないは combat.ts / projectiles.ts / enemies.ts が
 *   state.skills.shape を直に見る（この低い層のファイルから forms.ts を import すると循環 import の評価順が崩れるため）。
 *   鉄塊化の怯みの無効は player.ts が shrugStagger を呼ぶ
 * - 業火の化身は近接・射撃の on-hit 付与（PlayerStats.statusProcs）に燃焼を差し込み、維持の気力をここで払う
 *
 * 数値は skills/tuning3.ts（SKILL.<key> 経由で読む）。乱数は使わない
 */

const COLOR_WOLF = "#d0b090";
const COLOR_WRAITH = "#a0c0ff";
const COLOR_SIEGE = "#e0c060";
const COLOR_IRON = "#a0a8b8";
const COLOR_PYRE = "#ff7030";
const COLOR_NOTICE = "#808080";

export const SHAPE_COLOR: Readonly<Record<Wave3SkillKey, string>> = {
  wolfForm: COLOR_WOLF,
  wraithForm: COLOR_WRAITH,
  siegeForm: COLOR_SIEGE,
  ironForm: COLOR_IRON,
  pyreForm: COLOR_PYRE,
};

const TEXT_SCALE = 1;
const TEXT_LIFE = 1.2;
const NOTICE_SCALE = 0.9;
const NOTICE_LIFE = 0.4;
const RING_LIFE = 0.3;
const BURST_PARTICLES = 16;
const BURST_SPEED = 110;
const BURST_LIFE = 0.35;
const BURST_SIZE = 2;
const SHAKE_SHELL = 3;

/** 時間で切れず、もう一度撃つと自分で解ける変身 */
const TOGGLE_SHAPES: ReadonlySet<Wave3SkillKey> = new Set(["siegeForm", "pyreForm"]);
/** 変身中はほかのスキル石を使えない変身 */
const SEALING_SHAPES: ReadonlySet<Wave3SkillKey> = new Set(["wolfForm", "wraithForm", "ironForm"]);
/** 射撃（銃の家系の左）を止める変身。狼化は右を遠吠え、砲身化は左右とも砲撃に差し替える */
const SHOT_LOCK_SHAPES: ReadonlySet<Wave3SkillKey> = new Set(["wolfForm", "siegeForm"]);

/** 業火の化身が差し込んだ燃焼の付与（装備の付与と見分ける印。state の外に持つのは同一性の印だけ） */
const PYRE_PROCS = new WeakSet<StatusProc>();

/** 解けた理由。気力切れ（業火の化身）だけ自分が燃える */
export type ShapeEndCause = "time" | "dash" | "manual" | "empty";

// ---------------------------------------------------------------------------
// 問い合わせ
// ---------------------------------------------------------------------------

export function isShapeKey(key: SkillKey): key is Wave3SkillKey {
  return (WAVE3_SKILL_KEYS as readonly string[]).includes(key);
}

/** 変身 8 種（第 2 弾の 3 種を含む）か */
export function isFormSkill(def: Readonly<SkillDef>): boolean {
  return def.tags.includes("form");
}

/** どれかの変身中か（第 2 弾の武器種の変身も含む） */
export function inAnyForm(state: GameState): boolean {
  return state.skills.form !== null || state.skills.shape !== null;
}

function shapeKey(state: GameState): Wave3SkillKey | null {
  return state.skills.shape?.key ?? null;
}

/** 鉄塊化中か（被弾で怯まず、振りも止まらない） */
export function ironBraced(state: GameState): boolean {
  return shapeKey(state) === "ironForm";
}

/** 入力移動に掛ける倍率（砲身化は動けない、鉄塊化は遅い） */
export function shapeMoveMul(state: GameState): number {
  const key = shapeKey(state);
  if (key === "siegeForm") return 0;
  if (key === "ironForm") return SKILL.ironForm.moveMul;
  return 1;
}

/** 差し替えた近接の型（狼化・鉄塊化）。無ければ null で装備の武器種のまま */
export function shapeMoveset(state: GameState): MovesetDef | null {
  return state.skills.shape?.moveset ?? null;
}

/** 銃の通常の射撃を止めるか */
export function shapeLocksShot(state: GameState): boolean {
  const key = shapeKey(state);
  return key !== null && SHOT_LOCK_SHAPES.has(key);
}

/** 変身の残り秒（時間で切れない変身・変身していないなら null）。HUD 用 */
export function shapeRemaining(state: GameState): number | null {
  const shape = state.skills.shape;
  if (!shape || shape.total <= 0) return null;
  return Math.max(0, shape.total - shape.elapsed);
}

/**
 * このスロットのスキルが変身の規則で撃てない理由（撃てるなら null）。払う前に弾く。
 * 変身は同時に 1 つ・共有の待ち中は不可。狼化・霊体化・鉄塊化の間はほかの石も不可、砲身化の構え中は体を使う石（body）が不可。
 * 砲身化・業火の化身の最中に同じスロットをもう一度撃つのは「解く」操作なので弾かない
 */
export function shapeCastBlock(state: GameState, def: Readonly<SkillDef>, slot: number): string | null {
  const rs = state.skills;
  const shape = rs.shape;
  if (isFormSkill(def)) {
    if (shape && isToggleOff(state, def.key, slot)) return null;
    if (inAnyForm(state)) return "変身中";
    return rs.formWait > 0 ? "変身待ち" : null;
  }
  if (!shape) return null;
  if (SEALING_SHAPES.has(shape.key)) return "変身中";
  if (shape.key === "siegeForm" && def.exclusiveGroup === "body") return "構え中";
  return null;
}

/** いまこのスロットを撃つと、自分で変身を解く操作になるか（砲身化・業火の化身） */
export function isToggleOff(state: GameState, key: SkillKey, slot: number): boolean {
  const shape = state.skills.shape;
  return shape !== null && shape.key === key && shape.slot === slot && TOGGLE_SHAPES.has(shape.key);
}

// ---------------------------------------------------------------------------
// 発動・時間経過・解除
// ---------------------------------------------------------------------------

export interface ShapeCastCtx {
  slot: number;
  params: CastParams;
  origin: Vec;
  dir: Vec;
  remote: boolean;
}

/**
 * 発動（system/skills.ts の castNow / executeRemote から）。remote（反響）は砲身化の砲撃 1 発だけで変身しない。
 * ほかの変身は canAttach で反響・遅延・投げ刃・罠化が付かない
 */
export function castShape(state: GameState, key: Wave3SkillKey, ctx: ShapeCastCtx): void {
  if (ctx.remote) {
    if (key === "siegeForm") fireShell(state, ctx.origin, ctx.dir, ctx.params);
    return;
  }
  startShape(state, key, ctx.slot, ctx.params);
}

/** 変身の持続（時間で切れない変身は 0）。持続の変異・延長（durationMul）・深化（formDurationMul）を畳む */
export function shapeDuration(key: Wave3SkillKey, params: Readonly<CastParams>): number {
  const base = timedDuration(key);
  return base * params.durationMul * params.formDurationMul;
}

function timedDuration(key: Wave3SkillKey): number {
  switch (key) {
    case "wolfForm":
      return SKILL.wolfForm.duration;
    case "wraithForm":
      return SKILL.wraithForm.duration;
    case "ironForm":
      return SKILL.ironForm.duration;
    case "siegeForm":
    case "pyreForm":
      return 0;
  }
}

function startShape(state: GameState, key: Wave3SkillKey, slot: number, params: CastParams): void {
  const rs = state.skills;
  const p = state.player;
  if (p.attack.phase !== "none") cancelAttack(state);
  rs.formRecover = 0;
  rs.shape = {
    key,
    slot,
    elapsed: 0,
    total: shapeDuration(key, params),
    recover: SKILL[key].recover * params.formRecoverMul,
    params,
    actionLeft: 0,
    passed: new Set(),
    moveset: buildMoveset(state.stats.moveset, key, params),
  };
  const color = SHAPE_COLOR[key];
  spawnRing(state, p.body.pos, p.body.radius * 3, color, RING_LIFE);
  spawnBurst(state, p.body.pos, color, BURST_PARTICLES, BURST_SPEED, BURST_LIFE, BURST_SIZE);
  addFloatingText(state, p.body.pos, SKILL_NAME[key], color, TEXT_SCALE, TEXT_LIFE);
  pushSfx(state, "formShift");
  if (key === "siegeForm") openFire(state, rs.shape, params);
  if (key === "pyreForm") ensurePyreProcs(state, params);
}

const SKILL_NAME: Readonly<Record<Wave3SkillKey, string>> = {
  wolfForm: "狼化",
  wraithForm: "霊体化",
  siegeForm: "砲身化",
  ironForm: "鉄塊化",
  pyreForm: "業火の化身",
};

/** HUD 用の変身名 */
export function shapeName(key: Wave3SkillKey): string {
  return SKILL_NAME[key];
}

/** 構えた瞬間の 1 発（発動のコストがこの 1 発ぶん） */
function openFire(state: GameState, shape: ShapeFormState, params: CastParams): void {
  const p = state.player;
  fireShell(state, p.body.pos, p.facing, params);
  shape.actionLeft = SKILL.siegeForm.shellInterval;
}

/**
 * 変身の時間経過（updateSkills が updateForm の後に毎ステップ呼ぶ）。
 * 砲身化はダッシュで、業火の化身は気力切れで、時間の変身は持続が尽きると解ける
 */
export function updateShape(state: GameState, dt: number): void {
  const shape = state.skills.shape;
  if (!shape) return;
  shape.elapsed += dt;
  shape.actionLeft = Math.max(0, shape.actionLeft - dt);
  switch (shape.key) {
    case "wraithForm":
      notePassed(state, shape);
      break;
    case "siegeForm":
      if (state.player.dashTimer > 0) {
        endShape(state, "dash");
        return;
      }
      break;
    case "ironForm":
      shrugStagger(state);
      break;
    case "pyreForm":
      if (!drainPyre(state, shape, dt)) {
        endShape(state, "empty");
        return;
      }
      ensurePyreProcs(state, shape.params);
      break;
    case "wolfForm":
      break;
  }
  if (shape.total > 0 && shape.elapsed >= shape.total) endShape(state, "time");
}

/** 変身を解く。霊体化はすり抜けた敵へ出血、業火の化身は付与を外し（気力切れなら自分が燃え）、反動に入る */
export function endShape(state: GameState, cause: ShapeEndCause): void {
  const rs = state.skills;
  const shape = rs.shape;
  if (!shape) return;
  rs.shape = null;
  if (shape.key === "wraithForm") bleedPassed(state, shape);
  if (shape.key === "pyreForm") stripPyreProcs(state);
  if (shape.key === "pyreForm" && cause === "empty") selfBurn(state);
  // 差し替えた近接の型の段は装備の武器種では引けないので、振りの途中なら止める
  if (shape.moveset && state.player.attack.phase !== "none") cancelAttack(state);
  rs.formRecover = shape.recover;
  addFloatingText(state, state.player.body.pos, "変身が解けた", SHAPE_COLOR[shape.key], NOTICE_SCALE, TEXT_LIFE / 2);
}

/** 砲身化・業火の化身をもう一度撃った: 払わずに解く（自傷なし） */
export function toggleOffShape(state: GameState): void {
  endShape(state, "manual");
}

// ---------------------------------------------------------------------------
// 共有の待ち（変身 8 種）
// ---------------------------------------------------------------------------

/**
 * 変身を撃った（system/skills.ts の castSlot から）。共有の待ちに入り、ほかの変身も同じだけ待つ。
 * 待ちの長さはその変身の再使用時間（気力型の変身は 0。代わりに解けたときの待ちが効く）
 */
export function noteFormStart(state: GameState, def: Readonly<SkillDef>, params: Readonly<CastParams>): void {
  const rs = state.skills;
  rs.formSince = rs.clock;
  const share = def.resource === "cooldown" ? def.cooldown * params.burdenMul : 0;
  setFormWait(state, share);
}

/**
 * 変身が解けたかを確かめ、解けていたら「変身していた秒 × afterRatio」だけ待ちを伸ばす。
 * 撃った時点の待ち（再使用時間）と合わせ、次の変身まで最短でも 変身していた秒 / uptimeCap かかる
 */
export function settleFormEnd(state: GameState): void {
  const rs = state.skills;
  if (rs.formSince === null || inAnyForm(state)) return;
  const elapsed = Math.max(0, rs.clock - rs.formSince);
  rs.formSince = null;
  setFormWait(state, elapsed * S.afterRatio);
}

function setFormWait(state: GameState, seconds: number): void {
  const rs = state.skills;
  if (seconds <= rs.formWait) return;
  rs.formWait = seconds;
  rs.formWaitTotal = seconds;
}

export function tickFormWait(state: GameState, dt: number): void {
  const rs = state.skills;
  rs.formWait = Math.max(0, rs.formWait - dt);
}

// ---------------------------------------------------------------------------
// 左右クリックの差し替え（player.ts から）
// ---------------------------------------------------------------------------

/**
 * ボタンの押した瞬間を変身が引き受けたら true（player.ts はそれ以上処理しない）。
 * 狼化の右 = 遠吠え、砲身化の右 = 砲撃・左 = 何もしない（構え中は振れない）
 */
export function shapeButtonPress(state: GameState, button: ButtonKey): boolean {
  const shape = state.skills.shape;
  if (!shape) return false;
  if (shape.key === "wolfForm" && button === "secondary") {
    howl(state, shape);
    return true;
  }
  if (shape.key !== "siegeForm") return false;
  if (button === "secondary") fireManualShell(state, shape);
  return true;
}

/** 近接の命中（player.ts の meleeHitEnemy から）。狼化の噛みつきは出血を付ける */
export function onShapeMeleeHit(state: GameState, e: Enemy): void {
  const shape = state.skills.shape;
  if (!shape || shape.key !== "wolfForm" || e.hp <= 0) return;
  const w = SKILL.wolfForm;
  applyStatus(
    state,
    { kind: "enemy", enemy: e },
    { kind: "bleed", stacks: w.bleedStacks, duration: STATUS.bleed.duration * shape.params.statusDurationMul, potency: w.bleedPotency },
    "player",
  );
}

/**
 * 鉄塊化: プレイヤーに付いた怯み（被弾硬直）を外す。player.ts が怯みの判定より先に呼ぶので、
 * 敵の攻撃が付けた怯みが 1 フレームも効かない
 */
export function shrugStagger(state: GameState): void {
  if (!ironBraced(state) || !hasStatus(state.player.status, "stagger")) return;
  removeStatus(state, { kind: "player" }, "stagger");
}

function howl(state: GameState, shape: ShapeFormState): void {
  if (shape.actionLeft > 0) return;
  const w = SKILL.wolfForm;
  const p = state.player;
  const radius = w.howlRadius * shape.params.areaMul;
  shape.actionLeft = w.howlCooldown;
  for (const e of enemiesInRadius(state, p.body.pos, radius)) {
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "fear", stacks: 1, duration: w.fearDuration * shape.params.statusDurationMul, potency: 0 }, "player");
  }
  spawnRing(state, p.body.pos, radius, COLOR_WOLF, RING_LIFE);
  pushSfx(state, "wolfHowl");
}

// ---------------------------------------------------------------------------
// 砲身化
// ---------------------------------------------------------------------------

/** 構え中の右クリック: 1 発ごとに気力を払って撃つ。足りなければ不発（何も減らさない） */
function fireManualShell(state: GameState, shape: ShapeFormState): void {
  if (shape.actionLeft > 0) return;
  const p = state.player;
  const cost = SKILL.siegeForm.cost * shape.params.burdenMul;
  if (!canAffordSkill(state, cost)) {
    notice(state, "気力不足");
    pushSfx(state, "manaEmpty");
    state.skills.manaFlash = SKILL.manaFlashTime;
    return;
  }
  const before = p.mana;
  paySkillCost(state, cost);
  const paid = Math.max(0, before - p.mana);
  fireShell(state, p.body.pos, p.facing, shellParams(shape.params, paid, p.body.pos));
  shape.actionLeft = SKILL.siegeForm.shellInterval * shape.params.intervalMul;
}

/** 砲撃 1 発ぶんの params。払い戻しの上限・命中の記録は 1 発ごとに作り直す（構えた瞬間の 1 発と共有しない） */
function shellParams(base: CastParams, paid: number, origin: Vec): CastParams {
  return {
    ...base,
    manaPaid: paid,
    refundPool: { left: paid },
    hitRefundPool: { left: paid * SKILL.modifier.refund.cap },
    gaspPool: { left: base.lastGasp === null ? 0 : SKILL.modifier.lastGasp.maxPerCast },
    hitLog: new Set(),
    origin: { ...origin },
  };
}

function fireShell(state: GameState, from: Vec, dir: Vec, params: CastParams): void {
  const s = SKILL.siegeForm;
  spawnShot(state, from, dir, params, {
    effect: "plain",
    power: skillPower(state, s.damage, params),
    speed: s.speed,
    life: s.life,
    radius: s.radius * params.areaMul,
    knockback: s.knockback,
    color: COLOR_SIEGE,
  });
  const p = state.player;
  p.knock = add(p.knock, scale(dir, -s.recoil));
  spawnBurst(state, add(from, scale(dir, p.body.radius)), COLOR_SIEGE, BURST_PARTICLES / 2, BURST_SPEED, BURST_LIFE / 2, BURST_SIZE);
  shake(state, SHAKE_SHELL);
  pushSfx(state, "siegeCannon");
}

// ---------------------------------------------------------------------------
// 霊体化
// ---------------------------------------------------------------------------

/** 自分と重なった敵を覚える（解けたときの出血の対象） */
function notePassed(state: GameState, shape: ShapeFormState): void {
  const p = state.player.body;
  const pad = SKILL.wraithForm.passPad;
  for (const e of state.enemies) {
    if (e.hp <= 0 || shape.passed.has(e.id)) continue;
    if (circlesOverlap(p.pos.x, p.pos.y, p.radius + pad, e.body.pos.x, e.body.pos.y, e.body.radius)) shape.passed.add(e.id);
  }
}

function bleedPassed(state: GameState, shape: ShapeFormState): void {
  const w = SKILL.wraithForm;
  const potency = w.bleedPotency * shape.params.potencyMul;
  const duration = STATUS.bleed.duration * shape.params.statusDurationMul;
  for (const e of state.enemies) {
    if (e.hp <= 0 || !shape.passed.has(e.id)) continue;
    applyStatus(state, { kind: "enemy", enemy: e }, { kind: "bleed", stacks: w.bleedStacks, duration, potency }, "player");
    spawnBurst(state, e.body.pos, COLOR_WRAITH, BURST_PARTICLES / 2, BURST_SPEED / 2, BURST_LIFE, BURST_SIZE);
  }
}

// ---------------------------------------------------------------------------
// 業火の化身
// ---------------------------------------------------------------------------

/** 維持の気力を払う。払いきれなければ 0 にして false（解ける） */
function drainPyre(state: GameState, shape: ShapeFormState, dt: number): boolean {
  const p = state.player;
  const cost = SKILL.pyreForm.drainPerSec * shape.params.burdenMul * dt;
  if (p.mana < cost) {
    p.mana = 0;
    return false;
  }
  p.mana -= cost;
  return true;
}

function pyreProcs(params: Readonly<CastParams>): StatusProc[] {
  const f = SKILL.pyreForm;
  const base = { kind: "burn", chance: 1, stacks: 1, duration: f.burnDuration * params.statusDurationMul, potency: f.burnPotency * params.potencyMul } as const;
  return [
    { ...base, on: "melee" },
    { ...base, on: "ranged" },
  ];
}

/**
 * 近接・射撃の on-hit 付与に燃焼を差し込む。装備を替えると applyStats が stats を作り直して消えるので毎ステップ確かめる
 * （第 2 弾の変身が武器種を差し直すのと同じやり方）
 */
function ensurePyreProcs(state: GameState, params: Readonly<CastParams>): void {
  if (state.stats.statusProcs.some((proc) => PYRE_PROCS.has(proc))) return;
  const procs = pyreProcs(params);
  for (const proc of procs) PYRE_PROCS.add(proc);
  replaceProcs(state, [...state.stats.statusProcs, ...procs]);
}

function stripPyreProcs(state: GameState): void {
  if (!state.stats.statusProcs.some((proc) => PYRE_PROCS.has(proc))) return;
  replaceProcs(
    state,
    state.stats.statusProcs.filter((proc) => !PYRE_PROCS.has(proc)),
  );
}

/** stats の付与だけを差し替えた写しにする（ほかの値は装備のまま。鍛冶・祭壇の上乗せの印も引き継ぐ） */
function replaceProcs(state: GameState, statusProcs: StatusProc[]): void {
  const prev = state.stats;
  state.stats = { ...prev, statusProcs };
  carryContractPatch(prev, state.stats);
}

function selfBurn(state: GameState): void {
  const f = SKILL.pyreForm;
  applyStatus(state, { kind: "player" }, { kind: "burn", stacks: 1, duration: f.selfBurnDuration, potency: f.selfBurnPotency }, "self");
  addFloatingText(state, state.player.body.pos, "気力が尽きた", COLOR_PYRE, NOTICE_SCALE, TEXT_LIFE);
}

// ---------------------------------------------------------------------------
// 近接の型（狼化・鉄塊化）
// ---------------------------------------------------------------------------

/** 威力の係数を倍にする（発動時の威力・効果量の倍率を段に畳むため） */
function scaleScaling(s: Readonly<Scaling>, mul: number): Scaling {
  const out: Scaling = { base: s.base * mul };
  for (const k of ATTR_KEYS) {
    const v = s[k];
    if (v !== undefined) out[k] = v * mul;
  }
  return out;
}

/** 怯み値の係数を倍にする（怯み値の倍率を段に畳むため） */
function scaleRatio(r: Readonly<AttrRatio>, mul: number): AttrRatio {
  const out: AttrRatio = {};
  for (const k of ATTR_KEYS) {
    const v = r[k];
    if (v !== undefined) out[k] = v * mul;
  }
  return out;
}

function tunedStep(step: MeleeStepDef, params: Readonly<CastParams>): MeleeStepDef {
  const poiseRatio = step.poiseRatio === undefined ? undefined : scaleRatio(step.poiseRatio, params.poiseMul);
  return { ...step, scaling: scaleScaling(step.scaling, params.damageMul * params.potencyMul), poise: step.poise * params.poiseMul, poiseRatio };
}

/**
 * 狼化は噛みつき 1 段、鉄塊化は重い振り 1 段の近接の型を作る（ダッシュ攻撃も同じ段）。
 * key は装備の武器種のまま（振り音・得意の判定は装備を見る）
 */
function buildMoveset(equipped: MovesetKey, key: Wave3SkillKey, params: Readonly<CastParams>): MovesetDef | null {
  if (key === "wolfForm") {
    const w = SKILL.wolfForm;
    const bite = tunedStep(w.bite, params);
    // 右クリックは shapeButtonPress が遠吠えとして先に取るので、技の噛みつきは出ない（型を揃えるための置き場）
    return defineMoveset({
      key: equipped,
      name: SKILL_NAME.wolfForm,
      desc: "噛みつき突進（出血）。右クリックは遠吠え",
      steps: [bite],
      dashAttack: bite,
      attackMoveMul: w.attackMoveMul,
      primary: "melee",
      art: { kind: "strike", key: "wolfBite", name: "噛みつき", desc: "噛みついて出血させる", cooldown: 0, step: bite },
      branches: [],
      keywords: kw(["melee", "bleed"]),
      attack: attack("melee", "physical"),
    });
  }
  if (key === "ironForm") {
    const f = SKILL.ironForm;
    const swing = tunedStep(f.swing, params);
    return defineMoveset({
      key: equipped,
      name: SKILL_NAME.ironForm,
      desc: "1 段の重い振り（大きく怯ませる）。右クリックも同じ振り",
      steps: [swing],
      dashAttack: swing,
      attackMoveMul: f.attackMoveMul,
      primary: "melee",
      art: { kind: "strike", key: "ironSwing", name: "鉄塊の振り", desc: "重い振りで大きく怯ませる", cooldown: 0, step: swing },
      branches: [],
      keywords: kw(["melee", "stagger", "wall"]),
      attack: attack("melee", "physical"),
    });
  }
  return null;
}

function notice(state: GameState, text: string): void {
  const rs = state.skills;
  if (rs.notReadyTimer > 0) return;
  rs.notReadyTimer = SKILL.notReadyTextInterval;
  addFloatingText(state, state.player.body.pos, text, COLOR_NOTICE, NOTICE_SCALE, NOTICE_LIFE);
}
