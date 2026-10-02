import { describe, expect, it } from "vitest";
import { FORMATION_LAYOUTS } from "../data/formations";
import { layoutOffsets, rotateToFacing } from "./formation";

/** 陣形の並び（map/formation.ts の純関数） */
describe("陣形の並び（layoutOffsets）", () => {
  it("どの並べ方も人数ぶんの点を返し、外接矩形の中心が原点", () => {
    for (const layout of FORMATION_LAYOUTS) {
      for (const n of [1, 2, 5, 9]) {
        const pts = layoutOffsets(layout, n, 20);
        expect(pts, `${layout} ${n}`).toHaveLength(n);
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        expect((Math.min(...xs) + Math.max(...xs)) / 2, `${layout} ${n} x`).toBeCloseTo(0, 6);
        expect((Math.min(...ys) + Math.max(...ys)) / 2, `${layout} ${n} y`).toBeCloseTo(0, 6);
      }
    }
    expect(layoutOffsets("wedge", 0, 20)).toEqual([]);
  });

  it("single 以外は点が重ならない", () => {
    for (const layout of FORMATION_LAYOUTS) {
      if (layout === "single") continue;
      const pts = layoutOffsets(layout, 9, 20);
      const keys = new Set(pts.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`));
      expect(keys.size, layout).toBe(pts.length);
    }
  });

  it("魚鱗（wedge）は最初の点が正面の頂点、鶴翼（vee）は最後の点が奥の頂点、長蛇（column）は先頭から後ろへ並ぶ", () => {
    const wedge = layoutOffsets("wedge", 6, 20);
    expect(Math.max(...wedge.map((p) => p.x)), "頂点が最も前").toBe(wedge[0]!.x);
    const vee = layoutOffsets("vee", 5, 20);
    expect(Math.min(...vee.map((p) => p.x)), "頂点が最も奥").toBe(vee[vee.length - 1]!.x);
    const column = layoutOffsets("column", 4, 22);
    for (let i = 1; i < column.length; i++) expect(column[i]!.x, "後ろへ").toBeLessThan(column[i - 1]!.x);
  });

  it("偃月（arc）は先頭が最前で残りが後ろの弧、方円（ring）は先頭が中心で残りが同じ半径の輪、物見（single）は 1 点", () => {
    const arc = layoutOffsets("arc", 6, 22);
    const front = Math.max(...arc.map((p) => p.x));
    expect(arc[0]!.x, "先頭が最前").toBe(front);
    for (const p of arc.slice(1)) expect(p.x, "残りは先頭より後ろ").toBeLessThan(arc[0]!.x);

    const ring = layoutOffsets("ring", 7, 20);
    const center = ring[0]!;
    const radii = ring.slice(1).map((p) => Math.hypot(p.x - center.x, p.y - center.y));
    expect(radii.length).toBe(6);
    for (const r of radii) expect(r, "輪は同じ半径").toBeCloseTo(radii[0]!, 6);
    expect(radii[0]!, "中心から離れる").toBeGreaterThan(20);
    expect(Math.hypot(center.x, center.y), "中心は陣の中心").toBeCloseTo(0, 6);

    expect(layoutOffsets("single", 1, 20)).toEqual([{ x: 0, y: 0 }]);
  });

  it("鋒矢（line）は先頭から後ろへ一直線、衡軛（twoRows）は前列を先に埋めて後列がその後ろ", () => {
    const line = layoutOffsets("line", 5, 22);
    for (let i = 1; i < line.length; i++) {
      expect(line[i]!.x, "後ろへ").toBeCloseTo(line[i - 1]!.x - 22, 6);
      expect(line[i]!.y, "一直線").toBeCloseTo(line[0]!.y, 6);
    }
    const rows = layoutOffsets("twoRows", 6, 22);
    const front = rows.slice(0, 3);
    const back = rows.slice(3);
    for (const p of front) expect(p.x, "前列は同じ奥行き").toBeCloseTo(front[0]!.x, 6);
    for (const p of back) expect(p.x, "後列は前列より後ろ").toBeLessThan(front[0]!.x);
    expect(new Set(rows.map((p) => p.x.toFixed(3))).size, "奥行きは 2 段だけ").toBe(2);
    expect(layoutOffsets("twoRows", 5, 22).slice(0, 3), "奇数は前列が多い").toHaveLength(3);
  });

  it("同じ引数なら同じ結果（乱数を使わない）", () => {
    expect(layoutOffsets("diagonal", 7, 22)).toEqual(layoutOffsets("diagonal", 7, 22));
  });
});

describe("向きへの回転（rotateToFacing）", () => {
  it("正面 +x を facing に向ける", () => {
    const up = rotateToFacing({ x: 10, y: 0 }, { x: 0, y: -1 });
    expect(up.x).toBeCloseTo(0, 6);
    expect(up.y).toBeCloseTo(-10, 6);
    expect(rotateToFacing({ x: 3, y: 4 }, { x: 1, y: 0 })).toEqual({ x: 3, y: 4 });
  });
});
