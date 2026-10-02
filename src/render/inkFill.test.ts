import { describe, expect, it } from "vitest";
import { TELEGRAPH } from "../data/tuning";
import { EDGE_STEPS, depthOfStep, edgeAmount, fillCone, fillRing, fillTable, muraLevel, startStep } from "./inkFill";
import { INK_DOTS, INK_LAYER, InkSurface } from "./inkSurface";

const W = 320;
const H = 240;

/** 円の中の、縁からの深さが [a, b) の所の塗られた割合 */
function coverage(s: InkSurface, cx: number, cy: number, r: number, a: number, b: number): number {
  let all = 0;
  let filled = 0;
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const depth = (r - d) / r;
      if (depth < a || depth >= b) continue;
      all++;
      if (s.layerAt(x, y)) filled++;
    }
  }
  return all > 0 ? filled / all : 0;
}

describe("むらの段", () => {
  it("ディザの閾が濃さを超えると塗らず、縁の濃さが増えるほど塗る所は増えるだけ", () => {
    expect(muraLevel(0, 0, 0.99)).toBe(0);
    for (let n = 0; n <= 1; n += 0.1) {
      for (let th = 0.03; th < 1; th += 0.0625) {
        let on = false;
        for (let e = 0; e <= EDGE_STEPS; e++) {
          const lv = muraLevel(n, edgeAmount(e), th);
          if (on) expect(lv, `n ${n} th ${th} e ${e}`).toBeGreaterThan(0);
          if (lv > 0) on = true;
        }
      }
    }
  });

  it("塗り始める縁の段は、段ごとに試して初めて塗れる段と同じ", () => {
    for (let n = 0; n <= 1; n += 0.05) {
      for (let th = 1 / 32; th < 1; th += 1 / 16) {
        let first = EDGE_STEPS + 1;
        for (let e = EDGE_STEPS; e >= 0; e--) if (muraLevel(n, edgeAmount(e), th) > 0) first = e;
        expect(Math.min(startStep(n, th), EDGE_STEPS + 1), `n ${n} th ${th}`).toBe(first);
      }
    }
  });

  it("縁の段の境の深さは奥（段 0）で縁の帯の深さ、縁の際で 0", () => {
    expect(depthOfStep(1)).toBeCloseTo(TELEGRAPH.muraEdgeReach, 6);
    expect(depthOfStep(EDGE_STEPS + 1)).toBe(0);
  });

  it("下絵の表は市松（偶奇が奇数のドットは塗らない）で淡墨の段（1・2）だけ", () => {
    const t = fillTable(true);
    for (let i = 0; i < 4096; i++) {
      const x = i % 512;
      const y = Math.floor(i / 512);
      const v = t[y * 512 + x] ?? 0;
      if ((x + y) & 1) expect(v).toBe(0);
      if (v) expect(v & 7).toBeLessThanOrEqual(2);
    }
  });
});

describe("輪の内側の塗り", () => {
  const cx = 160;
  const cy = 120;
  const r = 90;

  it("円の外には置かず、内側の大半を塗るが全部は塗らない（むらの薄い所は床が透ける）", () => {
    const s = new InkSurface(W, H);
    fillRing(s, cx, cy, r, "ink");
    let outside = 0;
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.layerAt(x, y) && Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r + 0.75) outside++;
    expect(outside).toBe(0);
    const all = coverage(s, cx, cy, r, 0, 1.01);
    expect(all).toBeGreaterThan(0.5);
    expect(all).toBeLessThan(0.98);
  });

  it("縁に近いほど濃い（縁の帯の方が奥より塗った割合が高い）", () => {
    const s = new InkSurface(W, H);
    fillRing(s, cx, cy, r, "ink");
    expect(coverage(s, cx, cy, r, 0, 0.1)).toBeGreaterThan(coverage(s, cx, cy, r, 0.5, 1.01));
  });

  it("墨入れは面の層、下絵は下絵の層に置き、下絵は墨入れより疎ら", () => {
    const ink = new InkSurface(W, H);
    fillRing(ink, cx, cy, r, "ink");
    const sketch = new InkSurface(W, H);
    fillRing(sketch, cx, cy, r, "sketch");
    expect(ink.layerAt(cx, cy) === 0 || ink.layerAt(cx, cy) === INK_LAYER.fill).toBe(true);
    const sk = coverage(sketch, cx, cy, r, 0, 1.01);
    expect(sk).toBeLessThan(coverage(ink, cx, cy, r, 0, 1.01));
    for (let i = 0; i < sketch.mark.length; i++) {
      const m = sketch.mark[i] ?? 0;
      if (m) expect(m >> 3).toBe(INK_LAYER.sketch);
    }
  });

  it("カメラが動いても模様はワールドのドットに留まる（泳がない）", () => {
    const draw = (ox: number, oy: number): number[] => {
      const s = new InkSurface(W, H);
      s.ox = ox;
      s.oy = oy;
      fillRing(s, s.dotX(70), s.dotY(60), 40 * INK_DOTS, "ink");
      const out: number[] = [];
      for (let y = 30; y < 210; y++) for (let x = 50; x < 230; x++) out.push(s.px[(y + oy * INK_DOTS) * s.w + x + ox * INK_DOTS] ?? 0);
      return out;
    };
    expect(draw(5, -2)).toEqual(draw(0, 0));
  });
});

describe("扇の内側の塗り", () => {
  it("扇の射程と角の内側にだけ置く", () => {
    const s = new InkSurface(W, H);
    const cx = 40;
    const cy = 120;
    const range = 200;
    const half = 0.45;
    fillCone(s, cx, cy, range, 0, half, "ink");
    let inside = 0;
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        if (!s.layerAt(x, y)) continue;
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        expect(Math.hypot(dx, dy), "射程").toBeLessThanOrEqual(range + 0.75);
        expect(Math.abs(Math.atan2(dy, dx)), "角").toBeLessThanOrEqual(half + 0.02);
        inside++;
      }
    }
    expect(inside).toBeGreaterThan(1000);
  });
});
