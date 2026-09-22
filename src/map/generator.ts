import type { Rng } from "../core/rng";
import {
  type GameMap,
  type Rect,
  Tile,
  createMap,
  rectCenter,
  rectsIntersect,
  setTile,
} from "./grid";

export interface GeneratorOptions {
  width: number;
  height: number;
  maxRooms: number;
  roomMinSize: number;
  roomMaxSize: number;
}

export const DEFAULT_GENERATOR_OPTIONS: GeneratorOptions = {
  width: 80,
  height: 24,
  maxRooms: 12,
  roomMinSize: 4,
  roomMaxSize: 10,
};

const PLACEMENT_ATTEMPTS = 200;

/**
 * 部屋をランダム配置して L 字通路でつなぐ、最も単純な生成。
 * 純関数: 同じ rng 状態と options なら同じマップになる。
 */
export function generateRoomsAndCorridors(rng: Rng, options: GeneratorOptions): GameMap {
  const map = createMap(options.width, options.height);

  for (let i = 0; i < PLACEMENT_ATTEMPTS && map.rooms.length < options.maxRooms; i++) {
    const w = rng.int(options.roomMinSize, options.roomMaxSize);
    const h = rng.int(options.roomMinSize, Math.min(options.roomMaxSize, options.height - 4));
    const room: Rect = {
      x: rng.int(1, options.width - w - 2),
      y: rng.int(1, options.height - h - 2),
      w,
      h,
    };
    if (map.rooms.some((other) => rectsIntersect(room, other))) continue;

    carveRoom(map, room);
    const prev = map.rooms[map.rooms.length - 1];
    if (prev) {
      const a = rectCenter(prev);
      const b = rectCenter(room);
      // 横→縦 か 縦→横 かをランダムに選ぶと通路の見た目が単調にならない
      if (rng.chance(0.5)) {
        carveHorizontal(map, a.x, b.x, a.y);
        carveVertical(map, a.y, b.y, b.x);
      } else {
        carveVertical(map, a.y, b.y, a.x);
        carveHorizontal(map, a.x, b.x, b.y);
      }
    }
    map.rooms.push(room);
  }

  // 階段は最後の部屋の中心（最初の部屋がスタートなので最も遠くなりやすい）
  const last = map.rooms[map.rooms.length - 1];
  if (last) {
    const c = rectCenter(last);
    setTile(map, c.x, c.y, Tile.StairsDown);
  }
  return map;
}

function carveRoom(map: GameMap, r: Rect): void {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      setTile(map, x, y, Tile.Floor);
    }
  }
}

function carveHorizontal(map: GameMap, x1: number, x2: number, y: number): void {
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
    setTile(map, x, y, Tile.Floor);
  }
}

function carveVertical(map: GameMap, y1: number, y2: number, x: number): void {
  for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
    setTile(map, x, y, Tile.Floor);
  }
}
