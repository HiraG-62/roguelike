import { type Enemy, type GameState, ROAMING_ROOM, pushSfx } from "../core/state";
import type { Vec } from "../core/vec";
import { enemyDef } from "../data/enemies";
import { ECONOMY } from "../data/tuning";
import { TILE_SIZE, Tile, getTile, isWalkable, toIndex } from "../map/grid";
import { byChapter } from "./chapters";
import { chapterScale, dropFlask, placeCoin } from "./economy";
import { spawnBurst } from "./effects";
import { createEnemy } from "./enemies";
import { overlapsWall } from "./physics";
import { roomHooks } from "./specialRooms";

/**
 * 壺・木箱（docs/ideas/economy-impl.md 2-7）。
 * - 体は Enemy（data/enemies.ts の pot / crate。生命 1、動かず、気付かず、攻撃しない。roomIndex = ROAMING_ROOM なので部屋の制圧・陣に数えない）
 * - 割れると少しの銭と、ときどきハート（章が進むほど絞る）、まれに床の瓶が出る。撃破数・得点・コンボ・来歴・ドロップ抽選には数えない（combat.ts の killEnemy が containerBroken へ渡す）
 * - 置くのは buildFloor の最後（塊の隅と通路の行き止まり。それより前の乱数消費を動かさない）
 */

export const POT_KEY = "pot";
export const CRATE_KEY = "crate";

/** 破片の飛び方（見た目だけ） */
const BURST_SPEED = 90;
const BURST_LIFE = 0.45;
const BURST_SIZE = 2;
/** 壁の隅とみなす向き: 上下のどちらかと左右のどちらか */
const VERTICAL: readonly (readonly [number, number])[] = [
  [0, -1],
  [0, 1],
];
const HORIZONTAL: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
];
const ORTHOGONAL: readonly (readonly [number, number])[] = [...VERTICAL, ...HORIZONTAL];
/** 行き止まり: 四方のうち歩けるのが 1 つだけ（壁が 3 面） */
const DEAD_END_WALLS = 3;

// -----------------------------------------------------------------------------
// 割る
// -----------------------------------------------------------------------------

/**
 * 割れた壺・木箱の後始末（killEnemy の頭から）。破片と、銭（乱数 1 回）・瓶（乱数 1 回）・ハート（乱数 1 回）。
 * 出る乱数は額が 0 でも瓶・ハートが出なくても引く（消費数を一定にして、後の抽選を揺らさない）。
 * 壺・木箱は階ごとに数が決まっているので、割り尽くせばそれ以上は回復が増えない（序盤の回復の足し）
 */
export function containerBroken(state: GameState, enemy: Enemy): void {
  const def = enemyDef(enemy.defKey);
  const c = ECONOMY.container;
  spawnBurst(state, enemy.body.pos, def.container === "crate" ? c.crateBurstColor : c.burstColor, c.burstParticles, BURST_SPEED, BURST_LIFE, BURST_SIZE);
  pushSfx(state, "containerBreak");
  if (state.sandbox === true) return;
  const base = state.rng.int(c.coinsMin, c.coinsMax);
  const flask = state.rng.chance(c.flaskChance);
  const heart = state.rng.chance(byChapter(c.heartChanceByChapter, state.depth));
  const value = Math.round(base * chapterScale(state.depth));
  if (value > 0) {
    state.economy.dropped += value;
    placeCoin(state, enemy.body.pos, value, ECONOMY.coin.scatterSpeed, "container");
  }
  if (flask) dropFlask(state, enemy.body.pos);
  // ハートの可否（祝福の禁止・涸れた泉）は roomHooks.dropHeart（floor.ts）が見る
  if (heart) roomHooks.dropHeart(state, enemy.body.pos);
}

// -----------------------------------------------------------------------------
// 置く
// -----------------------------------------------------------------------------

/** 部屋の床タイル（塊はその所属タイル、矩形は外周 1 マスを除いた内側） */
function roomFloorTiles(state: GameState): number[] {
  const seen = new Set<number>();
  for (const room of state.rooms) {
    if (room.tiles) {
      for (const t of room.tiles) seen.add(t);
      continue;
    }
    const r = room.rect;
    for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
      for (let x = r.x + 1; x < r.x + r.w - 1; x++) seen.add(toIndex(state.map, x, y));
    }
  }
  return [...seen].sort((a, b) => a - b);
}

function wallSides(state: GameState, tx: number, ty: number, dirs: readonly (readonly [number, number])[]): number {
  let n = 0;
  for (const [dx, dy] of dirs) if (!isWalkable(state.map, tx + dx, ty + dy)) n++;
  return n;
}

/** 隅: 壁が縦にも横にも接し、合わせて cornerWalls 面以上（通路の両側の壁だけでは隅にならない） */
function isCorner(state: GameState, tx: number, ty: number): boolean {
  if (wallSides(state, tx, ty, VERTICAL) === 0 || wallSides(state, tx, ty, HORIZONTAL) === 0) return false;
  return wallSides(state, tx, ty, ORTHOGONAL) >= ECONOMY.container.cornerWalls;
}

function isDeadEnd(state: GameState, tx: number, ty: number): boolean {
  return wallSides(state, tx, ty, ORTHOGONAL) === DEAD_END_WALLS;
}

function tileCenter(tx: number, ty: number): Vec {
  return { x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2 };
}

/** 空けておく点: 台座・商人と品・契約者と品・階段・プレイヤーの開始位置・敵 */
function keepOutPoints(state: GameState): Vec[] {
  const out: Vec[] = [{ ...state.player.body.pos }];
  for (const room of state.rooms) for (const p of room.special?.props ?? []) out.push(p.pos);
  for (const m of state.economy.merchants) {
    out.push(m.pos);
    for (const w of m.wares) out.push(w.pos);
  }
  const who = state.contracts.contractor;
  if (who) {
    out.push(who.pos);
    for (const o of who.offers) out.push(o.pos);
  }
  for (const e of state.enemies) out.push(e.body.pos);
  const map = state.map;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) if (getTile(map, x, y) === Tile.StairsDown) out.push(tileCenter(x, y));
  }
  return out;
}

function nearAny(points: readonly Vec[], p: Vec, range: number): boolean {
  return points.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < range);
}

interface Spots {
  corners: Vec[];
  deadEnds: Vec[];
}

/** 置ける点の候補（タイル番号の昇順。乱数を使わない） */
function candidateSpots(state: GameState): Spots {
  const keepOut = keepOutPoints(state);
  const radius = Math.max(enemyDef(POT_KEY).radius, enemyDef(CRATE_KEY).radius);
  const c = ECONOMY.container;
  const corners: Vec[] = [];
  const deadEnds: Vec[] = [];
  const consider = (tx: number, ty: number): void => {
    if (getTile(state.map, tx, ty) !== Tile.Floor) return;
    const dead = isDeadEnd(state, tx, ty);
    if (!dead && !isCorner(state, tx, ty)) return;
    const p = tileCenter(tx, ty);
    if (overlapsWall(state, p.x, p.y, radius) || nearAny(keepOut, p, c.keepClear)) return;
    (dead ? deadEnds : corners).push(p);
  };
  // 主の間のタイルは「見た」扱いにして、隅としても行き止まりとしても候補にしない
  const seen = new Set<number>(lordHallTiles(state));
  for (const t of roomFloorTiles(state)) {
    if (seen.has(t)) continue;
    seen.add(t);
    consider(t % state.map.width, Math.floor(t / state.map.width));
  }
  // 通路の行き止まり（どの部屋にも属さない床）
  for (let y = 0; y < state.map.height; y++) {
    for (let x = 0; x < state.map.width; x++) {
      if (seen.has(toIndex(state.map, x, y)) || !isDeadEnd(state, x, y)) continue;
      consider(x, y);
    }
  }
  return { corners, deadEnds };
}

/**
 * ボス階の専用の部屋（layout "lordHall"）の主の間の所属タイル。それ以外の階は空。
 * 主の間は部屋の形そのものが戦いの読みなので、壺・木箱で塞がない（docs/ideas/lordhall-design.md 2 章の 13）
 */
function lordHallTiles(state: GameState): ReadonlySet<number> {
  if (state.floorLayout !== "lordHall") return new Set();
  return state.rooms[state.rooms.length - 1]?.tiles ?? new Set();
}

/** pool から間隔を空けて need 個まで引き、placed に足す（引いた候補は使い切るまで戻さない） */
function pickSpots(state: GameState, pool: readonly Vec[], need: number, placed: Vec[]): void {
  const rest = [...pool];
  let left = need;
  while (left > 0 && rest.length > 0) {
    const [p] = rest.splice(state.rng.int(0, rest.length - 1), 1);
    if (!p || nearAny(placed, p, ECONOMY.container.spacing)) continue;
    placed.push(p);
    left--;
  }
}

/** この階に置く数: 下限〜上限の乱数 × 面積倍率（乱数 1 回） */
function rollCount(state: GameState): number {
  const c = ECONOMY.container;
  return Math.max(0, Math.round(state.rng.int(c.perFloorMin, c.perFloorMax) * (state.floorAreaMul ?? 1)));
}

/**
 * この階の壺・木箱を置く（buildFloor の最後）。行き止まりを先に最大 deadEndMax 個、残りを塊の隅に。
 * 乱数は 個数 → 行き止まりの抽選 → 隅の抽選 → 置いた分だけ壺 / 木箱の順。試し場（sandbox）には置かない
 */
export function placeContainers(state: GameState): void {
  if (state.sandbox === true) return;
  const want = rollCount(state);
  const { corners, deadEnds } = candidateSpots(state);
  const placed: Vec[] = [];
  pickSpots(state, deadEnds, Math.min(want, ECONOMY.container.deadEndMax), placed);
  pickSpots(state, corners, want - placed.length, placed);
  for (const pos of placed) {
    const key = state.rng.chance(ECONOMY.container.crateChance) ? CRATE_KEY : POT_KEY;
    state.enemies.push(createContainer(state, key, pos));
  }
}

/** 生命 1 の壺・木箱。階の深さで生命が伸びないよう createEnemy の後で 1 に戻す */
export function createContainer(state: GameState, key: string, pos: Vec): Enemy {
  const e = createEnemy(state, enemyDef(key), pos, ROAMING_ROOM, false);
  e.hp = 1;
  e.maxHp = 1;
  e.lastHp = 1;
  return e;
}
