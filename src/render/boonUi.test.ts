import { describe, expect, it } from "vitest";
import { BOON_MARKS, BOON_MARK_LABEL, boonMark } from "./boonUi";

describe("祝福カードの印", () => {
  it("枯れを満たすなら「潤い」、溢れを使うなら「受け皿」、どちらでもなければ「新たな流れ」", () => {
    expect(boonMark({ fills: ["burn"], feeds: [] }), "潤い").toBe("fill");
    expect(boonMark({ fills: [], feeds: ["kill"] }), "受け皿").toBe("feed");
    expect(boonMark({ fills: [], feeds: [] }), "新たな流れ").toBe("fresh");
    expect(boonMark({ fills: ["burn"], feeds: ["kill"] }), "両方なら穴を先に").toBe("fill");
  });

  it("3 種の印すべてに表示名がある", () => {
    for (const mark of BOON_MARKS) expect(BOON_MARK_LABEL[mark].length, mark).toBeGreaterThan(0);
  });
});
