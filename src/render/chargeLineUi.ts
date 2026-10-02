import type { Enemy } from "../core/state";
import { TELEGRAPH } from "../data/tuning";
import type { Seg } from "./telegraphInk";

/**
 * 二度突きの猪の予告線の材料（docs/ideas/enemies.md E6）。e.doubleCharge（system/enemyBehaviors.ts が予備動作の始まりに決める）を読むだけ。
 * 予備動作中は 2 本とも出し、2 本目は薄く描く。突進の 1 本目を走っている間も、曲がった先の 2 本目を薄く残す。
 * 筆致（下絵 / 墨入れ）は telegraphLayer.ts が引く。止めは最後の端だけ
 */

export interface ChargeLeg {
  seg: Seg;
  /** 薄く描く倍率（2 本目） */
  alpha: number;
  stop: boolean;
}

export function doubleChargeLegs(e: Enemy): ChargeLeg[] {
  const path = e.doubleCharge;
  if (!path) return [];
  const winding = e.phase === "windup";
  const firstLeg = e.phase === "strike" && path.leg === 1;
  if (!winding && !firstLeg) return [];
  const legs: ChargeLeg[] = [];
  if (winding) legs.push({ seg: { x0: e.body.pos.x, y0: e.body.pos.y, x1: path.turn.x, y1: path.turn.y }, alpha: 1, stop: false });
  legs.push({ seg: { x0: path.turn.x, y0: path.turn.y, x1: path.end.x, y1: path.end.y }, alpha: TELEGRAPH.sketchSecondAlpha, stop: true });
  return legs;
}
