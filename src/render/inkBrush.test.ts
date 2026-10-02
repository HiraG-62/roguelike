import { describe, expect, it } from "vitest";
import { TELEGRAPH } from "../data/tuning";
import { RING_SWEEP, arcGeo, fiberRuns, lineGeo, quantLen, ringStartAngle } from "./inkBrush";

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

describe("筆の長さの量子化", () => {
  it("量子化しても 3% 以内の伸縮で済み、同じ値に量子化し直しても動かない", () => {
    for (const v of [24, 37, 60, 118, 200, 411]) {
      const q = quantLen(v);
      expect(Math.abs(q / v - 1), `${v}`).toBeLessThanOrEqual(0.031);
      expect(quantLen(q)).toBeCloseTo(q, 6);
    }
  });
});

describe("下絵の筋（掠れ）", () => {
  const SEED = 17;

  it("同じ種・長さ・欠けなら同じ並び（決定的）", () => {
    expect(fiberRuns(SEED, 120, 0.4, 16, 3.5, true)).toEqual(fiberRuns(SEED, 120, 0.4, 16, 3.5, true));
  });

  it("根元は必ず一定の長さ描かれ、明るい筋は先端まで描かれる（向きと届きを見せる）", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const runs = fiberRuns(seed, 100, 0.7, 16, 3.5, true);
      const first = runs[0];
      const last = runs[runs.length - 1];
      expect(first?.[0], "根元から").toBe(0);
      expect((first?.[1] ?? 0) - (first?.[0] ?? 0), "根元の長さ").toBeGreaterThanOrEqual(TELEGRAPH.brushRootPx - 1e-6);
      expect(last?.[1], `先端 ${seed}`).toBe(100);
    }
  });

  it("欠けの割合が大きいほど描く長さが減る（怯み値が溜まるほど掠れる）", () => {
    const covered = (gap: number): number => {
      let total = 0;
      for (let seed = 1; seed <= 60; seed++) for (const [a, b] of fiberRuns(seed, 160, gap, 16, 3.5, false)) total += b - a;
      return total;
    };
    expect(covered(0.7)).toBeLessThan(covered(0.4));
    expect(covered(0.4)).toBeLessThan(covered(0.1));
  });
});

describe("筆の形", () => {
  it("同じ鍵ならキャッシュした同じ形を返し、欠けの段階や変種が違えば別の形", () => {
    const a = lineGeo("sketch", quantLen(100), 0, 0.3, 0);
    expect(lineGeo("sketch", quantLen(100), 0, 0.3, 0)).toBe(a);
    expect(lineGeo("sketch", quantLen(100), 0, 0.6, 0)).not.toBe(a);
    expect(lineGeo("sketch", quantLen(100), 1, 0.3, 0)).not.toBe(a);
  });

  it("下絵は筋だけ、墨入れは帯と芯を持ち、下絵に芯・墨入れに筋は無い（線の質で分かれる）", () => {
    const sketch = lineGeo("sketch", quantLen(100), 0, 0.3, 0).layers.map((l) => l.tone);
    const ink = lineGeo("ink", quantLen(100), 0, 0, 0).layers.map((l) => l.tone);
    expect(sketch).toEqual(["dull", "bright"]);
    expect(ink).toEqual(["body", "core"]);
  });

  it("墨入れは入りに墨溜まりで太く、抜きで細く払う（先が根元より細い）", () => {
    const len = quantLen(120);
    const body = lineGeo("ink", len, 0, 0, 0).layers.find((l) => l.tone === "body")?.parts[0] ?? [];
    const widths = widthsAlong(body);
    const root = Math.max(...widths.filter((p) => p.x < 5).map((p) => p.w));
    const mid = widths.find((p) => p.x > len * 0.4)?.w ?? 0;
    const tip = widths[widths.length - 1]?.w ?? 0;
    expect(root, "入りの墨溜まり").toBeGreaterThan(mid);
    expect(tip, "抜きの払い").toBeLessThan(mid * 0.6);
  });

  it("自分の体の上を切った窓だけを作る（筋も帯も窓の外へはみ出さない）", () => {
    const len = quantLen(120);
    const win = { from: 30, to: 70 };
    for (const stage of ["sketch", "ink"] as const) {
      const geo = lineGeo(stage, len, 0, 0.3, 0, win);
      for (const layer of geo.layers) {
        for (const part of layer.parts) {
          for (let i = 0; i < part.length; i += 2) {
            const x = part[i] ?? 0;
            expect(x, `${stage}/${layer.tone}`).toBeGreaterThanOrEqual(win.from - 1e-6);
            expect(x, `${stage}/${layer.tone}`).toBeLessThanOrEqual(win.to + 1e-6);
          }
        }
      }
      // 窓つきの形はキャッシュしない（切る位置が自分の動きで毎回違うため）
      expect(lineGeo(stage, len, 0, 0.3, 0, win)).not.toBe(geo);
    }
  });

  it("輪の墨入れは縁の内側へ滲む層を持ち、下絵は滲まない。滲みは深さの上限で収まる", () => {
    const r = quantLen(140);
    const ink = arcGeo("ink", r, RING_SWEEP, 0, 0);
    const sketch = arcGeo("sketch", r, RING_SWEEP, 0, 0.3);
    expect(ink.layers.map((l) => l.tone)).toContain("bleed");
    expect(sketch.layers.map((l) => l.tone)).not.toContain("bleed");
    const bleed = ink.layers.find((l) => l.tone === "bleed")?.parts[0] ?? [];
    let minR = Number.POSITIVE_INFINITY;
    for (let i = 0; i < bleed.length; i += 2) minR = Math.min(minR, Math.hypot(bleed[i] ?? 0, bleed[i + 1] ?? 0));
    expect(r - minR, "滲みの深さ").toBeLessThanOrEqual(TELEGRAPH.bleedMaxPx + 1e-6);
  });

  it("輪の帯は判定の内側（半径より外へ出ない）", () => {
    const r = quantLen(90);
    for (const stage of ["sketch", "ink"] as const) {
      const geo = arcGeo(stage, r, RING_SWEEP, 0, 0.3);
      for (const layer of geo.layers) {
        for (const part of layer.parts) {
          for (let i = 0; i < part.length; i += 2) {
            const d = Math.hypot(part[i] ?? 0, part[i + 1] ?? 0);
            // 墨入れの縁のがたつきと払いの曲がりの分だけ余裕を見る
            expect(d, `${stage}/${layer.tone}`).toBeLessThanOrEqual(r + TELEGRAPH.brushFlickPx + 0.5);
          }
        }
      }
    }
  });

  it("輪の始点の角度は敵の id で固定（ちらつかない）", () => {
    expect(ringStartAngle(7)).toBe(ringStartAngle(7));
    expect(ringStartAngle(7)).not.toBe(ringStartAngle(8));
  });
});
