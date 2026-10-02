import { describe, expect, it } from "vitest";
import { synergyTipLines } from "./itemTips";

describe("遺物の「相性」行", () => {
  it("語が無ければ行を出さず、相手や穴があれば 2 行", () => {
    const none = { produces: [], consumes: [], fills: [], feeds: [], partners: [] };
    expect(synergyTipLines(none), "語なし").toHaveLength(0);
    const alone = { produces: ["burn" as const], consumes: [], fills: [], feeds: [], partners: [] };
    expect(synergyTipLines(alone), "系統はあるが相性の相手なし").toHaveLength(1);
    const meshed = { produces: ["burn" as const], consumes: [], fills: ["burn" as const], feeds: [], partners: ["野火"] };
    expect(synergyTipLines(meshed), "相性の相手と潤い").toHaveLength(2);
  });
});
