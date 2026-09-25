import type { Rng } from "../core/rng";
import {
  type GameMap,
  type Rect,
  Tile,
  createMap,
  getTile,
  rectCenter,
  rectsIntersect,
  setTile,
  toIndex,
} from "./grid";
import { terrainCode } from "../core/terrain";
import { UNREACHABLE, distanceField } from "./pathing";
import { MAP_SIZE, TERRAIN, TERRAIN_MUD_SMOKE } from "../data/tuning";
import { type CaveShapeOptions, DEFAULT_CAVE_OPTIONS, generateCave } from "./cave";

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
  /** 洞窟の形の上書き（バイオームごと。tuning の CAVE.biome） */
  cave?: Partial<CaveShapeOptions>;
  /** 部屋を置く試行回数（省略時は PLACEMENT_ATTEMPTS）。広いマップほど部屋が多いので伸ばす */
  placementAttempts?: number;
  /**
   * 新しい部屋を直前の部屋ではなく中心が最も近い部屋へ繋ぎ、最後に開始部屋から最も遠い部屋を最後（階段）へ回す。
   * 広いマップで L 字通路がマップを横断して長くなりすぎないように。省略時は直前の部屋へ繋ぐ（基準の大きさの形を変えない）
   */
  connectNearest?: boolean;
}

/** lastRoomMin の部屋を最小サイズからどれだけ大きくしてよいか */
const LAST_ROOM_EXTRA = 2;

/** 基準の大きさ（面積の倍率 1）。階ごとの大きさは scaleGeneratorOptions で伸ばす */
export const DEFAULT_GENERATOR_OPTIONS: GeneratorOptions = {
  width: MAP_SIZE.baseWidth,
  height: MAP_SIZE.baseHeight,
  maxRooms: 9,
  roomMinSize: 9,
  roomMaxSize: 16,
  corridorWidth: 2,
};

const PLACEMENT_ATTEMPTS = 300;
/** 部屋同士の最小間隔（タイル）。通路と部屋がくっつかないよう広めに取る */
const ROOM_MARGIN = 3;
/** 並べ替えてよい最初の部屋（0 = 開始、1 = 最初に繋がる部屋。floor.ts が 1 を戦闘部屋に固定する） */
const FIRST_MOVABLE_ROOM = 2;

/**
 * 面積を areaMul 倍にした生成の設定（純関数）。幅と高さは √areaMul 倍、配置の試行回数は areaMul 倍。
 * 広さは部屋の数（areaMul × MAP_SIZE.roomsPerArea）と部屋の大きさ（寸法 × areaMul ^ MAP_SIZE.roomSizeExp）の両方で出す。
 * 部屋の数だけで広げると敵の総数が面積に比例して重くなり、広間も生まれず「広大」に感じないため。通路の太さは変えない。
 * areaMul = 1 なら base と同じ生成になる（ボス階・既存の seed の形を変えない）
 */
export function scaleGeneratorOptions(base: GeneratorOptions, areaMul: number): GeneratorOptions {
  if (areaMul === 1) return base;
  const side = Math.sqrt(areaMul);
  const roomMul = areaMul * MAP_SIZE.roomsPerArea;
  const sizeMul = areaMul ** MAP_SIZE.roomSizeExp;
  const cave = { ...DEFAULT_CAVE_OPTIONS, ...base.cave };
  return {
    ...base,
    width: Math.round(base.width * side),
    height: Math.round(base.height * side),
    maxRooms: Math.max(1, Math.round(base.maxRooms * roomMul)),
    roomMinSize: Math.round(base.roomMinSize * sizeMul),
    roomMaxSize: Math.round(base.roomMaxSize * sizeMul),
    placementAttempts: Math.round((base.placementAttempts ?? PLACEMENT_ATTEMPTS) * areaMul),
    connectNearest: true,
    cave: {
      ...base.cave,
      maxRooms: Math.max(1, Math.round(cave.maxRooms * roomMul)),
      minRooms: Math.max(1, Math.round(cave.minRooms * areaMul * MAP_SIZE.caveMinRoomsPerArea)),
      // 洞窟の部屋は開けた領域を膨らませた塊なので、膨らませる幅と採用する最小の塊を部屋の寸法と同じ比率で広げる
      roomGrow: Math.round(cave.roomGrow * sizeMul),
      minRoomTiles: Math.round(cave.minRoomTiles * sizeMul * sizeMul),
    },
  };
}

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

  const attempts = options.placementAttempts ?? PLACEMENT_ATTEMPTS;
  for (let i = 0; i < attempts && map.rooms.length < normalRooms; i++) {
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
    addRoom(rng, map, room, cw, options.connectNearest === true);
  }
  if (reserved) addRoom(rng, map, reserved, cw, false);
  else if (options.connectNearest) moveFarthestLast(map);

  // 階段は最後の部屋の中心（最初の部屋がスタートなので最も遠くなりやすい）
  const last = map.rooms[map.rooms.length - 1];
  if (last) {
    const c = rectCenter(last);
    setTile(map, c.x, c.y, Tile.StairsDown);
  }
  return map;
}

/** 部屋を掘って直前の部屋（nearest なら中心が最も近い部屋）と L 字通路で繋ぐ */
function addRoom(rng: Rng, map: GameMap, room: Rect, cw: number, nearest: boolean): void {
  carveRect(map, room);
  const prev = nearest ? nearestRoom(map.rooms, room) : map.rooms[map.rooms.length - 1];
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

function nearestRoom(rooms: readonly Rect[], room: Rect): Rect | undefined {
  const c = rectCenter(room);
  let best: Rect | undefined;
  let bestDist = Infinity;
  for (const other of rooms) {
    const o = rectCenter(other);
    const d = Math.abs(o.x - c.x) + Math.abs(o.y - c.y);
    if (d >= bestDist) continue;
    best = other;
    bestDist = d;
  }
  return best;
}

/** 最初に繋がる部屋（index 1）より後で、開始部屋から歩いて最も遠い部屋を最後へ回す（階段 = 最後の部屋）。乱数は使わない */
function moveFarthestLast(map: GameMap): void {
  const start = map.rooms[0];
  if (!start || map.rooms.length <= FIRST_MOVABLE_ROOM + 1) return;
  const s = rectCenter(start);
  const field = distanceField(map, toIndex(map, s.x, s.y));
  let far = map.rooms.length - 1;
  let farDist = -1;
  for (let i = FIRST_MOVABLE_ROOM; i < map.rooms.length; i++) {
    const r = map.rooms[i];
    if (!r) continue;
    const c = rectCenter(r);
    const d = field[toIndex(map, c.x, c.y)] ?? UNREACHABLE;
    if (d <= farDist) continue;
    far = i;
    farDist = d;
  }
  const [moved] = map.rooms.splice(far, 1);
  if (moved) map.rooms.push(moved);
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

/** マップの形。フロア種別から floor.ts が選ぶ（system/biomes.ts の MAP_SHAPE） */
export type MapShape = "rooms" | "cave";

/** 失敗（部屋が足りない等）なら null を返してよい。null なら同じ rng で再試行する */
type MapGenerator = (rng: Rng, options: GeneratorOptions) => GameMap | null;

const MAP_GENERATORS: Readonly<Record<MapShape, MapGenerator>> = {
  rooms: generateRoomsAndCorridors,
  cave: (rng, options) => generateCave(rng, { ...DEFAULT_CAVE_OPTIONS, ...options.cave, width: options.width, height: options.height }),
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

// -----------------------------------------------------------------------------
// 地形の配置（docs/ideas/status-and-terrain.md 3 章）
// -----------------------------------------------------------------------------

/** 深度で出始める地形の候補（配置の重みは TERRAIN.gen、泥は TERRAIN_MUD_SMOKE.mud） */
type PlacedTerrain = keyof typeof TERRAIN.gen.weight | "mud";
const PLACED_TERRAIN: readonly PlacedTerrain[] = ["water", "grass", "oil", "ice", "bog", "lava", "mud"];

function placedMinDepth(kind: PlacedTerrain): number {
  return kind === "mud" ? TERRAIN_MUD_SMOKE.mud.genMinDepth : TERRAIN.gen.minDepth[kind];
}

function placedWeight(kind: PlacedTerrain): number {
  return kind === "mud" ? TERRAIN_MUD_SMOKE.mud.genWeight : TERRAIN.gen.weight[kind];
}

/** この深度で出せる地形を重みつきで 1 つ選ぶ */
function pickTerrain(rng: Rng, depth: number): PlacedTerrain | null {
  const pool = PLACED_TERRAIN.filter((k) => depth >= placedMinDepth(k));
  const total = pool.reduce((sum, k) => sum + placedWeight(k), 0);
  if (total <= 0) return null;
  let roll = rng.next() * total;
  for (const k of pool) {
    roll -= placedWeight(k);
    if (roll < 0) return k;
  }
  return pool[pool.length - 1] ?? null;
}

/**
 * マップに地形の塊を少量置く（純関数）。戻り値はタイル index → 地形番号（TERRAIN_KINDS の添字）。
 * skipRooms（開始部屋・階段 / ボスの部屋）には置かない。床（Tile.Floor）の上にだけ置き、階段・泉は避ける
 */
export function planTerrain(rng: Rng, map: GameMap, depth: number, skipRooms: ReadonlySet<number>): Uint8Array {
  const kinds = new Uint8Array(map.width * map.height);
  const rooms = map.rooms.map((r, i) => ({ r, i })).filter(({ i }) => !skipRooms.has(i));
  if (rooms.length === 0) return kinds;
  const g = TERRAIN.gen;
  const count = Math.min(g.patchesMax, Math.floor(g.patchesBase + g.patchesPerDepth * Math.max(0, depth - 1)));
  for (let n = 0; n < count; n++) {
    const kind = pickTerrain(rng, depth);
    const { r } = rng.pick(rooms);
    if (!kind || r.w < 3 || r.h < 3) continue;
    const cx = rng.int(r.x + 1, r.x + r.w - 2);
    const cy = rng.int(r.y + 1, r.y + r.h - 2);
    const radius = rng.int(g.radiusMin, g.radiusMax);
    fillPatch(map, kinds, r, cx, cy, radius, terrainCode(kind));
  }
  return kinds;
}

function fillPatch(map: GameMap, kinds: Uint8Array, room: Rect, cx: number, cy: number, radius: number, code: number): void {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const dx = x - cx;
      const dy = y - cy;
      // 半径ちょうどの角を少し削って丸く見せる
      if (dx * dx + dy * dy > radius * radius + radius) continue;
      if (x < room.x || y < room.y || x >= room.x + room.w || y >= room.y + room.h) continue;
      if (getTile(map, x, y) !== Tile.Floor) continue;
      kinds[toIndex(map, x, y)] = code;
    }
  }
}

// -----------------------------------------------------------------------------
// 分岐路の階段（docs/ideas/run-expansion.md 4 章）
// -----------------------------------------------------------------------------

/** 中心からの向き（左右を先に試す: 横に並ぶと行き先の文字が重ならない） */
const FORK_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/**
 * 最後の部屋に count 個の階段タイルを置き、そのタイル index を返す（先頭は中心の既存の階段）。
 * 中心から offset タイル離れた床（部屋の中）だけを使う。置ける場所が足りなければ置けた数だけ返す。
 * 中心がまだ階段でない（ボスの撃破前）なら何も置かない
 */
export function forkStairsTiles(
  map: GameMap,
  rect: Rect,
  roomTiles: ReadonlySet<number> | undefined,
  count: number,
  offset: number,
): number[] {
  const c = rectCenter(rect);
  if (getTile(map, c.x, c.y) !== Tile.StairsDown) return [];
  const out = [toIndex(map, c.x, c.y)];
  for (const [dx, dy] of FORK_DIRS) {
    if (out.length >= count) break;
    const x = c.x + dx * offset;
    const y = c.y + dy * offset;
    if (getTile(map, x, y) !== Tile.Floor) continue;
    const inside = roomTiles ? roomTiles.has(toIndex(map, x, y)) : x > rect.x && y > rect.y && x < rect.x + rect.w - 1 && y < rect.y + rect.h - 1;
    if (!inside) continue;
    setTile(map, x, y, Tile.StairsDown);
    out.push(toIndex(map, x, y));
  }
  return out;
}
