import { describe, expect, it } from "vitest";
import { PARRY_POSE } from "../data/tuning";
import { barrierDots, barrierFront, barrierRadius } from "./parryBarrier";

describe("parryBarrier: 魔法の武器の結界", () => {
  it("向いている側に弧を張り、半径は受け止めた瞬間に前へ膨らむ", () => {
    const right = barrierDots(true, 0, 0, 0);
    expect(right.length).toBeGreaterThan(0);
    expect(right.every((d) => d.x > 0)).toBe(true);
    expect(barrierDots(false, 0, 0, 0).every((d) => d.x < 0)).toBe(true);
    expect(barrierRadius(1)).toBeCloseTo(PARRY_POSE.barrier.radius + PARRY_POSE.barrier.popPx);
    expect(barrierFront(false, 0)).toEqual({ x: -PARRY_POSE.barrier.radius, y: 0 });
  });

  it("縁の点は半径の上、帯は内側へ depthPx まで", () => {
    for (const d of barrierDots(true, 0, 0, 0)) {
      const r = Math.hypot(d.x, d.y);
      expect(r).toBeLessThanOrEqual(PARRY_POSE.barrier.radius + 0.5);
      expect(r).toBeGreaterThanOrEqual(PARRY_POSE.barrier.radius - PARRY_POSE.barrier.depthPx - 0.5);
    }
  });

  it("崩れの割合だけ点が抜け、同じ割合なら同じ抜け方", () => {
    const full = barrierDots(true, 0, 0, 0).length;
    const half = barrierDots(true, 0, 0.5, 0);
    expect(half.length).toBeLessThan(full);
    expect(half.length).toBeGreaterThan(0);
    expect(barrierDots(true, 0, 0.5, 0)).toEqual(half);
  });

  it("縁を走る光は時刻で動く", () => {
    const lit = (t: number): number => barrierDots(true, 0, 0, t).findIndex((d) => d.lit);
    expect(lit(0)).not.toBe(lit(PARRY_POSE.barrier.shimmerSec / 2));
  });
});
