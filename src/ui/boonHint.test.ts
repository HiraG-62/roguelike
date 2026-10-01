import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import type { GameState } from "../core/state";
import { BOONS, BOON_KEYS, grantBoon } from "../system/boons";
import type { BoonKey } from "../system/boonDefs";
import { resonanceBySource } from "../system/resonance";
import { boonCrestHint } from "./boonHint";

const POOL_MAX_OWNED = 12;

/** 祝福を BOON_KEYS 順に宿していき、「次の 1 枚で段が上がる」札が現れたところの state と札（決定的） */
function stateWithRisingCandidate(): { state: GameState; key: BoonKey } {
  const state = createGame(7);
  const pool = BOON_KEYS.filter((k) => !BOONS[k].cursed && BOONS[k].core !== true);
  for (const owned of pool) {
    if (state.boons.length >= POOL_MAX_OWNED) break;
    const key = pool.find((k) => !state.boons.includes(k) && k !== owned && boonCrestHint(state, k).rising.length > 0);
    if (key !== undefined) return { state, key };
    grantBoon(state, owned);
  }
  throw new Error("段が上がる祝福の組が見つからない");
}

function stepsOf(state: GameState): number[] {
  return Object.values(resonanceBySource(state)).map((r) => r.step);
}

describe("祝福の 3 択の紋の写し", () => {
  it("焦点の札で太る系統を返し、state を変えない", () => {
    const { state, key } = stateWithRisingCandidate();
    const boons = [...state.boons];
    const steps = stepsOf(state);
    const before = resonanceBySource(state);
    const hint = boonCrestHint(state, key);
    expect(hint.rising.length, "段が上がる系統がある").toBeGreaterThan(0);
    expect(state.boons, "先読みでは祝福を宿さない").toEqual(boons);
    expect(stepsOf(state), "先読みで段が変わらない").toEqual(steps);

    // 実際に宿した結果と一致する（先読みは後から宿した結果の写し）
    grantBoon(state, key);
    const after = resonanceBySource(state);
    for (const k of hint.rising) expect(after[k].step, `${k} の段が実際に上がる`).toBeGreaterThan(before[k].step);
  });

  it("先読みは state.rng を消費しない", () => {
    const a = stateWithRisingCandidate();
    const b = stateWithRisingCandidate();
    boonCrestHint(a.state, a.key);
    expect(a.state.rng.next(), "先読みの有無で乱数列が同じ").toBe(b.state.rng.next());
  });

  it("加護の札は乗る行動を返し、加護でなければ null", () => {
    const state = createGame(1);
    const grace = BOON_KEYS.find((k) => BOONS[k].card === "grace" && BOONS[k].action !== undefined);
    if (grace === undefined) throw new Error("加護の祝福が見つからない");
    expect(boonCrestHint(state, grace).action, "加護の行動").toBe(BOONS[grace].action);
    const other = BOON_KEYS.find((k) => BOONS[k].card !== "grace");
    if (other === undefined) throw new Error("加護でない祝福が見つからない");
    expect(boonCrestHint(state, other).action, "加護でなければ null").toBeNull();
  });
});
