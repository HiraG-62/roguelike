import { describe, expect, it } from "vitest";
import { createRng } from "../core/rng";
import { generateItem } from "../loot/generator";
import type { Item, Slot } from "../loot/types";
import {
  CARRY_BACK_LAYOUT,
  carryBackRowAt,
  carryBackVisibleRows,
  chosenCarryIds,
  createCarryBack,
  cursorItem,
  doneIndex,
  fitCarryBack,
  moveCarryBack,
  pointCarryBack,
  pressCarryBack,
  scrollCarryBack,
  tickCarryBack,
  toggleCarryBack,
} from "./carryBack";

const SLOTS_CYCLE: readonly Slot[] = ["head", "armor", "boots", "ring", "amulet", "mainHand"];

function items(n: number): Item[] {
  return Array.from({ length: n }, (_, i) => generateItem(createRng(300 + i), { slot: SLOTS_CYCLE[i % SLOTS_CYCLE.length], itemLevel: 1, foundDepth: 1, now: 0 }));
}

describe("持ち帰りの画面", () => {
  it("枠の数までしか選べず、外せばまた選べる", () => {
    const list = items(3);
    const ui = createCarryBack(list, 1, "fallen");
    expect(toggleCarryBack(ui, 0)).toBe("on");
    expect(toggleCarryBack(ui, 1), "枠が満杯").toBe("full");
    expect(ui.fullFlash, "満杯の知らせ").toBeGreaterThan(0);
    expect(chosenCarryIds(ui)).toEqual([list[0]?.id]);
    expect(toggleCarryBack(ui, 0)).toBe("off");
    expect(toggleCarryBack(ui, 1)).toBe("on");
    expect(chosenCarryIds(ui)).toEqual([list[1]?.id]);
    tickCarryBack(ui, 10);
    expect(ui.fullFlash).toBe(0);
  });

  it("踏破の枠（3）まで選べる", () => {
    const ui = createCarryBack(items(5), 3, "cleared");
    for (let i = 0; i < 3; i++) expect(toggleCarryBack(ui, i)).toBe("on");
    expect(toggleCarryBack(ui, 3)).toBe("full");
    expect(chosenCarryIds(ui)).toHaveLength(3);
  });

  it("矢印は遺物の行と「決める」を巡り、決めるで done", () => {
    const ui = createCarryBack(items(2), 1, "fallen");
    expect(cursorItem(ui)).not.toBeNull();
    expect(moveCarryBack(ui, -1), "上の端から決めるへ回る").toBe(true);
    expect(ui.cursor).toBe(doneIndex(ui));
    expect(cursorItem(ui)).toBeNull();
    expect(pressCarryBack(ui)).toBe("done");
    moveCarryBack(ui, 1);
    expect(ui.cursor, "決めるから先頭へ").toBe(0);
    expect(pressCarryBack(ui), "遺物の行は選ぶ").toBe("on");
  });

  it("一覧の窓はカーソルに付いて送られ、当たりは見えている行だけ", () => {
    const rowGap = CARRY_BACK_LAYOUT.minRowGap;
    const list = items(30);
    const ui = createCarryBack(list, 1, "fallen");
    fitCarryBack(ui, rowGap);
    const rows = carryBackVisibleRows(rowGap);
    expect(ui.rows).toBe(rows);
    for (let i = 0; i < rows; i++) moveCarryBack(ui, 1);
    expect(ui.cursor).toBe(rows);
    expect(ui.scroll, "窓が 1 行送られる").toBe(1);
    const L = CARRY_BACK_LAYOUT;
    expect(carryBackRowAt(ui, L.listX + 1, L.listY + 1, rowGap), "先頭に見えている行").toBe(1);
    expect(carryBackRowAt(ui, L.listX + 1, L.doneY + 1, rowGap), "決める").toBe(doneIndex(ui));
    expect(carryBackRowAt(ui, L.detailX + 1, L.listY + 1, rowGap), "一覧の外").toBeNull();
    scrollCarryBack(ui, 100);
    expect(ui.scroll, "ホイールは 1 行ずつ").toBe(2);
    expect(pointCarryBack(ui, 0)).toBe(true);
    expect(ui.scroll, "見えていない行を指せば窓が戻る").toBe(0);
  });

  it("「決める」の行は文字が大きくても一覧に重ならない", () => {
    for (const gap of [13, 16, 20, 26]) {
      const rows = carryBackVisibleRows(gap);
      expect(CARRY_BACK_LAYOUT.listY + rows * gap, `行間 ${gap}`).toBeLessThanOrEqual(CARRY_BACK_LAYOUT.doneY);
    }
  });
});
