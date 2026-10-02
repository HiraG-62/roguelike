import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import type { Keyword } from "../core/keywords";
import type { FrameInput } from "../core/input";
import type { GameState } from "../core/state";
import { createCraftSave } from "../loot/craftingStore";
import { MODIFIERS } from "../skills/data";
import { stoneInSlot, unequipSlot } from "../skills/persistence";
import type { ModifierKey } from "../skills/types";
import { returnInactiveRunes, runeMoveBlock } from "../system/skills";
import { grantBoon } from "../system/boons";
import { withInput } from "../system/testHelpers";
import { createInventoryUi, updateInventoryUi } from "./inventory";
import { openMenu } from "./menuActions";
import { fid } from "./menuFocus";
import { HAND_SLOT, type InventoryUi, type MenuSignals, type MenuView, type ViewOf, defaultHandOptions, topView } from "./menuState";
import { handGroups, handKeywordChoices, runeKeywords, runeKindLabel } from "./handRunes";
import { HAND_CAPACITY, HAND_CHIPS, SKILLS_VIEW, columnRunes, firstPlaceableColumn, handEntries, handOptionsOf } from "./skillPage";
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

/** どれかのスキルに付けられるか（絞り込み「付けられる物だけ」の期待値を自前で数える） */
function runeFits(state: GameState, key: ModifierKey): boolean {
  return [0, 1, 2, 3].some((i) => runeMoveBlock(state.skills, i, key) === null);
}

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
    expect(ui.note?.text, "石の無い列").toBe("石の無い列には付けられません");
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

  it("符の長押しで外れて手持ちへ戻る", () => {
    const { state, ui } = openSkills();
    skillsView(ui).focus = fid.rune(0, "focus");
    frame(state, ui, { confirmPressed: true }, { confirmHeld: true });
    expect(runes(state, 0), "押しただけでは外れない").toEqual(["echo", "focus"]);
    for (let i = 0; i < 45; i++) frame(state, ui, {}, { confirmHeld: true });
    expect(runes(state, 0), "0.6 秒で外れる").toEqual(["echo"]);
    expect(runes(state, 1), "ほかの列には移らない").toEqual([]);
    expect(state.skills.hand, "外した符は手持ちへ戻る").toEqual(["focus"]);
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

  it("効かない符の欄は無く、符の当たりは付いている符（穴）と手持ちだけ", () => {
    const { state, ui } = openSkills();
    const ids = SKILLS_VIEW.layout(state, ui, skillsView(ui)).map((h) => h.id);
    expect(ids.some((id) => id.startsWith("loose:")), "効かない符の当たりは無い").toBe(false);
  });
});

/** 手持ちに符を入れてスキルの頁を開く */
function openWithHand(hand: ModifierKey[]): { state: GameState; ui: InventoryUi } {
  const state = createGame(1);
  state.skills.hand = [...hand];
  const ui = createInventoryUi(createCraftSave());
  openMenu(state, ui, "skills");
  return { state, ui };
}

describe("スキルの頁: 手持ちの符", () => {
  it("同じ符は 1 枚にまとめて数を持ち、手持ちの当たりが並ぶ", () => {
    const { state, ui } = openWithHand(["echo", "focus", "echo", "echo"]);
    const entries = handEntries(state, ui, skillsView(ui));
    expect(entries.map((g) => [g.key, g.count]).sort(), "束ねた 2 枚").toEqual([["echo", 3], ["focus", 1]]);
    const ids = SKILLS_VIEW.layout(state, ui, skillsView(ui)).map((h) => h.id);
    expect(ids, "束ねた符ごとに当たり").toContain(fid.hand("echo"));
    expect(ids.filter((id) => id.startsWith("hand:")), "同じ符の当たりは 1 つ").toHaveLength(2);
    expect(entries.length, "格子に収まる").toBeLessThanOrEqual(HAND_CAPACITY);
  });

  it("手持ちの符を決定すると持ち上がり、付けられる列へ焦点が移る（state はまだ動かない）", () => {
    const { state, ui } = openWithHand(["echo"]);
    confirmOn(state, ui, fid.hand("echo"));
    const view = skillsView(ui);
    expect(view.lift, "手持ちから持ち上げ").toEqual({ slot: HAND_SLOT, key: "echo" });
    expect(view.focus, "付けられる最初の列").toBe(fid.col(firstPlaceableColumn(state, "echo")));
    expect(state.skills.hand, "持ち上げただけでは減らない").toEqual(["echo"]);
    expect(SKILLS_VIEW.layout(state, ui, view).map((h) => h.id), "当たりは列だけ").toEqual([0, 1, 2, 3].map(fid.col));
  });

  it("付けられる列を決定すると付き、手持ちから 1 枚減る（同じ符が複数なら残る）", () => {
    const { state, ui } = openWithHand(["echo", "echo"]);
    confirmOn(state, ui, fid.hand("echo"));
    const to = firstPlaceableColumn(state, "echo");
    confirmOn(state, ui, fid.col(to));
    expect(runes(state, to), "その列に付く").toEqual(["echo"]);
    expect(state.skills.hand, "手持ちが 1 枚減る").toEqual(["echo"]);
    expect(skillsView(ui).lift, "持ち上げが終わる").toBeNull();
    expect(state.sfx, "付けた効果音").toContain("runeAttach");
    expect(skillsView(ui).focus, "焦点は付いた符").toBe(fid.rune(to, "echo"));
  });

  it("付けられない列を決定しても付かず、理由を知らせて持ち上げたまま", () => {
    const { state, ui } = openWithHand(["echo"]);
    confirmOn(state, ui, fid.hand("echo"));
    confirmOn(state, ui, fid.col(3));
    expect(state.skills.hand, "手持ちは減らない").toEqual(["echo"]);
    expect(runes(state, 3), "付かない").toEqual([]);
    expect(skillsView(ui).lift, "持ち上げたまま").not.toBeNull();
    expect(ui.note?.text, "石が無い理由").toBe("石の無い列には付けられません");
  });

  it("戻るで手持ちの符の持ち上げをやめると、手持ちの符に焦点が戻る", () => {
    const { state, ui } = openWithHand(["focus"]);
    confirmOn(state, ui, fid.hand("focus"));
    frame(state, ui, {}, { back: true });
    expect(skillsView(ui).lift).toBeNull();
    expect(skillsView(ui).focus).toBe(fid.hand("focus"));
    expect(state.skills.hand, "手持ちのまま").toEqual(["focus"]);
  });

  it("付いている符を手持ちへ戻した後、付け直せる（往復しても枚数が変わらない）", () => {
    const { state, ui } = openSkills();
    skillsView(ui).focus = fid.rune(0, "focus");
    frame(state, ui, { confirmPressed: true }, { confirmHeld: true });
    for (let i = 0; i < 45; i++) frame(state, ui, {}, { confirmHeld: true });
    expect(state.skills.hand).toEqual(["focus"]);
    confirmOn(state, ui, fid.hand("focus"));
    confirmOn(state, ui, fid.col(0));
    expect(runes(state, 0), "元の列に付け直せる").toEqual(["echo", "focus"]);
    expect(state.skills.hand).toEqual([]);
  });

  it("並び・種類・付けられる物だけの札を決定すると、順に送られ手持ちが絞られる", () => {
    const { state, ui } = openWithHand(["echo", "focus", "bloodPrice", "spillover", "echo"]);
    const total = handEntries(state, ui, skillsView(ui)).length;
    expect(handOptionsOf(ui, skillsView(ui)), "既定は新着順・絞らない").toEqual({ sort: "new", kind: null, keyword: null, fitOnly: false });
    const chipIds = SKILLS_VIEW.layout(state, ui, skillsView(ui)).map((h) => h.id);
    for (const axis of Object.keys(HAND_CHIPS)) expect(chipIds, `札 ${axis}`).toContain(`handopt:${axis}`);

    confirmOn(state, ui, fid.handOpt("sort"));
    expect(ui.handPref.sort, "新着 → 名前").toBe("name");
    const names = handEntries(state, ui, skillsView(ui)).map((g) => MODIFIERS[g.key].name);
    expect(names, "名前順").toEqual([...names].sort());

    confirmOn(state, ui, fid.handOpt("kind"));
    expect(ui.handPref.kind, "種類 全 → 変形").toBe("shape");
    const shaped = handEntries(state, ui, skillsView(ui));
    expect(shaped.every((g) => MODIFIERS[g.key].family === "shape"), "変形だけ").toBe(true);
    expect(shaped.length, "絞れている").toBeLessThanOrEqual(total);

    confirmOn(state, ui, fid.handOpt("fit"));
    expect(ui.handPref.fitOnly, "付けられる物だけ").toBe(true);
    const fit = handEntries(state, ui, skillsView(ui));
    expect(fit.every((g) => runeFits(state, g.key)), "どれかのスキルに付く").toBe(true);
    expect(skillsView(ui).focus, "焦点は札に残る").toBe(fid.handOpt("fit"));
  });

  it("手持ちの設定は頁を開き直しても保たれる", () => {
    const { state, ui } = openWithHand(["echo", "focus"]);
    confirmOn(state, ui, fid.handOpt("sort"));
    openMenu(state, ui, "skills");
    expect(handOptionsOf(ui, skillsView(ui)).sort, "名前順のまま").toBe("name");
  });

  it("手持ちの符の荷札と書付は焦点の符を指す", () => {
    const { state, ui } = openWithHand(["echo", "echo"]);
    const view = skillsView(ui);
    view.focus = fid.hand("echo");
    expect(SKILLS_VIEW.sheetFor(state, view), "符の書付").toEqual({ kind: "rune", key: "echo" });
    expect(SKILLS_VIEW.tag(state, ui, view, null).title, "荷札に枚数").toContain("×2");
  });

  it("石を外して付かなくなった符は手持ちへ戻る", () => {
    const { state } = openWithHand([]);
    const slot = state.skills.slots[0];
    if (!slot) throw new Error("スロット 0 が無い");
    slot.runModifiers = ["echo"];
    unequipSlot(state.skills.profile, 0);
    expect(returnInactiveRunes(state), "戻した枚数").toBe(1);
    expect(slot.runModifiers).toEqual([]);
    expect(state.skills.hand).toEqual(["echo"]);
  });
});

describe("手持ちの符の並びと絞り込み（handRunes）", () => {
  it("名前順・種類順・新着順で並び、新着は最後に拾った符が先頭", () => {
    const { state } = openWithHand(["focus", "echo", "bloodPrice"]);
    const base = defaultHandOptions();
    expect(handGroups(state, { ...base, sort: "new" }).map((g) => g.key), "新着順").toEqual(["bloodPrice", "echo", "focus"]);
    const byName = handGroups(state, { ...base, sort: "name" }).map((g) => MODIFIERS[g.key].name);
    expect(byName, "名前順").toEqual([...byName].sort());
    const kinds = handGroups(state, { ...base, sort: "kind" }).map((g) => runeKindLabel(g.key));
    expect(kinds.length, "種類順でも全部並ぶ").toBe(3);
  });

  it("系統の札が送る値は手持ちに出てくる語だけ", () => {
    const { state } = openWithHand(["echo"]);
    const choices = handKeywordChoices(state);
    expect(choices[0], "先頭は絞らない").toBeNull();
    expect(choices.slice(1).every((k) => runeKeywords("echo").includes(k as Keyword)), "手持ちの符の語だけ").toBe(true);
  });
});
