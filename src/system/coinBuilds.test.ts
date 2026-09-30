import { describe, expect, it } from "vitest";
import { FIXED_DT } from "../core/loop";
import { BOON_LINEAGE, ECONOMY } from "../data/tuning";
import { affixDef, applyRoll, formatAffix, traitsFor } from "../loot/affixes";
import { createIncreased } from "../core/damage";
import type { PlayerStats } from "../loot/types";
import { BOONS, BOON_KEYS, type BoonKey } from "./boonDefs";
import { rollOutgoing } from "./combat";
import { gainCoins } from "./economy";
import { collectModifiers, estimateModifiers } from "./modifiers";
import { resolveRules } from "./rules";
import { arena } from "./testHelpers";
import type { GameState } from "../core/state";

/** 通貨のビルドの見本 3 枚（性質「懐」= 持つ型、祝福「守銭」= 持つ型、祝福「拾銭」= 稼ぐ型。docs/ideas/economy-impl.md 2-10） */

const POCKET = ECONOMY.build.pocketCoins;
const BASE_HIT = 100;

function give(state: GameState, ...keys: BoonKey[]): void {
  for (const k of keys) if (!state.boons.includes(k)) state.boons.push(k);
}

function withPurse(value: number, copies = 1): GameState {
  const state = arena();
  for (let i = 0; i < copies; i++) applyRoll(state.stats, { key: "purse", kind: "prefix", tier: 1, value });
  return state;
}

function increasedAt(state: GameState, coins: number): number {
  state.economy.coins = coins;
  return estimateModifiers(state, "melee").increased;
}

describe("性質「懐」（持ち金が閾値以上の間だけ与ダメの増）", () => {
  it("武器・指輪・首飾りに出て、防具には出ない", () => {
    expect(affixDef("purse")).toBeDefined();
    for (const slot of ["mainHand", "ring", "amulet"] as const) {
      expect(traitsFor(slot, 1).map((d) => d.key), slot).toContain("purse");
    }
    for (const slot of ["armor", "boots"] as const) {
      expect(traitsFor(slot, 30).map((d) => d.key), slot).not.toContain("purse");
    }
  });

  it("持ち金が閾値未満なら効かず、閾値ちょうどで効く", () => {
    const state = withPurse(12);
    expect(increasedAt(state, POCKET - 1), "閾値未満").toBe(0);
    expect(increasedAt(state, POCKET), "閾値ちょうど").toBeCloseTo(0.12);
    expect(increasedAt(state, POCKET * 100), "持ち金が多くても増えない（持つ型の頭打ち）").toBeCloseTo(0.12);
  });

  it("実際の 1 撃の威力に乗る（持ち金あり > なし。近接・射撃・スキルのどれにも）", () => {
    const rich = withPurse(12);
    rich.economy.coins = POCKET;
    const poor = withPurse(12);
    poor.economy.coins = 0;
    expect(rollOutgoing(rich, null, BASE_HIT, "melee").amount, "近接").toBe(112);
    expect(rollOutgoing(poor, null, BASE_HIT, "melee").amount, "近接（持ち金なし）").toBe(BASE_HIT);
    expect(rollOutgoing(rich, null, BASE_HIT, "ranged").amount, "射撃").toBe(112);
    expect(rollOutgoing(rich, null, BASE_HIT, "melee", { skill: true }).amount, "スキル").toBe(112);
  });

  it("2 本持つと増が足し算になる（倍にならない）", () => {
    const state = withPurse(12, 2);
    expect(increasedAt(state, POCKET)).toBeCloseTo(0.24);
  });

  it("持ち金を払って閾値を割ると効かなくなる（使う・持つの張り合い）", () => {
    const state = withPurse(12);
    state.economy.coins = POCKET;
    expect(collectModifiers(state)).toHaveLength(1);
    expect(estimateModifiers(state, "melee").increased).toBeCloseTo(0.12);
    state.economy.coins -= 1;
    expect(estimateModifiers(state, "melee").increased).toBe(0);
  });

  it("表示は値と閾値を出す。装備の増（increased）と別の受け口で、他の stats を汚さない", () => {
    expect(formatAffix({ key: "purse", kind: "prefix", tier: 1, value: 12 })).toContain("12%");
    const state = withPurse(12);
    const plain: PlayerStats = arena().stats;
    expect(state.stats.increased).toEqual(createIncreased());
    expect(plain.modifiers, "別の stats には移らない").toHaveLength(0);
  });
});

describe("祝福「守銭」（持ち金に比例する与ダメの増）", () => {
  const per = BOON_LINEAGE.wealth.miser.perStep;
  const every = BOON_LINEAGE.wealth.miser.every;

  it("定義: 常時の増（modifiers）だけで、Rule は持たない", () => {
    expect(BOON_KEYS).toContain("miser");
    expect(BOONS.miser.modifiers).toHaveLength(1);
    expect(BOONS.miser.rules ?? []).toHaveLength(0);
  });

  it("持ち金が 1 段（every）に満たなければ 0、1 段ごとに per ずつ増える", () => {
    const state = arena();
    give(state, "miser");
    expect(increasedAt(state, every - 1), "1 段に満たない").toBe(0);
    expect(increasedAt(state, every), "1 段").toBeCloseTo(per);
    expect(increasedAt(state, every * 5 + 3), "端数は切り捨て").toBeCloseTo(per * 5);
  });

  it("上限（cap）で止まる", () => {
    const state = arena();
    give(state, "miser");
    expect(increasedAt(state, 1_000_000)).toBeCloseTo(BOON_LINEAGE.wealth.miser.cap);
  });

  it("持たなければ持ち金が多くても効かない", () => {
    const state = arena();
    expect(increasedAt(state, 1_000_000)).toBe(0);
  });

  it("実際の 1 撃の威力に乗る", () => {
    const state = arena();
    give(state, "miser");
    state.economy.coins = every * 10;
    const expected = Math.round(BASE_HIT * (1 + per * 10));
    expect(rollOutgoing(state, null, BASE_HIT, "melee").amount).toBe(expected);
  });

  it("「懐」と足し算になる（増は加算）", () => {
    const state = withPurse(12);
    give(state, "miser");
    expect(increasedAt(state, POCKET * 2)).toBeCloseTo(0.12 + per * Math.floor((POCKET * 2) / every));
  });
});

describe("祝福「拾銭」（銭を拾った瞬間の短い加速）", () => {
  function speedBuff(state: GameState): { time: number; mul: number } {
    return state.player.buffs.speed;
  }

  it("定義: 起点は銭を拾った瞬間（onCoinPickup）、効果は既存の加速", () => {
    expect(BOON_KEYS).toContain("coinGleaner");
    const rules = BOONS.coinGleaner.rules ?? [];
    expect(rules).toHaveLength(1);
    expect(rules[0]?.when).toBe("onCoinPickup");
    expect(rules[0]?.then.kind).toBe("speedBuff");
  });

  it("銭を拾うと短い間だけ加速する", () => {
    const state = arena();
    give(state, "coinGleaner");
    expect(speedBuff(state).time).toBe(0);
    gainCoins(state, 5, "kill");
    resolveRules(state, FIXED_DT);
    expect(speedBuff(state).time, "加速の秒").toBeGreaterThan(0);
    expect(speedBuff(state).time).toBeLessThanOrEqual(BOON_LINEAGE.wealth.coinGleaner.time);
    expect(speedBuff(state).mul, "加速の倍率").toBeGreaterThan(1);
  });

  it("持っていなければ拾っても加速しない", () => {
    const state = arena();
    gainCoins(state, 5, "kill");
    resolveRules(state, FIXED_DT);
    expect(speedBuff(state).time).toBe(0);
  });

  it("銭が入らなければ（額 0）加速しない", () => {
    const state = arena();
    give(state, "coinGleaner");
    gainCoins(state, 0, "kill");
    resolveRules(state, FIXED_DT);
    expect(speedBuff(state).time).toBe(0);
  });

  it("続けて拾っても間隔（ICD）の間は 2 回目で延びない", () => {
    const state = arena();
    give(state, "coinGleaner");
    gainCoins(state, 5, "kill");
    resolveRules(state, FIXED_DT);
    speedBuff(state).time = 0.5;
    gainCoins(state, 5, "kill");
    resolveRules(state, FIXED_DT);
    expect(speedBuff(state).time, "ICD 中は延ばさない").toBe(0.5);
  });
});
