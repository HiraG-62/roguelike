import { type IncreasedTable, createIncreased } from "../core/damage";
import { createGame, step } from "../core/game";
import { EMPTY_INPUT, type FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { Enemy, GameState } from "../core/state";
import type { Vec } from "../core/vec";
import { VIEW_H, VIEW_W } from "../core/view";
import { enemyDef } from "../data/enemies";
import { DEFAULT_STATS, type PlayerStats } from "../loot/types";
import { withFixedLayout } from "../map/layout/select";
import { createEnemy } from "./enemies";
import { withBaseAreaMul } from "./floor";
import { updateInteract } from "./interact";

/** テスト専用ヘルパー（本体からは import しない） */

export function withInput(partial: Partial<FrameInput>): FrameInput {
  return { ...EMPTY_INPUT, move: { ...EMPTY_INPUT.move }, ...partial };
}

/** 一部のタグだけ増を持つ増の表（arena の stats に { increased: increasedWith({ melee: 1 }) } のように渡す） */
export function increasedWith(partial: Partial<IncreasedTable>): IncreasedTable {
  return { ...createIncreased(), ...partial };
}

/**
 * 敵のいない開始部屋に立った状態。クリティカルは切っておく（乱数で数値がぶれないように）。
 * マップは基準の大きさ（面積の倍率 1）・旧生成器（"legacy"。階の型の抽選で乱数を引かない）で作る
 * （広いマップの生成は重く、形のばらつきで小さな検証が揺れるため）
 */
export function arena(seed = 5, stats: Partial<PlayerStats> = {}): GameState {
  const state = withFixedLayout("legacy", () => withBaseAreaMul(() => createGame(seed)));
  state.enemies = [];
  state.stats = { ...DEFAULT_STATS, critChance: 0, keystones: [], triggers: [], increased: createIncreased(), more: [], ...stats };
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

/** 世界座標 → 画面座標（core/view.ts の screenToWorld の逆。照準 aimScreen を組むため） */
export function screenOfWorld(state: GameState, world: Vec): Vec {
  const cam = state.camera;
  const ox = Math.round(VIEW_W / 2 - cam.pos.x + cam.offset.x);
  const oy = Math.round(VIEW_H / 2 - cam.pos.y + cam.offset.y);
  return { x: world.x + ox, y: world.y + oy };
}

/** 照準を aim に合わせてインタラクトを 1 回押す（プレイヤーは動かさない。system/interact.ts の入口だけ回す） */
export function pressInteract(state: GameState, aim: Vec): void {
  updateInteract(state, withInput({ interactPressed: true, aimScreen: screenOfWorld(state, aim) }));
}

/** pos に立ち、照準を pos に合わせてインタラクトを 1 回押す（台座を使う・床の物を拾う） */
export function interactAt(state: GameState, pos: Vec): void {
  state.player.body.pos = { ...pos };
  pressInteract(state, pos);
}

/** withTuning の上書き。読み取り専用のバランスの型でも書けるよう readonly を外し、入れ子は一部だけ書ける（配列は添字で `{ 1: … }`） */
export type TuningPatch<T> = T extends readonly (infer E)[]
  ? { [index: number]: TuningPatch<E> }
  : T extends object
    ? { -readonly [K in keyof T]?: TuningPatch<T[K]> }
    : T;

function isPlainObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

/** patch を target へ入れ子ごとに書き、元に戻す手順を restores へ積む（葉だけ差し替えるので、ロジックが握った参照も新しい値を読む） */
function applyPatch(target: object, patch: object, restores: (() => void)[]): void {
  for (const [key, value] of Object.entries(patch)) {
    const current: unknown = Reflect.get(target, key);
    if (isPlainObject(current) && isPlainObject(value)) {
      applyPatch(current, value, restores);
      continue;
    }
    const had = Object.prototype.hasOwnProperty.call(target, key);
    restores.push(() => {
      if (had) Reflect.set(target, key, current);
      else Reflect.deleteProperty(target, key);
    });
    Reflect.set(target, key, value);
  }
}

/**
 * バランスの数値を fn の間だけ上書きする（docs/TESTING.md「振る舞いのテストは数値を固定する」）。
 * 仕組みのテストを本番の JSON の値から切り離すため。ロジックが実際に読むオブジェクト（data/tuning.ts の再 export など）を渡す。
 * モジュールの読み込み時に計算済みの定数には効かない。fn は同期のみ（終わった時点で必ず元へ戻す）
 */
export function withTuning<T extends object, R>(target: T, patch: TuningPatch<T>, fn: () => R): R {
  const restores: (() => void)[] = [];
  try {
    applyPatch(target, patch, restores);
    return fn();
  } finally {
    for (let i = restores.length - 1; i >= 0; i--) restores[i]?.();
  }
}
