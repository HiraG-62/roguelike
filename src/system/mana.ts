import type { GameState } from "../core/state";
import { ENEMY_AI, MANA } from "../data/tuning";
import { hasStatus } from "./statusEffects";
import { SKILL } from "../skills/data";
import { manaRegenAllowed } from "./keystones";
import { spillManaOverflow, traitManaGainMul } from "./traitHooks";

/**
 * マナ（スキルの資源）。docs/COMBAT_DESIGN.md B-1。
 * 通常攻撃の命中・ジャスト回避・撃破で溜まり、スキルで減る。上限は stats.maxMana
 */

/**
 * 回収する。manaGainMul を掛け、後払いの返済残があれば先にそちらへ充て、上限で止める。実際に増えた量を返す
 */
export function gainMana(state: GameState, amount: number): number {
  if (amount <= 0 || state.status === "dead") return 0;
  return addMana(state, amount * state.stats.manaGainMul * traitManaGainMul(state));
}

/**
 * 通常攻撃（近接・ダッシュ攻撃・射撃）の命中の回収。mul は呼び出し側の誓約 × 祝福の倍率。
 * 性質「底打ち」と合わせた積を MANA.attackGainMulMax で止める。後払いの返済残がある間は owedAttackManaMul（0）
 */
export function gainAttackMana(state: GameState, base: number, mul: number): number {
  if (base <= 0 || state.status === "dead") return 0;
  const owed = state.skills.debtOwed > 0 ? SKILL.modifier.deferred.owedAttackManaMul : 1;
  // 沈黙中はスキルを撃てない代わりに、通常攻撃で溜める量が増える（docs/ideas/enemies.md H8。上限の外で掛ける）
  const silenced = hasStatus(state.player.status, "silence") ? ENEMY_AI.silencedAttackManaMul : 1;
  const total = Math.min(MANA.attackGainMulMax, mul * traitManaGainMul(state)) * owed * silenced;
  if (total <= 0) return 0;
  return addMana(state, base * total * state.stats.manaGainMul);
}

/** 返済残へ先に充ててから足し、上限で溢れた分を必殺ゲージへ移す */
function addMana(state: GameState, raw: number): number {
  const p = state.player;
  const before = p.mana;
  const left = repayDebt(state, raw);
  p.mana = Math.min(state.stats.maxMana, p.mana + left);
  spillManaOverflow(state, before + left - p.mana);
  return Math.max(0, p.mana - before);
}

/** 後払いの返済残を回収から差し引き、残りを返す */
function repayDebt(state: GameState, raw: number): number {
  const rs = state.skills;
  if (rs.debtOwed <= 0) return raw;
  const paid = Math.min(rs.debtOwed, raw);
  rs.debtOwed -= paid;
  return raw - paid;
}

/** コストを払えるか */
export function canAfford(state: GameState, cost: number): boolean {
  return state.player.mana >= cost;
}

/** 払えれば払って true。足りなければ何も減らさず false（不発） */
export function spendMana(state: GameState, cost: number): boolean {
  if (cost <= 0) return true;
  if (!canAfford(state, cost)) return false;
  state.player.mana -= cost;
  return true;
}

/**
 * 自然回復。戦っていない間（封鎖中でなく、MANA.combatRadius 内に生きた敵がいない）は待ち時間を作らないよう速める。
 * 開放型フロアでは封鎖がほぼ無いので「近くに敵がいるか」で戦闘中を判定する
 */
export function tickMana(state: GameState, dt: number): void {
  if (state.status === "dead") return;
  // 渇きの誓約は自然回復そのものを止める（精神の派生ぶんも含めて）
  if (!manaRegenAllowed(state)) return;
  const p = state.player;
  const max = state.stats.maxMana;
  if (p.mana >= max) return;
  const pos = p.body.pos;
  const r2 = MANA.combatRadius * MANA.combatRadius;
  const fighting =
    state.rooms.some((r) => r.locked) || state.enemies.some((e) => e.hp > 0 && (e.body.pos.x - pos.x) ** 2 + (e.body.pos.y - pos.y) ** 2 <= r2);
  // 後払いの返済残がある間は自然回復しない（owedRegenMul）
  const owed = state.skills.debtOwed > 0 ? SKILL.modifier.deferred.owedRegenMul : 1;
  const rate = state.stats.manaRegen * (fighting ? 1 : MANA.idleRegenMul) * owed;
  p.mana = Math.min(max, p.mana + rate * dt);
}

/** ラン開始で満タンにする（MANA.startFull が false なら何もしない） */
export function refillMana(state: GameState): void {
  if (!MANA.startFull) return;
  state.player.mana = state.stats.maxMana;
}

/**
 * 階層到達の補給。最大の MANA.descendRefill まで戻すだけで、既に上回っていれば減らさない
 * （階段を満タン補給所にすると道中のやりくりが意味を失うため）
 */
export function descendMana(state: GameState): void {
  const floor = state.stats.maxMana * MANA.descendRefill;
  if (state.player.mana >= floor) return;
  state.player.mana = floor;
}
