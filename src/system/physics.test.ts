import { describe, expect, it } from "vitest";
import { boxCircleOverlap, moveBody, overlapsWall } from "./physics";
import { createMap, setTile, Tile, TILE_SIZE, toIndex } from "../map/grid";
import type { Body, GameState } from "../core/state";

/** 物理だけをテストするための最小ステート */
function arena(rows: string[]): GameState {
  const map = createMap(rows[0]?.length ?? 0, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      setTile(map, x, y, row[x] === "#" ? Tile.Wall : Tile.Floor);
    }
  });
  return { map, lockedTiles: new Set<number>() } as unknown as GameState;
}

function bodyAt(x: number, y: number, radius = 6): Body {
  return { pos: { x, y }, vel: { x: 0, y: 0 }, radius };
}

describe("moveBody", () => {
  it("壁に向かって動くと手前で止まる", () => {
    const state = arena(["#####", "#...#", "#####"]);
    const body = bodyAt(TILE_SIZE * 1.5, TILE_SIZE * 1.5);
    const result = moveBody(state, body, TILE_SIZE * 10, 0);
    expect(result.hitX).toBe(true);
    // 壁タイル (x=4) の左端 64 より内側で止まる
    expect(body.pos.x + body.radius).toBeLessThanOrEqual(TILE_SIZE * 4);
    expect(body.pos.x + body.radius).toBeGreaterThan(TILE_SIZE * 4 - 8);
  });

  it("開けた場所では要求どおり動く", () => {
    const state = arena(["#######", "#.....#", "#######"]);
    const body = bodyAt(TILE_SIZE * 1.5, TILE_SIZE * 1.5);
    moveBody(state, body, 20, 0);
    expect(body.pos.x).toBeCloseTo(TILE_SIZE * 1.5 + 20);
  });

  it("ロックされた扉タイルは壁として扱う", () => {
    const state = arena(["#######", "#.....#", "#######"]);
    state.lockedTiles.add(toIndex(state.map, 3, 1));
    const body = bodyAt(TILE_SIZE * 1.5, TILE_SIZE * 1.5);
    const result = moveBody(state, body, TILE_SIZE * 3, 0);
    expect(result.hitX).toBe(true);
    expect(overlapsWall(state, body.pos.x, body.pos.y, body.radius)).toBe(false);
  });
});

describe("boxCircleOverlap", () => {
  it("矩形の角付近は円の半径で判定する", () => {
    const box = { x: 0, y: 0, w: 10, h: 10 };
    expect(boxCircleOverlap(box, 12, 12, 3)).toBe(true);
    expect(boxCircleOverlap(box, 14, 14, 3)).toBe(false);
  });
});
