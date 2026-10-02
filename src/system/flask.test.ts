import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import { FIXED_DT } from "../core/loop";
import type { GameState } from "../core/state";
import { ECONOMY } from "../data/tuning";
import { healSustained } from "./combat";
import { drinkBlocker, flaskCapacity, gainFlasks, refillFlasks, tryDrink } from "./flask";
import { applyStats } from "./player";
import { arena, withInput } from "./testHelpers";

/** 瓶（system/flask.ts。docs/ideas/economy-impl.md 2-3） */

const DRINK = withInput({ flaskPressed: true });
const IDLE = withInput({});
const HURT_HP_RATIO = 0.2;

/** 生命が減っていて瓶を 1 本持つ状態 */
function wounded(stats: Parameters<typeof arena>[1] = {}): GameState {
  const state = arena(5, stats);
  state.player.hp = state.player.maxHp * HURT_HP_RATIO;
  return state;
}

describe("瓶を飲む", () => {
  it("開始時は ECONOMY.flask.start 本で、上限は既定 flask.max", () => {
    const state = createGame(1);
    expect(state.player.flasks, "開始の本数").toBe(ECONOMY.flask.start);
    expect(state.stats.flaskMax, "既定の上限").toBe(ECONOMY.flask.max);
  });

  it("flaskPressed で最大生命の healRatio が戻り、瓶が 1 本減る", () => {
    const state = wounded();
    const before = state.player.hp;
    expect(tryDrink(state, DRINK), "飲めた").toBe(true);
    expect(state.player.hp - before, "回復量").toBeCloseTo(state.player.maxHp * ECONOMY.flask.healRatio, 5);
    expect(state.player.flasks, "1 本減る").toBe(ECONOMY.flask.start - 1);
  });

  it("step に配線されていて、押した 1 ステップで飲める", () => {
    const state = wounded();
    const before = state.player.hp;
    step(state, DRINK, FIXED_DT);
    expect(state.player.hp, "回復した").toBeGreaterThan(before);
    expect(state.player.flasks, "1 本減る").toBe(ECONOMY.flask.start - 1);
  });

  it("押していなければ飲まない", () => {
    const state = wounded();
    expect(tryDrink(state, IDLE), "飲まない").toBe(false);
    expect(state.player.flasks, "減らない").toBe(ECONOMY.flask.start);
  });

  it("戦闘中の回復の上限（HEAL.sustainCapRatio）を通さない", () => {
    const state = wounded();
    // 窓の上限を使い切らせ、戦闘中の回復だと 0 になる状態にする
    healSustained(state, state.player.maxHp);
    const before = state.player.hp;
    expect(healSustained(state, 5), "窓の上限は使い切り").toBe(0);
    tryDrink(state, DRINK);
    expect(state.player.hp - before, "瓶は上限に関係なく戻る").toBeCloseTo(state.player.maxHp * ECONOMY.flask.healRatio, 5);
  });

  it("最大生命を超えては戻らない", () => {
    const state = arena(5);
    state.player.hp = state.player.maxHp * 0.9;
    tryDrink(state, DRINK);
    expect(state.player.hp, "最大生命で止まる").toBe(state.player.maxHp);
  });

  it("onFlask イベントと浮き文字が出る（イベントの amount は回復量）", () => {
    const state = wounded();
    const before = state.player.hp;
    tryDrink(state, DRINK);
    const ev = state.events.find((e) => e.kind === "onFlask");
    expect(ev, "onFlask が積まれる").toBeDefined();
    expect(ev?.amount, "回復量").toBeCloseTo(state.player.hp - before, 5);
    expect(state.texts.some((t) => t.color === ECONOMY.flask.color), "瓶の色の浮き文字").toBe(true);
  });
});

describe("瓶を飲めない状況", () => {
  it("0 本なら何もしない", () => {
    const state = wounded();
    state.player.flasks = 0;
    const before = state.player.hp;
    expect(drinkBlocker(state), "理由: 空").toBe("empty");
    expect(tryDrink(state, DRINK)).toBe(false);
    expect(state.player.hp, "回復しない").toBe(before);
  });

  it("ダッシュ中は飲めない", () => {
    const state = wounded();
    state.player.dashTimer = 0.1;
    expect(drinkBlocker(state), "理由: 動作中").toBe("busy");
    expect(tryDrink(state, DRINK)).toBe(false);
    expect(state.player.flasks, "減らない").toBe(ECONOMY.flask.start);
  });

  it.each(["windup", "active"] as const)("攻撃のコミット中（%s）は飲めず、recover では飲める", (phase) => {
    const state = wounded();
    state.player.attack.phase = phase;
    expect(tryDrink(state, DRINK), "コミット中は不可").toBe(false);
    state.player.attack.phase = "recover";
    expect(tryDrink(state, DRINK), "後隙は可").toBe(true);
  });

  it("生命が満タンなら飲まない（瓶を捨てない）", () => {
    const state = arena(5);
    expect(drinkBlocker(state), "理由: 満タン").toBe("full");
    expect(tryDrink(state, DRINK)).toBe(false);
    expect(state.player.flasks, "減らない").toBe(ECONOMY.flask.start);
  });

  it("死亡後は飲めない", () => {
    const state = wounded();
    state.status = "dead";
    expect(tryDrink(state, DRINK)).toBe(false);
  });

  it("再使用は cooldown 秒待つ。続けて押しても 2 本目は空かない", () => {
    const state = wounded();
    state.player.flasks = 2;
    expect(tryDrink(state, DRINK), "1 本目").toBe(true);
    expect(drinkBlocker(state), "直後は待ち").toBe("cooldown");
    expect(tryDrink(state, DRINK), "直後の 2 本目は不可").toBe(false);
    expect(state.player.flasks, "1 本残る").toBe(1);
    state.time += ECONOMY.flask.cooldown + FIXED_DT;
    expect(tryDrink(state, DRINK), "待てば飲める").toBe(true);
  });
});

describe("瓶の本数と上限", () => {
  it("gainFlasks は stats.flaskMax までしか増えず、増えた本数を返す", () => {
    const state = arena(5);
    expect(gainFlasks(state, 5), "上限 2 で 1 → 2 は 1 本").toBe(state.stats.flaskMax - ECONOMY.flask.start);
    expect(state.player.flasks, "上限で止まる").toBe(state.stats.flaskMax);
    expect(gainFlasks(state, 1), "満杯なら 0").toBe(0);
    expect(gainFlasks(state, -3), "負は 0").toBe(0);
  });

  it("上限は stats.flaskMax に従う（+1 で 3 本持てる）", () => {
    const state = arena(5, { flaskMax: 3 });
    expect(flaskCapacity(state), "容量").toBe(3);
    refillFlasks(state);
    expect(state.player.flasks, "泉で上限まで満ちる").toBe(3);
  });

  it("flaskMax が下がると持ち本数も切り詰める（applyStats）", () => {
    const state = arena(5, { flaskMax: 3 });
    state.player.flasks = 3;
    applyStats(state, { ...state.stats, flaskMax: 1 });
    expect(state.player.flasks, "上限に収まる").toBe(1);
  });
});
