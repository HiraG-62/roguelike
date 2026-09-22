import { createRng, type Rng } from "./rng";
import { type GameMap, Tile, getTile, isWalkable, rectCenter } from "../map/grid";
import { DEFAULT_GENERATOR_OPTIONS, generateRoomsAndCorridors } from "../map/generator";
import { type Entity, createPlayer } from "../entity/entity";

/** ゲームステートは純データ。描画・入力に依存しない */
export interface GameState {
  seed: number;
  depth: number;
  map: GameMap;
  entities: Entity[];
  playerId: number;
  nextEntityId: number;
  /** 状態と一緒に持ち回る。フロア生成のたびに消費されるので再現性が保たれる */
  rng: Rng;
}

const PLAYER_ID = 0;
const FALLBACK_START = { x: 1, y: 1 };

export function createGame(seed: number): GameState {
  const rng = createRng(seed);
  const map = generateRoomsAndCorridors(rng, DEFAULT_GENERATOR_OPTIONS);
  return {
    seed,
    depth: 1,
    map,
    entities: [createPlayer(PLAYER_ID, startPosition(map))],
    playerId: PLAYER_ID,
    nextEntityId: PLAYER_ID + 1,
    rng,
  };
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

export type Direction = { dx: -1 | 0 | 1; dy: -1 | 0 | 1 };

/** 移動できたら true。壁なら何もせず false */
export function movePlayer(state: GameState, dir: Direction): boolean {
  const player = getPlayer(state);
  const nx = player.pos.x + dir.dx;
  const ny = player.pos.y + dir.dy;
  if (!isWalkable(state.map, nx, ny)) return false;
  player.pos = { x: nx, y: ny };
  return true;
}

/** 階段の上にいれば次の階へ。そうでなければ false */
export function descend(state: GameState): boolean {
  const player = getPlayer(state);
  if (getTile(state.map, player.pos.x, player.pos.y) !== Tile.StairsDown) return false;
  state.depth += 1;
  state.map = generateRoomsAndCorridors(state.rng, DEFAULT_GENERATOR_OPTIONS);
  player.pos = startPosition(state.map);
  return true;
}
