import { describe, expect, it } from "vitest";
import { createRng, hashSeed } from "./rng";

describe("createRng", () => {
  it("同じ seed で同じ乱数列を返す", () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("異なる seed で異なる乱数列を返す", () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it("int は両端を含む範囲に収まる", () => {
    const rng = createRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(1, 3);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(3);
      seen.add(v);
    }
    expect(seen).toEqual(new Set([1, 2, 3]));
  });
});

describe("hashSeed", () => {
  it("同じ文字列は同じ整数になる", () => {
    expect(hashSeed("hello")).toBe(hashSeed("hello"));
    expect(hashSeed("hello")).not.toBe(hashSeed("hellp"));
  });
});
