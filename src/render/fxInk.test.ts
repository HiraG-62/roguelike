import { describe, expect, it } from "vitest";
import { inkify, type InkFrame } from "../../scripts/fx/ink.mjs";

/** 墨の筆致の仕上げ（scripts/fx/ink.mjs。docs/ideas/fx-sprites.md 3.5）の検査 */

const SIZE = 96;
const SEED = 1234;
/** 帯の段（本体） */
const BODY = 5;

function makeFrame(): InkFrame & { grid: Uint8Array } {
  const grid = new Uint8Array(SIZE * SIZE);
  return {
    w: SIZE,
    h: SIZE,
    cx: SIZE / 2,
    cy: SIZE / 2,
    grid,
    set(ix, iy, level) {
      if (ix < 0 || iy < 0 || ix >= SIZE || iy >= SIZE) return;
      grid[iy * SIZE + ix] = level;
    },
  };
}

/** 横向きの帯（y0 から thick 行）を塗る */
function band(frame: InkFrame, y0: number, thick: number, level = BODY): void {
  for (let y = y0; y < y0 + thick; y++) for (let x = 16; x < SIZE - 16; x++) frame.set(x, y, level);
}

describe("墨の筆致の仕上げ", () => {
  it("細い線は触らない（速度線・火花を今のまま残す）", () => {
    const frame = makeFrame();
    band(frame, 40, 2);
    const before = frame.grid.slice();
    inkify(frame, SEED, 1);
    expect([...frame.grid]).toEqual([...before]);
  });

  it("太い線は縁が暗くなり、内側に掠れの隙間が開く", () => {
    const frame = makeFrame();
    band(frame, 30, 20);
    const before = frame.grid.slice();
    inkify(frame, SEED, 1);
    let rim = 0;
    let gaps = 0;
    for (let i = 0; i < before.length; i++) {
      if (!before[i]) continue;
      const after = frame.grid[i] ?? 0;
      if (after === 1) rim++;
      if (after === 0) gaps++;
    }
    expect(rim).toBeGreaterThan(0);
    expect(gaps).toBeGreaterThan(0);
    // 掠れは一部だけ。線の大半は残る
    const kept = before.reduce((n, v, i) => n + (v && frame.grid[i] ? 1 : 0), 0);
    const total = before.reduce((n, v) => n + (v ? 1 : 0), 0);
    expect(kept / total).toBeGreaterThan(0.7);
  });

  it("段は元より明るくならない（芯の白を勝手に足さない）", () => {
    const frame = makeFrame();
    band(frame, 30, 20);
    inkify(frame, SEED, 1);
    expect(Math.max(...frame.grid)).toBeLessThanOrEqual(BODY);
  });

  it("同じ入力と種なら同じ絵になる（決定的）", () => {
    const a = makeFrame();
    const b = makeFrame();
    band(a, 30, 20);
    band(b, 30, 20);
    inkify(a, SEED, 7);
    inkify(b, SEED, 7);
    expect([...a.grid]).toEqual([...b.grid]);
  });

  it("線の内側の毛筋はフレームの種で変わらない（コマごとにちらつかない）", () => {
    const a = makeFrame();
    const b = makeFrame();
    band(a, 30, 20);
    band(b, 30, 20);
    inkify(a, SEED, 1);
    inkify(b, SEED, 2);
    // 縁から 3 ドット以上内側（縁の齧り・毛羽はフレームで変わってよい）
    for (let y = 33; y < 47; y++) {
      for (let x = 19; x < SIZE - 19; x++) expect(a.grid[y * SIZE + x]).toBe(b.grid[y * SIZE + x]);
    }
  });
});
