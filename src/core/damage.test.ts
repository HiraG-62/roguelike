import { describe, expect, it } from "vitest";
import {
  DAMAGE_TAGS,
  type DamageTag,
  MIN_INCREASED_MUL,
  type MoreMul,
  createIncreased,
  increasedMul,
  moreApplies,
  moreMulFor,
  productMore,
  sumIncreased,
  withMore,
} from "./damage";

function ctx(tags: readonly DamageTag[], elementShares: { element: "fire" | "ice" | "none"; share: number }[] = []) {
  return { tags: new Set(tags), elementShares };
}

describe("増（sumIncreased）", () => {
  it("全部 0 の表を作る", () => {
    const inc = createIncreased();
    expect(Object.keys(inc).sort()).toEqual([...DAMAGE_TAGS].sort());
    expect(Object.values(inc).every((v) => v === 0)).toBe(true);
  });

  it("増は加算: +50% と +50% で ×2.0", () => {
    const inc = { ...createIncreased(), melee: 0.5, vsStaggered: 0.5 };
    expect(1 + sumIncreased(inc, ctx(["melee", "vsStaggered"]))).toBeCloseTo(2);
  });

  it("1 撃が持たないタグの増は足さない", () => {
    const inc = { ...createIncreased(), melee: 0.5, ranged: 0.7 };
    expect(sumIncreased(inc, ctx(["melee"]))).toBeCloseTo(0.5);
  });

  it("属性タグは属性の割合の重みで足す（変換 50% なら炎の増は半分）", () => {
    const inc = { ...createIncreased(), fire: 0.4, ice: 1 };
    expect(sumIncreased(inc, ctx(["melee"], [{ element: "fire", share: 0.5 }, { element: "none", share: 0.5 }]))).toBeCloseTo(0.2);
    expect(sumIncreased(inc, ctx(["fire"])), "タグに属性を置いても割合が無ければ足さない").toBe(0);
  });

  it("下限は 1 + Σ増 = MIN_INCREASED_MUL", () => {
    const inc = { ...createIncreased(), melee: -3 };
    expect(1 + sumIncreased(inc, ctx(["melee"]))).toBeCloseTo(MIN_INCREASED_MUL);
    expect(increasedMul(inc, "melee"), "1 つのタグの倍率も同じ下限").toBeCloseTo(MIN_INCREASED_MUL);
  });
});

describe("倍（productMore）", () => {
  const a: MoreMul = { source: "a", label: "甲", mul: 1.5 };
  const b: MoreMul = { source: "b", label: "乙", mul: 1.5 };

  it("倍は乗算: ×1.5 × ×1.5 = ×2.25", () => {
    expect(productMore([a, b])).toBeCloseTo(2.25);
  });

  it("同じ source は後勝ちで 1 つ", () => {
    expect(productMore([a, { ...a, mul: 3 }])).toBeCloseTo(3);
    expect(productMore([a, a])).toBeCloseTo(1.5);
  });

  it("tags の無い倍はすべてに、tags のある倍は合うタグの 1 撃にだけ掛かる", () => {
    const ranged: MoreMul = { source: "r", label: "射", mul: 2, tags: ["ranged"] };
    expect(moreApplies(a, new Set<DamageTag>(["proc"]))).toBe(true);
    expect(moreApplies(ranged, new Set<DamageTag>(["melee", "skill"]))).toBe(false);
    expect(moreApplies(ranged, new Set<DamageTag>(["ranged", "skill"]))).toBe(true);
    expect(moreMulFor([ranged, a], "melee"), "近接には射撃の倍を掛けない").toBeCloseTo(1.5);
  });

  it("withMore は元の列を書き換えない", () => {
    const base: readonly MoreMul[] = Object.freeze([a]);
    const next = withMore(base, b);
    expect(base).toHaveLength(1);
    expect(next.map((m) => m.source)).toEqual(["a", "b"]);
  });
});
