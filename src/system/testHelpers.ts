import { createGame, step } from "../core/game";
import { EMPTY_INPUT, type FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import { enemyDef } from "../data/enemies";
import { DEFAULT_STATS, type PlayerStats } from "../loot/types";
import { createEnemy } from "./enemies";
import { withBaseAreaMul } from "./floor";

/** テスト専用ヘルパー（本体からは import しない） */

export function withInput(partial: Partial<FrameInput>): FrameInput {
  return { ...EMPTY_INPUT, move: { ...EMPTY_INPUT.move }, ...partial };
}

/**
 * 敵のいない開始部屋に立った状態。クリティカルは切っておく（乱数で数値がぶれないように）。
 * マップは基準の大きさ（面積の倍率 1）で作る（広いマップの生成は重く、形のばらつきで小さな検証が揺れるため）
 */
export function arena(seed = 5, stats: Partial<PlayerStats> = {}): GameState {
  const state = withBaseAreaMul(() => createGame(seed));
  state.enemies = [];
  state.stats = { ...DEFAULT_STATS, critChance: 0, keystones: [], triggers: [], ...stats };
  state.player.maxHp = state.stats.maxHp;
  state.player.hp = state.stats.maxHp;
  state.player.dashChargesLeft = state.stats.dashCharges;
  state.player.facing = { x: 1, y: 0 };
  return state;
}

/**
 * この階の主（階の主 / ボス、どちらでも）を即座に倒し、階段を出す。
 * state.boss が指す敵の hp を 0 にして 1 step 進める（onBossDeath は enemies.ts の死亡処理から自然に呼ばれる）。
 * 主がいない、あるいは既に enemies から消えている（テストで丸ごと置き換えたなど）ときは何もしない
 */
export function slayFloorLord(state: GameState): void {
  const b = state.boss;
  if (!b) return;
  const e = state.enemies.find((x) => x.id === b.enemyId);
  if (!e) return;
  e.hp = 0;
  step(state, withInput({}), FIXED_DT);
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
