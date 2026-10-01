import type { GameMap, Rect } from "./grid";
import { Cell } from "./layout/types";

/**
 * 「塊の部屋」の道具（洞窟 cave.ts と階の型 layout/finalize.ts が共有する）。
 * 床の領域を flood fill で塊に分け、壁からの距離で核を選び、塊を同時に膨らませて所属タイルを決める。
 * 穴（Cell.Pit）は壁として扱う（穴の縁も「壁から近い」ので、広間の核は穴から離れた所になる）。
 * 純関数・乱数なし
 */

export const NO_OWNER = -1;
/** 2 つの部屋に挟まれて、どちらにも入れないタイル */
export const CONTESTED = -2;

export const NEIGHBORS_4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export const NEIGHBORS_8 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

export type Offsets = typeof NEIGHBORS_4 | typeof NEIGHBORS_8;

/** 床・壁・穴（Cell）の格子 */
export interface Grid {
  w: number;
  h: number;
  cells: Uint8Array;
}

/** start から offsets で繋がる、pass を満たすタイルを全て返す */
export function floodFill(g: Grid, start: number, offsets: Offsets, pass: (i: number) => boolean, seen: Uint8Array): number[] {
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

/** 各床から最寄りの壁（と穴）までのチェビシェフ距離（壁・穴は 0） */
export function wallDistance(g: Grid): Int16Array {
  const dist = new Int16Array(g.cells.length).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < g.cells.length; i++) {
    if (g.cells[i] === Cell.Floor) continue;
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

/**
 * 塊を 4 近傍 BFS で grow マスまで同時に膨らませる。grow が配列なら塊ごとの幅（添字 = 塊の番号）。
 * 別の部屋のタイルと 8 近傍で接するタイルは取らない（部屋同士が必ず 1 マス以上離れ、扉で封鎖できる）
 */
export function growRooms(g: Grid, regions: number[][], grow: number | readonly number[]): Int16Array {
  const owner = new Int16Array(g.cells.length).fill(NO_OWNER);
  const depth = new Int16Array(g.cells.length);
  const queue: number[] = [];
  regions.forEach((region, id) => {
    for (const i of region) {
      owner[i] = id;
      queue.push(i);
    }
  });
  const limitOf = (id: number): number => (typeof grow === "number" ? grow : (grow[id] ?? 0));
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head] ?? 0;
    const id = owner[i] ?? NO_OWNER;
    const d = depth[i] ?? 0;
    if (d >= limitOf(id)) continue;
    const x = i % g.w;
    const y = Math.floor(i / g.w);
    for (const [dx, dy] of NEIGHBORS_4) {
      const ni = (y + dy) * g.w + (x + dx);
      if (g.cells[ni] !== Cell.Floor || owner[ni] !== NO_OWNER) continue;
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

export function touchesOtherOwner(g: Grid, owner: Int16Array, i: number, id: number): boolean {
  const x = i % g.w;
  const y = Math.floor(i / g.w);
  for (const [dx, dy] of NEIGHBORS_8) {
    const o = owner[(y + dy) * g.w + (x + dx)] ?? NO_OWNER;
    if (o >= 0 && o !== id) return true;
  }
  return false;
}

export interface RegionRoom {
  rect: Rect;
  tiles: number[];
  /** 壁から最も遠いタイル。rect の中心 */
  core: number;
}

/** 部屋ごとの所属タイル（昇順）。部屋ごとにマップ全体を走査すると広いマップで部屋数 × 面積になるので 1 回で振り分ける */
export function tilesOfOwners(owners: Int16Array, count: number): number[][] {
  const out: number[][] = Array.from({ length: count }, () => []);
  for (let i = 0; i < owners.length; i++) {
    const o = owners[i] ?? NO_OWNER;
    if (o >= 0) out[o]?.push(i);
  }
  return out;
}

/** region の中で壁から最も遠いタイルを核にし、そこに内接する正方形を rect にする。tiles は所属タイル */
export function buildRoom(map: GameMap, region: number[], dist: Int16Array, tiles: number[]): RegionRoom {
  let core = region[0] ?? 0;
  for (const i of region) if ((dist[i] ?? 0) > (dist[core] ?? 0)) core = i;
  // 核から dist-1 マス以内は全て床（チェビシェフ距離の定義から）
  const half = Math.max(0, (dist[core] ?? 1) - 1);
  const cx = core % map.width;
  const cy = Math.floor(core / map.width);
  const rect = { x: cx - half, y: cy - half, w: half * 2 + 1, h: half * 2 + 1 };
  return { rect, tiles, core };
}

/** 最初の部屋をスタートにし、そこからの床の歩行距離が近い順に並べる（階段 = 最も遠い部屋） */
export function orderFromStart(g: Grid, rooms: RegionRoom[]): RegionRoom[] {
  const start = rooms[0];
  if (!start) return rooms;
  const seen = new Uint8Array(g.cells.length);
  const order = floodFill(g, start.core, NEIGHBORS_4, (i) => g.cells[i] === Cell.Floor, seen);
  const stepOf = new Int32Array(g.cells.length);
  order.forEach((tile, n) => {
    stepOf[tile] = n;
  });
  return rooms
    .map((room, i) => ({ room, i }))
    .sort((a, b) => (stepOf[a.room.core] ?? 0) - (stepOf[b.room.core] ?? 0) || a.i - b.i)
    .map((e) => e.room);
}
