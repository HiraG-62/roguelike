import type { Vec } from "../core/vec";
import { type GameMap, type Rect, TILE_SIZE, Tile, createMap, setTile } from "./grid";

/** 拠点の台（設備）。記録室は履歴・図鑑・実績の 3 台に分かれる */
export const HUB_SPOT_KEYS = ["well", "board", "forge", "library", "altar", "garden", "history", "codex", "achievements"] as const;
export type HubSpotKey = (typeof HUB_SPOT_KEYS)[number];

export interface HubLayout {
  map: GameMap;
  spots: Readonly<Record<HubSpotKey, Vec>>;
  dummySpots: readonly Vec[];
  playerStart: Vec;
}

/**
 * 拠点の固定配置。'#' = 壁、'.' = 床、他の文字は床の上の台・木人・開始位置。
 * 台どうしは HUB.interactRadius の 2 倍より離し、近い台が 1 つに決まるようにする
 */
const HUB_ASCII: readonly string[] = [
  "##############################",
  "#............................#",
  "#..F......L.......A......G...#",
  "#............................#",
  "#............................#",
  "#..H...C...R.................#",
  "#............................#",
  "#................D...D...D...#",
  "#............................#",
  "#..B.........................#",
  "#............................#",
  "#.............P..............#",
  "#............................#",
  "#..............W.............#",
  "#............................#",
  "#............................#",
  "##############################",
];

const SPOT_CHAR: Readonly<Record<string, HubSpotKey>> = {
  W: "well",
  B: "board",
  F: "forge",
  L: "library",
  A: "altar",
  G: "garden",
  H: "history",
  C: "codex",
  R: "achievements",
};

const DUMMY_CHAR = "D";
const START_CHAR = "P";
const WALL_CHAR = "#";

function tileCenterPx(x: number, y: number): Vec {
  return { x: (x + 0.5) * TILE_SIZE, y: (y + 0.5) * TILE_SIZE };
}

/** 固定配置の拠点マップ。純関数で乱数を使わない */
export function buildHubMap(): HubLayout {
  const height = HUB_ASCII.length;
  const width = Math.max(...HUB_ASCII.map((row) => row.length));
  const map = createMap(width, height);
  const spots: Partial<Record<HubSpotKey, Vec>> = {};
  const dummySpots: Vec[] = [];
  let playerStart: Vec | null = null;
  HUB_ASCII.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === WALL_CHAR) return;
      setTile(map, x, y, Tile.Floor);
      const spot = SPOT_CHAR[ch];
      if (spot) spots[spot] = tileCenterPx(x, y);
      else if (ch === DUMMY_CHAR) dummySpots.push(tileCenterPx(x, y));
      else if (ch === START_CHAR) playerStart = tileCenterPx(x, y);
    });
  });
  // 1 部屋 = 外周の壁を除いた 1 つの矩形
  const room: Rect = { x: 1, y: 1, w: width - 2, h: height - 2 };
  map.rooms = [room];
  return { map, spots: completeSpots(spots), dummySpots, playerStart: playerStart ?? tileCenterPx(room.x, room.y) };
}

/** 配置表の書き漏れはテストで気付けるよう throw する */
function completeSpots(spots: Partial<Record<HubSpotKey, Vec>>): Record<HubSpotKey, Vec> {
  const out = {} as Record<HubSpotKey, Vec>;
  for (const key of HUB_SPOT_KEYS) {
    const pos = spots[key];
    if (!pos) throw new Error(`拠点の配置に台が無い: ${key}`);
    out[key] = pos;
  }
  return out;
}
