import { describe, expect, it } from "vitest";
import { FEEL } from "../data/tuning";
import { arena } from "./testHelpers";
import { cameraKick, updateCamera } from "./camera";

const VIEW_W = 480;
const VIEW_H = 270;

describe("カメラのキック（docs/ideas/combat-feel-design.md D-3）", () => {
  it("キックは攻撃方向へ offset を動かし減衰で 0 に戻る", () => {
    const state = arena();
    cameraKick(state, { x: 1, y: 0 }, FEEL.kickHeavy);
    updateCamera(state, 0, VIEW_W, VIEW_H);
    expect(state.camera.offset.x).toBeGreaterThan(0);

    for (let i = 0; i < 200; i++) updateCamera(state, 1 / 60, VIEW_W, VIEW_H);
    expect(Math.abs(state.camera.offset.x)).toBeLessThan(0.01);
  });

  it("0 ベクトルの方向では何も起きない", () => {
    const state = arena();
    cameraKick(state, { x: 0, y: 0 }, FEEL.kickHeavy);
    expect(state.camera.kick).toEqual({ x: 0, y: 0 });
  });

  it("揺れの間に state.rng の次の値が変わらない（fxRandom は演出専用の乱数を使う）", () => {
    const a = arena();
    const b = arena();
    a.camera.shake = 5;
    updateCamera(a, 1 / 60, VIEW_W, VIEW_H);
    expect(a.rng.next()).toBe(b.rng.next());
  });
});
