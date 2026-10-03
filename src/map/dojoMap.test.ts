import { describe, expect, it } from "vitest";
import { DOJO } from "../data/tuning";
import { DOJO_MAP_H, DOJO_MAP_W, DOJO_SPOT_KEYS, buildDojoMap } from "./dojoMap";
import { TILE_SIZE, Tile, getTile } from "./grid";

function tileAt(px: number): number {
  return Math.floor(px / TILE_SIZE);
}

function walkable(t: Tile | undefined): boolean {
  return t === Tile.Floor || t === Tile.Fountain;
}

describe("稽古の間の地図", () => {
  it("外周が壁で、内側は歩ける", () => {
    const { map } = buildDojoMap();
    for (let x = 0; x < DOJO_MAP_W; x++) {
      expect(getTile(map, x, 0)).toBe(Tile.Wall);
      expect(getTile(map, x, DOJO_MAP_H - 1)).toBe(Tile.Wall);
    }
    for (let y = 0; y < DOJO_MAP_H; y++) {
      expect(getTile(map, 0, y)).toBe(Tile.Wall);
      expect(getTile(map, DOJO_MAP_W - 1, y)).toBe(Tile.Wall);
    }
    for (let y = 1; y < DOJO_MAP_H - 1; y++) {
      for (let x = 1; x < DOJO_MAP_W - 1; x++) expect(walkable(getTile(map, x, y)), `${x},${y}`).toBe(true);
    }
    expect(map.rooms.length).toBe(1);
  });

  it("手水鉢は泉のタイル", () => {
    const { map, spots } = buildDojoMap();
    expect(getTile(map, tileAt(spots.spring.x), tileAt(spots.spring.y))).toBe(Tile.Fountain);
  });

  it("台どうしは近づいたと見なす距離の 2 倍より離れている", () => {
    const { spots } = buildDojoMap();
    for (const a of DOJO_SPOT_KEYS) {
      for (const b of DOJO_SPOT_KEYS) {
        if (a >= b) continue;
        const d = Math.hypot(spots[a].x - spots[b].x, spots[a].y - spots[b].y);
        expect(d, `${a}-${b}`).toBeGreaterThan(DOJO.interactRadius * 2);
      }
    }
  });

  it("自分の立ち位置は台から離れた床で、敵の並びの基準と同じ", () => {
    const { map, spots, playerStart, anchor, facing } = buildDojoMap();
    expect(walkable(getTile(map, tileAt(playerStart.x), tileAt(playerStart.y)))).toBe(true);
    expect(anchor).toEqual(playerStart);
    expect(Math.hypot(facing.x, facing.y)).toBeCloseTo(1, 6);
    for (const key of DOJO_SPOT_KEYS) {
      const d = Math.hypot(spots[key].x - playerStart.x, spots[key].y - playerStart.y);
      expect(d, key).toBeGreaterThan(DOJO.interactRadius);
    }
  });

  it("囲む並びの最大の間合いでも円は壁に掛からない", () => {
    const { anchor } = buildDojoMap();
    const r = Math.max(...DOJO.distanceOptions);
    expect(anchor.x - r).toBeGreaterThan(TILE_SIZE);
    expect(anchor.y - r).toBeGreaterThan(TILE_SIZE);
    expect(anchor.x + r).toBeLessThan((DOJO_MAP_W - 1) * TILE_SIZE);
    expect(anchor.y + r).toBeLessThan((DOJO_MAP_H - 1) * TILE_SIZE);
  });
});
