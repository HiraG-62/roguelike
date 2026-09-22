import type { GameState } from "../core/state";
import { MINIMAP } from "../data/tuning";
import { TILE_SIZE, inBounds, isWalkable, toIndex } from "../map/grid";

/** ミニマップ用の探索済みタイル管理 */

export function resetExplored(state: GameState): void {
  state.explored = new Uint8Array(state.map.width * state.map.height);
  state.exploredLog = [];
}

/** プレイヤー周囲 revealRadius タイル（円）の床を探索済みにする。新しく塗ったタイル数を返す */
export function revealAround(state: GameState): number {
  const { map } = state;
  if (state.explored.length !== map.tiles.length) resetExplored(state);
  const r = MINIMAP.revealRadius;
  const r2 = r * r;
  const cx = Math.floor(state.player.body.pos.x / TILE_SIZE);
  const cy = Math.floor(state.player.body.pos.y / TILE_SIZE);
  let added = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (!inBounds(map, x, y) || !isWalkable(map, x, y)) continue;
      const i = toIndex(map, x, y);
      if (state.explored[i]) continue;
      state.explored[i] = 1;
      state.exploredLog.push(i);
      added++;
    }
  }
  return added;
}
