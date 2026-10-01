import { describe, expect, it } from "vitest";
import { GlyphSheet, ShelfPacker } from "./glyphSheets";

describe("ShelfPacker（字の台紙の棚詰め）", () => {
  it("左から隙間 1 を空けて詰め、溢れたら次の行、台紙が埋まったら次の台紙", () => {
    const p = new ShelfPacker(40, 16);
    expect(p.alloc(16)).toEqual({ page: 0, x: 0, y: 0 });
    expect(p.alloc(16)).toEqual({ page: 0, x: 17, y: 0 });
    // 34 + 16 > 40 なので次の行
    expect(p.alloc(16)).toEqual({ page: 0, x: 0, y: 17 });
    expect(p.alloc(16)).toEqual({ page: 0, x: 17, y: 17 });
    // 次の行（y = 34）は 34 + 16 > 40 で入らないので次の台紙
    expect(p.alloc(8)).toEqual({ page: 1, x: 0, y: 0 });
  });

  it("台紙より広い字は null（単独の canvas にする）", () => {
    expect(new ShelfPacker(32, 16).alloc(33)).toBeNull();
  });

  it("同じ台紙の区画は重ならない", () => {
    const p = new ShelfPacker(64, 16);
    const rects: { page: number; x: number; y: number; w: number }[] = [];
    for (let i = 0; i < 40; i++) {
      const w = i % 2 === 0 ? 8 : 16;
      const at = p.alloc(w);
      if (at) rects.push({ ...at, w });
    }
    for (const a of rects) {
      for (const b of rects) {
        if (a === b || a.page !== b.page || a.y !== b.y) continue;
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x;
        expect(apart, `${JSON.stringify(a)} と ${JSON.stringify(b)}`).toBe(true);
      }
    }
  });
});

describe("GlyphSheet", () => {
  it("台紙は要るときだけ作り、広すぎる字はその字だけの canvas", () => {
    const made: { w: number; h: number }[] = [];
    const sheet = new GlyphSheet(
      (w, h) => {
        made.push({ w, h });
        return { width: w, height: h } as unknown as HTMLCanvasElement;
      },
      32,
      16,
    );
    const a = sheet.alloc(8);
    const b = sheet.alloc(8);
    expect(a.canvas).toBe(b.canvas);
    expect(sheet.pageCount).toBe(1);
    const wide = sheet.alloc(40);
    expect(wide.canvas).not.toBe(a.canvas);
    expect(made).toEqual([
      { w: 32, h: 32 },
      { w: 40, h: 16 },
    ]);
  });
});
