import { type GameState, pushSfx } from "../core/state";
import type { FrameInput } from "../core/input";
import type { Vec } from "../core/vec";
import { describeTrait } from "../loot/describe";
import { equipItem, saveProfile, unequipItem } from "../loot/profile";
import { computeStats } from "../loot/stats";
import { refreshPendingBud } from "../system/loot";
import { applyStats } from "../system/player";
import type { Item } from "../loot/types";
import { SKILL } from "../skills/data";
import { equipStone, saveSkillProfile, salvageStone, stoneInSlot, unequipSlot } from "../skills/persistence";
import type { SkillStone } from "../skills/types";
import { updateAllocButtons } from "./attributeAlloc";
import { type BudUi, closeBudModal, createBudUi, tryOpenBudModal, updateBudModal } from "./bud";
import { type EchoUi, createEchoUi, shatterStashItem, tickEchoUi, updateEchoTab } from "./echoTab";
import {
  type SlotTileLayout,
  TILE_FILTERS,
  TOOLBAR_Y,
  attributePanelRect,
  budBannerRect,
  slotTileRects,
  stashListArea,
} from "./equipmentLayout";
import { type SynergyPanelUi, createSynergyPanelUi, updateSynergyPanel } from "./synergyPanel";
import {
  RUNE_BLOCK_TEXT,
  type RuneListLayout,
  type RuneToggleResult,
  type RuneUi,
  clampRuneCursor,
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
  CONTENT_Y,
  LIST_W,
  LIST_X,
  PANEL_H,
  PANEL_W,
  PANEL_X,
  PANEL_Y,
  STASH_HEADER_H,
  STASH_ROW_H,
  type DetailPage,
  type Rect,
  type StashRowLayout,
  clamp,
  detailRect,
  findRowAt,
  layoutStashList,
  pointInRect,
} from "./inventoryLayout";
import {
  type SlotCounts,
  type SlotFilter,
  type StashControlLayout,
  type StashView,
  applyStashView,
  createStashView,
  layoutStashToolbar,
  slotCounts,
  updateStashToolbar,
} from "./stashFilter";

export {
  COLUMN_GAP,
  CONTENT_BOTTOM,
  CONTENT_H,
  CONTENT_Y,
  DETAIL_W,
  DETAIL_X,
  FRAME_PAD,
  HEADER_H,
  LEFT_W,
  LIST_W,
  LIST_X,
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
  detailRect,
  type DetailPage,
  type Rect,
  type StashRowLayout,
} from "./inventoryLayout";
export { attributePanelRect, type SlotTileLayout } from "./equipmentLayout";

/** 見出しのタブ（クリック or Tab 連打で切替） */
export const TAB_Y = PANEL_Y + 2;
export const TAB_H = 10;
export const TAB_GAP = 2;
export type InventoryTab = "equipment" | "skills" | "echo" | "web";
export const TAB_WIDTHS: Readonly<Record<InventoryTab, number>> = { equipment: 34, skills: 40, echo: 34, web: 34 };
export const TAB_ORDER: readonly InventoryTab[] = ["equipment", "skills", "echo", "web"];

/** 見出し右端の ？（そのタブの操作と仕組みの説明を開く） */
const HELP_BUTTON_W = 14;

/** スキルタブ: 一覧の上端にスロット 4 枠、その下に石の一覧と刻印符の一覧を左右に並べる */
export const SKILL_SLOT_H = 28;
export const SKILL_SLOT_GAP = 3;
const SKILL_LIST_Y = CONTENT_Y + SKILL_SLOT_H + SKILL_SLOT_GAP;
export const STONE_COL_W = Math.floor((LIST_W - COLUMN_GAP) / 2);
export const RUNE_COL_X = LIST_X + STONE_COL_W + COLUMN_GAP;
export const RUNE_COL_W = LIST_X + LIST_W - RUNE_COL_X;

/** メッセージ（「装備した: xxx」等）の表示秒数 */
const MESSAGE_DURATION = 1.5;

export interface InventoryLayout {
  panel: Rect;
  /** 部位の枠（全部位 + 各部位）。装備中の遺物を見せ、クリックで一覧をその部位に絞る */
  tiles: SlotTileLayout[];
  /** 並び・絞り込みのボタン */
  stashToolbar: StashControlLayout[];
  /** 芽が出ていればバナー */
  budBanner: Rect | null;
  /** 現在スクロール位置で画面に見えている行のみ */
  stashRows: StashRowLayout[];
  /** 部位・並べ替え・絞り込みを通した後の表示順 */
  stashOrder: Item[];
  /** 倉庫の総数（絞り込み前） */
  stashTotal: number;
  /** 部位の枠に添える件数 */
  stashCounts: SlotCounts;
  /** 右の詳細欄 */
  detail: Rect;
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
  /** 石の一覧の見出し */
  stoneHeader: Rect;
  rows: StoneRowLayout[];
  stoneOrder: SkillStone[];
  maxScroll: number;
  /** 刻印符の列（選択中スロットの石に付いた符 → 所持品） */
  runeList: RuneListLayout;
  detail: Rect;
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
  /** 装備タブで乗せている部位の枠 */
  hoverTile: SlotFilter | null;
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
  /** 装備タブの倉庫の部位分け・並べ替え・絞り込み（開き直しても保つ） */
  stashView: StashView;
  /** 詳細欄に来歴・語などまで出すか（既定は要点だけ）。拾うキーで切り替え、開き直しても保つ */
  detailFull: boolean;
  /** 詳細欄に行動ごとの計算式を出すか（詳しくの次の頁）。detailFull とは同時に立たない */
  detailFormula: boolean;
  /** ？ のヘルプを開いている */
  helpOpen: boolean;
  hoverHelp: boolean;
  /** 前フレームのマウス照準（動いたときだけホバーでカーソルを奪うための比較用） */
  aimPrev: Vec | null;
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
    hoverTile: null,
    message: "",
    messageTimer: 0,
    bud: createBudUi(),
    echo: createEchoUi(),
    web: createSynergyPanelUi(),
    hoverAlloc: -1,
    stashView: createStashView(),
    detailFull: false,
    detailFormula: false,
    helpOpen: false,
    hoverHelp: false,
    aimPrev: null,
  };
}

/**
 * 装備タブのレイアウト。ロジック（updateInventoryUi）と描画（drawInventoryUi）で共有する。
 * 内部解像度（480x270）基準の座標を返す。
 */
export function layoutInventory(state: GameState, ui: InventoryUi): InventoryLayout {
  const panel: Rect = { x: PANEL_X, y: PANEL_Y, w: PANEL_W, h: PANEL_H };
  const tileRects = slotTileRects();
  const tiles = TILE_FILTERS.map((filter, i): SlotTileLayout | null => {
    const rect = tileRects[i];
    if (!rect) return null;
    const slot = filter === "all" ? null : filter;
    return { filter, slot, item: slot === null ? null : state.profile.equipment[slot], rect };
  }).filter((t): t is SlotTileLayout => t !== null);
  const toolbar = layoutStashToolbar({ x: LIST_X, y: TOOLBAR_Y, w: LIST_W }, state.profile.stash, { slotTabs: false });
  const hasBud = state.pendingBud !== null;
  const stashOrder = applyStashView(state.profile.stash, ui.stashView);
  const list = layoutStashList(stashOrder, ui.scroll, stashListArea(hasBud));
  return {
    panel,
    tiles,
    stashToolbar: toolbar.controls,
    budBanner: hasBud ? budBannerRect() : null,
    stashRows: list.rows,
    stashOrder,
    stashTotal: state.profile.stash.length,
    stashCounts: slotCounts(state.profile.stash, ui.stashView),
    detail: detailRect(),
    visibleRowCount: list.visibleRowCount,
    maxScroll: list.maxScroll,
  };
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
  let x = PANEL_X + 2;
  return TAB_ORDER.map((tab) => {
    const rect = { x, y: TAB_Y, w: TAB_WIDTHS[tab], h: TAB_H };
    x += TAB_WIDTHS[tab] + TAB_GAP;
    return { tab, rect };
  });
}

export function helpButtonRect(): Rect {
  return { x: PANEL_X + PANEL_W - 2 - HELP_BUTTON_W, y: TAB_Y, w: HELP_BUTTON_W, h: TAB_H };
}

function clearHover(ui: InventoryUi): void {
  ui.hoverItemId = null;
  ui.hoverTile = null;
  ui.hoverStoneId = null;
  ui.hoverSkillSlot = null;
  ui.runes.focusId = null;
  ui.echo.hoverOp = null;
  ui.echo.hoverId = null;
  ui.hoverAlloc = -1;
  ui.stashView.hover = null;
  ui.hoverHelp = false;
}

function switchTab(ui: InventoryUi, tab: InventoryTab): void {
  ui.tab = tab;
  ui.helpOpen = false;
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
  ui.helpOpen = false;
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

function skillSlotRects(): Rect[] {
  const n = SKILL.slots;
  const w = Math.floor((LIST_W - SKILL_SLOT_GAP * (n - 1)) / n);
  return Array.from({ length: n }, (_, i) => {
    const x = LIST_X + i * (w + SKILL_SLOT_GAP);
    return { x, y: CONTENT_Y, w: i === n - 1 ? LIST_X + LIST_W - x : w, h: SKILL_SLOT_H };
  });
}

export function layoutSkills(state: GameState, ui: InventoryUi): SkillsLayout {
  const profile = state.skills.profile;
  const slotRects = skillSlotRects();
  const slots: SkillSlotLayout[] = slotRects.map((rect, index) => ({ index, rect, stone: stoneInSlot(profile, index) }));
  const order = stoneOrder(state);
  const stoneHeader: Rect = { x: LIST_X, y: SKILL_LIST_Y, w: STONE_COL_W, h: STASH_HEADER_H };
  const rowsTop = SKILL_LIST_Y + STASH_HEADER_H;
  const visible = Math.max(0, Math.floor((CONTENT_BOTTOM - rowsTop) / STASH_ROW_H));
  const maxScroll = Math.max(0, order.length - visible);
  const scroll = clamp(ui.skillScroll, 0, maxScroll);
  const rows: StoneRowLayout[] = [];
  for (let row = 0; row < visible; row++) {
    const stone = order[row + scroll];
    if (!stone) break;
    rows.push({
      stone,
      equippedSlot: profile.loadout.indexOf(stone.id),
      rect: { x: LIST_X, y: rowsTop + row * STASH_ROW_H, w: STONE_COL_W, h: STASH_ROW_H },
    });
  }
  const runeArea: Rect = { x: RUNE_COL_X, y: SKILL_LIST_Y, w: RUNE_COL_W, h: CONTENT_BOTTOM - SKILL_LIST_Y };
  const runeList = layoutRuneList(profile, stoneInSlot(profile, ui.skillSlot), ui.runes, runeArea);
  return { slots, stoneHeader, rows, stoneOrder: order, maxScroll, runeList, detail: detailRect() };
}

/**
 * スキルタブの入力。石の一覧クリック: 空きスロット（無ければ選択中スロット）へ装着、Shift+クリックで分解。
 * スロットクリック: 選択（Shift+クリックで解除）。刻印符は updateRuneColumn
 */
function updateSkillsTab(state: GameState, ui: InventoryUi, input: FrameInput, aimMoved: boolean): void {
  const keyDy = selectSlotByKeys(ui, input);
  const layout = layoutSkills(state, ui);
  const aim = input.aimScreen;
  const inRunes = aim !== null && aim.x >= RUNE_COL_X && aim.y >= SKILL_LIST_Y;
  if (inRunes) ui.runes.scroll = clamp(ui.runes.scroll + input.wheel, 0, layout.runeList.maxScroll);
  else ui.skillScroll = clamp(ui.skillScroll + input.wheel, 0, layout.maxScroll);
  const slot = aim ? (layout.slots.find((s) => pointInRect(aim, s.rect)) ?? null) : null;
  const row = aim ? (layout.rows.find((r) => pointInRect(aim, r.rect)) ?? null) : null;
  ui.hoverSkillSlot = slot ? slot.index : null;
  ui.hoverStoneId = row ? row.stone.id : (slot?.stone?.id ?? null);
  if (updateRuneColumn(state, ui, input, layout.runeList, aimMoved, keyDy !== 0)) return;
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

/** スキルキー（1〜4 / パッドの LB+ボタン）と左右の移動で選択中スロットを変える。戻り値は刻印符カーソルへ与えた dy（キー操作か） */
function selectSlotByKeys(ui: InventoryUi, input: FrameInput): number {
  const keys = [input.skill1Pressed, input.skill2Pressed, input.skill3Pressed, input.skill4Pressed];
  const pressed = keys.findIndex((on) => on);
  if (pressed >= 0) ui.skillSlot = pressed;
  const nav = readNav(ui.runes, input);
  if (nav.dx !== 0) ui.skillSlot = clamp(ui.skillSlot + nav.dx, 0, SKILL.slots - 1);
  ui.runes.cursor += nav.dy;
  return nav.dy;
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
 * Shift+クリックは所持品の符を捨てる。操作を消費したら true。
 * ホバーでのカーソル奪取はマウスが実際に動いた時だけ、スクロールの追随はキー操作でカーソルが動いた時だけ
 * （ホイールで一覧をスクロールしただけでカーソル行へ戻らないようにする）
 */
function updateRuneColumn(
  state: GameState,
  ui: InventoryUi,
  input: FrameInput,
  list: RuneListLayout,
  aimMoved: boolean,
  keyNavigated: boolean,
): boolean {
  const r = ui.runes;
  const hovered = hoveredRuneRow(list, input.aimScreen);
  if (aimMoved && hovered) r.cursor = hovered.index;
  if (keyNavigated) moveRuneCursor(r, list, 0);
  else clampRuneCursor(r, list.entries.length);
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

/**
 * ？ のヘルプ。ボタンのクリックで開閉し、開いている間は他の操作を受け付けない（どこかをクリックすると閉じる）。
 * 入力を使ったら true
 */
function updateHelp(ui: InventoryUi, input: FrameInput): boolean {
  const aim = input.aimScreen;
  ui.hoverHelp = aim !== null && pointInRect(aim, helpButtonRect());
  if (ui.helpOpen) {
    if (input.clickPressed || input.confirmPressed) ui.helpOpen = false;
    return true;
  }
  if (!input.clickPressed || !ui.hoverHelp) return false;
  ui.helpOpen = true;
  clearHover(ui);
  ui.hoverHelp = true;
  return true;
}

/** 詳細欄の今の頁 */
export function detailPageOf(ui: Readonly<InventoryUi>): DetailPage {
  if (ui.detailFormula) return "formula";
  return ui.detailFull ? "full" : "brief";
}

/** 要点 → 詳しく → 計算式 → 要点 */
export function advanceDetailPage(ui: InventoryUi): void {
  const page = detailPageOf(ui);
  ui.detailFull = page === "brief";
  ui.detailFormula = page === "full";
}

export function updateInventoryUi(state: GameState, ui: InventoryUi, input: FrameInput, dt: number): void {
  if (input.inventoryPressed) cycleTab(state, ui);
  tickMessage(ui, dt);
  tickEchoUi(ui.echo, dt);
  if (!ui.open) return;
  if (updateHelp(ui, input)) return;
  // 拾うキーで詳細欄の「要点 → 詳しく → 計算式」を回す（装備画面を開いている間はゲームが止まっていて拾わない）
  if (input.interactPressed) advanceDetailPage(ui);

  const aim = input.aimScreen;
  // マウスが実際に動いた時だけホバーでカーソルを奪う（ホイールでのスクロールを上書きしないため）
  const aimMoved = aim !== null && (ui.aimPrev === null || ui.aimPrev.x !== aim.x || ui.aimPrev.y !== aim.y);
  ui.aimPrev = aim;
  const tab = input.clickPressed && aim ? tabRects().find((t) => pointInRect(aim, t.rect)) : undefined;
  if (tab) {
    switchTab(ui, tab.tab);
    return;
  }
  switch (ui.tab) {
    case "skills":
      updateSkillsTab(state, ui, input, aimMoved);
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
    ui.hoverTile = null;
    ui.hoverAlloc = -1;
    return;
  }
  const alloc = updateAllocButtons(state, input, attributePanelRect());
  ui.hoverAlloc = alloc.hover;
  if (alloc.used) return;
  const layout = layoutInventory(state, ui);
  if (updateStashToolbar(ui.stashView, layout.stashToolbar, input, state.profile.stash)) {
    // 条件が変わったら一覧の先頭から見せる
    ui.scroll = 0;
    pushSfx(state, "uiClick");
    return;
  }
  ui.scroll = clamp(ui.scroll + input.wheel, 0, layout.maxScroll);

  const aim = input.aimScreen;
  const tile = aim ? (layout.tiles.find((t) => pointInRect(aim, t.rect)) ?? null) : null;
  const hoveredRow = findRowAt(layout.stashRows, aim);
  ui.hoverTile = tile ? tile.filter : null;
  ui.hoverItemId = hoveredRow ? hoveredRow.item.id : (tile?.item?.id ?? null);
  if (!input.clickPressed) return;

  if (hoveredRow) {
    clickStashRow(state, ui, hoveredRow.item, input.shiftHeld);
    return;
  }
  if (tile) clickSlotTile(state, ui, tile, input.shiftHeld);
}

/** 部位の枠: クリックで一覧をその部位に絞る、Shift+クリックで装備中の遺物を外す */
function clickSlotTile(state: GameState, ui: InventoryUi, tile: SlotTileLayout, shift: boolean): void {
  if (!shift) {
    ui.stashView.slot = tile.filter;
    ui.scroll = 0;
    pushSfx(state, "uiClick");
    return;
  }
  if (tile.slot === null || tile.item === null) return;
  const name = tile.item.name;
  unequipItem(state.profile, tile.slot);
  applyEquipmentChange(state);
  showMessage(ui, `外した: ${name}`);
  pushSfx(state, "equipOff");
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
