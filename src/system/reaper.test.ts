import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../core/loop";
import { REAPER } from "../data/tuning";
import { reaperAppearAfter, reaperTimeLeft, reaperWarning, updateReaper } from "./reaper";
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

describe("Reaper 出現猶予", () => {
  it("部屋数が多いフロアほど出現猶予が長い（treasure/shrine は数えない）", () => {
    const state = arena();
    const base = REAPER.appearAfter + state.rooms.length * REAPER.appearPerRoom;
    expect(reaperAppearAfter(state)).toBe(base);

    // treasure/shrine を混ぜても、それらは猶予の計算に含まれない
    state.rooms = [
      ...state.rooms,
      { ...state.rooms[0]!, kind: "treasure" },
      { ...state.rooms[0]!, kind: "shrine" },
    ];
    expect(reaperAppearAfter(state)).toBe(base);
  });

  it("警告は出現の warnMargin 秒前から出る", () => {
    const state = arena();
    const appearAt = reaperAppearAfter(state);
    state.floorTime = appearAt - REAPER.warnMargin - 1;
    expect(reaperWarning(state)).toBe(false);
    state.floorTime = appearAt - REAPER.warnMargin;
    expect(reaperWarning(state)).toBe(true);
    expect(reaperTimeLeft(state)).toBeCloseTo(REAPER.warnMargin);
  });

  it("出現済みなら警告は出さない", () => {
    const state = arena();
    state.floorTime = reaperAppearAfter(state);
    updateReaper(state, FIXED_DT);
    expect(state.reaper).not.toBeNull();
    expect(reaperWarning(state)).toBe(false);
  });

  it("追跡速度は旧仕様（28）の 85% になっている", () => {
    expect(REAPER.speed).toBeCloseTo(28 * 0.85);
  });
});
