import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { DEFAULT_CAVE_OPTIONS, generateCave } from "./cave";
import { DEFAULT_GENERATOR_OPTIONS, generateMap } from "./generator";
import { type GameMap, Tile, getTile, isWalkable, rectCenter, toIndex } from "./grid";

const SEED_SAMPLES = 40;
const CARDINALS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
const DIAGONALS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

function reachableFrom(map: GameMap, start: number): Uint8Array {
  const seen = new Uint8Array(map.tiles.length);
  const queue = [start];
  seen[start] = 1;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head] ?? 0;
    const x = i % map.width;
    const y = Math.floor(i / map.width);
    for (const [dx, dy] of CARDINALS) {
      if (!isWalkable(map, x + dx, y + dy)) continue;
      const ni = toIndex(map, x + dx, y + dy);
      if (seen[ni]) continue;
      seen[ni] = 1;
      queue.push(ni);
    }
  }
  return seen;
}

function caveFor(seed: number): GameMap {
  return generateMap("cave", createRng(seed), DEFAULT_GENERATOR_OPTIONS);
}

describe("generateCave", () => {
  it("同じ seed なら同じ洞窟", () => {
    const a = generateCave(createRng(9));
    const b = generateCave(createRng(9));
    expect(a).not.toBeNull();
    expect(Array.from(a?.tiles ?? [])).toEqual(Array.from(b?.tiles ?? []));
    expect(a?.roomTiles).toEqual(b?.roomTiles);
  });

  it("generateMap('cave') はほぼ常に塊の部屋を持つ洞窟を返す", () => {
    let caves = 0;
    for (let seed = 0; seed < SEED_SAMPLES; seed++) if (caveFor(seed).roomTiles) caves++;
    expect(caves).toBeGreaterThanOrEqual(SEED_SAMPLES - 1);
  });

  it("全ての床が開始部屋から到達可能（連結）で、階段は 1 つ・最後の部屋にある", () => {
    for (let seed = 0; seed < SEED_SAMPLES; seed++) {
      const map = caveFor(seed);
      if (!map.roomTiles) continue;
      const first = map.rooms[0];
      expect(first).toBeDefined();
      if (!first) continue;
      const c = rectCenter(first);
      const seen = reachableFrom(map, toIndex(map, c.x, c.y));
      for (let i = 0; i < map.tiles.length; i++) {
        if (map.tiles[i] !== Tile.Wall) expect(seen[i], `seed=${seed} tile=${i}`).toBe(1);
      }
      const stairs = Array.from(map.tiles).flatMap((t, i) => (t === Tile.StairsDown ? [i] : []));
      expect(stairs, `seed=${seed}`).toHaveLength(1);
      const lastTiles = map.roomTiles[map.roomTiles.length - 1] ?? [];
      expect(lastTiles).toContain(stairs[0]);
    }
  });

  it("外周は壁、部屋は minRooms 以上で、部屋同士は 8 近傍で接しない", () => {
    for (let seed = 0; seed < SEED_SAMPLES; seed++) {
      const map = caveFor(seed);
      if (!map.roomTiles) continue;
      expect(map.roomTiles.length).toBeGreaterThanOrEqual(DEFAULT_CAVE_OPTIONS.minRooms);
      for (let x = 0; x < map.width; x++) {
        expect(getTile(map, x, 0)).toBe(Tile.Wall);
        expect(getTile(map, x, map.height - 1)).toBe(Tile.Wall);
      }
      const owner = new Int16Array(map.tiles.length).fill(-1);
      map.roomTiles.forEach((tiles, id) => {
        for (const t of tiles) owner[t] = id;
      });
      // タイル × 近傍ごとに expect を呼ぶと 40 seed で数秒かかりタイムアウトするため、違反を数えて 1 回だけ検査する
      let touching = 0;
      map.roomTiles.forEach((tiles, id) => {
        for (const t of tiles) {
          const x = t % map.width;
          const y = Math.floor(t / map.width);
          for (const [dx, dy] of [...CARDINALS, ...DIAGONALS]) {
            const o = owner[toIndex(map, x + dx, y + dy)] ?? -1;
            if (o !== -1 && o !== id) touching++;
          }
        }
      });
      expect(touching, `seed=${seed}`).toBe(0);
    }
  });

  it("部屋の矩形は全て床で、中心は部屋の所属タイル", () => {
    for (let seed = 0; seed < SEED_SAMPLES; seed++) {
      const map = caveFor(seed);
      if (!map.roomTiles) continue;
      map.rooms.forEach((r, i) => {
        for (let y = r.y; y < r.y + r.h; y++) {
          for (let x = r.x; x < r.x + r.w; x++) expect(isWalkable(map, x, y)).toBe(true);
        }
        const c = rectCenter(r);
        expect(map.roomTiles?.[i]).toContain(toIndex(map, c.x, c.y));
      });
    }
  });
});
