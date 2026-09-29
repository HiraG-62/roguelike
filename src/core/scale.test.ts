import { describe, expect, it } from "vitest";
import { createRng } from "./rng";
import { curveAt, rollSpread, triangular } from "./scale";

const MANY = 4000;

describe("深度の曲線 curveAt", () => {
  it("深度 1 で base（省略は 1）、以降は perDepth ずつ線形に伸びる", () => {
    expect(curveAt({ perDepth: 0.15 }, 1)).toBe(1);
    expect(curveAt({ perDepth: 0.15 }, 11)).toBeCloseTo(2.5);
    expect(curveAt({ base: 5, perDepth: 2 }, 4)).toBe(11);
  });

  it("深度 1 より浅くても base を下回らない", () => {
    expect(curveAt({ perDepth: 0.15 }, 0)).toBe(1);
    expect(curveAt({ perDepth: 0.15 }, -3)).toBe(1);
  });

  it("deepDepth までは線形、以降は deepGrowth の指数（境目でつながる）", () => {
    const curve = { perDepth: 0.15, deepDepth: 21, deepGrowth: 1.12 };
    expect(curveAt(curve, 21)).toBeCloseTo(1 + 0.15 * 20);
    expect(curveAt(curve, 22)).toBeCloseTo((1 + 0.15 * 20) * 1.12);
    expect(curveAt(curve, 25)).toBeCloseTo((1 + 0.15 * 20) * 1.12 ** 4);
  });

  it("deepDepth か deepGrowth が無ければ最後まで線形", () => {
    expect(curveAt({ perDepth: 0.1, deepDepth: 10 }, 30)).toBeCloseTo(1 + 0.1 * 29);
    expect(curveAt({ perDepth: 0.1, deepGrowth: 2 }, 30)).toBeCloseTo(1 + 0.1 * 29);
  });

  it("深みは線形の延長より急に伸びる", () => {
    const linear = { perDepth: 0.15 };
    const deep = { perDepth: 0.15, deepDepth: 21, deepGrowth: 1.12 };
    expect(curveAt(deep, 40)).toBeGreaterThan(curveAt(linear, 40));
  });
});

describe("三角分布 triangular", () => {
  it("範囲内に収まり、rng を 1 回だけ引く", () => {
    const rng = createRng(1);
    for (let i = 0; i < MANY; i++) {
      const v = triangular(rng, -1, 0, 2);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(2);
    }
    const a = createRng(5);
    const b = createRng(5);
    triangular(a, 0, 1, 2);
    b.next();
    expect(a.next(), "1 回ぶんだけ進む").toBe(b.next());
  });

  it("幅が 0 以下なら mode", () => {
    expect(triangular(createRng(1), 2, 2, 2)).toBe(2);
  });
});

describe("揺らぎ rollSpread", () => {
  it("平均 × [low, high] に収まり、平均はおよそ (low + mode + high) / 3", () => {
    const rng = createRng(7);
    let sum = 0;
    for (let i = 0; i < MANY; i++) {
      const v = rollSpread(rng, 100, { low: 0.9, high: 1.1 });
      expect(v).toBeGreaterThanOrEqual(90);
      expect(v).toBeLessThanOrEqual(110);
      sum += v;
    }
    expect(sum / MANY, "対称なので平均は 100 付近").toBeCloseTo(100, 0);
  });

  it("mode を指定すると最頻値がそこへ寄る", () => {
    const rng = createRng(9);
    let sum = 0;
    for (let i = 0; i < MANY; i++) sum += rollSpread(rng, 1, { low: 0.5, mode: 0.6, high: 2 });
    expect(sum / MANY).toBeCloseTo((0.5 + 0.6 + 2) / 3, 1);
  });

  it("同じ seed なら同じ値（決定的）で、rng を 1 回引く", () => {
    const a = createRng(11);
    const b = createRng(11);
    expect(rollSpread(a, 3, { low: 0.9, high: 1.1 })).toBe(rollSpread(b, 3, { low: 0.9, high: 1.1 }));
    const c = createRng(11);
    const d = createRng(11);
    rollSpread(c, 1, { low: 0.9, high: 1.1 });
    d.next();
    expect(c.next()).toBe(d.next());
  });

  it("幅 0 の Spread は mean そのもの", () => {
    expect(rollSpread(createRng(1), 12, { low: 1, high: 1 })).toBe(12);
  });
});
