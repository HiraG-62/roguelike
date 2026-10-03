import type { Vec } from "../core/vec";
import { type GameMap, type Rect, TILE_SIZE, Tile, createMap, setTile } from "./grid";

/**
 * 稽古の間の地図（docs/ideas/dojo.md）: 外周だけ壁の広い 1 部屋。西の壁沿いに台（手水鉢・武器掛け・稽古帳・戻り口）を
 * 縦に並べ、自分は中央より西に立つ。敵は自分の立ち位置（anchor）から東向き（facing）に並べる。純関数で乱数を使わない
 */

/** 稽古の間の台。spring（手水鉢）は触れるだけで満たす。他はインタラクトで開く */
export const DOJO_SPOT_KEYS = ["spring", "rack", "board", "exit"] as const;
export type DojoSpotKey = (typeof DOJO_SPOT_KEYS)[number];
/** インタラクトで開く台 */
export type DojoOpenSpotKey = Exclude<DojoSpotKey, "spring">;

/** 横 40 × 縦 26 タイル。囲む並びの最大の間合い（DOJO.distanceOptions の最大）が壁に掛からない広さ */
export const DOJO_MAP_W = 40;
export const DOJO_MAP_H = 26;

/** 台のタイル（西の壁から 3 列目に縦並び。台どうしは DOJO.interactRadius の 2 倍より離す。左下の設定の要約と重ならないよう北へ寄せる） */
const SPOT_TILES: Readonly<Record<DojoSpotKey, readonly [number, number]>> = {
  spring: [3, 4],
  rack: [3, 8],
  board: [3, 12],
  exit: [3, 16],
};
/** 自分の立ち位置（湧き位置で、敵を並べる基準） */
const START_TILE: readonly [number, number] = [16, 13];

export interface DojoLayout {
  map: GameMap;
  /** 台の中心（px） */
  spots: Readonly<Record<DojoSpotKey, Vec>>;
  playerStart: Vec;
  /** 敵を並べる基準の点（px）。自分の立ち位置と同じ */
  anchor: Vec;
  /** 敵の並びの向き（単位ベクトル）。横一列・散らばりはこの向きの先に並べる */
  facing: Vec;
}

function tileCenterPx([x, y]: readonly [number, number]): Vec {
  return { x: (x + 0.5) * TILE_SIZE, y: (y + 0.5) * TILE_SIZE };
}

export function buildDojoMap(): DojoLayout {
  const map = createMap(DOJO_MAP_W, DOJO_MAP_H);
  const room: Rect = { x: 1, y: 1, w: DOJO_MAP_W - 2, h: DOJO_MAP_H - 2 };
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) setTile(map, x, y, Tile.Floor);
  }
  // 手水鉢は泉のタイルで描く（歩ける。満たすのは system/dojo.ts が距離で見る）
  const [sx, sy] = SPOT_TILES.spring;
  setTile(map, sx, sy, Tile.Fountain);
  map.rooms = [room];
  const spots = {
    spring: tileCenterPx(SPOT_TILES.spring),
    rack: tileCenterPx(SPOT_TILES.rack),
    board: tileCenterPx(SPOT_TILES.board),
    exit: tileCenterPx(SPOT_TILES.exit),
  };
  const start = tileCenterPx(START_TILE);
  return { map, spots, playerStart: start, anchor: { ...start }, facing: { x: 1, y: 0 } };
}
