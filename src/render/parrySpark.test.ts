import { describe, expect, it } from "vitest";
import { PARRY_POSE } from "../data/tuning";
import { sparkFlash, sparkStreaks } from "./parrySpark";

describe("parrySpark: 受け止めた所の火花", () => {
  it("寿命の間だけ count 本の火の粉を出し、同じ種なら同じ散り方", () => {
    const a = sparkStreaks(0, 0.05, 42);
    expect(a).toHaveLength(PARRY_POSE.spark.count);
    expect(sparkStreaks(0, 0.05, 42)).toEqual(a);
    expect(sparkStreaks(0, PARRY_POSE.spark.life, 42)).toEqual([]);
    expect(sparkStreaks(0, -0.01, 42)).toEqual([]);
  });

  it("火の粉は散る向きの扇の内に飛び、伸びる距離の上限を越えない", () => {
    const dir = -Math.PI / 4;
    const half = (PARRY_POSE.spark.spreadDeg * Math.PI) / 360;
    for (const s of sparkStreaks(dir, PARRY_POSE.spark.life * 0.9, 7)) {
      const a = Math.atan2(s.y1, s.x1);
      const diff = Math.atan2(Math.sin(a - dir), Math.cos(a - dir));
      expect(Math.abs(diff)).toBeLessThanOrEqual(half + 1e-9);
      expect(Math.hypot(s.x1, s.y1)).toBeLessThanOrEqual(PARRY_POSE.spark.lenMax + 1e-9);
    }
  });

  it("古くなるほど色が橙へ移る", () => {
    const colors = PARRY_POSE.spark.colors;
    expect(sparkStreaks(0, 0, 1)[0]?.color).toBe(colors[0]);
    expect(sparkStreaks(0, PARRY_POSE.spark.life * 0.99, 1)[0]?.color).toBe(colors[colors.length - 1]);
  });

  it("閃きは flashSec で消える", () => {
    expect(sparkFlash(0)).toBeCloseTo(PARRY_POSE.spark.flashPx);
    expect(sparkFlash(PARRY_POSE.spark.flashSec)).toBe(0);
  });
});
