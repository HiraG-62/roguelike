import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import type { FrameInput } from "../core/input";
import { createRng } from "../core/rng";
import type { GameState } from "../core/state";
import { createCraftSave } from "../loot/craftingStore";
import { generateItem } from "../loot/generator";
import type { Item, Slot } from "../loot/types";
import { withInput } from "../system/testHelpers";
import { ATTIRE_PART_RECTS } from "./attire";
import { beadFocusFor, crestShape, sourceKey } from "./crestShape";
import { createInventoryUi, updateInventoryUi } from "./inventory";
import { fid } from "./menuFocus";
import { type InventoryUi, type MenuSignals, NO_SIGNALS, topView } from "./menuState";

const DT = 1 / 60;
const BACK: MenuSignals = { back: true, confirmHeld: false };

function frame(state: GameState, ui: InventoryUi, input: Partial<FrameInput> = {}, signals: MenuSignals = NO_SIGNALS): void {
  updateInventoryUi(state, ui, withInput(input), DT, signals);
}

function open(state: GameState = createGame(1)): { state: GameState; ui: InventoryUi } {
  const ui = createInventoryUi(createCraftSave());
  frame(state, ui, { inventoryPressed: true });
  return { state, ui };
}

function equip(state: GameState, slot: Slot, seed: number): Item {
  const item = { ...generateItem(createRng(seed), { itemLevel: 3, foundDepth: 3, now: 0 }), slot };
  state.profile.equipment[slot] = item;
  return item;
}

function focusOf(ui: InventoryUi): string | null {
  return topView(ui)?.focus ?? null;
}

function centerOf(slot: keyof typeof ATTIRE_PART_RECTS): { x: number; y: number } {
  const r = ATTIRE_PART_RECTS[slot];
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

describe("装備画面の入口", () => {
  it("持ち物キーで開くと装束の右手に焦点があり、ゲームが止まる", () => {
    const { state, ui } = open();
    expect(ui.open, "開く").toBe(true);
    expect(ui.stack.map((v) => v.kind), "装束の 1 段").toEqual(["attire"]);
    expect(focusOf(ui), "右手に焦点").toBe(fid.part("mainHand"));
    expect(state.paused, "ゲームが止まる").toBe(true);
  });

  it("開いている間の持ち物キーで装束と紋を行き来する", () => {
    const { state, ui } = open();
    frame(state, ui, { inventoryPressed: true });
    expect(ui.stack.map((v) => v.kind), "紋へ").toEqual(["crest"]);
    expect(ui.open, "閉じない").toBe(true);
    frame(state, ui, { inventoryPressed: true });
    expect(ui.stack.map((v) => v.kind), "装束へ戻る").toEqual(["attire"]);
    expect(state.paused, "止まったまま").toBe(true);
  });

  it("戻るは 1 段ずつ戻り、1 段目で閉じて止まりを解く", () => {
    const { state, ui } = open();
    frame(state, ui, { confirmPressed: true });
    expect(ui.stack.map((v) => v.kind), "右手の候補").toEqual(["attire", "candidates"]);
    frame(state, ui, {}, BACK);
    expect(ui.stack.map((v) => v.kind), "1 段戻る").toEqual(["attire"]);
    expect(ui.open, "まだ開いている").toBe(true);
    frame(state, ui, {}, BACK);
    expect(ui.open, "1 段目で閉じる").toBe(false);
    expect(state.paused, "止まりを解く").toBe(false);
    frame(state, ui, {}, BACK);
    expect(ui.open, "閉じている間の戻るでは開かない").toBe(false);
  });

  it("面を替えると深い頁は閉じ、焦点の遺物は持ち越す", () => {
    const state = createGame(1);
    const ring = equip(state, "ring", 11);
    const { ui } = open(state);
    const root = ui.stack[0];
    if (root === undefined) throw new Error("開いていない");
    root.focus = fid.part("ring");
    frame(state, ui, { confirmPressed: true });
    expect(ui.stack, "指輪の候補を積んだ").toHaveLength(2);

    frame(state, ui, { inventoryPressed: true });
    const key = sourceKey({ kind: "relic", id: ring.id, slot: "ring" });
    const expected = beadFocusFor(crestShape(state), key) ?? fid.daiPart("ring");
    expect(ui.stack.map((v) => v.kind), "深い頁は閉じる").toEqual(["crest"]);
    expect(focusOf(ui), "紋では指輪の珠（見えなければ台の身）").toBe(expected);

    frame(state, ui, { inventoryPressed: true });
    expect(focusOf(ui), "装束へ戻ると指輪").toBe(fid.part("ring"));
  });

  it("マウスが動いたときだけ当たりへ焦点を移す", () => {
    const state = createGame(1);
    const ui = createInventoryUi(createCraftSave());
    const ringAim = centerOf("ring");
    frame(state, ui, { inventoryPressed: true, aimScreen: ringAim });
    frame(state, ui, { aimScreen: ringAim });
    expect(focusOf(ui), "開いたときの位置のままなら奪わない").toBe(fid.part("mainHand"));
    frame(state, ui, { aimScreen: centerOf("head") });
    expect(focusOf(ui), "動いたら当たりへ").toBe(fid.part("head"));
    frame(state, ui, { aimScreen: centerOf("head"), move: { x: 0, y: 1 } });
    const moved = focusOf(ui);
    expect(moved, "キーで動かす").not.toBe(fid.part("head"));
    frame(state, ui, { aimScreen: centerOf("head") });
    expect(focusOf(ui), "マウスが止まっていればキーの焦点を保つ").toBe(moved);
  });

  it("書付キーで焦点の物の書付が積まれる", () => {
    const state = createGame(1);
    const ring = equip(state, "ring", 5);
    state.profile.equipment.head = null;
    const { ui } = open(state);
    const root = ui.stack[0];
    if (root === undefined) throw new Error("開いていない");
    root.focus = fid.part("head");
    frame(state, ui, { interactPressed: true });
    expect(ui.stack, "空の部位には書付が無い").toHaveLength(1);
    root.focus = fid.part("ring");
    frame(state, ui, { interactPressed: true });
    const top = topView(ui);
    expect(top?.kind === "sheet" ? top.subject : null, "指輪の書付").toEqual({ kind: "item", itemId: ring.id });
    frame(state, ui, {}, BACK);
    root.focus = fid.body;
    frame(state, ui, { specialPressed: true });
    const body = topView(ui);
    expect(body?.kind === "sheet" ? body.subject : null, "奥義キーでも開く").toEqual({ kind: "body" });
  });
});
