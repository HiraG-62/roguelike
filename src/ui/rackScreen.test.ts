import { describe, expect, it } from "vitest";
import { MOVESETS, MOVESET_KEYS, WEAPON_GROUPS, type WeaponGroup, isRangedWeapon, weaponGroup } from "../data/weapons";
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
  closeRackLevel,
  openRackFamily,
  openRackGroup,
  rackBaseDetail,
  rackCardBorrowable,
  rackOpensBases,
  rackTitle,
  stepRack,
} from "./rackScreen";
import { rangedBasesOf } from "../loot/bullets";

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
  return Array.from({ length: count }, (_, i) => ({ kind: "moveset", moveset: MOVESET_KEYS[i % MOVESET_KEYS.length] ?? null, group: null, base: null, name: `${i}`, marked: false }));
}

const MELEE_KEYS = MOVESET_KEYS.filter((k) => weaponGroup(MOVESETS[k]) === "melee");
const GUN_KEYS = MOVESET_KEYS.filter((k) => weaponGroup(MOVESETS[k]) === "gun");
const THROWING_KEYS = MOVESET_KEYS.filter((k) => weaponGroup(MOVESETS[k]) === "throwing");

describe("武器掛けの群の段", () => {
  it("最初の段は 装備のまま・近接・銃・投擲物", () => {
    const cards = rackCards(NO_TRIAL);
    expect(cards.map((c) => c.kind), "種類").toEqual(["clear", "group", "group", "group"]);
    expect(cards.slice(1).map((c) => c.group), "群").toEqual([...WEAPON_GROUPS]);
    expect(cards.slice(1).map((c) => c.name), "名前").toEqual(["近接", "銃", "投擲物"]);
    expect(cards.slice(1).every((c) => c.moveset !== null && !rackCardBorrowable(c)), "群は代表の絵を持ち、借りない").toBe(true);
  });

  it("群のカードの決定は武器種の段を開く", () => {
    const cards = rackCards(NO_TRIAL);
    const ui = createRackUi();
    ui.cursor = cards.findIndex((c) => c.group === "gun");
    expect(stepRack(ui, cards, input({ confirm: true })), "銃を決定").toEqual({ kind: "openGroup", group: "gun" });
    ui.cursor = 0;
    expect(stepRack(ui, cards, input({ confirm: true })), "装備のままを決定").toEqual({ kind: "try", moveset: null, base: null });
  });

  it("試用中の印は何も試していなければ装備のまま、武器種を試していればその群に付く", () => {
    expect(rackCards(NO_TRIAL).filter((c) => c.marked).map((c) => c.kind), "装備のまま").toEqual(["clear"]);
    expect(rackCards({ moveset: "spear", base: null }).filter((c) => c.marked).map((c) => c.group), "槍は近接").toEqual(["melee"]);
    expect(rackCards({ moveset: "longarm", base: "rifle" }).filter((c) => c.marked).map((c) => c.group), "長銃は銃").toEqual(["gun"]);
    expect(rackCards({ moveset: "warRing", base: null }).filter((c) => c.marked).map((c) => c.group), "戦輪は投擲物").toEqual(["throwing"]);
  });

  it("カードは 480x270 に収まり、中心をクリックするとそのカードを指す", () => {
    const cards = [...rackCards(NO_TRIAL), ...rackCards(NO_TRIAL, "melee")];
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

describe("武器掛けの武器種の段", () => {
  it("近接の段は「戻る」+ 全近接武器種で、決定は試す", () => {
    const cards = rackCards(NO_TRIAL, "melee");
    expect(cards[0]?.kind, "先頭は戻る").toBe("back");
    expect(cards.slice(1).map((c) => c.moveset), "近接の武器種すべて").toEqual(MELEE_KEYS);
    expect(cards.slice(1).every((c) => c.kind === "moveset" && c.base === null && rackCardBorrowable(c)), "試せて借りられる").toBe(true);
    const ui = createRackUi();
    openRackGroup(ui, "melee");
    ui.cursor = cards.findIndex((c) => c.moveset === "spear");
    expect(stepRack(ui, cards, input({ confirm: true })), "槍を決定").toEqual({ kind: "try", moveset: "spear", base: null });
  });

  it("銃の段は銃 6 種で、決定は器の段を開く", () => {
    const cards = rackCards(NO_TRIAL, "gun");
    expect(cards.slice(1).map((c) => c.moveset), "銃の武器種").toEqual(GUN_KEYS);
    expect(GUN_KEYS, "銃は 6 種").toHaveLength(6);
    expect(cards.slice(1).every((c) => c.kind === "family" && !rackCardBorrowable(c)), "器の段を開くカード").toBe(true);
    const ui = createRackUi();
    ui.cursor = cards.findIndex((c) => c.moveset === "longarm");
    expect(stepRack(ui, cards, input({ confirm: true })), "長銃を決定").toEqual({ kind: "open", moveset: "longarm" });
  });

  it("投擲物の段は投擲物の武器種を直接並べる", () => {
    const cards = rackCards(NO_TRIAL, "throwing");
    expect(cards.slice(1).map((c) => c.moveset), "投擲物の武器種").toEqual(THROWING_KEYS);
    expect(cards.slice(1).some((c) => c.kind === "group"), "群のカードは並ばない").toBe(false);
    expect(MOVESET_KEYS.every((k) => cards.some((c) => c.moveset === k) === (weaponGroup(MOVESETS[k]) === "throwing")), "ほかの群は混ざらない").toBe(true);
  });

  it("器が 1 つの武器種は器の段を開かず、その器で試す（器の数で決まる）", () => {
    for (const group of WEAPON_GROUPS) {
      for (const card of rackCards(NO_TRIAL, group).slice(1)) {
        if (card.moveset === null) continue;
        const bases = rangedBasesOf(card.moveset);
        const opens = isRangedWeapon(MOVESETS[card.moveset]) && bases.length > 1;
        expect(rackOpensBases(card.moveset), `${card.moveset} の判定`).toBe(opens);
        expect(card.kind, `${card.moveset} の種類`).toBe(opens ? "family" : "moveset");
        if (opens) continue;
        const only = isRangedWeapon(MOVESETS[card.moveset]) ? (bases[0]?.key ?? null) : null;
        expect(card.base, `${card.moveset} は器を指定して試す`).toBe(only);
      }
    }
  });

  it("試用中の印は試している武器種に付く", () => {
    const marked = (trial: RackTrial, group: WeaponGroup): (string | null)[] => rackCards(trial, group).filter((c) => c.marked).map((c) => c.moveset);
    expect(marked({ moveset: "spear", base: null }, "melee"), "槍").toEqual(["spear"]);
    expect(marked({ moveset: "longarm", base: "rifle" }, "gun"), "長銃").toEqual(["longarm"]);
    expect(marked({ moveset: "longarm", base: "rifle" }, "melee"), "別の群には付かない").toEqual([]);
  });
});

describe("武器掛けの格子の移動", () => {
  it("右端で → は次の段の左端へ", () => {
    const cards = rackCards(NO_TRIAL, "melee");
    const ui: RackUi = { ...createRackUi(), cursor: RACK_LAYOUT.cols - 1 };
    expect(stepRack(ui, cards, input({ navX: 1 })).kind, "動いた").toBe("moved");
    expect(ui.cursor, "次の段の左端").toBe(RACK_LAYOUT.cols);
  });

  it("↓ は真下のカードへ、最後の段からは調整欄へ下り、↑ で元のカードへ戻る", () => {
    const cards = rackCards(NO_TRIAL, "melee");
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
    const cards = rackCards(NO_TRIAL, "melee");
    const ui = createRackUi();
    const r = rackCardRect(3, 0);
    if (r === null) throw new Error("カードが無い");
    stepRack(ui, cards, input({ aim: center(r), aimMoved: false }));
    expect(ui.cursor, "止まったマウスでは動かない").toBe(0);
    stepRack(ui, cards, input({ aim: center(r), aimMoved: true }));
    expect(ui.cursor, "動いたマウスの下のカード").toBe(3);
  });

  it("武器種のカードのクリックはその武器種を試す", () => {
    const cards = rackCards(NO_TRIAL, "melee");
    const ui = createRackUi();
    const index = cards.findIndex((c) => c.kind === "moveset");
    const r = rackCardRect(index, 0);
    if (r === null) throw new Error("カードが無い");
    expect(stepRack(ui, cards, input({ aim: center(r), click: true })), "クリック").toEqual({ kind: "try", moveset: cards[index]?.moveset, base: null });
  });
});

describe("武器掛けの器の段", () => {
  it("器の段は「戻る」+ その家系の器を一番早く出る順に並べ、決定はその器で試す", () => {
    const cards = rackCards(NO_TRIAL, "gun", "longarm");
    expect(cards[0]?.kind, "先頭は戻る").toBe("back");
    const bases = cards.slice(1);
    expect(bases.map((c) => c.base), "器").toEqual(rangedBasesOf("longarm").map((b) => b.key));
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
    const marked = (trial: RackTrial): (string | null)[] => rackCards(trial, "gun", "longarm").filter((c) => c.marked).map((c) => c.base);
    expect(marked({ moveset: "longarm", base: "rifle" }), "小銃").toEqual(["rifle"]);
    expect(marked({ moveset: "longarm", base: null }), "指定なし").toEqual([rangedBasesOf("longarm")[0]?.key]);
    expect(marked({ moveset: "sidearm", base: "pistol" }), "別の武器種").toEqual([]);
  });

  it("戻る / Esc で 1 段ずつ戻り、開いた元のカードにカーソルが戻る", () => {
    const ui = createRackUi();
    openRackGroup(ui, "throwing");
    expect(ui.cursor, "最初の武器種にカーソル").toBe(1);
    openRackFamily(ui, "warRing");
    expect([ui.group, ui.family], "器の段").toEqual(["throwing", "warRing"]);
    closeRackLevel(ui);
    expect([ui.group, ui.family], "武器種の段へ").toEqual(["throwing", null]);
    expect(rackCards(NO_TRIAL, "throwing")[ui.cursor]?.moveset, "戦輪のカード").toBe("warRing");
    expect(rackCardRect(ui.cursor, ui.scroll), "カーソルのカードが見えている").not.toBeNull();
    closeRackLevel(ui);
    expect([ui.group, ui.family], "群の段へ").toEqual([null, null]);
    expect(rackCards(NO_TRIAL)[ui.cursor]?.group, "投擲物のカード").toBe("throwing");
    closeRackLevel(ui);
    expect(ui.group, "群の段では動かない").toBeNull();
  });

  it("武器種を直接指定して器の段を開くと群も合わせる", () => {
    const ui = createRackUi();
    openRackFamily(ui, "longarm");
    expect(ui.group, "銃").toBe("gun");
  });

  it("題は段に応じて 武器掛け　銃　長銃 のように変わる", () => {
    const ui = createRackUi();
    expect(rackTitle(ui), "群の段").toBe("武器掛け");
    openRackGroup(ui, "gun");
    expect(rackTitle(ui), "武器種の段").toBe("武器掛け　銃");
    openRackFamily(ui, "longarm");
    expect(rackTitle(ui), "器の段").toBe("武器掛け　銃　長銃");
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
