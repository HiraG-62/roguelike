import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGame } from "../core/game";
import { EMPTY_INPUT, type FrameInput } from "../core/input";
import { addToStash } from "../loot/profile";
import { DEFAULT_STATS, type Item, type PlayerStats } from "../loot/types";

vi.mock("../loot/stats", () => ({
  computeStats: vi.fn((): PlayerStats => ({ ...DEFAULT_STATS })),
}));

import { computeStats } from "../loot/stats";
import { createInventoryUi, layoutInventory, updateInventoryUi } from "./inventory";

function withInput(partial: Partial<FrameInput>): FrameInput {
  return { ...EMPTY_INPUT, move: { ...EMPTY_INPUT.move }, ...partial };
}

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "item-1",
    seed: 1,
    baseKey: "shortsword",
    slot: "weapon",
    rarity: "normal",
    itemLevel: 1,
    name: "Shortsword",
    implicit: null,
    affixes: [],
    foundDepth: 1,
    foundAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(computeStats).mockClear();
  vi.mocked(computeStats).mockImplementation(() => ({ ...DEFAULT_STATS }));
});

describe("updateInventoryUi: トグル", () => {
  it("inventoryPressed で開閉し、state.paused が連動する", () => {
    const state = createGame(1);
    const ui = createInventoryUi();

    updateInventoryUi(state, ui, withInput({ inventoryPressed: true }), 0);
    expect(ui.open).toBe(true);
    expect(state.paused).toBe(true);

    updateInventoryUi(state, ui, withInput({ inventoryPressed: true }), 0);
    expect(ui.open).toBe(false);
    expect(state.paused).toBe(false);
  });
});

describe("updateInventoryUi: クリックで装備", () => {
  it("stash の行をクリックすると装備され、stats が再計算される", () => {
    const state = createGame(1);
    const ui = createInventoryUi();
    const item = makeItem({ id: "sword-1", name: "Test Sword" });
    addToStash(state.profile, item);

    updateInventoryUi(state, ui, withInput({ inventoryPressed: true }), 0);
    const layout = layoutInventory(state, ui);
    const row = layout.stashRows[0];
    expect(row?.item.id).toBe("sword-1");
    const point = { x: row!.rect.x + 1, y: row!.rect.y + 1 };

    vi.mocked(computeStats).mockImplementation(() => ({ ...DEFAULT_STATS, maxHp: 150 }));

    updateInventoryUi(state, ui, withInput({ aimScreen: point, clickPressed: true }), 0);

    expect(state.profile.equipment.weapon?.id).toBe("sword-1");
    expect(state.profile.stash).toEqual([]);
    expect(computeStats).toHaveBeenCalledWith(state.profile.equipment);
    expect(state.stats.maxHp).toBe(150);
    expect(state.player.maxHp).toBe(150);
    expect(ui.message).toBe("Equipped: Test Sword");
  });

  it("HP は割合を維持し、最低 1 を保つ", () => {
    const state = createGame(1);
    const ui = createInventoryUi();
    state.player.maxHp = 100;
    state.player.hp = 50; // 50%
    addToStash(state.profile, makeItem({ id: "sword-1" }));

    updateInventoryUi(state, ui, withInput({ inventoryPressed: true }), 0);
    const layout = layoutInventory(state, ui);
    const row = layout.stashRows[0]!;
    const point = { x: row.rect.x + 1, y: row.rect.y + 1 };

    vi.mocked(computeStats).mockImplementation(() => ({ ...DEFAULT_STATS, maxHp: 10 }));
    updateInventoryUi(state, ui, withInput({ aimScreen: point, clickPressed: true }), 0);

    // 50% 維持 -> 5 になるはず
    expect(state.player.maxHp).toBe(10);
    expect(state.player.hp).toBe(5);
  });
});

describe("updateInventoryUi: shift クリックで分解", () => {
  it("shift + クリックで stash から削除され、装備はされない", () => {
    const state = createGame(1);
    const ui = createInventoryUi();
    addToStash(state.profile, makeItem({ id: "junk-1", name: "Junk Sword" }));

    updateInventoryUi(state, ui, withInput({ inventoryPressed: true }), 0);
    const layout = layoutInventory(state, ui);
    const row = layout.stashRows[0]!;
    const point = { x: row.rect.x + 1, y: row.rect.y + 1 };

    updateInventoryUi(state, ui, withInput({ aimScreen: point, clickPressed: true, shiftHeld: true }), 0);

    expect(state.profile.stash).toEqual([]);
    expect(state.profile.equipment.weapon).toBeNull();
    expect(ui.message).toBe("Salvaged: Junk Sword");
  });
});

describe("updateInventoryUi: スクロール", () => {
  it("ホイールでスクロールし、範囲外にはクランプされる", () => {
    const state = createGame(1);
    const ui = createInventoryUi();
    for (let i = 0; i < 20; i++) {
      addToStash(state.profile, makeItem({ id: `item-${i}`, foundAt: i }));
    }

    updateInventoryUi(state, ui, withInput({ inventoryPressed: true }), 0);
    const layout = layoutInventory(state, ui);
    expect(layout.maxScroll).toBeGreaterThan(0);

    updateInventoryUi(state, ui, withInput({ wheel: 1000 }), 0);
    expect(ui.scroll).toBe(layout.maxScroll);

    updateInventoryUi(state, ui, withInput({ wheel: -1000 }), 0);
    expect(ui.scroll).toBe(0);
  });
});
