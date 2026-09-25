import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import type { GameState } from "../core/state";
import { ULTIMATES } from "../data/ultimates";
import { placeEnemy, arena } from "../system/testHelpers";
import type { BoonGrade } from "../system/boonGrade";
import { BOONS, BOON_KEYS, type BoonChoice, type BoonKey } from "../system/boons";
import { botInput, createBotState, pickBoonIndex, shouldPressUltimate } from "./bot";

/** bot が待ち終えた後の提示時間（BOON_CHOICE_WAIT 0.5 秒より長く） */
const WAITED = 1;

function choiceOf(options: BoonKey[], grades: BoonGrade[]): BoonChoice {
  return { options, hover: -1, curseHover: false, timer: WAITED, curseTaken: false, curse: null, grades };
}

const clean = BOON_KEYS.filter((k) => !BOONS[k].cursed);
const cursed = BOON_KEYS.filter((k) => BOONS[k].cursed);

function key(list: readonly BoonKey[], i: number): BoonKey {
  const k = list[i];
  if (k === undefined) throw new Error("祝福が足りない");
  return k;
}

describe("bot の祝福の選び方", () => {
  it("bot は格の高い札を選ぶ", () => {
    const options = [key(clean, 0), key(clean, 1), key(clean, 2)];
    expect(pickBoonIndex(choiceOf(options, [1, 3, 2])), "神威の札").toBe(1);
    expect(pickBoonIndex(choiceOf(options, [1, 1, 2])), "大祝福の札").toBe(2);
    expect(pickBoonIndex(choiceOf(options, [1, 1, 1])), "同じ格なら前の札").toBe(0);
  });

  it("呪い付きの札は格が高くても選ばない", () => {
    const options = [key(clean, 0), key(cursed, 0), key(clean, 1)];
    expect(pickBoonIndex(choiceOf(options, [1, 3, 2])), "呪いでない方の最上位").toBe(2);
    const allCursed = [key(cursed, 0), key(cursed, 1), key(cursed, 2)];
    expect(pickBoonIndex(choiceOf(allCursed, [1, 1, 1])), "呪い付きしか無ければ 1 枚目").toBe(0);
  });

  it("格の無い提示（grades 省略）では呪いでない最初の札", () => {
    const options = [key(cursed, 0), key(clean, 0), key(clean, 1)];
    const choice: BoonChoice = { options, hover: -1, curseHover: false, timer: WAITED, curseTaken: false, curse: null };
    expect(pickBoonIndex(choice), "2 枚目").toBe(1);
  });

  it("選んだ札に対応するキーを押す", () => {
    const state = createGame(1);
    state.boonChoice = choiceOf([key(clean, 0), key(clean, 1), key(clean, 2)], [1, 1, 3]);
    const input = botInput(state, createBotState(1), 1 / 60);
    expect(input.attackPressed, "3 枚目は攻撃のキー").toBe(true);
    expect(input.skill1Pressed || input.skill2Pressed, "他の札のキーは押さない").toBe(false);
  });
});

const DT = 1 / 60;
/** 回避の危険距離（55px）より外で、奥義の距離（8m = 80px）より内 */
const NEAR_ENEMY_DX = 70;
/** 奥義の距離（8m）より外 */
const FAR_ENEMY_DX = 120;
/** 殴り続けても倒れない・倒されない体力 */
const ENDLESS_HP = 1e9;

/** 開始部屋で追ってくる敵 1 体と向き合う（互いに倒れない。待機中の敵は bot が交戦相手に選ばないので追跡にする） */
function facingEnemy(dx: number): GameState {
  const state = arena(3);
  const e = placeEnemy(state, "slime", dx);
  e.phase = "chase";
  e.hp = ENDLESS_HP;
  e.maxHp = ENDLESS_HP;
  state.player.hp = ENDLESS_HP;
  state.player.maxHp = ENDLESS_HP;
  return state;
}

function fullGauge(state: GameState): void {
  state.player.energy = state.player.maxEnergy;
}

describe("bot の奥義", () => {
  it("bot は奥義ゲージが満タンなら敵の近くで F を押す", () => {
    const state = facingEnemy(NEAR_ENEMY_DX);
    fullGauge(state);
    expect(botInput(state, createBotState(1), DT).specialPressed, "満タン・8m 以内なら押す").toBe(true);
  });

  it("ゲージが満タンでない・敵が 8m より遠いときは F を押さない", () => {
    const half = facingEnemy(NEAR_ENEMY_DX);
    half.player.energy = half.player.maxEnergy / 2;
    expect(botInput(half, createBotState(1), DT).specialPressed, "ゲージが半分").toBe(false);
    const far = facingEnemy(FAR_ENEMY_DX);
    fullGauge(far);
    expect(botInput(far, createBotState(1), DT).specialPressed, "敵が 8m より遠い").toBe(false);
  });

  it("持続の奥義の間は F を押さず、ゲージが減るのを待つ（押し直すと終わるため）", () => {
    const state = facingEnemy(NEAR_ENEMY_DX);
    const sustain = Object.values(ULTIMATES).flat().find((u) => u.kind === "sustain");
    expect(sustain, "持続の奥義がある").toBeDefined();
    fullGauge(state);
    state.player.ultimate.active = sustain?.key ?? null;
    expect(shouldPressUltimate(state, NEAR_ENEMY_DX), "持続中").toBe(false);
  });

  it("bot に任せると満タンのゲージで奥義が出てゲージが減る", () => {
    const state = facingEnemy(NEAR_ENEMY_DX);
    fullGauge(state);
    const bot = createBotState(1);
    const before = state.player.energy;
    step(state, botInput(state, bot, DT), DT);
    const used = state.player.energy < before || state.player.ultimate.active !== null;
    expect(used, "一撃ならゲージが 0、持続なら持続中").toBe(true);
  });
});

describe("bot の左右の連撃", () => {
  it("bot は近接なら左右を混ぜた列で連撃を出し、名前付き派生を踏む", () => {
    const state = facingEnemy(20);
    const bot = createBotState(2);
    let right = false;
    let branch = false;
    const FRAMES = 60 * 30;
    for (let i = 0; i < FRAMES && !(right && branch); i++) {
      step(state, botInput(state, bot, DT), DT);
      const a = state.player.attack;
      if (a.phase !== "none" && a.lane === "secondary") right = true;
      if (a.branch >= 0) branch = true;
    }
    expect(right, "右の段を振った").toBe(true);
    expect(branch, "名前付き派生を踏んだ").toBe(true);
  });
});
