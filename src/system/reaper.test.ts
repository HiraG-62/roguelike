import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../core/loop";
import { REAPER } from "../data/tuning";
import { updateReaper } from "./reaper";
import { arena } from "./testHelpers";

describe("Reaper", () => {
  it("無敵中に接触しても JUST 回避（スロー・ゲージ・演出）を発生させず、単に無視する", () => {
    const state = arena();
    state.reaper = { pos: { ...state.player.body.pos }, radius: REAPER.radius, animTime: 0 };
    state.player.invulnTimer = 1;
    state.player.dashTimer = 1;
    state.player.dodgedThisDash = false;
    const hpBefore = state.player.hp;
    const energyBefore = state.player.energy;

    updateReaper(state, FIXED_DT);

    expect(state.player.hp).toBe(hpBefore);
    expect(state.player.energy).toBe(energyBefore);
    expect(state.slowmo).toBe(0);
    expect(state.player.dodgedThisDash).toBe(false);
    expect(state.texts.some((t) => t.text === "JUST!")).toBe(false);
  });

  it("無敵でなければ通常通りダメージを受ける", () => {
    const state = arena();
    state.reaper = { pos: { ...state.player.body.pos }, radius: REAPER.radius, animTime: 0 };
    state.player.invulnTimer = 0;
    const hpBefore = state.player.hp;

    updateReaper(state, FIXED_DT);

    expect(state.player.hp).toBeLessThan(hpBefore);
  });
});
