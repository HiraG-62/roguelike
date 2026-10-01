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
 * 拠点（門前町）の固定配置 30x24（docs/ideas/hub-town-impl.md 3 章）。
 * '#' = 崖・塀 / '.' = 土の道 / '=' = 参道・辻の石畳（床）/ 'S' = 石段（出撃の口。床）/
 * '|' = 鳥居の柱（当たりは壁、ground では床）/ 大文字（LOT_CHAR）= 建物の敷地（当たりは壁、ground では床）/
 * 小文字（SPOT_CHAR）= 台（扉の前の床）/ 'D' = 木人 / 'P' = 開始位置。
 * 台どうしは HUB.interactRadius の 2 倍より離し、近い台が 1 つに決まるようにする。
 * 設計の図からの変更: 井戸の台を東隣 (11,7) → 南 (10,8)、庭の台を東隣 (9,20) → 南 (8,22) へ
 * （台は自分の敷地の南 1 マスに揃える）
 */
const HUB_ASCII: readonly string[] = [
  "##############################",
  "###AAAAA#####SSSS#####XXXXX###",
  "###AAAAA#####SSSS#####XXXXX###",
  "#..AAAAA....|====|....XXXXX..#",
  "#....a.......====.......x....#",
  "#............====............#",
  "#.FFFFF..WW..=P==.....LLLLL..#",
  "#.FFFFF..WW..====.....LLLLL..#",
  "#.FFFFF...w..====.....LLLLL..#",
  "#...f........====.......l....#",
  "#............====..BB........#",
  "#==================b=========#",
  "#............====............#",
  "#.KKKKKKKKK..====..RRR.......#",
  "#.KKKKKKKKK..====..RRR.......#",
  "#.KKKKKKKKK..====...k........#",
  "#..h..c..r...====....D..D....#",
  "#............====............#",
  "#............====.....D......#",
  "#..GGGGGG....====............#",
  "#..GGGGGG....====............#",
  "#..GGGGGG....====............#",
  "#.......g....====............#",
  "##############################",
];

const SPOT_CHAR: Readonly<Record<string, HubSpotKey>> = {
  w: "well",
  b: "board",
  f: "forge",
  l: "library",
  a: "altar",
  g: "garden",
  h: "history",
  c: "codex",
  r: "achievements",
  // 武器掛けは試し振りの相手（木人）のすぐ横
  k: "rack",
  // ボスの間は書庫と同じ東の並び（倒したボスの記録を読む台の続き）
  x: "hall",
};

/** 敷地の文字。稽古場（yard）は当たりが床なので配置図に文字を持たず、YARD で矩形だけ持つ */
const LOT_CHAR: Readonly<Record<string, Exclude<HubLotKey, "yard">>> = {
  A: "shrine",
  X: "hall",
  F: "forge",
  L: "library",
  W: "well",
  B: "board",
  K: "archive",
  G: "garden",
  R: "rackShed",
};

/** 稽古場（右下 18〜28 列・12〜22 行）。武器小屋と木人 3 体を含み、小屋の所だけが当たりの壁 */
const YARD: Rect = { x: 18, y: 12, w: 11, h: 11 };
/** 鳥居の絵を掛ける矩形。柱は 12・17 列の 3 行目（'|'）、その間が参道 */
const GATE: Rect = { x: 12, y: 1, w: 6, h: 3 };
/** 参道（縦）と辻（横）。辻の行は配置図の 11 行目 */
const ROADS: readonly Rect[] = [
  { x: 13, y: 3, w: 4, h: 20 },
  { x: 1, y: 11, w: 28, h: 1 },
];

type TileXY = readonly [number, number];

/**
 * 参道の灯籠を置く床。門に近い順、左右 1 組ずつ（12・17 列 = 参道の両脇）。
 * 辻（11 行）と台の前を避ける。灯籠に当たりは無い（灯籠の絵は lanternSlots に描き、当たりの壁は置かない。絵の無い見えない壁を作らないため）
 */
const LANTERN_TILES: readonly TileXY[] = [
  [12, 5], [17, 5], [12, 8], [17, 8], [12, 13], [17, 13], [12, 16], [17, 16],
];
/** 賑わいの小物の床。道の脇で、台・木人・灯籠と重ならない。前から順に使う */
const CLUTTER_TILES: readonly TileXY[] = [
  [11, 10], [18, 12], [12, 17], [18, 17], [11, 21], [17, 21],
];

const DUMMY_CHAR = "D";
const START_CHAR = "P";
const WALL_CHAR = "#";
const GATE_CHAR = "S";
/** 当たりでは壁で、ground（見た目）では床になる敷地以外の文字: 鳥居の柱と石灯籠 */
const PROP_WALL_CHARS = "|t";

function tileCenterPx(x: number, y: number): Vec {
  return { x: (x + 0.5) * TILE_SIZE, y: (y + 0.5) * TILE_SIZE };
}

/** マスの集まりの外接矩形。敷地の矩形を配置図から導く（図と矩形がずれない） */
function boundingRect(cells: readonly TileXY[]): Rect {
  const xs = cells.map(([x]) => x);
  const ys = cells.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x + 1, h: Math.max(...ys) - y + 1 };
}

/** 固定配置の拠点マップ。純関数で乱数を使わない */
export function buildHubMap(): HubLayout {
  const height = HUB_ASCII.length;
  const width = Math.max(...HUB_ASCII.map((row) => row.length));
  const map = createMap(width, height);
  const ground = createMap(width, height);
  const spots: Partial<Record<HubSpotKey, Vec>> = {};
  const dummySpots: Vec[] = [];
  const lotCells: Partial<Record<HubLotKey, TileXY[]>> = {};
  const gateCells: TileXY[] = [];
  let playerStart: Vec | null = null;
  HUB_ASCII.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === WALL_CHAR) return;
      setTile(ground, x, y, Tile.Floor);
      const lot = LOT_CHAR[ch];
      if (lot) {
        (lotCells[lot] ??= []).push([x, y]);
        return;
      }
      if (PROP_WALL_CHARS.includes(ch)) return;
      setTile(map, x, y, Tile.Floor);
      const spot = SPOT_CHAR[ch];
      if (spot) spots[spot] = tileCenterPx(x, y);
      else if (ch === DUMMY_CHAR) dummySpots.push(tileCenterPx(x, y));
      else if (ch === START_CHAR) playerStart = tileCenterPx(x, y);
      else if (ch === GATE_CHAR) gateCells.push([x, y]);
    });
  });
  // 1 部屋 = 外周の壁を除いた 1 つの矩形（拠点の敵・カメラが部屋 0 を前提にしている）
  const room: Rect = { x: 1, y: 1, w: width - 2, h: height - 2 };
  map.rooms = [room];
  ground.rooms = [room];
  return {
    map,
    ground,
    spots: completeSpots(spots),
    dummySpots,
    playerStart: playerStart ?? tileCenterPx(room.x, room.y),
    lots: completeLots(lotCells),
    gate: GATE,
    gateZone: boundingRect(gateCells),
    roads: ROADS,
    lanternSlots: LANTERN_TILES.map(([x, y]) => tileCenterPx(x, y)),
    clutterSlots: CLUTTER_TILES.map(([x, y]) => tileCenterPx(x, y)),
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

function completeLots(cells: Partial<Record<HubLotKey, TileXY[]>>): Record<HubLotKey, Rect> {
  const out = {} as Record<HubLotKey, Rect>;
  for (const key of HUB_LOT_KEYS) {
    if (key === "yard") {
      out[key] = YARD;
      continue;
    }
    const list = cells[key];
    if (!list || list.length === 0) throw new Error(`拠点の配置に敷地が無い: ${key}`);
    out[key] = boundingRect(list);
  }
  return out;
}
