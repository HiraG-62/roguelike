import { describe, expect, it } from "vitest";
import { arcTrailSamples, blastStage, boltBranch, boltPoints, coastDistance, crescentProfile, mixColor, parseHex, radialAngle, trailFade } from "./fxMath";

describe("arcTrailSamples（斬撃の三日月）", () => {
  it("先端は振った分だけ進み、尾は tailRatio × 振り幅まで後ろに残る", () => {
    const s = arcTrailSamples(0, Math.PI, 1, 0.5, 6, 10);
    expect(s.length, "区切り + 1 点").toBe(11);
    expect(s[s.length - 1]?.angle, "先端").toBeCloseTo(Math.PI);
    expect(s[0]?.angle, "尾").toBeCloseTo(Math.PI / 2);
  });

  it("逆向きの振り（sweep < 0）でも尾は先端の後ろ側に伸びる", () => {
    const s = arcTrailSamples(0, -Math.PI, 1, 0.5, 6, 4);
    expect(s[s.length - 1]?.angle, "先端").toBeCloseTo(-Math.PI);
    expect(s[0]?.angle, "尾").toBeCloseTo(-Math.PI / 2);
  });

  it("振り始め（progress 0）は長さ 0、尾は振った分より長くならない", () => {
    const s = arcTrailSamples(1, 2, 0, 0.8, 6, 4);
    for (const p of s) expect(p.angle, "全点が振り始めの角度").toBeCloseTo(1);
    const half = arcTrailSamples(0, 2, 0.25, 0.8, 6, 4);
    expect(half[0]?.angle, "尾は振り始めより前に出ない").toBeCloseTo(0);
  });

  it("厚みは尾 0、先端の手前で最大、先端は細く残る", () => {
    expect(crescentProfile(0)).toBe(0);
    expect(crescentProfile(0.8)).toBeCloseTo(1);
    expect(crescentProfile(1)).toBeGreaterThan(0);
    expect(crescentProfile(1)).toBeLessThan(crescentProfile(0.8));
  });
});

describe("trailFade（振り終わりの尾）", () => {
  it("0 秒で 1、fadeTime で 0、それ以降も 0", () => {
    expect(trailFade(0, 0.1)).toBe(1);
    expect(trailFade(0.05, 0.1)).toBeCloseTo(0.5);
    expect(trailFade(0.2, 0.1)).toBe(0);
    expect(trailFade(0, 0), "fadeTime 0 は尾を出さない").toBe(0);
  });
});

describe("boltPoints / boltBranch（稲妻）", () => {
  const from = { x: 0, y: 0 };
  const to = { x: 60, y: 0 };

  it("両端は固定で、点の数は segments + 1", () => {
    const pts = boltPoints(from, to, 6, 5, 42);
    expect(pts.length).toBe(7);
    expect(pts[0]).toEqual(from);
    expect(pts[6]).toEqual(to);
  });

  it("途中の点は線に直交する向きへ jitter 以内でずれる", () => {
    const pts = boltPoints(from, to, 6, 5, 42);
    for (const p of pts.slice(1, -1)) expect(Math.abs(p.y), "ずれ幅").toBeLessThanOrEqual(5);
    expect(pts.slice(1, -1).some((p) => Math.abs(p.y) > 0), "ギザギザになる").toBe(true);
  });

  it("同じ seed なら同じ形（決定的）", () => {
    expect(boltPoints(from, to, 6, 5, 7)).toEqual(boltPoints(from, to, 6, 5, 7));
  });

  it("枝は途中の点から length の長さで伸び、範囲外の番号は undefined", () => {
    const pts = boltPoints(from, to, 6, 5, 3);
    const branch = boltBranch(pts, 2, 3, 10);
    expect(branch).toBeDefined();
    if (!branch) return;
    expect(Math.hypot(branch[1].x - branch[0].x, branch[1].y - branch[0].y)).toBeCloseTo(10);
    expect(boltBranch(pts, 6, 3, 10), "最後の点からは伸ばさない").toBeUndefined();
  });
});

describe("blastStage（爆発の段階）", () => {
  it("始まりは閃光が最大、閃光の終わりで 0 になり、火球はその後も残る", () => {
    expect(blastStage(0, 0.14, 0.45).flash).toBe(1);
    expect(blastStage(0.14, 0.14, 0.45).flash).toBe(0);
    expect(blastStage(0.3, 0.14, 0.45).fireball).toBeGreaterThan(0);
    expect(blastStage(0.5, 0.14, 0.45).fireball).toBe(0);
  });

  it("煙は閃光の間は出ず、途中で最も濃く、終わりで消える", () => {
    expect(blastStage(0.1, 0.14, 0.45).smoke).toBe(0);
    const mid = blastStage(0.55, 0.14, 0.45).smoke;
    expect(mid).toBeGreaterThan(0.5);
    expect(blastStage(1, 0.14, 0.45).smoke).toBeCloseTo(0);
  });

  it("火球は広がり続け、破片は薄れていく", () => {
    expect(blastStage(0.4, 0.14, 0.45).fireballR).toBeGreaterThan(blastStage(0.1, 0.14, 0.45).fireballR);
    expect(blastStage(0.8, 0.14, 0.45).debris).toBeLessThan(blastStage(0.2, 0.14, 0.45).debris);
  });
});

describe("radialAngle / coastDistance", () => {
  it("放射の向きは等間隔の近く（±半区切り）に散る", () => {
    for (let i = 0; i < 8; i++) {
      const a = radialAngle(i, 8, 99);
      const base = (i / 8) * Math.PI * 2;
      expect(Math.abs(a - base), `${i} 本目`).toBeLessThanOrEqual(Math.PI / 8 + 1e-9);
    }
  });

  it("減速する粒は寿命の終わりで止まり、それ以上進まない", () => {
    const end = coastDistance(100, 0.2, 0.2);
    expect(end).toBeCloseTo(10);
    expect(coastDistance(100, 0.4, 0.2)).toBeCloseTo(end);
    expect(coastDistance(100, 0.1, 0.2)).toBeGreaterThan(end / 2);
  });
});

describe("mixColor / parseHex", () => {
  it("#rgb と #rrggbb を読み、読めない色は白", () => {
    expect(parseHex("#f80")).toEqual([255, 136, 0]);
    expect(parseHex("#102030")).toEqual([16, 32, 48]);
    expect(parseHex("red")).toEqual([255, 255, 255]);
  });

  it("t = 0 / 1 で両端の色、中間は混ざる", () => {
    expect(mixColor("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixColor("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixColor("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
});
