import { describe, expect, it } from "vitest";
import { createGame, step } from "../core/game";
import { EMPTY_INPUT, type FrameInput } from "../core/input";
import { FIXED_DT } from "../core/loop";
import type { GameState } from "../core/state";
import { ATTR, ATTR_GAIN } from "../data/tuning";
import { computeStats } from "../loot/stats";
import { createEmptyProfile, uniformAttributes, type AffixRoll, type Item, type Slot } from "../loot/types";
import { grantBoon } from "../system/boons";
import { descend, floorAttributePoints } from "../system/floor";
import { ALLOC_ORDER, allocButtonRect, allocKeyIndex, allocateAttribute } from "./attributeAlloc";
import { createInventoryUi, updateInventoryUi, type InventoryUi } from "./inventory";
import { statusAttrPanelRect } from "./statusTab";

function withInput(partial: Partial<FrameInput>): FrameInput {
  return { ...EMPTY_INPUT, move: { ...EMPTY_INPUT.move }, ...partial };
}

/** 階段で降りた直後の状態（祝福の提示は無し）。点が 1 ある */
function arrived(seed = 3): GameState {
  const state = createGame(seed);
  descend(state);
  return state;
}

/** 装備画面をステータスタブ（Tab 2 回: 装備 → ステータス）で開いた状態 */
function openInventory(state: GameState): InventoryUi {
  const ui = createInventoryUi();
  updateInventoryUi(state, ui, withInput({ inventoryPressed: true }), 0);
  updateInventoryUi(state, ui, withInput({ inventoryPressed: true }), 0);
  return ui;
}

function buttonCenter(index: number): { x: number; y: number } {
  const r = allocButtonRect(statusAttrPanelRect(), index);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

describe("振り分け点の付与", () => {
  it("階層到達で +1", () => {
    const state = createGame(1);
    descend(state);
    expect(state.runAttributes.unspent).toBe(ATTR_GAIN.perFloor);
    descend(state);
    expect(state.runAttributes.unspent, "未振りの点は持ち越す").toBe(ATTR_GAIN.perFloor * 2);
  });

  it("ボスを倒した階から降りるとさらに +2", () => {
    const state = createGame(1);
    state.boss = { enemyId: 0, name: "test", roomIndex: 0, introTimer: 0, defeated: true, major: true };
    expect(floorAttributePoints(state)).toBe(ATTR_GAIN.perFloor + ATTR_GAIN.perBoss);
    descend(state);
    expect(state.runAttributes.unspent).toBe(ATTR_GAIN.perFloor + ATTR_GAIN.perBoss);
    // 毎階の最後の部屋には主（階の主かボス）が出るので state.boss 自体は null にならないが、
    // 前の階の撃破済みの状態は引き継がない（新しい主はまだ倒していない）
    expect(state.boss?.defeated, "新しい階の主はまだ倒していない").toBe(false);
  });

  it("倒していないボスでは +2 しない", () => {
    const state = createGame(1);
    state.boss = { enemyId: 0, name: "test", roomIndex: 0, introTimer: 0, defeated: false, major: true };
    expect(floorAttributePoints(state)).toBe(ATTR_GAIN.perFloor);
  });
});

describe("装備画面での振り分け", () => {
  it("「+」のクリックで 1 点振り、stats が変わる", () => {
    ALLOC_ORDER.forEach((attr, i) => {
      const state = arrived();
      const ui = openInventory(state);
      expect(state.paused, "装備画面はゲームを止める").toBe(true);
      updateInventoryUi(state, ui, withInput({ aimScreen: buttonCenter(i), clickPressed: true, attackPressed: true }), 0);
      expect(state.runAttributes.alloc[attr], `${i} 行目 → ${attr}`).toBe(1);
      expect(state.runAttributes.unspent, `${attr} で点を使う`).toBe(0);
      expect(state.stats.attributes[attr], `${attr} の生値が増える`).toBe(ATTR.base + 1);
    });
  });

  it("キーはスキル 1〜4 と攻撃が 5 行に対応する", () => {
    const keys = ["skill1Pressed", "skill2Pressed", "skill3Pressed", "skill4Pressed", "attackPressed"] as const;
    keys.forEach((key, i) => {
      expect(allocKeyIndex(withInput({ [key]: true })), key).toBe(i);
      const state = arrived();
      const ui = openInventory(state);
      updateInventoryUi(state, ui, withInput({ [key]: true }), 0);
      const attr = ALLOC_ORDER[i];
      if (!attr) throw new Error("行が足りない");
      expect(state.runAttributes.alloc[attr], `${key} → ${attr}`).toBe(1);
    });
  });

  it("「+」の外のクリック（攻撃にも束縛）やパッドの A では振らない", () => {
    const state = arrived();
    const ui = openInventory(state);
    updateInventoryUi(state, ui, withInput({ aimScreen: { x: 1, y: 1 }, clickPressed: true, attackPressed: true }), 0);
    updateInventoryUi(state, ui, withInput({ attackPressed: true, padConfirmPressed: true }), 0);
    expect(state.runAttributes.unspent).toBe(1);
  });

  it("ステータスタブ以外では振らない", () => {
    const state = arrived();
    const ui = openInventory(state);
    expect(ui.tab).toBe("status");
    updateInventoryUi(state, ui, withInput({ inventoryPressed: true }), 0);
    expect(ui.tab).toBe("skills");
    updateInventoryUi(state, ui, withInput({ skill1Pressed: true }), 0);
    expect(state.runAttributes.unspent, "スキルタブ").toBe(1);
    ui.tab = "equipment";
    updateInventoryUi(state, ui, withInput({ skill1Pressed: true }), 0);
    updateInventoryUi(state, ui, withInput({ aimScreen: buttonCenter(0), clickPressed: true }), 0);
    expect(state.runAttributes.unspent, "装備タブ").toBe(1);
  });

  it("点が無ければ押しても振れない", () => {
    const state = createGame(1);
    const ui = openInventory(state);
    updateInventoryUi(state, ui, withInput({ aimScreen: buttonCenter(0), clickPressed: true }), 0);
    expect(state.runAttributes.alloc).toEqual(uniformAttributes(0));
    expect(allocateAttribute(state, "str")).toBe(false);
  });

  it("振り分けは派生に入る（体力で最大 HP が増える）", () => {
    const state = arrived();
    const before = state.stats.maxHp;
    allocateAttribute(state, "vit");
    expect(state.stats.maxHp).toBe(before + ATTR.vitMaxHp);
    expect(state.player.maxHp, "プレイヤーにも反映").toBe(before + ATTR.vitMaxHp);
  });
});

describe("探索中は振り分けがキーを奪わない", () => {
  it("未振りの点があってもスキル・攻撃キーは行動に渡り、振られない", () => {
    const state = arrived();
    step(state, withInput({ attackPressed: true }), FIXED_DT);
    expect(state.player.attack.phase, "攻撃が出る").not.toBe("none");
    step(state, withInput({ skill1Pressed: true }), FIXED_DT);
    expect(state.runAttributes.unspent, "step では振らない").toBe(1);
  });

  it("未振りの点が残っていてもゲームは進む", () => {
    const state = arrived();
    const tick = state.tick;
    step(state, withInput({ move: { x: 1, y: 0 } }), FIXED_DT);
    expect(state.tick, "step が止まらない").toBe(tick + 1);
  });
});

describe("振り分けはラン内に限られる", () => {
  it("profile に残らず、次のランは基礎値から始まる", () => {
    const profile = createEmptyProfile();
    const state = createGame(1, "1", profile);
    descend(state);
    allocateAttribute(state, "str");
    expect(state.stats.attributes.str).toBe(ATTR.base + 1);
    const json = JSON.stringify(profile);
    expect(json.includes("alloc"), "profile に振り分けが入っていない").toBe(false);
    const next = createGame(2, "2", profile);
    expect(next.runAttributes.alloc).toEqual(uniformAttributes(0));
    expect(next.runAttributes.unspent).toBe(0);
    expect(next.stats.attributes).toEqual(uniformAttributes(ATTR.base));
  });

  it("祝福を取っても振り分けは消えず、二重にも掛からない", () => {
    const state = arrived();
    allocateAttribute(state, "str");
    const poise = state.stats.poiseDamageMul;
    grantBoon(state, "triggerHappy");
    expect(state.stats.attributes.str).toBe(ATTR.base + 1);
    expect(state.stats.poiseDamageMul).toBeCloseTo(poise, 9);
    expect(state.boonRun.baseStats?.attributes.str, "祝福の基準は振り分け前").toBe(ATTR.base);
  });

  it("開始時も派生を通り、祝福の基準 stats が装備由来になる", () => {
    const state = createGame(1);
    expect(state.boonRun.baseStats, "createGame で applyStats を通る").toEqual(computeStats(state.profile.equipment));
    expect(state.player.mana, "マナは満タン").toBe(state.stats.maxMana);
  });

  it("開始時の装備の共鳴（翠の支配 = 体力 +3）が最大 HP に入る", () => {
    const profile = createEmptyProfile();
    const life: AffixRoll = { key: "maxLife", value: 20, nominal: 20, flux: 0 };
    profile.equipment.armor = testItem("armor", [life, { key: "hpRegen", value: 1, nominal: 1, flux: 0 }]);
    profile.equipment.ring = testItem("ring", [life]);
    const equip = computeStats(profile.equipment);
    expect(equip.resonance.kind, "翠の支配が成立する").toBe("dominant");
    const state = createGame(1, "1", profile);
    const vitDelta = equip.attributes.vit - ATTR.base;
    expect(vitDelta, "体力が上がっている").toBeGreaterThan(0);
    expect(state.stats.maxHp).toBe(equip.maxHp + ATTR.vitMaxHp * vitDelta);
    expect(state.player.hp, "満タンで始まる").toBe(state.stats.maxHp);
  });
});

function testItem(slot: Slot, affixes: AffixRoll[]): Item {
  return {
    id: `aa-${slot}`,
    seed: 1,
    baseKey: "test",
    slot,
    rarity: "magic",
    itemLevel: 10,
    name: "test",
    implicit: null,
    affixes,
    foundDepth: 10,
    foundAt: 0,
  };
}
