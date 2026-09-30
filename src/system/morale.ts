import type { FrameInput } from "../core/input";
import type { GameState, Player } from "../core/state";
import { isZero } from "../core/vec";
import { FORM } from "../data/tuning";
import { type FormDef, type MoraleGain, type ReleasePerUnit, formOfKey } from "../data/weaponForms";
import { type ButtonKey, type MovesetDef, MOVESETS, chargeLevelAt, isGun, meleeChargeOf } from "../data/weapons";

/**
 * 戦意（docs/ideas/weapon-forms-impl.md 3-2）。武器の型ごとのゲージで、溜まる出来事（MoraleGain）で増え、
 * 型の放出の段（MoraleRelease）の振り始めで使われて、その振り（弾）の倍率になる。
 * ここは Player.morale の数の出し入れだけ（イベント・浮き文字は system/moments.ts）。
 * 型は装備の武器種から引く（変身・奥義の差し替えも key と型は装備のまま）
 */

export type MoraleState = Player["morale"];

/** 放出の倍率（scaleStep と弾が掛ける）。倍率は 1 + perUnit × 戦意、加算は perUnit × 戦意の切り捨て */
export interface ReleaseMul {
  readonly damageMul: number;
  readonly poiseMul: number;
  readonly reachMul: number;
  readonly hitsAdd: number;
  readonly knockbackMul: number;
  readonly pierceAdd: number;
}

/** 振りの開始で放出を判定する材料（player.ts の SwingSpec の部分） */
export interface ReleaseSwingSpec {
  step: number;
  lane: ButtonKey;
  branch: number;
  chargeLevel: number;
  dashStrike: boolean;
}

/** 放出の弾（長銃の満ちた 1 発）。units は使った戦意 */
export interface ShotRelease {
  units: number;
  mul: ReleaseMul;
  finisher: boolean;
  crit: boolean;
}

export function createMorale(): MoraleState {
  return { value: 0, sinceGain: 0, window: 0, primed: false, full: false, swingUnits: 0 };
}

/** 武器種を持ち替えたら戦意を捨てる（型が違えば単位も違う。同じ型でも持ち替えで溜めを持ち越させない） */
export function resetMorale(p: Player): void {
  p.morale = createMorale();
}

/** 装備の武器種の定義（旧形式の stats でも落ちないよう剣へ） */
function equippedMoveset(state: GameState): MovesetDef {
  return MOVESETS[state.stats.moveset] ?? MOVESETS.sword;
}

/** 今の武器の型 */
export function currentForm(state: GameState): FormDef {
  return formOfKey(equippedMoveset(state).key);
}

function hasGain(form: FormDef, kind: MoraleGain["kind"]): boolean {
  return form.morale.gain.some((g) => g.kind === kind);
}

/** 戦意の上限。溜め（導出）は武器種の溜めの段数で頭打ち */
export function moraleMax(state: GameState): number {
  const form = currentForm(state);
  const max = form.morale.numbers.max + state.stats.moraleMaxAdd;
  if (!hasGain(form, "chargeLevel")) return max;
  return Math.min(max, meleeChargeOf(equippedMoveset(state))?.levels.length ?? 0);
}

/** 放出になる最低の戦意（上限で頭打ち） */
export function moraleReleaseMin(state: GameState): number {
  return Math.min(currentForm(state).morale.numbers.releaseMin, moraleMax(state));
}

/** HUD の材料（render/moraleHud.ts が読む）。ready = 放出の段を振れば放出になる */
export interface MoraleGauge {
  label: string;
  value: number;
  max: number;
  ready: boolean;
  /** 溜まる出来事を持つ型か（骨の型は描かない） */
  active: boolean;
}

export function moraleGauge(state: GameState): MoraleGauge {
  const form = currentForm(state);
  const m = state.player.morale;
  const max = moraleMax(state);
  const ready = max > 0 && m.value >= moraleReleaseMin(state);
  return { label: form.morale.label, value: m.value, max, ready, active: form.morale.gain.length > 0 };
}

/** 溜まる出来事 1 回の量（型が同じ出来事を複数持てば足す）。導出の出来事は 0 */
function gainAmountOf(form: FormDef, kind: MoraleGain["kind"]): number {
  let sum = 0;
  for (const g of form.morale.gain) {
    if (g.kind !== kind) continue;
    if ("amount" in g) sum += g.amount;
    if ("perDamage" in g) sum += g.perDamage;
    if ("perSec" in g) sum += g.perSec;
  }
  return sum;
}

/** 戦意を足す（上限で止め、冷めの秒を 0 に戻す） */
function addMorale(state: GameState, amount: number): void {
  if (amount <= 0) return;
  const m = state.player.morale;
  m.value = Math.min(moraleMax(state), m.value + amount);
  m.sinceGain = 0;
}

/**
 * 出来事で戦意を溜める（各フックから 1 行）。scale は出来事の量（受けたダメージ・秒）を掛けるときに渡す。
 * 型がその出来事を持たなければ何もしない。導出の型は溜め込まない
 */
export function gainMorale(state: GameState, kind: MoraleGain["kind"], scale = 1): void {
  const form = currentForm(state);
  if (form.morale.derived) return;
  addMorale(state, gainAmountOf(form, kind) * scale * state.stats.moraleGainMul);
}

/**
 * 毎ステップの戦意（player.ts の updatePlayer から moments.ts 経由で呼ぶ）。窓・冷め・止まっている秒・導出の値を進め、
 * 満ちた瞬間（前ステップは満ちていない）なら true（充溢）
 */
export function tickMorale(state: GameState, input: FrameInput, dt: number): boolean {
  const m = state.player.morale;
  const form = currentForm(state);
  m.window = Math.max(0, m.window - dt);
  m.sinceGain += dt;
  if (form.morale.derived) m.value = derivedValue(state, form);
  else {
    tickStill(state, form, input, dt);
    tickDecay(m, form, dt);
  }
  const max = moraleMax(state);
  m.value = Math.min(m.value, max);
  const full = max > 0 && m.value >= max;
  const brimmed = full && !m.full;
  m.full = full;
  updatePrimed(state, form, full);
  return brimmed;
}

/** 導出の値。溜めの段は溜めている間だけ（離した振りの放出は振りの開始で段から数える） */
function derivedValue(state: GameState, form: FormDef): number {
  if (!hasGain(form, "chargeLevel")) return 0;
  const a = state.player.attack;
  const charge = meleeChargeOf(equippedMoveset(state));
  if (!a.charging || !charge) return 0;
  return chargeLevelAt(charge.levels, a.chargeTime);
}

/** 止まっている秒（長銃の狙い）。動く・ダッシュすると lossPerSec で減る */
function tickStill(state: GameState, form: FormDef, input: FrameInput, dt: number): void {
  const still = form.morale.gain.find((g): g is Extract<MoraleGain, { kind: "still" }> => g.kind === "still");
  if (!still) return;
  const p = state.player;
  const moving = !isZero(input.move) || p.dashTimer > 0;
  if (!moving) {
    addMorale(state, still.perSec * dt * state.stats.moraleGainMul);
    return;
  }
  p.morale.value = Math.max(0, p.morale.value - still.lossPerSec * dt);
}

/** 冷め: 最後に溜まってから decayDelaySec を過ぎたら decayPerSec で減る */
function tickDecay(m: MoraleState, form: FormDef, dt: number): void {
  const n = form.morale.numbers;
  if (n.decayPerSec <= 0 || m.sinceGain <= n.decayDelaySec) return;
  m.value = Math.max(0, m.value - n.decayPerSec * dt);
}

/** 満ちた後の最初の一撃が放出の型（長銃）: 満ちたら構え、放出の最低を割ったら解く */
function updatePrimed(state: GameState, form: FormDef, full: boolean): void {
  const m = state.player.morale;
  if (form.morale.release.kind !== "nextPrimary") {
    m.primed = false;
    return;
  }
  m.primed = m.value >= moraleReleaseMin(state) && (m.primed || full);
}

/** この振りが型の放出の段か（戦意の量は見ない） */
function isReleaseSwing(form: FormDef, moveset: MovesetDef, spec: ReleaseSwingSpec, primed: boolean): boolean {
  const release = form.morale.release;
  const branch = spec.branch >= 0 ? moveset.branches[spec.branch] : undefined;
  switch (release.kind) {
    case "laneStep": {
      // 居合（右の溜め）を離した振りも右レーンの段 0 の key で数える
      if (spec.lane !== "secondary" || spec.branch >= 0 || spec.dashStrike) return false;
      const key = moveset.steps2[spec.step]?.key;
      return key !== undefined && release.keys.includes(key);
    }
    case "maxCharge": {
      const levels = meleeChargeOf(moveset)?.levels.length ?? 0;
      return spec.chargeLevel > 0 && spec.chargeLevel === levels;
    }
    case "nextPrimary":
      return primed && !isGun(moveset) && spec.lane === "primary" && spec.branch < 0 && !spec.dashStrike && spec.chargeLevel === 0;
    case "branch":
      return branch !== undefined && branch.sequence.length >= 3;
    case "release":
      return branch?.art === "release";
    case "reload":
      return false;
  }
}

/** 放出で使う戦意（使えなければ 0）。溜めは離した段、他の導出は今の値、溜める型は releaseMin 以上なら消費する */
function spendRelease(state: GameState, form: FormDef, spec: ReleaseSwingSpec): number {
  const m = state.player.morale;
  if (form.morale.release.kind === "maxCharge") return spec.chargeLevel;
  if (form.morale.derived) return m.value >= moraleReleaseMin(state) ? m.value : 0;
  return consume(state);
}

/** 溜めた戦意を使う（consumeUnits、0 ならすべて）。最低に届かなければ 0 */
function consume(state: GameState): number {
  const m = state.player.morale;
  const n = currentForm(state).morale.numbers;
  if (m.value <= 0 || m.value < moraleReleaseMin(state)) return 0;
  const units = n.consumeUnits > 0 ? Math.min(n.consumeUnits, m.value) : m.value;
  m.value -= units;
  m.primed = false;
  // 使って満ちていなくなったので、また満ちれば充溢が出る
  m.full = false;
  return units;
}

/**
 * 振りの開始（player.ts の beginSwing）。放出の段なら戦意を使い、その量を振りの間 swingUnits に持つ。
 * 空振りでも消える（放つ時機を読む）。使った戦意を返す（0 = 放出でない）
 */
export function beginSwingMorale(state: GameState, moveset: MovesetDef, spec: ReleaseSwingSpec): number {
  const m = state.player.morale;
  m.swingUnits = 0;
  const form = currentForm(state);
  if (!isReleaseSwing(form, moveset, spec, m.primed)) return 0;
  m.swingUnits = spendRelease(state, form, spec);
  return m.swingUnits;
}

/** 戦意 units の放出の倍率 */
export function releaseMulOf(perUnit: ReleasePerUnit, units: number): ReleaseMul {
  return {
    damageMul: 1 + perUnit.damageMul * units,
    poiseMul: 1 + perUnit.poiseMul * units,
    reachMul: 1 + perUnit.reachMul * units,
    hitsAdd: Math.floor(perUnit.hitsAdd * units),
    knockbackMul: 1 + perUnit.knockbackMul * units,
    pierceAdd: Math.floor(perUnit.pierceAdd * units),
  };
}

/** 今の振りの放出の倍率（放出でなければ undefined）。meleeStep の呼び出しが渡す */
export function swingReleaseMul(state: GameState): ReleaseMul | undefined {
  const units = state.player.morale.swingUnits;
  if (units <= 0) return undefined;
  return releaseMulOf(currentForm(state).morale.numbers.perUnit, units);
}

/** 放出の一撃が終撃になる型か */
export function releaseIsFinisher(state: GameState): boolean {
  return currentForm(state).finisher.includes("release");
}

/**
 * 左の射撃 1 回（player.ts の fireVolley）。満ちた後の 1 発が放出の型（長銃）で構えていれば戦意をすべて使い、弾の倍率を返す。
 * 放出でなければ undefined
 */
export function consumeShotRelease(state: GameState): ShotRelease | undefined {
  const form = currentForm(state);
  const m = state.player.morale;
  if (form.morale.release.kind !== "nextPrimary" || !m.primed) return undefined;
  const units = consume(state);
  if (units <= 0) return undefined;
  const n = form.morale.numbers;
  return { units, mul: releaseMulOf(n.perUnit, units), finisher: form.finisher.includes("release"), crit: n.releaseCrit };
}

/** 重打の溜め中の堅さ（combat.ts の damagePlayer が被ダメと押しに掛ける）。溜めていなければ undefined */
export function chargeArmorOf(state: GameState): { damageTakenMul: number; noKnock: boolean } | undefined {
  if (!state.player.attack.charging || currentForm(state).key !== "crusher") return undefined;
  return FORM.crusher.chargeArmor;
}
