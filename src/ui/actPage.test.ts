import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import type { FrameInput } from "../core/input";
import type { GameState } from "../core/state";
import { createCraftSave } from "../loot/craftingStore";
import { generateItem } from "../loot/generator";
import { createRng } from "../core/rng";
import type { AffixRoll, Item } from "../loot/types";
import { BOON_KEYS, BOONS, type BoonKey } from "../system/boonDefs";
import { grantBoon } from "../system/boons";
import { relicKeywords } from "../system/keywords";
import { withInput } from "../system/testHelpers";
import { ACTION_KEYWORD, ACT_VIEW, actionKeyword, feedsOfAction, relicsOnAction } from "./actPage";
import { createInventoryUi, updateInventoryUi } from "./inventory";
import { fid } from "./menuFocus";
import { type InventoryUi, type MenuView, type ViewOf, topView } from "./menuState";

/** ダッシュの加護の札（ひとつ） */
function dashGrace(): BoonKey {
  const key = BOON_KEYS.find((k) => BOONS[k].card === "grace" && BOONS[k].action === "dash");
  if (key === undefined) throw new Error("ダッシュの加護が無い");
  return key;
}

/** ダッシュを糧に持つ性質（霜の轍）だけの長靴 */
function dashBoots(): Item {
  const roll: AffixRoll = { key: "frostTrail", value: 2, value2: 10, nominal: 2, flux: 0, color: "azure", origin: "found" };
  const base = generateItem(createRng(3), { itemLevel: 1, foundDepth: 1, now: 1 });
  return { ...base, id: "dash-boots", slot: "boots", affixes: [roll], namedKey: undefined };
}

/** ダッシュの加護を 1 つ取り、ダッシュ系の長靴を履き、紋の面から加護の頁（ダッシュ）を開く */
function openAct(): { state: GameState; ui: InventoryUi; grace: BoonKey } {
  const state = createGame(1);
  const grace = dashGrace();
  grantBoon(state, grace);
  state.profile.equipment.boots = dashBoots();
  const ui = createInventoryUi(createCraftSave());
  ui.open = true;
  state.paused = true;
  const view: ViewOf<"act"> = { kind: "act", focus: null, action: "dash" };
  ui.stack = [{ kind: "crest", focus: fid.daiAct("dash") }, view];
  return { state, ui, grace };
}

function actView(ui: InventoryUi): ViewOf<"act"> {
  const view = topView(ui);
  if (view?.kind !== "act") throw new Error("加護の頁が開いていない");
  return view;
}

function frame(state: GameState, ui: InventoryUi, input: Partial<FrameInput>): void {
  updateInventoryUi(state, ui, withInput(input), 1 / 60);
}

function confirmOn(state: GameState, ui: InventoryUi, focus: string): void {
  actView(ui).focus = focus;
  frame(state, ui, { confirmPressed: true });
}

function top(ui: InventoryUi): MenuView | null {
  return topView(ui);
}

describe("加護の頁", () => {
  it("加護の頁は行動の加護・乗る遺物・注ぐ系統を出す", () => {
    const { state, ui, grace } = openAct();
    const view = actView(ui);
    const ids = ACT_VIEW.layout(state, ui, view).map((h) => h.id);
    expect(ids, "加護").toContain(fid.grace(grace));
    expect(ids, "乗る遺物（ダッシュを糧に持つ長靴）").toContain(fid.relic("boots"));
    for (const a of ["primary", "secondary", "dash", "skill", "ultimate"] as const) expect(ids, `行動の札 ${a}`).toContain(fid.action(a));
    expect(ids.filter((id) => id.startsWith("empty:")), "枠の残りは空き").toHaveLength(1);
    expect(relicsOnAction(state, "dash").map((r) => r.slot), "乗る遺物").toEqual(["boots"]);
    expect(relicsOnAction(state, "ultimate"), "奥義ゲージ系の遺物は無い").toEqual([]);
    const feeds = feedsOfAction(state, "dash");
    expect(feeds.length, "ダッシュの加護は系統を起こす").toBeGreaterThan(0);
    expect(feeds, "加護が起こす系統").toEqual(BOONS[grace].keywords.produces.filter((k, i, all) => all.indexOf(k) === i).slice(0, 5));
  });

  it("行動の札で決定すると別の行動の頁になり、加護の枠が替わる", () => {
    const { state, ui } = openAct();
    confirmOn(state, ui, fid.action("primary"));
    const view = actView(ui);
    expect(view.action, "左へ").toBe("primary");
    expect(view.focus, "焦点は行動の札のまま").toBe(fid.action("primary"));
    const ids = ACT_VIEW.layout(state, ui, view).map((h) => h.id);
    expect(ids.some((id) => id.startsWith("grace:")), "左の加護は無い").toBe(false);
    expect(ids.filter((id) => id.startsWith("empty:")).length, "空きが並ぶ").toBeGreaterThanOrEqual(2);
  });

  it("乗る遺物で決定すると装束のその部位へ跳ぶ", () => {
    const { state, ui } = openAct();
    confirmOn(state, ui, fid.relic("boots"));
    expect(ui.stack.map((v) => v.kind), "装束だけ").toEqual(["attire"]);
    expect(top(ui)?.focus, "長靴に焦点").toBe(fid.part("boots"));
  });

  it("加護で決定すると書付「祝福」が積まれる", () => {
    const { state, ui, grace } = openAct();
    confirmOn(state, ui, fid.grace(grace));
    const view = top(ui);
    expect(view?.kind === "sheet" ? view.subject : null, "加護の書付").toEqual({ kind: "boon", key: grace });
    expect(ui.stack.map((v) => v.kind), "加護の頁の上に積む").toEqual(["crest", "act", "sheet"]);
  });

  it("荷札と書付は焦点の加護・遺物を指す", () => {
    const { state, ui, grace } = openAct();
    const view = actView(ui);
    view.focus = fid.grace(grace);
    expect(ACT_VIEW.sheetFor(state, view), "加護の書付").toEqual({ kind: "boon", key: grace });
    expect(ACT_VIEW.tag(state, ui, view, null).title, "荷札に加護の名前").toContain(BOONS[grace].name);
    view.focus = fid.relic("boots");
    expect(ACT_VIEW.sheetFor(state, view), "遺物の書付").toEqual({ kind: "item", itemId: "dash-boots" });
    view.focus = "empty:1";
    expect(ACT_VIEW.sheetFor(state, view), "空き枠に書付は無い").toBeNull();
    expect(ACT_VIEW.tag(state, ui, view, null).title, "空き枠の荷札").not.toBe("");
  });

  it("行動の系統の表: 左右は近接、銃の家系は射撃、他は行動ごと", () => {
    const state = createGame(1);
    expect(ACTION_KEYWORD.dash).toBe("dash");
    expect(ACTION_KEYWORD.skill).toBe("mana");
    expect(ACTION_KEYWORD.ultimate).toBe("energy");
    expect(actionKeyword(state, "primary"), "既定の剣は近接").toBe("melee");
    state.stats.moveset = "sidearm";
    expect(actionKeyword(state, "primary"), "銃は射撃").toBe("ranged");
    expect(actionKeyword(state, "dash"), "ダッシュは武器種に依らない").toBe("dash");
    expect(relicKeywords(dashBoots()).consumes, "前提: 霜の轍はダッシュを糧に持つ").toContain("dash");
  });
});
