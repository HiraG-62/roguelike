import { type GameState, runOver } from "../core/state";
import { enemyDef } from "../data/enemies";
import { ENEMY_AI, MANA } from "../data/tuning";
import { hasStatus } from "./statusEffects";
import { manaRegenAllowed } from "./keystones";
import { spillManaOverflow, traitManaGainMul } from "./traitHooks";

/**
 * マナ（スキルの資源）。docs/COMBAT_DESIGN.md B-1。
 * 通常攻撃の命中・ジャスト回避・撃破で溜まり、スキルで減る。上限は stats.maxMana
 */

/**
 * 回収する。manaGainMul を掛け、上限で止める。実際に増えた量を返す
 */
export function gainMana(state: GameState, amount: number): number {
  if (amount <= 0 || runOver(state)) return 0;
  return addMana(state, amount * state.stats.manaGainMul * traitManaGainMul(state));
}

/**
 * 通常攻撃（近接・ダッシュ攻撃・射撃）の命中の回収。mul は呼び出し側の誓約 × 祝福の倍率。
 * 性質「底打ち」と合わせた積を MANA.attackGainMulMax で止める
 */
export function gainAttackMana(state: GameState, base: number, mul: number): number {
  if (base <= 0 || runOver(state)) return 0;
  // 沈黙中はスキルを撃てない代わりに、通常攻撃で溜める量が増える（docs/ideas/enemies.md H8。上限の外で掛ける）
  const silenced = hasStatus(state.player.status, "silence") ? ENEMY_AI.silencedAttackManaMul : 1;
  const total = Math.min(MANA.attackGainMulMax, mul * traitManaGainMul(state)) * silenced;
  if (total <= 0) return 0;
  return addMana(state, base * total * state.stats.manaGainMul);
}

/**
 * 武器そのもの（近接の段・ダッシュ攻撃・弾）の命中の回収。素の倍率 MANA.attackGainScale を掛けてから gainAttackMana へ。
 * 武器ごとの段の値を書き換えずに、序盤の連発をまとめて絞るための口（流儀の源は gainAttackMana を直に呼び、絞らない）
 */
export function gainWeaponMana(state: GameState, base: number, mul: number): number {
  return gainAttackMana(state, base * MANA.attackGainScale, mul);
}

/** 足して、上限で溢れた分を必殺ゲージへ移す */
function addMana(state: GameState, raw: number): number {
  const p = state.player;
  const before = p.mana;
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

/**
 * 自然回復。戦っていない間（封鎖中でなく、MANA.combatRadius 内に生きた敵がいない）は待ち時間を作らないよう速める。
 * 開放型フロアでは封鎖がほぼ無いので「近くに敵がいるか」で戦闘中を判定する
 */
export function tickMana(state: GameState, dt: number): void {
  if (runOver(state)) return;
  // 自然回復そのものを止める誓約が付くと止まる（精神の派生ぶんも含めて。今は止める誓約が無く、口だけ残してある）
  if (!manaRegenAllowed(state)) return;
  const p = state.player;
  const max = state.stats.maxMana;
  if (p.mana >= max) return;
  const pos = p.body.pos;
  const r2 = MANA.combatRadius * MANA.combatRadius;
  const fighting =
    state.rooms.some((r) => r.locked) || state.enemies.some((e) => e.hp > 0 && enemyDef(e.defKey).container === undefined && (e.body.pos.x - pos.x) ** 2 + (e.body.pos.y - pos.y) ** 2 <= r2);
  const rate = state.stats.manaRegen * (fighting ? 1 : MANA.idleRegenMul);
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
