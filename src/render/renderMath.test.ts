import { describe, expect, it } from "vitest";
import { createMap, setTile, Tile } from "../map/grid";
import { fitTooltip, floorVariant, pulse, tileHash, wallStyle } from "./renderMath";

describe("floorVariant", () => {
  it("決定的で範囲内", () => {
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const v = floorVariant(x, y, 6);
        expect(v).toBe(floorVariant(x, y, 6));
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(6);
      }
    }
  });

  it("全バリアントが出現する", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) seen.add(floorVariant(i % 20, Math.floor(i / 20), 6));
    expect(seen.size).toBe(6);
  });

  it("負の座標でも符号なし", () => {
    expect(tileHash(-3, -7)).toBeGreaterThanOrEqual(0);
  });
});

describe("wallStyle", () => {
  it("下が床なら face、横だけ床なら top、埋まっていれば none", () => {
    const map = createMap(5, 5);
    setTile(map, 2, 2, Tile.Floor);
    expect(wallStyle(map, 2, 1)).toBe("face");
    expect(wallStyle(map, 1, 2)).toBe("top");
    expect(wallStyle(map, 2, 3)).toBe("top");
    expect(wallStyle(map, 0, 0)).toBe("none");
  });
});

describe("pulse", () => {
  it("min..max に収まる", () => {
    for (let t = 0; t < 10; t += 0.37) {
      const v = pulse(t, 3, 0.2, 0.8);
      expect(v).toBeGreaterThanOrEqual(0.2);
      expect(v).toBeLessThanOrEqual(0.8);
    }
  });
});

describe("fitTooltip", () => {
  it("収まるなら通常行高で全行", () => {
    expect(fitTooltip(5, 8, 6, 12, 200, 4)).toEqual({ lineH: 8, small: false, shown: 5, height: 44 });
  });

  it("maxLines 超過なら小さい行高", () => {
    const fit = fitTooltip(14, 8, 6, 12, 200, 4);
    expect(fit.small).toBe(true);
    expect(fit.shown).toBe(14);
  });

  it("高さが足りなければ切り詰める", () => {
    const fit = fitTooltip(20, 8, 6, 12, 64, 4);
    expect(fit.shown).toBe(10);
    expect(fit.height).toBeLessThanOrEqual(64);
  });
});
