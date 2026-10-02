/**
 * 階の型の出来上がり（GameMap）の共通の検査（docs/ideas/map-gen-impl.md 2-6 の 8 項目）。
 * 落ちたら呼び出し側（index.ts の generateLayoutMap）が同じ rng で作り直す。テストも同じ関数を使う。
 * 乱数を使わない純関数。戻り値は落ちた理由（日本語）。通れば null
 */
import { FLOOR_LORD, MAP_LAYOUT } from "../../data/tuning";
import { type GameMap, Tile, isPassableTile, rectCenter } from "../grid";
import { NEIGHBORS_4, NEIGHBORS_8 } from "../regions";

export interface ValidateOptions {
  /** 部屋として数える塊（roomMinTiles 以上）の最小数 */
  minRooms: number;
  roomMinTiles: number;
  minFloorRatio: number;
  maxFloorRatio: number;
  /** 開始から主の間まで通れなければならない道の幅（タイル。2 = 2x2 の窓） */
  mainPathWidth: number;
  /** 主の間の広さの下限 = π × lordRadius² × この割合 */
  lordFill: number;
  /** 主の間の半径（タイル。FLOOR_LORD.arenaRadius） */
  lordRadius: number;
}

export const DEFAULT_VALIDATE: ValidateOptions = { ...MAP_LAYOUT.validate, lordRadius: FLOOR_LORD.arenaRadius };

/** NEIGHBORS_8 / NEIGHBORS_4 を x と y の別の表にしたもの（内側のループで組を分解しない） */
const DX8: readonly number[] = NEIGHBORS_8.map(([dx]) => dx);
const DY8: readonly number[] = NEIGHBORS_8.map(([, dy]) => dy);
const DX4: readonly number[] = NEIGHBORS_4.map(([dx]) => dx);
const DY4: readonly number[] = NEIGHBORS_4.map(([, dy]) => dy);

export function validateLayout(map: GameMap, options: ValidateOptions = DEFAULT_VALIDATE): string | null {
  return (
    checkStructure(map) ??
    checkRoomTiles(map) ??
    checkRoomSpacing(map) ??
    checkConnected(map) ??
    checkMainPath(map, options.mainPathWidth) ??
    checkLordSize(map, options) ??
    checkRoomCount(map, options) ??
    checkFloorRatio(map, options)
  );
}

/** 2. 部屋 0 = 開始、最後 = 主の間で、階段がその核（rect の中心）にある。階段はそこにだけ */
function checkStructure(map: GameMap): string | null {
  const tiles = map.roomTiles;
  if (!tiles || tiles.length !== map.rooms.length) return "roomTiles が rooms と対応していない";
  if (map.rooms.length < 2) return "部屋が開始と主の間の 2 つに満たない";
  const lordRect = map.rooms[map.rooms.length - 1];
  if (!lordRect) return "主の間が無い";
  const core = rectCenter(lordRect);
  const stairs = core.y * map.width + core.x;
  if (map.tiles[stairs] !== Tile.StairsDown) return "階段が主の間の核にない";
  if (!tiles[tiles.length - 1]?.includes(stairs)) return "階段が主の間のタイルに入っていない";
  let count = 0;
  for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === Tile.StairsDown) count++;
  return count === 1 ? null : "階段が主の間の核の 1 つだけでない";
}

/** 8. 部屋のタイル（階段を含む）が床の上にある（穴・壁の上に部屋が無い） */
function checkRoomTiles(map: GameMap): string | null {
  for (const tiles of map.roomTiles ?? []) {
    for (const t of tiles) {
      const tile = map.tiles[t];
      if (tile !== Tile.Floor && tile !== Tile.StairsDown) return "穴か壁の上に部屋のタイルがある";
    }
  }
  return null;
}

/** 3. 部屋どうしが 8 近傍で接しない */
function checkRoomSpacing(map: GameMap): string | null {
  const owner = new Int16Array(map.tiles.length).fill(-1);
  (map.roomTiles ?? []).forEach((tiles, id) => {
    for (const t of tiles) owner[t] = id;
  });
  // 部屋のタイルだけを見る（全マスを走査して持ち主の無いマスを飛ばすのと同じ。広い地図で部屋の外を回らない）
  for (const tiles of map.roomTiles ?? []) {
    for (const i of tiles) {
      const id = owner[i] ?? -1;
      if (id < 0) continue;
      const x = i % map.width;
      const y = Math.floor(i / map.width);
      for (let k = 0; k < NEIGHBORS_8.length; k++) {
        const nx = x + (DX8[k] ?? 0);
        const ny = y + (DY8[k] ?? 0);
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
        const other = owner[ny * map.width + nx] ?? -1;
        if (other >= 0 && other !== id) return "部屋どうしが 8 近傍で接している";
      }
    }
  }
  return null;
}


/** 1. 通れる床が 4 近傍で 1 つにつながる（階段から広げて全部に着く） */
function checkConnected(map: GameMap): string | null {
  const stairs = map.tiles.indexOf(Tile.StairsDown);
  let passable = 0;
  for (let i = 0; i < map.tiles.length; i++) if (isPassableTile(map.tiles[i] ?? Tile.Wall)) passable++;
  const seen = new Uint8Array(map.tiles.length);
  // 各マスは 1 回だけ入るので、待ち行列はマスの数ぶんの型付き配列で足りる
  const queue = new Int32Array(map.tiles.length);
  let tail = 0;
  queue[tail++] = stairs;
  seen[stairs] = 1;
  for (let head = 0; head < tail; head++) {
    const i = queue[head] ?? 0;
    const x = i % map.width;
    const y = Math.floor(i / map.width);
    for (let k = 0; k < NEIGHBORS_4.length; k++) {
      const nx = x + (DX4[k] ?? 0);
      const ny = y + (DY4[k] ?? 0);
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const ni = ny * map.width + nx;
      if (seen[ni] || !isPassableTile(map.tiles[ni] ?? Tile.Wall)) continue;
      seen[ni] = 1;
      queue[tail++] = ni;
    }
  }
  return tail === passable ? null : "通れる床が 1 つにつながっていない";
}

/** width x width の窓（左上が i）がすべて通れるか */
function windowOpen(map: GameMap, x: number, y: number, width: number): boolean {
  if (x < 0 || y < 0 || x + width > map.width || y + width > map.height) return false;
  for (let dy = 0; dy < width; dy++) {
    for (let dx = 0; dx < width; dx++) {
      if (!isPassableTile(map.tiles[(y + dy) * map.width + x + dx] ?? Tile.Wall)) return false;
    }
  }
  return true;
}

/** 4. 開始の間から主の間（階段）まで、幅 width の窓が通れる道がある（窓の左上を 4 近傍に動かす BFS） */
function checkMainPath(map: GameMap, width: number): string | null {
  const w = Math.max(1, Math.floor(width));
  const open = new Uint8Array(map.tiles.length);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) if (windowOpen(map, x, y, w)) open[y * map.width + x] = 1;
  }
  const seen = new Uint8Array(map.tiles.length);
  const queue: number[] = [];
  for (const t of map.roomTiles?.[0] ?? []) {
    const tx = t % map.width;
    const ty = Math.floor(t / map.width);
    for (let dy = 0; dy < w; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const x = tx - dx;
        const y = ty - dy;
        if (x < 0 || y < 0) continue;
        const i = y * map.width + x;
        if (!open[i] || seen[i]) continue;
        seen[i] = 1;
        queue.push(i);
      }
    }
  }
  const stairs = map.tiles.indexOf(Tile.StairsDown);
  const sx = stairs % map.width;
  const sy = Math.floor(stairs / map.width);
  const reachesStairs = (i: number): boolean => {
    const x = i % map.width;
    const y = Math.floor(i / map.width);
    return x <= sx && sx < x + w && y <= sy && sy < y + w;
  };
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head] ?? 0;
    if (reachesStairs(i)) return null;
    const x = i % map.width;
    const y = Math.floor(i / map.width);
    for (let k = 0; k < NEIGHBORS_4.length; k++) {
      const nx = x + (DX4[k] ?? 0);
      const ny = y + (DY4[k] ?? 0);
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const ni = ny * map.width + nx;
      if (!open[ni] || seen[ni]) continue;
      seen[ni] = 1;
      queue.push(ni);
    }
  }
  return `開始から主の間まで幅 ${w} の道が通らない`;
}

/** 5. 主の間が π·r² × lordFill タイル以上 */
function checkLordSize(map: GameMap, options: ValidateOptions): string | null {
  const need = Math.PI * options.lordRadius * options.lordRadius * options.lordFill;
  const size = map.roomTiles?.[map.roomTiles.length - 1]?.length ?? 0;
  return size >= need ? null : "主の間が狭い";
}

/** 6. 部屋（roomMinTiles 以上）が minRooms 以上 */
function checkRoomCount(map: GameMap, options: ValidateOptions): string | null {
  const count = (map.roomTiles ?? []).filter((tiles) => tiles.length >= options.roomMinTiles).length;
  return count >= options.minRooms ? null : "部屋が少ない";
}

/** 7. 通れる床の割合が minFloorRatio〜maxFloorRatio */
function checkFloorRatio(map: GameMap, options: ValidateOptions): string | null {
  let passable = 0;
  for (let i = 0; i < map.tiles.length; i++) if (isPassableTile(map.tiles[i] ?? Tile.Wall)) passable++;
  const ratio = passable / map.tiles.length;
  if (ratio < options.minFloorRatio) return "床の割合が低い";
  if (ratio > options.maxFloorRatio) return "床の割合が高い";
  return null;
}
