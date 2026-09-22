import { type GameState, type RoomState, allocId, pushLog } from "../core/state";
import { enemiesForDepth, type EnemyDef } from "../data/enemies";
import { ROOM } from "../data/tuning";
import { DEFAULT_GENERATOR_OPTIONS, generateRoomsAndCorridors } from "../map/generator";
import {
  type GameMap,
  type Rect,
  TILE_SIZE,
  Tile,
  getTile,
  isWalkable,
  rectCenterPx,
  rectContainsPx,
  toIndex,
} from "../map/grid";
import { snapCamera } from "./camera";
import { COLOR_HEAL, healPlayer } from "./combat";
import { addFloatingText, shake, spawnBurst } from "./effects";
import { createEnemy } from "./enemies";
import { circlesOverlap, overlapsWall } from "./physics";

const START_ROOM = 0;
const PICKUP_RADIUS = 6;

/** 新しいフロアを生成してプレイヤーを配置する */
export function buildFloor(state: GameState): void {
  state.map = generateRoomsAndCorridors(state.rng, DEFAULT_GENERATOR_OPTIONS);
  state.rooms = state.map.rooms.map((rect) => ({
    rect,
    cleared: false,
    locked: false,
    doorTiles: findDoorTiles(state.map, rect),
  }));
  state.lockedTiles = new Set();
  state.enemies = [];
  state.projectiles = [];
  state.pickups = [];
  state.particles = [];
  state.texts = [];

  const start = state.rooms[START_ROOM];
  if (start) {
    start.cleared = true;
    state.player.body.pos = rectCenterPx(start.rect);
  }
  snapCamera(state);

  state.rooms.forEach((room, i) => {
    if (i === START_ROOM) return;
    populateRoom(state, room, i);
  });
}

/** 部屋の外周 1 マス外側にある床 = 出入口 */
function findDoorTiles(map: GameMap, r: Rect): number[] {
  const tiles: number[] = [];
  for (let x = r.x - 1; x <= r.x + r.w; x++) {
    for (const y of [r.y - 1, r.y + r.h]) {
      if (isWalkable(map, x, y)) tiles.push(toIndex(map, x, y));
    }
  }
  for (let y = r.y; y < r.y + r.h; y++) {
    for (const x of [r.x - 1, r.x + r.w]) {
      if (isWalkable(map, x, y)) tiles.push(toIndex(map, x, y));
    }
  }
  return tiles;
}

function enemyCount(state: GameState): number {
  return Math.min(ROOM.maxEnemies, ROOM.baseEnemies + state.depth * ROOM.enemiesPerDepth);
}

function populateRoom(state: GameState, room: RoomState, index: number): void {
  const count = enemyCount(state);
  for (let i = 0; i < count; i++) {
    const def = pickEnemy(state);
    const pos = randomFreePoint(state, room.rect, def.radius);
    if (!pos) continue;
    state.enemies.push(createEnemy(state, def, pos, index, false));
  }
}

function pickEnemy(state: GameState): EnemyDef {
  const pool = enemiesForDepth(state.depth);
  const total = pool.reduce((s, d) => s + d.weight, 0);
  let roll = state.rng.next() * total;
  for (const def of pool) {
    roll -= def.weight;
    if (roll <= 0) return def;
  }
  return pool[pool.length - 1] ?? pool[0]!;
}

const FREE_POINT_ATTEMPTS = 30;
/** プレイヤーの近くに湧かせない距離 */
const SPAWN_CLEARANCE = 40;

function randomFreePoint(state: GameState, r: Rect, radius: number): { x: number; y: number } | null {
  for (let i = 0; i < FREE_POINT_ATTEMPTS; i++) {
    const x = (r.x + 1 + state.rng.next() * (r.w - 2)) * TILE_SIZE;
    const y = (r.y + 1 + state.rng.next() * (r.h - 2)) * TILE_SIZE;
    if (overlapsWall(state, x, y, radius)) continue;
    const p = state.player.body.pos;
    if (circlesOverlap(x, y, radius, p.x, p.y, SPAWN_CLEARANCE)) continue;
    if (state.enemies.some((e) => circlesOverlap(x, y, radius, e.body.pos.x, e.body.pos.y, e.body.radius))) continue;
    return { x, y };
  }
  return null;
}

/** 部屋のロック/解除、階段、ピックアップ */
export function updateRooms(state: GameState, dt: number): void {
  const p = state.player.body.pos;
  state.rooms.forEach((room, i) => {
    if (room.cleared) return;
    if (!room.locked) {
      if (rectContainsPx(room.rect, p.x, p.y, ROOM.enterMargin)) lockRoom(state, room, i);
      return;
    }
    const alive = state.enemies.some((e) => e.roomIndex === i && e.hp > 0);
    if (!alive) clearRoom(state, room);
  });

  updatePickups(state, dt);
  checkStairs(state);
}

function lockRoom(state: GameState, room: RoomState, index: number): void {
  room.locked = true;
  for (const t of room.doorTiles) state.lockedTiles.add(t);
  for (const e of state.enemies) {
    if (e.roomIndex === index && e.phase === "idle") e.phase = "chase";
  }
  // 増援を telegraph 付きで湧かせる
  const extra = Math.round(enemyCount(state) * ROOM.reinforcementRatio);
  for (let i = 0; i < extra; i++) {
    const def = pickEnemy(state);
    const pos = randomFreePoint(state, room.rect, def.radius);
    if (!pos) continue;
    const e = createEnemy(state, def, pos, index, true);
    e.phaseTimer = ROOM.spawnTelegraph;
    state.enemies.push(e);
  }
  shake(state, 3);
  addFloatingText(state, p2(state), "LOCKED", "#ff8080", 1.2, 0.8);
}

function clearRoom(state: GameState, room: RoomState): void {
  room.locked = false;
  room.cleared = true;
  for (const t of room.doorTiles) state.lockedTiles.delete(t);
  state.score += ROOM.clearBonus;
  addFloatingText(state, p2(state), "ROOM CLEAR", "#ffd75f", 1.5, 1);
  state.flash = Math.max(state.flash, 0.25);
  if (state.rng.chance(ROOM.heartDropChance)) {
    state.pickups.push({
      id: allocId(state),
      kind: "heart",
      pos: rectCenterPx(room.rect),
      radius: PICKUP_RADIUS,
      bobTime: 0,
    });
  }
}

function p2(state: GameState): { x: number; y: number } {
  return { x: state.player.body.pos.x, y: state.player.body.pos.y - 10 };
}

function updatePickups(state: GameState, dt: number): void {
  const p = state.player.body;
  for (const pk of state.pickups) {
    pk.bobTime += dt;
    if (!circlesOverlap(pk.pos.x, pk.pos.y, pk.radius, p.pos.x, p.pos.y, p.radius)) continue;
    healPlayer(state, ROOM.heartHeal);
    spawnBurst(state, pk.pos, COLOR_HEAL, 12, 100, 0.4, 2);
    pk.radius = 0;
  }
  state.pickups = state.pickups.filter((pk) => pk.radius > 0);
}

function checkStairs(state: GameState): void {
  const p = state.player.body.pos;
  const tx = Math.floor(p.x / TILE_SIZE);
  const ty = Math.floor(p.y / TILE_SIZE);
  if (getTile(state.map, tx, ty) !== Tile.StairsDown) return;
  descend(state);
}

export function descend(state: GameState): void {
  state.depth += 1;
  state.score += ROOM.clearBonus * state.depth;
  buildFloor(state);
  state.flash = 1;
  addFloatingText(state, p2(state), `DEPTH ${state.depth}`, "#ffd75f", 2, 1.2);
  pushLog(state, `You descend to depth ${state.depth}.`, "#ffd75f");
}
