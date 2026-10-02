import { describe, expect, it } from "vitest";
import { BODY_ATTR_RECT, BODY_CARD } from "../ui/sheet";
import { attributePanelHeight, attributeValueText } from "./attributeUi";
import { manaRatio } from "./manaHud";

describe("書付「体」のステータス一覧", () => {
  it("逓減が掛かっていなければ生値だけ、掛かっていれば実効値を添える", () => {
    expect(attributeValueText("str", 5, 5)).toBe("筋力 5");
    expect(attributeValueText("dex", 26, 23)).toBe("技巧 26（実効 23）");
    expect(attributeValueText("vit", 41, 30.25)).toBe("体力 41（実効 30.25）");
  });

  it("書付「体」の枠に全ステータスの行が入り、紙からはみ出さない", () => {
    const r = BODY_ATTR_RECT;
    expect(r.h, "全ステータスの行").toBeGreaterThanOrEqual(attributePanelHeight());
    expect(r.x, "紙の左端から").toBeGreaterThanOrEqual(BODY_CARD.x);
    expect(r.x + r.w, "紙の右端まで").toBeLessThanOrEqual(BODY_CARD.x + BODY_CARD.w);
    expect(r.y, "紙の上端から").toBeGreaterThanOrEqual(BODY_CARD.y);
    expect(r.y + r.h, "紙の下端を越えない").toBeLessThanOrEqual(BODY_CARD.y + BODY_CARD.h);
  });
});

describe("マナバー", () => {
  it("割合は 0..1 に収まり、上限 0 は空", () => {
    expect(manaRatio(50, 100)).toBe(0.5);
    expect(manaRatio(150, 100)).toBe(1);
    expect(manaRatio(-1, 100)).toBe(0);
    expect(manaRatio(10, 0)).toBe(0);
  });
});
