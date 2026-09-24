import { describe, expect, it } from "vitest";
import { EMPTY_INPUT, type FrameInput } from "../core/input";
import { createEmptyProvenance, type AffixRoll, type Item } from "../loot/types";
import {
  SLOT_FILTERS,
  applyStashControl,
  applyStashView,
  createStashView,
  layoutStashToolbar,
  slotCounts,
  sortArrow,
  startsSlotGroup,
  stashControlLabel,
  updateStashToolbar,
} from "./stashFilter";

const melee: AffixRoll = { key: "meleeDamagePct", value: 30, nominal: 25, flux: 0.2, color: "crimson", origin: "found" };
const life: AffixRoll = { key: "maxLife", value: 20, nominal: 20, flux: 0, color: "jade", origin: "found" };

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "item",
    seed: 1,
    baseKey: "shortsword",
    slot: "weapon",
    rarity: "normal",
    itemLevel: 1,
    name: "短剣",
    implicit: null,
    affixes: [],
    foundDepth: 1,
    foundAt: 0,
    provenance: createEmptyProvenance(),
    margin: 0,
    marginMax: 3,
    milestones: [],
    buds: [],
    budOffer: null,
    ...overrides,
  };
}

const stash: Item[] = [
  makeItem({ id: "ring-new", slot: "ring", foundAt: 30, itemLevel: 2, affixes: [life] }),
  makeItem({ id: "sword-old", slot: "weapon", foundAt: 10, itemLevel: 5, affixes: [melee], rarity: "rare" }),
  makeItem({ id: "sword-new", slot: "weapon", foundAt: 20, itemLevel: 1, affixes: [life, melee], margin: 2 }),
  makeItem({ id: "boots", slot: "boots", foundAt: 40, itemLevel: 3, inscription: "風の靴" }),
];

const ids = (items: readonly Item[]): string[] => items.map((it) => it.id);

describe("倉庫の部位分け・並べ替え・絞り込み", () => {
  it("全部位では部位ごとにまとめ、その中を新しい順に並べる", () => {
    expect(ids(applyStashView(stash, createStashView())), "武器 → 靴 → 指輪の順").toEqual(["sword-new", "sword-old", "boots", "ring-new"]);
  });

  it("部位タブで 1 部位だけに絞る", () => {
    const view = createStashView();
    view.slot = "weapon";
    expect(ids(applyStashView(stash, view))).toEqual(["sword-new", "sword-old"]);
  });

  it("深度で並べ、Shift で向きを反転する", () => {
    const view = createStashView();
    view.slot = "weapon";
    applyStashControl(view, { kind: "sort" }, false);
    expect(view.sort, "拾った順の次は深度").toBe("depth");
    expect(ids(applyStashView(stash, view)), "深い順").toEqual(["sword-old", "sword-new"]);
    expect(sortArrow(view)).toBe("↓");
    applyStashControl(view, { kind: "sort" }, true);
    expect(ids(applyStashView(stash, view)), "反転すると浅い順").toEqual(["sword-new", "sword-old"]);
    expect(sortArrow(view)).toBe("↑");
  });

  it("色は、その色の性質を 1 つでも持つものに絞る", () => {
    const view = createStashView();
    view.color = "jade";
    expect(ids(applyStashView(stash, view))).toEqual(["sword-new", "ring-new"]);
  });

  it("揺らぎと印で絞る", () => {
    const view = createStashView();
    view.rarity = "rare";
    expect(ids(applyStashView(stash, view))).toEqual(["sword-old"]);
    view.rarity = null;
    view.mark = "inscription";
    expect(ids(applyStashView(stash, view))).toEqual(["boots"]);
    view.mark = "margin";
    expect(ids(applyStashView(stash, view))).toEqual(["sword-new"]);
  });

  it("絞り込みはクリックで次、Shift+クリックで前へ回り、先頭は「すべて」", () => {
    const view = createStashView();
    applyStashControl(view, { kind: "color" }, false);
    expect(view.color).toBe("crimson");
    applyStashControl(view, { kind: "color" }, true);
    expect(view.color, "すべてへ戻る").toBeNull();
    applyStashControl(view, { kind: "color" }, true);
    expect(view.color, "すべての前は最後の色").toBe("umbra");
  });

  it("部位タブの件数は色などの絞り込みを反映する", () => {
    const view = createStashView();
    view.color = "crimson";
    const counts = slotCounts(stash, view);
    expect(counts.all).toBe(2);
    expect(counts.weapon).toBe(2);
    expect(counts.ring).toBe(0);
    expect(stashControlLabel(view, { kind: "slot", slot: "weapon" }, counts)).toBe("武器 2");
  });

  it("部位の境目を見分ける", () => {
    const order = applyStashView(stash, createStashView());
    expect(startsSlotGroup(order, 0), "先頭は区切らない").toBe(false);
    expect(startsSlotGroup(order, 1), "同じ部位の続き").toBe(false);
    expect(startsSlotGroup(order, 2), "武器 → 靴").toBe(true);
  });

  it("ボタン列は部位タブ 7 つと操作 4 つを重ならずに並べ、クリックで操作する", () => {
    const area = { x: 100, y: 20, w: 306, h: 22 };
    const layout = layoutStashToolbar(area);
    expect(layout, "部位タブ + 並び・色・揺らぎ・印").toHaveLength(SLOT_FILTERS.length + 4);
    for (const c of layout) expect(c.rect.x + c.rect.w, "右端をはみ出さない").toBeLessThanOrEqual(area.x + area.w);
    const ring = layout.find((c) => c.control.kind === "slot" && c.control.slot === "ring");
    if (!ring) throw new Error("指輪タブが無い");
    const view = createStashView();
    const input: FrameInput = { ...EMPTY_INPUT, clickPressed: true, aimScreen: { x: ring.rect.x + 1, y: ring.rect.y + 1 } };
    expect(updateStashToolbar(view, layout, input), "クリックを消費する").toBe(true);
    expect(view.slot).toBe("ring");
    expect(updateStashToolbar(view, layout, { ...EMPTY_INPUT, aimScreen: { x: 0, y: 0 } }), "外は何もしない").toBe(false);
    expect(view.hover).toBeNull();
  });
});
