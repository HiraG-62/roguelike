import type { StatusEffect } from "../core/status";
import { type Enemy, type GameState } from "../core/state";
import { STATUS } from "../data/tuning";
import { spawnBurst, spawnRing } from "./effects";
import { gainMana } from "./mana";
import { enemiesInRadius, hurtEnemy, removeStatus } from "./statusEffects";

/**
 * 墨印（書の専用の印。docs/ideas/tome-rework.md 7 章）。書の左の 3 段が記し（movesets/book.json の applies）、
 * 射撃・スキルの命中で読む（反応「読誦」。statusReactions.ts の onPlayerHitReactions が呼ぶ）。
 * 烙印が 1 体への起爆なのに対し、墨印は記した文字の術が周りへ広がる: 重ねの数で円が広がり、円の中の敵すべてに
 * 威力と怯み値が入り、重ねの数だけ気力が戻る（次のスキルへ返す）
 */

const READ_RING_LIFE = 0.3;
const READ_PARTICLES = 12;
const READ_PARTICLE_SPEED = 90;
const READ_PARTICLE_LIFE = 0.35;
const READ_PARTICLE_SIZE = 1.5;

/** 重ねの数で決まる読みの円の半径（px） */
export function inkReadRadius(stacks: number): number {
  const m = STATUS.inkMark;
  return m.radiusBase + m.radiusPerStack * stacks;
}

/**
 * 墨印を読む: 印を消し、印の付いた敵を中心に円の中の敵すべてへ威力 × 重ね・怯み値 × 重ね、気力を戻す。
 * 倒した一撃でも読む（印の付いた敵の位置から広がる）。円の中の他の敵の墨印は読まない（読みが連鎖しないように）。
 * ダメージは on-hit の最中なので hurtEnemy が次のステップへ回す
 */
export function readInkMark(state: GameState, enemy: Enemy, mark: Readonly<StatusEffect>): void {
  const m = STATUS.inkMark;
  const stacks = mark.stacks;
  const center = { ...enemy.body.pos };
  const radius = inkReadRadius(stacks);
  removeStatus(state, { kind: "enemy", enemy }, "inkMark", "consume");
  spawnRing(state, center, radius, m.color, READ_RING_LIFE);
  spawnBurst(state, center, m.color, READ_PARTICLES, READ_PARTICLE_SPEED, READ_PARTICLE_LIFE, READ_PARTICLE_SIZE);
  const amount = mark.potency * stacks;
  const poise = m.poisePerStack * stacks;
  // 倒れた敵は enemiesInRadius に入らないので、中心の敵は円に関係なく先に当てる（hurtEnemy は倒れた敵を飛ばす）
  hurtEnemy(state, enemy, amount, poise);
  for (const e of enemiesInRadius(state, center, radius)) {
    if (e.id === enemy.id) continue;
    hurtEnemy(state, e, amount, poise);
  }
  gainMana(state, m.manaPerStack * stacks);
}
