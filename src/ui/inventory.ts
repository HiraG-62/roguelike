import type { GameState } from "../core/state";
import type { FrameInput } from "../core/input";
import { VIEW_H, VIEW_W } from "../core/view";
import { equipItem, saveProfile, salvageItem, unequipItem } from "../loot/profile";
import { computeStats } from "../loot/stats";
import { applyStats } from "../system/player";
import { SLOTS, type Item, type Slot } from "../loot/types";

/** 装備画面のパネル配置。render 側もこの定数を使って揃える */
export const PANEL_MARGIN = 8;
export const PANEL_X = PANEL_MARGIN;
export const PANEL_Y = PANEL_MARGIN;
export const PANEL_W = VIEW_W - PANEL_MARGIN * 2;
export const PANEL_H = VIEW_H - PANEL_MARGIN * 2;

export const HEADER_H = 10;
export const HINT_H = 10;
export const TOOLTIP_H = 42;
export const CONTENT_Y = PANEL_Y + HEADER_H;
export const CONTENT_H = PANEL_H - HEADER_H - TOOLTIP_H - HINT_H;

export const COLUMN_GAP = 4;
export const LEFT_W = Math.floor(PANEL_W / 3);
export const RIGHT_X = PANEL_X + LEFT_W + COLUMN_GAP;
export const RIGHT_W = PANEL_W - LEFT_W - COLUMN_GAP;

export const SLOT_H = 18;
export const SLOT_GAP = 4;
export const STASH_ROW_H = 12;

/** メッセージ（"Equipped: xxx" 等）の表示秒数 */
const MESSAGE_DURATION = 1.5;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SlotLayout {
  slot: Slot;
  rect: Rect;
  item: Item | null;
}

export interface StashRowLayout {
  item: Item;
  rect: Rect;
  /** stash 配列上のインデックス（新しい順に並べ替えた後の元インデックス） */
  index: number;
}

export interface InventoryLayout {
  panel: Rect;
  slots: SlotLayout[];
  /** 現在スクロール位置で画面に見えている行のみ */
  stashRows: StashRowLayout[];
  stashOrder: Item[];
  tooltipRect: Rect;
  statsRect: Rect;
  hintRect: Rect;
  visibleRowCount: number;
  maxScroll: number;
}

export interface InventoryUi {
  open: boolean;
  scroll: number;
  hoverItemId: string | null;
  hoverSlot: Slot | null;
  message: string;
  messageTimer: number;
}

export function createInventoryUi(): InventoryUi {
  return {
    open: false,
    scroll: 0,
    hoverItemId: null,
    hoverSlot: null,
    message: "",
    messageTimer: 0,
  };
}

function pointInRect(p: { x: number; y: number }, r: Rect): boolean {
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * 装備画面のレイアウトを計算する。ロジック（updateInventoryUi）と描画（drawInventoryUi）で共有する。
 * 内部解像度（480x270）基準の座標を返す。
 */
export function layoutInventory(state: GameState, ui: InventoryUi): InventoryLayout {
  const panel: Rect = { x: PANEL_X, y: PANEL_Y, w: PANEL_W, h: PANEL_H };

  const slots: SlotLayout[] = SLOTS.map((slot, i) => ({
    slot,
    rect: { x: PANEL_X, y: CONTENT_Y + i * (SLOT_H + SLOT_GAP), w: LEFT_W, h: SLOT_H },
    item: state.profile.equipment[slot],
  }));

  // 新しい順（foundAt 降順）に並べる
  const stashOrder = [...state.profile.stash].sort((a, b) => b.foundAt - a.foundAt);

  const visibleRowCount = Math.max(0, Math.floor(CONTENT_H / STASH_ROW_H));
  const maxScroll = Math.max(0, stashOrder.length - visibleRowCount);
  const scroll = clamp(ui.scroll, 0, maxScroll);

  const stashRows: StashRowLayout[] = [];
  for (let row = 0; row < visibleRowCount; row++) {
    const index = row + scroll;
    const item = stashOrder[index];
    if (!item) break;
    stashRows.push({
      item,
      index,
      rect: { x: RIGHT_X, y: CONTENT_Y + row * STASH_ROW_H, w: RIGHT_W, h: STASH_ROW_H },
    });
  }

  const tooltipRect: Rect = { x: PANEL_X, y: CONTENT_Y + CONTENT_H, w: LEFT_W, h: TOOLTIP_H };
  const statsRect: Rect = { x: RIGHT_X, y: CONTENT_Y + CONTENT_H, w: RIGHT_W, h: TOOLTIP_H };
  const hintRect: Rect = { x: PANEL_X, y: PANEL_Y + PANEL_H - HINT_H, w: PANEL_W, h: HINT_H };

  return { panel, slots, stashRows, stashOrder, tooltipRect, statsRect, hintRect, visibleRowCount, maxScroll };
}

function findHoveredSlot(layout: InventoryLayout, p: { x: number; y: number }): SlotLayout | null {
  for (const s of layout.slots) {
    if (pointInRect(p, s.rect)) return s;
  }
  return null;
}

function findHoveredStashRow(layout: InventoryLayout, p: { x: number; y: number }): StashRowLayout | null {
  for (const row of layout.stashRows) {
    if (pointInRect(p, row.rect)) return row;
  }
  return null;
}

/** 装備変更後の反映: stats 再計算・HP 割合維持・保存 */
function applyEquipmentChange(state: GameState): void {
  applyStats(state, computeStats(state.profile.equipment));
  saveProfile(state.profile);
}

function showMessage(ui: InventoryUi, text: string): void {
  ui.message = text;
  ui.messageTimer = MESSAGE_DURATION;
}

export function updateInventoryUi(state: GameState, ui: InventoryUi, input: FrameInput, dt: number): void {
  if (input.inventoryPressed) {
    ui.open = !ui.open;
    state.paused = ui.open;
    if (!ui.open) {
      ui.hoverItemId = null;
      ui.hoverSlot = null;
    }
  }

  if (ui.messageTimer > 0) {
    ui.messageTimer = Math.max(0, ui.messageTimer - dt);
    if (ui.messageTimer === 0) ui.message = "";
  }

  if (!ui.open) return;

  const layout = layoutInventory(state, ui);
  ui.scroll = clamp(ui.scroll + input.wheel, 0, layout.maxScroll);

  const hoveredSlot = input.aimScreen ? findHoveredSlot(layout, input.aimScreen) : null;
  const hoveredRow = input.aimScreen ? findHoveredStashRow(layout, input.aimScreen) : null;
  ui.hoverSlot = hoveredSlot ? hoveredSlot.slot : null;
  ui.hoverItemId = hoveredRow ? hoveredRow.item.id : hoveredSlot?.item ? hoveredSlot.item.id : null;

  if (!input.clickPressed) return;

  if (hoveredRow) {
    if (input.shiftHeld) {
      const name = hoveredRow.item.name;
      if (salvageItem(state.profile, hoveredRow.item.id)) {
        saveProfile(state.profile);
        showMessage(ui, `Salvaged: ${name}`);
      }
      return;
    }
    const name = hoveredRow.item.name;
    equipItem(state.profile, hoveredRow.item.id);
    applyEquipmentChange(state);
    showMessage(ui, `Equipped: ${name}`);
    return;
  }

  if (hoveredSlot?.item) {
    const name = hoveredSlot.item.name;
    unequipItem(state.profile, hoveredSlot.slot);
    applyEquipmentChange(state);
    showMessage(ui, `Unequipped: ${name}`);
  }
}
