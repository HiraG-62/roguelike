import type { AttackProfile, Element } from "../core/element";
import type { Enemy, GameState } from "../core/state";
import type { StatusApply } from "../core/status";
import type { TerrainKind } from "../core/terrain";
import { type Vec, dist, normalize, scale, sub } from "../core/vec";
import { ENERGY, FEEL } from "../data/tuning";
import type { Scaling } from "../loot/types";
import { scaled, withRatio } from "../system/attributes";
import { damageEnemy, rollOutgoing } from "../system/combat";
import { spawnLine, spawnRing } from "../system/effects";
import { applyStatus, enemiesInRadius } from "../system/statusEffects";
import { isAllied } from "../system/rules";
import { placeTerrain } from "../system/terrain";
import { fireTrigger } from "../system/triggers";
import { onManaSource } from "../system/manaSources";
import { gainMorale } from "../system/morale";
import { minionDamageMul } from "../system/tomeBell";
import { TRAIT_COLORS } from "../loot/types";
import { resonantHue } from "../system/resonance";
import { SKILL, SKILL_DEFS, skillAttack } from "./data";
import type { CastParams, SkillDef } from "./types";
import { noteWearHit } from "./wear";

/**
 * スキルのダメージの共通入口。rollOutgoing → damageEnemy に、
 * 怯み値・状態異常の付与（docs/COMBAT_DESIGN.md B-4）を重ねる。
 * 刻印符のうち「命中ごとに決まるもの」（連鎖・爆ぜ・巡り・地形化）もここで畳む
 */

const COLOR_CHAIN = "#ffff80";
const COLOR_BURST = "#ff9060";
const CHAIN_LINE_LIFE = 0.14;
const BURST_RING_LIFE = 0.18;
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
  /** 攻撃した位置。読んでいた刻印符（背面・地崩れ）は段取り 7c で消え、今は読まない（呼び出し側は渡したままでよい） */
  from?: Vec;
  /** 会心を確定させる（刺し穿ちの脆弱消費） */
  forceCrit?: boolean;
  /** 設置物・従魔の命中（流儀の気力の源 minionHit。skills/placed.ts・summons.ts が爆ぜる・回る・崩れる一撃に付ける。刻む命中は付けない） */
  minion?: boolean;
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

/**
 * この発動の攻撃の素性。杖の型・移ろい刃・極意は属性だけを差し替える（ジャンルはスキルのまま）。
 * 与ダメを持たないスキル（null）は差し替えない
 */
export function castAttack(params: Readonly<CastParams>): AttackProfile | null {
  const base = skillAttack(params.skillKey);
  if (!base || params.element === null) return base;
  return { ...base, element: params.element };
}

/** 1 体への命中。倒したら true */
export function skillHit(state: GameState, e: Enemy, params: Readonly<CastParams>, spec: SkillHitSpec): boolean {
  // 従魔（眷属）はすり抜ける（傷・状態異常だけでなく、気力・戦意・命中の Trigger も起こさない）
  if (isAllied(state, e)) return false;
  const def = SKILL_DEFS[params.skillKey];
  const pos = { ...e.body.pos };
  noteWearHit(state, params.slot);
  // 素性が null のスキル（影渡り・伝染など）も刻印符「爆ぜ」などで当てることがある。null のまま渡すと防御・耐性を
  // 素通しするので、そのときは既定（範囲軸だけ合わせた無属性の物理）に任せる
  // 鈴の打ち鳴らしの強化は設置物・従魔の命中だけに乗る（system/tomeBell.ts）
  const base = spec.base * minionDamageMul(state, spec.minion === true);
  const out = rollOutgoing(state, e, base, spec.kind, { skill: true, attack: castAttack(params) ?? undefined });
  const crit = out.crit || spec.forceCrit === true;
  const critMul = crit && !out.crit ? state.stats.critMul : 1;
  const amount = Math.max(MIN_DAMAGE, Math.round(out.amount * critMul));
  const melee = spec.kind === "melee";
  const knock = knockback(params, spec);
  params.hitLog.add(e.id);
  const killed = damageEnemy(state, e, amount, knock.dir, knock.force * state.stats.knockbackMul, {
    poise: (spec.poise ?? def.poise) * poiseRatioScale(state, def) * state.stats.poiseDamageMul * params.poiseMul,
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
  // 流儀の気力の源（system/manaSources.ts）
  onManaSource(state, spec.minion === true ? "minionHit" : "skillHit");
  // 型の戦意（書 = スキルの命中、鈴 = 設置物・従魔の命中）
  gainMorale(state, spec.minion === true ? "minionHit" : "skillHit");
  afterHit(state, e, params, spec, killed, pos);
  return killed;
}

/** ノックバックの向きと強さ。手繰り（負の倍率）は向きを反転して発動側へ引く */
function knockback(params: Readonly<CastParams>, spec: SkillHitSpec): { dir: Vec; force: number } {
  const mul = params.knockbackMul;
  const force = spec.knockback * Math.abs(mul);
  return { dir: mul < 0 ? scale(spec.dir, -1) : spec.dir, force };
}

/** 命中の後始末: 付与・地形化・巡り・連鎖・爆ぜ */
function afterHit(state: GameState, e: Enemy, params: Readonly<CastParams>, spec: SkillHitSpec, killed: boolean, pos: Vec): void {
  const def = SKILL_DEFS[params.skillKey];
  if (!killed) applySkillStatuses(state, e, spec.applies === undefined ? def.applies : spec.applies, params);
  if (params.leyline) leylineAt(state, pos, params);
  if (params.refundPerHit > 0) refundOnHit(state, params);
  if (params.chain) chainFrom(state, e, params, spec, pos);
  if (params.burst) burstAt(state, params, spec, pos);
}

/** 命中した敵に状態異常を付ける。効果量は potencyMul、持続は statusDurationMul で伸びる */
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
    applyStatus(state, { kind: "enemy", enemy: e }, { ...a, potency, duration: a.duration * params.statusDurationMul }, "player");
  }
}

/** 連鎖・爆ぜが起こす追加の命中は、もう連鎖・爆ぜを起こさない（1 回の命中から広がり続けないため） */
function sideParams(params: Readonly<CastParams>): CastParams {
  return { ...params, chain: false, burst: false };
}

/** 連鎖: 命中した敵から、この発動でまだ当てていない最寄りの敵へ跳ぶ（発動 1 回ぶんの残り回数まで） */
function chainFrom(state: GameState, from: Enemy, params: Readonly<CastParams>, spec: SkillHitSpec, pos: Vec): void {
  if (params.chainPool.left <= 0) return;
  const c = SKILL.modifier.chain;
  const next = nearestUnhit(state, from, pos, c.range, params.hitLog);
  if (!next) return;
  params.chainPool.left -= 1;
  spawnLine(state, pos, next.body.pos, COLOR_CHAIN, CHAIN_LINE_LIFE);
  const dir = normalize(sub(next.body.pos, pos), spec.dir);
  skillHit(state, next, sideParams(params), { base: spec.base * c.damageMul, kind: spec.kind, dir, knockback: 0, stagger: false, applies: spec.applies, from: pos });
}

function nearestUnhit(state: GameState, from: Enemy, pos: Vec, range: number, hit: ReadonlySet<number>): Enemy | null {
  let best: Enemy | null = null;
  let bestD = range;
  for (const e of state.enemies) {
    if (e.id === from.id || e.hp <= 0 || e.phase === "spawning" || hit.has(e.id) || isAllied(state, e)) continue;
    const d = dist(e.body.pos, pos) - e.body.radius;
    if (d > bestD) continue;
    best = e;
    bestD = d;
  }
  return best;
}

/** 爆ぜ: 命中点で小爆発（範囲の敵すべて。命中した敵にも当たる。発動 1 回ぶんの残り回数まで） */
function burstAt(state: GameState, params: Readonly<CastParams>, spec: SkillHitSpec, pos: Vec): void {
  if (params.burstPool.left <= 0) return;
  params.burstPool.left -= 1;
  const b = SKILL.modifier.burst;
  spawnRing(state, pos, b.radius, COLOR_BURST, BURST_RING_LIFE);
  const side = sideParams(params);
  for (const e of enemiesInRadius(state, pos, b.radius)) {
    const dir = normalize(sub(e.body.pos, pos), spec.dir);
    skillHit(state, e, side, { base: spec.base * b.damageMul, kind: spec.kind, dir, knockback: 0, stagger: false, applies: null, from: pos });
  }
}

/** 共鳴している状態異常の色（system/resonance.ts の resonantHue）の番号。共鳴していなければ null */
export function resonanceHueIndex(state: GameState): number | null {
  const color = resonantHue(state);
  if (color === null) return null;
  const index = TRAIT_COLORS.indexOf(color);
  return index >= 0 ? index : null;
}

/** 地形化・軌跡が湧かせる地形（属性ごと）。雷・光は水たまり（濡れと感電の噛み合い）、闇は油 */
export const LEYLINE_TERRAIN: Readonly<Record<Element, TerrainKind>> = {
  none: "grass",
  fire: "fire",
  ice: "ice",
  lightning: "water",
  light: "water",
  poison: "bog",
  dark: "oil",
};

/** 地形化: 命中した位置に属性の地形（発動 1 回ぶんの残り回数まで） */
function leylineAt(state: GameState, pos: Vec, params: Readonly<CastParams>): void {
  if (params.leyPool.left <= 0) return;
  params.leyPool.left -= 1;
  const l = SKILL.modifier.leyline;
  const element = castAttack(params)?.element ?? "none";
  placeTerrain(state, pos.x, pos.y, LEYLINE_TERRAIN[element], l.radius, l.time);
}

/** 巡り: 命中 1 回ごとにコストの一部を返す。上限は hitRefundPool と、払った額そのもの（refundPool） */
function refundOnHit(state: GameState, params: Readonly<CastParams>): void {
  const want = Math.min(params.manaPaid * params.refundPerHit, params.hitRefundPool.left);
  if (want <= 0) return;
  params.hitRefundPool.left -= refundMana(state, want, params.refundPool);
}

/**
 * 払い戻し: 払ったコストの一部を返す。回収ではなく払い戻しなので manaGainMul は掛けない
 * （スキル自身の命中でマナが増える無限ループを作らないため、返すのは払った分の割合だけ）。
 * pool は発動 1 回ぶんの残り。反響の命中を合わせても払った額を超えて戻さない。実際に返した量を返す
 */
function refundMana(state: GameState, amount: number, pool: { left: number }): number {
  const refund = Math.min(amount, pool.left);
  if (refund <= 0) return 0;
  pool.left -= refund;
  const p = state.player;
  const before = p.mana;
  p.mana = Math.min(state.stats.maxMana, p.mana + refund);
  return p.mana - before;
}
