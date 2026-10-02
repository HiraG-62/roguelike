import { describe, expect, it } from "vitest";
import { TELEGRAPH } from "../data/tuning";
import { type BakeSrc, type BrushGeo, type BrushLayer, type ImageLayer, type PathLayer, RING_SWEEP, arcGeo, fanGeo, lineGeo, polyGeo, quantLen, ringStartAngle, strandRuns } from "./inkBrush";

/** 帯（塗りの多角形）の幅を s = x の位置ごとに返す（直線の筆では x が筆の進む距離、y が横） */
function widthsAlong(part: readonly number[]): { x: number; w: number }[] {
  const n = part.length / 2;
  const half = n / 2;
  const out: { x: number; w: number }[] = [];
  for (let i = 0; i < half; i++) {
    const top = part[i * 2 + 1] ?? 0;
    const bottom = part[(n - 1 - i) * 2 + 1] ?? 0;
    out.push({ x: part[i * 2] ?? 0, w: Math.abs(top - bottom) });
  }
  return out;
}

function pathLayers(geo: BrushGeo): PathLayer[] {
  return geo.layers.filter((l): l is PathLayer => l.kind === "fill");
}

function imageOf(geo: BrushGeo, tone: ImageLayer["tone"]): ImageLayer {
  const layer = geo.layers.find((l): l is ImageLayer => l.kind === "image" && l.tone === tone);
  if (!layer) throw new Error(`${tone} の絵が無い`);
  return layer;
}

/** 焼く絵の材料の点（判子の中心と毛の束の点）をすべて返す */
function srcPoints(src: BakeSrc): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 2 < src.dabs.length; i += 3) out.push([src.dabs[i] ?? 0, src.dabs[i + 1] ?? 0]);
  for (const set of src.strands) for (const part of set.parts) for (let i = 0; i + 1 < part.length; i += 2) out.push([part[i] ?? 0, part[i + 1] ?? 0]);
  return out;
}

function tones(geo: BrushGeo): BrushLayer["tone"][] {
  return geo.layers.map((l) => l.tone);
}

function covered(runs: readonly [number, number][]): number {
  return runs.reduce((a, [from, to]) => a + (to - from), 0);
}

describe("筆の長さの量子化", () => {
  it("量子化しても 3% 以内の伸縮で済み、同じ値に量子化し直しても動かない", () => {
    for (const v of [24, 37, 60, 118, 200, 411]) {
      const q = quantLen(v);
      expect(Math.abs(q / v - 1), `${v}`).toBeLessThanOrEqual(0.031);
      expect(quantLen(q)).toBeCloseTo(q, 6);
    }
  });
});

describe("毛の束の掠れ", () => {
  it("同じ種・長さ・欠けなら同じ並び（決定的）", () => {
    expect(strandRuns(17, 120, 0.4, 0.1, 2, "sketch")).toEqual(strandRuns(17, 120, 0.4, 0.1, 2, "sketch"));
  });

  it("下絵の中央の筋は、欠けが最大でも根元と先端を必ず描く（向きと届きを見せる）", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const runs = strandRuns(seed, 100, TELEGRAPH.sketchGapMax, 0, 4, "sketch");
      expect(runs[0]?.[0], `根元 ${seed}`).toBe(0);
      expect(runs[runs.length - 1]?.[1], `先端 ${seed}`).toBeCloseTo(100, 5);
    }
  });

  it("欠けの割合が大きいほど描く長さが減る（怯み値が溜まるほど掠れる）", () => {
    const total = (gap: number): number => {
      let sum = 0;
      for (let seed = 1; seed <= 40; seed++) for (const u of [-0.4, -0.15, 0.3]) sum += covered(strandRuns(seed, 160, gap, u, seed % 7, "sketch"));
      return sum;
    };
    expect(total(0.7)).toBeLessThan(total(0.45));
    expect(total(0.45)).toBeLessThan(total(0.25));
  });

  it("外側の筋ほど先で墨が尽きる（縁から掠れる）", () => {
    let inner = 0;
    let outer = 0;
    for (let seed = 1; seed <= 60; seed++) {
      inner += covered(strandRuns(seed, 160, 0, 0.05, 1, "ink"));
      outer += covered(strandRuns(seed, 160, 0, 0.49, 1, "ink"));
    }
    expect(outer).toBeLessThan(inner);
  });
});

describe("筆の形", () => {
  it("同じ鍵ならキャッシュした同じ形を返し、欠けの段階や変種が違えば別の形", () => {
    const a = lineGeo("sketch", quantLen(100), 0, 0.3, 0);
    expect(lineGeo("sketch", quantLen(100), 0, 0.3, 0)).toBe(a);
    expect(lineGeo("sketch", quantLen(100), 0, 0.6, 0)).not.toBe(a);
    expect(lineGeo("sketch", quantLen(100), 1, 0.3, 0)).not.toBe(a);
  });

  it("下絵は薄墨の絵 1 枚だけ、墨入れは胡粉・濃墨の塗り・縁の掠れ・朱、被弾筋は朱を持たない（線の質で分かれる）", () => {
    expect(tones(lineGeo("sketch", quantLen(100), 0, 0.3, 0))).toEqual(["sketch"]);
    expect(tones(lineGeo("ink", quantLen(100), 0, 0, 0))).toEqual(["inkHalo", "body", "dry", "shu"]);
    expect(tones(lineGeo("trace", quantLen(100), 0, 0, 0))).toEqual(["inkHalo", "body", "dry"]);
  });

  it("焼く絵の材料は形ごとに共有し、判子と毛の束はすべて外接矩形に収まる", () => {
    const len = quantLen(140);
    expect(imageOf(lineGeo("ink", len, 2, 0, 0), "inkHalo").src, "墨入れと被弾筋は同じ胡粉の絵").toBe(imageOf(lineGeo("trace", len, 2, 0, 0), "inkHalo").src);
    expect(imageOf(lineGeo("ink", len, 2, 0, 0, { from: 20, to: 60 }), "dry").src, "窓つきの形も全長の絵を使う").toBe(imageOf(lineGeo("ink", len, 2, 0, 0), "dry").src);
    expect(imageOf(lineGeo("sketch", len, 2, 0.3, 0), "sketch").src, "下絵は欠けの段階ごとに別の絵").not.toBe(imageOf(lineGeo("sketch", len, 2, 0.7, 0), "sketch").src);
    const r = quantLen(60);
    const srcs = {
      sketch: imageOf(arcGeo("sketch", r, RING_SWEEP, 1, 0.3), "sketch").src,
      gofun: imageOf(arcGeo("ink", r, RING_SWEEP, 1, 0), "inkHalo").src,
      dry: imageOf(arcGeo("ink", r, RING_SWEEP, 1, 0), "dry").src,
    };
    for (const [name, src] of Object.entries(srcs)) {
      for (const [x, y] of srcPoints(src)) {
        expect(x, name).toBeGreaterThanOrEqual(src.x0);
        expect(x, name).toBeLessThanOrEqual(src.x1);
        expect(y, name).toBeGreaterThanOrEqual(src.y0);
        expect(y, name).toBeLessThanOrEqual(src.y1);
      }
    }
    expect(srcs.sketch.puddles.length > 0 && srcs.sketch.strands.length > 0, "下絵は水溜まりと毛の束").toBe(true);
    expect(srcs.sketch.fibers.length, "下絵に毛羽は無い").toBe(0);
    expect(srcs.gofun.fibers.length > 0 && srcs.gofun.strands.length === 0, "胡粉は毛羽だけ").toBe(true);
    expect(srcs.dry.dabs.length === 0 && srcs.dry.strands.length > 0, "縁の掠れは毛の束だけ").toBe(true);
  });

  it("墨入れは入りに墨溜まりで太く、抜きで細く払う（先が根元より細い）", () => {
    const len = quantLen(120);
    const body = lineGeo("ink", len, 0, 0, 0).layers.find((l) => l.tone === "body");
    if (body?.kind !== "fill") throw new Error("塗りが無い");
    const widths = widthsAlong(body.parts[0] ?? []);
    const root = Math.max(...widths.filter((p) => p.x < 6).map((p) => p.w));
    const mid = widths.find((p) => p.x > len * 0.4)?.w ?? 0;
    const tip = widths[widths.length - 1]?.w ?? 0;
    expect(root, "入りの墨溜まり").toBeGreaterThan(mid);
    expect(tip, "抜きの払い").toBeLessThan(mid * 0.6);
  });

  it("朱の墨溜まりは入りの近くに 1 つ", () => {
    const shu = lineGeo("ink", quantLen(120), 0, 0, 0).layers.find((l) => l.kind === "shu");
    if (shu?.kind !== "shu") throw new Error("朱が無い");
    expect(shu.dots.length).toBe(2);
    expect(shu.dots[0]).toBeCloseTo(TELEGRAPH.shuPoolAt, 5);
  });

  it("自分の体の上を切った窓だけを作る（塗りは窓の外へはみ出さず、絵は窓の区間だけ置き、窓の外の朱は置かない）", () => {
    const len = quantLen(120);
    const win = { from: 30, to: 70 };
    for (const stage of ["sketch", "ink"] as const) {
      const geo = lineGeo(stage, len, 0, 0.3, 0, win);
      for (const layer of pathLayers(geo)) {
        for (const part of layer.parts) {
          for (let i = 0; i < part.length; i += 2) {
            const x = part[i] ?? 0;
            expect(x, `${stage}/${layer.tone}`).toBeGreaterThanOrEqual(win.from - 1e-6);
            expect(x, `${stage}/${layer.tone}`).toBeLessThanOrEqual(win.to + 1e-6);
          }
        }
      }
      for (const layer of geo.layers) if (layer.kind === "image") expect([layer.from, layer.to], `${stage}/${layer.tone} の区間`).toEqual([win.from, win.to]);
      expect(geo.layers.some((l) => l.kind === "shu"), `${stage} の朱`).toBe(false);
      // 窓つきの形はキャッシュしない（切る位置が自分の動きで毎回違うため）
      expect(lineGeo(stage, len, 0, 0.3, 0, win)).not.toBe(geo);
    }
  });

  it("輪の帯は判定の内側（半径より外へほぼ出ない）", () => {
    const r = quantLen(90);
    for (const stage of ["sketch", "ink"] as const) {
      const geo = arcGeo(stage, r, RING_SWEEP, 0, 0.3);
      for (const layer of pathLayers(geo)) {
        // 塗りの 2 つ目以降は入りの飛沫（帯ではない飾り）なので見ない
        const part = layer.parts[0] ?? [];
        for (let i = 0; i < part.length; i += 2) expect(Math.hypot(part[i] ?? 0, part[i + 1] ?? 0), `${stage}/${layer.tone}`).toBeLessThanOrEqual(r + 1);
      }
      for (const layer of geo.layers) {
        if (layer.kind !== "image") continue;
        // 毛の束は縁のがたつきとゆらぎの分だけ余裕を見る（滲みは帯の外へ柔らかく広がる飾りなので見ない）
        for (const set of layer.src.strands) for (const part of set.parts) for (let i = 0; i < part.length; i += 2) expect(Math.hypot(part[i] ?? 0, part[i + 1] ?? 0), `${stage}/${layer.tone}`).toBeLessThanOrEqual(r + 1);
      }
    }
  });

  it("小さな輪は筆が細い（帯と滲みで範囲の中を埋めない）", () => {
    const innerOf = (r: number): number => {
      const body = arcGeo("ink", r, RING_SWEEP, 0, 0).layers.find((l) => l.tone === "body");
      if (body?.kind !== "fill") throw new Error("塗りが無い");
      let min = Number.POSITIVE_INFINITY;
      const part = body.parts[0] ?? [];
      for (let i = 0; i < part.length; i += 2) min = Math.min(min, Math.hypot(part[i] ?? 0, part[i + 1] ?? 0));
      return min / r;
    };
    expect(innerOf(quantLen(10)), "小さな輪の帯の内縁").toBeGreaterThan(0.5);
    expect(innerOf(quantLen(10))).toBeGreaterThan(innerOf(quantLen(20)) - 0.05);
  });

  it("扇は要の外から 1 筆でなぞり、射程と角度の内側に収まる", () => {
    const range = quantLen(70);
    const half = 0.6;
    const geo = fanGeo("ink", range, half, 8, 0, 0);
    const body = geo.layers.find((l) => l.tone === "body");
    if (body?.kind !== "fill") throw new Error("塗りが無い");
    const part = body.parts[0] ?? [];
    for (let i = 0; i < part.length; i += 2) {
      const x = part[i] ?? 0;
      const y = part[i + 1] ?? 0;
      expect(Math.hypot(x, y), "射程").toBeLessThanOrEqual(range + 1);
      if (Math.hypot(x, y) > 10) expect(Math.abs(Math.atan2(y, x)), "角度").toBeLessThanOrEqual(half + 0.08);
    }
    expect(geo.layers.filter((l) => l.kind === "shu").length, "朱は 1 つ（要の側の入り）").toBe(1);
  });

  it("折れ線の筆は同じ点なら同じ形を返す（陣図の画）", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 40, y: 10 },
      { x: 60, y: 50 },
    ];
    expect(polyGeo("ink", pts, 3, 0)).toBe(polyGeo("ink", pts.map((p) => ({ ...p })), 3, 0));
    expect(polyGeo("ink", pts, 3, 0, 1.5)).not.toBe(polyGeo("ink", pts, 3, 0));
  });

  it("輪の始点の角度は敵の id で固定（ちらつかない）", () => {
    expect(ringStartAngle(7)).toBe(ringStartAngle(7));
    expect(ringStartAngle(7)).not.toBe(ringStartAngle(8));
  });
});
