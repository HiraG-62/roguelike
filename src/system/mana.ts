import type { GameState } from "../core/state";
import { MANA } from "../data/tuning";
import { manaRegenAllowed } from "./keystones";
import { spillManaOverflow, traitManaGainMul } from "./traitHooks";

/**
 * マナ（スキルの資源）。docs/COMBAT_DESIGN.md B-1。
 * 通常攻撃の命中・ジャスト回避・撃破で溜まり、スキルで減る。上限は stats.maxMana
 */

/** 回収する。manaGainMul を掛け、上限で止める。実際に増えた量を返す */
export function gainMana(state: GameState, amount: number): number {
  if (amount <= 0 || state.status === "dead") return 0;
  const p = state.player;
  const before = p.mana;
  const raw = amount * state.stats.manaGainMul * traitManaGainMul(state);
  p.mana = Math.min(state.stats.maxMana, p.mana + raw);
  spillManaOverflow(state, before + raw - p.mana);
  return Math.max(0, p.mana - before);
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

/** 自然回復。封鎖されていない部屋・通路では待ち時間を作らないよう速める */
export function tickMana(state: GameState, dt: number): void {
  if (state.status === "dead") return;
  // 渇きの誓約は自然回復そのものを止める（精神の派生ぶんも含めて）
  if (!manaRegenAllowed(state)) return;
  const p = state.player;
  const max = state.stats.maxMana;
  if (p.mana >= max) return;
  const locked = state.rooms.some((r) => r.locked);
  const rate = state.stats.manaRegen * (locked ? 1 : MANA.idleRegenMul);
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
