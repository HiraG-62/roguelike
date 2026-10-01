import type { Vec } from "../core/vec";
import { type GameMap, type Rect, TILE_SIZE, Tile, createMap, setTile } from "./grid";

/** 拠点の台（設備）。記録室は履歴・図鑑・実績の 3 台に分かれる。rack は武器掛け */
export const HUB_SPOT_KEYS = ["well", "board", "forge", "library", "altar", "garden", "history", "codex", "achievements", "rack", "hall"] as const;
export type HubSpotKey = (typeof HUB_SPOT_KEYS)[number];

/**
 * 門前町の敷地（建物・区画）。当たりでは壁、見た目用の地図 ground では床（docs/ideas/hub-town-impl.md 3 章）。
 * shrine = 社（祭壇）/ hall = 御堂（ボスの間）/ archive = 記録の蔵 / rackShed = 武器小屋 / yard = 稽古場（訓練場。当たりは床）
 */
export const HUB_LOT_KEYS = ["shrine", "hall", "forge", "library", "well", "board", "archive", "garden", "rackShed", "yard"] as const;
export type HubLotKey = (typeof HUB_LOT_KEYS)[number];

export interface HubLayout {
  /** 当たりの地図（敷地・灯籠・鳥居の柱は壁） */
  map: GameMap;
  /** 見た目用の地図（敷地・灯籠・鳥居の柱を床にした写し）。迷宮のチャンク焼き付けに渡す */
  ground: GameMap;
  spots: Readonly<Record<HubSpotKey, Vec>>;
  dummySpots: readonly Vec[];
  playerStart: Vec;
  /** 敷地の矩形（タイル）。建物の絵の置き場所 */
  lots: Readonly<Record<HubLotKey, Rect>>;
  /** 鳥居の絵を掛ける矩形（タイル） */
  gate: Rect;
  /** 石段（出撃の口）。プレイヤーが入ると出撃する矩形（タイル） */
  gateZone: Rect;
  /** 参道・辻の石畳の矩形（タイル。見た目だけで当たりは床） */
  roads: readonly Rect[];
  /** 参道の灯籠を置く点（px。進行で前から順に灯籠が増える。当たりは無い） */
  lanternSlots: readonly Vec[];
  /** 賑わいの小物（樽・荷車・洗濯物・猫）を置く点（px。前から順に使う） */
  clutterSlots: readonly Vec[];
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
  "#..H...C...R............X....#",
  "#............................#",
  "#............K...D...D...D...#",
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
  // 武器掛けは試し振りの相手（木人）のすぐ横
  K: "rack",
  // ボスの間は記録室の並びの右（倒したボスの記録を読む台の続き）
  X: "hall",
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
  // 段 0 の仮置き: 門前町の配置（レーン A）が入るまで、敷地・門・道は空
  const none: Rect = { x: 0, y: 0, w: 0, h: 0 };
  const lots = Object.fromEntries(HUB_LOT_KEYS.map((k) => [k, none])) as Record<HubLotKey, Rect>;
  return {
    map,
    ground: map,
    spots: completeSpots(spots),
    dummySpots,
    playerStart: playerStart ?? tileCenterPx(room.x, room.y),
    lots,
    gate: none,
    gateZone: none,
    roads: [],
    lanternSlots: [],
    clutterSlots: [],
  };
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
