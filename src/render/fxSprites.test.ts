/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FX_ATLASES, FX_SHEETS, type FxAtlasKey, type FxSheetKey } from "../data/fxSheets.gen";
import { MOVESETS } from "../data/weapons";
import { FX_RAMP_KEYS, cellOf, fitScale, lifeFrame, pickDir, rampColors, snapArt, swingFrame } from "./fxSprites";
import { MOVESET_FX, motionKey, rampOfElement } from "./fxMotions";
import { ELEMENTS } from "../core/element";

const SHEET_KEYS = Object.keys(FX_SHEETS) as FxSheetKey[];
const RECT_STRIDE = 6;

/** PNG の IHDR から寸法を読む */
function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("fxSprites: 方向の選び方", () => {
  it("24 方向で最寄りの方向を選ぶ", () => {
    expect(pickDir(0, 24, false)).toEqual({ dir: 0, flip: false });
    expect(pickDir(Math.PI / 2, 24, false)).toEqual({ dir: 6, flip: false });
    expect(pickDir(-Math.PI / 2, 24, false)).toEqual({ dir: 18, flip: false });
    expect(pickDir((7 * Math.PI) / 180, 24, false).dir).toBe(0);
    expect(pickDir((8 * Math.PI) / 180, 24, false).dir).toBe(1);
  });

  it("反時計回りは −θ の方向を上下反転で引く", () => {
    expect(pickDir(Math.PI / 6, 24, true)).toEqual({ dir: 22, flip: true });
    expect(pickDir(0, 24, true)).toEqual({ dir: 0, flip: true });
  });

  it("向きのないシートは常に方向 0", () => {
    expect(pickDir(2.3, 1, false)).toEqual({ dir: 0, flip: false });
    expect(pickDir(2.3, 1, true)).toEqual({ dir: 0, flip: true });
  });
});

describe("fxSprites: 時間の割り付け", () => {
  const sheet = { frames: 8, active: 4 };

  it("active の進みで前半のフレームを流す", () => {
    expect(swingFrame(sheet, "active", 0, 0, 0.2)).toBe(0);
    expect(swingFrame(sheet, "active", 0.5, 0, 0.2)).toBe(2);
    expect(swingFrame(sheet, "active", 1, 0, 0.2)).toBe(3);
  });

  it("recover の経過で後半のフレームを流し、流し切ったら描かない", () => {
    expect(swingFrame(sheet, "recover", 1, 0, 0.2)).toBe(4);
    expect(swingFrame(sheet, "recover", 1, 0.19, 0.2)).toBe(7);
    expect(swingFrame(sheet, "recover", 1, 0.2, 0.2)).toBeNull();
  });

  it("寿命で流すフレームは寿命を過ぎたら描かない", () => {
    expect(lifeFrame(6, 0, 0.18)).toBe(0);
    expect(lifeFrame(6, 0.17, 0.18)).toBe(5);
    expect(lifeFrame(6, 0.18, 0.18)).toBeNull();
  });

  it("大きさの差が許容内なら拡縮しない", () => {
    expect(fitScale(17, 16, 0.15)).toBe(1);
    expect(fitScale(24, 16, 0.15)).toBe(1.5);
    expect(fitScale(0, 16, 0.15)).toBe(1);
  });

  it("置く位置は絵のドット（0.5px）の格子に揃う", () => {
    expect(snapArt(10.3)).toBe(10.5);
    expect(snapArt(10.2)).toBe(10);
  });
});

describe("fxSprites: 生成物と一覧の整合", () => {
  it("一覧のアトラスの寸法が PNG と一致する", () => {
    for (const key of Object.keys(FX_ATLASES) as FxAtlasKey[]) {
      const atlas = FX_ATLASES[key];
      expect(pngSize(`public/${atlas.url}`), key).toEqual({ width: atlas.width, height: atlas.height });
    }
  });

  it("すべてのフレームの矩形がアトラスに収まり、方向ごとに描かれたフレームがある", () => {
    for (const key of SHEET_KEYS) {
      const sheet = FX_SHEETS[key];
      const atlas = FX_ATLASES[sheet.atlas];
      expect(sheet.rects.length, key).toBe(sheet.dirs * sheet.frames * RECT_STRIDE);
      expect(sheet.active, key).toBeLessThanOrEqual(sheet.frames);
      for (let d = 0; d < sheet.dirs; d++) {
        let drawn = 0;
        for (let f = 0; f < sheet.frames; f++) {
          const cell = cellOf(sheet, d, f);
          if (!cell) continue;
          drawn++;
          expect(cell.x + cell.w, key).toBeLessThanOrEqual(atlas.width);
          expect(cell.y + cell.h, key).toBeLessThanOrEqual(atlas.height);
        }
        expect(drawn, `${key} 方向 ${d}`).toBeGreaterThan(sheet.frames / 2);
      }
    }
  });

  it("配色はすべて 7 段で、属性ごとに配色がある", () => {
    for (const key of FX_RAMP_KEYS) expect(rampColors(key), key).toHaveLength(7);
    for (const element of ELEMENTS) expect(FX_RAMP_KEYS).toContain(rampOfElement(element));
  });
});

describe("fxMotions: 武器種のモーションの表", () => {
  it("剣の全モーション（左の段・ダッシュ・右の振り・派生）に専用のシートがある", () => {
    const sword = MOVESETS.sword;
    const fx = MOVESET_FX.sword;
    expect(fx).toBeDefined();
    const keys = [
      ...sword.steps.map((_, i) => motionKey(sword, { lane: "primary", step: i, branch: -1, dashStrike: false })),
      motionKey(sword, { lane: "primary", step: 0, branch: -1, dashStrike: true }),
      ...sword.steps2.flatMap((s, i) => (s.kind === "swing" ? [motionKey(sword, { lane: "secondary", step: i, branch: -1, dashStrike: false })] : [])),
      ...sword.branches.map((_, i) => motionKey(sword, { lane: "primary", step: 0, branch: i, dashStrike: false })),
    ];
    for (const key of keys) expect(fx?.motions[key], key).toBeDefined();
  });

  it("表のモーションの key は武器種の定義に実在する", () => {
    for (const [moveset, fx] of Object.entries(MOVESET_FX)) {
      const def = MOVESETS[moveset as keyof typeof MOVESETS];
      const real = new Set<string>(["dash", ...def.steps.map((_, i) => `l:${i}`), ...def.steps2.map((s, i) => `r:${s.key ?? i}`), ...def.branches.map((b) => `branch:${b.key}`)]);
      for (const key of Object.keys(fx?.motions ?? {})) expect(real.has(key), `${moveset} ${key}`).toBe(true);
    }
  });
});
