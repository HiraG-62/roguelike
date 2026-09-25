import { describe, expect, it } from "vitest";
import { ATTR_KEYS } from "../loot/types";
import { ALLOC_ORDER, allocButtonAt, allocButtonRect } from "../ui/attributeAlloc";
import { CONTENT_BOTTOM, CONTENT_RIGHT, CONTENT_Y, LIST_X } from "../ui/inventoryLayout";
import { statusAttrPanelRect as attributePanelRect } from "../ui/statusTab";
import { ATTR_HINT, allocatedText, attributeValueText, unspentHudText } from "./attributeUi";
import { manaRatio } from "./manaHud";

describe("装備画面のステータス一覧", () => {
  it("逓減が掛かっていなければ生値だけ、掛かっていれば実効値を添える", () => {
    expect(attributeValueText("str", 5, 5)).toBe("筋力 5");
    expect(attributeValueText("dex", 26, 23)).toBe("技巧 26（実効 23）");
    expect(attributeValueText("vit", 41, 30.25)).toBe("体力 41（実効 30.25）");
  });

  it("このランで振った点は振ったときだけ出す", () => {
    expect(allocatedText(0)).toBe("");
    expect(allocatedText(2)).toBe("振り +2");
  });

  it("ステータスタブの本文の中、見出しの下に収まる", () => {
    const r = attributePanelRect();
    expect(r.x, "本文の左端から").toBeGreaterThanOrEqual(LIST_X);
    expect(r.x + r.w, "本文の右端まで").toBeLessThanOrEqual(CONTENT_RIGHT);
    expect(r.y, "見出しの下").toBeGreaterThan(CONTENT_Y);
    expect(r.y + r.h, "本文の下端を越えない").toBeLessThanOrEqual(CONTENT_BOTTOM);
    expect(r.h, "高さがある").toBeGreaterThan(0);
  });

  it("全ステータスに一言がある", () => {
    for (const k of ATTR_KEYS) expect(ATTR_HINT[k].length, k).toBeGreaterThan(0);
  });
});

describe("振り分けの「+」ボタン", () => {
  it("5 行ぶんがステータス一覧の枠内に重ならずに並び、中心で当たる", () => {
    const panel = attributePanelRect();
    for (let i = 0; i < ALLOC_ORDER.length; i++) {
      const r = allocButtonRect(panel, i);
      expect(r.x, `${i} 行目が左にはみ出す`).toBeGreaterThanOrEqual(panel.x);
      expect(r.x + r.w, `${i} 行目が右にはみ出す`).toBeLessThanOrEqual(panel.x + panel.w);
      expect(r.y + r.h, `${i} 行目が下にはみ出す`).toBeLessThanOrEqual(panel.y + panel.h);
      expect(allocButtonAt(panel, { x: r.x + r.w / 2, y: r.y + r.h / 2 }), `${i} 行目の中心`).toBe(i);
      if (i + 1 < ALLOC_ORDER.length) expect(allocButtonRect(panel, i + 1).y, "隣と重ならない").toBeGreaterThanOrEqual(r.y + r.h);
    }
    expect(allocButtonAt(panel, { x: panel.x, y: panel.y }), "ボタンの外").toBe(-1);
  });

  it("HUD の未振り点は点があるときだけ", () => {
    expect(unspentHudText(0)).toBeNull();
    expect(unspentHudText(2)).not.toBeNull();
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
