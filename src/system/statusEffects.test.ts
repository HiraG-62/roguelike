import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { createStatusBag, type StatusBag } from "../core/status";
import { applyStatus, hasStatus, statusStacks } from "./statusEffects";

function bagWith(effects: StatusBag["effects"]): StatusBag {
  return { ...createStatusBag(), effects };
}

describe("状態異常の口（段階 0）", () => {
  it("hasStatus / statusStacks は残り時間のある効果だけを見る", () => {
    const bag = bagWith([
      { kind: "poison", stacks: 3, time: 2, maxTime: 5, potency: 0, source: "enemy", acc: 0, tick: 0 },
      { kind: "burn", stacks: 1, time: 0, maxTime: 3, potency: 4, source: "player", acc: 0, tick: 0 },
    ]);
    expect(hasStatus(bag, "poison")).toBe(true);
    expect(statusStacks(bag, "poison")).toBe(3);
    expect(hasStatus(bag, "burn"), "残り 0 秒は付いていない扱い").toBe(false);
    expect(statusStacks(bag, "burn")).toBe(0);
    expect(hasStatus(bag, "stagger")).toBe(false);
  });

  it("新しい敵とプレイヤーは空の StatusBag を持つ", () => {
    const state = createGame(1);
    expect(state.player.status).toEqual(createStatusBag());
    for (const e of state.enemies) {
      expect(e.status, `敵 ${e.id} の StatusBag`).toEqual(createStatusBag());
      expect(e.poise.damage, `敵 ${e.id} の怯み蓄積`).toBe(0);
    }
  });

  it("applyStatus は段階 0 では何もせず false", () => {
    const state = createGame(1);
    const applied = applyStatus(state, { kind: "player" }, { kind: "weaken", stacks: 1, duration: 4, potency: 0 }, "enemy");
    expect(applied).toBe(false);
    expect(state.player.status.effects).toHaveLength(0);
  });
});
