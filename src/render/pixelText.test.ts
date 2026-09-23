import { describe, expect, it } from "vitest";
import { PixelText, baselineOffset, isFullWidthChar, textSizesFor, type PixelTextEnv } from "./pixelText";

/** 1 文字の実測幅。全角は 16 付近、半角は 8 付近の小数を返して丸めを検証する */
function fakeWidth(ch: string): number {
  return isFullWidthChar(ch) ? 15.8 : 8.3;
}

interface DrawCall {
  image: unknown;
  x: number;
  y: number;
  w: number;
  h: number;
}

function fakeCtx(scale = 1, e = 0, f = 0) {
  const draws: DrawCall[] = [];
  const texts: string[] = [];
  const ctx = {
    font: "",
    fillStyle: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    imageSmoothingEnabled: true,
    measureText: (s: string) => ({ width: [...s].reduce((a, c) => a + fakeWidth(c), 0) }),
    fillText: (s: string) => texts.push(s),
    fillRect: () => {},
    drawImage: (image: unknown, x = 0, y = 0, w = 0, h = 0) => draws.push({ image, x, y, w, h }),
    getTransform: () => ({ a: scale, e, f }),
    save: () => {},
    restore: () => {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, draws, texts };
}

function makeEnv(ready = true) {
  let created = 0;
  let resolveLoad: () => void = () => {};
  const env: PixelTextEnv = {
    createCanvas(width, height) {
      created++;
      return { width, height, getContext: () => fakeCtx().ctx } as unknown as HTMLCanvasElement;
    },
    isFontReady: () => ready,
    loadFont: () => new Promise<void>((r) => (resolveLoad = r)),
  };
  return { env, created: () => created, resolveLoad: () => resolveLoad() };
}

describe("PixelText advance", () => {
  it("measureText の実測を丸め、半角 8・全角 16 になる", () => {
    const pt = new PixelText(makeEnv().env);
    expect(pt.dotWidth("A")).toBe(8);
    expect(pt.dotWidth("あ")).toBe(16);
    expect(pt.dotWidth("HPあ")).toBe(32);
  });

  it("width は advance × m / scale", () => {
    const pt = new PixelText(makeEnv().env);
    expect(pt.width("ab", 2, 4)).toBe(8);
    expect(pt.width("剣", 3, 3)).toBe(16);
  });
});

describe("PixelText sizeFor", () => {
  it("論理 px 以上になる最小の整数倍率を返す", () => {
    const pt = new PixelText(makeEnv().env);
    expect(pt.sizeFor(8, 3)).toBe(2); // 1.5 → 2（10.7 論理 px）
    expect(pt.sizeFor(16, 3)).toBe(3); // ちょうど 3
    expect(pt.sizeFor(5, 3)).toBe(1);
    expect(pt.sizeFor(1, 1)).toBe(1); // 下限 1
    expect(pt.sizeFor(16 / 3, 3)).toBe(1); // 浮動小数誤差で 2 にならない
  });

  it("scale 省略時は draw で観測した transform を使う", () => {
    const pt = new PixelText(makeEnv().env);
    pt.draw(fakeCtx(4).ctx, "a", 0, 0, { m: 1, color: "#fff" });
    expect(pt.sizeFor(8)).toBe(2);
  });
});

describe("PixelText wrap", () => {
  const pt = new PixelText(makeEnv().env);

  it("日本語は 1 文字単位で折り返す", () => {
    // scale 1, m 1 → 全角 16 論理 px。幅 48 に 3 文字
    expect(pt.wrap("あいうえお", 48, 1, 1)).toEqual(["あいう", "えお"]);
  });

  it("英語は単語単位で折り返す", () => {
    // 半角 8 px。幅 80 = 10 文字
    expect(pt.wrap("fire bolt deals damage", 80, 1, 1)).toEqual(["fire bolt", "deals", "damage"]);
  });

  it("句読点を行頭に置かない", () => {
    expect(pt.wrap("あいう。えお", 48, 1, 1)).toEqual(["あいう。", "えお"]);
  });

  it("改行文字で強制改行する", () => {
    expect(pt.wrap("あ\nい", 1000, 1, 1)).toEqual(["あ", "い"]);
  });
});

describe("PixelText draw", () => {
  it("デバイスピクセルの整数位置・整数倍サイズで blit し、smoothing を戻す", () => {
    const pt = new PixelText(makeEnv().env);
    const { ctx, draws } = fakeCtx(3, 0.5, 0);
    pt.draw(ctx, "Aあ", 10.1, 5.05, { m: 2, color: "#f00" });
    expect(draws).toHaveLength(2);
    for (const d of draws) {
      expect(Number.isInteger(d.x * 3 + 0.5)).toBe(true);
      expect(Number.isInteger(Math.round(d.y * 3 * 1e9) / 1e9)).toBe(true);
    }
    expect((draws[0]?.w ?? 0) * 3).toBeCloseTo(16);
    expect((draws[1]?.w ?? 0) * 3).toBeCloseTo(32);
    expect((draws[0]?.h ?? 0) * 3).toBeCloseTo(32);
    expect(ctx.imageSmoothingEnabled).toBe(true);
  });

  it("align center / right で開始位置がずれる", () => {
    const pt = new PixelText(makeEnv().env);
    const c = fakeCtx(1);
    pt.draw(c.ctx, "ab", 100, 0, { m: 1, color: "#fff", align: "center" });
    expect(c.draws[0]?.x).toBe(92);
    const r = fakeCtx(1);
    pt.draw(r.ctx, "ab", 100, 0, { m: 1, color: "#fff", align: "right" });
    expect(r.draws[0]?.x).toBe(84);
  });

  it("同じ色・文字の着色グリフはキャッシュをヒットさせる", () => {
    const e = makeEnv();
    const pt = new PixelText(e.env);
    const { ctx } = fakeCtx(2);
    pt.draw(ctx, "ああい", 0, 0, { m: 1, color: "#fff" });
    expect(pt.tintedCacheSize()).toBe(2);
    const createdAfterFirst = e.created();
    pt.draw(ctx, "いあ", 0, 0, { m: 1, color: "#fff" });
    expect(pt.tintedCacheSize()).toBe(2);
    expect(e.created()).toBe(createdAfterFirst);
    pt.draw(ctx, "あ", 0, 0, { m: 1, color: "#0f0" });
    expect(pt.tintedCacheSize()).toBe(3);
  });

  it("空白は blit しないが advance は進める", () => {
    const pt = new PixelText(makeEnv().env);
    const { ctx, draws } = fakeCtx(1);
    pt.draw(ctx, "a b", 0, 0, { m: 1, color: "#fff" });
    expect(draws.map((d) => d.x)).toEqual([0, 16]);
  });
});

describe("PixelText フォント未ロード", () => {
  it("fillText でフォールバックし、ロード後にアトラス描画へ切り替わる", async () => {
    const e = makeEnv(false);
    const pt = new PixelText(e.env);
    const { ctx, draws, texts } = fakeCtx(2);
    pt.draw(ctx, "あい", 0, 0, { m: 1, color: "#fff" });
    expect(texts).toEqual(["あい"]);
    expect(draws).toHaveLength(0);
    expect(pt.width("aあ", 1, 1)).toBe(24); // 推定 advance

    e.resolveLoad();
    await Promise.resolve();
    await Promise.resolve();
    expect(pt.isReady()).toBe(true);
    pt.draw(ctx, "あい", 0, 0, { m: 1, color: "#fff" });
    expect(draws).toHaveLength(2);
  });
});

describe("UI 文字サイズ定数", () => {
  it("表示倍率 S が大きいほど各サイズの倍率は減らず、SMALL <= BODY <= TITLE <= BIG", () => {
    const pt = new PixelText(makeEnv().env);
    const scales = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8];
    let prev = textSizesFor(pt, scales[0] ?? 1);
    for (const s of scales) {
      const cur = textSizesFor(pt, s);
      expect(cur.SMALL).toBeGreaterThanOrEqual(prev.SMALL);
      expect(cur.BODY).toBeGreaterThanOrEqual(prev.BODY);
      expect(cur.TITLE).toBeGreaterThanOrEqual(prev.TITLE);
      expect(cur.BIG).toBeGreaterThanOrEqual(prev.BIG);
      expect(cur.SMALL).toBeLessThanOrEqual(cur.BODY);
      expect(cur.BODY).toBeLessThanOrEqual(cur.TITLE);
      expect(cur.TITLE).toBeLessThanOrEqual(cur.BIG);
      prev = cur;
    }
  });

  it("各サイズの行高は指定の論理 px 以上", () => {
    const pt = new PixelText(makeEnv().env);
    for (const s of [2, 3, 4]) {
      const sizes = textSizesFor(pt, s);
      expect(pt.lineHeight(sizes.SMALL, s)).toBeGreaterThanOrEqual(8);
      expect(pt.lineHeight(sizes.BIG, s)).toBeGreaterThanOrEqual(20);
    }
  });
});

describe("baseline 補正", () => {
  it("alphabetic は行上端から 14 ドット上、middle は半行、top は 0", () => {
    expect(baselineOffset("alphabetic", 2, 4)).toBe(7);
    expect(baselineOffset("middle", 2, 4)).toBe(4);
    expect(baselineOffset("bottom", 2, 4)).toBe(8);
    expect(baselineOffset("top", 2, 4)).toBe(0);
    expect(baselineOffset(undefined, 2, 4)).toBe(0);
  });

  it("draw の alphabetic は y をベースラインとして上端を補正する", () => {
    const pt = new PixelText(makeEnv().env);
    const { ctx, draws } = fakeCtx(1);
    pt.draw(ctx, "a", 0, 20, { m: 1, color: "#fff", baseline: "alphabetic" });
    expect(draws[0]?.y).toBe(6);
  });
});
