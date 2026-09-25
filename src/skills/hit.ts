import type { AttackProfile, Element } from "../core/element";
import type { Enemy, GameState } from "../core/state";
import type { StatusApply } from "../core/status";
import type { TerrainKind } from "../core/terrain";
import { type Vec, add, length, normalize, scale, sub } from "../core/vec";
import { ENERGY, FEEL, POISE, STATUS } from "../data/tuning";
import type { Scaling } from "../loot/types";
import { scaled, withRatio } from "../system/attributes";
import { onBoonSkillHit } from "../system/boons";
import { damageEnemy, rollOutgoing } from "../system/combat";
import { addFloatingText, spawnBurst } from "../system/effects";
import { isStaggered } from "../system/poise";
import { applyStatus } from "../system/statusEffects";
import { placeTerrain } from "../system/terrain";
import { fireTrigger } from "../system/triggers";
import { TRAIT_COLORS } from "../loot/types";
import { SKILL, SKILL_DEFS, resolveCast, skillAttack } from "./data";
import { stoneInSlot } from "./persistence";
import type { CastParams, SkillDef } from "./types";
import { noteWearHit } from "./wear";

/**
 * スキルのダメージの共通入口。rollOutgoing → damageEnemy に、
 * 怯み値・状態異常の付与（docs/COMBAT_DESIGN.md B-4）と
 * 刻印符の呪い（被ダメ増 + 刻印）と連鎖（キルでチャージ / マナ返却）を重ねる。
 * 大拡張の刻印符のうち「命中ごとに決まるもの」（背面・至近 / 遠当て・重撃 / 軽打・突き放し / 手繰り・
 * 延命・伝播・返金・追撃・散り際・同調の金）もここで畳む。
 */

export const COLOR_CURSE = "#b040ff";
const STATUS_HUE_DURATION = STATUS.hue.duration;
const COLOR_RESET = "#ffff80";
const RESET_TEXT_SCALE = 1;
const RESET_TEXT_LIFE = 0.6;
const CURSE_PARTICLES = 4;
const CURSE_PARTICLE_SPEED = 30;
const CURSE_PARTICLE_LIFE = 0.3;
const CURSE_PARTICLE_SIZE = 1.5;
const MIN_DAMAGE = 1;

export interface SkillHitSpec {
  base: number;
  kind: "melee" | "ranged";
  dir: Vec;
  knockback: number;
  /** 重い一撃として大きいヒットストップを出すか（怯みの判定は poise だけ。怯んだら damageEnemy が重くする） */
  stagger: boolean;
  /** 基礎怯み値の上書き（引力球の tick など）。省略時は SKILL_DEFS[params.skillKey].poise */
  poise?: number;
  /** 付与する状態異常の上書き。null なら付けない。省略時は SKILL_DEFS[params.skillKey].applies */
  applies?: readonly StatusApply[] | null;
  /** 攻撃した位置（背面の判定）。省略時はプレイヤーの位置 */
  from?: Vec;
  /** 会心を確定させる（刺し穿ちの脆弱消費） */
  forceCrit?: boolean;
}

/**
 * 怯み値の係数（SkillDef.poiseRatio）を倍率に直す。1 発ごとに怯み値を変えるスキル（spec.poise）にも
 * 同じ割合で掛けたいので、基礎値での怯み値との比で持つ（docs/COMBAT_DESIGN.md A-10）
 */
export function poiseRatioScale(state: GameState, def: Readonly<SkillDef>): number {
  if (def.poiseRatio === undefined || def.poise <= 0) return 1;
  return withRatio(state.stats, def.poise, def.poiseRatio) / def.poise;
}

/** スキルの威力 = scaled(ステータス, 係数表) × damageMul（docs/COMBAT_DESIGN.md A-6 の 1） */
export function skillPower(state: GameState, scaling: Readonly<Scaling>, params: Readonly<CastParams>): number {
  return scaled(state.stats, scaling) * params.damageMul;
}

/** 呪い中なら被ダメ倍率（1 + bonus）、そうでなければ 1 */
export function curseMul(state: GameState, enemyId: number): number {
  const c = state.skills.curses.get(enemyId);
  return c && c.time > 0 ? 1 + c.bonus : 1;
}

/** 背面: 攻撃した位置が敵の向きの反対側なら背後 */
export function isBehind(e: Enemy, from: Vec): boolean {
  const to = sub(from, e.body.pos);
  return e.facing.x * to.x + e.facing.y * to.y < 0;
}

/** 位置で決まる倍率（背面・至近 / 遠当て）。damage と poise に掛ける */
export function positionalMul(e: Enemy, params: Readonly<CastParams>, from: Vec): { damage: number; poise: number } {
  const m = SKILL.modifier;
  let damage = 1;
  let poise = 1;
  if (params.flank) {
    const mul = isBehind(e, from) ? m.flank.backMul : m.flank.frontMul;
    damage *= mul;
    poise *= mul;
  }
  if (params.rangeBias === "pointBlank") {
    damage *= length(sub(e.body.pos, params.origin)) <= m.pointBlank.range ? m.pointBlank.nearMul : m.pointBlank.farMul;
  } else if (params.rangeBias === "longshot") {
    const ratio = Math.min(1, length(sub(e.body.pos, params.origin)) / m.longshot.range);
    damage *= m.longshot.nearMul + (m.longshot.farMul - m.longshot.nearMul) * ratio;
  }
  return { damage, poise };
}

/**
 * この発動の攻撃の素性。属性の刻印符・武器写し・移ろい刃・極意は属性だけを差し替える（ジャンルはスキルのまま）。
 * 与ダメを持たないスキル（null）は差し替えない
 */
export function castAttack(params: Readonly<CastParams>): AttackProfile | null {
  const base = skillAttack(params.skillKey);
  if (!base || params.element === null) return base;
  return { ...base, element: params.element };
}

/** 1 体への命中。倒したら true */
export function skillHit(state: GameState, e: Enemy, params: Readonly<CastParams>, spec: SkillHitSpec): boolean {
  const def = SKILL_DEFS[params.skillKey];
  const from = spec.from ?? state.player.body.pos;
  const pos = { ...e.body.pos };
  noteWearHit(state, params.slot);
  // 素性が null のスキル（影渡り・伝染など）も刻印符「着地」などで当てることがある。null のまま渡すと防御・耐性を
  // 素通しするので、そのときは既定（範囲軸だけ合わせた無属性の物理）に任せる
  const out = rollOutgoing(state, e, spec.base, spec.kind, { skill: true, attack: castAttack(params) ?? undefined });
  const crit = out.crit || spec.forceCrit === true;
  const critMul = crit && !out.crit ? state.stats.critMul : 1;
  const attune = crit && params.attuneCrit ? SKILL.modifier.attune.matchMul : 1;
  const place = positionalMul(e, params, from);
  const amount = Math.max(MIN_DAMAGE, Math.round(out.amount * critMul * attune * place.damage * curseMul(state, e.id)));
  const melee = spec.kind === "melee";
  const knock = knockback(e, params, spec);
  if (params.repel) e.wallSplat = true;
  params.hitLog.add(e.id);
  const killed = damageEnemy(state, e, amount, knock.dir, knock.force * state.stats.knockbackMul, {
    poise: (spec.poise ?? def.poise) * poiseRatioScale(state, def) * state.stats.poiseDamageMul * params.poiseMul * place.poise,
    hitstopSteps: spec.stagger ? FEEL.hitstopHeavy : FEEL.hitstopLight,
    energy: melee ? ENERGY.skillMeleeHit : undefined,
    kind: spec.kind,
    crit,
    // 性質の statusProcs（on: "skill"）を判定させる
    skill: true,
  });
  if (melee) {
    state.player.meleeHitCount += 1;
    fireTrigger(state, "onMeleeHit", { pos, targetId: e.id });
    fireTrigger(state, "everyNthMeleeHit", { pos, targetId: e.id });
  }
  onBoonSkillHit(state, e);
  afterHit(state, e, params, spec, killed, pos);
  return killed;
}

/** ノックバックの向きと強さ。手繰り（負の倍率）は向きを反転して発動側へ引く。突き放しは怯んでいない敵の軽減を打ち消す */
function knockback(e: Enemy, params: Readonly<CastParams>, spec: SkillHitSpec): { dir: Vec; force: number } {
  const mul = params.knockbackMul;
  const unstaggered = params.repel && !isStaggered(e) ? 1 / POISE.knockbackUnstaggered : 1;
  const force = spec.knockback * Math.abs(mul) * unstaggered;
  return { dir: mul < 0 ? scale(spec.dir, -1) : spec.dir, force };
}

/** 命中の後始末: 付与・呪い・連鎖・返金・追撃・散り際・地染め */
function afterHit(state: GameState, e: Enemy, params: Readonly<CastParams>, spec: SkillHitSpec, killed: boolean, pos: Vec): void {
  const def = SKILL_DEFS[params.skillKey];
  if (!killed) applySkillStatuses(state, e, spec.applies === undefined ? def.applies : spec.applies, params);
  // 刻印符の付与（属性・揺さぶり・彩り）はスキル本来の付与を消す命中（着地衝撃など）でも付く
  if (!killed) applySkillStatuses(state, e, params.extraApplies, params);
  if (!killed && params.hueInfuse) applyResonanceHue(state, e, params);
  if (params.leyline) leylineAt(state, pos, params);
  if (params.crumble) crumbleLine(state, spec.from ?? state.player.body.pos, pos, params);
  if (params.curse && !killed) applyCurse(state, e, params.curse);
  if (params.followUp && !killed) markFollowUp(state, e, spec.base);
  if (params.refundPerHit > 0) refundOnHit(state, params, pos);
  if (killed && params.killRefund) refundCharge(state, params.slot, pos);
  if (killed && params.killManaRefund > 0) refundMana(state, params.manaPaid * params.killManaRefund, pos, params.refundPool);
  if (killed) queueLastGasp(state, params, pos, spec.dir);
}

/** 命中した敵に状態異常を付ける。効果量は血の代償などの potencyMul、持続は延命で伸びる。伝播なら近くの 1 体にも */
export function applySkillStatuses(
  state: GameState,
  e: Enemy,
  applies: readonly StatusApply[] | null | undefined,
  params: Readonly<CastParams>,
): void {
  if (!applies) return;
  for (const a of applies) {
    // 彩痕の potency は色の番号なので効果量を掛けない（掛けると別の色になる）
    const potency = a.kind === "hue" ? a.potency : a.potency * params.potencyMul;
    const apply = { ...a, potency, duration: a.duration * params.statusDurationMul };
    applyStatus(state, { kind: "enemy", enemy: e }, apply, "player");
    if (params.spread) spreadStatus(state, e, apply);
  }
}

/** 伝播: 近くの別の敵 1 体に、持続を減らし重ねる数を 1 減らして付ける（最低 1） */
function spreadStatus(state: GameState, from: Enemy, apply: StatusApply): void {
  const s = SKILL.modifier.spread;
  const next = nearestOther(state, from, s.radius);
  if (!next) return;
  const copy = { ...apply, stacks: Math.max(1, apply.stacks - 1), duration: apply.duration * s.durationMul };
  applyStatus(state, { kind: "enemy", enemy: next }, copy, "player");
}

function nearestOther(state: GameState, from: Enemy, radius: number): Enemy | null {
  let best: Enemy | null = null;
  let bestD = radius;
  for (const e of state.enemies) {
    if (e.id === from.id || e.hp <= 0 || e.phase === "spawning") continue;
    const d = length(sub(e.body.pos, from.body.pos));
    if (d > bestD) continue;
    best = e;
    bestD = d;
  }
  return best;
}

/** 装備の共鳴の色（支配・二重・三和音の最初の色）の番号。散光・共鳴なしは null */
export function resonanceHueIndex(state: GameState): number | null {
  const r = state.stats.resonance;
  if (r.kind === "scatter" || r.kind === "none") return null;
  const color = r.colors[0];
  if (color === undefined) return null;
  const index = TRAIT_COLORS.indexOf(color);
  return index >= 0 ? index : null;
}

/** 彩り: 共鳴の色の彩痕（色が定まらなければ付けない） */
function applyResonanceHue(state: GameState, e: Enemy, params: Readonly<CastParams>): void {
  const index = resonanceHueIndex(state);
  if (index === null) return;
  applySkillStatuses(state, e, [{ kind: "hue", stacks: 1, duration: STATUS_HUE_DURATION, potency: index }], params);
}

/** 地染めが湧かせる地形（属性ごと）。雷・光は水たまり（濡れと感電の噛み合い）、闇は油 */
export const LEYLINE_TERRAIN: Readonly<Record<Element, TerrainKind>> = {
  none: "grass",
  fire: "fire",
  ice: "ice",
  lightning: "water",
  light: "water",
  poison: "bog",
  dark: "oil",
};

/** 地染め: 命中した位置に属性の地形（発動 1 回ぶんの残り回数まで） */
function leylineAt(state: GameState, pos: Vec, params: Readonly<CastParams>): void {
  if (params.leyPool.left <= 0) return;
  params.leyPool.left -= 1;
  const l = SKILL.modifier.leyline;
  const element = castAttack(params)?.element ?? "none";
  placeTerrain(state, pos.x, pos.y, LEYLINE_TERRAIN[element], l.radius, l.time);
}

/**
 * 地崩れ（地裂き専用）: 発動した位置から命中した敵まで（+ 吹き飛ぶぶん extend px 先まで）のマスを崩れる床にする。
 * 崩れる規則（乗り続けると抜けて落ちる）は system/terrain.ts が持つ
 */
function crumbleLine(state: GameState, from: Vec, to: Vec, params: Readonly<CastParams>): void {
  const c = SKILL.modifier.crumble;
  const delta = sub(to, from);
  const dir = normalize(delta, state.player.facing);
  const total = length(delta) + c.extend;
  const time = c.time * params.durationMul;
  for (let d = 0; d <= total; d += c.step) {
    const at = add(from, scale(dir, d));
    placeTerrain(state, at.x, at.y, "rubble", 0, time);
  }
}

/** 追撃の印。近接で当てると追加ヒット（system/skills.ts の onSkillMeleeHit） */
function markFollowUp(state: GameState, e: Enemy, base: number): void {
  const f = SKILL.modifier.followUp;
  state.skills.marks.set(e.id, { time: f.time, power: base * f.powerRatio });
}

/** 返金: 命中 1 回ごとにコストの一部を返す。上限は hitRefundPool と、払った額そのもの（refundPool） */
function refundOnHit(state: GameState, params: Readonly<CastParams>, pos: Vec): void {
  const want = Math.min(params.manaPaid * params.refundPerHit, params.hitRefundPool.left);
  if (want <= 0) return;
  params.hitRefundPool.left -= refundMana(state, want, pos, params.refundPool, false);
}

/** 散り際: 倒した位置で同じスキルを弱く起こす予約（1 回の発動で上限まで。写しからは起きない） */
function queueLastGasp(state: GameState, params: Readonly<CastParams>, pos: Vec, dir: Vec): void {
  if (params.lastGasp === null || params.gaspPool.left <= 0) return;
  params.gaspPool.left -= 1;
  state.skills.gasps.push({
    pos: { ...pos },
    dir: normalize(dir, state.player.facing),
    params: { ...params, damageMul: params.damageMul * params.lastGasp, lastGasp: null, echo: null, delay: null },
  });
}

/**
 * 払い戻し: 払ったコストの一部を返す。回収ではなく払い戻しなので manaGainMul は掛けない
 * （スキル自身の命中でマナが増える無限ループを作らないため、返すのは払った分の割合だけ）。
 * pool は発動 1 回ぶんの残り。複数撃破・反響の撃破を合わせても払った額を超えて戻さない。実際に返した量を返す
 */
export function refundMana(state: GameState, amount: number, pos: Vec, pool: { left: number }, showText = true): number {
  const refund = Math.min(amount, pool.left);
  if (refund <= 0) return 0;
  pool.left -= refund;
  const p = state.player;
  const before = p.mana;
  p.mana = Math.min(state.stats.maxMana, p.mana + refund);
  if (showText) addFloatingText(state, pos, "払い戻し", COLOR_RESET, RESET_TEXT_SCALE, RESET_TEXT_LIFE);
  return p.mana - before;
}

function applyCurse(state: GameState, e: Enemy, curse: { duration: number; bonus: number }): void {
  const cur = state.skills.curses.get(e.id);
  const bonus = cur ? Math.max(cur.bonus, curse.bonus) : curse.bonus;
  const time = cur ? Math.max(cur.time, curse.duration) : curse.duration;
  state.skills.curses.set(e.id, { time, bonus });
  spawnBurst(state, e.body.pos, COLOR_CURSE, CURSE_PARTICLES, CURSE_PARTICLE_SPEED, CURSE_PARTICLE_LIFE, CURSE_PARTICLE_SIZE);
}

/** 連鎖: スロットのチャージを 1 返す（最大まで）。満タンになれば CD も止める */
export function refundCharge(state: GameState, slotIndex: number, pos: Vec): void {
  const rs = state.skills;
  const slot = rs.slots[slotIndex];
  const stone = stoneInSlot(rs.profile, slotIndex);
  if (!slot || !stone) return;
  const max = resolveCast(SKILL_DEFS[stone.skillKey], stone, slot.modifiers).charges;
  if (slot.chargesLeft >= max) return;
  slot.chargesLeft += 1;
  if (slot.chargesLeft >= max) slot.cooldownLeft = 0;
  addFloatingText(state, pos, "チャージ回復", COLOR_RESET, RESET_TEXT_SCALE, RESET_TEXT_LIFE);
}

/** 呪い・追撃の印の時間経過。切れたもの・いなくなった敵は消す */
export function tickCurses(state: GameState, dt: number): void {
  const curses = state.skills.curses;
  const marks = state.skills.marks;
  if (curses.size === 0 && marks.size === 0) return;
  const alive = new Set(state.enemies.filter((e) => e.hp > 0).map((e) => e.id));
  for (const [id, c] of curses) {
    c.time -= dt;
    if (c.time <= 0 || !alive.has(id)) curses.delete(id);
  }
  for (const [id, m] of marks) {
    m.time -= dt;
    if (m.time <= 0 || !alive.has(id)) marks.delete(id);
  }
}
