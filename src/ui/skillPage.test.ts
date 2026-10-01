import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import type { FrameInput } from "../core/input";
import type { GameState } from "../core/state";
import { createCraftSave } from "../loot/craftingStore";
import { stoneInSlot } from "../skills/persistence";
import { grantBoon } from "../system/boons";
import { withInput } from "../system/testHelpers";
import { createInventoryUi, updateInventoryUi } from "./inventory";
import { openMenu } from "./menuActions";
import { fid } from "./menuFocus";
import { type InventoryUi, type MenuSignals, type MenuView, type ViewOf, topView } from "./menuState";
import { SKILLS_VIEW, columnRunes, looseRunes } from "./skillPage";
import { RUNE_BLOCK_TEXT } from "./skillRunes";

/** スロット 0（旋風斬り）に反響と収束、スロット 1 にも石がある状態でスキルの頁を開く */
function openSkills(): { state: GameState; ui: InventoryUi } {
  const state = createGame(1);
  const first = state.skills.slots[0];
  if (!first) throw new Error("スロット 0 が無い");
  first.runModifiers = ["echo", "focus"];
  const ui = createInventoryUi(createCraftSave());
  openMenu(state, ui, "skills");
  return { state, ui };
}

function skillsView(ui: InventoryUi): ViewOf<"skills"> {
  const view = topView(ui);
  if (view?.kind !== "skills") throw new Error("スキルの頁が開いていない");
  return view;
}

function frame(state: GameState, ui: InventoryUi, input: Partial<FrameInput>, signals?: Partial<MenuSignals>): void {
  updateInventoryUi(state, ui, withInput(input), 1 / 60, { back: false, confirmHeld: false, ...signals });
}

/** 焦点を置いて決定を 1 回押して離す（長押しのある当たりは離したときに決定になる） */
function confirmOn(state: GameState, ui: InventoryUi, focus: string): void {
  skillsView(ui).focus = focus;
  tap(state, ui);
}

function tap(state: GameState, ui: InventoryUi): void {
  frame(state, ui, { confirmPressed: true }, { confirmHeld: true });
  frame(state, ui, {}, { confirmHeld: false });
}

const runes = (state: GameState, i: number): string[] => state.skills.slots[i]?.runModifiers ?? [];

describe("スキルの頁", () => {
  it("書庫から開くと石 0 に焦点があり、石 4 と符に当たりがある", () => {
    const { state, ui } = openSkills();
    const view = skillsView(ui);
    expect(view.focus, "石 0 に焦点").toBe(fid.stone(0));
    const ids = SKILLS_VIEW.layout(state, ui, view).map((h) => h.id);
    for (let i = 0; i < 4; i++) expect(ids, `石 ${i}`).toContain(fid.stone(i));
    expect(ids, "符の当たり").toContain(fid.rune(0, "echo"));
    expect(ids, "符の当たり 2").toContain(fid.rune(0, "focus"));
  });

  it("石で決定すると石の候補が開く", () => {
    const { state, ui } = openSkills();
    confirmOn(state, ui, fid.stone(1));
    const view = topView(ui);
    expect(view?.kind, "候補の頁").toBe("candidates");
    expect(view?.kind === "candidates" ? view.target : null, "石 1 の候補").toEqual({ kind: "stone", index: 1 });
  });

  it("符を持ち上げて別の石の列に置くと移る", () => {
    const { state, ui } = openSkills();
    confirmOn(state, ui, fid.rune(0, "echo"));
    const view = skillsView(ui);
    expect(view.lift, "持ち上げ中").toEqual({ slot: 0, key: "echo" });
    expect(runes(state, 0), "持ち上げただけでは動かない").toEqual(["echo", "focus"]);
    expect(view.focus, "焦点は付けられる次の列").toBe(fid.col(1));
    const ids = SKILLS_VIEW.layout(state, ui, view).map((h) => h.id);
    expect(ids, "持ち上げ中の当たりは列だけ").toEqual([0, 1, 2, 3].map(fid.col));

    tap(state, ui);
    expect(runes(state, 0), "元の列から消える").toEqual(["focus"]);
    expect(runes(state, 1), "石 1 に付く").toEqual(["echo"]);
    expect(skillsView(ui).lift, "持ち上げが終わる").toBeNull();
    expect(state.sfx, "付けた効果音").toContain("runeAttach");
  });

  it("置けない列では知らせだけで動かない", () => {
    const { state, ui } = openSkills();
    const second = state.skills.slots[1];
    if (!second) throw new Error("スロット 1 が無い");
    second.runModifiers = ["echo"];
    confirmOn(state, ui, fid.rune(0, "echo"));
    confirmOn(state, ui, fid.col(1));
    expect(runes(state, 0), "動かない").toEqual(["echo", "focus"]);
    expect(runes(state, 1)).toEqual(["echo"]);
    expect(skillsView(ui).lift, "持ち上げたまま").toEqual({ slot: 0, key: "echo" });
    expect(ui.note?.text, "同じ符が付いている").toBe("同じ符が付いています");
    confirmOn(state, ui, fid.col(3));
    expect(ui.note?.text, "石の無い列").toBe("石の無い列には置けません");
    expect(stoneInSlot(state.skills.profile, 3), "前提: 石 3 は空").toBeNull();
  });

  it("戻るで持ち上げをやめ、元の列のまま", () => {
    const { state, ui } = openSkills();
    confirmOn(state, ui, fid.rune(0, "echo"));
    const depth = ui.stack.length;
    frame(state, ui, {}, { back: true });
    expect(skillsView(ui).lift, "持ち上げをやめる").toBeNull();
    expect(ui.stack, "頁は戻らない").toHaveLength(depth);
    expect(runes(state, 0), "元の列のまま").toEqual(["echo", "focus"]);
    expect(skillsView(ui).focus, "焦点は元の符").toBe(fid.rune(0, "echo"));
    frame(state, ui, {}, { back: true });
    expect(ui.stack.length, "もう 1 度戻ると頁を戻る").toBe(depth - 1);
  });

  it("符の長押しで外れて消える", () => {
    const { state, ui } = openSkills();
    skillsView(ui).focus = fid.rune(0, "focus");
    frame(state, ui, { confirmPressed: true }, { confirmHeld: true });
    expect(runes(state, 0), "押しただけでは外れない").toEqual(["echo", "focus"]);
    for (let i = 0; i < 45; i++) frame(state, ui, {}, { confirmHeld: true });
    expect(runes(state, 0), "0.6 秒で外れる").toEqual(["echo"]);
    expect(runes(state, 1), "どこにも移らない").toEqual([]);
    expect(state.sfx, "外した効果音").toContain("dismantle");
  });

  it("符を先に離せば長押しにならず、持ち上げになる", () => {
    const { state, ui } = openSkills();
    skillsView(ui).focus = fid.rune(0, "focus");
    frame(state, ui, { confirmPressed: true }, { confirmHeld: true });
    frame(state, ui, {}, { confirmHeld: false });
    expect(skillsView(ui).lift, "持ち上げ中").toEqual({ slot: 0, key: "focus" });
    expect(runes(state, 0), "外れていない").toEqual(["echo", "focus"]);
  });

  it("祝福の符は持ち上げられない", () => {
    const state = createGame(1);
    grantBoon(state, "echoCall");
    const ui = createInventoryUi(createCraftSave());
    openMenu(state, ui, "skills");
    const granted = columnRunes(state, 0).find((p) => p.key === "echo");
    if (!granted) throw new Error("祝福の符が列に無い");
    expect(granted.run, "祝福の符は run = false").toBe(false);
    confirmOn(state, ui, fid.rune(0, "echo"));
    expect(skillsView(ui).lift, "持ち上がらない").toBeNull();
    expect(ui.note?.text, "知らせ").toBe(RUNE_BLOCK_TEXT.granted);
    const hit = SKILLS_VIEW.layout(state, ui, skillsView(ui)).find((h) => h.id === fid.rune(0, "echo"));
    expect(hit?.hold, "祝福の符は長押しで外せない").toBeNull();
  });

  it("今の石に効かない符は下の列に並び、持ち上げて動かせる", () => {
    const { state, ui } = openSkills();
    const third = state.skills.slots[3];
    if (!third) throw new Error("スロット 3 が無い");
    third.runModifiers = ["echo"];
    const loose = looseRunes(state);
    expect(loose.map((p) => [p.slot, p.key]), "石の無い列の符は効かない符").toEqual([[3, "echo"]]);
    const ids = SKILLS_VIEW.layout(state, ui, skillsView(ui)).map((h) => h.id);
    expect(ids, "効かない符の当たり").toContain(fid.loose(3, "echo"));
    confirmOn(state, ui, fid.loose(3, "echo"));
    expect(skillsView(ui).lift, "持ち上がる").toEqual({ slot: 3, key: "echo" });
  });

  it("符の荷札と書付は焦点の符を指し、持ち上げ中は書付が無い", () => {
    const { state, ui } = openSkills();
    const view = skillsView(ui);
    view.focus = fid.rune(0, "echo");
    expect(SKILLS_VIEW.sheetFor(state, view), "符の書付").toEqual({ kind: "rune", key: "echo" });
    const tag = SKILLS_VIEW.tag(state, ui, view, null);
    expect(tag.title, "荷札に符の名前").not.toBe("");
    view.focus = fid.stone(0);
    const stone = stoneInSlot(state.skills.profile, 0);
    expect(SKILLS_VIEW.sheetFor(state, view), "石の書付").toEqual({ kind: "stone", stoneId: stone?.id });
    confirmOn(state, ui, fid.rune(0, "echo"));
    const lifted: MenuView = skillsView(ui);
    expect(lifted.kind === "skills" ? SKILLS_VIEW.sheetFor(state, lifted) : "x", "持ち上げ中は書付なし").toBeNull();
  });
});
