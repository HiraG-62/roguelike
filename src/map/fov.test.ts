import { describe, expect, it } from "vitest";
import { computeFov } from "./fov";
import { type GameMap, Tile, createMap, setTile, toIndex } from "./grid";

/** 文字列からテスト用マップを作る。# = 壁、それ以外 = 床 */
function mapFromRows(rows: string[]): GameMap {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const map = createMap(width, height);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      setTile(map, x, y, row[x] === "#" ? Tile.Wall : Tile.Floor);
    }
  });
  return map;
}

function isVisible(map: GameMap, fov: Uint8Array, x: number, y: number): boolean {
  return fov[toIndex(map, x, y)] === 1;
}

describe("computeFov", () => {
  it("起点は常に見える", () => {
    const map = mapFromRows(["#####", "#...#", "#...#", "#...#", "#####"]);
    const fov = computeFov(map, { x: 2, y: 2 }, 10);
    expect(isVisible(map, fov, 2, 2)).toBe(true);
  });

  it("開けた部屋では壁も含めて全て見える", () => {
    const map = mapFromRows(["#####", "#...#", "#...#", "#...#", "#####"]);
    const fov = computeFov(map, { x: 2, y: 2 }, 10);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        expect(isVisible(map, fov, x, y), `(${x},${y})`).toBe(true);
      }
    }
  });

  it("壁の向こう側は見えない", () => {
    const map = mapFromRows([
      "#########",
      "#.......#",
      "#...#...#",
      "#.......#",
      "#########",
    ]);
    // 起点 (1,2) から見て (4,2) の壁の真後ろ (6,2) は影になる
    const fov = computeFov(map, { x: 1, y: 2 }, 10);
    expect(isVisible(map, fov, 4, 2)).toBe(true);
    expect(isVisible(map, fov, 6, 2)).toBe(false);
    expect(isVisible(map, fov, 7, 2)).toBe(false);
  });

  it("視界半径の外は見えない", () => {
    const map = mapFromRows([
      "...........",
      "...........",
      "...........",
    ]);
    const fov = computeFov(map, { x: 0, y: 1 }, 3);
    expect(isVisible(map, fov, 2, 1)).toBe(true);
    expect(isVisible(map, fov, 5, 1)).toBe(false);
  });
});
