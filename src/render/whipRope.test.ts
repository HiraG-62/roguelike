import { describe, expect, it } from "vitest";
import { ropePixels, ropePoints, ropeProgress } from "./whipRope";
import { weaponRope } from "./actorSprites";

describe("鞭の縄（戻しで垂れて巻き戻る）", () => {
  const base = { from: { x: 10, y: -20 }, angle: 0, length: 80 };

  it("戻しの頭（エフェクトの線が残る間）と巻き戻り切った後は描かない", () => {
    expect(ropeProgress(0)).toBeNull();
    expect(ropeProgress(0.9)).toBeNull();
    expect(ropePoints({ ...base, t: 0 })).toEqual([]);
    expect(ropePoints({ ...base, t: 0.9 })).toEqual([]);
  });

  it("柄の先から出て、進むほど短くなり、先が垂れる", () => {
    const early = ropePoints({ ...base, t: 0.12 });
    const late = ropePoints({ ...base, t: 0.5 });
    expect(early[0]).toEqual(base.from);
    const tipOf = (pts: readonly { x: number; y: number }[]) => pts[pts.length - 1] ?? { x: 0, y: 0 };
    expect(tipOf(late).x, "手元へ縮む").toBeLessThan(tipOf(early).x);
    expect(tipOf(late).y, "先が垂れる（下へ）").toBeGreaterThan(base.from.y);
  });

  it("画素は輪郭と革の塗りを持ち、同じ格子を重ねない", () => {
    const px = ropePixels(ropePoints({ ...base, t: 0.3 }));
    expect(px.some((p) => p.ink === 0)).toBe(true);
    expect(px.some((p) => p.ink > 0)).toBe(true);
    const keys = new Set(px.map((p) => `${p.x},${p.y}`));
    expect(keys.size).toBe(px.length);
  });

  it("鞭の絵は縄の色と出る所を持ち、他の武器は持たない", () => {
    expect(weaponRope("wpnWhip")?.colors.length).toBe(3);
    expect(weaponRope("wpnSword")).toBeNull();
  });
});
