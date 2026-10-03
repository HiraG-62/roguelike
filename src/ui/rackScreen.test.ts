import { describe, expect, it } from "vitest";
import { GUN_MOVESETS, MOVESETS, MOVESET_KEYS, isGun } from "../data/weapons";
import {
  RACK_ADJUST_ROWS,
  RACK_LAYOUT,
  RACK_RESOURCE_STEP,
  type RackCard,
  type RackInput,
  type RackTrial,
  type RackUi,
  createRackUi,
  rackAdjustAt,
  rackAdjustButtonRect,
  rackCardAt,
  rackCardRect,
  rackCards,
  rackCursorAdjust,
  rackVisibleRows,
  closeRackFamily,
  openRackFamily,
  rackBaseDetail,
  rackCardBorrowable,
  stepRack,
} from "./rackScreen";
import { gunBasesOf } from "../loot/bullets";

const NO_TRIAL: RackTrial = { moveset: null, base: null };

function input(partial: Partial<RackInput> = {}): RackInput {
  return { navX: 0, navY: 0, wheel: 0, aim: null, aimMoved: false, click: false, confirm: false, ...partial };
}

function center(r: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** 段が画面に収まらない数のカード（ホイールの送りを見るため） */
function manyCards(): RackCard[] {
  const count = RACK_LAYOUT.cols * (rackVisibleRows() + 2);
  return Array.from({ length: count }, (_, i) => ({ kind: "moveset", moveset: MOVESET_KEYS[i % MOVESET_KEYS.length] ?? null, base: null, name: `${i}`, marked: false }));
}

describe("武器掛けのカード", () => {
  it("カードは武器種の数 + 1（先頭は装備のまま）", () => {
    const cards = rackCards(NO_TRIAL);
    expect(cards, "枚数").toHaveLength(MOVESET_KEYS.length + 1);
    expect(cards[0]?.moveset, "先頭は装備のまま").toBeNull();
    expect(cards.slice(1).map((c) => c.moveset), "武器種の順").toEqual([...MOVESET_KEYS]);
  });

  it("試用中のカードだけに印が付く", () => {
    const cards = rackCards({ moveset: "spear", base: null });
    expect(cards.filter((c) => c.marked).map((c) => c.moveset), "槍だけ").toEqual(["spear"]);
    expect(rackCards(NO_TRIAL).filter((c) => c.marked).map((c) => c.moveset), "何も試していなければ装備のまま").toEqual([null]);
  });

  it("カードは 480x270 に収まり、中心をクリックするとそのカードを指す", () => {
    const cards = rackCards(NO_TRIAL);
    cards.forEach((_, i) => {
      const r = rackCardRect(i, 0);
      if (r === null) return;
      expect(r.x + r.w, `カード ${i} の右端`).toBeLessThanOrEqual(RACK_LAYOUT.panelX);
      expect(r.y + r.h, `カード ${i} の下端`).toBeLessThanOrEqual(RACK_LAYOUT.gridBottom);
      const c = center(r);
      expect(rackCardAt(c.x, c.y, cards.length, 0), `カード ${i}`).toBe(i);
    });
    expect(RACK_LAYOUT.panelX + RACK_LAYOUT.panelW, "右の欄は画面内").toBeLessThanOrEqual(480);
  });
});

describe("武器掛けの格子の移動", () => {
  it("右端で → は次の段の左端へ", () => {
    const cards = rackCards(NO_TRIAL);
    const ui: RackUi = { ...createRackUi(), cursor: RACK_LAYOUT.cols - 1 };
    expect(stepRack(ui, cards, input({ navX: 1 })).kind, "動いた").toBe("moved");
    expect(ui.cursor, "次の段の左端").toBe(RACK_LAYOUT.cols);
  });

  it("↓ は真下のカードへ、最後の段からは調整欄へ下り、↑ で元のカードへ戻る", () => {
    const cards = rackCards(NO_TRIAL);
    const ui = createRackUi();
    stepRack(ui, cards, input({ navY: 1 }));
    expect(ui.cursor, "真下").toBe(RACK_LAYOUT.cols);
    const last = cards.length - 1;
    ui.cursor = last;
    ui.lastCard = last;
    stepRack(ui, cards, input({ navY: 1 }));
    expect(rackCursorAdjust(ui, cards.length), "調整欄の先頭").toBe(RACK_ADJUST_ROWS[0]);
    stepRack(ui, cards, input({ navY: -1 }));
    expect(ui.cursor, "元のカード").toBe(last);
  });

  it("ホイールは表示を 1 段送りカーソルは動かない", () => {
    const cards = manyCards();
    const ui = createRackUi();
    stepRack(ui, cards, input({ wheel: 1 }));
    expect(ui.scroll, "1 段送る").toBe(1);
    expect(ui.cursor, "カーソルはそのまま").toBe(0);
    for (let i = 0; i < 10; i++) stepRack(ui, cards, input({ wheel: 1 }));
    expect(ui.scroll, "最後の段が見えるところで止まる").toBe(2);
    stepRack(ui, cards, input({ wheel: -1 }));
    expect(ui.scroll, "戻す").toBe(1);
  });

  it("ホバーはマウスが動いたときだけカーソルを奪う", () => {
    const cards = rackCards(NO_TRIAL);
    const ui = createRackUi();
    const r = rackCardRect(3, 0);
    if (r === null) throw new Error("カードが無い");
    stepRack(ui, cards, input({ aim: center(r), aimMoved: false }));
    expect(ui.cursor, "止まったマウスでは動かない").toBe(0);
    stepRack(ui, cards, input({ aim: center(r), aimMoved: true }));
    expect(ui.cursor, "動いたマウスの下のカード").toBe(3);
  });

  it("近接の武器種のカードのクリックと決定はその武器種を試す", () => {
    const cards = rackCards(NO_TRIAL);
    const ui = createRackUi();
    const index = cards.findIndex((c) => c.kind === "moveset");
    const r = rackCardRect(index, 0);
    if (r === null) throw new Error("カードが無い");
    expect(stepRack(ui, cards, input({ aim: center(r), click: true })), "クリック").toEqual({ kind: "try", moveset: cards[index]?.moveset, base: null });
    ui.cursor = 0;
    expect(stepRack(ui, cards, input({ confirm: true })), "装備のままを決定").toEqual({ kind: "try", moveset: null, base: null });
  });
});

describe("武器掛けの銃の器の段", () => {
  it("銃の家系はすべて家系のカードで、決定は器の段を開く", () => {
    const cards = rackCards(NO_TRIAL);
    const guns = cards.filter((c) => c.moveset !== null && isGun(MOVESETS[c.moveset]));
    expect(guns.length, "銃の家系がある").toBe(GUN_MOVESETS.length);
    expect(guns.every((c) => c.kind === "family"), "家系のカード").toBe(true);
    const ui = createRackUi();
    ui.cursor = cards.findIndex((c) => c.moveset === "longarm");
    expect(stepRack(ui, cards, input({ confirm: true })), "長銃を決定").toEqual({ kind: "open", moveset: "longarm" });
    expect(rackCardBorrowable(cards[ui.cursor] ?? null), "家系のカードは借りない").toBe(false);
  });

  it("器の段は「戻る」+ その家系の器を一番早く出る順に並べ、決定はその器で試す", () => {
    const cards = rackCards(NO_TRIAL, "longarm");
    expect(cards[0]?.kind, "先頭は戻る").toBe("back");
    const bases = cards.slice(1);
    expect(bases.map((c) => c.base), "器").toEqual(gunBasesOf("longarm").map((b) => b.key));
    expect(bases.map((c) => c.base).sort(), "長銃の器すべて").toEqual(["crossbow", "handCannon", "matchlock", "railgun", "rifle", "tripleCrossbow"]);
    expect(bases.every((c) => c.kind === "base" && c.moveset === "longarm" && rackCardBorrowable(c)), "器は借りられる").toBe(true);
    const ui = createRackUi();
    openRackFamily(ui, "longarm");
    expect(ui.cursor, "最初の器にカーソル").toBe(1);
    const rifle = cards.findIndex((c) => c.base === "rifle");
    ui.cursor = rifle;
    expect(stepRack(ui, cards, input({ confirm: true })), "小銃を決定").toEqual({ kind: "try", moveset: "longarm", base: "rifle" });
    ui.cursor = 0;
    expect(stepRack(ui, cards, input({ confirm: true })), "戻る").toEqual({ kind: "back" });
  });

  it("試している器に印が付き、器を指定していなければ一番早く出る器に付く", () => {
    const marked = (trial: RackTrial): (string | null)[] => rackCards(trial, "longarm").filter((c) => c.marked).map((c) => c.base);
    expect(marked({ moveset: "longarm", base: "rifle" }), "小銃").toEqual(["rifle"]);
    expect(marked({ moveset: "longarm", base: null }), "指定なし").toEqual([gunBasesOf("longarm")[0]?.key]);
    expect(marked({ moveset: "sidearm", base: "pistol" }), "別の家系").toEqual([]);
    expect(rackCards({ moveset: "longarm", base: "rifle" }).filter((c) => c.marked).map((c) => c.moveset), "武器種の段は家系に印").toEqual(["longarm"]);
  });

  it("器の段を閉じると開いた家系のカードへ戻る", () => {
    const ui = createRackUi();
    openRackFamily(ui, "warRing");
    closeRackFamily(ui);
    expect(ui.family, "武器種の段").toBeNull();
    expect(rackCards(NO_TRIAL)[ui.cursor]?.moveset, "戦輪のカード").toBe("warRing");
    const r = rackCardRect(ui.cursor, ui.scroll);
    expect(r, "カーソルのカードが見えている").not.toBeNull();
  });

  it("器の説明はその器の弾の性質を言う", () => {
    expect(rackBaseDetail("matchlock"), "火縄銃").toContain("溜めるほど強くなる");
    expect(rackBaseDetail("tripleCrossbow"), "三連弩").toContain("三点で出る");
  });
});

describe("武器掛けの調整欄", () => {
  it("資源の行の ←→ と −/＋ のボタンは 10% ずつ増減する", () => {
    const cards = rackCards(NO_TRIAL);
    const ui: RackUi = { ...createRackUi(), cursor: cards.length };
    expect(stepRack(ui, cards, input({ navX: -1 })), "←").toEqual({ kind: "adjust", resource: "hp", delta: -RACK_RESOURCE_STEP });
    const energyRow = RACK_ADJUST_ROWS.indexOf("energy");
    const plus = center(rackAdjustButtonRect(energyRow, 1));
    expect(rackAdjustAt(plus.x, plus.y), "＋の当たり").toEqual({ row: energyRow, side: 1 });
    expect(stepRack(ui, cards, input({ aim: plus, click: true })), "＋").toEqual({ kind: "adjust", resource: "energy", delta: RACK_RESOURCE_STEP });
    expect(rackCursorAdjust(ui, cards.length), "クリックした行にカーソル").toBe("energy");
  });

  it("全快の行の決定はすべてを満たす", () => {
    const cards = rackCards(NO_TRIAL);
    const ui: RackUi = { ...createRackUi(), cursor: cards.length + RACK_ADJUST_ROWS.indexOf("fill") };
    expect(stepRack(ui, cards, input({ confirm: true })), "全快").toEqual({ kind: "fill" });
  });
});
