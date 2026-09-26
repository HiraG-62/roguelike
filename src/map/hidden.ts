import type { Rng } from "../core/rng";
import { type GameMap, Tile, getTile, toIndex } from "./grid";
import { UNREACHABLE, distanceField } from "./pathing";

/**
 * 隠し部屋の計画（純関数。map を書き換えない）。壁の中に埋めた「岩のポケット」を 1 つ選ぶ。
 * ポケットは通路（どの部屋にも属さない床タイル）の壁際にだけ置き、開くまで全タイルが Tile.Wall のまま
 * （system/hiddenRoom.ts が state.hiddenRoom に計画を覚え、開いたときだけタイルを書き換える）
 */

export interface HiddenRoomPlan {
  /** 押し当てて開ける壁タイル（通路の床タイルに隣接） */
  doorTile: number;
  /** ポケットの床タイル（doorTile を含まない） */
  tiles: number[];
  /** ポケット内の階段タイル（tiles に含まれる） */
  stairsTile: number;
}

export interface HiddenRoomOptions {
  /** ポケットの横幅（タイル） */
  w: number;
  /** ポケットの縦幅（タイル） */
  h: number;
  /** 開始タイルからの歩数がこれ未満の床タイルは候補にしない */
  minSteps: number;
  /** ここに含まれる床タイル（部屋の所属タイル）からは扉を出さない。通路だけを起点にする */
  avoidTiles: ReadonlySet<number>;
  /** 歩数を測る起点（通常はプレイヤーの開始位置） */
  startTile: number;
}

const CARDINALS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
] as const;

/**
 * 候補をすべて集めてから rng で 1 つ選ぶ（候補の集め方自体は乱数を使わない決定的な走査）。
 * 候補が無ければ null
 */
export function planHiddenRoom(map: GameMap, rng: Rng, opts: HiddenRoomOptions): HiddenRoomPlan | null {
  const field = distanceField(map, opts.startTile);
  const candidates: HiddenRoomPlan[] = [];
  for (let i = 0; i < map.tiles.length; i++) {
    if (map.tiles[i] === Tile.Wall) continue;
    if (opts.avoidTiles.has(i)) continue;
    const steps = field[i] ?? UNREACHABLE;
    if (steps === UNREACHABLE || steps < opts.minSteps) continue;
    const fx = i % map.width;
    const fy = Math.floor(i / map.width);
    for (const { dx, dy } of CARDINALS) {
      const plan = tryPocket(map, fx, fy, dx, dy, opts.w, opts.h);
      if (plan) candidates.push(plan);
    }
  }
  if (candidates.length === 0) return null;
  return rng.pick(candidates);
}

/**
 * (fx, fy) から (dx, dy) 方向に扉を 1 マス、その先に w×h のポケットを置けるか。
 * ポケット + 外周 1 マス（扉自身を含む）がすべて Tile.Wall で、マップの外周 1 マスに掛からなければ候補になる
 */
function tryPocket(map: GameMap, fx: number, fy: number, dx: number, dy: number, w: number, h: number): HiddenRoomPlan | null {
  const doorX = fx + dx;
  const doorY = fy + dy;
  if (getTile(map, doorX, doorY) !== Tile.Wall) return null;
  const horizontal = dx !== 0;
  const depth = horizontal ? w : h;
  const span = horizontal ? h : w;
  let x0: number;
  let x1: number;
  let y0: number;
  let y1: number;
  if (horizontal) {
    x0 = dx > 0 ? doorX + 1 : doorX - depth;
    x1 = x0 + depth - 1;
    y0 = doorY - Math.floor((span - 1) / 2);
    y1 = y0 + span - 1;
  } else {
    y0 = dy > 0 ? doorY + 1 : doorY - depth;
    y1 = y0 + depth - 1;
    x0 = doorX - Math.floor((span - 1) / 2);
    x1 = x0 + span - 1;
  }
  const bx0 = x0 - 1;
  const bx1 = x1 + 1;
  const by0 = y0 - 1;
  const by1 = y1 + 1;
  if (bx0 < 1 || by0 < 1 || bx1 > map.width - 2 || by1 > map.height - 2) return null;
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      if (getTile(map, x, y) !== Tile.Wall) return null;
    }
  }
  const tiles: number[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) tiles.push(toIndex(map, x, y));
  }
  // 階段は扉から一番奥（ポケットの奥の壁際）に置く。乱数は使わない
  const stairsX = horizontal ? (dx > 0 ? x1 : x0) : doorX;
  const stairsY = horizontal ? doorY : dy > 0 ? y1 : y0;
  return { doorTile: toIndex(map, doorX, doorY), tiles, stairsTile: toIndex(map, stairsX, stairsY) };
}
