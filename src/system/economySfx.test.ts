import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import type { Rng } from "../core/rng";
import type { GameState } from "../core/state";
import { SFX_NAMES } from "../audio/sfxNames";
import { LAYERED_SFX } from "../audio/sfxLayers";
import { SFX_DEFINITIONS } from "../audio/sfx";
import { type BetOffer, placeBet } from "./bets";
import { CRATE_KEY, POT_KEY, containerBroken, createContainer } from "./containers";
import { gainCoins, spillCoins } from "./economy";
import { tryDrink } from "./flask";
import { buildFloor } from "./floor";
import { provokeMerchant } from "./merchantAi";
import { arena, withInput } from "./testHelpers";

/** 銭・瓶・商人・賭け・壺と木箱の効果音（docs/ideas/economy-impl.md 4 章 6e） */

const NEW_SFX = ["coinPickup", "coinSpill", "flaskDrink", "merchantProvoked", "betWin", "betLose", "containerBreak"] as const;
const ALWAYS_WIN = 0;
const ALWAYS_LOSE = 0.999999;
const SPILL_COINS = 100;
const STAKE = 20;

function fixedRng(value: number): Rng {
  return {
    next: () => value,
    int: (min) => min,
    chance: (p) => value < p,
    pick: <T>(arr: readonly T[]) => arr[0] as T,
  };
}

function betState(): GameState {
  const state = createGame(3);
  state.depth = 4;
  buildFloor(state, "rooms");
  return state;
}

function chohan(): BetOffer {
  return { kind: "chohan", tier: null, target: 0, mul: 1.5, jackpot: false, stake: STAKE };
}

describe("銭まわりの効果音の登録", () => {
  it("名前が SFX_NAMES にあり、層の表と再生の定義がある", () => {
    const layered: ReadonlySet<string> = new Set(Object.keys(LAYERED_SFX));
    for (const name of NEW_SFX) {
      expect(SFX_NAMES as readonly string[], `名前 ${name}`).toContain(name);
      expect(layered.has(name), `層の定義 ${name}`).toBe(true);
      expect(typeof SFX_DEFINITIONS[name], `再生の定義 ${name}`).toBe("function");
    }
  });
});

describe("銭まわりの効果音を鳴らす", () => {
  it("銭を得ると coinPickup が 1 度だけ積まれる（同フレームの重複は落ちる）", () => {
    const state = arena();
    gainCoins(state, 5, "kill");
    gainCoins(state, 5, "kill");
    expect(state.sfx.filter((n) => n === "coinPickup").length, "1 フレームに 1 つ").toBe(1);
    expect(state.sfx, "汎用の pickup は使わない").not.toContain("pickup");
  });

  it("被弾でこぼれると coinSpill が積まれる", () => {
    const state = arena();
    state.economy.coins = SPILL_COINS;
    const p = state.player.body.pos;
    spillCoins(state, { x: p.x - 10, y: p.y });
    expect(state.sfx, "こぼれる音").toContain("coinSpill");
  });

  it("瓶を飲むと flaskDrink が積まれる", () => {
    const state = arena();
    state.player.hp = state.player.maxHp * 0.2;
    expect(tryDrink(state, withInput({ flaskPressed: true })), "飲めた").toBe(true);
    expect(state.sfx, "飲む音").toContain("flaskDrink");
  });

  it("壺・木箱が割れると containerBreak が積まれ、wallHit は使わない", () => {
    for (const key of [POT_KEY, CRATE_KEY]) {
      const state = arena();
      const p = state.player.body.pos;
      const box = createContainer(state, key, { x: p.x + 40, y: p.y });
      containerBroken(state, box);
      expect(state.sfx, `${key} の割れる音`).toContain("containerBreak");
      expect(state.sfx, `${key} は wallHit を使わない`).not.toContain("wallHit");
    }
  });

  it("賭けに勝つと betWin、負けると betLose が積まれる", () => {
    const win = betState();
    win.rng = fixedRng(ALWAYS_WIN);
    expect(placeBet(win, chohan()), "勝つ").toBe("won");
    expect(win.sfx, "勝ちの音").toContain("betWin");
    expect(win.sfx, "負けの音は鳴らさない").not.toContain("betLose");

    const lose = betState();
    lose.rng = fixedRng(ALWAYS_LOSE);
    expect(placeBet(lose, chohan()), "負ける").toBe("lost");
    expect(lose.sfx, "負けの音").toContain("betLose");
    expect(lose.sfx, "勝ちの音は鳴らさない").not.toContain("betWin");
  });

  it("商人を怒らせると merchantProvoked が積まれる", () => {
    const state = createGame(3);
    const m = state.economy.merchants[0];
    const body = state.enemies.find((e) => e.id === m?.enemyId);
    if (!m || !body) throw new Error("商人がいない");
    // 殴って怒らせる道（交戦中は当たらない・平時は警告から）は merchantAi.test.ts が見る
    provokeMerchant(state, body);
    expect(state.sfx, "怒る音").toContain("merchantProvoked");
  });
});
