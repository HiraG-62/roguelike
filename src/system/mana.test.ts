import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import type { GameState } from "../core/state";
import { MANA } from "../data/tuning";
import { canAfford, gainMana, refillMana, spendMana, tickMana } from "./mana";

const FLOAT_DIGITS = 9;

function freshState(): GameState {
  const state = createGame(1);
  for (const r of state.rooms) r.locked = false;
  return state;
}

describe("マナ", () => {
  it("ラン開始時は満タン", () => {
    const state = freshState();
    expect(state.player.mana).toBe(state.stats.maxMana);
    expect(state.stats.maxMana, "精神が基礎値なら baseMax").toBe(MANA.baseMax);
  });

  it("gainMana は manaGainMul を掛け、上限で止め、増えた量を返す", () => {
    const state = freshState();
    state.player.mana = 10;
    state.stats.manaGainMul = 1.5;
    expect(gainMana(state, 4), "4 × 1.5").toBeCloseTo(6, FLOAT_DIGITS);
    expect(state.player.mana).toBeCloseTo(16, FLOAT_DIGITS);
    state.player.mana = state.stats.maxMana - 1;
    expect(gainMana(state, 10), "上限までの 1 だけ増える").toBeCloseTo(1, FLOAT_DIGITS);
    expect(state.player.mana).toBe(state.stats.maxMana);
  });

  it("gainMana は 0 以下の量と死亡中は何もしない", () => {
    const state = freshState();
    state.player.mana = 10;
    expect(gainMana(state, 0)).toBe(0);
    expect(gainMana(state, -5)).toBe(0);
    state.status = "dead";
    expect(gainMana(state, 5)).toBe(0);
    expect(state.player.mana).toBe(10);
  });

  it("spendMana は足りなければ何も減らさず false（不発）", () => {
    const state = freshState();
    state.player.mana = 15;
    expect(canAfford(state, 20)).toBe(false);
    expect(spendMana(state, 20)).toBe(false);
    expect(state.player.mana, "不発でマナが減った").toBe(15);
    expect(canAfford(state, 15), "ちょうどなら払える").toBe(true);
    expect(spendMana(state, 15)).toBe(true);
    expect(state.player.mana).toBe(0);
    expect(spendMana(state, 0), "コスト 0 は常に払える").toBe(true);
  });

  it("tickMana: 封鎖されていない場所では自然回復が idleRegenMul 倍", () => {
    const state = freshState();
    state.player.mana = 0;
    tickMana(state, 1);
    expect(state.player.mana).toBeCloseTo(MANA.baseRegen * MANA.idleRegenMul, FLOAT_DIGITS);
  });

  it("tickMana: 封鎖中の部屋では等倍", () => {
    const state = freshState();
    const room = state.rooms[0];
    if (!room) throw new Error("部屋が無い");
    room.locked = true;
    state.player.mana = 0;
    tickMana(state, 1);
    expect(state.player.mana).toBeCloseTo(MANA.baseRegen, FLOAT_DIGITS);
  });

  it("tickMana は上限を超えない", () => {
    const state = freshState();
    state.player.mana = state.stats.maxMana - 0.1;
    tickMana(state, 10);
    expect(state.player.mana).toBe(state.stats.maxMana);
  });

  it("refillMana で満タンに戻る", () => {
    const state = freshState();
    state.player.mana = 3;
    refillMana(state);
    expect(state.player.mana).toBe(state.stats.maxMana);
  });
});
