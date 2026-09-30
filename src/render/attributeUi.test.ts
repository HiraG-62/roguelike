import { describe, expect, it } from "vitest";
import { CONTENT_BOTTOM, CONTENT_RIGHT, CONTENT_Y, LIST_X } from "../ui/inventoryLayout";
import { statusAttrPanelRect as attributePanelRect } from "../ui/statusTab";
import { attributeValueText } from "./attributeUi";
import { manaRatio } from "./manaHud";

describe("装備画面のステータス一覧", () => {
  it("逓減が掛かっていなければ生値だけ、掛かっていれば実効値を添える", () => {
    expect(attributeValueText("str", 5, 5)).toBe("筋力 5");
    expect(attributeValueText("dex", 26, 23)).toBe("技巧 26（実効 23）");
    expect(attributeValueText("vit", 41, 30.25)).toBe("体力 41（実効 30.25）");
  });

  it("ステータスタブの本文の中、見出しの下に収まる", () => {
    const r = attributePanelRect();
    expect(r.x, "本文の左端から").toBeGreaterThanOrEqual(LIST_X);
    expect(r.x + r.w, "本文の右端まで").toBeLessThanOrEqual(CONTENT_RIGHT);
    expect(r.y, "見出しの下").toBeGreaterThan(CONTENT_Y);
    expect(r.y + r.h, "本文の下端を越えない").toBeLessThanOrEqual(CONTENT_BOTTOM);
    expect(r.h, "高さがある").toBeGreaterThan(0);
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
