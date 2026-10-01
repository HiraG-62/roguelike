import { describe, expect, it } from "vitest";
import { Tile, createMap } from "./grid";
import { Cell } from "./layout/types";
import { CONTESTED, type Grid, NO_OWNER, buildRoom, floodFill, growRooms, NEIGHBORS_4, orderFromStart, tilesOfOwners, wallDistance } from "./regions";

/** '#' = 壁、'.' = 床、'~' = 穴 */
function gridOf(rows: readonly string[]): Grid {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const cells = new Uint8Array(w * h);
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) cells[y * w + x] = row[x] === "." ? Cell.Floor : row[x] === "~" ? Cell.Pit : Cell.Wall;
  });
  return { w, h, cells };
}

describe("wallDistance", () => {
  it("壁は 0、床は最寄りの壁までのチェビシェフ距離", () => {
    const g = gridOf(["#####", "#...#", "#...#", "#...#", "#####"]);
    const d = wallDistance(g);
    expect(d[0]).toBe(0);
    expect(d[1 * 5 + 1]).toBe(1);
    expect(d[2 * 5 + 2], "中央は壁から 2").toBe(2);
  });

  it("穴は壁と同じに扱う（穴の縁は壁から 1 の距離）", () => {
    const g = gridOf(["#######", "#.....#", "#..~..#", "#.....#", "#######"]);
    const d = wallDistance(g);
    expect(d[2 * 7 + 3], "穴そのものは 0").toBe(0);
    expect(d[2 * 7 + 2], "穴の隣は 1").toBe(1);
    expect(d[1 * 7 + 3]).toBe(1);
  });
});

describe("growRooms", () => {
  const OPEN = gridOf(["###############", "#.............#", "#.............#", "#.............#", "#.............#", "#.............#", "###############"]);
  const at = (x: number, y: number): number => y * 15 + x;

  it("grow が数なら全部の塊を同じ幅だけ 4 近傍で膨らませる", () => {
    const owner = growRooms(OPEN, [[at(3, 3)]], 2);
    expect(owner[at(3, 3)]).toBe(0);
    expect(owner[at(5, 3)], "2 マス先まで").toBe(0);
    expect(owner[at(6, 3)]).toBe(NO_OWNER);
    expect(owner[at(4, 4)], "斜めは 2 手").toBe(0);
    expect(owner[at(5, 4)], "斜め 3 手は届かない").toBe(NO_OWNER);
  });

  it("grow が配列なら塊ごとの幅で膨らむ（0 なら種のまま）。数と同じ値の配列は数と同じ結果", () => {
    const seeds = [[at(2, 3)], [at(12, 3)]];
    const owner = growRooms(OPEN, seeds, [0, 3]);
    expect(owner[at(3, 3)], "0 の塊は育たない").toBe(NO_OWNER);
    expect(owner[at(9, 3)], "3 の塊は 3 マス先まで").toBe(1);
    expect(owner[at(8, 3)]).toBe(NO_OWNER);
    expect(Array.from(growRooms(OPEN, seeds, [2, 2]))).toEqual(Array.from(growRooms(OPEN, seeds, 2)));
  });

  it("別の部屋と 8 近傍で接するタイルはどちらにも入れない", () => {
    const owner = growRooms(OPEN, [[at(3, 3)], [at(7, 3)]], 5);
    expect(owner[at(5, 3)], "真ん中の列は取り合いで空く").toBe(CONTESTED);
    const mine = Array.from(owner).filter((o) => o === 0).length;
    expect(mine).toBeGreaterThan(1);
    for (let i = 0; i < owner.length; i++) {
      if (owner[i] !== 0) continue;
      for (const [dx, dy] of [...NEIGHBORS_4, [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        expect(owner[i + dy * 15 + dx], `タイル ${i} の隣`).not.toBe(1);
      }
    }
  });

  it("穴と壁には育たない", () => {
    const g = gridOf(["#######", "#..~..#", "#######"]);
    const owner = growRooms(g, [[1 * 7 + 1]], 9);
    expect(owner[1 * 7 + 2]).toBe(0);
    expect(owner[1 * 7 + 3], "穴").toBe(NO_OWNER);
    expect(owner[1 * 7 + 4], "穴の向こうへは届かない").toBe(NO_OWNER);
  });
});

describe("tilesOfOwners / floodFill / buildRoom / orderFromStart", () => {
  it("tilesOfOwners は所属ごとにタイルを昇順で振り分け、所属なし・取り合いは入れない", () => {
    const owners = Int16Array.from([0, 1, NO_OWNER, 0, CONTESTED, 1]);
    expect(tilesOfOwners(owners, 3)).toEqual([[0, 3], [1, 5], []]);
  });

  it("floodFill は pass を満たす連結タイルだけを返し、seen に印を付ける", () => {
    const g = gridOf(["#####", "#.#.#", "#####"]);
    const seen = new Uint8Array(g.cells.length);
    const out = floodFill(g, 1 * 5 + 1, NEIGHBORS_4, (i) => g.cells[i] === Cell.Floor, seen);
    expect(out).toEqual([1 * 5 + 1]);
    expect(seen[1 * 5 + 3], "別の塊には触れない").toBe(0);
  });

  it("buildRoom は壁から最も遠いタイルを核にし、内接する正方形を rect にする", () => {
    const g = gridOf(["#######", "#.....#", "#.....#", "#.....#", "#.....#", "#.....#", "#######"]);
    const map = createMap(7, 7);
    const dist = wallDistance(g);
    const tiles = [] as number[];
    for (let i = 0; i < g.cells.length; i++) if (g.cells[i] === Cell.Floor) tiles.push(i);
    const room = buildRoom(map, tiles, dist, tiles);
    expect(room.core, "5x5 の部屋の中心").toBe(3 * 7 + 3);
    expect(room.rect, "部屋全体に内接する").toEqual({ x: 1, y: 1, w: 5, h: 5 });
    expect(room.tiles).toBe(tiles);
    expect(map.tiles[room.core]).toBe(Tile.Wall);
  });

  it("orderFromStart は最初の部屋を先頭に、歩いて近い順に並べる", () => {
    const g = gridOf(["###########", "#.........#", "###########"]);
    const mk = (x: number) => ({ core: 1 * 11 + x, tiles: [1 * 11 + x], rect: { x, y: 1, w: 1, h: 1 } });
    const rooms = [mk(1), mk(9), mk(5), mk(3)];
    expect(orderFromStart(g, rooms).map((r) => r.rect.x)).toEqual([1, 3, 5, 9]);
  });
});
