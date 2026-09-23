import { describe, expect, it } from "vitest";
import { VIEW_H, VIEW_W } from "../core/view";
import { ATTR_KEYS, SLOTS } from "../loot/types";
import { ALLOC_ORDER, allocCardRect, allocIndexAt } from "../ui/attributeAlloc";
import { CONTENT_H, CONTENT_Y } from "../ui/inventoryLayout";
import { SLOT_GAP, SLOT_H } from "../ui/inventory";
import { ATTR_HINT, attributePanelRect, attributeValueText } from "./attributeUi";
import { manaRatio } from "./manaHud";

describe("装備画面のステータス一覧", () => {
  it("逓減が掛かっていなければ生値だけ、掛かっていれば実効値を添える", () => {
    expect(attributeValueText("str", 5, 5)).toBe("筋力 5");
    expect(attributeValueText("dex", 26, 23)).toBe("技巧 26（実効 23）");
    expect(attributeValueText("vit", 41, 30.25)).toBe("体力 41（実効 30.25）");
  });

  it("スロットの下、ツールチップの上に収まる", () => {
    const r = attributePanelRect();
    const slotsBottom = CONTENT_Y + SLOTS.length * (SLOT_H + SLOT_GAP) - SLOT_GAP;
    expect(r.y, "スロットに重ならない").toBeGreaterThanOrEqual(slotsBottom);
    expect(r.y + r.h, "ツールチップ（下段）に重ならない").toBeLessThanOrEqual(CONTENT_Y + CONTENT_H);
    expect(r.h, "高さがある").toBeGreaterThan(0);
  });

  it("全ステータスに一言がある", () => {
    for (const k of ATTR_KEYS) expect(ATTR_HINT[k].length, k).toBeGreaterThan(0);
  });
});

describe("振り分けパネルの枠", () => {
  it("5 枠が画面内に重ならずに並び、中心で当たる", () => {
    for (let i = 0; i < ALLOC_ORDER.length; i++) {
      const r = allocCardRect(i);
      expect(r.x, `${i} 枠目が左にはみ出す`).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w, `${i} 枠目が右にはみ出す`).toBeLessThanOrEqual(VIEW_W);
      expect(r.y + r.h, `${i} 枠目が下にはみ出す`).toBeLessThanOrEqual(VIEW_H);
      expect(allocIndexAt({ x: r.x + r.w / 2, y: r.y + r.h / 2 }), `${i} 枠目の中心`).toBe(i);
      const next = allocCardRect(i + 1);
      if (i + 1 < ALLOC_ORDER.length) expect(next.x, "隣と重ならない").toBeGreaterThanOrEqual(r.x + r.w);
    }
    expect(allocIndexAt({ x: 0, y: 0 }), "枠の外").toBe(-1);
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
