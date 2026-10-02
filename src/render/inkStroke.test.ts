import { afterEach, describe, expect, it } from "vitest";
import { TELEGRAPH } from "../data/tuning";
import { INK_DOTS, INK_LAYER, InkSurface } from "./inkSurface";
import { type BrushOpts, INK_LEVELS, arcPath, brushCacheSize, brushProfile, clearBrushCache, drawBrush, fanPath, fastAtan2, levelOf, linePath, pathPoint } from "./inkStroke";

const W = 320;
const H = 200;

function opts(over: Partial<BrushOpts> = {}): BrushOpts {
  return { stage: "ink", seed: 7, width: TELEGRAPH.brushWidth * INK_DOTS, side: 0, gap: 0, alpha: 1, haloMul: 1, entry: true, ...over };
}

/** 層ごとのドットの数 */
function countLayers(s: InkSurface): Map<number, number> {
  const out = new Map<number, number>();
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const l = s.layerAt(x, y);
      if (l) out.set(l, (out.get(l) ?? 0) + 1);
    }
  }
  return out;
}

/** 段（mark の下位 3 ビット）ごとの数（墨の層だけ） */
function inkLevels(s: InkSurface): number[] {
  const out = new Array<number>(INK_LEVELS + 1).fill(0);
  for (let i = 0; i < s.mark.length; i++) {
    const m = s.mark[i] ?? 0;
    if (m >> 3 === INK_LAYER.ink) out[m & 7] = (out[m & 7] ?? 0) + 1;
  }
  return out;
}

/** ワールドのドットで見た層の並び（作業面のずれを打ち消す） */
function worldLayers(s: InkSurface, x0: number, y0: number, w: number, h: number): number[] {
  const out: number[] = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push(s.layerAt(x + s.ox * INK_DOTS, y + s.oy * INK_DOTS));
  return out;
}

afterEach(() => clearBrushCache());

describe("筆の太さ", () => {
  it("入りは押さえて細く、墨溜まりで太り、抜きで細く払う", () => {
    const p = brushProfile(200, 12, 3);
    const entry = p[0] ?? 0;
    const pool = Math.max(...Array.from(p.slice(6, 12)));
    const body = p[100] ?? 0;
    const tip = p[199] ?? 0;
    expect(entry).toBeLessThan(body);
    expect(pool).toBeGreaterThan(body);
    expect(tip).toBeLessThan(body * 0.4);
  });

  it("同じ長さ・種なら同じ形（決定的）", () => {
    expect(Array.from(brushProfile(120, 12, 9))).toEqual(Array.from(brushProfile(120, 12, 9)));
  });
});

describe("道", () => {
  it("扇の道は要の外から左の辺 → 弧 → 右の辺で、長さは辺 2 本と弧の和", () => {
    const range = 80;
    const half = 0.5;
    const r0 = 10;
    const path = fanPath(0, 0, range, 0, half, r0);
    expect(path.length).toBeCloseTo((range - r0) * 2 + range * half * 2, 5);
    const start = pathPoint(path, 0);
    expect(Math.hypot(start.x, start.y)).toBeCloseTo(r0, 5);
    const mid = pathPoint(path, path.length / 2);
    expect(Math.hypot(mid.x, mid.y)).toBeCloseTo(range, 3);
  });

  it("速い atan2 は Math.atan2 と 2e-4 rad 以内（半径 200 ドットの輪で 0.04 ドット）", () => {
    for (let a = -Math.PI + 0.01; a < Math.PI; a += 0.07) {
      const x = Math.cos(a) * 3.7;
      const y = Math.sin(a) * 3.7;
      expect(Math.abs(fastAtan2(y, x) - Math.atan2(y, x))).toBeLessThan(2e-4);
    }
  });

  it("明るさの段は 0 で 1、1 で 7、増えるほど下がらない", () => {
    expect(levelOf(0)).toBe(1);
    expect(levelOf(1)).toBe(INK_LEVELS);
    let prev = 0;
    for (let v = 0; v <= 1; v += 0.01) {
      expect(levelOf(v)).toBeGreaterThanOrEqual(prev);
      prev = levelOf(v);
    }
  });
});

describe("墨入れの筆", () => {
  it("芯が真っ黒（段 7）で縁は淡い段 1、外に胡粉の滲み、入りに朱の点", () => {
    const s = new InkSurface(W, H);
    drawBrush(s, linePath(40, 100, 260, 100), opts());
    const lv = inkLevels(s);
    expect(lv[INK_LEVELS], "芯の真っ黒").toBeGreaterThan(100);
    expect(lv[1], "淡い縁").toBeGreaterThan(50);
    const layers = countLayers(s);
    expect(layers.get(INK_LAYER.halo) ?? 0, "胡粉").toBeGreaterThan(50);
    expect(layers.get(INK_LAYER.mark) ?? 0, "朱の点").toBeGreaterThan(5);
    expect(layers.get(INK_LAYER.sketch) ?? 0, "下絵の層は使わない").toBe(0);
  });

  it("被弾筋は朱を持たない", () => {
    const s = new InkSurface(W, H);
    drawBrush(s, linePath(40, 100, 260, 100), opts({ stage: "trace" }));
    expect(countLayers(s).get(INK_LAYER.mark) ?? 0).toBe(0);
  });

  it("太い所の芯に掠れの毛筋が通る（芯の中に真っ黒でないドットがある）", () => {
    const s = new InkSurface(W, H);
    drawBrush(s, linePath(40, 100, 260, 100), opts());
    let streaks = 0;
    for (let x = 80; x < 200; x++) {
      for (let y = 97; y <= 103; y++) {
        const m = s.mark[y * s.w + x] ?? 0;
        if (m >> 3 !== INK_LAYER.ink || (m & 7) < INK_LEVELS - 2) streaks++;
      }
    }
    expect(streaks).toBeGreaterThan(5);
  });

  it("範囲の筆（寄せ 1）は道の内側にだけ広がり、外へは毛羽と胡粉の 2 ドットまで", () => {
    const s = new InkSurface(W, H);
    const r = 60;
    drawBrush(s, arcPath(160, 100, r, 0, Math.PI * 2), opts({ side: 1, entry: false }));
    let outside = 0;
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        if (s.layerAt(x, y) !== INK_LAYER.ink) continue;
        if (Math.hypot(x + 0.5 - 160, y + 0.5 - 100) > r + 2.5) outside++;
      }
    }
    // 飛沫は外へ散る（数は少ない）
    expect(outside).toBeLessThan(40);
  });

  it("同じ道と設定なら同じドット（決定的。記録して写しても同じ）", () => {
    const shots: number[][] = [];
    for (let i = 0; i < 4; i++) {
      const s = new InkSurface(W, H);
      drawBrush(s, linePath(30, 60, 280, 150), opts({ seed: 11 }));
      shots.push(Array.from(s.px));
    }
    expect(brushCacheSize(), "2 度目で覚える").toBe(1);
    for (const shot of shots.slice(1)) expect(shot).toEqual(shots[0]);
  });

  it("カメラが動いても模様はワールドのドットに留まる（泳がない）", () => {
    const draw = (ox: number, oy: number): number[] => {
      const s = new InkSurface(W, H);
      s.ox = ox;
      s.oy = oy;
      // ワールドの同じ線
      drawBrush(s, linePath(s.dotX(20), s.dotY(40), s.dotX(120), s.dotY(60)), opts({ seed: 5 }));
      return worldLayers(s, 20, 40, 220, 80);
    };
    const a = draw(0, 0);
    clearBrushCache();
    expect(draw(7, -3)).toEqual(a);
  });
});

describe("下絵の筆", () => {
  function sketchDots(gap: number): InkSurface {
    const s = new InkSurface(W, H);
    drawBrush(s, linePath(40, 100, 280, 100), opts({ stage: "sketch", gap }));
    return s;
  }

  it("下絵の層の淡い段（1・2）だけを使い、胡粉・朱・墨を置かない", () => {
    const s = sketchDots(0.3);
    const layers = countLayers(s);
    expect(layers.get(INK_LAYER.sketch) ?? 0).toBeGreaterThan(100);
    expect([...layers.keys()]).toEqual([INK_LAYER.sketch]);
    for (let i = 0; i < s.mark.length; i++) expect(s.mark[i] ?? 0).toBeLessThanOrEqual(INK_LAYER.sketch * 8 + 2);
  });

  it("縁でない所は市松に間引く（ワールドのドットの偶奇が奇数の所に置かない）", () => {
    const s = sketchDots(0);
    let odd = 0;
    for (let x = 100; x < 200; x++) {
      for (let y = 99; y <= 101; y++) if (s.layerAt(x, y) && (s.worldX(x) + s.worldY(y)) & 1) odd++;
    }
    expect(odd).toBe(0);
  });

  it("欠けの割合（怯み値）を上げると描くドットは減るだけで増えない", () => {
    let prev = Number.POSITIVE_INFINITY;
    for (const gap of [0, 0.25, 0.4, 0.55, 0.7]) {
      const n = countLayers(sketchDots(gap)).get(INK_LAYER.sketch) ?? 0;
      expect(n, `欠け ${gap}`).toBeLessThanOrEqual(prev);
      prev = n;
    }
  });

  it("欠けが最大でも根元と先端は描く（向きと届きを見せる）", () => {
    const s = sketchDots(TELEGRAPH.sketchGapMax);
    const column = (x: number): number => {
      let n = 0;
      for (let y = 90; y <= 110; y++) if (s.layerAt(x, y)) n++;
      return n;
    };
    expect(column(48), "根元").toBeGreaterThan(0);
    expect(column(272), "先端").toBeGreaterThan(0);
  });
});
