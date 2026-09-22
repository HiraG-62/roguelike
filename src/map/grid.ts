/** タイル種別。数値にしておくと 1 次元配列（Uint8Array）に詰められる */
export const Tile = {
  Wall: 0,
  Floor: 1,
  StairsDown: 2,
} as const;
export type Tile = (typeof Tile)[keyof typeof Tile];

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** マップは 1 次元配列 + インデックス計算で扱う */
export interface GameMap {
  width: number;
  height: number;
  tiles: Uint8Array;
  rooms: Rect[];
}

export function createMap(width: number, height: number): GameMap {
  return {
    width,
    height,
    tiles: new Uint8Array(width * height).fill(Tile.Wall),
    rooms: [],
  };
}

export function toIndex(map: GameMap, x: number, y: number): number {
  return y * map.width + x;
}

export function inBounds(map: GameMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

export function getTile(map: GameMap, x: number, y: number): Tile {
  if (!inBounds(map, x, y)) return Tile.Wall;
  return (map.tiles[toIndex(map, x, y)] ?? Tile.Wall) as Tile;
}

export function setTile(map: GameMap, x: number, y: number, tile: Tile): void {
  if (!inBounds(map, x, y)) return;
  map.tiles[toIndex(map, x, y)] = tile;
}

export function isWalkable(map: GameMap, x: number, y: number): boolean {
  return getTile(map, x, y) !== Tile.Wall;
}

export function rectCenter(r: Rect): Point {
  return { x: Math.floor(r.x + r.w / 2), y: Math.floor(r.y + r.h / 2) };
}

/** 1 マスの隙間を挟んでも重ならないよう、余白付きで判定する */
export function rectsIntersect(a: Rect, b: Rect, margin = 1): boolean {
  return (
    a.x - margin < b.x + b.w &&
    a.x + a.w + margin > b.x &&
    a.y - margin < b.y + b.h &&
    a.y + a.h + margin > b.y
  );
}
