import { createRng, type Rng } from "./rng";
import { type GameMap, Tile, getTile, isWalkable, rectCenter } from "../map/grid";
import { DEFAULT_GENERATOR_OPTIONS, generateRoomsAndCorridors } from "../map/generator";
import { computeFov } from "../map/fov";
import { type Entity, createPlayer } from "../entity/entity";

/** ゲームステートは純データ。描画・入力に依存しない */
export interface GameState {
  seed: number;
  depth: number;
  map: GameMap;
  /** 今見えているセル (1 = 可視) */
  visible: Uint8Array;
  /** 一度でも見たセル (1 = 探索済み)。フロアごとにリセット */
  explored: Uint8Array;
  entities: Entity[];
  playerId: number;
  nextEntityId: number;
  /** 状態と一緒に持ち回る。フロア生成のたびに消費されるので再現性が保たれる */
  rng: Rng;
}

const PLAYER_ID = 0;
const FALLBACK_START = { x: 1, y: 1 };
export const FOV_RADIUS = 8;

export function createGame(seed: number): GameState {
  const rng = createRng(seed);
  const map = generateRoomsAndCorridors(rng, DEFAULT_GENERATOR_OPTIONS);
  const state: GameState = {
    seed,
    depth: 1,
    map,
    visible: new Uint8Array(map.tiles.length),
    explored: new Uint8Array(map.tiles.length),
    entities: [createPlayer(PLAYER_ID, startPosition(map))],
    playerId: PLAYER_ID,
    nextEntityId: PLAYER_ID + 1,
    rng,
  };
  updateFov(state);
  return state;
}

function startPosition(map: GameMap) {
  const first = map.rooms[0];
  return first ? rectCenter(first) : { ...FALLBACK_START };
}

export function getPlayer(state: GameState): Entity {
  const p = state.entities.find((e) => e.id === state.playerId);
  if (!p) throw new Error("player not found");
  return p;
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

/** 移動できたら true。壁なら何もせず false */
export function movePlayer(state: GameState, dir: Direction): boolean {
  const player = getPlayer(state);
  const nx = player.pos.x + dir.dx;
  const ny = player.pos.y + dir.dy;
  if (!isWalkable(state.map, nx, ny)) return false;
  player.pos = { x: nx, y: ny };
  updateFov(state);
  return true;
}

/** 階段の上にいれば次の階へ。そうでなければ false */
export function descend(state: GameState): boolean {
  const player = getPlayer(state);
  if (getTile(state.map, player.pos.x, player.pos.y) !== Tile.StairsDown) return false;
  state.depth += 1;
  state.map = generateRoomsAndCorridors(state.rng, DEFAULT_GENERATOR_OPTIONS);
  state.explored = new Uint8Array(state.map.tiles.length);
  player.pos = startPosition(state.map);
  updateFov(state);
  return true;
}
