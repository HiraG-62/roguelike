import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { DEFAULT_GENERATOR_OPTIONS, generateRoomsAndCorridors, planTerrain } from "./generator";
import { terrainCode } from "../core/terrain";
import { TERRAIN_MUD_SMOKE } from "../data/tuning";
import { type GameMap, type Point, Tile, getTile, isWalkable, rectCenter, toIndex } from "./grid";

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
