import type { FrameInput } from "../core/input";
import type { GameState, Player, Projectile } from "../core/state";
import { isZero } from "../core/vec";
import { FORM } from "../data/tuning";
import { type FormDef, type MoraleGain, type PowderLevel, type ReleasePerUnit, PISTOL_PRIMED, formOfKey, powderLevelOf } from "../data/weaponForms";
import { type ButtonKey, type MovesetDef, MOVESETS, chargeLevelAt, meleeChargeOf, shootsPrimary } from "../data/weapons";
import { BULLETS } from "../loot/bullets";
import { hasReach } from "../loot/reach";
import { gatherLinked, linkedCount, woundPeak } from "./formMarks";
import { reforgedForm } from "../data/reforges";
import { movingAimGainMul, tickReforges } from "./reforge";

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
  /** 装薬の詰めの段の放出（粒・威力・反動）。装薬でなければ無い */
  powder?: PowderLevel;
}

/** 左の射撃 1 回の材料（player.ts の fireVolley が渡す。弾倉は撃つ前の値） */
export interface ShotTrigger {
  /** 溜め撃ちの段（溜めない器は 0） */
  level: number;
  /** 器の溜めの段数（溜めない器は 0） */
  chargeLevels: number;
  /** リロード後の 1 発目か（撃つ前の magazine.fresh） */
  fresh: boolean;
}

/** 短銃の強装填の弾倉の 1 発（全弾の倍率と、1 発目なら放出の弾の印） */
export interface PrimedShot {
  damageMul: number;
  poiseMul: number;
  /** 強装填の弾倉の 1 発目（放出の弾。終撃） */
  first: boolean;
  finisher: boolean;
}

export function createMorale(): MoraleState {
  return { value: 0, sinceGain: 0, primed: false, full: false, swingUnits: 0 };
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
  // 改鋳の戦意の上書き（上限・冷め・放出の上乗せ）を畳む（data/reforges.ts）
  return reforgedForm(formOfKey(equippedMoveset(state).key), state.reforges);
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
  return { label: moraleLabelOf(equippedMoveset(state), form), value: m.value, max, ready, active: form.morale.gain.length > 0 };
}

/** 戦意のゲージの名。武器種の言い換え（棍の「棒先」）があればそれ、無ければ型の名 */
export function moraleLabelOf(moveset: Pick<MovesetDef, "moraleLabel">, form: FormDef): string {
  return moveset.moraleLabel ?? form.morale.label;
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
 * 量で戦意を足す（Rule の gainMorale。型の出来事の量・溜まりの倍 moraleGainMul は掛けない）。
 * 導出の型（溜め・傷・鎖…）は毎ステップ値を作り直すので足しても残らない。足さずに捨てる
 */
export function addMoraleAmount(state: GameState, amount: number): void {
  if (currentForm(state).morale.derived) return;
  addMorale(state, amount);
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
  // 改鋳の挙動（込めの最中のダッシュ・設置弾の這い寄り。system/reforge.ts）
  tickReforges(state);
  const m = state.player.morale;
  const form = currentForm(state);
  m.sinceGain += dt;
  if (form.morale.derived) m.value = derivedValue(state, form);
  else {
    tickStill(state, form, input, dt);
    if (!hasReach(state.stats, "morale")) tickDecay(m, form, dt);
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
  // 刃斧は近くの敵の傷の最大スタック、鎖は繋いだ敵の数（system/formMarks.ts）
  if (hasGain(form, "applyStatus")) return Math.min(woundPeak(state), moraleMax(state));
  if (hasGain(form, "pullHit")) return Math.min(linkedCount(state), moraleMax(state));
  // 杖の術式は連撃の入力数、投具は飛んでいる自分の弾の数（どちらも上限で頭打ち）
  if (hasGain(form, "cast")) return Math.min(state.player.attack.inputs.length, moraleMax(state));
  if (hasGain(form, "flyingShots")) return Math.min(flyingShotCount(state), moraleMax(state));
  if (hasGain(form, "placedShots")) return Math.min(placedShotCount(state), moraleMax(state));
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
  // 改鋳「騎射」は動いても減らず、倍率ぶんの速さで溜まる
  const gainMul = moving ? movingAimGainMul(state) : 1;
  if (gainMul > 0) {
    addMorale(state, still.perSec * dt * state.stats.moraleGainMul * gainMul);
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
      // 近接（長柄）は満ちた後の最初の「突き」の段だけ（薙ぎ・回しでは穂先を放たない）
      return primed && !shootsPrimary(moveset) && spec.lane === "primary" && spec.branch < 0 && !spec.dashStrike && spec.chargeLevel === 0 && moveset.steps[spec.step]?.shape.kind === "thrust";
    case "nextShot": {
      // 装薬の零距離砲（右レーンの段）。左の次の 1 発は fireVolley の consumeShotRelease が扱う
      if (spec.lane !== "secondary" || spec.branch >= 0 || spec.dashStrike) return false;
      const key = moveset.steps2[spec.step]?.key;
      return key !== undefined && release.keys.includes(key);
    }
    case "nextMagazine":
      // 短銃の強装填は弾倉が担う（振りは放出にならない）
      return false;
    case "branch":
      return branch !== undefined && branch.sequence.length >= 3;
    case "release":
      return branch?.art === "release";
    case "bothHands":
      // 撃ち尽くしは振りではなく左右の同時押し（system/dualPistols.ts の consumeBothHandsRelease）
      return false;
  }
}

/** 放出で使う戦意（使えなければ 0）。溜めは離した段、他の導出は今の値、溜める型は releaseMin 以上なら消費する */
function spendRelease(state: GameState, form: FormDef, spec: ReleaseSwingSpec): number {
  const m = state.player.morale;
  if (form.morale.release.kind === "maxCharge") return spec.chargeLevel;
  if (form.morale.derived) {
    // 砲は振りの瞬間の床の弾を数え直す（毎ステップの値は 1 ステップ古い）
    const now = hasGain(form, "placedShots") ? derivedValue(state, form) : m.value;
    return now >= moraleReleaseMin(state) ? now : 0;
  }
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
  // 装薬は詰めを使い切る（零距離砲で放っても弾倉の詰めの段が残って詰め直せなくならないように。撃てば spendRounds も 0 に戻す）
  if (currentForm(state).morale.release.kind === "nextShot") state.player.magazine.packSec = 0;
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
  m.swingUnits = form.morale.release.kind === "branch" ? branchUnits(state, moveset, spec) : spendRelease(state, form, spec);
  // 鎖の束ね打ちは振り始めに繋いだ敵を前へ寄せる（放出の繋ぎを使い切る）
  if (m.swingUnits > 0 && hasGain(form, "pullHit")) gatherLinked(state);
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

/** 型の戦意 units の放出の倍率。装薬は詰めの段の表（FORM.powder.levels）で威力と怯み値を引く（段ごとの倍率が線形でない） */
function formReleaseMul(form: FormDef, units: number): ReleaseMul {
  const base = releaseMulOf(form.morale.numbers.perUnit, units);
  const powder = form.morale.release.kind === "nextShot" ? powderLevelOf(units) : undefined;
  if (!powder) return base;
  return { ...base, damageMul: base.damageMul * powder.damageMul, poiseMul: base.poiseMul * powder.damageMul };
}

/** 今の振りの放出の倍率（放出でなければ undefined）。meleeStep の呼び出しが渡す */
export function swingReleaseMul(state: GameState): ReleaseMul | undefined {
  const units = state.player.morale.swingUnits;
  if (units <= 0) return undefined;
  return formReleaseMul(currentForm(state), units);
}

/** 放出の一撃が終撃になる型か */
export function releaseIsFinisher(state: GameState): boolean {
  return currentForm(state).finisher.includes("release");
}

/**
 * 長銃の関門（docs/ideas/gun-bases-review.md 0-4・4-3 の 9）: 溜めの器は最大段の発射だけ、溜めでない器はリロード後の 1 発目だけが放出。
 * 満ちていること（primed）は呼び出し側が見る
 */
function passesRifleGate(trigger: ShotTrigger): boolean {
  if (trigger.chargeLevels > 0) return trigger.level >= trigger.chargeLevels;
  return trigger.fresh;
}

/**
 * 左の射撃 1 回（player.ts の fireVolley）。放出の 1 発なら戦意を使い、弾の倍率を返す。放出でなければ undefined。
 * 長銃は満ちて構えていて関門を通る 1 発、装薬は詰めがあれば次の 1 発（詰めの段の粒・威力・反動）
 */
export function consumeShotRelease(state: GameState, trigger: ShotTrigger): ShotRelease | undefined {
  const form = currentForm(state);
  const release = form.morale.release;
  const m = state.player.morale;
  if (release.kind === "nextPrimary") {
    if (!m.primed || (release.gate === "rifle" && !passesRifleGate(trigger))) return undefined;
  } else if (release.kind !== "nextShot") return undefined;
  const units = consume(state);
  if (units <= 0) return undefined;
  return shotReleaseOf(form, units);
}

/**
 * 短銃の強装填（release nextMagazine）: 戦意が満ちていて、弾倉がリロード後の 1 発目を残している（込め終えたまま撃っていない）なら、
 * 戦意を使ってその弾倉を強装填にする。使った戦意を返す（0 = 強装填にしていない）。
 * 早込めで満ちた瞬間（同じステップの射撃より前）と毎ステップの両方から呼ぶ（system/moments.ts）
 */
export function primeMagazine(state: GameState, fresh: boolean): number {
  const form = currentForm(state);
  const mag = state.player.magazine;
  if (form.morale.release.kind !== "nextMagazine" || mag.primed || mag.bulletKey === "" || !fresh) return 0;
  if (mag.hands[0].reloadLeft > 0) return 0;
  const units = consume(state);
  if (units > 0) mag.primed = true;
  return units;
}

/** 強装填は込め直しまで（込めを始めた弾倉は新しい弾倉。system/moments.ts の tickFormState が毎ステップ） */
export function expirePrimedMagazine(state: GameState): void {
  const mag = state.player.magazine;
  if (mag.primed && mag.hands[0].reloadLeft > 0) mag.primed = false;
}

/** 強装填の弾倉から撃つ 1 発の倍率（強装填でなければ undefined）。fresh は撃つ前の magazine.fresh（弾倉の 1 発目） */
export function primedShotOf(state: GameState, fresh: boolean): PrimedShot | undefined {
  if (!state.player.magazine.primed || currentForm(state).morale.release.kind !== "nextMagazine") return undefined;
  return { damageMul: PISTOL_PRIMED.damageMul, poiseMul: PISTOL_PRIMED.poiseMul, first: fresh, finisher: releaseIsFinisher(state) };
}

/**
 * 戦意を 0 へ途切れさせる（二丁の拍: 同じ手が続いた。system/dualPistols.ts）。今の型が kind の出来事で溜まる型のときだけ
 */
export function breakMoraleStreak(state: GameState, kind: MoraleGain["kind"]): void {
  if (!hasGain(currentForm(state), kind)) return;
  const m = state.player.morale;
  m.value = 0;
  m.full = false;
  m.primed = false;
}

/**
 * 撃ち尽くし（二丁拳銃の左右の同時押し。system/dualPistols.ts）。放出が bothHands の型なら溜めた戦意をすべて使い、
 * その量の倍率を返す（0 でも撃てるので units 0・倍率 1 で返す）。型が違えば undefined
 */
export function consumeBothHandsRelease(state: GameState): ShotRelease | undefined {
  const form = currentForm(state);
  if (form.morale.release.kind !== "bothHands") return undefined;
  return shotReleaseOf(form, consume(state));
}

/** 重打の溜め中の堅さ（combat.ts の damagePlayer が被ダメと押しに掛ける）。溜めていなければ undefined */
export function chargeArmorOf(state: GameState): { damageTakenMul: number; noKnock: boolean } | undefined {
  if (!state.player.attack.charging || currentForm(state).key !== "crusher") return undefined;
  return FORM.crusher.chargeArmor;
}

// ---------------------------------------------------------------------------
// 砲の置いた弾
// ---------------------------------------------------------------------------

/** 床に置いた自分の弾（設置弾・曲射弾）で、まだ炸裂していないもの（砲の置いた弾。起爆の対象） */
export function isPlacedShot(pr: Projectile): boolean {
  if (pr.owner !== "player" || pr.life <= 0 || !pr.shot || pr.shot.detonated) return false;
  const def = BULLETS[pr.shot.key];
  return def !== undefined && (def.mine !== undefined || def.lob !== undefined);
}

export function placedShotCount(state: GameState): number {
  return state.projectiles.reduce((n, pr) => n + (isPlacedShot(pr) ? 1 : 0), 0);
}

// ---------------------------------------------------------------------------
// 盾・扇・杖・投具（5b-D2）
// ---------------------------------------------------------------------------

/** 3 手の派生（杖）が放出のときの単位。手数（派生の入力の長さ）が術式で、上限で頭打ち。届かなければ 0 */
function branchUnits(state: GameState, moveset: MovesetDef, spec: ReleaseSwingSpec): number {
  const hands = moveset.branches[spec.branch]?.sequence.length ?? 0;
  const units = Math.min(hands, moraleMax(state));
  return units >= moraleReleaseMin(state) ? units : 0;
}

/** 飛んでいる自分の武器の弾か（床に据えた設置弾・山なりの曲射は飛んでいるとは数えない） */
function isFlyingShot(pr: Projectile): boolean {
  if (pr.owner !== "player" || pr.life <= 0 || pr.lane === undefined) return false;
  const def = pr.shot ? BULLETS[pr.shot.key] : undefined;
  return def === undefined || (def.mine === undefined && def.lob === undefined);
}

/** 投具の戦意: 飛んでいる自分の武器の弾（戻る弾・周回弾・投げた弾）の数 */
function flyingShotCount(state: GameState): number {
  return state.projectiles.reduce((n, pr) => n + (isFlyingShot(pr) ? 1 : 0), 0);
}

/**
 * 右レーンの弾を出す段・手元返しが放出か（投具。振りの段は beginSwing が判定する）。
 * 飛んでいる弾の数を単位に、今から出す弾（戻す弾）への倍率を返す。放出でなければ undefined。導出の型なので消費しない
 */
export function laneStepRelease(state: GameState, key: string | undefined): ShotRelease | undefined {
  const form = currentForm(state);
  const release = form.morale.release;
  if (key === undefined || release.kind !== "laneStep" || !release.keys.includes(key) || !hasGain(form, "flyingShots")) return undefined;
  const units = derivedValue(state, form);
  if (units <= 0 || units < moraleReleaseMin(state)) return undefined;
  return shotReleaseOf(form, units);
}

/** 今の振りが放出のとき、その振りが撃つ弾（杖の詠唱の魔弾）に写す倍率。放出の振りでなければ undefined */
export function swingShotRelease(state: GameState): ShotRelease | undefined {
  const units = state.player.morale.swingUnits;
  if (units <= 0) return undefined;
  return shotReleaseOf(currentForm(state), units);
}

function shotReleaseOf(form: FormDef, units: number): ShotRelease {
  const n = form.morale.numbers;
  const powder = form.morale.release.kind === "nextShot" ? powderLevelOf(units) : undefined;
  return { units, mul: formReleaseMul(form, units), finisher: form.finisher.includes("release"), crit: n.releaseCrit, ...(powder ? { powder } : {}) };
}

/** 自分の炸裂（system/projectiles.ts の detonateMine）。敵を 1 体以上巻き込んだ炸裂だけ擲弾の戦意「炸裂」を溜める（空撃ちでは溜まらない） */
export function noteBlast(state: GameState, hits: number): void {
  if (hits <= 0) return;
  gainMorale(state, "blastHit");
}

/** 扇の突風（放出の振り）の間、地形を広げる半径に足す量。風 1 あたり spreadRadiusPerUnit。突風でなければ 0 */
export function releaseTerrainRadiusBonus(state: GameState): number {
  const units = state.player.morale.swingUnits;
  if (units <= 0 || state.player.attack.phase === "none" || currentForm(state).key !== "warfan") return 0;
  return FORM.warfan.spreadRadiusPerUnit * units;
}
