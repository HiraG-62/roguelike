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
