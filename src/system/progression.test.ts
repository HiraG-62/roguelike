import { describe, expect, it } from "vitest";
import { createGame, getPlayer } from "../core/state";
import { gainXp, xpToNextLevel } from "./progression";

describe("gainXp", () => {
  it("必要量に届かなければレベルは変わらない", () => {
    const state = createGame(1);
    const player = getPlayer(state);
    gainXp(state, player, xpToNextLevel(1) - 1);
    expect(player.level).toBe(1);
  });

  it("必要量に達するとレベルアップし、余剰 XP は持ち越す", () => {
    const state = createGame(1);
    const player = getPlayer(state);
    const before = { ...player.stats };
    gainXp(state, player, xpToNextLevel(1) + 3);
    expect(player.level).toBe(2);
    expect(player.xp).toBe(3);
    expect(player.stats.maxHp).toBeGreaterThan(before.maxHp);
    expect(player.stats.attack).toBeGreaterThan(before.attack);
    expect(state.events.some((ev) => ev.type === "levelUp" && ev.level === 2)).toBe(true);
  });

  it("大量の XP で複数段まとめて上がる", () => {
    const state = createGame(1);
    const player = getPlayer(state);
    gainXp(state, player, xpToNextLevel(1) + xpToNextLevel(2) + xpToNextLevel(3));
    expect(player.level).toBe(4);
    expect(player.xp).toBe(0);
  });
});
