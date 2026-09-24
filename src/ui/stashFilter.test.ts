import { describe, expect, it } from "vitest";
import { EMPTY_INPUT, type FrameInput } from "../core/input";
import { MOVESET_KEYS, MOVESETS } from "../data/weapons";
import { BASES } from "../loot/bases";
import { LOOT_SLOTS, SLOTS, createEmptyProvenance, type AffixRoll, type Item } from "../loot/types";
import {
  FILTERS,
  FILTER_KEYS,
  SORTS,
  SORT_KEYS,
  applyStashControl,
  applyStashView,
  createStashView,
  layoutStashToolbar,
  slotCounts,
  slotFilters,
  sortArrow,
  startsSlotGroup,
  stashControlLabel,
  updateStashToolbar,
  weaponKindOf,
} from "./stashFilter";

const melee: AffixRoll = { key: "meleeDamagePct", value: 30, nominal: 25, flux: 0.2, color: "crimson", origin: "found" };
const life: AffixRoll = { key: "maxLife", value: 20, nominal: 20, flux: 0, color: "jade", origin: "found" };

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "item",
    seed: 1,
    baseKey: "shortsword",
    slot: "mainHand",
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
  makeItem({ id: "ring-new", slot: "ring", baseKey: "ironRing", foundAt: 30, itemLevel: 2, affixes: [life] }),
  makeItem({ id: "sword-old", foundAt: 10, itemLevel: 5, affixes: [melee], rarity: "rare" }),
  makeItem({ id: "sword-new", foundAt: 20, itemLevel: 1, affixes: [life, melee], margin: 2 }),
  makeItem({ id: "boots", slot: "boots", baseKey: "boots", foundAt: 40, itemLevel: 3, inscription: "風の靴" }),
];

const arms: Item[] = [
  makeItem({ id: "pistol", baseKey: "pistol", foundAt: 3 }),
  makeItem({ id: "ring", slot: "ring", baseKey: "ironRing", foundAt: 4 }),
  makeItem({ id: "spear", baseKey: "spear", foundAt: 2 }),
  makeItem({ id: "sword", baseKey: "shortsword", foundAt: 1 }),
];

const ids = (items: readonly Item[]): string[] => items.map((it) => it.id);
const AREA = { x: 100, y: 20, w: 306 };

describe("倉庫の部位分け・並べ替え・絞り込み", () => {
  it("全部位では部位ごとにまとめ、その中を新しい順に並べる", () => {
    expect(ids(applyStashView(stash, createStashView())), "右手 → 靴 → 指輪の順").toEqual(["sword-new", "sword-old", "boots", "ring-new"]);
  });

  it("部位タブで 1 部位だけに絞る", () => {
    const view = createStashView();
    view.slot = "mainHand";
    expect(ids(applyStashView(stash, view))).toEqual(["sword-new", "sword-old"]);
  });

  it("並びはクリックで SORT_KEYS の順に回り、Shift で向きを反転する", () => {
    const view = createStashView();
    view.slot = "mainHand";
    for (const key of SORT_KEYS.slice(1)) {
      applyStashControl(view, { kind: "sort" }, false, stash);
      expect(view.sort, "表の順に回る").toBe(key);
    }
    applyStashControl(view, { kind: "sort" }, false, stash);
    expect(view.sort, "最後の次は先頭").toBe(SORT_KEYS[0]);

    view.sort = "depth";
    expect(ids(applyStashView(stash, view)), "深い順").toEqual(["sword-old", "sword-new"]);
    expect(sortArrow(view)).toBe("↓");
    applyStashControl(view, { kind: "sort" }, true, stash);
    expect(ids(applyStashView(stash, view)), "反転すると浅い順").toEqual(["sword-new", "sword-old"]);
    expect(sortArrow(view)).toBe("↑");
  });

  it("色・揺らぎ・印で絞る（色はその色の性質を 1 つでも持つもの）", () => {
    const view = createStashView();
    view.filters.color = "jade";
    expect(ids(applyStashView(stash, view))).toEqual(["sword-new", "ring-new"]);
    view.filters = { rarity: "rare" };
    expect(ids(applyStashView(stash, view))).toEqual(["sword-old"]);
    view.filters = { mark: "inscription" };
    expect(ids(applyStashView(stash, view))).toEqual(["boots"]);
    view.filters = { mark: "margin" };
    expect(ids(applyStashView(stash, view))).toEqual(["sword-new"]);
  });

  it("絞り込みはクリックで次、Shift+クリックで前へ回り、先頭は「すべて」", () => {
    const view = createStashView();
    const color = { kind: "filter", filter: "color" } as const;
    applyStashControl(view, color, false, stash);
    expect(view.filters.color).toBe("crimson");
    expect(stashControlLabel(view, color)).toBe("色:紅");
    applyStashControl(view, color, true, stash);
    expect(view.filters.color, "すべてへ戻る").toBeUndefined();
    expect(stashControlLabel(view, color)).toBe("色:すべて");
    applyStashControl(view, color, true, stash);
    expect(view.filters.color, "すべての前は最後の色").toBe("umbra");
  });

  it("武器種で絞ると、その型の遺物だけが残る。候補は倉庫にある武器種だけを MOVESET_KEYS の順に回る", () => {
    expect(FILTERS.kind.options(arms), "剣・槍・短銃").toEqual(["sword", "spear", "sidearm"]);
    const view = createStashView();
    const kind = { kind: "filter", filter: "kind" } as const;
    applyStashControl(view, kind, false, arms);
    expect(view.filters.kind).toBe("sword");
    expect(ids(applyStashView(arms, view))).toEqual(["sword"]);
    expect(stashControlLabel(view, kind)).toBe(`武器種:${MOVESETS.sword.name}`);
    applyStashControl(view, kind, true, arms);
    applyStashControl(view, kind, true, arms);
    expect(view.filters.kind, "すべての前は最後の武器種").toBe("sidearm");
  });

  it("武器種で並べると型の順にまとまり、武器でないものは最後", () => {
    const view = createStashView();
    view.sort = "kind";
    expect(ids(applyStashView(arms, view)), "全部位では部位 → 武器種").toEqual(["sword", "spear", "pistol", "ring"]);
    view.slot = "mainHand";
    expect(ids(applyStashView(arms, view))).toEqual(["sword", "spear", "pistol"]);
  });

  it("部位タブの件数は部位以外の絞り込みを反映する", () => {
    const view = createStashView();
    view.filters.color = "crimson";
    const counts = slotCounts(stash, view);
    expect(counts.all).toBe(2);
    expect(counts.mainHand).toBe(2);
    expect(counts.ring, "無い部位は 0").toBe(0);
    expect(stashControlLabel(view, { kind: "slot", slot: "mainHand" }, counts)).toBe("右手 2");
  });

  it("部位の境目を見分ける", () => {
    const order = applyStashView(stash, createStashView());
    expect(startsSlotGroup(order, 0), "先頭は区切らない").toBe(false);
    expect(startsSlotGroup(order, 1), "同じ部位の続き").toBe(false);
    expect(startsSlotGroup(order, 2), "右手 → 靴").toBe(true);
  });

  it("ボタンをクリックすると操作され、外は何もしない", () => {
    const { controls } = layoutStashToolbar(AREA, stash);
    const ring = controls.find((c) => c.control.kind === "slot" && c.control.slot === "ring");
    if (!ring) throw new Error("指輪タブが無い");
    const view = createStashView();
    const input: FrameInput = { ...EMPTY_INPUT, clickPressed: true, aimScreen: { x: ring.rect.x + 1, y: ring.rect.y + 1 } };
    expect(updateStashToolbar(view, controls, input, stash), "クリックを消費する").toBe(true);
    expect(view.slot).toBe("ring");
    expect(updateStashToolbar(view, controls, { ...EMPTY_INPUT, aimScreen: { x: 0, y: 0 } }, stash), "外は何もしない").toBe(false);
    expect(view.hover).toBeNull();
  });
});

describe("倉庫の帯の拡張性（部位・武器種・軸が増えても追従する）", () => {
  it("部位タブはドロップのある部位を常に出し、それ以外の部位は倉庫にあるときだけ出す", () => {
    expect(slotFilters([]), "全部位 + LOOT_SLOTS").toEqual(["all", ...SLOTS.filter((s) => LOOT_SLOTS.includes(s))]);
    const offHand = makeItem({ id: "off", slot: "offHand" });
    expect(slotFilters([offHand]), "倉庫にあれば左手も出る").toContain("offHand");
  });

  it("すべての部位・並び・絞り込みのボタンが重ならずに幅に収まる", () => {
    const withAllSlots = SLOTS.map((slot, i) => makeItem({ id: `s${i}`, slot }));
    const { controls, h } = layoutStashToolbar(AREA, withAllSlots);
    expect(controls, "部位タブ + 並び + 絞り込み").toHaveLength(SLOTS.length + 1 + 1 + FILTER_KEYS.length);
    for (const c of controls) {
      expect(c.rect.x, "左端").toBeGreaterThanOrEqual(AREA.x);
      expect(c.rect.x + c.rect.w, "右端をはみ出さない").toBeLessThanOrEqual(AREA.x + AREA.w);
      expect(c.rect.y + c.rect.h, "帯の高さに収まる").toBeLessThanOrEqual(AREA.y + h);
    }
    for (const [i, a] of controls.entries()) {
      for (const b of controls.slice(i + 1)) {
        const overlap = a.rect.x < b.rect.x + b.rect.w && b.rect.x < a.rect.x + a.rect.w && a.rect.y < b.rect.y + b.rect.h && b.rect.y < a.rect.y + a.rect.h;
        expect(overlap, "ボタンが重ならない").toBe(false);
      }
    }
  });

  it("幅が狭いとボタンは折り返し、帯が高くなる", () => {
    const wide = layoutStashToolbar(AREA, stash);
    const narrow = layoutStashToolbar({ ...AREA, w: 120 }, stash);
    expect(narrow.h, "狭いと段が増える").toBeGreaterThan(wide.h);
    expect(narrow.controls).toHaveLength(wide.controls.length);
  });

  it("武器を持つベースはすべて武器種を持ち、その武器種は候補と表示名を持つ", () => {
    for (const base of BASES.filter((b) => b.moveset !== undefined)) {
      const kind = weaponKindOf(makeItem({ baseKey: base.key }));
      expect(kind, `${base.key} の武器種`).toBeDefined();
      if (kind === undefined) continue;
      expect(MOVESET_KEYS, "並びの順に載っている").toContain(kind);
      expect(FILTERS.kind.optionLabel(kind), "表示名").toBe(MOVESETS[kind].name);
    }
  });

  it("すべての並びの軸は名前を持ち、同じ遺物同士の比較は 0", () => {
    const item = makeItem();
    for (const key of SORT_KEYS) {
      expect(SORTS[key].label.length, `${key} の名前`).toBeGreaterThan(0);
      expect(SORTS[key].compare(item, item), `${key} の自己比較`).toBe(0);
    }
  });

  it("すべての絞り込みの軸は、候補ごとに表示名を持つ", () => {
    for (const key of FILTER_KEYS) {
      const def = FILTERS[key];
      for (const value of def.options(arms)) expect(def.optionLabel(value), `${key}:${value}`).not.toBe("");
    }
  });
});
