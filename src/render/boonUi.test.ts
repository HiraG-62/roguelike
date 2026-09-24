import { describe, expect, it } from "vitest";
import { BOON_MARKS, BOON_MARK_LABEL, boonMark } from "./boonUi";

describe("祝福カードの印", () => {
  it("不足を補うなら「不足を補う」、余りを活かすなら「余りを活かす」、どちらでもなければ「新しい方向」", () => {
    expect(boonMark({ fills: ["burn"], feeds: [] }), "不足を補う").toBe("fill");
    expect(boonMark({ fills: [], feeds: ["kill"] }), "余りを活かす").toBe("feed");
    expect(boonMark({ fills: [], feeds: [] }), "新しい方向").toBe("fresh");
    expect(boonMark({ fills: ["burn"], feeds: ["kill"] }), "両方なら穴を先に").toBe("fill");
  });

  it("3 種の印すべてに表示名がある", () => {
    for (const mark of BOON_MARKS) expect(BOON_MARK_LABEL[mark].length, mark).toBeGreaterThan(0);
  });
});
