import { type GameMap, type Point, Tile, getTile, inBounds, toIndex } from "./grid";

/**
 * 再帰的 Shadowcasting（Björn Bergström 方式）。
 * 8 つの octant それぞれで影を伝播させる。純関数で、可視セルを 1 にした Uint8Array を返す。
 */

/** octant ごとの座標変換 (xx, xy, yx, yy) */
const OCTANTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [1, 0, 0, 1],
  [0, 1, 1, 0],
  [0, -1, 1, 0],
  [-1, 0, 0, 1],
  [-1, 0, 0, -1],
  [0, -1, -1, 0],
  [0, 1, -1, 0],
  [1, 0, 0, -1],
];

export function blocksLight(map: GameMap, x: number, y: number): boolean {
  return getTile(map, x, y) === Tile.Wall;
}

export function computeFov(map: GameMap, origin: Point, radius: number): Uint8Array {
  const visible = new Uint8Array(map.width * map.height);
  if (inBounds(map, origin.x, origin.y)) {
    visible[toIndex(map, origin.x, origin.y)] = 1;
  }
  for (const [xx, xy, yx, yy] of OCTANTS) {
    castLight(map, visible, origin.x, origin.y, radius, 1, 1, 0, xx, xy, yx, yy);
  }
  return visible;
}

function castLight(
  map: GameMap,
  visible: Uint8Array,
  cx: number,
  cy: number,
  radius: number,
  row: number,
  startSlope: number,
  endSlope: number,
  xx: number,
  xy: number,
  yx: number,
  yy: number,
): void {
  if (startSlope < endSlope) return;
  const radiusSq = radius * radius;
  let start = startSlope;
  let newStart = 0;

  for (let i = row; i <= radius; i++) {
    let blocked = false;
    const dy = -i;
    for (let dx = -i; dx <= 0; dx++) {
      const x = cx + dx * xx + dy * xy;
      const y = cy + dx * yx + dy * yy;
      const leftSlope = (dx - 0.5) / (dy + 0.5);
      const rightSlope = (dx + 0.5) / (dy - 0.5);

      if (start < rightSlope) continue;
      if (endSlope > leftSlope) break;

      if (dx * dx + dy * dy < radiusSq && inBounds(map, x, y)) {
        visible[toIndex(map, x, y)] = 1;
      }

      if (blocked) {
        if (blocksLight(map, x, y)) {
          newStart = rightSlope;
          continue;
        }
        blocked = false;
        start = newStart;
      } else if (blocksLight(map, x, y) && i < radius) {
        blocked = true;
        castLight(map, visible, cx, cy, radius, i + 1, start, leftSlope, xx, xy, yx, yy);
        newStart = rightSlope;
      }
    }
    if (blocked) break;
  }
}
