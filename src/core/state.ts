import { createRng, type Rng } from "./rng";
import { type GameEvent, type LogMessage, describeEvent } from "./events";
import { type GameMap, type Point, type Rect, Tile, getTile, isWalkable, rectCenter } from "../map/grid";
import { DEFAULT_GENERATOR_OPTIONS, generateRoomsAndCorridors } from "../map/generator";
import { computeFov } from "../map/fov";
import { type Entity, createPlayer } from "../entity/entity";
import { type MonsterDef, monstersForDepth } from "../data/monsters";

export type GameStatus = "playing" | "dead";

/** ゲームステートは純データ。描画・入力に依存しない */
export interface GameState {
  seed: number;
  /** 人が読めるシード文字列。表示・共有用 */
  seedText: string;
  status: GameStatus;
  depth: number;
  turn: number;
  map: GameMap;
  /** 今見えているセル (1 = 可視) */
  visible: Uint8Array;
  /** 一度でも見たセル (1 = 探索済み)。フロアごとにリセット */
  explored: Uint8Array;
  entities: Entity[];
  playerId: number;
  nextEntityId: number;
  /** 発行された全イベント。リプレイ・実績の材料 */
  events: GameEvent[];
  /** イベントから派生した表示用ログ */
  log: LogMessage[];
  /** 状態と一緒に持ち回る。フロア生成のたびに消費されるので再現性が保たれる */
  rng: Rng;
}

const PLAYER_ID = 0;
const FALLBACK_START: Point = { x: 1, y: 1 };
export const FOV_RADIUS = 8;

/** フロアあたりのモンスター数 = BASE + depth * PER_DEPTH（上限 MAX） */
const SPAWN_BASE = 3;
const SPAWN_PER_DEPTH = 1;
const SPAWN_MAX = 14;
const SPAWN_ATTEMPTS = 50;

export function createGame(seed: number, seedText = String(seed)): GameState {
  const rng = createRng(seed);
  const map = generateRoomsAndCorridors(rng, DEFAULT_GENERATOR_OPTIONS);
  const state: GameState = {
    seed,
    seedText,
    status: "playing",
    depth: 1,
    turn: 0,
    map,
    visible: new Uint8Array(map.tiles.length),
    explored: new Uint8Array(map.tiles.length),
    entities: [createPlayer(PLAYER_ID, startPosition(map))],
    playerId: PLAYER_ID,
    nextEntityId: PLAYER_ID + 1,
    events: [],
    log: [],
    rng,
  };
  spawnMonsters(state);
  updateFov(state);
  emit(state, { type: "welcome" });
  return state;
}

function startPosition(map: GameMap): Point {
  const first = map.rooms[0];
  return first ? rectCenter(first) : { ...FALLBACK_START };
}

export function getPlayer(state: GameState): Entity {
  const p = state.entities.find((e) => e.id === state.playerId);
  if (!p) throw new Error("player not found");
  return p;
}

export function entityAt(state: GameState, x: number, y: number): Entity | undefined {
  return state.entities.find((e) => e.pos.x === x && e.pos.y === y);
}

/** イベントを発行し、ログに反映する */
export function emit(state: GameState, ev: GameEvent): void {
  state.events.push(ev);
  const msg = describeEvent(ev);
  if (msg) state.log.push({ ...msg, turn: state.turn });
}

/** プレイヤー位置から視界を再計算し、探索済みに積む */
export function updateFov(state: GameState): void {
  const player = getPlayer(state);
  state.visible = computeFov(state.map, player.pos, FOV_RADIUS);
  for (let i = 0; i < state.visible.length; i++) {
    if (state.visible[i]) state.explored[i] = 1;
  }
}

export type Direction = { dx: -1 | 0 | 1; dy: -1 | 0 | 1 };

/** 任意の Entity を 1 マス動かす。壁・他 Entity で塞がっていれば false */
export function tryMove(state: GameState, e: Entity, dir: Direction): boolean {
  if (dir.dx === 0 && dir.dy === 0) return false;
  const nx = e.pos.x + dir.dx;
  const ny = e.pos.y + dir.dy;
  if (!isWalkable(state.map, nx, ny)) return false;
  if (entityAt(state, nx, ny)) return false;
  e.pos = { x: nx, y: ny };
  if (e.id === state.playerId) updateFov(state);
  return true;
}

/** 階段の上にいれば次の階へ。そうでなければ false */
export function descend(state: GameState): boolean {
  const player = getPlayer(state);
  if (getTile(state.map, player.pos.x, player.pos.y) !== Tile.StairsDown) return false;
  state.depth += 1;
  state.map = generateRoomsAndCorridors(state.rng, DEFAULT_GENERATOR_OPTIONS);
  state.explored = new Uint8Array(state.map.tiles.length);
  state.entities = [player];
  player.pos = startPosition(state.map);
  spawnMonsters(state);
  updateFov(state);
  emit(state, { type: "descend", depth: state.depth });
  return true;
}

export function spawnMonster(state: GameState, def: MonsterDef, pos: Point): Entity {
  const monster: Entity = {
    id: state.nextEntityId++,
    kind: "monster",
    name: def.name,
    glyph: def.glyph,
    color: def.color,
    pos,
    stats: { ...def.stats },
    speed: def.speed,
    energy: 0,
    xpValue: def.xpValue,
    level: 1,
    xp: 0,
    ai: def.ai,
  };
  state.entities.push(monster);
  return monster;
}

/** 開始部屋以外の部屋にモンスターをばらまく */
function spawnMonsters(state: GameState): void {
  const candidates = monstersForDepth(state.depth);
  const rooms = state.map.rooms.slice(1);
  if (candidates.length === 0 || rooms.length === 0) return;

  const count = Math.min(SPAWN_MAX, SPAWN_BASE + state.depth * SPAWN_PER_DEPTH);
  let spawned = 0;
  for (let i = 0; i < SPAWN_ATTEMPTS && spawned < count; i++) {
    const room = state.rng.pick(rooms);
    const pos = randomPointInRoom(state, room);
    if (!isWalkable(state.map, pos.x, pos.y) || entityAt(state, pos.x, pos.y)) continue;
    spawnMonster(state, state.rng.pick(candidates), pos);
    spawned++;
  }
}

function randomPointInRoom(state: GameState, room: Rect): Point {
  return {
    x: state.rng.int(room.x, room.x + room.w - 1),
    y: state.rng.int(room.y, room.y + room.h - 1),
  };
}
