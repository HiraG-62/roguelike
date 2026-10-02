import type { Rng } from "../core/rng";
import { CAVE, MAP_SIZE } from "../data/tuning";
import { type GameMap, Tile, createMap, inBounds, rectCenter, toIndex } from "./grid";
import {
  type Grid,
  NEIGHBORS_4,
  NEIGHBORS_8,
  buildRoom,
  floodFill,
  growRooms,
  orderFromStart,
  tilesOfOwners,
  wallDistance,
} from "./regions";

/**
 * 洞窟フロア: セルオートマトンで洞窟を作り、最大連結成分だけ残す。
 * 「開けた領域」（壁から openDist 以上離れた床）を flood fill で塊に分け、
 * 塊を roomGrow マスだけ膨らませたものを部屋として登録する。膨らませきれない細い所が通路になる。
 * 純関数: 同じ rng 状態と options なら同じマップになる。部屋が足りなければ null。
 */

export interface CaveOptions {
  width: number;
  height: number;
  /** 初期状態で壁にする確率 */
  fillChance: number;
  smoothSteps: number;
  /** 周囲 8 マスの壁がこの数以上なら壁になる */
  wallBirth: number;
  /** 壁は周囲 8 マスの壁がこの数以上なら壁のまま */
  wallSurvive: number;
  /** 壁からのチェビシェフ距離がこれ以上の床を「開けた領域」とみなす */
  openDist: number;
  /** 部屋として採用する開けた領域の最小タイル数 */
  minRoomTiles: number;
  /** 開けた領域から部屋を膨らませるマス数 */
  roomGrow: number;
  maxRooms: number;
  minRooms: number;
  /** 幅 1 の通路を 1 マスずつ太らせる回数（0 なら細い道がそのまま残る） */
  widen: number;
}

/** 洞窟の数値のうちバイオームで上書きできるもの（幅・高さはマップの大きさなので除く） */
export type CaveShapeOptions = Omit<CaveOptions, "width" | "height">;

export const DEFAULT_CAVE_OPTIONS: CaveOptions = {
  width: MAP_SIZE.baseWidth,
  height: MAP_SIZE.baseHeight,
  ...CAVE.base,
};

const WALL = 1;
const FLOOR = 0;

export function generateCave(rng: Rng, options: CaveOptions = DEFAULT_CAVE_OPTIONS): GameMap | null {
  const grid = randomFill(rng, options);
  for (let i = 0; i < options.smoothSteps; i++) grid.cells = smooth(grid, options);
  keepLargestRegion(grid);
  // 床に隣接する壁だけを削るので、連結は保たれる
  for (let i = 0; i < options.widen; i++) grid.cells = widenPassages(grid);

  const dist = wallDistance(grid);
  const regions = openRegions(grid, dist, options);
  if (regions.length < options.minRooms) return null;
  const owners = growRooms(grid, regions, options.roomGrow);

  const map = createMap(grid.w, grid.h);
  for (let i = 0; i < grid.cells.length; i++) map.tiles[i] = grid.cells[i] === FLOOR ? Tile.Floor : Tile.Wall;

  const tilesByOwner = tilesOfOwners(owners, regions.length);
  const rooms = regions.map((region, id) => buildRoom(map, region, dist, tilesByOwner[id] ?? []));
  const ordered = orderFromStart(grid, rooms);
  map.rooms = ordered.map((r) => r.rect);
  map.roomTiles = ordered.map((r) => r.tiles);
  const last = ordered[ordered.length - 1];
  if (last) map.tiles[last.core] = Tile.StairsDown;
  return map;
}

function randomFill(rng: Rng, options: CaveOptions): Grid {
  const { width: w, height: h } = options;
  const cells = new Uint8Array(w * h).fill(WALL);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      cells[y * w + x] = rng.chance(options.fillChance) ? WALL : FLOOR;
    }
  }
  return { w, h, cells };
}

function isBorder(g: Grid, x: number, y: number): boolean {
  return x <= 0 || y <= 0 || x >= g.w - 1 || y >= g.h - 1;
}

/**
 * 内側（外周でない）タイルの周囲 8 マスの壁の数。外周は常に壁なので内側の 8 近傍は必ずマップ内にある。
 * 広いマップで smooth が生成時間の大半を占めるので、近傍の配列を回さず添字を直接足す（WALL = 1, FLOOR = 0）
 */
function innerWallCount(cells: Uint8Array, w: number, i: number): number {
  const up = i - w;
  const down = i + w;
  return (
    (cells[up - 1] ?? WALL) +
    (cells[up] ?? WALL) +
    (cells[up + 1] ?? WALL) +
    (cells[i - 1] ?? WALL) +
    (cells[i + 1] ?? WALL) +
    (cells[down - 1] ?? WALL) +
    (cells[down] ?? WALL) +
    (cells[down + 1] ?? WALL)
  );
}

function smooth(g: Grid, options: CaveOptions): Uint8Array {
  const next = new Uint8Array(g.cells.length).fill(WALL);
  for (let y = 1; y < g.h - 1; y++) {
    for (let x = 1; x < g.w - 1; x++) {
      const n = innerWallCount(g.cells, g.w, y * g.w + x);
      const wall = g.cells[y * g.w + x] === WALL;
      const becomesWall = n >= options.wallBirth || (wall && n >= options.wallSurvive);
      next[y * g.w + x] = becomesWall ? WALL : FLOOR;
    }
  }
  return next;
}

/**
 * 両側を壁に挟まれた床（幅 1 の通路）の片側の壁を削る。縦に挟まれていれば下、横なら右を削る
 * （どちらを削るかを乱数にしないのは、乱数消費を変えずに既存の洞窟の形を保つため）
 */
function widenPassages(g: Grid): Uint8Array {
  const next = g.cells.slice();
  const wallAt = (x: number, y: number): boolean => g.cells[y * g.w + x] === WALL;
  const carve = (x: number, y: number): void => {
    if (!isBorder(g, x, y)) next[y * g.w + x] = FLOOR;
  };
  for (let y = 1; y < g.h - 1; y++) {
    for (let x = 1; x < g.w - 1; x++) {
      if (wallAt(x, y)) continue;
      if (wallAt(x, y - 1) && wallAt(x, y + 1)) carve(x, y + 1);
      if (wallAt(x - 1, y) && wallAt(x + 1, y)) carve(x + 1, y);
    }
  }
  return next;
}

/** 4 近傍で最大の床連結成分だけ残し、他は壁で埋める */
function keepLargestRegion(g: Grid): void {
  const seen = new Uint8Array(g.cells.length);
  let best: number[] = [];
  for (let i = 0; i < g.cells.length; i++) {
    if (seen[i] || g.cells[i] !== FLOOR) continue;
    const region = floodFill(g, i, NEIGHBORS_4, (j) => g.cells[j] === FLOOR, seen);
    if (region.length > best.length) best = region;
  }
  g.cells.fill(WALL);
  for (const i of best) g.cells[i] = FLOOR;
}

/** 開けた領域を 8 近傍で塊に分ける。小さい塊は捨て、大きい順に maxRooms 個まで */
function openRegions(g: Grid, dist: Int16Array, options: CaveOptions): number[][] {
  const seen = new Uint8Array(g.cells.length);
  const isOpen = (i: number): boolean => (dist[i] ?? 0) >= options.openDist;
  const regions: number[][] = [];
  for (let i = 0; i < g.cells.length; i++) {
    if (seen[i] || !isOpen(i)) continue;
    const region = floodFill(g, i, NEIGHBORS_8, isOpen, seen);
    if (region.length >= options.minRoomTiles) regions.push(region);
  }
  // 安定ソート: 同じ大きさなら見つけた順
  return regions
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.length - a.r.length || a.i - b.i)
    .slice(0, options.maxRooms)
    .sort((a, b) => a.i - b.i)
    .map((e) => e.r);
}

/**
 * 洞窟の塊（system/floorLord.ts が置く最後の部屋）を、中心から radius マスの円で広げる。壁だけを床にする（穴は埋めない）。
 * 他の塊のタイルと 8 近傍で接するタイルと、マップの外周 1 マスは取らない（部屋同士が扉で封鎖できる間隔を保つ）。
 * 乱数を使わない純関数。rooms 型（roomTiles が無い）では何もしない
 */
export function carveArena(map: GameMap, roomIndex: number, radius: number): void {
  const tilesByRoom = map.roomTiles;
  const rect = map.rooms[roomIndex];
  const ownTiles = tilesByRoom?.[roomIndex];
  if (!tilesByRoom || !rect || !ownTiles) return;
  const owned = new Set<number>();
  tilesByRoom.forEach((tiles, i) => {
    if (i !== roomIndex) for (const t of tiles) owned.add(t);
  });
  const center = rectCenter(rect);
  const added: number[] = [];
  const rr = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > rr) continue;
      const x = center.x + dx;
      const y = center.y + dy;
      if (x <= 0 || y <= 0 || x >= map.width - 1 || y >= map.height - 1) continue;
      const i = toIndex(map, x, y);
      if (map.tiles[i] !== Tile.Wall) continue;
      if (touchesOwnedTile(map, owned, x, y)) continue;
      map.tiles[i] = Tile.Floor;
      added.push(i);
    }
  }
  if (added.length === 0) return;
  tilesByRoom[roomIndex] = [...ownTiles, ...added].sort((a, b) => a - b);
}

function touchesOwnedTile(map: GameMap, owned: ReadonlySet<number>, x: number, y: number): boolean {
  for (const [dx, dy] of NEIGHBORS_8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inBounds(map, nx, ny)) continue;
    if (owned.has(toIndex(map, nx, ny))) return true;
  }
  return false;
}
