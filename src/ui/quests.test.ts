import { describe, expect, it } from "vitest";
import type { QuestKey } from "../meta/quests";
import { chosenQuest, createQuestChoice, moveQuestChoice, questCardRects, questChoiceItemAt, questSkipRect, skipIndex } from "./quests";

const OFFERS: readonly QuestKey[] = ["burnout", "shaker", "untouched"];

describe("依頼の 3 択: カーソル", () => {
  it("最初は左の札。引き継いだ依頼が候補にあればそこから", () => {
    expect(createQuestChoice(OFFERS).cursor, "左").toBe(0);
    expect(createQuestChoice(OFFERS, "untouched").cursor, "引き継ぎ").toBe(2);
    expect(createQuestChoice(OFFERS, "plague").cursor, "候補に無ければ左").toBe(0);
  });

  it("←→ で札を巡り、↓ で受けずに出発、↑ で札へ戻る", () => {
    const ui = createQuestChoice(OFFERS);
    moveQuestChoice(ui, -1, 0);
    expect(ui.cursor, "左端から右端へ巡る").toBe(2);
    moveQuestChoice(ui, 0, 1);
    expect(ui.cursor, "受けずに出発").toBe(skipIndex(ui));
    expect(chosenQuest(ui), "受けない").toBeNull();
    expect(moveQuestChoice(ui, 1, 0), "受けずに出発では左右に動かない").toBe(false);
    moveQuestChoice(ui, 0, -1);
    expect(chosenQuest(ui), "札へ戻る").toBe("burnout");
  });
});

describe("依頼の 3 択: 当たり判定", () => {
  it("札の中央はその札、受けずに出発のボタンは offers.length、外は null", () => {
    const ui = createQuestChoice(OFFERS);
    questCardRects(OFFERS.length).forEach((r, i) => {
      expect(questChoiceItemAt(ui, r.x + r.w / 2, r.y + r.h / 2), `${i} 枚目`).toBe(i);
    });
    const skip = questSkipRect();
    expect(questChoiceItemAt(ui, skip.x + skip.w / 2, skip.y + skip.h / 2), "受けずに出発").toBe(OFFERS.length);
    expect(questChoiceItemAt(ui, 0, 0), "外").toBeNull();
  });

  it("札は重ならず、画面の中に収まる", () => {
    const rects = questCardRects(OFFERS.length);
    for (let i = 1; i < rects.length; i++) {
      const prev = rects[i - 1];
      const cur = rects[i];
      if (!prev || !cur) throw new Error("札が無い");
      expect(cur.x, `${i} 枚目は前の札の右`).toBeGreaterThanOrEqual(prev.x + prev.w);
    }
    const last = rects[rects.length - 1];
    expect(last && last.x + last.w <= 480, "右端が画面内").toBe(true);
  });
});
