import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import { QUESTS, createQuestRun } from "../meta/quests";
import { questHudText } from "./questHud";

describe("依頼の HUD", () => {
  it("依頼を受けていなければ文は null", () => {
    const state = createGame(3);
    state.questRun = createQuestRun(null);
    expect(questHudText(state), "依頼なし").toBeNull();
  });

  it("受けている依頼の名前と進みを出し、達成すると達成の印が付く", () => {
    const state = createGame(3);
    state.questRun = createQuestRun("shaker");
    state.questRun.counters.staggers = 12;
    const text = questHudText(state);
    expect(text, "名前と進み").toContain(QUESTS.shaker.name);
    expect(text, "進み").toContain(`12/${QUESTS.shaker.goal}`);
    expect(text, "未達成に印なし").not.toContain("達成");

    state.questRun.counters.staggers = QUESTS.shaker.goal;
    expect(questHudText(state), "達成").toContain("達成");
  });
});
