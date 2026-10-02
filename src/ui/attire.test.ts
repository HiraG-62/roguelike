import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import type { FrameInput } from "../core/input";
import type { GameState } from "../core/state";
import { createRng } from "../core/rng";
import { createCraftSave } from "../loot/craftingStore";
import { generateItem } from "../loot/generator";
import { addToStash } from "../loot/profile";
import { withInput } from "../system/testHelpers";
import { ATTIRE_SLOTS, ATTIRE_VIEW, partMarks } from "./attire";
import { crestShape } from "./crestShape";
import { createInventoryUi, updateInventoryUi } from "./inventory";
import { fid } from "./menuFocus";
import { type InventoryUi, type LootSlot, type MenuView, topView } from "./menuState";

function openAttire(state: GameState = createGame(1)): { state: GameState; ui: InventoryUi } {
  const ui = createInventoryUi(createCraftSave());
  updateInventoryUi(state, ui, withInput({ inventoryPressed: true }), 0);
  return { state, ui };
}

function frame(state: GameState, ui: InventoryUi, input: Partial<FrameInput>): void {
  updateInventoryUi(state, ui, withInput(input), 1 / 60);
}

/** 1 段目の装束の焦点を置いて決定する */
function confirmOn(state: GameState, ui: InventoryUi, focus: string): void {
  const root = ui.stack[0];
  if (root === undefined) throw new Error("開いていない");
  root.focus = focus;
  frame(state, ui, { confirmPressed: true });
}

function top(ui: InventoryUi): MenuView {
  const v = topView(ui);
  if (v === null) throw new Error("頁が無い");
  return v;
}

describe("装束", () => {
  it("6 部位・腰の石 4・人影・紋の写しの帯に当たりがある", () => {
    const { state, ui } = openAttire();
    const view = top(ui);
    if (view.kind !== "attire") throw new Error("装束で開いていない");
    const ids = ATTIRE_VIEW.layout(state, ui, view).map((h) => h.id);
    for (const slot of ATTIRE_SLOTS) expect(ids, `部位 ${slot}`).toContain(fid.part(slot));
    expect(ATTIRE_SLOTS, "部位は 6").toHaveLength(6);
    for (let i = 0; i < 4; i++) expect(ids, `腰の石 ${i}`).toContain(fid.stone(i));
    expect(ids, "人影").toContain(fid.body);
    const rows = crestShape(state).rows;
    expect(rows.length, "流儀・型の系統で紋の写しに帯がある").toBeGreaterThan(0);
    for (const row of rows) expect(ids, `写しの帯 ${row.keyword}`).toContain(fid.mini(row.keyword));
  });

  it("部位で決定すると候補の頁が積まれる", () => {
    const { state, ui } = openAttire();
    confirmOn(state, ui, fid.part("head"));
    const view = top(ui);
    expect(view.kind, "候補の頁").toBe("candidates");
    expect(view.kind === "candidates" ? view.target : null, "頭の倉庫").toEqual({ kind: "slot", slot: "head" });
    expect(ui.stack, "装束の上に 1 段").toHaveLength(2);
  });

  it("人影で決定すると書付「体」が積まれる", () => {
    const { state, ui } = openAttire();
    confirmOn(state, ui, fid.body);
    const view = top(ui);
    expect(view.kind === "sheet" ? view.subject : null, "書付「体」").toEqual({ kind: "body" });
  });

  it("腰の石で決定するとスキルの頁が積まれる", () => {
    const { state, ui } = openAttire();
    confirmOn(state, ui, fid.stone(2));
    const view = top(ui);
    expect(view.kind, "スキルの頁").toBe("skills");
    expect(view.focus, "その石に焦点").toBe(fid.stone(2));
  });

  it("紋の写しの帯で決定すると紋の面でその系統が開く", () => {
    const { state, ui } = openAttire();
    const row = crestShape(state).rows[0];
    if (row === undefined) throw new Error("写しに帯が無い");
    confirmOn(state, ui, fid.mini(row.keyword));
    expect(ui.stack.map((v) => v.kind), "紋の面の上に系統の頁").toEqual(["crest", "flow"]);
    const view = top(ui);
    expect(view.kind === "flow" ? view.keyword : null, "その系統").toBe(row.keyword);
    expect(ui.stack[0]?.focus, "紋の面ではその帯に焦点").toBe(fid.band(row.keyword));
  });

  it("倉庫に新着がある部位にだけ印が付く", () => {
    const state = createGame(1);
    const ring = { ...generateItem(createRng(7), { itemLevel: 1, foundDepth: 1, now: 100 }), slot: "ring" as const, foundAt: 100 };
    addToStash(state.profile, ring);
    for (const slot of ATTIRE_SLOTS) {
      const expected = state.profile.stash.some((it) => it.slot === slot);
      expect(partMarks(state, slot).unseen, `${slot} の新着の印`).toBe(expected);
    }
    state.profile.meta.seenAt = { ring: 100 };
    expect(partMarks(state, "ring").unseen, "見た後は印が消える").toBe(false);
  });
});

describe("装束の持ち込みの印（loot/runGear.ts）", () => {
  function hubState(): GameState {
    const state = createGame(1);
    state.sandbox = true;
    state.profile.equipment.head = generateItem(createRng(41), { slot: "head", itemLevel: 1, foundDepth: 1, now: 0 });
    state.profile.equipment.ring = generateItem(createRng(42), { slot: "ring", itemLevel: 1, foundDepth: 1, now: 0 });
    state.profile.carry = [];
    return state;
  }

  it("拠点では部位の長押しで印を付け外しし、右手とラン中は長押しが無い", () => {
    const { state, ui } = openAttire(hubState());
    const view = top(ui);
    if (view.kind !== "attire") throw new Error("装束で開いていない");
    const hold = (slot: LootSlot): unknown => ATTIRE_VIEW.layout(state, ui, view).find((h) => h.id === fid.part(slot))?.hold ?? null;
    expect(hold("head"), "頭").toEqual({ kind: "toggleCarry", slot: "head" });
    expect(hold("mainHand"), "右手は常に持ち込み").toBeNull();
    ATTIRE_VIEW.act(state, ui, view, { kind: "toggleCarry", slot: "head" });
    expect(state.profile.carry).toEqual(["head"]);
    expect(partMarks(state, "head").carry, "印").toBe(true);
    expect(partMarks(state, "mainHand").carry, "右手は常に印").toBe(true);
    view.focus = fid.part("head");
    expect(ATTIRE_VIEW.guide(state, view), "案内に持ち込み").toContain("carry");
    delete state.sandbox;
    expect(hold("head"), "ラン中は変えられない").toBeNull();
  });
});
