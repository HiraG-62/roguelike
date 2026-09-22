import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGame } from "../core/game";
import { EMPTY_INPUT, type FrameInput } from "../core/input";
import { addToStash } from "../loot/profile";
import { DEFAULT_STATS, type Item, type PlayerStats } from "../loot/types";

vi.mock("../loot/stats", () => ({
  computeStats: vi.fn((): PlayerStats => ({ ...DEFAULT_STATS })),
}));

import { computeStats } from "../loot/stats";
import { createInventoryUi, layoutCraft, layoutInventory, layoutSkills, tabRects, updateInventoryUi } from "./inventory";

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
  it("Tab は 閉 → 装備 → スキル → クラフト → 閉 のサイクルで、state.paused が連動する", () => {
    const state = createGame(1);
    const ui = createInventoryUi();

    updateInventoryUi(state, ui, withInput({ inventoryPressed: true }), 0);
    expect(ui.open).toBe(true);
    expect(ui.tab).toBe("equipment");
    expect(state.paused).toBe(true);

    updateInventoryUi(state, ui, withInput({ inventoryPressed: true }), 0);
    expect(ui.open).toBe(true);
    expect(ui.tab).toBe("skills");
    expect(state.paused).toBe(true);

    updateInventoryUi(state, ui, withInput({ inventoryPressed: true }), 0);
    expect(ui.open).toBe(true);
    expect(ui.tab).toBe("craft");

    updateInventoryUi(state, ui, withInput({ inventoryPressed: true }), 0);
    expect(ui.open).toBe(false);
    expect(state.paused).toBe(false);

    // 次に開くと装備タブから
    updateInventoryUi(state, ui, withInput({ inventoryPressed: true }), 0);
    expect(ui.tab).toBe("equipment");
  });

  it("画面上のタブをクリックで切り替えられる", () => {
    const state = createGame(1);
    const ui = createInventoryUi();
    updateInventoryUi(state, ui, withInput({ inventoryPressed: true }), 0);
    const skillsTab = tabRects().find((t) => t.tab === "skills");
    if (!skillsTab) throw new Error("skills tab missing");
    const aim = { x: skillsTab.rect.x + 1, y: skillsTab.rect.y + 1 };
    updateInventoryUi(state, ui, withInput({ clickPressed: true, aimScreen: aim }), 0);
    expect(ui.tab).toBe("skills");
  });
});

describe("updateInventoryUi: スキルタブ", () => {
  it("スロットクリックで外し、石クリックで空きスロットへ装着する", () => {
    const state = createGame(1);
    const ui = createInventoryUi();
    ui.open = true;
    ui.tab = "skills";
    const profile = state.skills.profile;
    const firstId = profile.loadout[0];

    const slotRect = layoutSkills(state, ui).slots[0]?.rect;
    if (!slotRect) throw new Error("slot missing");
    updateInventoryUi(state, ui, withInput({ clickPressed: true, aimScreen: { x: slotRect.x + 1, y: slotRect.y + 1 } }), 0);
    expect(profile.loadout[0]).toBeNull();

    const row = layoutSkills(state, ui).rows.find((r) => r.stone.id === firstId);
    if (!row) throw new Error("row missing");
    updateInventoryUi(state, ui, withInput({ clickPressed: true, aimScreen: { x: row.rect.x + 1, y: row.rect.y + 1 } }), 0);
    expect(profile.loadout[0]).toBe(firstId);
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
    expect(ui.message).toBe("Salvaged: Junk Sword (+1 dust)");
    expect(ui.craft.save.wallet.dust).toBe(1);
  });

  it("rarity に応じた通貨が増える（magic → shard, rare → essence, unique → relic）", () => {
    const state = createGame(1);
    const ui = createInventoryUi();
    ui.open = true;
    const rarities = ["magic", "rare", "unique"] as const;
    rarities.forEach((rarity, i) => addToStash(state.profile, makeItem({ id: `s-${i}`, rarity, foundAt: i })));
    for (let i = 0; i < rarities.length; i++) {
      const row = layoutInventory(state, ui).stashRows[0]!;
      const point = { x: row.rect.x + 1, y: row.rect.y + 1 };
      updateInventoryUi(state, ui, withInput({ aimScreen: point, clickPressed: true, shiftHeld: true }), 0);
    }
    expect(ui.craft.save.wallet).toEqual({ dust: 0, shard: 1, essence: 1, relic: 1 });
  });
});

describe("updateInventoryUi: クラフトタブ", () => {
  function clickRow(state: ReturnType<typeof createGame>, ui: ReturnType<typeof createInventoryUi>, id: string): void {
    const row = layoutInventory(state, ui).stashRows.find((r) => r.item.id === id);
    if (!row) throw new Error(`row ${id} missing`);
    updateInventoryUi(state, ui, withInput({ aimScreen: { x: row.rect.x + 1, y: row.rect.y + 1 }, clickPressed: true }), 0);
  }

  function clickButton(state: ReturnType<typeof createGame>, ui: ReturnType<typeof createInventoryUi>, op: string): void {
    const button = layoutCraft().buttons.find((b) => b.op === op);
    if (!button) throw new Error(`button ${op} missing`);
    const aim = { x: button.rect.x + 1, y: button.rect.y + 1 };
    updateInventoryUi(state, ui, withInput({ aimScreen: aim, clickPressed: true }), 0);
  }

  const MAGIC_AFFIXES = [
    { key: "meleeDamagePct", kind: "prefix" as const, tier: 3, value: 30 },
    { key: "attackSpeed", kind: "suffix" as const, tier: 3, value: 8 },
  ];

  it("stash クリックで選択し、Annul で 1 つ消えて dust を 5 消費する", () => {
    const state = createGame(1);
    const ui = createInventoryUi();
    ui.open = true;
    ui.tab = "craft";
    ui.craft.save.wallet.dust = 6;
    addToStash(state.profile, makeItem({ id: "m-1", rarity: "magic", affixes: MAGIC_AFFIXES }));

    clickRow(state, ui, "m-1");
    expect(ui.craft.selectedId).toBe("m-1");
    clickButton(state, ui, "annul");

    expect(state.profile.stash[0]?.affixes).toHaveLength(1);
    expect(ui.craft.save.wallet.dust).toBe(1);
    expect(ui.craft.result).toMatch(/^Annulled: /);
  });

  it("通貨が足りない操作は拒否され、アイテムは変わらない", () => {
    const state = createGame(1);
    const ui = createInventoryUi();
    ui.open = true;
    ui.tab = "craft";
    addToStash(state.profile, makeItem({ id: "m-1", rarity: "magic", affixes: MAGIC_AFFIXES }));
    clickRow(state, ui, "m-1");
    clickButton(state, ui, "annul");
    expect(state.profile.stash[0]?.affixes).toHaveLength(2);
    expect(ui.craft.result).toBe("Need 5 dust");
  });

  it("Fuse は 2 つ目のクリックで実行され、2 つが 1 つになる", () => {
    const state = createGame(1);
    const ui = createInventoryUi();
    ui.open = true;
    ui.tab = "craft";
    ui.craft.save.wallet.essence = 1;
    addToStash(state.profile, makeItem({ id: "a", rarity: "magic", affixes: MAGIC_AFFIXES, foundAt: 1 }));
    addToStash(state.profile, makeItem({ id: "b", rarity: "magic", affixes: MAGIC_AFFIXES, foundAt: 0 }));

    clickRow(state, ui, "a");
    clickButton(state, ui, "fuse");
    expect(ui.craft.fusePending).toBe(true);
    clickRow(state, ui, "b");

    expect(ui.craft.fusePending).toBe(false);
    expect(state.profile.stash).toHaveLength(1);
    expect(ui.craft.selectedId).toBe(state.profile.stash[0]?.id);
    expect(ui.craft.save.wallet.essence).toBe(0);
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
