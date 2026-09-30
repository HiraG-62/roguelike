import type { GameState } from "../core/state";
import { ECONOMY } from "../data/tuning";
import { flaskCapacity } from "../system/flask";
import type { HudRect } from "./renderMath";

/**
 * 瓶の HUD（docs/ideas/economy-impl.md 2-3）。気力バーの下、ダッシュのチャージと同じ行の右端に、
 * 上限の数だけ小さな瓶の枡を並べる（持っている本数ぶんは色付き、空は輪郭だけ）。
 * 絵が来るまでは矩形。state を読むだけで、乱数は使わない
 */

export const FLASK_CELL_W = 5;
export const FLASK_CELL_H = 6;
export const FLASK_CELL_GAP = 2;
/** 枡を描く上限（上限を大きく盛っても行を突き破らない） */
export const FLASK_CELLS_MAX = 8;
/** 飲んだ直後（再使用待ち）の枡の色 */
const COLOR_FLASK_WAIT = "#805060";
const COLOR_FLASK_EDGE = "#a06070";
const COLOR_FLASK_EMPTY_BG = "#281018";

export interface FlaskHudLayout {
  /** 左から順の枡（外枠。中身は 1px 内側） */
  readonly cells: readonly HudRect[];
  /** 枡全体の外接矩形（他の HUD との重なりの検査用）。枡が 0 個なら幅 0 */
  readonly bounds: HudRect;
}

/** 表示する枡の数（上限 0 なら 0、多すぎるなら FLASK_CELLS_MAX） */
export function flaskCellCount(capacity: number): number {
  return Math.max(0, Math.min(FLASK_CELLS_MAX, Math.floor(capacity)));
}

/** 配置。right は枡の右端の x、y は上端（気力バーの右端に揃える） */
export function flaskHudLayout(right: number, y: number, count: number): FlaskHudLayout {
  const n = flaskCellCount(count);
  const width = n === 0 ? 0 : n * FLASK_CELL_W + (n - 1) * FLASK_CELL_GAP;
  const left = right - width;
  const cells = Array.from({ length: n }, (_, i): HudRect => ({ x: left + i * (FLASK_CELL_W + FLASK_CELL_GAP), y, w: FLASK_CELL_W, h: FLASK_CELL_H }));
  return { cells, bounds: { x: left, y, w: width, h: n === 0 ? 0 : FLASK_CELL_H } };
}

/** i 番目（0 始まり）の枡が満ちているか */
export function flaskCellFilled(owned: number, index: number): boolean {
  return index < owned;
}

export function drawFlaskHud(ctx: CanvasRenderingContext2D, state: GameState, right: number, y: number): void {
  if (state.sandbox === true) return;
  const layout = flaskHudLayout(right, y, flaskCapacity(state));
  const waiting = state.time < state.player.flaskReadyAt;
  layout.cells.forEach((cell, i) => {
    ctx.fillStyle = COLOR_FLASK_EDGE;
    ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
    const inner = { x: cell.x + 1, y: cell.y + 1, w: cell.w - 2, h: cell.h - 2 };
    const filled = flaskCellFilled(state.player.flasks, i);
    ctx.fillStyle = filled ? (waiting ? COLOR_FLASK_WAIT : ECONOMY.flask.color) : COLOR_FLASK_EMPTY_BG;
    ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
  });
}
