import { describe, expect, it } from "vitest";
import { InkRecorder, InkShapeCache, replayRecord } from "./inkCache";
import { INK_LAYER, InkSurface, rgbOf } from "./inkSurface";

const BLACK = rgbOf("#000000");

describe("筆の形の記録", () => {
  it("記録を別のカメラの位置で写すと、ワールドの同じドットに置く", () => {
    const rec = new InkRecorder(0, 0);
    rec.push(10, 12, INK_LAYER.ink, 7, BLACK, 1);
    rec.push(11, 12, INK_LAYER.halo, 1, rgbOf("#efe7d2"), 0.3);
    const r = rec.finish();
    expect(r).not.toBeNull();
    if (!r) return;
    const s = new InkSurface(64, 32);
    s.ox = 3;
    s.oy = 1;
    replayRecord(s, r);
    expect(s.layerAt(10 + 6, 12 + 2)).toBe(INK_LAYER.ink);
    expect(s.layerAt(11 + 6, 12 + 2)).toBe(INK_LAYER.halo);
  });

  it("作業面の外のドットは捨てる", () => {
    const rec = new InkRecorder(0, 0);
    rec.push(-5, 3, INK_LAYER.ink, 7, BLACK, 1);
    rec.push(2, 3, INK_LAYER.ink, 7, BLACK, 1);
    const r = rec.finish();
    if (!r) throw new Error("記録が無い");
    const s = new InkSurface(16, 8);
    replayRecord(s, r);
    expect(s.layerAt(2, 3)).toBe(INK_LAYER.ink);
    expect(s.mark.filter((m) => m !== 0).length, "置いたのは作業面の中の 1 ドットだけ").toBe(1);
  });
});

describe("形のキャッシュ", () => {
  it("1 度目は覚えず、2 度目に見た形から覚える", () => {
    const c = new InkShapeCache();
    expect(c.seenBefore("a")).toBe(false);
    expect(c.seenBefore("a")).toBe(true);
    const rec = new InkRecorder(0, 0).finish();
    if (!rec) throw new Error("記録が無い");
    c.store("a", rec);
    expect(c.get("a")).toBe(rec);
    expect(c.get("b")).toBeUndefined();
  });
});
