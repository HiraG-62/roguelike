import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGame } from "../core/game";
import { EMPTY_INPUT, type FrameInput } from "../core/input";
import { createCraftSave } from "../loot/craftingStore";
import { addToStash } from "../loot/profile";
import { MILESTONES } from "../loot/provenance";
import { DEFAULT_STATS, createEmptyProvenance, type AffixRoll, type Item, type PlayerStats } from "../loot/types";

vi.mock("../loot/stats", () => ({
  computeStats: vi.fn((): PlayerStats => ({ ...DEFAULT_STATS })),
}));

import { computeStats } from "../loot/stats";
import { refreshPendingBud } from "../system/loot";
import { budBannerRect, layoutBudModal } from "./bud";
import { createEchoUi } from "./echoTab";
import { createInventoryUi, layoutInventory, layoutSkills, tabRects, updateInventoryUi, type InventoryUi } from "./inventory";
import type { Rect } from "./inventoryLayout";

type State = ReturnType<typeof createGame>;

function withInput(partial: Partial<FrameInput>): FrameInput {
  return { ...EMPTY_INPUT, move: { ...EMPTY_INPUT.move }, ...partial };
}

function clickAt(state: State, ui: InventoryUi, rect: Rect, extra: Partial<FrameInput> = {}): void {
  updateInventoryUi(state, ui, withInput({ clickPressed: true, aimScreen: { x: rect.x + 1, y: rect.y + 1 }, ...extra }), 0);
}

const melee: AffixRoll = { key: "meleeDamagePct", value: 30, nominal: 25, flux: 0.2, color: "crimson", origin: "found" };
const life: AffixRoll = { key: "maxLife", value: 20, nominal: 20, flux: 0, color: "jade", origin: "found" };
const crit: AffixRoll = { key: "critChance", value: 4, nominal: 4, flux: 0, color: "gold", origin: "found" };

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "item-1",
    seed: 1,
    baseKey: "shortsword",
    slot: "mainHand",
    rarity: "normal",
    itemLevel: 1,
    name: "Shortsword",
    implicit: null,
    affixes: [],
    foundDepth: 1,
    foundAt: 0,
    provenance: createEmptyProvenance(),
    margin: 3,
    marginMax: 3,
    milestones: [],
    buds: [],
    budOffer: null,
    ...overrides,
  };
}

/** 芽を提示中の武器（選ぶと life か crit が加わる） */
function buddingItem(id = "bud-1"): Item {
  const milestone = MILESTONES[0]?.key ?? "kills:50";
  return makeItem({ id, affixes: [melee], milestones: [milestone], budOffer: { milestone, options: [life, crit] } });
}

/** 代入で狭まった型を読み直す（UI 操作で state.pendingBud が変わるため） */
function pendingItemId(state: State): string | undefined {
  return state.pendingBud?.itemId;
}

function openUi(state: State): InventoryUi {
  const ui = createInventoryUi();
  ui.echo = createEchoUi(createCraftSave());
  updateInventoryUi(state, ui, withInput({ inventoryPressed: true }), 0);
  return ui;
}

function stashRowRect(state: State, ui: InventoryUi, id: string): Rect {
  const row = layoutInventory(state, ui).stashRows.find((r) => r.item.id === id);
  if (!row) throw new Error(`row ${id} missing`);
  return row.rect;
}

beforeEach(() => {
  vi.mocked(computeStats).mockClear();
  vi.mocked(computeStats).mockImplementation(() => ({ ...DEFAULT_STATS }));
});

describe("updateInventoryUi: タブ", () => {
  it("Tab は 閉 → 装備 → スキル → 残響 → 網 → 閉 のサイクルで、state.paused が連動する", () => {
    const state = createGame(1);
    const ui = createInventoryUi();
    const expected = [
      { open: true, tab: "equipment" },
      { open: true, tab: "skills" },
      { open: true, tab: "echo" },
      { open: true, tab: "web" },
    ] as const;
    for (const step of expected) {
      updateInventoryUi(state, ui, withInput({ inventoryPressed: true }), 0);
      expect(ui.open, `${step.tab} で開いている`).toBe(step.open);
      expect(ui.tab, "タブの順").toBe(step.tab);
      expect(state.paused, "開いている間は止まる").toBe(true);
    }
    updateInventoryUi(state, ui, withInput({ inventoryPressed: true }), 0);
    expect(ui.open, "5 回目で閉じる").toBe(false);
    expect(state.paused, "閉じたら再開").toBe(false);

    updateInventoryUi(state, ui, withInput({ inventoryPressed: true }), 0);
    expect(ui.tab, "次に開くと装備タブから").toBe("equipment");
  });

  it("画面上のタブをクリックで切り替えられる", () => {
    const state = createGame(1);
    const ui = openUi(state);
    for (const tab of ["skills", "echo", "web", "equipment"] as const) {
      const rect = tabRects().find((t) => t.tab === tab)?.rect;
      if (!rect) throw new Error(`${tab} tab missing`);
      clickAt(state, ui, rect);
      expect(ui.tab, "クリックしたタブ").toBe(tab);
    }
  });
});

describe("updateInventoryUi: スキルタブ", () => {
  it("スロットクリックは選択だけ、Shift+クリックで外し、石クリックで空きスロットへ装着する", () => {
    const state = createGame(1);
    const ui = openUi(state);
    ui.tab = "skills";
    const profile = state.skills.profile;
    const firstId = profile.loadout[0];

    const slotRect = layoutSkills(state, ui).slots[0]?.rect;
    if (!slotRect) throw new Error("slot missing");
    ui.skillSlot = 2;
    clickAt(state, ui, slotRect);
    expect(ui.skillSlot, "選択される").toBe(0);
    expect(profile.loadout[0], "クリックだけでは外れない").toBe(firstId);
    clickAt(state, ui, slotRect, { shiftHeld: true });
    expect(profile.loadout[0], "外れる").toBeNull();

    const row = layoutSkills(state, ui).rows.find((r) => r.stone.id === firstId);
    if (!row) throw new Error("row missing");
    clickAt(state, ui, row.rect);
    expect(profile.loadout[0], "戻る").toBe(firstId);
  });
});

describe("updateInventoryUi: スキルタブの刻印符", () => {
  function runeSetup(): { state: State; ui: InventoryUi } {
    const state = createGame(1);
    const ui = openUi(state);
    ui.tab = "skills";
    const profile = state.skills.profile;
    profile.runes = [
      { id: "ra", modifier: "echo", foundAt: 2 },
      { id: "rb", modifier: "comboFuel", foundAt: 1 },
    ];
    for (const stone of profile.stones) stone.links = 2;
    return { state, ui };
  }

  function runeRowRect(state: State, ui: InventoryUi, id: string): Rect {
    const row = layoutSkills(state, ui).runeList.rows.find((r) => r.rune.id === id);
    if (!row) throw new Error(`rune ${id} missing`);
    return row.rect;
  }

  it("所持刻印符をクリックすると選択中スロットの石に付き、もう一度クリックで外れる", () => {
    const { state, ui } = runeSetup();
    const profile = state.skills.profile;
    const stone = profile.stones.find((st) => st.id === profile.loadout[0]);
    if (!stone) throw new Error("stone");
    clickAt(state, ui, runeRowRect(state, ui, "ra"));
    expect(stone.runes?.map((r) => r.id), "石に付く").toEqual(["ra"]);
    expect(profile.runes?.map((r) => r.id), "所持品から消える").toEqual(["rb"]);
    clickAt(state, ui, runeRowRect(state, ui, "ra"));
    expect(stone.runes, "外れる").toBeUndefined();
    expect(profile.runes?.map((r) => r.id).sort(), "所持品へ戻る").toEqual(["ra", "rb"]);
  });

  it("キー・パッド: 1〜4 でスロット、↓ でカーソル、決定で付ける", () => {
    const { state, ui } = runeSetup();
    const profile = state.skills.profile;
    updateInventoryUi(state, ui, withInput({ skill2Pressed: true }), 0);
    expect(ui.skillSlot, "スロット 2 を選ぶ").toBe(1);
    updateInventoryUi(state, ui, withInput({ move: { x: 0, y: 1 } }), 0);
    updateInventoryUi(state, ui, withInput({ move: { x: 0, y: 1 } }), 0);
    expect(ui.runes.cursor, "押しっぱなしは 1 マスだけ").toBe(1);
    updateInventoryUi(state, ui, withInput({ confirmPressed: true }), 0);
    const stone = profile.stones.find((st) => st.id === profile.loadout[1]);
    expect(stone?.runes?.map((r) => r.id), "カーソルの符（新しい順で 2 番目）が付く").toEqual(["rb"]);
  });

  it("左右の移動でも選択中スロットが変わる（端で止まる）", () => {
    const { state, ui } = runeSetup();
    updateInventoryUi(state, ui, withInput({ move: { x: 1, y: 0 } }), 0);
    expect(ui.skillSlot).toBe(1);
    updateInventoryUi(state, ui, withInput({ move: { x: 0, y: 0 } }), 0);
    updateInventoryUi(state, ui, withInput({ move: { x: -1, y: 0 } }), 0);
    updateInventoryUi(state, ui, withInput({ move: { x: 0, y: 0 } }), 0);
    updateInventoryUi(state, ui, withInput({ move: { x: -1, y: 0 } }), 0);
    expect(ui.skillSlot).toBe(0);
  });

  it("付けられない符は付かず、所持品に残る（空きスロット）", () => {
    const { state, ui } = runeSetup();
    ui.skillSlot = 3;
    clickAt(state, ui, runeRowRect(state, ui, "ra"));
    expect(state.skills.profile.runes, "所持品のまま").toHaveLength(2);
  });

  it("Shift+クリックで所持刻印符を捨てる", () => {
    const { state, ui } = runeSetup();
    clickAt(state, ui, runeRowRect(state, ui, "rb"), { shiftHeld: true });
    expect(state.skills.profile.runes?.map((r) => r.id)).toEqual(["ra"]);
  });
});

describe("updateInventoryUi: 装備タブ", () => {
  it("倉庫の行をクリックすると装備され、stats が再計算される", () => {
    const state = createGame(1);
    const ui = openUi(state);
    addToStash(state.profile, makeItem({ id: "sword-1", name: "Test Sword" }));
    vi.mocked(computeStats).mockImplementation(() => ({ ...DEFAULT_STATS, maxHp: 150 }));

    clickAt(state, ui, stashRowRect(state, ui, "sword-1"));

    expect(state.profile.equipment.mainHand?.id, "装備された").toBe("sword-1");
    expect(state.profile.stash.some((it) => it.id === "sword-1"), "倉庫から消える").toBe(false);
    expect(computeStats).toHaveBeenCalledWith(state.profile.equipment);
    expect(state.stats.maxHp, "stats に反映").toBe(150);
    expect(state.player.maxHp, "プレイヤーに反映").toBe(150);
    expect(ui.message).toBe("装備した: Test Sword");
  });

  it("HP は割合を維持する", () => {
    const state = createGame(1);
    const ui = openUi(state);
    state.player.maxHp = 100;
    state.player.hp = 50;
    addToStash(state.profile, makeItem({ id: "sword-1" }));
    vi.mocked(computeStats).mockImplementation(() => ({ ...DEFAULT_STATS, maxHp: 10 }));
    clickAt(state, ui, stashRowRect(state, ui, "sword-1"));
    expect(state.player.maxHp).toBe(10);
    expect(state.player.hp, "50% を維持").toBe(5);
  });

  it("Shift+クリックで砕き、性質の色の残響を得る（装備はしない）", () => {
    const state = createGame(1);
    const ui = openUi(state);
    const equippedBefore = state.profile.equipment.mainHand;
    addToStash(state.profile, makeItem({ id: "junk-1", affixes: [melee, life] }));

    clickAt(state, ui, stashRowRect(state, ui, "junk-1"), { shiftHeld: true });

    expect(state.profile.stash.some((it) => it.id === "junk-1"), "倉庫から消える").toBe(false);
    expect(state.profile.equipment.mainHand, "装備は変わらない").toBe(equippedBefore);
    expect(ui.echo.save.echoes.crimson, "紅響 +1").toBe(1);
    expect(ui.echo.save.echoes.jade, "翠響 +1").toBe(1);
  });

  it("ホイールでスクロールし、範囲外にはクランプされる", () => {
    const state = createGame(1);
    const ui = openUi(state);
    for (let i = 0; i < 30; i++) addToStash(state.profile, makeItem({ id: `item-${i}`, foundAt: i }));
    const { maxScroll } = layoutInventory(state, ui);
    expect(maxScroll, "スクロールできる").toBeGreaterThan(0);
    updateInventoryUi(state, ui, withInput({ wheel: 1000 }), 0);
    expect(ui.scroll).toBe(maxScroll);
    updateInventoryUi(state, ui, withInput({ wheel: -1000 }), 0);
    expect(ui.scroll).toBe(0);
  });

  it("倉庫の部位タブをクリックするとその部位だけが並び、スクロールは先頭へ戻る", () => {
    const state = createGame(1);
    const ui = openUi(state);
    state.profile.stash = [];
    for (let i = 0; i < 30; i++) addToStash(state.profile, makeItem({ id: `sword-${i}`, foundAt: i }));
    addToStash(state.profile, makeItem({ id: "ring-1", slot: "ring", baseKey: "ironRing", foundAt: 100 }));
    ui.scroll = 5;
    const ringTab = layoutInventory(state, ui).stashToolbar.find((c) => c.control.kind === "slot" && c.control.slot === "ring");
    if (!ringTab) throw new Error("指輪タブが無い");

    clickAt(state, ui, ringTab.rect);

    expect(ui.stashView.slot).toBe("ring");
    expect(ui.scroll, "先頭へ戻る").toBe(0);
    const layout = layoutInventory(state, ui);
    expect(layout.stashOrder.map((it) => it.id)).toEqual(["ring-1"]);
    expect(layout.stashTotal, "総数は倉庫全体").toBe(31);
    expect(layout.stashCounts.mainHand, "他の部位の件数も数える").toBe(30);
  });
});

describe("芽: 装備と 2 択", () => {
  it("芽のある遺物を装備すると pendingBud が出て、外すと消える（refreshPendingBud）", () => {
    const state = createGame(1);
    const ui = openUi(state);
    state.profile.equipment.mainHand = null;
    state.pendingBud = null;
    addToStash(state.profile, buddingItem());

    clickAt(state, ui, stashRowRect(state, ui, "bud-1"));
    expect(pendingItemId(state), "装備で芽が載る").toBe("bud-1");

    const slot = layoutInventory(state, ui).slots.find((s) => s.slot === "mainHand");
    if (!slot) throw new Error("weapon slot missing");
    clickAt(state, ui, slot.rect);
    expect(state.pendingBud, "外すと消える").toBeNull();
  });

  it("バナー → カードのクリックで chooseBud され、pendingBud が消える", () => {
    const state = createGame(1);
    state.profile.equipment.mainHand = buddingItem();
    refreshPendingBud(state);
    const ui = openUi(state);
    expect(state.pendingBud, "芽が提示される").not.toBeNull();

    clickAt(state, ui, budBannerRect());
    expect(ui.bud.open, "モーダルが開く").toBe(true);

    const card = layoutBudModal().cards[1];
    if (!card) throw new Error("card missing");
    clickAt(state, ui, card);

    expect(state.pendingBud, "選ぶと消える").toBeNull();
    expect(ui.bud.open, "モーダルは閉じる").toBe(false);
    const weapon = state.profile.equipment.mainHand;
    expect(weapon?.affixes.at(-1)?.key, "2 つ目の候補が加わる").toBe(crit.key);
    expect(weapon?.affixes.at(-1)?.origin).toBe("bud");
    expect(weapon?.margin, "余白が 1 減る").toBe(2);
  });

  it("モーダルの外をクリックすると選ばずに閉じる。芽が無ければバナーは開かない", () => {
    const state = createGame(1);
    state.profile.equipment.mainHand = buddingItem();
    const ui = openUi(state);
    state.pendingBud = {
      itemId: "bud-1",
      slot: "mainHand",
      milestone: MILESTONES[0]?.key ?? "kills:50",
      milestoneLabel: "撃破 50",
      options: [life, crit],
    };
    clickAt(state, ui, budBannerRect());
    expect(ui.bud.open).toBe(true);
    updateInventoryUi(state, ui, withInput({ clickPressed: true, aimScreen: { x: 1, y: 1 } }), 0);
    expect(ui.bud.open, "外のクリックで閉じる").toBe(false);
    expect(state.pendingBud, "選んではいない").not.toBeNull();

    state.pendingBud = null;
    clickAt(state, ui, budBannerRect());
    expect(ui.bud.open, "芽が無ければ開かない").toBe(false);
  });

  it("1 / 2 キーでも選べる", () => {
    const state = createGame(1);
    state.profile.equipment.mainHand = buddingItem();
    const ui = openUi(state);
    state.pendingBud = {
      itemId: "bud-1",
      slot: "mainHand",
      milestone: MILESTONES[0]?.key ?? "kills:50",
      milestoneLabel: "撃破 50",
      options: [life, crit],
    };
    clickAt(state, ui, budBannerRect());
    updateInventoryUi(state, ui, withInput({ skill1Pressed: true }), 0);
    expect(state.profile.equipment.mainHand?.affixes.at(-1)?.key, "1 つ目の候補").toBe(life.key);
    expect(state.pendingBud).toBeNull();
  });
});
