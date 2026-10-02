import { afterEach, describe, expect, it, vi } from "vitest";
// system の循環参照は core/game を先に読むと解ける（他の描画のテストと同じ順）
import "../core/game";
import { STAIRS_DOTS, STAIRS_ROLES, STAIRS_SPRITES } from "../data/sprites/stairs";
import { FLOOR_KINDS } from "../system/biomes";
import { roleColor } from "./mapDecor";
import { mapThemeFor, townTheme } from "./mapTheme";
import type { MapStyle, MapTheme } from "./mapTypes";
import { stairsPixels, stairsStyleOf } from "./stairsArt";

afterEach(() => {
  vi.restoreAllMocks();
});

const ALPHA_SHIFT = 24;
const OPAQUE = 0xff;

/** 様式ごとに 1 つのテーマ */
const BY_STYLE: readonly [Exclude<MapStyle, "town">, MapTheme][] = [
  ["moss", mapThemeFor(3, "cave")],
  ["temple", mapThemeFor(7, "rooms")],
  ["castleFire", mapThemeFor(12, "forge")],
  ["castleFrost", mapThemeFor(13, "glacier")],
  ["deep", mapThemeFor(17, "cave")],
  ["final", mapThemeFor(21, "rooms")],
];

function mask(px: Uint32Array): string {
  return Array.from(px, (c) => (c === 0 ? "0" : "1")).join("");
}

describe("stairsArt: 階段の絵の塗り", () => {
  it("表のテーマはそれぞれの様式になっている（前提）", () => {
    for (const [style, theme] of BY_STYLE) expect(theme.style, style).toBe(style);
  });

  it("迷宮の全様式で 1 マス分の画素ができ、塗った画素はすべて不透明", () => {
    for (const [style, theme] of BY_STYLE) {
      const px = stairsPixels(theme);
      expect(px, `${style} の画素`).not.toBeNull();
      if (!px) continue;
      expect(px.length, style).toBe(STAIRS_DOTS * STAIRS_DOTS);
      const painted = Array.from(px).filter((c) => c !== 0);
      expect(painted.length, `${style} の塗った画素`).toBeGreaterThan(STAIRS_DOTS * STAIRS_DOTS * 0.4);
      for (const c of painted) expect(c >>> ALPHA_SHIFT, `${style} の不透明`).toBe(OPAQUE);
    }
  });

  it("深度 1〜40 × 9 バイオームのどのテーマでも絵ができる（深みの変異の配色も）", () => {
    for (let depth = 1; depth <= 40; depth++) {
      for (const kind of FLOOR_KINDS) expect(stairsPixels(mapThemeFor(depth, kind)), `深度 ${depth} ${kind}`).not.toBeNull();
    }
  });

  it("同じテーマなら何度塗っても同じ画素（Math.random を使わない）", () => {
    const random = vi.spyOn(Math, "random");
    for (const [style, theme] of BY_STYLE) {
      expect(stairsPixels(theme), style).toEqual(stairsPixels(theme));
    }
    expect(random, "乱数を引かない").not.toHaveBeenCalled();
  });

  it("画素の色は役の文字をテーマの配色で引いた色（段の底の z は奥の闇の最暗）", () => {
    for (const [style, theme] of BY_STYLE) {
      const px = stairsPixels(theme);
      const key = stairsStyleOf(theme.style);
      if (!px || !key) continue;
      const rows = STAIRS_SPRITES[key].rows;
      rows.forEach((row, y) => {
        [...row].forEach((ch, x) => {
          if (ch !== "z") return;
          expect(px[y * STAIRS_DOTS + x], `${style} の (${x},${y})`).toBe(roleColor(theme.palette, STAIRS_ROLES.z));
          expect(px[y * STAIRS_DOTS + x]).toBe(theme.palette.vD);
        });
      });
    }
  });

  it("章ごとに違う絵で、廃城の炎と霜は同じ形を配色だけ変える", () => {
    const masks = new Map(BY_STYLE.map(([style, theme]) => [style, mask(stairsPixels(theme) ?? new Uint32Array())]));
    const unique = new Set([...masks.entries()].filter(([s]) => s !== "castleFrost").map(([, m]) => m));
    expect(unique.size, "苔・寺院・廃城・異界・最深の間で形が違う").toBe(5);
    expect(masks.get("castleFrost"), "炎と霜は同じ形").toBe(masks.get("castleFire"));
    const fire = stairsPixels(mapThemeFor(12, "forge"));
    const frost = stairsPixels(mapThemeFor(13, "glacier"));
    expect(fire, "炎と霜は色が違う").not.toEqual(frost);
  });

  it("拠点（門前町）は章の絵を持たず、今の絵のまま", () => {
    expect(stairsStyleOf("town")).toBeNull();
    expect(stairsPixels(townTheme())).toBeNull();
  });
});
