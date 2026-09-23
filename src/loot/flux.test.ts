import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { affixDef } from "./affixes";
import {
  CALM_FLUX_LIMIT,
  INVERSION_MIN_DEPTH,
  MIN_FLUX,
  SIGMA_MAX,
  WAVER_FLUX_LIMIT,
  fluxClassOf,
  inversionChance,
  nominalAt,
  rollFlux,
  sigmaAt,
  triangular,
  valueFromFlux,
} from "./flux";

const MANY = 2000;

describe("期待値曲線（旧 tier 表の読み替え）", () => {
  const def = affixDef("meleeDamagePct");
  if (def === undefined) throw new Error("meleeDamagePct missing");
  // 曲線: (1, 6..12) (4, 13..20) (8, 21..29) (13, 30..39) (19, 40..49) (26, 50..60)

  it("曲線の点では幅の中央", () => {
    expect(nominalAt(def, 1).nominal).toBeCloseTo(9);
    expect(nominalAt(def, 13).nominal).toBeCloseTo(34.5);
    expect(nominalAt(def, 26).nominal).toBeCloseTo(55);
  });

  it("点の間は線形補間、範囲外は端の値", () => {
    expect(nominalAt(def, 16).nominal).toBeCloseTo(34.5 + (44.5 - 34.5) * (3 / 6));
    expect(nominalAt(def, 0).nominal).toBeCloseTo(9);
    expect(nominalAt(def, 99).nominal).toBeCloseTo(55);
  });

  it("2 値の性質は nominal2 も補間する", () => {
    const burn = affixDef("burn");
    if (burn === undefined) throw new Error("burn missing");
    expect(nominalAt(burn, 10).nominal2).toBeDefined();
  });
});

describe("揺らぎ", () => {
  it("σ は深度で広がり、上限で止まる", () => {
    expect(sigmaAt(10)).toBeGreaterThan(sigmaAt(1));
    expect(sigmaAt(1000)).toBe(SIGMA_MAX);
    expect(sigmaAt(10, 6)).toBeGreaterThan(sigmaAt(10));
  });

  it("三角分布は範囲内", () => {
    const rng = createRng(1);
    for (let i = 0; i < MANY; i++) {
      const v = triangular(rng, -1, 0, 2);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(2);
    }
  });

  it("rollFlux は MIN_FLUX を下回らない（反転は rollInvertedFlux だけ）", () => {
    const rng = createRng(2);
    for (let i = 0; i < MANY; i++) expect(rollFlux(rng, SIGMA_MAX * 3)).toBeGreaterThanOrEqual(MIN_FLUX);
  });

  it(`反転の確率は深度 ${INVERSION_MIN_DEPTH} 未満で 0、以降は正`, () => {
    expect(inversionChance(INVERSION_MIN_DEPTH - 1)).toBe(0);
    expect(inversionChance(INVERSION_MIN_DEPTH)).toBeGreaterThan(0);
  });

  it("valueFromFlux: flux < -1 で負、それ以外は正（丸めで 0 にならない）", () => {
    expect(valueFromFlux(20, 0.5, 0)).toBe(30);
    expect(valueFromFlux(20, -1.5, 0)).toBe(-10);
    expect(valueFromFlux(1, -0.9, 0)).toBe(1);
    expect(valueFromFlux(1, -1.01, 0)).toBe(-1);
  });

  it("fluxClassOf: 反転あり > 荒 > 揺 > 静", () => {
    expect(fluxClassOf([])).toBe("normal");
    expect(fluxClassOf([{ key: "a", value: 1, flux: CALM_FLUX_LIMIT / 2 }])).toBe("normal");
    expect(fluxClassOf([{ key: "a", value: 1, flux: CALM_FLUX_LIMIT }])).toBe("magic");
    expect(fluxClassOf([{ key: "a", value: 1, flux: -WAVER_FLUX_LIMIT }])).toBe("rare");
    expect(fluxClassOf([{ key: "a", value: -1, flux: -1.5, inverted: true }])).toBe("unique");
  });
});
