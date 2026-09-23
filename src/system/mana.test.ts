import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import type { GameState } from "../core/state";
import { MANA } from "../data/tuning";
import { SKILL_DEFS } from "../skills/data";
import { descend } from "./floor";
import { canAfford, descendMana, gainMana, refillMana, spendMana, tickMana } from "./mana";

const FLOAT_DIGITS = 9;
/** 序盤（装備・祝福なし）に満タンから撃てる発数の目安（2026-09-24 プレイ所見） */
const OPENING_CASTS_MIN = 3;
const OPENING_CASTS_MAX = 4;

/** マナ型スキルの既定コストの平均。個別スキルの調整で目安が崩れていないかを見る */
function averageManaCost(): number {
  const costs = Object.values(SKILL_DEFS)
    .filter((def) => def.resource === "mana")
    .map((def) => def.manaCost);
  if (costs.length === 0) throw new Error("マナ型スキルが無い");
  return costs.reduce((sum, c) => sum + c, 0) / costs.length;
}

/** 満タンから、回収なしで cost を何発払えるか */
function castsFromFull(state: GameState, cost: number): number {
  state.player.mana = state.stats.maxMana;
  let casts = 0;
  while (spendMana(state, cost)) casts++;
  return casts;
}

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

  it("序盤は満タンから既定コスト（マナ型の平均）で 3〜4 発しか撃てない", () => {
    const state = freshState();
    const casts = castsFromFull(state, averageManaCost());
    expect(casts, "撃てる発数が多すぎる / 少なすぎる").toBeGreaterThanOrEqual(OPENING_CASTS_MIN);
    expect(casts, "撃てる発数が多すぎる / 少なすぎる").toBeLessThanOrEqual(OPENING_CASTS_MAX);
  });

  it("序盤の自然回復だけでは平均コスト 1 発ぶんに封鎖中で 10 秒以上かかる", () => {
    const state = freshState();
    const secondsPerCast = averageManaCost() / state.stats.manaRegen;
    const MIN_WAIT_SECONDS = 10;
    expect(secondsPerCast, "自然回復が早すぎて通常攻撃を混ぜる動機が無い").toBeGreaterThanOrEqual(MIN_WAIT_SECONDS);
  });

  it("descendMana は最大の descendRefill まで回復する", () => {
    const state = freshState();
    state.player.mana = 5;
    descendMana(state);
    expect(state.player.mana).toBeCloseTo(state.stats.maxMana * MANA.descendRefill, FLOAT_DIGITS);
  });

  it("descendMana は既に descendRefill 以上なら減らさない", () => {
    const state = freshState();
    const high = state.stats.maxMana * MANA.descendRefill + 10;
    state.player.mana = high;
    descendMana(state);
    expect(state.player.mana, "階層到達でマナが減った").toBe(high);
  });

  it("階層を降りても満タンにはならず descendRefill まで", () => {
    const state = freshState();
    state.player.mana = 0;
    descend(state);
    expect(state.player.mana).toBeCloseTo(state.stats.maxMana * MANA.descendRefill, FLOAT_DIGITS);
    expect(state.player.mana, "満タン回復が残っている").toBeLessThan(state.stats.maxMana);
  });

  it("idle（非封鎖）と封鎖中で自然回復の速さが idleRegenMul 倍違う", () => {
    const idle = freshState();
    idle.player.mana = 0;
    tickMana(idle, 1);
    const locked = freshState();
    const room = locked.rooms[0];
    if (!room) throw new Error("部屋が無い");
    room.locked = true;
    locked.player.mana = 0;
    tickMana(locked, 1);
    expect(locked.player.mana, "封鎖中も回復はする").toBeGreaterThan(0);
    expect(idle.player.mana / locked.player.mana, "idle / 封鎖 の比").toBeCloseTo(MANA.idleRegenMul, FLOAT_DIGITS);
  });
});
