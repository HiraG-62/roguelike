import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { type GameMap, Tile, createMap, getTile, setTile, toIndex } from "./grid";
import { type HiddenRoomOptions, planHiddenRoom } from "./hidden";

/** 20x20 の全壁マップに、y=10 の横一直線の通路（x=1..18）を彫る */
function corridorMap(): GameMap {
  const map = createMap(20, 20);
  for (let x = 1; x <= 18; x++) setTile(map, x, 10, Tile.Floor);
  return map;
}

const START_TILE = (map: GameMap): number => toIndex(map, 1, 10);

function baseOptions(map: GameMap, overrides: Partial<HiddenRoomOptions> = {}): HiddenRoomOptions {
  return {
    w: 3,
    h: 2,
    minSteps: 5,
    avoidTiles: new Set<number>(),
    startTile: START_TILE(map),
    ...overrides,
  };
}

describe("planHiddenRoom", () => {
  it("ポケットのタイルはすべて壁で、外周 1 マスも壁", () => {
    const map = corridorMap();
    const rng = createRng(1);
    const plan = planHiddenRoom(map, rng, baseOptions(map));
    expect(plan).not.toBeNull();
    if (!plan) return;
    // ポケット本体と扉は全て壁（未開放）
    expect(getTile(map, plan.doorTile % map.width, Math.floor(plan.doorTile / map.width))).toBe(Tile.Wall);
    for (const t of plan.tiles) {
      expect(getTile(map, t % map.width, Math.floor(t / map.width))).toBe(Tile.Wall);
    }
    // ポケットを囲む外周 1 マス（扉側を除く）も壁
    const xs = plan.tiles.map((t) => t % map.width);
    const ys = plan.tiles.map((t) => Math.floor(t / map.width));
    const x0 = Math.min(...xs) - 1;
    const x1 = Math.max(...xs) + 1;
    const y0 = Math.min(...ys) - 1;
    const y1 = Math.max(...ys) + 1;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        expect(getTile(map, x, y)).toBe(Tile.Wall);
      }
    }
  });

  it("扉は床タイル（通路）に接する", () => {
    const map = corridorMap();
    const rng = createRng(1);
    const plan = planHiddenRoom(map, rng, baseOptions(map));
    expect(plan).not.toBeNull();
    if (!plan) return;
    const dx = plan.doorTile % map.width;
    const dy = Math.floor(plan.doorTile / map.width);
    const neighborsFloor = [
      getTile(map, dx + 1, dy),
      getTile(map, dx - 1, dy),
      getTile(map, dx, dy + 1),
      getTile(map, dx, dy - 1),
    ].some((t) => t === Tile.Floor);
    expect(neighborsFloor).toBe(true);
  });

  it("階段タイルはポケットの中に含まれる", () => {
    const map = corridorMap();
    const rng = createRng(1);
    const plan = planHiddenRoom(map, rng, baseOptions(map));
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(plan.tiles).toContain(plan.stairsTile);
  });

  it("開始位置からの歩数が minSteps 未満の通路には置かない", () => {
    const map = corridorMap();
    const rng = createRng(1);
    // 通路全体が 17 マスしかないので、minSteps を極端に大きくすると候補が無い
    const plan = planHiddenRoom(map, rng, baseOptions(map, { minSteps: 1000 }));
    expect(plan).toBeNull();
  });

  it("候補が無ければ null（ポケットが大きすぎてどこにも収まらない）", () => {
    const map = corridorMap();
    const rng = createRng(1);
    const plan = planHiddenRoom(map, rng, baseOptions(map, { w: 30, h: 30 }));
    expect(plan).toBeNull();
  });

  it("avoidTiles に入っている床タイルからは扉を出さない", () => {
    const map = corridorMap();
    const rng = createRng(1);
    // 通路の全タイルを avoid にすると候補が無くなる
    const avoid = new Set<number>();
    for (let x = 1; x <= 18; x++) avoid.add(toIndex(map, x, 10));
    const plan = planHiddenRoom(map, rng, baseOptions(map, { avoidTiles: avoid }));
    expect(plan).toBeNull();
  });

  it("同じ map・rng の状態なら同じ場所を選ぶ（決定的）", () => {
    const mapA = corridorMap();
    const mapB = corridorMap();
    const planA = planHiddenRoom(mapA, createRng(42), baseOptions(mapA));
    const planB = planHiddenRoom(mapB, createRng(42), baseOptions(mapB));
    expect(planA).toEqual(planB);
  });

  it("rng の seed が違えば違う場所を選び得る", () => {
    // 通路の左右どちら側からも扉が出せるよう、候補が複数生まれる広めの通路
    const map = createMap(30, 20);
    for (let x = 1; x <= 28; x++) setTile(map, x, 10, Tile.Floor);
    const opts = baseOptions(map, { startTile: toIndex(map, 1, 10), minSteps: 3 });
    const seen = new Set<string>();
    for (let seed = 0; seed < 20; seed++) {
      const plan = planHiddenRoom(map, createRng(seed), opts);
      if (plan) seen.add(`${plan.doorTile}`);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
