import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createGame } from "../core/game";
import { drawReforgeChoice } from "./reforgeUi";

/**
 * 改鋳の 3 択の描画のスモークテスト。Canvas は呼び出しを数えるだけの偽物にする（render/inventoryUi.test.ts と同じ形）。
 * 例外が出ないこと、文字を ctx.fillText で直接描いていない（pixelText 経由）こと、選択中でなければ何も描かないことを確かめる
 */

interface FakeCtx {
  ctx: CanvasRenderingContext2D;
  calls: Map<string, number>;
}

function fakeContext(): FakeCtx {
  const calls = new Map<string, number>();
  const target: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      if (prop === "measureText") return () => ({ width: 8 });
      if (prop === "getTransform") return () => ({ a: 1, d: 1, e: 0, f: 0 });
      if (prop === "getImageData") return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
      return (..._args: unknown[]) => {
        const name = String(prop);
        calls.set(name, (calls.get(name) ?? 0) + 1);
      };
    },
    set(obj, prop, value) {
      obj[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

beforeAll(() => {
  vi.stubGlobal("document", {
    createElement: () => ({ width: 0, height: 0, getContext: () => fakeContext().ctx }),
    fonts: { check: () => true, load: () => Promise.resolve([]) },
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("改鋳の 3 択の描画", () => {
  it("選択中でなければ何も描かない", () => {
    const state = createGame(1);
    const { ctx, calls } = fakeContext();
    drawReforgeChoice(ctx, state);
    expect(calls.size, "描画の呼び出し").toBe(0);
  });

  it("札を例外なく描き、fillText を直接使わない", () => {
    const state = createGame(1);
    state.reforgeChoice = { options: ["bladeRepel", "flurryHoard", "rodQuad"], hover: 1, timer: 1 };
    const { ctx, calls } = fakeContext();
    drawReforgeChoice(ctx, state);
    expect(calls.get("fillRect") ?? 0, "何かを描いている").toBeGreaterThan(0);
    expect(calls.get("fillText") ?? 0, "fillText は直接使わない").toBe(0);
  });
});
