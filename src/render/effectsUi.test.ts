import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import type { GameState } from "../core/state";
import { FX_WAVE3 } from "../data/tuning";
import { LORD_PULL_APPEAR, LORD_PULL_VANISH, addMark, lordPullFx } from "../system/effects";
import { type FxSprites, drawAirMarks } from "./effectsUi";

/** Canvas と光のスプライトは呼び出しを数えるだけの偽物にする */
function fakeDraw(): { ctx: CanvasRenderingContext2D; fills: number; glows: number; sprites: FxSprites } {
  const counts = { fills: 0, glows: 0 };
  const target: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      if (prop === "fillRect") return () => void (counts.fills += 1);
      return () => undefined;
    },
    set(obj, prop, value) {
      obj[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const sprites: FxSprites = {
    enemy: () => undefined,
    player: () => undefined,
    glow: () => void (counts.glows += 1),
  };
  return {
    ctx,
    sprites,
    get fills() {
      return counts.fills;
    },
    get glows() {
      return counts.glows;
    },
  };
}

function pullState(): GameState {
  const state = createGame(7);
  lordPullFx(state, { x: 40, y: 40 }, { x: 200, y: 60 });
  return state;
}

describe("引き込みの描画（lordPull）", () => {
  it("消える渦・現れる渦のどの経過時間でも例外なく描け、粒と光を出す", () => {
    const c = FX_WAVE3.lordPull;
    for (const age of [0, c.delay * 0.5, c.delay, c.delay + c.life * 0.5, c.life * 0.99]) {
      const state = pullState();
      for (const m of state.effects?.marks ?? []) m.age = age;
      const draw = fakeDraw();
      expect(() => drawAirMarks(draw.ctx, state, draw.sprites), `経過 ${age}`).not.toThrow();
    }
    const state = pullState();
    const draw = fakeDraw();
    drawAirMarks(draw.ctx, state, draw.sprites);
    expect(draw.fills, "墨の粒を描く").toBeGreaterThan(0);
    expect(draw.glows, "章の色の光を描く").toBeGreaterThan(0);
  });

  it("現れる渦は、消える渦が始まってから遅れるまで何も描かない", () => {
    const state = createGame(7);
    addMark(state, "lordPull", { x: 100, y: 100 }, FX_WAVE3.lordPull.delay + FX_WAVE3.lordPull.life, "#ffffff", LORD_PULL_APPEAR);
    const draw = fakeDraw();
    drawAirMarks(draw.ctx, state, draw.sprites);
    expect(draw.fills + draw.glows, "遅れの間は空").toBe(0);
  });

  it("描いても state.rng と演出の乱数を消費しない（同じ入力で同じ描画）", () => {
    const state = pullState();
    const rng = state.rng.next.bind(state.rng);
    const before = state.effects?.seed;
    const probe = createGame(7);
    const draw = fakeDraw();
    drawAirMarks(draw.ctx, state, draw.sprites);
    expect(state.effects?.seed, "演出の乱数の状態が動かない").toBe(before);
    expect(rng(), "ゲームの乱数が動かない").toBe(probe.rng.next());
  });

  it("章ごとに色が変わり、章が足りなければ最後の色", () => {
    const colors = FX_WAVE3.lordPull.chapterColors;
    const colorAt = (depth: number): string | undefined => {
      const state = createGame(7);
      state.depth = depth;
      lordPullFx(state, { x: 0, y: 0 }, { x: 10, y: 0 });
      return state.effects?.marks.find((m) => m.value === LORD_PULL_VANISH)?.color;
    };
    expect(colorAt(5)).toBe(colors[0]);
    expect(colorAt(10)).toBe(colors[1]);
    expect(colorAt(20)).toBe(colors[colors.length - 1]);
    expect(colorAt(30), "深みでも最後の色").toBe(colors[colors.length - 1]);
  });
});
