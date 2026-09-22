import type { Rng } from "../core/rng";
import type { Entity } from "../entity/entity";

export interface AttackResult {
  damage: number;
  killed: boolean;
}

/** ダメージのばらつき幅。attack - defense に ±この値を足す */
const DAMAGE_VARIANCE = 1;

/** 純関数: ダメージ量だけ計算する。0 なら「外れ」扱い */
export function rollDamage(attacker: Entity, defender: Entity, rng: Rng): number {
  const base = attacker.stats.attack - defender.stats.defense;
  return Math.max(0, base + rng.int(-DAMAGE_VARIANCE, DAMAGE_VARIANCE));
}

/** defender の HP を減らし、結果を返す。イベント発行は呼び出し側の責務 */
export function applyAttack(attacker: Entity, defender: Entity, rng: Rng): AttackResult {
  const damage = rollDamage(attacker, defender, rng);
  defender.stats.hp = Math.max(0, defender.stats.hp - damage);
  return { damage, killed: defender.stats.hp <= 0 };
}
