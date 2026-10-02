import { describe, expect, it } from "vitest";
import { INK_DOTS, INK_LAYER, InkSurface, bayer, dotHash, rgbOf } from "./inkSurface";

const BLACK = rgbOf("#000000");
const WHITE = rgbOf("#ffffff");

function surface(): InkSurface {
  return new InkSurface(64, 32);
}

function layerAndAlpha(s: InkSurface, x: number, y: number): { layer: number; alpha: number } {
  return { layer: s.layerAt(x, y), alpha: (s.px[y * s.w + x] ?? 0) >>> 24 };
}

describe("座標ハッシュ", () => {
  it("同じ座標と種なら同じ値で、0 以上 1 未満", () => {
    for (let i = -20; i < 20; i++) {
      const v = dotHash(i, i * 7 - 3, 11);
      expect(v).toBe(dotHash(i, i * 7 - 3, 11));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(dotHash(1, 2, 3)).not.toBe(dotHash(2, 1, 3));
  });

  it("順序ディザの閾は 4x4 で 16 通りすべてを 1 回ずつ取り、負の座標でも周期が続く", () => {
    const seen = new Set<number>();
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) seen.add(bayer(x, y));
    expect(seen.size).toBe(16);
    expect(bayer(-4, -8)).toBe(bayer(0, 0));
    expect(bayer(-1, 5)).toBe(bayer(3, 1));
  });
});

describe("作業面の層の重なり", () => {
  it("上の層は後からでも先でも上に残り、下の層は上の層を上書きしない", () => {
    const s = surface();
    s.put(3, 3, INK_LAYER.ink, 7, BLACK, 1);
    s.put(3, 3, INK_LAYER.sketch, 2, WHITE, 0.9);
    expect(s.layerAt(3, 3), "墨の上に下絵は置かない").toBe(INK_LAYER.ink);
    s.put(4, 3, INK_LAYER.sketch, 2, WHITE, 0.9);
    s.put(4, 3, INK_LAYER.ink, 7, BLACK, 1);
    expect(s.layerAt(4, 3), "下絵の上に墨を置く").toBe(INK_LAYER.ink);
  });

  it("同じ層は段の高い方が残る（淡い縁が他の線の黒い芯を上書きしない）", () => {
    const s = surface();
    s.put(5, 5, INK_LAYER.ink, 7, BLACK, 1);
    s.put(5, 5, INK_LAYER.ink, 1, WHITE, 1);
    expect(s.px[5 * s.w + 5]).toBe((BLACK | (255 << 24)) >>> 0);
  });

  it("胡粉の滲みは墨のドットに掛からない", () => {
    const s = surface();
    s.put(6, 6, INK_LAYER.ink, 1, BLACK, 1);
    s.put(6, 6, INK_LAYER.halo, 1, WHITE, 0.3);
    expect(s.layerAt(6, 6)).toBe(INK_LAYER.ink);
  });

  it("半透明の上の層は下の層に重なって不透明度が増す", () => {
    const s = surface();
    s.put(7, 7, INK_LAYER.fill, 5, BLACK, 0.5);
    const before = layerAndAlpha(s, 7, 7).alpha;
    s.put(7, 7, INK_LAYER.halo, 1, WHITE, 0.5);
    const after = layerAndAlpha(s, 7, 7);
    expect(after.layer).toBe(INK_LAYER.halo);
    expect(after.alpha).toBeGreaterThan(before);
  });

  it("作業面の外へは置かない", () => {
    const s = surface();
    s.put(-1, 0, INK_LAYER.ink, 7, BLACK, 1);
    s.put(0, s.h, INK_LAYER.ink, 7, BLACK, 1);
    expect(s.dirty).toBe(false);
  });
});

describe("作業面の抜きと画面への置き", () => {
  it("円で抜くと中のドットが空になり、外は残る", () => {
    const s = surface();
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) s.put(x, y, INK_LAYER.ink, 7, BLACK, 1);
    s.cutCircle(16, 8, 3);
    expect(s.layerAt(32, 16), "中心").toBe(0);
    expect(s.layerAt(32 + 3 * INK_DOTS + 2, 16), "円の外").toBe(INK_LAYER.ink);
  });

  it("汚れた矩形は置いたドットを囲み、置いた後は空に戻る", () => {
    const s = surface();
    s.recordColors = new Set();
    s.put(10, 4, INK_LAYER.ink, 7, BLACK, 1);
    s.put(20, 9, INK_LAYER.mark, 4, WHITE, 1);
    expect(s.dirtyRect()).toEqual([10, 4, 20, 9]);
    s.flush({} as CanvasRenderingContext2D);
    expect(s.dirty).toBe(false);
    expect(s.px.every((v) => v === 0)).toBe(true);
    expect([...s.recordColors]).toEqual(expect.arrayContaining(["#000000", "#ffffff"]));
  });

  it("ctx の平行移動を読み、ワールド座標を作業面のドットへ写す", () => {
    const s = surface();
    const ctx = { getTransform: () => ({ e: 4 * 12, f: 4 * -5 }) } as unknown as CanvasRenderingContext2D;
    s.begin(ctx);
    expect(s.ox).toBe(12);
    expect(s.oy).toBe(-5);
    expect(s.dotX(3)).toBe((3 + 12) * INK_DOTS);
    expect(s.worldX(s.dotX(3))).toBe(3 * INK_DOTS);
  });
});
