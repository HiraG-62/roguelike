import { terrainCode } from "../../core/terrain";
import { LORD_HALL } from "../../data/tuning";
import { type GameMap, type Rect, Tile, createMap } from "../grid";
import { LORD_ANTE_GRID, LORD_ENTRY_GRID, LORD_HALL_GRIDS } from "./lordHallGrids";

/**
 * ボス階の専用の部屋（階の型 "lordHall"。設計は docs/ideas/lordhall-design.md）。
 * 入口の間 → 参道 → 前室 → 門の通路 → 主の間を 1 本道で横に並べる。手描きの格子を置くだけで乱数を引かない。
 */

export type LordHallKey = "alcoves" | "pits" | "pillars" | "island" | "plain";

/** ボスの key → 主の間の形。表に無い key（最深の主・深みの回転）は "plain"。専用の間は 1 行足せば差し替わる */
export const LORD_HALL_OF: Readonly<Record<string, LordHallKey>> = {
  kingSlime: "alcoves",
  thiefKing: "pits",
  oilKing: "pillars",
  mirrorKnight: "island",
  deepLord: "plain",
};

export function lordHallKeyOf(bossKey: string): LordHallKey {
  return LORD_HALL_OF[bossKey] ?? "plain";
}

/** 格子の文字 */
const CH = {
  wall: "#",
  floor: ".",
  lord: "@",
  path: ",",
  pit: "_",
  pillar: "o",
  shallow: "~",
} as const;

/** 部屋の格子を置く位置 */
interface Placement {
  grid: readonly string[];
  x: number;
  y: number;
}

/** 部屋に属する文字（床 + 主の立つ所 + 浅い水） */
function isRoomChar(ch: string): boolean {
  return ch === CH.floor || ch === CH.lord || ch === CH.shallow;
}

function gridWidth(grid: readonly string[]): number {
  return grid[0]?.length ?? 0;
}

/** 主の立つ所（@）の行。門の通路と他の部屋の中段をここへ揃える */
function lordRow(grid: readonly string[]): number {
  const row = grid.findIndex((line) => line.includes(CH.lord));
  return row < 0 ? Math.floor(grid.length / 2) : row;
}

/** 床の外接矩形。主の間の rect の契約（奇数 × 奇数・中心 = 主の立つ所）を格子に守らせる */
function boundsOf(map: GameMap, tiles: readonly number[]): Rect {
  let minX = map.width;
  let minY = map.height;
  let maxX = 0;
  let maxY = 0;
  for (const i of tiles) {
    const x = i % map.width;
    const y = Math.floor(i / map.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** 格子を地図へ写し、所属タイル（昇順）を返す */
function stamp(map: GameMap, shallow: Uint8Array, place: Placement): number[] {
  const owned: number[] = [];
  const water = terrainCode("water");
  place.grid.forEach((line, gy) => {
    for (let gx = 0; gx < line.length; gx++) {
      const ch = line.charAt(gx);
      if (ch === CH.wall || ch === CH.pillar) continue;
      const i = (place.y + gy) * map.width + place.x + gx;
      if (ch === CH.pit) map.tiles[i] = Tile.Pit;
      else if (ch === CH.path) map.tiles[i] = Tile.Floor;
      else if (isRoomChar(ch)) map.tiles[i] = Tile.Floor;
      else throw new Error(`lordHall: 知らない文字 "${ch}"`);
      if (ch === CH.shallow) shallow[i] = water;
      if (isRoomChar(ch)) owned.push(i);
    }
  });
  return owned;
}

/** x0 から length タイルの通路（幅 corridorWidth、中段 midRow に揃える）。どの部屋にも属さない */
function carveCorridor(map: GameMap, x0: number, length: number, midRow: number): void {
  const half = Math.floor(LORD_HALL.corridorWidth / 2);
  for (let x = x0; x < x0 + length; x++) {
    for (let y = midRow - half; y <= midRow + half; y++) map.tiles[y * map.width + x] = Tile.Floor;
  }
}

/**
 * ボス階の地図。rooms = [入口, 前室, 主の間]、全部屋が roomTiles を持ち、layout = "lordHall"。階段はまだ置かない。
 * 主の間の rect は床の外接矩形（中心 = 主の立つ所）。乱数を引かない
 */
export function generateLordHallMap(bossKey: string): GameMap {
  const hall = LORD_HALL_GRIDS[lordHallKeyOf(bossKey)];
  const { margin, entryLength, gateLength } = LORD_HALL;
  const midRow = margin + lordRow(hall);

  const entryX = margin;
  const anteX = entryX + gridWidth(LORD_ENTRY_GRID) + entryLength;
  const hallX = anteX + gridWidth(LORD_ANTE_GRID) + gateLength;
  const map = createMap(hallX + gridWidth(hall) + margin, hall.length + margin * 2);
  const shallow = new Uint8Array(map.width * map.height);

  const placements: Placement[] = [
    { grid: LORD_ENTRY_GRID, x: entryX, y: midRow - Math.floor(LORD_ENTRY_GRID.length / 2) },
    { grid: LORD_ANTE_GRID, x: anteX, y: midRow - Math.floor(LORD_ANTE_GRID.length / 2) },
    { grid: hall, x: hallX, y: margin },
  ];
  const roomTiles = placements.map((place) => stamp(map, shallow, place));
  carveCorridor(map, anteX - entryLength, entryLength, midRow);
  carveCorridor(map, hallX - gateLength, gateLength, midRow);

  map.rooms = roomTiles.map((tiles) => boundsOf(map, tiles));
  map.roomTiles = roomTiles;
  if (shallow.some((v) => v !== 0)) map.shallow = shallow;
  map.layout = "lordHall";
  return map;
}
