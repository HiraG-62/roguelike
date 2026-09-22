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
  /** 通路の幅（タイル）。アクションなので 2 が動きやすい */
  corridorWidth: number;
}

export const DEFAULT_GENERATOR_OPTIONS: GeneratorOptions = {
  width: 96,
  height: 56,
  maxRooms: 9,
  roomMinSize: 9,
  roomMaxSize: 16,
  corridorWidth: 2,
};

const PLACEMENT_ATTEMPTS = 300;
/** 部屋同士の最小間隔（タイル）。通路と部屋がくっつかないよう広めに取る */
const ROOM_MARGIN = 3;

/**
 * 部屋をランダム配置して L 字通路でつなぐ、最も単純な生成。
 * 純関数: 同じ rng 状態と options なら同じマップになる。
 */
export function generateRoomsAndCorridors(rng: Rng, options: GeneratorOptions): GameMap {
  const map = createMap(options.width, options.height);
  const cw = options.corridorWidth;

  for (let i = 0; i < PLACEMENT_ATTEMPTS && map.rooms.length < options.maxRooms; i++) {
    const w = rng.int(options.roomMinSize, options.roomMaxSize);
    const h = rng.int(options.roomMinSize, Math.min(options.roomMaxSize, options.height - 6));
    const room: Rect = {
      x: rng.int(2, options.width - w - 3),
      y: rng.int(2, options.height - h - 3),
      w,
      h,
    };
    if (map.rooms.some((other) => rectsIntersect(room, other, ROOM_MARGIN))) continue;

    carveRect(map, room);
    const prev = map.rooms[map.rooms.length - 1];
    if (prev) {
      const a = rectCenter(prev);
      const b = rectCenter(room);
      // 横→縦 か 縦→横 かをランダムに選ぶと通路の見た目が単調にならない
      if (rng.chance(0.5)) {
        carveHorizontal(map, a.x, b.x, a.y, cw);
        carveVertical(map, a.y, b.y, b.x, cw);
      } else {
        carveVertical(map, a.y, b.y, a.x, cw);
        carveHorizontal(map, a.x, b.x, b.y, cw);
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

function carveRect(map: GameMap, r: Rect): void {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      setTile(map, x, y, Tile.Floor);
    }
  }
}

function carveHorizontal(map: GameMap, x1: number, x2: number, y: number, width: number): void {
  carveRect(map, { x: Math.min(x1, x2), y, w: Math.abs(x2 - x1) + width, h: width });
}

function carveVertical(map: GameMap, y1: number, y2: number, x: number, width: number): void {
  carveRect(map, { x, y: Math.min(y1, y2), w: width, h: Math.abs(y2 - y1) + width });
}
