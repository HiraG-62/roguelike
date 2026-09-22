import { type GameState, emit } from "../core/state";
import type { Entity } from "../entity/entity";

/** 次のレベルに必要な累計 XP。level * XP_PER_LEVEL の三角数にすると後半が重くなる */
const XP_PER_LEVEL = 10;
const HP_PER_LEVEL = 5;
const ATTACK_PER_LEVEL = 1;
/** この間隔で防御が 1 上がる */
const DEFENSE_EVERY_LEVELS = 3;

export function xpToNextLevel(level: number): number {
  return level * XP_PER_LEVEL;
}

/** XP を加算し、必要量を超えていればレベルアップ（複数段まとめて上がることもある） */
export function gainXp(state: GameState, e: Entity, amount: number): void {
  if (amount <= 0) return;
  e.xp += amount;
  emit(state, { type: "gainXp", amount });
  while (e.xp >= xpToNextLevel(e.level)) {
    e.xp -= xpToNextLevel(e.level);
    levelUp(state, e);
  }
}

function levelUp(state: GameState, e: Entity): void {
  e.level += 1;
  e.stats.maxHp += HP_PER_LEVEL;
  e.stats.hp = Math.min(e.stats.maxHp, e.stats.hp + HP_PER_LEVEL);
  e.stats.attack += ATTACK_PER_LEVEL;
  if (e.level % DEFENSE_EVERY_LEVELS === 0) e.stats.defense += 1;
  emit(state, { type: "levelUp", level: e.level });
}
