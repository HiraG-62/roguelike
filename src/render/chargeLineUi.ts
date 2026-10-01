import type { Enemy } from "../core/state";
import { DOUBLE_CHARGE } from "../data/tuning";
import { telegraphColor } from "./telegraphLineUi";

/**
 * 二度突きの猪の予告線（docs/ideas/enemies.md E6）。e.doubleCharge（system/enemyBehaviors.ts が予備動作の始まりに決める）を読むだけ。
 * 予備動作中は 2 本とも出し、2 本目は薄く描く。突進の 1 本目を走っている間も、曲がった先の 2 本目を薄く残す
 */

export function drawDoubleChargeLine(ctx: CanvasRenderingContext2D, e: Enemy): void {
  const path = e.doubleCharge;
  if (!path) return;
  const winding = e.phase === "windup";
  const firstLeg = e.phase === "strike" && path.leg === 1;
  if (!winding && !firstLeg) return;
  // 色は他の予告の線と同じ規則（黄 = まだ怯ませられる、赤 = コミット後）
  ctx.strokeStyle = telegraphColor(e);
  if (winding) {
    ctx.globalAlpha = DOUBLE_CHARGE.lineAlpha;
    strokeSegment(ctx, e.body.pos.x, e.body.pos.y, path.turn.x, path.turn.y);
  }
  ctx.globalAlpha = DOUBLE_CHARGE.secondAlpha;
  strokeSegment(ctx, path.turn.x, path.turn.y, path.end.x, path.end.y);
  ctx.globalAlpha = 1;
}

function strokeSegment(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}
