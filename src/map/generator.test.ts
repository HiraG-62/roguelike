import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { DEFAULT_GENERATOR_OPTIONS, generateMap, generateRoomsAndCorridors, planTerrain, scaleGeneratorOptions } from "./generator";
import { terrainCode } from "../core/terrain";
import { MAP_SIZE, TERRAIN_MUD_SMOKE } from "../data/tuning";
import { type GameMap, type Point, Tile, getTile, isWalkable, rectCenter, toIndex } from "./grid";
import { distanceField } from "./pathing";

const SEED_SAMPLES = 50;
const CARDINALS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** 4 近傍 BFS で start から階段に到達できるか */
function canReachStairs(map: GameMap, start: Point): boolean {
  const visited = new Uint8Array(map.tiles.length);
  const queue: Point[] = [start];
  visited[toIndex(map, start.x, start.y)] = 1;
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head];
    if (!p) break;
    if (getTile(map, p.x, p.y) === Tile.StairsDown) return true;
    for (const [dx, dy] of CARDINALS) {
      const nx = p.x + dx;
      const ny = p.y + dy;
      if (!isWalkable(map, nx, ny)) continue;
      const idx = toIndex(map, nx, ny);
      if (visited[idx]) continue;
      visited[idx] = 1;
      queue.push({ x: nx, y: ny });
    }
  }
  return false;
}

describe("generateRoomsAndCorridors", () => {
  it("同じ seed なら同じマップを生成する", () => {
    const a = generateRoomsAndCorridors(createRng(42), DEFAULT_GENERATOR_OPTIONS);
    const b = generateRoomsAndCorridors(createRng(42), DEFAULT_GENERATOR_OPTIONS);
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
    expect(a.rooms).toEqual(b.rooms);
  });

  it("部屋が 2 つ以上あり、階段が 1 つだけある", () => {
    for (let seed = 0; seed < SEED_SAMPLES; seed++) {
      const map = generateRoomsAndCorridors(createRng(seed), DEFAULT_GENERATOR_OPTIONS);
      expect(map.rooms.length, `seed=${seed}`).toBeGreaterThanOrEqual(2);
      const stairs = Array.from(map.tiles).filter((t) => t === Tile.StairsDown).length;
      expect(stairs, `seed=${seed}`).toBe(1);
    }
  });

  it("外周は必ず壁", () => {
    const map = generateRoomsAndCorridors(createRng(3), DEFAULT_GENERATOR_OPTIONS);
    for (let x = 0; x < map.width; x++) {
      expect(getTile(map, x, 0)).toBe(Tile.Wall);
      expect(getTile(map, x, map.height - 1)).toBe(Tile.Wall);
    }
    for (let y = 0; y < map.height; y++) {
      expect(getTile(map, 0, y)).toBe(Tile.Wall);
      expect(getTile(map, map.width - 1, y)).toBe(Tile.Wall);
    }
  });

  it("開始部屋から階段まで到達できる（全部屋が連結）", () => {
    for (let seed = 0; seed < SEED_SAMPLES; seed++) {
      const map = generateRoomsAndCorridors(createRng(seed), DEFAULT_GENERATOR_OPTIONS);
      const first = map.rooms[0];
      expect(first).toBeDefined();
      if (!first) continue;
      expect(canReachStairs(map, rectCenter(first)), `seed=${seed}`).toBe(true);
    }
  });
});

/** 4 近傍 BFS で start から歩ける床の印 */
function reachable(map: GameMap, start: Point): Uint8Array {
  const seen = new Uint8Array(map.tiles.length);
  const queue: Point[] = [start];
  seen[toIndex(map, start.x, start.y)] = 1;
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head];
    if (!p) break;
    for (const [dx, dy] of CARDINALS) {
      const nx = p.x + dx;
      const ny = p.y + dy;
      if (!isWalkable(map, nx, ny)) continue;
      const idx = toIndex(map, nx, ny);
      if (seen[idx]) continue;
      seen[idx] = 1;
      queue.push({ x: nx, y: ny });
    }
  }
  return seen;
}

const AREA_MUL = 4;
const WIDE_SEEDS = 10;
/** 部屋を置く試行が尽きて上限に届かないことがあるので、上限の 9 割以上あればよい */
const ROOM_FILL_RATIO = 0.9;

describe("広いマップ（scaleGeneratorOptions）", () => {
  it("面積の倍率 1 なら基準の設定のまま（ボス階・既存の形を変えない）", () => {
    expect(scaleGeneratorOptions(DEFAULT_GENERATOR_OPTIONS, 1)).toBe(DEFAULT_GENERATOR_OPTIONS);
    expect(DEFAULT_GENERATOR_OPTIONS.width).toBe(MAP_SIZE.baseWidth);
    expect(DEFAULT_GENERATOR_OPTIONS.height).toBe(MAP_SIZE.baseHeight);
  });

  it("面積の倍率 4 で幅と高さが 2 倍、部屋の上限が 4 倍（部屋の大きさは変えない）", () => {
    const wide = scaleGeneratorOptions(DEFAULT_GENERATOR_OPTIONS, AREA_MUL);
    expect(wide.width).toBe(DEFAULT_GENERATOR_OPTIONS.width * 2);
    expect(wide.height).toBe(DEFAULT_GENERATOR_OPTIONS.height * 2);
    expect(wide.maxRooms).toBe(Math.round(DEFAULT_GENERATOR_OPTIONS.maxRooms * AREA_MUL * MAP_SIZE.roomsPerArea));
    expect(wide.roomMaxSize).toBe(DEFAULT_GENERATOR_OPTIONS.roomMaxSize);
  });

  it("部屋型: 部屋数がほぼ 4 倍、階段が 1 つ、すべての部屋へ開始部屋から歩いて行ける", () => {
    const wide = scaleGeneratorOptions(DEFAULT_GENERATOR_OPTIONS, AREA_MUL);
    for (let seed = 0; seed < WIDE_SEEDS; seed++) {
      const map = generateMap("rooms", createRng(seed), wide);
      expect(map.width, `seed=${seed}`).toBe(wide.width);
      expect(map.rooms.length, `seed=${seed} 部屋数`).toBeGreaterThanOrEqual(Math.floor(wide.maxRooms * ROOM_FILL_RATIO));
      expect(Array.from(map.tiles).filter((t) => t === Tile.StairsDown).length, `seed=${seed} 階段`).toBe(1);
      const first = map.rooms[0];
      if (!first) throw new Error("開始部屋が無い");
      const seen = reachable(map, rectCenter(first));
      map.rooms.forEach((r, i) => {
        const c = rectCenter(r);
        expect(seen[toIndex(map, c.x, c.y)], `seed=${seed} 部屋 ${i}`).toBe(1);
      });
      const last = map.rooms[map.rooms.length - 1];
      if (!last) throw new Error("最後の部屋が無い");
      expect(getTile(map, rectCenter(last).x, rectCenter(last).y), `seed=${seed} 階段は最後の部屋`).toBe(Tile.StairsDown);
    }
  });

  it("部屋型: 広いマップでは階段の部屋が開始部屋から歩いて最も遠い（最初に繋がる部屋を除く）", () => {
    const wide = scaleGeneratorOptions(DEFAULT_GENERATOR_OPTIONS, AREA_MUL);
    expect(wide.connectNearest).toBe(true);
    for (let seed = 0; seed < WIDE_SEEDS; seed++) {
      const map = generateMap("rooms", createRng(seed), wide);
      const first = map.rooms[0];
      if (!first) throw new Error("開始部屋が無い");
      const s0 = rectCenter(first);
      const field = distanceField(map, toIndex(map, s0.x, s0.y));
      const walk = (i: number): number => {
        const r = map.rooms[i];
        if (!r) return -1;
        const c = rectCenter(r);
        return field[toIndex(map, c.x, c.y)] ?? -1;
      };
      const stairs = walk(map.rooms.length - 1);
      for (let i = 2; i < map.rooms.length; i++) expect(walk(i), `seed=${seed} 部屋 ${i}`).toBeLessThanOrEqual(stairs);
    }
  });

  it("洞窟: 面積の倍率 4 でも部屋が細切れにならず（基準の 2 倍以上の数）、すべての部屋へ歩いて行ける", () => {
    const wide = scaleGeneratorOptions(DEFAULT_GENERATOR_OPTIONS, AREA_MUL);
    for (let seed = 0; seed < WIDE_SEEDS; seed++) {
      const map = generateMap("cave", createRng(seed), wide);
      expect(map.roomTiles, `seed=${seed} 洞窟になる`).toBeDefined();
      const base = generateMap("cave", createRng(seed), DEFAULT_GENERATOR_OPTIONS);
      expect(map.rooms.length, `seed=${seed} 部屋数`).toBeGreaterThanOrEqual(base.rooms.length * 2);
      const tiles = map.roomTiles ?? [];
      const start = tiles[0]?.[0];
      if (start === undefined) throw new Error("開始部屋が無い");
      const seen = reachable(map, { x: start % map.width, y: Math.floor(start / map.width) });
      tiles.forEach((list, i) => expect(list.every((t) => seen[t] === 1), `seed=${seed} 部屋 ${i}`).toBe(true));
      expect(Array.from(map.tiles).filter((t) => t === Tile.StairsDown).length, `seed=${seed} 階段`).toBe(1);
    }
  });
});

describe("planTerrain の泥と煙", () => {
  const map = generateRoomsAndCorridors(createRng(3), DEFAULT_GENERATOR_OPTIONS);
  const mud = terrainCode("mud");
  const smoke = terrainCode("smoke");

  it("泥は genMinDepth より浅い階には置かれない", () => {
    for (let seed = 0; seed < SEED_SAMPLES; seed++) {
      const kinds = planTerrain(createRng(seed), map, TERRAIN_MUD_SMOKE.mud.genMinDepth - 1, new Set([0]));
      expect(kinds.includes(mud), `seed ${seed}`).toBe(false);
    }
  });

  it("深い階では泥も自然に置かれうる（煙は自然配置しない）", () => {
    let mudSeen = false;
    for (let seed = 0; seed < SEED_SAMPLES; seed++) {
      const kinds = planTerrain(createRng(seed), map, 8, new Set([0]));
      if (kinds.includes(mud)) mudSeen = true;
      expect(kinds.includes(smoke), `seed ${seed} に煙`).toBe(false);
    }
    expect(mudSeen, "50 seed のどこかで泥が出る").toBe(true);
  });
});
