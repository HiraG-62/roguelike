import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RENDER_SCALE } from "../core/view";
import { TITLE_LOGO_DOTS, TITLE_LOGO_ROWS } from "../data/sprites/titleLogo";
import { drawTitleLogo, shinePosition } from "./titleLogo";

/** 題字の塗りのテスト。Canvas は fillRect を記録する偽物 */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FakeCanvas {
  width: number;
  height: number;
  rects: Rect[];
  transformScale: number;
  getContext: () => CanvasRenderingContext2D;
  drawImage: () => void;
}

function fakeCanvas(): FakeCanvas {
  const rects: Rect[] = [];
  const canvas: FakeCanvas = { width: 0, height: 0, rects, transformScale: 1, getContext: () => ctx, drawImage: () => {} };
  const ctx = {
    fillStyle: "",
    imageSmoothingEnabled: true,
    setTransform: (a: number) => {
      canvas.transformScale = a;
    },
    fillRect: (x: number, y: number, w: number, h: number) => {
      rects.push({ x, y, w, h });
    },
    drawImage: () => {},
  } as unknown as CanvasRenderingContext2D;
  return canvas;
}

/** 論理の寸法は旧版（40px・密度 1）の 71x34 から大きく変えない */
const OLD_LOGICAL_W = 71;
const OLD_LOGICAL_H = 34;
const LOGICAL_TOLERANCE = 3;
/** 光の筋が走っている時刻（周期の先頭から 0.5 秒）と、走っていない時刻 */
const SHINE_ON_TIME = -1000 + 0.5;
const SHINE_OFF_TIME = -1000 + 3;

describe("題字のマスク", () => {
  it("全ての行が同じ長さで、墨（#）と紙（.）だけでできている", () => {
    const w = TITLE_LOGO_ROWS[0]?.length ?? 0;
    expect(w, "幅が 0").toBeGreaterThan(0);
    for (const row of TITLE_LOGO_ROWS) {
      expect(row.length, "行の長さが揃っていない").toBe(w);
      expect(row, "# と . 以外の文字").toMatch(/^[#.]+$/);
    }
  });

  it("密度は 2 で、論理の大きさは旧版（71x34）とほぼ同じ", () => {
    expect(TITLE_LOGO_DOTS, "密度").toBe(2);
    const w = (TITLE_LOGO_ROWS[0]?.length ?? 0) / TITLE_LOGO_DOTS;
    const h = TITLE_LOGO_ROWS.length / TITLE_LOGO_DOTS;
    expect(Math.abs(w - OLD_LOGICAL_W), "論理の幅").toBeLessThanOrEqual(LOGICAL_TOLERANCE);
    expect(Math.abs(h - OLD_LOGICAL_H), "論理の高さ").toBeLessThanOrEqual(LOGICAL_TOLERANCE);
  });
});

describe("題字の塗り", () => {
  let created: FakeCanvas[];

  beforeEach(() => {
    created = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const c = fakeCanvas();
        created.push(c);
        return c;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("焼く canvas の 1 点は整数画素（RENDER_SCALE / 密度）で、塗る矩形は点の整数座標", () => {
    const target = fakeCanvas();
    drawTitleLogo(target.getContext(), 240, 12, SHINE_OFF_TIME);
    const baked = created[0];
    expect(baked, "焼いた canvas がない").toBeDefined();
    if (!baked) return;
    expect(baked.transformScale, "1 点の画素数").toBe(RENDER_SCALE / TITLE_LOGO_DOTS);
    expect(Number.isInteger(baked.transformScale), "整数でない").toBe(true);
    expect(baked.rects.length, "矩形がない").toBeGreaterThan(0);
    const fractional = baked.rects.filter((r) => ![r.x, r.y, r.w, r.h].every(Number.isInteger));
    expect(fractional.length, "点の格子に乗らない矩形").toBe(0);
  });

  it("2 回目以降は焼き直さない", () => {
    const target = fakeCanvas();
    drawTitleLogo(target.getContext(), 240, 12, SHINE_OFF_TIME);
    const before = created.length;
    drawTitleLogo(target.getContext(), 240, 12, SHINE_OFF_TIME);
    expect(created.length, "canvas が増えた").toBe(before);
  });

  it("外接矩形は論理寸法で、横は中央に置き 1 点の格子に乗る", () => {
    const target = fakeCanvas();
    const box = drawTitleLogo(target.getContext(), 240, 12, SHINE_OFF_TIME);
    expect(box.w, "論理の幅").toBe((TITLE_LOGO_ROWS[0]?.length ?? 0) / TITLE_LOGO_DOTS);
    expect(box.h, "論理の高さ").toBe(TITLE_LOGO_ROWS.length / TITLE_LOGO_DOTS);
    expect(Math.abs(box.x + box.w / 2 - 240), "中央からのずれ").toBeLessThanOrEqual(1 / TITLE_LOGO_DOTS);
    expect((box.x * TITLE_LOGO_DOTS) % 1, "格子に乗っていない").toBe(0);
    expect(box.y, "上端").toBe(12);
  });

  it("光の筋は周期の最初の間だけ走り、走る間は 1 点の矩形で重ねる", () => {
    expect(shinePosition(SHINE_OFF_TIME), "走っていない間").toBeNull();
    expect(shinePosition(SHINE_ON_TIME), "走っている間").not.toBeNull();
    const target = fakeCanvas();
    drawTitleLogo(target.getContext(), 240, 12, SHINE_ON_TIME);
    expect(target.rects.length, "筋の矩形がない").toBeGreaterThan(0);
    const step = 1 / TITLE_LOGO_DOTS;
    expect(target.rects.every((r) => r.w === step && r.h === step), "筋の矩形の大きさが 1 点ではない").toBe(true);
  });
});
