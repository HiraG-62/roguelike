import type { GameState } from "../core/state";
import { EXIT } from "../data/tuning";
import { TILE_SIZE } from "../map/grid";
import { exitColor, exitLabel } from "../system/exits";
import { TEXT, drawTextShadow, textLineHeight } from "./pixelText";

/**
 * 出口の予告の描画（docs/ideas/boon-impl.md 2-3）。階段の上に降りた先の報酬を浮かべる。
 * 行き先のバイオーム名は runUi.ts が階段の真上に出すので、報酬はその 1 行上に置いて 2 行に見せる。
 * state を読むだけで、乱数は使わない
 */

const COLOR_SHADOW = "#000000";
/** runUi.ts の階段の行き先（LABEL_LIFT）の 1 行上に置く */
const DESTINATION_LIFT = 10;
const MIN_LINE = 10;

/** 階段 1 つぶんの表示 */
export interface ExitHint {
  x: number;
  y: number;
  text: string;
  color: string;
  /** 遠いほど暗い（nearRange 以内で 1、hintRange で dimAlpha） */
  alpha: number;
}

/** 距離 d（px）での文字の不透明度。hintRange を超えたら 0（出さない） */
export function exitHintAlpha(d: number): number {
  if (d > EXIT.hintRange) return 0;
  if (d <= EXIT.nearRange) return 1;
  const t = (d - EXIT.nearRange) / Math.max(1, EXIT.hintRange - EXIT.nearRange);
  return 1 - (1 - EXIT.dimAlpha) * t;
}

/** いま描く報酬の一覧。まだ見つけていない階段・予告の無い階段・遠い階段は出さない */
export function exitHints(state: GameState): ExitHint[] {
  const p = state.player.body.pos;
  const hints: ExitHint[] = [];
  for (const choice of state.stairs) {
    const color = exitColor(choice.reward);
    if (choice.tile < 0 || color === null || state.explored[choice.tile] !== 1) continue;
    const x = ((choice.tile % state.map.width) + 0.5) * TILE_SIZE;
    const y = (Math.floor(choice.tile / state.map.width) + 0.5) * TILE_SIZE;
    const alpha = exitHintAlpha(Math.hypot(p.x - x, p.y - y));
    if (alpha <= 0) continue;
    hints.push({ x, y, text: exitLabel(choice.reward), color, alpha });
  }
  return hints;
}

/** ワールド座標の層（カメラの変換の中）で呼ぶ */
export function drawExitHints(ctx: CanvasRenderingContext2D, state: GameState): void {
  const hints = exitHints(state);
  if (hints.length === 0) return;
  const line = Math.max(MIN_LINE, textLineHeight(TEXT.SMALL));
  for (const h of hints) {
    ctx.globalAlpha = h.alpha;
    drawTextShadow(ctx, h.text, h.x, h.y - DESTINATION_LIFT - line, TEXT.SMALL, h.color, COLOR_SHADOW, "center");
  }
  ctx.globalAlpha = 1;
}
