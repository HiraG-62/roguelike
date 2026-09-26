import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { CAVE } from "../data/tuning";
import { type CaveOptions, DEFAULT_CAVE_OPTIONS, carveArena, generateCave } from "./cave";
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

/** 幅 1 の通路（上下か左右を壁に挟まれた床）の数 */
function narrowTiles(map: GameMap): number {
  let n = 0;
  for (let y = 1; y < map.height - 1; y++) {
    for (let x = 1; x < map.width - 1; x++) {
      if (!isWalkable(map, x, y)) continue;
      const vertical = !isWalkable(map, x, y - 1) && !isWalkable(map, x, y + 1);
      const horizontal = !isWalkable(map, x - 1, y) && !isWalkable(map, x + 1, y);
      if (vertical || horizontal) n++;
    }
  }
  return n;
}

const BIOME_SEEDS = 20;

describe("バイオームごとの洞窟の形（CAVE.biome）", () => {
  for (const [kind, override] of Object.entries(CAVE.biome)) {
    it(`${kind}: ほぼ常に塊の部屋を持ち、全ての床が連結し、塊の数は minRooms〜maxRooms`, () => {
      const options = { ...DEFAULT_CAVE_OPTIONS, ...override };
      let caves = 0;
      for (let seed = 0; seed < BIOME_SEEDS; seed++) {
        const map = generateMap("cave", createRng(seed), { ...DEFAULT_GENERATOR_OPTIONS, cave: override });
        if (!map.roomTiles) continue;
        caves++;
        expect(map.roomTiles.length).toBeGreaterThanOrEqual(options.minRooms);
        expect(map.roomTiles.length).toBeLessThanOrEqual(options.maxRooms);
        const c = rectCenter(map.rooms[0]!);
        const seen = reachableFrom(map, toIndex(map, c.x, c.y));
        let unreachable = 0;
        for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] !== Tile.Wall && !seen[i]) unreachable++;
        expect(unreachable, `${kind} seed=${seed}`).toBe(0);
      }
      expect(caves, "rooms 型へのフォールバックはほぼ無い").toBeGreaterThanOrEqual(BIOME_SEEDS - 1);
    });
  }

  it("widen を上げると幅 1 の通路が減る", () => {
    let before = 0;
    let after = 0;
    for (let seed = 0; seed < BIOME_SEEDS; seed++) {
      const narrow: CaveOptions = { ...DEFAULT_CAVE_OPTIONS, widen: 0 };
      const wide: CaveOptions = { ...DEFAULT_CAVE_OPTIONS, widen: 1 };
      const a = generateCave(createRng(seed), narrow);
      const b = generateCave(createRng(seed), wide);
      if (!a || !b) continue;
      before += narrowTiles(a);
      after += narrowTiles(b);
    }
    expect(before, "既定の洞窟には細い道がある").toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
  });

  it("バイオームで形が変わる（草原は既定より開けている）", () => {
    let base = 0;
    let meadow = 0;
    for (let seed = 0; seed < BIOME_SEEDS; seed++) {
      const a = generateCave(createRng(seed), DEFAULT_CAVE_OPTIONS);
      const b = generateCave(createRng(seed), { ...DEFAULT_CAVE_OPTIONS, ...CAVE.biome.meadow });
      base += a ? Array.from(a.tiles).filter((t) => t !== Tile.Wall).length : 0;
      meadow += b ? Array.from(b.tiles).filter((t) => t !== Tile.Wall).length : 0;
    }
    expect(meadow, "草原の床は既定より多い").toBeGreaterThan(base);
  });
});

describe("carveArena（system/floorLord.ts が最後の部屋を広げる）", () => {
  it("最後の塊を円形に広げる。他の塊とは 8 近傍で接せず、外周 1 マスは掘らない", () => {
    let widened = 0;
    for (let seed = 0; seed < SEED_SAMPLES; seed++) {
      const map = caveFor(seed);
      if (!map.roomTiles) continue;
      const last = map.roomTiles.length - 1;
      const before = map.roomTiles[last]?.length ?? 0;
      carveArena(map, last, 5);
      const after = map.roomTiles[last] ?? [];
      expect(after.length, `seed=${seed} 縮まない`).toBeGreaterThanOrEqual(before);
      if (after.length > before) widened++;

      const owner = new Int16Array(map.tiles.length).fill(-1);
      map.roomTiles.forEach((tiles, id) => {
        for (const t of tiles) owner[t] = id;
      });
      for (const t of after) {
        const x = t % map.width;
        const y = Math.floor(t / map.width);
        expect(x > 0 && y > 0 && x < map.width - 1 && y < map.height - 1, `seed=${seed} 外周は掘らない`).toBe(true);
        for (const [dx, dy] of [...CARDINALS, ...DIAGONALS]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
          const o = owner[toIndex(map, nx, ny)] ?? -1;
          expect(o === -1 || o === last, `seed=${seed} tile=${t} 他の塊と接しない`).toBe(true);
        }
      }
    }
    expect(widened, "少なくともいくつかの seed では実際に広がる").toBeGreaterThan(0);
  });

  it("rooms 型（roomTiles が無い）では何もしない", () => {
    const map = generateMap("rooms", createRng(3), DEFAULT_GENERATOR_OPTIONS);
    const before = Array.from(map.tiles);
    carveArena(map, map.rooms.length - 1, 5);
    expect(Array.from(map.tiles)).toEqual(before);
  });

  it("乱数を使わない（同じ洞窟に対して何度呼んでも同じ結果。純関数）", () => {
    const a = caveFor(5);
    const b = caveFor(5);
    if (!a.roomTiles || !b.roomTiles) throw new Error("no cave");
    carveArena(a, a.roomTiles.length - 1, 5);
    carveArena(b, b.roomTiles.length - 1, 5);
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
    expect(a.roomTiles).toEqual(b.roomTiles);
  });
});
