import {
  type DamageBreakdown,
  type DamageContext,
  type DamageElementShare,
  type DamageTag,
  MIN_INCREASED_MUL,
  type MoreMul,
  dedupeMore,
  moreApplies,
  productMore,
  sumIncreased,
} from "../core/damage";
import type { DamageKind, Enemy, GameState } from "../core/state";
import { enemyDef, isBossClass } from "../data/enemies";
import { STATUS } from "../data/tuning";
import { WAVE3_SKILL_TUNING } from "../skills/tuning3";
import { boonForcesCrit } from "./boonRules";
import { KS, berserkerMul, bladeOathMul, gamblerMul, hasKeystone, oathMore } from "./keystones";
import { applyModifiers, applyPoiseModifiers } from "./modifiers";
import { isStaggered } from "./poise";
import { hasStatus, playerStatusOutgoingMul } from "./statusEffects";
import { keystoneMore, traitIncreased } from "./traitHooks";
import { ultimateCritBonus, ultimateOutgoingMul } from "./ultimates";

/**
 * 与ダメの増と倍を集める（docs/ideas/scaling-impl.md 2-1）。combat.ts の rollOutgoing はこのファイルだけを呼ぶ。
 * 最終の与ダメ = (基礎 + flat) × max(下限, 1 + Σ増 + 性質の条件付き加算) × Π倍 × 敵側（防御・耐性）
 */

/** 倍の出所の表示名（内訳の 1 行） */
const LABEL = {
  weaken: "弱体",
  fury: "激昂",
  ultimate: "奥義",
  wraith: "霊体化",
  combo: "コンボ",
  just: "見切り",
  buff: "強化",
  crit: "会心",
} as const;

/** 1 撃の文脈の追加指定（combat.ts の OutgoingOptions の部分） */
export interface DamageContextOptions {
  skill?: boolean;
  /** 放出の一撃（タグ release） */
  release?: boolean;
}

/** 1 撃のタグ。近接 / 射撃 / proc・スキル由来・怯み中（proc 以外）・ボス・精鋭 */
export function buildContext(enemy: Enemy | null, kind: DamageKind, opts: DamageContextOptions = {}): DamageContext {
  const tags = new Set<DamageTag>([kind]);
  if (opts.skill === true) tags.add("skill");
  if (opts.release === true) tags.add("release");
  if (enemy !== null) addEnemyTags(tags, enemy, kind);
  return { kind, tags, elementShares: [], enemyId: enemy?.id ?? null, crit: false };
}

function addEnemyTags(tags: Set<DamageTag>, enemy: Enemy, kind: DamageKind): void {
  // 怯み中の増は proc（燃焼・トリガーの衝撃波など）に掛けない（従来の damageVsStaggeredMul と同じ）
  if (kind !== "proc" && isStaggered(enemy)) tags.add("vsStaggered");
  if (isBossClass(enemyDef(enemy.defKey))) tags.add("vsBoss");
  if (enemy.elite !== undefined) tags.add("vsElite");
}

/** コンボによる与ダメ倍率 */
export function comboDamageMul(state: GameState): number {
  const s = state.stats;
  return 1 + Math.min(s.comboDamageCap, state.combo.count * s.comboDamagePerStack);
}

/** 等倍でなければ列に足す（内訳に等倍の行を並べない） */
function pushIfActive(out: MoreMul[], source: string, label: string, mul: number): void {
  if (mul !== 1) out.push({ source, label, mul });
}

/** 自分の状態・奥義・変身の倍（乱数を引かない） */
function selfMore(state: GameState, enemy: Enemy | null, kind: DamageKind, out: MoreMul[]): void {
  if (hasStatus(state.player.status, "weaken")) out.push({ source: "status:weaken", label: LABEL.weaken, mul: 1 - STATUS.weaken.mul });
  pushIfActive(out, "status:fury", LABEL.fury, playerStatusOutgoingMul(state));
  // 持続の奥義の倍率（通常攻撃だけ。奥義の行為は proc なので掛からない）
  if (kind === "melee" || kind === "ranged") pushIfActive(out, "ultimate", LABEL.ultimate, ultimateOutgoingMul(state, enemy));
  // 霊体化（skills/forms.ts）はすり抜ける代わりに与ダメが落ちる。forms.ts を import すると循環の評価順が崩れるので state を直に見る
  if (state.skills.shape?.key === "wraithForm") out.push({ source: "skill:wraithForm", label: LABEL.wraith, mul: WAVE3_SKILL_TUNING.wraithForm.outgoingMul });
}

/** 攻撃の手応えの倍（コンボ・見切り・強化・会心）。proc には掛けない。会心の乱数はここで引く（forceCrit でも引く順は変えない） */
function strikeMore(state: GameState, enemy: Enemy | null, kind: DamageKind, out: MoreMul[], forceCrit: boolean): boolean {
  const s = state.stats;
  const p = state.player;
  pushIfActive(out, "combo", LABEL.combo, comboDamageMul(state));
  if (p.justTimer > 0) pushIfActive(out, "just", LABEL.just, s.justDodgeDamageMul);
  if (p.buffs.damage.time > 0) pushIfActive(out, "buff:damage", LABEL.buff, p.buffs.damage.mul);
  const crit = state.rng.chance(s.critChance + ultimateCritBonus(state)) || boonForcesCrit(state, enemy, kind) || forceCrit;
  if (crit) out.push({ source: "crit", label: LABEL.crit, mul: s.critMul + s.increased.critMulti });
  return crit;
}

/** 誓約の倍。賭博師の乱数は会心の後に引く（従来の rollOutgoing と同じ順） */
function oathMores(state: GameState, enemy: Enemy | null, kind: DamageKind, skill: boolean, out: MoreMul[]): void {
  if (hasKeystone(state, KS.berserker)) out.push(oathMore(KS.berserker, berserkerMul(state)));
  if (hasKeystone(state, KS.gambler)) out.push(oathMore(KS.gambler, gamblerMul(state)));
  // 近間の誓い: 近接・射撃・スキルに効く。素性なしの proc は距離を測る意味が薄いので対象外
  if ((kind !== "proc" || skill) && enemy !== null && hasKeystone(state, KS.bladeOath)) out.push(oathMore(KS.bladeOath, bladeOathMul(state, enemy)));
  out.push(...keystoneMore(state, enemy, kind, skill));
}

/** 装備・祝福・ジョブの常時の倍のうち、この 1 撃のタグに掛かるもの */
function staticMore(state: GameState, ctx: DamageContext): MoreMul[] {
  return state.stats.more.filter((m) => moreApplies(m, ctx.tags));
}

/**
 * この 1 撃の倍をすべて集める（出所ごと 1 要素、同じ source は後勝ち）。乱数（会心・賭博師）はここで引く。
 * 引く順は従来の rollOutgoing と同じ（会心 → 賭博師）
 */
export function collectMore(state: GameState, enemy: Enemy | null, ctx: DamageContext, skill: boolean, forceCrit = false): { more: MoreMul[]; crit: boolean } {
  // 常時の倍（stats.more）の後に Modifier の倍（誓約の楔・得意武器・祝福の「〜につき」など）
  const out: MoreMul[] = [...staticMore(state, ctx), ...applyModifiers(state, ctx, enemy).more];
  selfMore(state, enemy, ctx.kind, out);
  const crit = ctx.kind !== "proc" ? strikeMore(state, enemy, ctx.kind, out, forceCrit) : false;
  oathMores(state, enemy, ctx.kind, skill, out);
  return { more: dedupeMore(out), crit };
}

/**
 * 性質の条件付きの加算（場・相手・第 2 弾・スキル）と Modifier の増。敵の状態を読むので、属性の抽選（状態異常を付けうる）より前に呼ぶ
 */
export function collectTraitIncreased(state: GameState, enemy: Enemy | null, ctx: DamageContext, skill: boolean): number {
  return traitIncreased(state, enemy, ctx.kind, skill) + applyModifiers(state, ctx, enemy).increased;
}

/** 1 + Σ増 + 性質の加算（下限 MIN_INCREASED_MUL）。属性の増は割合の重みで足す */
export function increasedFactor(state: GameState, ctx: DamageContext, trait: number, shares: readonly DamageElementShare[]): number {
  const sum = sumIncreased(state.stats.increased, { tags: ctx.tags, elementShares: shares });
  return Math.max(MIN_INCREASED_MUL, 1 + sum + trait);
}

/** 内訳を組み立てる（raw は基礎 + flat） */
export function finishBreakdown(raw: number, increased: number, more: readonly MoreMul[], enemyMul: number, minDamage: number): DamageBreakdown {
  const amount = Math.max(minDamage, Math.round(raw * increased * productMore(more) * enemyMul));
  return { base: raw, increased: increased - 1, more, enemyMul, amount };
}

/** 怯み値の増（increased.poise と tag: "poise" の Modifier）と倍。怯み値は与ダメとは別の量なので、与ダメのタグの増・倍は足さない */
export function poiseIncreasedMul(state: GameState, enemy: Enemy | null = null): number {
  const mods = applyPoiseModifiers(state, enemy);
  return Math.max(0, 1 + state.stats.increased.poise + mods.increased) * productMore(mods.more);
}
