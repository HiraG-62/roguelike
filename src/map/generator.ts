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
import { DEFAULT_CAVE_OPTIONS, generateCave } from "./cave";

export interface GeneratorOptions {
  width: number;
  height: number;
  maxRooms: number;
  roomMinSize: number;
  roomMaxSize: number;
  /** 通路の幅（タイル）。アクションなので 2 が動きやすい */
  corridorWidth: number;
  /** 指定すると最後の部屋（階段の部屋）をこの大きさ以上にする（ボス部屋用） */
  lastRoomMin?: { w: number; h: number };
}

/** lastRoomMin の部屋を最小サイズからどれだけ大きくしてよいか */
const LAST_ROOM_EXTRA = 2;

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
  // 大部屋は先に場所だけ確保し、最後に繋ぐ（階段 = 最後の部屋になる）
  const reserved = options.lastRoomMin ? reserveRoom(rng, options, options.lastRoomMin) : null;
  const normalRooms = reserved ? options.maxRooms - 1 : options.maxRooms;

  for (let i = 0; i < PLACEMENT_ATTEMPTS && map.rooms.length < normalRooms; i++) {
    const w = rng.int(options.roomMinSize, options.roomMaxSize);
    const h = rng.int(options.roomMinSize, Math.min(options.roomMaxSize, options.height - 6));
    const room: Rect = {
      x: rng.int(2, options.width - w - 3),
      y: rng.int(2, options.height - h - 3),
      w,
      h,
    };
    if (map.rooms.some((other) => rectsIntersect(room, other, ROOM_MARGIN))) continue;
    if (reserved && rectsIntersect(room, reserved, ROOM_MARGIN)) continue;
    addRoom(rng, map, room, cw);
  }
  if (reserved) addRoom(rng, map, reserved, cw);

  // 階段は最後の部屋の中心（最初の部屋がスタートなので最も遠くなりやすい）
  const last = map.rooms[map.rooms.length - 1];
  if (last) {
    const c = rectCenter(last);
    setTile(map, c.x, c.y, Tile.StairsDown);
  }
  return map;
}

/** 部屋を掘って直前の部屋と L 字通路で繋ぐ */
function addRoom(rng: Rng, map: GameMap, room: Rect, cw: number): void {
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

function reserveRoom(rng: Rng, options: GeneratorOptions, min: { w: number; h: number }): Rect {
  const w = Math.min(options.width - 6, rng.int(min.w, min.w + LAST_ROOM_EXTRA));
  const h = Math.min(options.height - 6, rng.int(min.h, min.h + LAST_ROOM_EXTRA));
  return { x: rng.int(2, options.width - w - 3), y: rng.int(2, options.height - h - 3), w, h };
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

// -----------------------------------------------------------------------------
// 生成戦略
// -----------------------------------------------------------------------------

/** マップの形。フロア種別（rooms / cave / dark）から floor.ts が選ぶ。dark は rooms の形 */
export type MapShape = "rooms" | "cave";

/** 失敗（部屋が足りない等）なら null を返してよい。null なら同じ rng で再試行する */
type MapGenerator = (rng: Rng, options: GeneratorOptions) => GameMap | null;

const MAP_GENERATORS: Readonly<Record<MapShape, MapGenerator>> = {
  rooms: generateRoomsAndCorridors,
  cave: (rng, options) => generateCave(rng, { ...DEFAULT_CAVE_OPTIONS, width: options.width, height: options.height }),
};

const GENERATE_ATTEMPTS = 8;

/**
 * 形に応じた生成器でマップを作る。規定回数失敗したら rooms 型にフォールバックする。
 * rooms 型は generateRoomsAndCorridors と乱数消費が完全に同じ
 */
export function generateMap(shape: MapShape, rng: Rng, options: GeneratorOptions): GameMap {
  const generate = MAP_GENERATORS[shape];
  for (let i = 0; i < GENERATE_ATTEMPTS; i++) {
    const map = generate(rng, options);
    if (map) return map;
  }
  return generateRoomsAndCorridors(rng, options);
}
