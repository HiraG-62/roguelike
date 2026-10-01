import { describe, expect, it } from "vitest";
import { type Rng, createRng } from "../../core/rng";
import { MAP_LAYOUT } from "../../data/tuning";
import { type LayoutSelectParams, chooseLayout, layoutWeight, withFixedLayout } from "./select";
import { LAYOUT_KINDS, type LayoutContext, type LayoutKind } from "./types";

const FLAT: LayoutSelectParams = {
  weight: { cavern: 1, river: 1, ring: 1, court: 1, drunk: 1, isle: 1, terrace: 1, prefab: 1 },
  chapterMul: [{}],
  deepMul: {},
  minDepth: { cavern: 1, river: 1, ring: 1, court: 1, drunk: 1, isle: 1, terrace: 1, prefab: 1 },
  repeatMul: 0,
};

function ctx(over: Partial<LayoutContext> = {}): LayoutContext {
  return { depth: 3, chapter: 1, isDeep: false, isBossFloor: false, floorKind: "rooms", ...over };
}

/** next() の呼び出し回数を数える rng */
function countingRng(seed: number): { rng: Rng; calls: () => number } {
  const base = createRng(seed);
  let n = 0;
  return {
    rng: {
      next: () => {
        n++;
        return base.next();
      },
      int: (a, b) => a + Math.floor(base.next() * (b - a + 1)),
      chance: (p) => base.next() < p,
      pick: (arr) => base.pick(arr),
    },
    calls: () => n,
  };
}

function sample(params: LayoutSelectParams, c: LayoutContext, n: number): Map<string, number> {
  const rng = createRng(1);
  const out = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const kind = chooseLayout(rng, c, params);
    out.set(kind, (out.get(kind) ?? 0) + 1);
  }
  return out;
}

describe("chooseLayout", () => {
  it("ボス階は乱数を引かずに lordHall を返す", () => {
    const { rng, calls } = countingRng(1);
    expect(chooseLayout(rng, ctx({ isBossFloor: true }))).toBe("lordHall");
    expect(calls(), "乱数の消費").toBe(0);
  });

  it("通常の階は rng.next() をちょうど 1 回だけ引き、8 型のどれかを返す", () => {
    const { rng, calls } = countingRng(2);
    const kind = chooseLayout(rng, ctx());
    expect(calls()).toBe(1);
    expect(LAYOUT_KINDS).toContain(kind);
  });

  it("同じ seed・同じ文脈なら同じ型", () => {
    expect(chooseLayout(createRng(9), ctx())).toBe(chooseLayout(createRng(9), ctx()));
  });

  it("前の階と同じ型は続かない（repeatMul = 0）", () => {
    for (const previous of LAYOUT_KINDS) {
      const counts = sample(FLAT, ctx({ previous }), 400);
      expect(counts.get(previous) ?? 0, `${previous} の次に ${previous}`).toBe(0);
      expect(counts.size, "残りの 7 型は出る").toBe(LAYOUT_KINDS.length - 1);
    }
  });

  it("前の階が legacy / lordHall なら連続の規則は効かない", () => {
    expect(layoutWeight("cavern", ctx({ previous: "legacy" }), FLAT)).toBe(1);
    expect(layoutWeight("cavern", ctx({ previous: "lordHall" }), FLAT)).toBe(1);
  });

  it("minDepth 未満の型は出ない", () => {
    const params: LayoutSelectParams = { ...FLAT, minDepth: { ...FLAT.minDepth, isle: 4, terrace: 6 } };
    const shallow = sample(params, ctx({ depth: 3 }), 600);
    expect(shallow.get("isle") ?? 0).toBe(0);
    expect(shallow.get("terrace") ?? 0).toBe(0);
    const mid = sample(params, ctx({ depth: 4 }), 600);
    expect(mid.get("isle") ?? 0).toBeGreaterThan(0);
    expect(mid.get("terrace") ?? 0).toBe(0);
  });

  it("重み 0 の型は出ない", () => {
    const params: LayoutSelectParams = { ...FLAT, weight: { ...FLAT.weight, river: 0, prefab: 0 } };
    const counts = sample(params, ctx(), 600);
    expect(counts.get("river") ?? 0).toBe(0);
    expect(counts.get("prefab") ?? 0).toBe(0);
    expect(counts.size).toBe(LAYOUT_KINDS.length - 2);
  });

  it("重みの比率どおりに出る（章の倍率）", () => {
    const params: LayoutSelectParams = { ...FLAT, repeatMul: 1, chapterMul: [{ cavern: 7 }] };
    const counts = sample(params, ctx(), 3000);
    const share = (counts.get("cavern") ?? 0) / 3000;
    expect(share, "7 / (7 + 7) = 0.5").toBeGreaterThan(0.45);
    expect(share).toBeLessThan(0.55);
  });

  it("深みは chapterMul の代わりに deepMul を使う", () => {
    const params: LayoutSelectParams = { ...FLAT, chapterMul: [{ cavern: 0 }], deepMul: { isle: 0 } };
    expect(layoutWeight("cavern", ctx({ isDeep: false }), params)).toBe(0);
    expect(layoutWeight("cavern", ctx({ isDeep: true }), params), "深みでは章の行を見ない").toBe(1);
    expect(layoutWeight("isle", ctx({ isDeep: true }), params)).toBe(0);
  });

  it("章が行より多ければ最後の行を使い、1 未満の章は最初の行を使う", () => {
    const params: LayoutSelectParams = { ...FLAT, chapterMul: [{ ring: 2 }, { ring: 3 }] };
    expect(layoutWeight("ring", ctx({ chapter: 1 }), params)).toBe(2);
    expect(layoutWeight("ring", ctx({ chapter: 2 }), params)).toBe(3);
    expect(layoutWeight("ring", ctx({ chapter: 9 }), params)).toBe(3);
    expect(layoutWeight("ring", ctx({ chapter: 0 }), params)).toBe(2);
  });

  it("floorKind の倍率（biomeMul）を掛け、書かない種別・型は 1", () => {
    const params: LayoutSelectParams = { ...FLAT, biomeMul: { swamp: { river: 4 } } };
    expect(layoutWeight("river", ctx({ floorKind: "swamp" }), params)).toBe(4);
    expect(layoutWeight("river", ctx({ floorKind: "rooms" }), params)).toBe(1);
    expect(layoutWeight("cavern", ctx({ floorKind: "swamp" }), params)).toBe(1);
  });

  it("全部の重みが 0 でも乱数は 1 回引き、深度の条件を満たす最初の型を返す", () => {
    const params: LayoutSelectParams = { ...FLAT, weight: { cavern: 0, river: 0, ring: 0, court: 0, drunk: 0, isle: 0, terrace: 0, prefab: 0 } };
    const { rng, calls } = countingRng(3);
    expect(chooseLayout(rng, ctx(), params)).toBe("cavern");
    expect(calls()).toBe(1);
  });

  it("実際の JSON（MAP_LAYOUT）でも全部の型が章ごとに出うる", () => {
    for (let chapter = 1; chapter <= 4; chapter++) {
      for (const kind of LAYOUT_KINDS) {
        expect(layoutWeight(kind, ctx({ depth: 20, chapter }), MAP_LAYOUT), `${kind} 章 ${chapter}`).toBeGreaterThan(0);
      }
    }
    const kinds = new Set<LayoutKind>();
    const rng = createRng(4);
    for (let i = 0; i < 300; i++) {
      const kind = chooseLayout(rng, ctx({ depth: 12, chapter: 3 }));
      if (kind !== "legacy" && kind !== "lordHall") kinds.add(kind);
    }
    expect(kinds.size).toBe(LAYOUT_KINDS.length);
  });
});

describe("withFixedLayout", () => {
  it("fn の間だけ型を固定し、乱数を引かず、終われば元に戻る（例外でも）", () => {
    const { rng, calls } = countingRng(5);
    withFixedLayout("legacy", () => {
      expect(chooseLayout(rng, ctx())).toBe("legacy");
      expect(chooseLayout(rng, ctx({ isBossFloor: true })), "固定はボス階より優先").toBe("legacy");
    });
    expect(calls()).toBe(0);
    expect(() =>
      withFixedLayout("river", () => {
        throw new Error("途中で失敗");
      }),
    ).toThrow();
    expect(chooseLayout(createRng(1), ctx({ isBossFloor: true })), "元に戻っている").toBe("lordHall");
  });

  it("入れ子にすると内側が優先され、抜けると外側に戻る", () => {
    withFixedLayout("ring", () => {
      withFixedLayout("court", () => {
        expect(chooseLayout(createRng(1), ctx())).toBe("court");
      });
      expect(chooseLayout(createRng(1), ctx())).toBe("ring");
    });
  });
});
