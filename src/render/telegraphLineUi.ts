import type { Enemy, GameState } from "../core/state";
import { type Vec, normalize, sub } from "../core/vec";
import { enemyDef } from "../data/enemies";
import { TELEGRAPH } from "../data/tuning";
import { behaviorOf } from "../system/behaviors/registry";
import { attackCommitted } from "../system/poise";

/**
 * 敵の予告の線（docs/ideas/combat-core-impl.md 2-3）。state を読むだけで、rng も書き込みも使わない。
 * 色は「まだ怯ませて潰せる（黄）」と「コミット済みで必ず出る（赤）」の 2 つ
 */

/** 予告の色。予備動作の前半は黄、コミット窓に入ったら赤（頭上の「!」も同じ色） */
export function telegraphColor(e: Enemy): string {
  return attackCommitted(e) ? TELEGRAPH.commitColor : TELEGRAPH.readyColor;
}

/**
 * 線の向き。狙いを予備動作の終わりで更新する敵（beginStrike が player 方向へ向け直す）は、
 * 今のプレイヤー方向を向く。予備動作の始まりで狙いを固定する敵は strikeDir のまま
 */
export function telegraphLineDir(e: Enemy, aimFixed: boolean, playerPos: Vec): Vec {
  if (aimFixed) return e.strikeDir;
  return normalize(sub(playerPos, e.body.pos), e.strikeDir);
}

/** 線を 1 本描く。length は enemyTelegraph が決めた届く距離 */
export function drawStrikeLine(ctx: CanvasRenderingContext2D, state: GameState, e: Enemy, length: number): void {
  const def = enemyDef(e.defKey);
  const dir = telegraphLineDir(e, behaviorOf(def).aimFixedAtWindup(e, def), state.player.body.pos);
  ctx.strokeStyle = telegraphColor(e);
  ctx.globalAlpha = TELEGRAPH.lineAlpha;
  ctx.lineWidth = TELEGRAPH.lineWidth;
  ctx.beginPath();
  ctx.moveTo(e.body.pos.x, e.body.pos.y);
  ctx.lineTo(e.body.pos.x + dir.x * length, e.body.pos.y + dir.y * length);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.globalAlpha = 1;
}
