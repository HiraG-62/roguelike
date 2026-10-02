import type { Enemy } from "../core/state";
import type { Vec } from "../core/vec";
import { ENEMY_TEMPO, TELEGRAPH_POSE } from "../data/tuning";
import { attackCommitted } from "../system/poise";
import { clamp01 } from "./renderMath";

/**
 * 予備動作の体の動き（docs/ideas/ink-telegraph-impl.md 段 0-a）。
 * 黄の間は攻撃の逆へのけぞって縦に縮む（溜め。向きと時機を言う）、赤に入った瞬間は攻撃の向きへ伸びる（張り）。
 * 以前の細かい揺れは「危ない」しか言わず向きを言わなかったので置き換えた。色は重ねない（燃焼・怯みの星と紛れる）。
 * 描画だけ。state を読むだけで rng も書き込みも使わない
 */

export interface TelegraphPose {
  /** 体の描き位置のずれ（論理 px） */
  dx: number;
  dy: number;
  /** 体の伸縮の倍率 */
  sx: number;
  sy: number;
}

const NEUTRAL: TelegraphPose = { dx: 0, dy: 0, sx: 1, sy: 1 };

/** 黄の間の進み 0..1（予備動作の始まり 0 → 赤に入る瞬間 1） */
export function yellowProgress(e: Enemy): number {
  if (e.windupTotal <= 0) return 0;
  const span = e.windupTotal * (1 - ENEMY_TEMPO.commitRatio);
  if (span <= 0) return 1;
  return clamp01((e.windupTotal - e.phaseTimer) / span);
}

/** 溜めと張り。dir は攻撃の向き（単位ベクトル）、time は state.time */
export function telegraphPose(e: Enemy, time: number, dir: Vec): TelegraphPose {
  if (e.phase !== "windup") return NEUTRAL;
  // 大きな体（ボス）は全身が動くと不自然なので、半径の比で小さくする
  const scale = Math.min(1, TELEGRAPH_POSE.refRadius / Math.max(1, e.body.radius));
  if (!attackCommitted(e)) {
    const p = yellowProgress(e) * scale;
    return {
      dx: -dir.x * TELEGRAPH_POSE.leanPx * p,
      dy: -dir.y * TELEGRAPH_POSE.leanPx * p,
      sx: 1 + (TELEGRAPH_POSE.squashMax * p) / 2,
      sy: 1 - TELEGRAPH_POSE.squashMax * p,
    };
  }
  const committedAt = e.committedAt;
  if (committedAt === undefined || committedAt < 0) return NEUTRAL;
  const elapsed = time - committedAt;
  if (elapsed < 0 || elapsed >= TELEGRAPH_POSE.stretchSec) return NEUTRAL;
  const k = (1 - elapsed / TELEGRAPH_POSE.stretchSec) * scale;
  return {
    dx: dir.x * TELEGRAPH_POSE.stretchPx * k,
    dy: dir.y * TELEGRAPH_POSE.stretchPx * k,
    sx: 1 + TELEGRAPH_POSE.stretch * k * Math.abs(dir.x),
    sy: 1 + TELEGRAPH_POSE.stretch * k * Math.abs(dir.y),
  };
}
