import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import type { FrameInput } from "../core/input";
import { type GameState } from "../core/state";
import type { Vec } from "../core/vec";
import { createCraftSave } from "../loot/craftingStore";
import { MemoryStorage } from "../meta/testStorage";
import { setSaveStorage } from "../save/backend";
import { stoneFromSeed } from "../skills/generator";
import { addStone, equipStone, stoneInSlot } from "../skills/persistence";
import { SKILL_KEYS } from "../skills/types";
import { withInput } from "../system/testHelpers";
import { ATTIRE_VIEW } from "./attire";
import { CANDIDATES_VIEW, candidateEntries, entryFocusId, isStoneWorn } from "./candidates";
import { createInventoryUi, dragTag, menuHits, updateInventoryUi } from "./inventory";
import { fid } from "./menuFocus";
import { type InventoryUi, type MenuHit, type MenuView, type Rect, type ViewOf, topView } from "./menuState";
import { SKILLS_VIEW, colRect } from "./skillPage";

const DT = 1 / 60;

beforeEach(() => {
  setSaveStorage(new MemoryStorage());
});
afterEach(() => {
  setSaveStorage(null);
});

function frame(state: GameState, ui: InventoryUi, input: Partial<FrameInput> = {}, back = false): void {
  updateInventoryUi(state, ui, withInput(input), DT, { back, confirmHeld: false });
}

/** 石 10 個・4 枠に 1 個ずつ付けた状態 */
function stoneState(): GameState {
  const state = createGame(1);
  state.profile.stash = [];
  const profile = state.skills.profile;
  profile.stones = [];
  profile.loadout = [null, null, null, null];
  SKILL_KEYS.slice(0, 10).forEach((skillKey, i) => addStone(profile, stoneFromSeed(50 + i, { skillKey, foundDepth: 1, now: i })));
  profile.stones.slice(0, 4).forEach((s, i) => equipStone(profile, s.id, i));
  return state;
}

function open(state: GameState, views: MenuView[]): InventoryUi {
  const ui = createInventoryUi(createCraftSave());
  frame(state, ui, { inventoryPressed: true });
  ui.stack.push(...views);
  return ui;
}

function stoneCandidates(index: number): ViewOf<"candidates"> {
  return { kind: "candidates", focus: null, target: { kind: "stone", index }, sort: "fit", offset: 0, order: null, pinnedId: null };
}

function center(r: Readonly<Rect>): Vec {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

function hitOf(state: GameState, ui: InventoryUi, id: string): MenuHit {
  const hit = menuHits(state, ui).find((h) => h.id === id);
  if (hit === undefined) throw new Error(`当たりが無い: ${id}`);
  return hit;
}

/** from で押し、to へ動かして離す */
function dragTo(state: GameState, ui: InventoryUi, from: Vec, to: Vec): void {
  frame(state, ui, { aimScreen: from });
  frame(state, ui, { aimScreen: from, clickPressed: true, clickHeld: true });
  frame(state, ui, { aimScreen: to, clickHeld: true });
  frame(state, ui, { aimScreen: to });
}

function loadoutIds(state: GameState): (string | null)[] {
  return [0, 1, 2, 3].map((i) => stoneInSlot(state.skills.profile, i)?.id ?? null);
}

describe("腰の石のドラッグで入れ替え", () => {
  it("候補の頁の左下の石を別の石へ落とすと入れ替わる（今の枠の石も掴める）", () => {
    const state = stoneState();
    const ui = open(state, [stoneCandidates(0)]);
    const before = loadoutIds(state);
    dragTo(state, ui, center(hitOf(state, ui, fid.gem(0)).rect), center(hitOf(state, ui, fid.gem(2)).rect));
    expect(loadoutIds(state), "スキル 1 と 3 が入れ替わる").toEqual([before[2], before[1], before[0], before[3]]);
    expect(ui.drag, "離したら掴むのをやめる").toBeNull();
    expect(ui.note?.text, "知らせ").toContain("入れ替えた");
  });

  it("動かさずに離せばクリック（その枠の候補の頁へ替わる）で、入れ替えない", () => {
    const state = stoneState();
    const ui = open(state, [stoneCandidates(0)]);
    const before = loadoutIds(state);
    const at = center(hitOf(state, ui, fid.gem(2)).rect);
    frame(state, ui, { aimScreen: at });
    frame(state, ui, { aimScreen: at, clickPressed: true, clickHeld: true });
    expect(topView(ui)?.kind === "candidates" && topView(ui)?.kind, "押しただけではまだ替わらない").toBe("candidates");
    frame(state, ui, { aimScreen: at });
    const top = topView(ui);
    expect(top?.kind === "candidates" ? top.target : null, "離すとスキル 3 の候補").toEqual({ kind: "stone", index: 2 });
    expect(loadoutIds(state), "入れ替えない").toEqual(before);
  });

  it("何も無い所で離すと何も起きず、戻るで掴むのをやめられる", () => {
    const state = stoneState();
    const ui = open(state, [stoneCandidates(0)]);
    const before = loadoutIds(state);
    const from = center(hitOf(state, ui, fid.gem(1)).rect);
    dragTo(state, ui, from, { x: 400, y: 100 });
    expect(loadoutIds(state), "落とし先が無ければそのまま").toEqual(before);

    frame(state, ui, { aimScreen: from });
    frame(state, ui, { aimScreen: from, clickPressed: true, clickHeld: true });
    frame(state, ui, { aimScreen: center(hitOf(state, ui, fid.gem(3)).rect), clickHeld: true });
    frame(state, ui, { clickHeld: true }, true);
    expect(ui.drag, "戻るで掴むのをやめる").toBeNull();
    expect(ui.stack.length, "頁は戻らない").toBe(2);
    frame(state, ui, {});
    expect(loadoutIds(state), "入れ替えない").toEqual(before);
  });

  it("スキルの頁は石を別の列のどこへ落としても入れ替わる", () => {
    const state = stoneState();
    const ui = open(state, [{ kind: "skills", focus: null, lift: null }]);
    const before = loadoutIds(state);
    const col = colRect(3);
    dragTo(state, ui, center(hitOf(state, ui, fid.stone(0)).rect), { x: col.x + 4, y: col.y + col.h - 4 });
    expect(loadoutIds(state)).toEqual([before[3], before[1], before[2], before[0]]);
    expect(SKILLS_VIEW.layout(state, ui, { kind: "skills", focus: null, lift: null }).find((h) => h.id === fid.stone(1))?.drag?.zone, "落とし先は列全体").toEqual(colRect(1));
  });

  it("装束の頁の腰の石も入れ替えられる", () => {
    const state = stoneState();
    const ui = open(state, []);
    const before = loadoutIds(state);
    expect(ATTIRE_VIEW.layout(state, ui, ui.stack[0] as ViewOf<"attire">).filter((h) => h.drag !== undefined)).toHaveLength(4);
    dragTo(state, ui, center(hitOf(state, ui, fid.stone(1)).rect), center(hitOf(state, ui, fid.stone(3)).rect));
    expect(loadoutIds(state)).toEqual([before[0], before[3], before[2], before[1]]);
  });

  it("動かしている間の荷札は、離したら何が起きるかを言う", () => {
    const state = stoneState();
    const ui = open(state, [stoneCandidates(0)]);
    const from = center(hitOf(state, ui, fid.gem(0)).rect);
    frame(state, ui, { aimScreen: from });
    frame(state, ui, { aimScreen: from, clickPressed: true, clickHeld: true });
    expect(dragTag(state, ui, menuHits(state, ui)), "動かす前は出さない").toBeNull();
    frame(state, ui, { aimScreen: center(hitOf(state, ui, fid.gem(1)).rect), clickHeld: true });
    expect(dragTag(state, ui, menuHits(state, ui))?.sub).toContain("スキル 2 と入れ替え");
  });
});

describe("候補の頁の装備中の札", () => {
  it("今の枠の石が先頭に装備中として並び、開いたときの焦点は比べる相手の札", () => {
    const state = stoneState();
    const ui = open(state, [stoneCandidates(0)]);
    const view = ui.stack[1] as ViewOf<"candidates">;
    const entries = candidateEntries(state, view);
    expect(entries[0]?.kind, "先頭は装備中").toBe("worn");
    frame(state, ui, {});
    expect(view.focus, "焦点は装備中の札ではない").not.toBe(fid.worn);
    expect(CANDIDATES_VIEW.sheetFor(state, { ...view, focus: fid.worn }), "書付は付けている石").toEqual({ kind: "stone", stoneId: stoneInSlot(state.skills.profile, 0)?.id });
    const worn = CANDIDATES_VIEW.layout(state, ui, view).find((h) => h.id === fid.worn);
    expect(worn?.act ?? null, "決定では何も起きない").toBeNull();
  });

  it("別の枠に付けている石は装備中とわかる", () => {
    const state = stoneState();
    const ui = open(state, [stoneCandidates(0)]);
    const view = ui.stack[1] as ViewOf<"candidates">;
    const other = stoneInSlot(state.skills.profile, 2);
    if (other === null) throw new Error("石が無い");
    expect(candidateEntries(state, view).map(entryFocusId), "別の枠の石も並ぶ").toContain(fid.cand(other.id));
    expect(isStoneWorn(state, other.id)).toBe(true);
    const loose = state.skills.profile.stones[5];
    expect(loose !== undefined && isStoneWorn(state, loose.id), "付けていない石は違う").toBe(false);
  });
});
