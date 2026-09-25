import type { Rng } from "../core/rng";
import { CAVE, MAP_SIZE } from "../data/tuning";
import { type GameMap, type Rect, Tile, createMap } from "./grid";

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
const NO_OWNER = -1;
/** 2 つの部屋に挟まれて、どちらにも入れないタイル */
const CONTESTED = -2;

const NEIGHBORS_4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

const NEIGHBORS_8 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

type Offsets = typeof NEIGHBORS_4 | typeof NEIGHBORS_8;

interface Grid {
  w: number;
  h: number;
  cells: Uint8Array;
}

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

/** start から offsets で繋がる、pass を満たすタイルを全て返す */
function floodFill(g: Grid, start: number, offsets: Offsets, pass: (i: number) => boolean, seen: Uint8Array): number[] {
  const out = [start];
  seen[start] = 1;
  for (let head = 0; head < out.length; head++) {
    const i = out[head] ?? 0;
    const x = i % g.w;
    const y = Math.floor(i / g.w);
    for (const [dx, dy] of offsets) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      const ni = ny * g.w + nx;
      if (seen[ni] || !pass(ni)) continue;
      seen[ni] = 1;
      out.push(ni);
    }
  }
  return out;
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

/** 各床から最寄りの壁までのチェビシェフ距離（壁は 0） */
function wallDistance(g: Grid): Int16Array {
  const dist = new Int16Array(g.cells.length).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < g.cells.length; i++) {
    if (g.cells[i] !== WALL) continue;
    dist[i] = 0;
    queue.push(i);
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head] ?? 0;
    const x = i % g.w;
    const y = Math.floor(i / g.w);
    for (const [dx, dy] of NEIGHBORS_8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      const ni = ny * g.w + nx;
      if (dist[ni] !== -1) continue;
      dist[ni] = (dist[i] ?? 0) + 1;
      queue.push(ni);
    }
  }
  return dist;
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
 * 塊を 4 近傍 BFS で grow マスまで同時に膨らませる。
 * 別の部屋のタイルと 8 近傍で接するタイルは取らない（部屋同士が必ず 1 マス以上離れ、扉で封鎖できる）
 */
function growRooms(g: Grid, regions: number[][], grow: number): Int16Array {
  const owner = new Int16Array(g.cells.length).fill(NO_OWNER);
  const depth = new Int16Array(g.cells.length);
  const queue: number[] = [];
  regions.forEach((region, id) => {
    for (const i of region) {
      owner[i] = id;
      queue.push(i);
    }
  });
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head] ?? 0;
    const id = owner[i] ?? NO_OWNER;
    const d = depth[i] ?? 0;
    if (d >= grow) continue;
    const x = i % g.w;
    const y = Math.floor(i / g.w);
    for (const [dx, dy] of NEIGHBORS_4) {
      const ni = (y + dy) * g.w + (x + dx);
      if (g.cells[ni] !== FLOOR || owner[ni] !== NO_OWNER) continue;
      if (touchesOtherOwner(g, owner, ni, id)) {
        owner[ni] = CONTESTED;
        continue;
      }
      owner[ni] = id;
      depth[ni] = d + 1;
      queue.push(ni);
    }
  }
  return owner;
}

function touchesOtherOwner(g: Grid, owner: Int16Array, i: number, id: number): boolean {
  const x = i % g.w;
  const y = Math.floor(i / g.w);
  for (const [dx, dy] of NEIGHBORS_8) {
    const o = owner[(y + dy) * g.w + (x + dx)] ?? NO_OWNER;
    if (o >= 0 && o !== id) return true;
  }
  return false;
}

interface CaveRoom {
  rect: Rect;
  tiles: number[];
  /** 壁から最も遠いタイル。rect の中心 */
  core: number;
}

/** 部屋ごとの所属タイル（昇順）。部屋ごとにマップ全体を走査すると広いマップで部屋数 × 面積になるので 1 回で振り分ける */
function tilesOfOwners(owners: Int16Array, count: number): number[][] {
  const out: number[][] = Array.from({ length: count }, () => []);
  for (let i = 0; i < owners.length; i++) {
    const o = owners[i] ?? NO_OWNER;
    if (o >= 0) out[o]?.push(i);
  }
  return out;
}

function buildRoom(map: GameMap, region: number[], dist: Int16Array, tiles: number[]): CaveRoom {
  let core = region[0] ?? 0;
  for (const i of region) if ((dist[i] ?? 0) > (dist[core] ?? 0)) core = i;
  // 核から dist-1 マス以内は全て床（チェビシェフ距離の定義から）
  const half = Math.max(0, (dist[core] ?? 1) - 1);
  const cx = core % map.width;
  const cy = Math.floor(core / map.width);
  const rect = { x: cx - half, y: cy - half, w: half * 2 + 1, h: half * 2 + 1 };
  return { rect, tiles, core };
}

/** 最初に見つかった部屋をスタートにし、そこからの床の歩行距離が近い順に並べる（階段 = 最も遠い部屋） */
function orderFromStart(g: Grid, rooms: CaveRoom[]): CaveRoom[] {
  const start = rooms[0];
  if (!start) return rooms;
  const seen = new Uint8Array(g.cells.length);
  const order = floodFill(g, start.core, NEIGHBORS_4, (i) => g.cells[i] === FLOOR, seen);
  const stepOf = new Int32Array(g.cells.length);
  order.forEach((tile, n) => {
    stepOf[tile] = n;
  });
  return rooms
    .map((room, i) => ({ room, i }))
    .sort((a, b) => (stepOf[a.room.core] ?? 0) - (stepOf[b.room.core] ?? 0) || a.i - b.i)
    .map((e) => e.room);
}
