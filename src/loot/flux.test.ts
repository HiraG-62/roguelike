import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { triangular } from "../core/scale";
import { affixDef } from "./affixes";
import {
  CALM_FLUX_LIMIT,
  FLUX,
  INVERSION_MIN_DEPTH,
  MIN_FLUX,
  SIGMA_MAX,
  WAVER_FLUX_LIMIT,
  fluxClassOf,
  inversionChance,
  depthScaleAt,
  nominalAt,
  powerScaleAt,
  rollFlux,
  scaleFlat,
  scaledNominalAt,
  sigmaAt,
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

  it("点の間は線形補間、最初の点より浅ければ最初の点の値", () => {
    expect(nominalAt(def, 16).nominal).toBeCloseTo(34.5 + (44.5 - 34.5) * (3 / 6));
    expect(nominalAt(def, 0).nominal).toBeCloseTo(9);
  });

  it("最後の点より深ければ最後の区間の傾きで伸ばす（深度 26 で頭打ちにならない）", () => {
    // 最後の区間: (19, 44.5) → (26, 55) で 1 深度あたり 1.5
    const slope = (55 - 44.5) / (26 - 19);
    expect(nominalAt(def, 26).nominal, "最後の点は据え置き").toBeCloseTo(55);
    expect(nominalAt(def, 40).nominal).toBeCloseTo(55 + slope * 14);
    expect(nominalAt(def, 40).nominal, "最後の点を超える").toBeGreaterThan(nominalAt(def, 26).nominal);
    let prev = 0;
    for (let d = 1; d <= 60; d++) {
      const v = nominalAt(def, d).nominal;
      expect(v, `深度 ${d} は前の深度以上（単調）`).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("下がる曲線は最後の点を下回らない", () => {
    const falling = { ...def, curve: [{ depth: 1, min: 10, max: 10 }, { depth: 5, min: 2, max: 2 }] };
    expect(nominalAt(falling, 30).nominal).toBeCloseTo(2);
  });

  it("2 値の性質の nominal2 も外挿する", () => {
    const rising = { ...def, curve: [{ depth: 1, min: 1, max: 1, min2: 2, max2: 2 }, { depth: 5, min: 5, max: 5, min2: 10, max2: 10 }] };
    expect(nominalAt(rising, 9).nominal).toBeCloseTo(9);
    expect(nominalAt(rising, 9).nominal2).toBeCloseTo(18);
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

  it("下振れは狭い（下端は期待値の 0.6 倍まで、上端は 1.8 倍まで）", () => {
    expect(MIN_FLUX).toBeGreaterThanOrEqual(-0.4);
    expect(FLUX.flux.highScale * SIGMA_MAX).toBeLessThanOrEqual(0.8);
    const rng = createRng(3);
    for (let i = 0; i < MANY; i++) {
      const f = rollFlux(rng, SIGMA_MAX);
      expect(f).toBeGreaterThanOrEqual(-0.4);
      expect(f).toBeLessThanOrEqual(0.8);
    }
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

describe("装備の強さの係数（FLUX.globalScale × depthScale）", () => {
  const def = affixDef("meleeDamagePct");
  if (def === undefined) throw new Error("meleeDamagePct missing");

  it("全体を 20〜30% 下げる（globalScale）", () => {
    expect(FLUX.globalScale).toBeGreaterThanOrEqual(0.7);
    expect(FLUX.globalScale).toBeLessThanOrEqual(0.8);
  });

  it("深度 1〜5 は深い層より強く絞られ、深くなるほど係数が戻る（単調）", () => {
    let prev = 0;
    for (let d = 1; d <= 20; d++) {
      const k = powerScaleAt(d);
      expect(k, `深度 ${d} は前の深度以上`).toBeGreaterThanOrEqual(prev);
      prev = k;
    }
    expect(powerScaleAt(1), "深度 1 は深度 10 より小さい").toBeLessThan(powerScaleAt(10));
    expect(powerScaleAt(30), "深い層は globalScale").toBeCloseTo(FLUX.globalScale);
  });

  it("depthScaleAt は点列を線形補間し、範囲外は端の値", () => {
    const points = [
      { depth: 1, scale: 0.5 },
      { depth: 5, scale: 1 },
    ];
    expect(depthScaleAt(0, points)).toBe(0.5);
    expect(depthScaleAt(3, points)).toBeCloseTo(0.75);
    expect(depthScaleAt(9, points)).toBe(1);
    expect(depthScaleAt(3, []), "空の点列は 1").toBe(1);
  });

  it("scaledNominalAt は曲線の期待値に係数を掛ける（曲線そのものは変えない）", () => {
    for (const d of [1, 4, 13, 26]) {
      expect(scaledNominalAt(def, d).nominal, `深度 ${d}`).toBeCloseTo(nominalAt(def, d).nominal * powerScaleAt(d));
    }
    expect(scaledNominalAt(def, 4, false).nominal, "scaled=false は素の期待値").toBeCloseTo(nominalAt(def, 4).nominal);
  });

  it("scaleFlat は globalScale を掛けて丸める（共鳴・三和音用）", () => {
    expect(scaleFlat(10)).toBe(Math.round(10 * FLUX.globalScale));
    expect(scaleFlat(0.05, 4)).toBeCloseTo(0.05 * FLUX.globalScale);
  });
});
