import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import type { GameState } from "../core/state";
import { ARC, DEEP } from "../data/tuning";
import { BOONS } from "./boonDefs";
import { applyBoonsToStats, temperAmount } from "./boons";
import { DEEP_TEXT_LIFE, DEEP_TEXT_SCALE } from "./deep";
import { ascend, descend } from "./floor";
import { estimateModifiers } from "./modifiers";
import { arena } from "./testHelpers";

/** 深みの規則（深度 22 から: 上限の外れと初回の告知。docs/ideas/deep-impl.md） */

const FINAL_DEPTH = ARC.floorsPerChapter * ARC.maxChapter + 1;

const DEEP_LOG = "更なる深みへ……。深淵が汝の力を解放する";

function deepLogCount(state: GameState): number {
  return state.log.filter((l) => l.text === DEEP_LOG).length;
}

function deepTextCount(state: GameState): number {
  return state.texts.filter((t) => t.text === "深み").length;
}

/** 深度 depth の 1 つ手前に立って、そこまで来たことにする（降りると初めて着いた階になる） */
function standAbove(depth: number, seed = 9): GameState {
  const state = createGame(seed);
  state.depth = depth - 1;
  state.runEvents.strata.deepest = state.depth;
  return state;
}

describe("深みでは「〜につき」の上限が外れる", () => {
  it("守銭は最深の間までは上限で止まり、深みでは持ち金に比例して伸びる", () => {
    const state = arena();
    state.boons.push("miser");
    state.economy.coins = 100000;
    state.depth = FINAL_DEPTH;
    const capped = estimateModifiers(state, "melee").increased;
    state.depth = FINAL_DEPTH + 1;
    const uncapped = estimateModifiers(state, "melee").increased;
    expect(capped, "最深の間では上限の値").toBeGreaterThan(0);
    expect(uncapped, "深みでは上限を超える").toBeGreaterThan(capped * 2);
  });

  it("持ち金が上限に届かなければ、深みでも章の間でも同じ値", () => {
    const state = arena();
    state.boons.push("miser");
    state.economy.coins = 20;
    state.depth = FINAL_DEPTH;
    const shallow = estimateModifiers(state, "melee").increased;
    state.depth = FINAL_DEPTH + 5;
    expect(estimateModifiers(state, "melee").increased).toBeCloseTo(shallow);
  });
});

describe("深みでは研鑽の上限が外れる", () => {
  it("temperAmount は uncapped で cap を外し、cap が無ければ変わらない", () => {
    const capped = { tally: "x", stat: "maxMana" as const, per: 2, every: 1, cap: 10 };
    expect(temperAmount(capped, 100)).toBe(10);
    expect(temperAmount(capped, 100, true)).toBe(200);
    expect(temperAmount({ ...capped, cap: undefined }, 100)).toBe(200);
  });

  it("深みに降りると applyStats が研鑽の上限を外した stats を畳む（章の間は上限で止まる）", () => {
    const def = BOONS.ashBlaze;
    const saved = def.temperStat;
    try {
      const t = { tally: "ashBlaze", stat: "statusPotencyMul" as const, per: 0.1, every: 1, cap: 0.5 };
      def.temperStat = t;
      const state = standAbove(FINAL_DEPTH);
      state.boons.push("ashBlaze");
      state.boonRun.tallies.ashBlaze = 100;
      applyBoonsToStats(state);
      descend(state, "cave");
      expect(state.depth).toBe(FINAL_DEPTH);
      const atFinal = state.stats.statusPotencyMul;
      descend(state, "cave");
      expect(state.depth).toBe(FINAL_DEPTH + 1);
      expect(state.stats.statusPotencyMul - atFinal, "深みは上限（0.5）を超えて 10 まで伸びる").toBeCloseTo(10 - t.cap);
    } finally {
      def.temperStat = saved;
    }
  });
});

describe("深みに初めて着いた告知", () => {
  it("初めて着くと浮き文字「深み」とログが出る", () => {
    const state = standAbove(FINAL_DEPTH + 1);
    descend(state, "cave");
    expect(deepLogCount(state)).toBe(1);
    expect(deepTextCount(state)).toBe(1);
    const text = state.texts.find((t) => t.text === "深み");
    expect(text?.color, "色は DEEP.color").toBe(DEEP.color);
    expect(text?.scale).toBe(DEEP_TEXT_SCALE);
    expect(text?.maxLife).toBe(DEEP_TEXT_LIFE);
  });

  it("最深の間では出ない", () => {
    const state = standAbove(FINAL_DEPTH);
    descend(state, "cave");
    expect(deepLogCount(state)).toBe(0);
  });

  it("深み 2 層目・戻ってから降り直した階では出ない", () => {
    const state = standAbove(FINAL_DEPTH + 1);
    descend(state, "cave");
    descend(state, "cave");
    expect(state.depth).toBe(FINAL_DEPTH + 2);
    ascend(state);
    expect(state.depth).toBe(FINAL_DEPTH + 1);
    descend(state, "cave");
    expect(deepLogCount(state), "初回の 1 回だけ").toBe(1);
  });
});
