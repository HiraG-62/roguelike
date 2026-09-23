import type { DamageKind, Enemy, GameState } from "../core/state";
import type { StatusBag, StatusKind } from "../core/status";
import { enemyDef } from "../data/enemies";
import { KEYSTONE, POISE, TRIGGER } from "../data/tuning";
import { recordProvenance } from "../loot/provenance";
import { gainEnergy, healPlayer, isLastKillInLockedRoom } from "./combat";
import { addFloatingText, spawnRing } from "./effects";
import { KS, hasKeystone } from "./keystones";
import { gainMana } from "./mana";
import { addPoise, isStaggered, poiseRatio } from "./poise";
import { applyStatus, enemiesInRadius, hasStatus } from "./statusEffects";
import { fireTrigger } from "./triggers";

/**
 * 装備の性質（docs/ideas/loot-expansion.md）が持ち込むルール変更の読み取り口。
 * 数値は state.stats.traits（loot/types.ts の TraitStats）と誓約（stats.keystones）から読む。
 * combat.ts / player.ts / mana.ts からは 1 行の呼び出しだけで済むよう、判断はすべてここに置く
 */

/** 「状態異常の種類数」に数えないもの（怯み値の系統と、プレイヤーのバフ） */
const NOT_AN_AFFLICTION: ReadonlySet<StatusKind> = new Set<StatusKind>([
  "stagger",
  "guarded",
  "haste",
  "harden",
  "wrath",
  "fury",
  "charged",
]);
const SHIELD_TEXT = "身代わり";
const SHIELD_TEXT_SCALE = 0.9;
const SHIELD_TEXT_LIFE = 0.5;

/** 付いている状態異常の種類数（バフと怯み・堅守を除く） */
export function afflictionKinds(bag: Readonly<StatusBag>): number {
  const kinds = new Set<StatusKind>();
  for (const effect of bag.effects) {
    if (effect.time > 0 && !NOT_AN_AFFLICTION.has(effect.kind)) kinds.add(effect.kind);
  }
  return kinds.size;
}

/** 付いている状態異常（1 種 1 つ。バフと怯み・堅守を除く） */
export function afflictionList(bag: Readonly<StatusBag>): StatusKind[] {
  const kinds: StatusKind[] = [];
  for (const effect of bag.effects) {
    if (effect.time > 0 && !NOT_AN_AFFLICTION.has(effect.kind) && !kinds.includes(effect.kind)) kinds.push(effect.kind);
  }
  return kinds;
}

// ---------------------------------------------------------------------------
// 与ダメージ（combat.ts の rollOutgoing から）
// ---------------------------------------------------------------------------

/**
 * 対象と場に応じた加算（性質）。全ヒットで呼ばれるので、性質が 0 の項目は状態を調べない
 * （QA のヘッドレス周回の速度を落とさない）
 */
function targetBonus(state: GameState, enemy: Enemy): number {
  const t = state.stats.traits;
  let bonus = 0;
  if (t.damagePerStatusKind !== 0) bonus += afflictionKinds(enemy.status) * t.damagePerStatusKind;
  if (t.windupDamageMul !== 0 || t.offWindupPenalty !== 0) {
    bonus += enemy.phase === "windup" ? t.windupDamageMul : -t.offWindupPenalty;
  }
  if (t.guardedDamageMul !== 0 && hasStatus(enemy.status, "guarded")) bonus += t.guardedDamageMul;
  if (t.bossDamageMul !== 0 || t.nonBossPenalty !== 0) {
    bonus += enemyDef(enemy.defKey).boss === true ? t.bossDamageMul : -t.nonBossPenalty;
  }
  return bonus;
}

function fieldBonus(state: GameState, kind: DamageKind): number {
  const t = state.stats.traits;
  let bonus = 0;
  if (t.damagePerSelfStatus !== 0) bonus += afflictionKinds(state.player.status) * t.damagePerSelfStatus;
  if (t.lockedDamageMul !== 0 || t.unlockedPenalty !== 0) {
    bonus += state.rooms.some((r) => r.locked) ? t.lockedDamageMul : -t.unlockedPenalty;
  }
  if (kind === "ranged" && (t.darkRangedMul !== 0 || t.lightRangedPenalty !== 0)) {
    bonus += state.floorKind === "dark" ? t.darkRangedMul : -t.lightRangedPenalty;
  }
  if (t.reaperDamageMul !== 0 && state.reaper !== null) bonus += t.reaperDamageMul;
  return bonus;
}

function skillBonus(state: GameState): number {
  const t = state.stats.traits;
  const max = state.stats.maxMana;
  if (max <= 0 || (t.fullManaSkillMul === 0 && t.lowManaSkillMul === 0)) return 0;
  const ratio = Math.min(1, state.player.mana / max);
  const full = ratio >= 1 ? t.fullManaSkillMul : 0;
  return full + t.lowManaSkillMul * (1 - ratio);
}

/** 誓約の掛け算（楔・読み勝ち・背水・死神） */
function keystoneOutgoingMul(state: GameState, enemy: Enemy | null, kind: DamageKind): number {
  if (state.stats.keystones.length === 0) return 1;
  let mul = 1;
  if (enemy !== null && hasKeystone(state, KS.wedgeOath) && !isStaggered(enemy)) mul *= KEYSTONE.wedgeUnstaggeredMul;
  if (enemy !== null && kind === "melee" && hasKeystone(state, KS.readOath) && enemy.phase !== "windup") {
    mul *= KEYSTONE.readOffWindupDamageMul;
  }
  if (hasKeystone(state, KS.backwater) && state.rooms.some((r) => r.locked)) mul *= KEYSTONE.backwaterDamageMul;
  if (hasKeystone(state, KS.reaperOath)) {
    mul *= state.reaper === null ? KEYSTONE.reaperOathDamageMul : KEYSTONE.reaperOathHuntedMul;
  }
  return mul;
}

/**
 * 性質・誓約による与ダメージ倍率。proc（燃焼・トリガーの衝撃波など）には掛けない
 * （既存の会心・コンボと同じ扱い）
 */
export function traitOutgoingMul(state: GameState, enemy: Enemy | null, kind: DamageKind, skill: boolean): number {
  if (kind === "proc") return 1;
  let bonus = fieldBonus(state, kind);
  if (enemy !== null) bonus += targetBonus(state, enemy);
  if (skill) bonus += skillBonus(state);
  const mul = Math.max(TRIGGER.trait.minMul, 1 + bonus);
  return mul * keystoneOutgoingMul(state, enemy, kind);
}

// ---------------------------------------------------------------------------
// 怯み値（combat.ts の damageEnemy から）
// ---------------------------------------------------------------------------

function poiseBonus(state: GameState, enemy: Enemy, kind: DamageKind, crit: boolean): number {
  const t = state.stats.traits;
  let bonus = 0;
  if (t.fearPoiseMul !== 0 && hasStatus(enemy.status, "fear")) bonus += t.fearPoiseMul;
  if (t.silencedPoiseMul !== 0 && hasStatus(enemy.status, "silence")) bonus += t.silencedPoiseMul;
  if (t.vulnerablePoiseMul !== 0 && hasStatus(enemy.status, "vulnerable")) bonus += t.vulnerablePoiseMul;
  if (t.guardedPoiseMul !== 0 && hasStatus(enemy.status, "guarded")) bonus += t.guardedPoiseMul;
  if (t.wedgePoiseMul !== 0 || t.wedgePenalty !== 0) {
    bonus += poiseRatio(enemy) >= TRIGGER.trait.wedgeRatio ? t.wedgePoiseMul : -t.wedgePenalty;
  }
  if (kind === "ranged") bonus += t.rangedPoiseMul;
  if (crit) bonus += t.critPoiseMul;
  return bonus;
}

/** 堅守の半減を打ち消す倍率。ratio = 1 で堅守が無いのと同じになる */
function guardCompensation(enemy: Enemy, ratio: number): number {
  if (ratio <= 0 || !hasStatus(enemy.status, "guarded")) return 1;
  const guarded = enemyDef(enemy.defKey).boss === true ? POISE.bossGuardedMul : POISE.guardedMul;
  return 1 + (1 / guarded - 1) * Math.min(1, ratio);
}

function keystonePoiseMul(state: GameState, enemy: Enemy, kind: DamageKind): number {
  if (state.stats.keystones.length === 0) return 1;
  if (hasKeystone(state, KS.unshaken)) return 0;
  let mul = 1;
  if (hasKeystone(state, KS.chokehold)) mul *= guardCompensation(enemy, 1);
  if (kind === "melee" && hasKeystone(state, KS.readOath)) mul *= enemy.phase === "windup" ? KEYSTONE.readPoiseMul : 0;
  return mul;
}

/** 性質・誓約による怯み値の倍率（剥がし撃ちは堅守の半減を射撃だけ打ち消す） */
export function traitPoiseMul(state: GameState, enemy: Enemy, kind: DamageKind, crit: boolean): number {
  const base = Math.max(TRIGGER.trait.minMul, 1 + poiseBonus(state, enemy, kind, crit));
  const pierce = kind === "ranged" ? guardCompensation(enemy, state.stats.traits.guardPierce) : 1;
  return base * pierce * keystonePoiseMul(state, enemy, kind);
}

// ---------------------------------------------------------------------------
// 出来事（怯ませた / 撃破 / カウンター）
// ---------------------------------------------------------------------------

/** 崩れの反響: 周囲の敵にも怯み値。ここで怯んだ敵からは連鎖させない */
function staggerQuake(state: GameState, enemy: Enemy, amount: number): void {
  if (amount <= 0) return;
  spawnRing(state, enemy.body.pos, TRIGGER.trait.staggerQuakeRadius, TRIGGER.shockwaveColor, TRIGGER.icd);
  for (const other of enemiesInRadius(state, enemy.body.pos, TRIGGER.trait.staggerQuakeRadius)) {
    if (other.id !== enemy.id) addPoise(state, other, amount);
  }
}

/** 敵を怯ませた瞬間（combat.ts の damageEnemy で怯み値が耐性を超えたとき） */
export function onTraitStagger(state: GameState, enemy: Enemy): void {
  const t = state.stats.traits;
  if (t.manaOnStagger > 0) gainMana(state, t.manaOnStagger);
  if (t.healOnStagger > 0) healPlayer(state, t.healOnStagger);
  staggerQuake(state, enemy, t.staggerQuake);
  fireTrigger(state, "onStagger", { pos: { ...enemy.body.pos }, targetId: enemy.id });
  recordProvenance(state, { kind: "stagger" });
}

/** 病みの誓い: 死んだ敵の状態異常を周囲の敵へ移す（残り秒と効果量はそのまま） */
function spreadAfflictions(state: GameState, enemy: Enemy): void {
  const effects = enemy.status.effects.filter((e) => e.time > 0 && !NOT_AN_AFFLICTION.has(e.kind));
  if (effects.length === 0) return;
  for (const other of enemiesInRadius(state, enemy.body.pos, KEYSTONE.contagionRadius)) {
    if (other.id === enemy.id) continue;
    for (const e of effects) {
      applyStatus(state, { kind: "enemy", enemy: other }, { kind: e.kind, stacks: e.stacks, duration: e.time, potency: e.potency }, "env");
    }
  }
}

/** 殲滅（封鎖中の部屋の最後の 1 体）の性質 */
function onLastKill(state: GameState): void {
  const t = state.stats.traits;
  if (t.lastKillManaRatio > 0) gainMana(state, state.stats.maxMana * t.lastKillManaRatio);
  if (t.lastKillEnergy > 0) gainEnergy(state, t.lastKillEnergy);
  if (t.lastKillClearsBullets > 0) {
    for (const pr of state.projectiles) if (pr.owner === "enemy") pr.life = 0;
  }
  recordProvenance(state, { kind: "lastKill" });
}

/** 敵を倒した瞬間（combat.ts の killEnemy から。敵はまだ配列に残っていて状態異常も読める） */
export function onTraitKill(state: GameState, enemy: Enemy): void {
  const t = state.stats.traits;
  if (t.silencedKillMana > 0 && hasStatus(enemy.status, "silence")) gainMana(state, t.silencedKillMana);
  if (hasKeystone(state, KS.contagion)) spreadAfflictions(state, enemy);
  if (enemy.elite !== undefined) recordProvenance(state, { kind: "eliteKill" });
  if (isLastKillInLockedRoom(state, enemy)) onLastKill(state);
}

/** カウンターが成立した瞬間（player.ts の近接命中から） */
export function onTraitCounter(state: GameState, enemy: Enemy): void {
  fireTrigger(state, "onCounter", { pos: { ...enemy.body.pos }, targetId: enemy.id });
  recordProvenance(state, { kind: "counter" });
}

// ---------------------------------------------------------------------------
// 被ダメージ（combat.ts の damagePlayer から）
// ---------------------------------------------------------------------------

/** 身代わり: マナを払えたら被ダメージを減らす。払えなければ不発（何も減らさない） */
function manaShieldMul(state: GameState): number {
  const cost = state.stats.traits.manaShieldCost;
  const p = state.player;
  if (cost <= 0 || p.mana < cost) return 1;
  p.mana -= cost;
  addFloatingText(state, { x: p.body.pos.x, y: p.body.pos.y - 8 }, SHIELD_TEXT, TRIGGER.trait.manaShieldColor, SHIELD_TEXT_SCALE, SHIELD_TEXT_LIFE);
  return TRIGGER.trait.manaShieldMul;
}

/** 性質による被ダメージ倍率（弱体の盾・身代わり）。身代わりはここでマナを払う */
export function traitIncomingMul(state: GameState, attacker: Enemy | undefined): number {
  const t = state.stats.traits;
  let mul = 1;
  if (attacker !== undefined && (t.weakenedGuard > 0 || t.weakenedExposure > 0)) {
    mul *= hasStatus(attacker.status, "weaken") ? 1 - t.weakenedGuard : 1 + t.weakenedExposure;
  }
  return Math.max(TRIGGER.trait.minMul, mul) * manaShieldMul(state);
}

// ---------------------------------------------------------------------------
// マナ（mana.ts の gainMana から）
// ---------------------------------------------------------------------------

/** 底打ち: マナが少ない間の回収倍率 */
export function traitManaGainMul(state: GameState): number {
  const t = state.stats.traits;
  if (t.lowManaGainMul <= 0) return 1;
  const low = state.player.mana < state.stats.maxMana * TRIGGER.trait.lowManaRatio;
  return low ? 1 + t.lowManaGainMul : 1;
}

/** 溢れ: 満タンで捨てられた回収を必殺ゲージへ移す */
export function spillManaOverflow(state: GameState, overflow: number): void {
  const ratio = state.stats.traits.manaOverflowToEnergy;
  if (ratio <= 0 || overflow <= 0) return;
  gainEnergy(state, overflow * ratio);
}

// ---------------------------------------------------------------------------
// 時間（system/triggers.ts の tickTriggerCooldowns から毎ステップ）
// ---------------------------------------------------------------------------

/** 死神の誓い: 死神の時計（floorTime）を速める。reaper.ts は floorTime だけを見て出現を決める */
export function tickTraitClocks(state: GameState, dt: number): void {
  if (!hasKeystone(state, KS.reaperOath) || state.reaper !== null) return;
  state.floorTime += dt * (KEYSTONE.reaperOathClockMul - 1);
}
