// dual-grid の形と頂点の深さ（docs/ideas/map-visual-impl.md 1-2 節）。
// 表の格子は論理マスから半マスずれ、1 ドットは「自分のマス・横の隣・縦の隣」の 3 マスで形が決まる
// （見本の smoothMask。頂点を囲む 4 マスで 16 通りを選ぶ dual-grid と同じ情報量）。
// ドット単位の距離変換は使わず、頂点（(w+1)x(h+1)）ごとの「最寄りまでのマス数」を双線形補間する。
import type { GameMap } from "../map/grid";
import { Tile } from "../map/grid";
import { vnoise } from "./mapNoise";
import { TILE_DOTS } from "./mapTypes";

const HALF_TILE = TILE_DOTS / 2;
/** 縁の揺らぎの雑音の周期（ドット） */
export const EDGE_PERIOD = 11;
/** 頂点の深さの上限（マス）。これ以上は区別しない（岩盤の闇は 2 マス、穴の深さは 1 マスまで使う） */
export const DEPTH_CAP = 6;
/** 面取り距離の斜め 1 歩（マス） */
const DIAGONAL_STEP = Math.SQRT2;
const INF = 1e5;

/** 1 ドットの自分のマス・横の隣・縦の隣が「塗る側」かどうか（true = 塗る） */
export type SolidFn = (map: GameMap, tx: number, ty: number) => boolean;

/** マスの左上からのドット位置 lx / ly（0..TILE_DOTS-1）から、近い方の隣（-1 = 左 / 上、1 = 右 / 下）を選ぶ */
export function quadrantSign(local: number): -1 | 1 {
  return local < HALF_TILE ? -1 : 1;
}

/**
 * 形の本体。own / hN / vN は「自分のマス・横の隣・縦の隣」が塗る側か。e は縁の揺らぎ（ドット）。
 * 外角（隣が 2 つとも塗らない）は半径 R の円か 45 度の面取り、内角（逆）は同じ半径で抉る
 */
export function cornerShapeBits(own: boolean, hN: boolean, vN: boolean, lx: number, ly: number, R: number, chamfer: boolean, e: number): 0 | 1 {
  const sx = quadrantSign(lx);
  const sy = quadrantSign(ly);
  const dx = (sx < 0 ? lx : TILE_DOTS - 1 - lx) + 0.5;
  const dy = (sy < 0 ? ly : TILE_DOTS - 1 - ly) + 0.5;
  if (own) {
    if (!hN && !vN) {
      const ax = dx - e;
      const ay = dy - e;
      if (ax < 0 || ay < 0) return 0;
      if (chamfer) return ax + ay >= R ? 1 : 0;
      if (ax >= R || ay >= R) return 1;
      return (ax - R) * (ax - R) + (ay - R) * (ay - R) <= R * R ? 1 : 0;
    }
    if (!hN) return dx >= e ? 1 : 0;
    if (!vN) return dy >= e ? 1 : 0;
    return 1;
  }
  if (hN && vN) {
    const ax = dx + e;
    const ay = dy + e;
    if (ax < 0 || ay < 0) return 1;
    if (chamfer) return ax + ay < R ? 1 : 0;
    if (ax >= R || ay >= R) return 0;
    return (ax - R) * (ax - R) + (ay - R) * (ay - R) > R * R ? 1 : 0;
  }
  if (hN) return dx < -e ? 1 : 0;
  if (vN) return dy < -e ? 1 : 0;
  return 0;
}

/** 縁の揺らぎ（ドット）。amp 0 なら常に 0 */
export function edgeJitter(wx: number, wy: number, amp: number, seed: number): number {
  if (amp === 0) return 0;
  return Math.round((vnoise(wx, wy, EDGE_PERIOD, seed) - 0.5) * 2 * amp);
}

/**
 * ワールドのドット座標 (wx, wy) が塗る側か（1）そうでないか（0）。地図の外は isSolid が壁として扱う前提。
 * 焼き付けの内側ループは同じ判定を cornerShapeBits で直接行う（マスの分類を使い回すため）
 */
export function cornerShape(isSolid: SolidFn, map: GameMap, wx: number, wy: number, R: number, chamfer: boolean, amp: number, seed: number): 0 | 1 {
  const tx = Math.floor(wx / TILE_DOTS);
  const ty = Math.floor(wy / TILE_DOTS);
  const lx = wx - tx * TILE_DOTS;
  const ly = wy - ty * TILE_DOTS;
  const sx = quadrantSign(lx);
  const sy = quadrantSign(ly);
  const e = edgeJitter(wx, wy, amp, seed);
  return cornerShapeBits(isSolid(map, tx, ty), isSolid(map, tx + sx, ty), isSolid(map, tx, ty + sy), lx, ly, R, chamfer, e);
}

/** 地図の外は壁として扱うマスの判定（壁のとき true） */
export function isWallTile(map: GameMap, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return true;
  return map.tiles[ty * map.width + tx] === Tile.Wall;
}

/** 壁または穴のマス（穴の形 Q は壁との合併で決める。mapBake.ts 参照） */
export function isWallOrPitTile(map: GameMap, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return true;
  const tile = map.tiles[ty * map.width + tx];
  return tile === Tile.Wall || tile === Tile.Pit;
}

/**
 * 頂点の深さ。頂点 (vx, vy) はマス (vx-1, vy-1) 〜 (vx, vy) の 4 マスの角（0 <= vx <= width, 0 <= vy <= height）。
 * rock = 最寄りの壁でないマスの角までのマス数（壁でないマスに接する頂点が 0）。
 * pit = 最寄りの穴でないマス（地図の外を含む）の角までのマス数。穴が 1 つも無ければ全部 0
 */
export interface VertexDepth {
  width: number;
  height: number;
  rock: Float32Array;
  pit: Float32Array;
}

/** マス (tx, ty) が壁でない（地図の外は壁） */
function isOpenTile(map: GameMap, tx: number, ty: number): boolean {
  return !isWallTile(map, tx, ty);
}

/** マスが穴でない（地図の外は穴でない = 岸） */
function isNotPitTile(map: GameMap, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return true;
  return map.tiles[ty * map.width + tx] !== Tile.Pit;
}

function seedField(map: GameMap, vw: number, vh: number, isSource: (map: GameMap, tx: number, ty: number) => boolean): Float32Array {
  const field = new Float32Array(vw * vh);
  for (let vy = 0; vy < vh; vy++) {
    for (let vx = 0; vx < vw; vx++) {
      const touches = isSource(map, vx - 1, vy - 1) || isSource(map, vx, vy - 1) || isSource(map, vx - 1, vy) || isSource(map, vx, vy);
      field[vy * vw + vx] = touches ? 0 : INF;
    }
  }
  return field;
}

/** 面取り距離（直 1・斜め √2）の 2 パス。値は DEPTH_CAP で頭打ち */
function chamfer(field: Float32Array, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = field[i] ?? INF;
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, (field[i - 1] ?? INF) + 1);
      if (y > 0) {
        v = Math.min(v, (field[i - w] ?? INF) + 1);
        if (x > 0) v = Math.min(v, (field[i - w - 1] ?? INF) + DIAGONAL_STEP);
        if (x < w - 1) v = Math.min(v, (field[i - w + 1] ?? INF) + DIAGONAL_STEP);
      }
      field[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = field[i] ?? INF;
      if (v === 0) continue;
      if (x < w - 1) v = Math.min(v, (field[i + 1] ?? INF) + 1);
      if (y < h - 1) {
        v = Math.min(v, (field[i + w] ?? INF) + 1);
        if (x < w - 1) v = Math.min(v, (field[i + w + 1] ?? INF) + DIAGONAL_STEP);
        if (x > 0) v = Math.min(v, (field[i + w - 1] ?? INF) + DIAGONAL_STEP);
      }
      field[i] = Math.min(v, DEPTH_CAP);
    }
  }
}

function hasPit(map: GameMap): boolean {
  return map.tiles.includes(Tile.Pit);
}

export function buildVertexDepth(map: GameMap): VertexDepth {
  const width = map.width + 1;
  const height = map.height + 1;
  const rock = seedField(map, width, height, isOpenTile);
  chamfer(rock, width, height);
  const withPit = hasPit(map);
  const pit = withPit ? seedField(map, width, height, isNotPitTile) : new Float32Array(width * height);
  if (withPit) chamfer(pit, width, height);
  return { width, height, rock, pit };
}

/** ワールドのドット座標（ドットの中心）での深さ（マス）を、頂点の値から双線形補間する */
export function sampleDepth(depth: VertexDepth, field: Float32Array, wx: number, wy: number): number {
  const u = Math.min(Math.max((wx + 0.5) / TILE_DOTS, 0), depth.width - 1);
  const v = Math.min(Math.max((wy + 0.5) / TILE_DOTS, 0), depth.height - 1);
  const x0 = Math.min(Math.floor(u), depth.width - 2);
  const y0 = Math.min(Math.floor(v), depth.height - 2);
  const fx = u - x0;
  const fy = v - y0;
  const i = y0 * depth.width + x0;
  const a = field[i] ?? 0;
  const b = field[i + 1] ?? 0;
  const c = field[i + depth.width] ?? 0;
  const d = field[i + depth.width + 1] ?? 0;
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
