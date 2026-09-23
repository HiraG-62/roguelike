import { type GameState, pushSfx } from "../core/state";
import type { FrameInput } from "../core/input";
import { describeTrait } from "../loot/describe";
import { equipItem, saveProfile, unequipItem } from "../loot/profile";
import { computeStats } from "../loot/stats";
import { refreshPendingBud } from "../system/loot";
import { applyStats } from "../system/player";
import { SLOTS, type Item, type Slot } from "../loot/types";
import { SKILL } from "../skills/data";
import { equipStone, saveSkillProfile, salvageStone, stoneInSlot, unequipSlot } from "../skills/persistence";
import type { SkillStone } from "../skills/types";
import { updateAllocButtons } from "./attributeAlloc";
import { type BudUi, closeBudModal, createBudUi, tryOpenBudModal, updateBudModal } from "./bud";
import { type EchoUi, createEchoUi, shatterStashItem, tickEchoUi, updateEchoTab } from "./echoTab";
import { type SynergyPanelUi, createSynergyPanelUi, updateSynergyPanel } from "./synergyPanel";
import {
  RUNE_BLOCK_TEXT,
  type RuneListLayout,
  type RuneToggleResult,
  type RuneUi,
  createRuneUi,
  hoveredRuneRow,
  layoutRuneList,
  moveRuneCursor,
  readNav,
  toggleRune,
} from "./skillRunes";
import {
  COLUMN_GAP,
  CONTENT_BOTTOM,
  CONTENT_H,
  CONTENT_Y,
  HINT_H,
  LEFT_W,
  PANEL_H,
  PANEL_W,
  PANEL_X,
  PANEL_Y,
  RIGHT_W,
  RIGHT_X,
  STASH_HEADER_H,
  STASH_ROW_H,
  TOOLTIP_H,
  type Rect,
  type StashRowLayout,
  clamp,
  findRowAt,
  layoutStashList,
  pointInRect,
  sortStash,
} from "./inventoryLayout";

export {
  COLUMN_GAP,
  CONTENT_BOTTOM,
  CONTENT_H,
  CONTENT_Y,
  HEADER_H,
  HINT_H,
  LEFT_W,
  PANEL_H,
  PANEL_MARGIN,
  PANEL_W,
  PANEL_X,
  PANEL_Y,
  RIGHT_W,
  RIGHT_X,
  SLOT_LABEL,
  STASH_HEADER_H,
  STASH_ROW_H,
  TOOLTIP_H,
  type Rect,
  type StashRowLayout,
} from "./inventoryLayout";

export const SLOT_H = 18;
export const SLOT_GAP = 4;

/** ヘッダーのタブ（クリック or Tab 連打で切替） */
export const TAB_Y = PANEL_Y + 1;
export const TAB_H = 9;
export const TAB_GAP = 4;
export type InventoryTab = "equipment" | "skills" | "echo" | "web";
export const TAB_WIDTHS: Readonly<Record<InventoryTab, number>> = { equipment: 58, skills: 38, echo: 34, web: 22 };
export const TAB_ORDER: readonly InventoryTab[] = ["equipment", "skills", "echo", "web"];

/** スキルタブ: 左にスロット、右に石の一覧と刻印符の一覧を左右に並べる */
export const SKILL_SLOT_H = 30;
export const SKILL_SLOT_GAP = 4;
export const STONE_COL_W = Math.floor((RIGHT_W - COLUMN_GAP) / 2);
export const RUNE_COL_X = RIGHT_X + STONE_COL_W + COLUMN_GAP;
export const RUNE_COL_W = RIGHT_W - STONE_COL_W - COLUMN_GAP;

/** メッセージ（「装備した: xxx」等）の表示秒数 */
const MESSAGE_DURATION = 1.5;

export interface SlotLayout {
  slot: Slot;
  rect: Rect;
  item: Item | null;
}

export interface InventoryLayout {
  panel: Rect;
  slots: SlotLayout[];
  /** 倉庫の見出し行（芽があればバナー） */
  stashHeader: Rect;
  /** 現在スクロール位置で画面に見えている行のみ */
  stashRows: StashRowLayout[];
  stashOrder: Item[];
  /** 左下: ツールチップの基準（下端を揃えて上へ伸ばす） */
  tooltipRect: Rect;
  /** 右下: 共鳴パネル */
  resonanceRect: Rect;
  hintRect: Rect;
  visibleRowCount: number;
  maxScroll: number;
}

export interface TabLayout {
  tab: InventoryTab;
  rect: Rect;
}

export interface SkillSlotLayout {
  index: number;
  rect: Rect;
  stone: SkillStone | null;
}

export interface StoneRowLayout {
  stone: SkillStone;
  rect: Rect;
  /** 装着中のスロット番号（-1 なら未装着） */
  equippedSlot: number;
}

export interface SkillsLayout {
  slots: SkillSlotLayout[];
  rows: StoneRowLayout[];
  stoneOrder: SkillStone[];
  maxScroll: number;
  /** 刻印符の列（選択中スロットの石に付いた符 → 所持品） */
  runeList: RuneListLayout;
}

export interface InventoryUi {
  open: boolean;
  tab: InventoryTab;
  /** スキルタブの選択中スロット。石をクリックしたとき空きが無ければここへ入れ、刻印符はここの石に付け外しする */
  skillSlot: number;
  /** スキルタブの刻印符の列 */
  runes: RuneUi;
  hoverStoneId: string | null;
  hoverSkillSlot: number | null;
  skillScroll: number;
  scroll: number;
  hoverItemId: string | null;
  hoverSlot: Slot | null;
  message: string;
  messageTimer: number;
  /** 芽の 2 択モーダル */
  bud: BudUi;
  /** 残響タブ */
  echo: EchoUi;
  /** 網タブ（語の一覧） */
  web: SynergyPanelUi;
  /** 装備タブのステータス振り分け「+」でマウスが乗っている行（-1 = なし） */
  hoverAlloc: number;
}

export function createInventoryUi(): InventoryUi {
  return {
    open: false,
    tab: "equipment",
    skillSlot: 0,
    runes: createRuneUi(),
    hoverStoneId: null,
    hoverSkillSlot: null,
    skillScroll: 0,
    scroll: 0,
    hoverItemId: null,
    hoverSlot: null,
    message: "",
    messageTimer: 0,
    bud: createBudUi(),
    echo: createEchoUi(),
    web: createSynergyPanelUi(),
    hoverAlloc: -1,
  };
}

/**
 * 装備タブのレイアウト。ロジック（updateInventoryUi）と描画（drawInventoryUi）で共有する。
 * 内部解像度（480x270）基準の座標を返す。
 */
export function layoutInventory(state: GameState, ui: InventoryUi): InventoryLayout {
  const panel: Rect = { x: PANEL_X, y: PANEL_Y, w: PANEL_W, h: PANEL_H };
  const slots: SlotLayout[] = SLOTS.map((slot, i) => ({
    slot,
    rect: { x: PANEL_X, y: CONTENT_Y + i * (SLOT_H + SLOT_GAP), w: LEFT_W, h: SLOT_H },
    item: state.profile.equipment[slot],
  }));
  const stashHeader: Rect = { x: RIGHT_X, y: CONTENT_Y, w: RIGHT_W, h: STASH_HEADER_H };
  const stashOrder = sortStash(state.profile.stash);
  const area: Rect = { x: RIGHT_X, y: CONTENT_Y + STASH_HEADER_H, w: RIGHT_W, h: CONTENT_H - STASH_HEADER_H };
  const list = layoutStashList(stashOrder, ui.scroll, area);
  const bottomY = CONTENT_Y + CONTENT_H;
  return {
    panel,
    slots,
    stashHeader,
    stashRows: list.rows,
    stashOrder,
    tooltipRect: { x: PANEL_X, y: bottomY, w: LEFT_W, h: TOOLTIP_H },
    resonanceRect: { x: RIGHT_X, y: bottomY, w: RIGHT_W, h: TOOLTIP_H },
    hintRect: { x: PANEL_X, y: CONTENT_BOTTOM, w: PANEL_W, h: HINT_H },
    visibleRowCount: list.visibleRowCount,
    maxScroll: list.maxScroll,
  };
}

/** 装備タブの左列、スロットの下からツールチップの上までの空き（ステータス一覧と振り分けの「+」） */
export function attributePanelRect(): Rect {
  const y = CONTENT_Y + SLOTS.length * (SLOT_H + SLOT_GAP);
  const bottom = CONTENT_Y + CONTENT_H - SLOT_GAP;
  return { x: PANEL_X, y, w: LEFT_W, h: Math.max(0, bottom - y) };
}

function findHoveredSlot(layout: InventoryLayout, p: { x: number; y: number }): SlotLayout | null {
  return layout.slots.find((s) => pointInRect(p, s.rect)) ?? null;
}

/** 装備変更後の反映: stats 再計算・HP 割合維持・芽の提示の付け直し・保存 */
function applyEquipmentChange(state: GameState): void {
  applyStats(state, computeStats(state.profile.equipment));
  refreshPendingBud(state);
  saveProfile(state.profile);
}

function showMessage(ui: InventoryUi, text: string): void {
  ui.message = text;
  ui.messageTimer = MESSAGE_DURATION;
}

export function tabRects(): TabLayout[] {
  let x = PANEL_X + 1;
  return TAB_ORDER.map((tab) => {
    const rect = { x, y: TAB_Y, w: TAB_WIDTHS[tab], h: TAB_H };
    x += TAB_WIDTHS[tab] + TAB_GAP;
    return { tab, rect };
  });
}

function clearHover(ui: InventoryUi): void {
  ui.hoverItemId = null;
  ui.hoverSlot = null;
  ui.hoverStoneId = null;
  ui.hoverSkillSlot = null;
  ui.runes.focusId = null;
  ui.echo.hoverOp = null;
  ui.echo.hoverId = null;
  ui.hoverAlloc = -1;
}

function switchTab(ui: InventoryUi, tab: InventoryTab): void {
  ui.tab = tab;
  closeBudModal(ui.bud);
  clearHover(ui);
}

/** Tab キー: 閉 → 装備 → スキル → 残響 → 網 → 閉 */
function cycleTab(state: GameState, ui: InventoryUi): void {
  if (!ui.open) {
    ui.open = true;
    switchTab(ui, "equipment");
  } else {
    const next = TAB_ORDER[TAB_ORDER.indexOf(ui.tab) + 1];
    if (next === undefined) ui.open = false;
    else switchTab(ui, next);
  }
  state.paused = ui.open;
  if (ui.open) return;
  closeBudModal(ui.bud);
  clearHover(ui);
}

/** 装着中の石を先頭（スロット順）、残りは新しい順 */
function stoneOrder(state: GameState): SkillStone[] {
  const profile = state.skills.profile;
  const equipped = profile.loadout.filter((id): id is string => id !== null);
  const rank = (s: SkillStone): number => {
    const i = equipped.indexOf(s.id);
    return i < 0 ? equipped.length : i;
  };
  return [...profile.stones].sort((a, b) => rank(a) - rank(b) || b.foundAt - a.foundAt);
}

export function layoutSkills(state: GameState, ui: InventoryUi): SkillsLayout {
  const profile = state.skills.profile;
  const slots: SkillSlotLayout[] = Array.from({ length: SKILL.slots }, (_, index) => ({
    index,
    rect: { x: PANEL_X, y: CONTENT_Y + index * (SKILL_SLOT_H + SKILL_SLOT_GAP), w: LEFT_W, h: SKILL_SLOT_H },
    stone: stoneInSlot(profile, index),
  }));
  const order = stoneOrder(state);
  const visible = Math.max(0, Math.floor(CONTENT_H / STASH_ROW_H));
  const maxScroll = Math.max(0, order.length - visible);
  const scroll = clamp(ui.skillScroll, 0, maxScroll);
  const rows: StoneRowLayout[] = [];
  for (let row = 0; row < visible; row++) {
    const stone = order[row + scroll];
    if (!stone) break;
    rows.push({
      stone,
      equippedSlot: profile.loadout.indexOf(stone.id),
      rect: { x: RIGHT_X, y: CONTENT_Y + row * STASH_ROW_H, w: STONE_COL_W, h: STASH_ROW_H },
    });
  }
  const runeArea: Rect = { x: RUNE_COL_X, y: CONTENT_Y, w: RUNE_COL_W, h: CONTENT_H };
  const runeList = layoutRuneList(profile, stoneInSlot(profile, ui.skillSlot), ui.runes, runeArea);
  return { slots, rows, stoneOrder: order, maxScroll, runeList };
}

/**
 * スキルタブの入力。石の一覧クリック: 空きスロット（無ければ選択中スロット）へ装着、Shift+クリックで分解。
 * スロットクリック: 選択（Shift+クリックで解除）。刻印符は updateRuneColumn
 */
function updateSkillsTab(state: GameState, ui: InventoryUi, input: FrameInput): void {
  selectSlotByKeys(ui, input);
  const layout = layoutSkills(state, ui);
  const aim = input.aimScreen;
  const inRunes = aim !== null && aim.x >= RUNE_COL_X;
  if (inRunes) ui.runes.scroll = clamp(ui.runes.scroll + input.wheel, 0, layout.runeList.maxScroll);
  else ui.skillScroll = clamp(ui.skillScroll + input.wheel, 0, layout.maxScroll);
  const slot = aim ? (layout.slots.find((s) => pointInRect(aim, s.rect)) ?? null) : null;
  const row = aim ? (layout.rows.find((r) => pointInRect(aim, r.rect)) ?? null) : null;
  ui.hoverSkillSlot = slot ? slot.index : null;
  ui.hoverStoneId = row ? row.stone.id : (slot?.stone?.id ?? null);
  if (updateRuneColumn(state, ui, input, layout.runeList)) return;
  if (!input.clickPressed) return;

  const profile = state.skills.profile;
  if (row) {
    clickStoneRow(state, ui, row.stone.id, input.shiftHeld);
    return;
  }
  if (!slot) return;
  ui.skillSlot = slot.index;
  if (!slot.stone || !input.shiftHeld) return;
  unequipSlot(profile, slot.index);
  saveSkillProfile(profile);
  showMessage(ui, `スキル ${slot.index + 1} を解除した`);
  pushSfx(state, "equipOff");
}

/** スキルキー（1〜4 / パッドの LB+ボタン）と左右の移動で選択中スロットを変える */
function selectSlotByKeys(ui: InventoryUi, input: FrameInput): void {
  const keys = [input.skill1Pressed, input.skill2Pressed, input.skill3Pressed, input.skill4Pressed];
  const pressed = keys.findIndex((on) => on);
  if (pressed >= 0) ui.skillSlot = pressed;
  const nav = readNav(ui.runes, input);
  if (nav.dx !== 0) ui.skillSlot = clamp(ui.skillSlot + nav.dx, 0, SKILL.slots - 1);
  ui.runes.cursor += nav.dy;
}

/** 石の一覧のクリック: 装着（空きスロット優先）/ Shift で分解（付いていた刻印符は所持品へ戻る） */
function clickStoneRow(state: GameState, ui: InventoryUi, stoneId: string, shift: boolean): void {
  const profile = state.skills.profile;
  if (shift) {
    if (salvageStone(profile, stoneId)) {
      showMessage(ui, "スキル石を分解した");
      pushSfx(state, "dismantle");
    }
  } else {
    const empty = profile.loadout.indexOf(null);
    const target = empty >= 0 ? empty : ui.skillSlot;
    equipStone(profile, stoneId, target);
    ui.skillSlot = target;
    showMessage(ui, `スキル ${target + 1} を設定した`);
    pushSfx(state, "equipOn");
  }
  saveSkillProfile(profile);
}

/**
 * 刻印符の列: マウスの乗った行かカーソルの行を、決定（クリック / Enter / パッド A）で付け外しする。
 * Shift+クリックは所持品の符を捨てる。操作を消費したら true
 */
function updateRuneColumn(state: GameState, ui: InventoryUi, input: FrameInput, list: RuneListLayout): boolean {
  const r = ui.runes;
  const hovered = hoveredRuneRow(list, input.aimScreen);
  if (hovered) r.cursor = hovered.index;
  // selectSlotByKeys が足した分をここで範囲に収め、見える位置へスクロールする
  moveRuneCursor(r, list, 0);
  const entry = list.entries[r.cursor];
  r.focusId = hovered ? hovered.rune.id : input.aimScreen ? null : (entry?.rune.id ?? null);
  const clicked = input.clickPressed && hovered !== null;
  if (!clicked && !input.confirmPressed) return false;
  const target = clicked ? hovered : entry;
  if (!target) return clicked;
  const profile = state.skills.profile;
  const result = toggleRune(profile, stoneInSlot(profile, ui.skillSlot), target, clicked && input.shiftHeld);
  reportRuneToggle(state, ui, result);
  if (result.kind !== "blocked") saveSkillProfile(profile);
  return true;
}

function reportRuneToggle(state: GameState, ui: InventoryUi, result: RuneToggleResult): void {
  switch (result.kind) {
    case "attached":
      showMessage(ui, `刻印符「${result.name}」をスキル ${ui.skillSlot + 1} に付けた`);
      pushSfx(state, "runeAttach");
      return;
    case "detached":
      showMessage(ui, `刻印符「${result.name}」を外した`);
      pushSfx(state, "equipOff");
      return;
    case "discarded":
      showMessage(ui, `刻印符「${result.name}」を捨てた`);
      pushSfx(state, "dismantle");
      return;
    case "blocked":
      showMessage(ui, RUNE_BLOCK_TEXT[result.reason]);
      return;
  }
}

function tickMessage(ui: InventoryUi, dt: number): void {
  if (ui.messageTimer <= 0) return;
  ui.messageTimer = Math.max(0, ui.messageTimer - dt);
  if (ui.messageTimer === 0) ui.message = "";
}

export function updateInventoryUi(state: GameState, ui: InventoryUi, input: FrameInput, dt: number): void {
  if (input.inventoryPressed) cycleTab(state, ui);
  tickMessage(ui, dt);
  tickEchoUi(ui.echo, dt);
  if (!ui.open) return;

  const aim = input.aimScreen;
  const tab = input.clickPressed && aim ? tabRects().find((t) => pointInRect(aim, t.rect)) : undefined;
  if (tab) {
    switchTab(ui, tab.tab);
    return;
  }
  switch (ui.tab) {
    case "skills":
      updateSkillsTab(state, ui, input);
      return;
    case "echo":
      updateEchoTab(state, ui.echo, input);
      return;
    case "web":
      updateSynergyPanel(ui.web, input, dt);
      return;
    case "equipment":
      updateEquipmentTab(state, ui, input);
      return;
  }
}

// ---------------------------------------------------------------------------
// 装備タブ
// ---------------------------------------------------------------------------

/** 芽のモーダルを開いている間は、それ以外の操作を受け付けない */
function updateBudFlow(state: GameState, ui: InventoryUi, input: FrameInput): boolean {
  if (ui.bud.open) {
    const chosen = updateBudModal(state, ui.bud, input);
    if (chosen !== null) showMessage(ui, `芽吹いた: ${describeTrait(chosen).text}`);
    return true;
  }
  return tryOpenBudModal(state, ui.bud, input);
}

function updateEquipmentTab(state: GameState, ui: InventoryUi, input: FrameInput): void {
  if (updateBudFlow(state, ui, input)) {
    ui.hoverItemId = null;
    ui.hoverSlot = null;
    ui.hoverAlloc = -1;
    return;
  }
  const alloc = updateAllocButtons(state, input, attributePanelRect());
  ui.hoverAlloc = alloc.hover;
  if (alloc.used) return;
  const layout = layoutInventory(state, ui);
  ui.scroll = clamp(ui.scroll + input.wheel, 0, layout.maxScroll);

  const hoveredSlot = input.aimScreen ? findHoveredSlot(layout, input.aimScreen) : null;
  const hoveredRow = findRowAt(layout.stashRows, input.aimScreen);
  ui.hoverSlot = hoveredSlot ? hoveredSlot.slot : null;
  ui.hoverItemId = hoveredRow ? hoveredRow.item.id : (hoveredSlot?.item?.id ?? null);
  if (!input.clickPressed) return;

  if (hoveredRow) {
    clickStashRow(state, ui, hoveredRow.item, input.shiftHeld);
    return;
  }
  if (hoveredSlot?.item) {
    const name = hoveredSlot.item.name;
    unequipItem(state.profile, hoveredSlot.slot);
    applyEquipmentChange(state);
    showMessage(ui, `外した: ${name}`);
    pushSfx(state, "equipOff");
  }
}

/** クリックで装備、Shift+クリックで砕く（残響を得る） */
function clickStashRow(state: GameState, ui: InventoryUi, item: Item, shift: boolean): void {
  if (shift) {
    const result = shatterStashItem(state, ui.echo, item);
    showMessage(ui, result.message);
    return;
  }
  equipItem(state.profile, item.id);
  applyEquipmentChange(state);
  showMessage(ui, `装備した: ${item.name}`);
  pushSfx(state, "equipOn");
}
