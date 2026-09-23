import type { GameState } from "../core/state";
import { MANA } from "../data/tuning";

/**
 * マナ（スキルの資源）。docs/COMBAT_DESIGN.md B-1。
 * 通常攻撃の命中・ジャスト回避・撃破で溜まり、スキルで減る。上限は stats.maxMana
 */

/** 回収する。manaGainMul を掛け、上限で止める。実際に増えた量を返す */
export function gainMana(state: GameState, amount: number): number {
  if (amount <= 0 || state.status === "dead") return 0;
  const p = state.player;
  const before = p.mana;
  p.mana = Math.min(state.stats.maxMana, p.mana + amount * state.stats.manaGainMul);
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
  const p = state.player;
  const max = state.stats.maxMana;
  if (p.mana >= max) return;
  const locked = state.rooms.some((r) => r.locked);
  const rate = state.stats.manaRegen * (locked ? 1 : MANA.idleRegenMul);
  p.mana = Math.min(max, p.mana + rate * dt);
}

/** ラン開始・階層到達で満タンにする（MANA.startFull が false なら何もしない） */
export function refillMana(state: GameState): void {
  if (!MANA.startFull) return;
  state.player.mana = state.stats.maxMana;
}
