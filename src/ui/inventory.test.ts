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
import {
  DESTROY_CONFIRM_SECONDS,
  TAB_ORDER,
  createInventoryUi,
  detailPageOf,
  helpButtonRect,
  layoutInventory,
  layoutSkills,
  skillColumnRects,
  tabRects,
  updateInventoryUi,
  type InventoryUi,
} from "./inventory";
import { detailPagerRects } from "./inventoryLayout";
import type { SlotFilter } from "./stashFilter";
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

function tileRect(state: State, ui: InventoryUi, filter: SlotFilter): Rect {
  const tile = layoutInventory(state, ui).tiles.find((t) => t.filter === filter);
  if (!tile) throw new Error(`tile ${filter} missing`);
  return tile.rect;
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
  it("タブの順に status がある（装備の次）", () => {
    expect(TAB_ORDER.indexOf("status"), "装備の次").toBe(TAB_ORDER.indexOf("equipment") + 1);
  });

  it("Tab は 閉 → 装備 → ステータス → スキル → 残響 → 網 → 閉 のサイクルで、state.paused が連動する", () => {
    const state = createGame(1);
    const ui = createInventoryUi();
    const expected = [
      { open: true, tab: "equipment" },
      { open: true, tab: "status" },
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
    expect(ui.open, "6 回目で閉じる").toBe(false);
    expect(state.paused, "閉じたら再開").toBe(false);

    updateInventoryUi(state, ui, withInput({ inventoryPressed: true }), 0);
    expect(ui.tab, "次に開くと装備タブから").toBe("equipment");
  });

  it("画面上のタブをクリックで切り替えられる", () => {
    const state = createGame(1);
    const ui = openUi(state);
    for (const tab of ["status", "skills", "echo", "web", "equipment"] as const) {
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

  it("Shift+クリックを 2 回で所持刻印符を捨てる", () => {
    const { state, ui } = runeSetup();
    clickAt(state, ui, runeRowRect(state, ui, "rb"), { shiftHeld: true });
    expect(state.skills.profile.runes, "1 回目では捨てない").toHaveLength(2);
    clickAt(state, ui, runeRowRect(state, ui, "rb"), { shiftHeld: true });
    expect(state.skills.profile.runes?.map((r) => r.id)).toEqual(["ra"]);
  });

  it("ホイールで列をスクロールしてもカーソル行へ戻らない（マウスが動いていない間）", () => {
    const state = createGame(1);
    const ui = openUi(state);
    ui.tab = "skills";
    const profile = state.skills.profile;
    profile.runes = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, modifier: "echo" as const, foundAt: i }));
    // 一覧の見出し帯（どの行にも乗らない位置）にマウスを置いたまま、ホイールだけを回す
    const list = layoutSkills(state, ui).runeList;
    const aimScreen = { x: list.header.x + 2, y: list.header.y + 1 };
    for (let i = 0; i < 10; i++) updateInventoryUi(state, ui, withInput({ wheel: 1, aimScreen }), 0);
    expect(ui.runes.scroll, "スクロールは進む").toBeGreaterThan(0);
    expect(ui.runes.cursor, "カーソルは先頭のまま").toBe(0);
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

  it("Shift+クリックを 2 回で砕き、性質の色の残響を得る（装備はしない）", () => {
    const state = createGame(1);
    const ui = openUi(state);
    const equippedBefore = state.profile.equipment.mainHand;
    addToStash(state.profile, makeItem({ id: "junk-1", affixes: [melee, life] }));

    clickAt(state, ui, stashRowRect(state, ui, "junk-1"), { shiftHeld: true });
    expect(state.profile.stash.some((it) => it.id === "junk-1"), "1 回目では砕かない").toBe(true);
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

  it("部位の枠をクリックするとその部位だけが並び、スクロールは先頭へ戻る（装備は外さない）", () => {
    const state = createGame(1);
    const ui = openUi(state);
    state.profile.stash = [];
    for (let i = 0; i < 30; i++) addToStash(state.profile, makeItem({ id: `sword-${i}`, foundAt: i }));
    addToStash(state.profile, makeItem({ id: "ring-1", slot: "ring", baseKey: "ironRing", foundAt: 100 }));
    const equippedRing = state.profile.equipment.ring;
    ui.scroll = 5;
    const ringTab = tileRect(state, ui, "ring");

    clickAt(state, ui, ringTab);

    expect(ui.stashView.slot).toBe("ring");
    expect(ui.scroll, "先頭へ戻る").toBe(0);
    const layout = layoutInventory(state, ui);
    expect(layout.stashOrder.map((it) => it.id)).toEqual(["ring-1"]);
    expect(layout.stashTotal, "総数は倉庫全体").toBe(31);
    expect(layout.stashCounts.mainHand, "他の部位の件数も数える").toBe(30);
    expect(state.profile.equipment.ring, "クリックだけでは外さない").toBe(equippedRing);
  });

  it("並び・絞り込みの帯は 1 段で、部位タブは部位の枠が兼ねる", () => {
    const state = createGame(1);
    const ui = openUi(state);
    const { stashToolbar } = layoutInventory(state, ui);
    expect(stashToolbar.some((c) => c.control.kind === "slot"), "帯に部位タブは無い").toBe(false);
    expect(new Set(stashToolbar.map((c) => c.rect.y)).size, "1 段").toBe(1);
  });

  it("倉庫の行と詳細欄は重ならない（浮くツールチップを使わない）", () => {
    const state = createGame(1);
    const ui = openUi(state);
    for (let i = 0; i < 30; i++) addToStash(state.profile, makeItem({ id: `sword-${i}`, foundAt: i }));
    const layout = layoutInventory(state, ui);
    for (const row of layout.stashRows) expect(row.rect.x + row.rect.w, "行は詳細欄の左で終わる").toBeLessThan(layout.detail.x);
    for (const tile of layout.tiles) expect(tile.rect.x + tile.rect.w, "枠は詳細欄の左で終わる").toBeLessThan(layout.detail.x);
  });
});

describe("装備画面の ？ と詳細欄の切り替え", () => {
  it("？ をクリックするとヘルプが開き、開いている間は他の操作を受けず、どこかをクリックで閉じる", () => {
    const state = createGame(1);
    const ui = openUi(state);
    addToStash(state.profile, makeItem({ id: "sword-1" }));
    clickAt(state, ui, helpButtonRect());
    expect(ui.helpOpen, "開く").toBe(true);
    clickAt(state, ui, stashRowRect(state, ui, "sword-1"));
    expect(ui.helpOpen, "クリックで閉じる").toBe(false);
    expect(state.profile.stash.some((it) => it.id === "sword-1"), "閉じるクリックでは装備しない").toBe(true);
  });

  it("拾うキーで詳細欄の 要点 / 詳しく を切り替え、閉じても保つ", () => {
    const state = createGame(1);
    const ui = openUi(state);
    expect(ui.detailFull, "既定は要点だけ").toBe(false);
    updateInventoryUi(state, ui, withInput({ interactPressed: true }), 0);
    expect(ui.detailFull).toBe(true);
    updateInventoryUi(state, ui, withInput({ inventoryPressed: true }), 0);
    expect(ui.detailFull, "タブを移っても保つ").toBe(true);
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

    clickAt(state, ui, tileRect(state, ui, "mainHand"), { shiftHeld: true });
    expect(state.pendingBud, "Shift+クリックで外すと消える").toBeNull();
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

describe("破壊操作の確認", () => {
  it("破壊操作は 2 回目で確定する（別の行を挟む・時間切れでは確定しない）", () => {
    const state = createGame(1);
    const ui = openUi(state);
    addToStash(state.profile, makeItem({ id: "a", foundAt: 2 }));
    addToStash(state.profile, makeItem({ id: "b", foundAt: 1 }));
    const has = (id: string): boolean => state.profile.stash.some((it) => it.id === id);

    clickAt(state, ui, stashRowRect(state, ui, "a"), { shiftHeld: true });
    expect(ui.pendingDestroy?.key, "1 回目は印だけ").toBe("shatter:a");
    clickAt(state, ui, stashRowRect(state, ui, "b"), { shiftHeld: true });
    expect(has("a"), "別の行へ移ると a は残る").toBe(true);
    expect(has("b"), "b も 1 回目").toBe(true);

    updateInventoryUi(state, ui, withInput({}), DESTROY_CONFIRM_SECONDS + 0.1);
    expect(ui.pendingDestroy, "時間切れで印が消える").toBeNull();
    clickAt(state, ui, stashRowRect(state, ui, "b"), { shiftHeld: true });
    expect(has("b"), "時間切れの後はまた 1 回目").toBe(true);
    clickAt(state, ui, stashRowRect(state, ui, "b"), { shiftHeld: true });
    expect(has("b"), "2 回目で砕く").toBe(false);
  });

  it("スキル石の分解も 2 回目で確定し、普通のクリックを挟むと取り消す", () => {
    const state = createGame(1);
    const ui = openUi(state);
    ui.tab = "skills";
    const profile = state.skills.profile;
    const stone = profile.stones[0];
    if (!stone) throw new Error("石が無い");
    const rowRect = (): Rect => {
      const row = layoutSkills(state, ui).rows.find((r) => r.stone.id === stone.id);
      if (!row) throw new Error("row missing");
      return row.rect;
    };
    clickAt(state, ui, rowRect(), { shiftHeld: true });
    expect(ui.pendingDestroy, "印が付く").not.toBeNull();
    clickAt(state, ui, skillColumnRects().slots);
    expect(ui.pendingDestroy, "別のクリックで取り消す").toBeNull();
    clickAt(state, ui, rowRect(), { shiftHeld: true });
    clickAt(state, ui, rowRect(), { shiftHeld: true });
    expect(profile.stones.some((s) => s.id === stone.id), "2 回目で分解").toBe(false);
  });
});

describe("詳細欄の頁送り", () => {
  it("頁送りの右をクリックで次、左で前へ回る", () => {
    const state = createGame(1);
    const ui = openUi(state);
    const pager = detailPagerRects();
    expect(detailPageOf(ui)).toBe("brief");
    clickAt(state, ui, pager.next);
    expect(detailPageOf(ui), "次").toBe("full");
    clickAt(state, ui, pager.next);
    expect(detailPageOf(ui), "その次").toBe("formula");
    clickAt(state, ui, pager.prev);
    expect(detailPageOf(ui), "前").toBe("full");
    clickAt(state, ui, pager.prev);
    clickAt(state, ui, pager.prev);
    expect(detailPageOf(ui), "先頭の前は末尾").toBe("formula");
  });

  it("頁送りは詳細欄の下端にあり、倉庫の一覧と重ならない", () => {
    const state = createGame(1);
    const ui = openUi(state);
    const { bar } = detailPagerRects();
    const layout = layoutInventory(state, ui);
    expect(bar.y, "本文の下").toBeGreaterThanOrEqual(layout.detail.y + layout.detail.h);
    expect(bar.x, "一覧より右").toBeGreaterThanOrEqual(layout.stashRows[0]?.rect.x ?? 0);
  });
});

describe("スキルタブのフォーカス", () => {
  it("マウスが動いた列にフォーカスが移り、1〜4 キーでスロットの列へ戻る", () => {
    const state = createGame(1);
    const ui = openUi(state);
    ui.tab = "skills";
    const cols = skillColumnRects();
    updateInventoryUi(state, ui, withInput({ aimScreen: { x: cols.runes.x + 2, y: cols.runes.y + 2 } }), 0);
    expect(ui.skillFocus, "刻印符の列").toBe("runes");
    updateInventoryUi(state, ui, withInput({ aimScreen: { x: cols.stones.x + 2, y: cols.stones.y + 2 } }), 0);
    expect(ui.skillFocus, "石の列").toBe("stones");
    updateInventoryUi(state, ui, withInput({ aimScreen: { x: cols.stones.x + 2, y: cols.stones.y + 2 }, skill2Pressed: true }), 0);
    expect(ui.skillFocus, "キーでスロット").toBe("slots");
    expect(ui.skillSlot).toBe(1);
  });
});
