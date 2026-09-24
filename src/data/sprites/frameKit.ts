/**
 * 描き直し（docs/ideas/graphics-style.md）の家族ファイルが共有する小道具。
 * sprites.ts の同名関数と同じ意味だが、家族ファイルから sprites.ts を値で import すると循環するので分けて持つ
 */
import type { SpriteFrames } from "../sprites";

export type Frame = readonly string[];

/** 様式書のキャンバス（キャラ・通常敵）。小型は 16 のまま */
export const CANVAS_24 = 24;
/** 様式書のキャンバス（ゴーレム・鎧・宝箱などの重量級） */
export const CANVAS_32 = 32;

/** 予備動作・攻撃の原画を載せるキーの接尾辞（`slime.windup` のように引く） */
export const POSE_SUFFIXES = ["windup", "strike"] as const;
export type PoseSuffix = (typeof POSE_SUFFIXES)[number];

export function poseKey(base: string, pose: PoseSuffix): string {
  return `${base}.${pose}`;
}

/** 1px 持ち上げる（最上段を捨てて最下段に透明行を足す）。歩行の上下動に使う */
export function lift(frame: Frame): Frame {
  const w = frame[0]?.length ?? 0;
  return [...frame.slice(1), ".".repeat(w)];
}

/** 原画 2 枚から 4 フレームの歩行（a → 持ち上げた a → b → 持ち上げた b） */
export function walkCycle(a: Frame, b: Frame): SpriteFrames {
  return [a, lift(a), b, lift(b)];
}
