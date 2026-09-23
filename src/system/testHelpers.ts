import { createGame } from "../core/game";
import { EMPTY_INPUT, type FrameInput } from "../core/input";
import type { Enemy, GameState } from "../core/state";
import { enemyDef } from "../data/enemies";
import { DEFAULT_STATS, type PlayerStats } from "../loot/types";
import { createEnemy } from "./enemies";

/** テスト専用ヘルパー（本体からは import しない） */

export function withInput(partial: Partial<FrameInput>): FrameInput {
  return { ...EMPTY_INPUT, move: { ...EMPTY_INPUT.move }, ...partial };
}

/** 敵のいない開始部屋に立った状態。クリティカルは切っておく（乱数で数値がぶれないように） */
export function arena(seed = 5, stats: Partial<PlayerStats> = {}): GameState {
  const state = createGame(seed);
  state.enemies = [];
  state.stats = { ...DEFAULT_STATS, critChance: 0, keystones: [], triggers: [], ...stats };
  state.player.maxHp = state.stats.maxHp;
  state.player.hp = state.stats.maxHp;
  state.player.dashChargesLeft = state.stats.dashCharges;
  state.player.facing = { x: 1, y: 0 };
  return state;
}

/** プレイヤーから (dx, dy) の位置に敵を置く */
export function placeEnemy(state: GameState, key: string, dx: number, dy = 0): Enemy {
  const p = state.player.body.pos;
  const e = createEnemy(state, enemyDef(key), { x: p.x + dx, y: p.y + dy }, 0, false);
  state.enemies.push(e);
  return e;
}

/**
 * 立っている開始部屋を「封鎖しない部屋で交戦中」にする（開放型フロアの交戦。system/engagement.ts）。
 * 部屋の敵が 1 体必要なので、プレイヤーから離した位置に部屋 0 所属の敵を置いて返す
 */
export function engageStartRoom(state: GameState, enemyDx = 200): Enemy {
  const room = state.rooms[0];
  if (!room) throw new Error("開始部屋が無い");
  room.locked = false;
  room.cleared = false;
  room.engaged = true;
  const e = placeEnemy(state, "slime", enemyDx);
  e.roomIndex = 0;
  return e;
}
