import { describe, expect, it } from "vitest";
import { createGame } from "../core/game";
import type { FrameInput } from "../core/input";
import { createRng } from "../core/rng";
import type { GameState } from "../core/state";
import { createCraftSave } from "../loot/craftingStore";
import { describeTrait } from "../loot/describe";
import { generateItem } from "../loot/generator";
import type { AffixRoll, Item } from "../loot/types";
import { relicKeywords } from "../system/keywords";
import { withInput } from "../system/testHelpers";
import { crestShape, sourceKey } from "./crestShape";
import { BOARD_KEYWORDS, FLOW_BOARD_VIEW, FLOW_VIEW, flowCards } from "./flow";
import { createInventoryUi, menuHits, updateInventoryUi } from "./inventory";
import { openMenu } from "./menuActions";
import { fid } from "./menuFocus";
import { type InventoryUi, type MenuView, type ViewOf, topView } from "./menuState";

const burn: AffixRoll = { key: "burn", value: 12, value2: 4, nominal: 12, flux: 0, color: "crimson", origin: "found" };
const melee: AffixRoll = { key: "damageVsStaggered", value: 30, nominal: 25, flux: 0.6, color: "crimson", origin: "found" };

function wornRelic(affixes: AffixRoll[]): Item {
  return { ...generateItem(createRng(7), { itemLevel: 1, foundDepth: 1, now: 100 }), id: "worn-main", slot: "mainHand", affixes, namedKey: undefined };
}

function stateWith(item: Item): GameState {
  const state = createGame(1);
  state.profile.equipment.mainHand = item;
  return state;
}

/** 紋の上に系統の頁を積んだ状態 */
function openFlow(state: GameState, keyword: ViewOf<"flow">["keyword"]): { ui: InventoryUi; view: ViewOf<"flow"> } {
  const ui = createInventoryUi(createCraftSave());
  openMenu(state, ui, "attire");
  const view: ViewOf<"flow"> = { kind: "flow", focus: null, keyword };
  ui.stack = [{ kind: "crest", focus: fid.band(keyword) }, view];
  return { ui, view };
}

function confirmOn(state: GameState, ui: InventoryUi, focus: string): void {
  const view = topView(ui);
  if (view === null) throw new Error("開いていない");
  view.focus = focus;
  const input: Partial<FrameInput> = { confirmPressed: true };
  updateInventoryUi(state, ui, withInput(input), 1 / 60);
}

function top(ui: InventoryUi): MenuView {
  const v = topView(ui);
  if (v === null) throw new Error("頁が無い");
  return v;
}

function relicCard(state: GameState, keyword: ViewOf<"flow">["keyword"]) {
  const card = flowCards(state, keyword).find((c) => c.origin?.kind === "relic");
  if (card?.origin == null) throw new Error("遺物の札が無い");
  return { card, origin: card.origin };
}

describe("系統の頁", () => {
  it("札で決定するとその物の置き場へ跳ぶ", () => {
    const state = stateWith(wornRelic([burn]));
    const { ui } = openFlow(state, "burn");
    const { card, origin } = relicCard(state, "burn");
    confirmOn(state, ui, fid.src(sourceKey(origin), card.verb));
    expect(ui.stack.map((v) => v.kind), "装束へ跳ぶ").toEqual(["attire"]);
    expect(top(ui).focus, "右手に焦点").toBe(fid.part("mainHand"));
  });

  it("畳んだ帯で決定すると系統が替わる", () => {
    const state = stateWith(wornRelic([burn]));
    const { ui } = openFlow(state, "burn");
    const other = crestShape(state).rows.find((r) => r.keyword !== "burn");
    if (other === undefined) throw new Error("ほかの帯が無い");
    confirmOn(state, ui, fid.fold(other.keyword));
    const view = top(ui);
    expect(view.kind === "flow" ? view.keyword : null, "その系統の頁に替わる").toBe(other.keyword);
    expect(ui.stack, "積み重ねは増えない").toHaveLength(2);
  });

  it("系統の頁の荷札はその系統に触れる行だけ", () => {
    const state = stateWith(wornRelic([burn, melee]));
    const item = state.profile.equipment.mainHand;
    if (!item) throw new Error("遺物が無い");
    const touchesBurn = (roll: AffixRoll): boolean => {
      const p = relicKeywords({ ...item, affixes: [roll], namedKey: undefined });
      return [...p.produces, ...p.consumes, ...p.amplifies].includes("burn");
    };
    expect(touchesBurn(burn), "前提: 炎上は燃焼系に触れる").toBe(true);
    expect(touchesBurn(melee), "前提: 崩し特攻は燃焼系に触れない").toBe(false);

    const { ui, view } = openFlow(state, "burn");
    const { card, origin } = relicCard(state, "burn");
    view.focus = fid.src(sourceKey(origin), card.verb);
    const tag = FLOW_VIEW.tag(state, ui, view, null);
    expect(tag.sub, "触れる行を出す").toContain(describeTrait(burn).text);
    expect(tag.sub, "触れない行は出さない").not.toContain(describeTrait(melee).text);
  });

  it("足りない側の＋で、その系統で絞った候補が積まれる", () => {
    const state = createGame(1);
    const { ui, view } = openFlow(state, "melee");
    const plus = flowCards(state, "melee").find((c) => c.origin === null && c.verb === "consumes");
    if (plus === undefined) throw new Error("糧の＋が無い");
    expect(menuHits(state, ui).some((h) => h.id === fid.plus("melee", "consumes")), "＋に当たりがある").toBe(true);
    confirmOn(state, ui, fid.plus(view.keyword, "consumes"));
    const next = top(ui);
    expect(next.kind === "candidates" ? next.target : null, "近接系の糧").toEqual({ kind: "flow", keyword: "melee", verb: "consumes" });
  });

  it("焦点の初期位置は源の先頭で、見出しに数を出さない", () => {
    const state = stateWith(wornRelic([burn]));
    const { ui, view } = openFlow(state, "burn");
    const first = menuHits(state, ui).find((h) => h.nav);
    expect(first?.id.startsWith("src:") || first?.id.startsWith("plus:"), "先頭は札").toBe(true);
    expect(FLOW_VIEW.header(state, ui, view).right, "右の欄は空").toBeNull();
  });
});

describe("系統を選ぶ盤", () => {
  it("数えない語を除いた 40 の系統が丸印で並ぶ", () => {
    const state = createGame(1);
    const ui = createInventoryUi(createCraftSave());
    openMenu(state, ui, "attire");
    const view: ViewOf<"flowBoard"> = { kind: "flowBoard", focus: null };
    ui.stack = [{ kind: "crest", focus: null }, view];
    expect(BOARD_KEYWORDS, "8 × 5").toHaveLength(40);
    const hits = FLOW_BOARD_VIEW.layout(state, ui, view);
    expect(hits.map((h) => h.id), "全部が当たりになる").toEqual(BOARD_KEYWORDS.map((k) => fid.kw(k)));
    const ys = new Set(hits.map((h) => h.rect.y));
    expect(ys.size, "5 行").toBe(5);
  });
});
