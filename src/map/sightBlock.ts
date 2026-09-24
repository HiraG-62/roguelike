import type { GameMap } from "./grid";

/**
 * 壁以外で視線を遮るもの（煙の層。docs/ideas/enemies.md V10）。map/pathing.ts の lineOfSight が読む。
 * 地形の層（state.terrain）は system 側にあり map からは見えないので、マップごとに「このタイルは遮るか」の関数を覚えておく。
 * 登録は system/terrain.ts の ensureTerrainLayer がフロアごとに 1 回行う。関数は state を読むだけなので決定性に影響しない
 */

const blockers = new WeakMap<GameMap, (tileIndex: number) => boolean>();

/** map の視線を遮るタイルの判定を登録する（同じマップに登録し直すと置き換える） */
export function setSightBlocker(map: GameMap, blocked: (tileIndex: number) => boolean): void {
  blockers.set(map, blocked);
}

/** タイル index が壁以外の理由で視線を遮るか。登録が無ければ false */
export function sightBlockedAt(map: GameMap, tileIndex: number): boolean {
  const blocked = blockers.get(map);
  return blocked !== undefined && blocked(tileIndex);
}
