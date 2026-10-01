import { describe, expect, it } from "vitest";
import { terrainCode } from "../core/terrain";
import {
  CELL_DOTS,
  MASK_COUNT,
  PIT_NONE,
  PIT_OTHER,
  PIT_SAME,
  QUAD_ALL,
  QUAD_BL,
  QUAD_BR,
  QUAD_TL,
  QUAD_TR,
  TEX_KINDS,
  VARIANT_COUNT,
  drawOf,
  shapeOf,
  terrainCellPixels,
  terrainVariantAt,
  texKindOfCode,
  vertexMasks,
} from "./terrainTex";

const ALPHA_SHIFT = 24;
const alphaOf = (c: number): number => c >>> ALPHA_SHIFT;

describe("terrainCellPixels（dual-grid の 1 枚）", () => {
  it("種類 × 16 形 × 4 変種の画素は何度作っても同じ（決定的）", () => {
    for (const kind of TEX_KINDS) {
      for (let mask = 0; mask < MASK_COUNT; mask++) {
        for (let variant = 0; variant < VARIANT_COUNT; variant++) {
          const a = terrainCellPixels(kind, mask, variant);
          const b = terrainCellPixels(kind, mask, variant);
          expect(a.length, `${kind} ${mask} ${variant}`).toBe(CELL_DOTS * CELL_DOTS);
          expect(Array.from(a), `${kind} 形${mask} 変種${variant}`).toEqual(Array.from(b));
        }
      }
    }
  });

  it("形 0 は全透明", () => {
    for (const kind of TEX_KINDS) {
      for (let variant = 0; variant < VARIANT_COUNT; variant++) {
        expect(terrainCellPixels(kind, 0, variant).every((c) => c === 0), `${kind} 変種${variant}`).toBe(true);
      }
    }
  });

  it("形 15 は全不透明", () => {
    for (const kind of TEX_KINDS) {
      for (let variant = 0; variant < VARIANT_COUNT; variant++) {
        const pixels = terrainCellPixels(kind, QUAD_ALL, variant);
        expect(pixels.every((c) => alphaOf(c) === 255), `${kind} 変種${variant}`).toBe(true);
      }
    }
  });

  it("途中の形は透明と不透明の両方を持つ", () => {
    for (const kind of TEX_KINDS) {
      for (let mask = 1; mask < QUAD_ALL; mask++) {
        const opaque = terrainCellPixels(kind, mask, 0).filter((c) => alphaOf(c) === 255).length;
        expect(opaque, `${kind} 形${mask}`).toBeGreaterThan(0);
        expect(opaque, `${kind} 形${mask}`).toBeLessThan(CELL_DOTS * CELL_DOTS);
      }
    }
  });

  it("描く象限を絞ると、その象限の外だけが透明になる（水の章の穴の象限は描かない）", () => {
    const half = CELL_DOTS / 2;
    const pixels = terrainCellPixels("water", QUAD_ALL, 0, QUAD_ALL & ~QUAD_BR);
    for (let v = 0; v < CELL_DOTS; v++) {
      for (let u = 0; u < CELL_DOTS; u++) {
        const inBr = u >= half && v >= half;
        const a = alphaOf(pixels[v * CELL_DOTS + u] ?? 0);
        expect(a === 0, `(${u},${v})`).toBe(inBr);
      }
    }
  });

  it("隣り合う枚の境目で形が繋がる（同じマスの内側の縁が一致する）", () => {
    // 左の枚（頂点 vx）の右端の列と、右の枚（頂点 vx+1）の左端の列は、どちらも同じマスの中心の線で、不透明かどうかが揃う
    for (const kind of TEX_KINDS) {
      for (let mask = 0; mask < MASK_COUNT; mask++) {
        const rightOfLeft = mask & (QUAD_TR | QUAD_BR);
        const leftOfRight = ((rightOfLeft & QUAD_TR ? QUAD_TL : 0) | (rightOfLeft & QUAD_BR ? QUAD_BL : 0)) | 0;
        const a = terrainCellPixels(kind, mask, 0);
        const b = terrainCellPixels(kind, leftOfRight | (leftOfRight << 1), 1);
        for (let v = 0; v < CELL_DOTS; v++) {
          const ra = alphaOf(a[v * CELL_DOTS + CELL_DOTS - 1] ?? 0) === 255;
          const lb = alphaOf(b[v * CELL_DOTS] ?? 0) === 255;
          // 右の枚は同じ 2 マスを左右とも持つ形（leftOfRight | leftOfRight << 1）なので、左端の列は左の枚の右端と同じマスを指す
          expect(lb, `${kind} 形${mask} 行${v}`).toBe(ra);
        }
      }
    }
  });
});

describe("vertexMasks（頂点を囲む 4 マスから形と描く象限を作る）", () => {
  const water = terrainCode("water");
  const lava = terrainCode("lava");
  const none = terrainCode("none");

  it("同じ地形のマスが形のビットになり、全部描く", () => {
    const packed = vertexMasks(water, [water, none, water, lava], [PIT_NONE, PIT_NONE, PIT_NONE, PIT_NONE]);
    expect(shapeOf(packed)).toBe(QUAD_TL | QUAD_BL);
    expect(drawOf(packed)).toBe(QUAD_TL | QUAD_BL);
  });

  it("水の章の穴は水と数える（形には入るが描かない）", () => {
    const packed = vertexMasks(water, [water, none, none, none], [PIT_NONE, PIT_SAME, PIT_SAME, PIT_NONE]);
    expect(shapeOf(packed), "穴の象限は水として形に入る").toBe(QUAD_TL | QUAD_TR | QUAD_BL);
    expect(drawOf(packed), "穴の象限は描かない").toBe(QUAD_TL);
  });

  it("穴の中の水で形が 15 になれば縁を作らない（全部不透明の形）", () => {
    const packed = vertexMasks(water, [water, none, none, water], [PIT_NONE, PIT_SAME, PIT_SAME, PIT_NONE]);
    expect(shapeOf(packed)).toBe(QUAD_ALL);
    expect(drawOf(packed)).toBe(QUAD_TL | QUAD_BR);
  });

  it("別の種類の穴は数えず描かない", () => {
    const packed = vertexMasks(water, [water, water, none, none], [PIT_NONE, PIT_OTHER, PIT_NONE, PIT_NONE]);
    expect(shapeOf(packed)).toBe(QUAD_TL);
    expect(drawOf(packed)).toBe(QUAD_TL);
  });
});

describe("terrainVariantAt / texKindOfCode", () => {
  it("変種は頂点の座標の偶奇で決まり 0..3 に収まる（64 ドット周期の模様の位相）", () => {
    const seen = new Set<number>();
    for (let vy = 0; vy < 4; vy++) {
      for (let vx = 0; vx < 4; vx++) seen.add(terrainVariantAt(vx, vy));
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
    expect(terrainVariantAt(0, 0)).toBe(terrainVariantAt(2, 4));
  });

  it("崩れる床・煙・地形なしは dual-grid で描かない", () => {
    expect(texKindOfCode(terrainCode("rubble"))).toBeUndefined();
    expect(texKindOfCode(terrainCode("smoke"))).toBeUndefined();
    expect(texKindOfCode(terrainCode("none"))).toBeUndefined();
    for (const kind of TEX_KINDS) expect(texKindOfCode(terrainCode(kind)), kind).toBe(kind);
  });
});
