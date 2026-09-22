import type { Direction, GameState } from "../core/state";
import type { Entity } from "../entity/entity";
import { toIndex } from "../map/grid";

export type MonsterAction =
  | { type: "wait" }
  | { type: "move"; dir: Direction }
  | { type: "attack"; targetId: number };

const WANDER_CHANCE = 0.3;

function sign(n: number): -1 | 0 | 1 {
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
}

/**
 * 追跡 AI。プレイヤーの視界内なら近づく（隣接なら攻撃）、視界外ならたまにうろつく。
 * 純関数: state を変更しない。移動可否の判定は turn 側に任せる。
 */
export function decideMonsterAction(state: GameState, self: Entity, player: Entity): MonsterAction {
  const dx = player.pos.x - self.pos.x;
  const dy = player.pos.y - self.pos.y;
  const adjacent = Math.max(Math.abs(dx), Math.abs(dy)) === 1;
  if (adjacent) return { type: "attack", targetId: player.id };

  // 視界は対称とみなし、プレイヤーから見えていれば向こうからも見えている
  const seesPlayer = state.visible[toIndex(state.map, self.pos.x, self.pos.y)] === 1;
  if (seesPlayer) {
    return { type: "move", dir: { dx: sign(dx), dy: sign(dy) } };
  }
  if (state.rng.chance(WANDER_CHANCE)) {
    return { type: "move", dir: { dx: state.rng.int(-1, 1) as -1 | 0 | 1, dy: state.rng.int(-1, 1) as -1 | 0 | 1 } };
  }
  return { type: "wait" };
}
