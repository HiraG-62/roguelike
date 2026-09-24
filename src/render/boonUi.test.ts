import { describe, expect, it } from "vitest";
import { BOON_MARKS, BOON_MARK_LABEL, boonMark } from "./boonUi";

describe("祝福カードの印", () => {
  it("飢えを埋めるなら「穴を埋める」、余りを食うなら「流れを太くする」、どちらでもなければ「新しい流れ」", () => {
    expect(boonMark({ fills: ["burn"], feeds: [] }), "穴を埋める").toBe("fill");
    expect(boonMark({ fills: [], feeds: ["kill"] }), "流れを太くする").toBe("feed");
    expect(boonMark({ fills: [], feeds: [] }), "新しい流れ").toBe("fresh");
    expect(boonMark({ fills: ["burn"], feeds: ["kill"] }), "両方なら穴を先に").toBe("fill");
  });

  it("3 種の印すべてに表示名がある", () => {
    for (const mark of BOON_MARKS) expect(BOON_MARK_LABEL[mark].length, mark).toBeGreaterThan(0);
  });
});
