import type { Body, GameState } from "../core/state";
import { TILE_SIZE, Tile, getTile, inBounds, toIndex } from "../map/grid";

/** 1 回の移動を分割する最大距離（px）。タイルをすり抜けない程度に小さく */
const SUB_STEP = 4;

/** タイル座標が通行不能か。ロック中の扉も壁扱い */
export function isSolidTile(state: GameState, tx: number, ty: number): boolean {
  if (!inBounds(state.map, tx, ty)) return true;
  if (getTile(state.map, tx, ty) === Tile.Wall) return true;
  return state.lockedTiles.has(toIndex(state.map, tx, ty));
}

/** 半径 r の AABB がどこかの壁タイルと重なるか */
export function overlapsWall(state: GameState, x: number, y: number, r: number): boolean {
  const x0 = Math.floor((x - r) / TILE_SIZE);
  const x1 = Math.floor((x + r - 0.001) / TILE_SIZE);
  const y0 = Math.floor((y - r) / TILE_SIZE);
  const y1 = Math.floor((y + r - 0.001) / TILE_SIZE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (isSolidTile(state, tx, ty)) return true;
    }
  }
  return false;
}

export interface MoveResult {
  hitX: boolean;
  hitY: boolean;
}

/**
 * 軸ごとに小刻みに動かして、壁に当たった手前で止める。
 * 単純だが半径 < タイルサイズなら十分堅牢。
 */
export function moveBody(state: GameState, body: Body, dx: number, dy: number): MoveResult {
  const result: MoveResult = { hitX: false, hitY: false };
  result.hitX = sweepAxis(state, body, dx, 0);
  result.hitY = sweepAxis(state, body, 0, dy);
  return result;
}

function sweepAxis(state: GameState, body: Body, dx: number, dy: number): boolean {
  const total = Math.abs(dx) + Math.abs(dy);
  if (total === 0) return false;
  const steps = Math.max(1, Math.ceil(total / SUB_STEP));
  const sx = dx / steps;
  const sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    const nx = body.pos.x + sx;
    const ny = body.pos.y + sy;
    if (overlapsWall(state, nx, ny, body.radius)) return true;
    body.pos.x = nx;
    body.pos.y = ny;
  }
  return false;
}

export function circlesOverlap(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const r = ar + br;
  return dx * dx + dy * dy < r * r;
}

/** 回転矩形は使わず、攻撃判定は軸並行矩形で扱う */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function boxCircleOverlap(box: Box, cx: number, cy: number, r: number): boolean {
  const nx = Math.max(box.x, Math.min(cx, box.x + box.w));
  const ny = Math.max(box.y, Math.min(cy, box.y + box.h));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}
