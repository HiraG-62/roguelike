import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import type { BoonGrade } from "../system/boonGrade";
import { BOONS, BOON_KEYS, type BoonChoice, type BoonKey } from "../system/boons";
import { botInput, createBotState, pickBoonIndex } from "./bot";

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
