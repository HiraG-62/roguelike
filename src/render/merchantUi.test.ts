import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { ECONOMY } from "../data/tuning";
import { withBaseAreaMul } from "../system/floor";
import { nearestStallSpot, wareLabelColor } from "./merchantUi";

/** 商人の名札・台座（render/merchantUi.ts） */
describe("商人の台座の描画", () => {
  it("いちばん近い未使用の台座だけを選び、使った台座と遠い台座は選ばない", () => {
    const state = withBaseAreaMul(() => createGame(3));
    const m = state.economy.merchants[0];
    const second = m?.wares[1];
    if (!m || !second) throw new Error("市が立たない");
    state.player.body.pos = { ...second.pos };
    expect(nearestStallSpot(state, m.wares), "真上の台座").toBe(second);
    second.used = true;
    expect(nearestStallSpot(state, m.wares), "使った台座は選ばない").not.toBe(second);
    state.player.body.pos = { x: -1e4, y: -1e4 };
    expect(nearestStallSpot(state, m.wares), "遠い").toBeNull();
  });

  it("品札は払えるなら商人の色、払えなければ暗い色", () => {
    const state = createGame(3);
    state.economy.coins = 40;
    expect(wareLabelColor(state, 40)).toBe(ECONOMY.market.color);
    expect(wareLabelColor(state, 41)).not.toBe(ECONOMY.market.color);
  });
});
