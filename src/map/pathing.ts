import { type GameMap, type Point, TILE_SIZE, Tile, inBounds, toIndex } from "./grid";
import { sightBlockedAt } from "./sightBlock";

/**
 * タイル上の視線と経路（純関数 + マップから作る派生データのキャッシュ）。
 * 開放型フロア（system/spawner.ts の徘徊、system/enemies.ts の気付き・回り込み）と QA bot が使う。
 * 壁（Tile.Wall）だけを見る。封鎖中の扉（state.lockedTiles）は見ない（封鎖は一時的で、扉の前で押し合うだけなので）
 */

/** 視線を調べる刻み（px）。タイルの 1/4 なので壁の角をすり抜けない */
const LOS_STEP = TILE_SIZE / 4;

/** 2 点を結ぶ線分が壁タイルを通らないか */
export function lineOfSight(map: GameMap, a: Point, b: Point): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const steps = Math.ceil(Math.hypot(dx, dy) / LOS_STEP);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const tx = Math.floor((a.x + dx * t) / TILE_SIZE);
    const ty = Math.floor((a.y + dy * t) / TILE_SIZE);
    if (!inBounds(map, tx, ty) || map.tiles[toIndex(map, tx, ty)] === Tile.Wall) return false;
    // 煙（system/terrain.ts）も視線を遮る
    if (sightBlockedAt(map, toIndex(map, tx, ty))) return false;
  }
  return true;
}

const NEIGHBORS_4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
export const UNREACHABLE = -1;
/** マップ 1 枚あたりに覚えておく距離場の数（プレイヤーのタイルは動くので古いものから捨てる） */
const FIELD_CACHE_MAX = 48;

/**
 * 目的地タイルからの 4 近傍の歩数。マップだけから決まる派生データなので state に置かずマップごとに覚える
 * （同じマップと目的地なら同じ値。決定性に影響しない）
 */
const fieldCache = new WeakMap<GameMap, Map<number, Int32Array>>();

export function distanceField(map: GameMap, goal: number): Int32Array {
  let perMap = fieldCache.get(map);
  if (!perMap) {
    perMap = new Map();
    fieldCache.set(map, perMap);
  }
  const cached = perMap.get(goal);
  if (cached) return cached;
  const field = buildField(map, goal);
  if (perMap.size >= FIELD_CACHE_MAX) {
    const oldest = perMap.keys().next().value;
    if (oldest !== undefined) perMap.delete(oldest);
  }
  perMap.set(goal, field);
  return field;
}

function buildField(map: GameMap, goal: number): Int32Array {
  const field = new Int32Array(map.tiles.length).fill(UNREACHABLE);
  if (goal < 0 || goal >= map.tiles.length) return field;
  const queue = [goal];
  field[goal] = 0;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head] ?? 0;
    const x = i % map.width;
    const y = Math.floor(i / map.width);
    for (const [dx, dy] of NEIGHBORS_4) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(map, nx, ny)) continue;
      const ni = toIndex(map, nx, ny);
      if (field[ni] !== UNREACHABLE || map.tiles[ni] === Tile.Wall) continue;
      field[ni] = (field[i] ?? 0) + 1;
      queue.push(ni);
    }
  }
  return field;
}

export function tileOf(map: GameMap, p: Point): number {
  return toIndex(map, Math.floor(p.x / TILE_SIZE), Math.floor(p.y / TILE_SIZE));
}

function tileCenter(map: GameMap, i: number): Point {
  return { x: ((i % map.width) + 0.5) * TILE_SIZE, y: (Math.floor(i / map.width) + 0.5) * TILE_SIZE };
}

/** 次に向かう点。目的地のタイルに着いていれば目的地そのもの、行けなければ null */
export function nextWaypoint(map: GameMap, pos: Point, goal: Point): Point | null {
  const field = distanceField(map, tileOf(map, goal));
  const here = tileOf(map, pos);
  const d = field[here] ?? UNREACHABLE;
  if (d === UNREACHABLE) return null;
  if (d === 0) return goal;
  const x = here % map.width;
  const y = Math.floor(here / map.width);
  let best = -1;
  let bestD = d;
  for (const [dx, dy] of NEIGHBORS_4) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inBounds(map, nx, ny)) continue;
    const ni = toIndex(map, nx, ny);
    const nd = field[ni] ?? UNREACHABLE;
    if (nd === UNREACHABLE || nd >= bestD) continue;
    best = ni;
    bestD = nd;
  }
  return best < 0 ? null : tileCenter(map, best);
}

/**
 * 追跡の向き。目標が見えていれば dir（まっすぐ）、壁に遮られていれば経路の次の点へ向かう単位ベクトル。
 * 経路が無ければ dir のまま
 */
export function chaseHeading(map: GameMap, pos: Point, target: Point, dir: Point): Point {
  if (lineOfSight(map, pos, target)) return dir;
  const next = nextWaypoint(map, pos, target);
  if (!next) return dir;
  const dx = next.x - pos.x;
  const dy = next.y - pos.y;
  const len = Math.hypot(dx, dy);
  return len > 0 ? { x: dx / len, y: dy / len } : dir;
}
