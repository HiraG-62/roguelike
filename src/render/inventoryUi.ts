import type { GameState } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import { RARITY_COLOR, SLOTS, type AffixRoll, type Item, type PlayerStats } from "../loot/types";
import {
  type InventoryLayout,
  type InventoryUi,
  type Rect,
  type SlotLayout,
  type StashRowLayout,
  layoutInventory,
} from "../ui/inventory";

const FONT_SMALL = "bold 8px monospace";
const FONT_TITLE = "bold 10px monospace";

const COLOR_TEXT = "#e0e0e0";
const COLOR_DIM = "#808080";
const COLOR_BORDER = "#505050";
const COLOR_PANEL_BG = "rgba(12,12,18,0.94)";
const COLOR_OVERLAY = "rgba(0,0,0,0.55)";
const COLOR_HOVER_BG = "rgba(255,255,255,0.10)";
const COLOR_EMPTY = "#606060";

const LINE_H = 8;
const TEXT_PAD_X = 2;

/** アフィックスの表示文字列。src/loot/affixes.ts の formatAffix が実装されるまでの暫定 */
// TODO(integration): src/loot/affixes.ts の formatAffix(roll) に差し替える
function formatAffixFallback(roll: AffixRoll): string {
  return `${roll.key} ${roll.value}`;
}

/** ステータスの要約行。src/loot/stats.ts の statsSummary が実装されるまでの暫定（空配列） */
// TODO(integration): src/loot/stats.ts の statsSummary(stats): string[] に差し替える
function statsSummaryFallback(_stats: PlayerStats): string[] {
  return [];
}

function findItemById(state: GameState, id: string | null): Item | null {
  if (!id) return null;
  for (const slot of SLOTS) {
    const item = state.profile.equipment[slot];
    if (item && item.id === id) return item;
  }
  return state.profile.stash.find((it) => it.id === id) ?? null;
}

/** ctx.measureText で幅を測り、収まらなければ末尾を "…" で切り詰める */
function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = text.slice(0, mid) + ellipsis;
    if (ctx.measureText(candidate).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? ellipsis : text.slice(0, lo) + ellipsis;
}

export function drawInventoryUi(ctx: CanvasRenderingContext2D, state: GameState, ui: InventoryUi): void {
  if (!ui.open) return;
  const layout = layoutInventory(state, ui);

  ctx.fillStyle = COLOR_OVERLAY;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  drawPanelFrame(ctx, layout, ui);
  drawSlots(ctx, layout, ui);
  drawStash(ctx, layout, ui);
  drawTooltip(ctx, state, layout, ui);
  drawStatsSummary(ctx, state, layout);
  drawHint(ctx, layout);
}

function drawPanelFrame(ctx: CanvasRenderingContext2D, layout: InventoryLayout, ui: InventoryUi): void {
  const { panel } = layout;
  ctx.fillStyle = COLOR_PANEL_BG;
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
  ctx.strokeStyle = COLOR_BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(panel.x + 0.5, panel.y + 0.5, panel.w - 1, panel.h - 1);

  ctx.font = FONT_TITLE;
  ctx.textAlign = "left";
  ctx.fillStyle = COLOR_TEXT;
  ctx.fillText("EQUIPMENT", panel.x + TEXT_PAD_X, panel.y + 8);

  if (ui.messageTimer > 0 && ui.message) {
    ctx.font = FONT_SMALL;
    ctx.textAlign = "right";
    ctx.fillStyle = "#ffd75f";
    ctx.fillText(truncateText(ctx, ui.message, panel.w / 2), panel.x + panel.w - TEXT_PAD_X, panel.y + 8);
  }
}

function strokeRectPx(ctx: CanvasRenderingContext2D, r: Rect, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, r.w - 1, r.h - 1);
}

function drawSlots(ctx: CanvasRenderingContext2D, layout: InventoryLayout, ui: InventoryUi): void {
  for (const s of layout.slots) drawSlotRow(ctx, s, ui);
}

function drawSlotRow(ctx: CanvasRenderingContext2D, s: SlotLayout, ui: InventoryUi): void {
  const { rect } = s;
  if (ui.hoverSlot === s.slot) {
    ctx.fillStyle = COLOR_HOVER_BG;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  strokeRectPx(ctx, rect, COLOR_BORDER);

  ctx.font = FONT_SMALL;
  ctx.textAlign = "left";
  ctx.fillStyle = COLOR_DIM;
  const label = s.slot.toUpperCase();
  ctx.fillText(label, rect.x + TEXT_PAD_X, rect.y + rect.h / 2 + 3);

  const labelWidth = ctx.measureText(label).width;
  const nameMaxWidth = rect.w - labelWidth - TEXT_PAD_X * 3;
  ctx.textAlign = "right";
  if (s.item) {
    ctx.fillStyle = RARITY_COLOR[s.item.rarity];
    ctx.fillText(truncateText(ctx, s.item.name, nameMaxWidth), rect.x + rect.w - TEXT_PAD_X, rect.y + rect.h / 2 + 3);
  } else {
    ctx.fillStyle = COLOR_EMPTY;
    ctx.fillText("- empty -", rect.x + rect.w - TEXT_PAD_X, rect.y + rect.h / 2 + 3);
  }
}

function drawStash(ctx: CanvasRenderingContext2D, layout: InventoryLayout, ui: InventoryUi): void {
  if (layout.stashOrder.length === 0) {
    ctx.font = FONT_SMALL;
    ctx.textAlign = "left";
    ctx.fillStyle = COLOR_DIM;
    ctx.fillText("stash is empty", layout.slots[0]?.rect.x ?? 0, layout.tooltipRect.y - 4);
    return;
  }
  for (const row of layout.stashRows) drawStashRow(ctx, row, ui);
}

function drawStashRow(ctx: CanvasRenderingContext2D, row: StashRowLayout, ui: InventoryUi): void {
  const { rect, item } = row;
  if (ui.hoverItemId === item.id) {
    ctx.fillStyle = COLOR_HOVER_BG;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }

  ctx.font = FONT_SMALL;
  const meta = `${item.slot} L${item.itemLevel}`;
  ctx.textAlign = "right";
  ctx.fillStyle = COLOR_DIM;
  ctx.fillText(meta, rect.x + rect.w - TEXT_PAD_X, rect.y + rect.h / 2 + 3);
  const metaWidth = ctx.measureText(meta).width;

  ctx.textAlign = "left";
  ctx.fillStyle = RARITY_COLOR[item.rarity];
  const nameMaxWidth = rect.w - metaWidth - TEXT_PAD_X * 3;
  ctx.fillText(truncateText(ctx, item.name, nameMaxWidth), rect.x + TEXT_PAD_X, rect.y + rect.h / 2 + 3);
}

function drawTooltip(ctx: CanvasRenderingContext2D, state: GameState, layout: InventoryLayout, ui: InventoryUi): void {
  const { tooltipRect } = layout;
  strokeRectPx(ctx, tooltipRect, COLOR_BORDER);

  const item = findItemById(state, ui.hoverItemId);
  ctx.font = FONT_SMALL;
  ctx.textAlign = "left";
  if (!item) {
    ctx.fillStyle = COLOR_DIM;
    ctx.fillText("Hover an item", tooltipRect.x + TEXT_PAD_X, tooltipRect.y + LINE_H);
    return;
  }

  let y = tooltipRect.y + LINE_H;
  const maxWidth = tooltipRect.w - TEXT_PAD_X * 2;
  const maxY = tooltipRect.y + tooltipRect.h - 2;

  ctx.fillStyle = RARITY_COLOR[item.rarity];
  ctx.fillText(truncateText(ctx, item.name, maxWidth), tooltipRect.x + TEXT_PAD_X, y);
  y += LINE_H;

  if (y <= maxY) {
    ctx.fillStyle = COLOR_DIM;
    ctx.fillText(truncateText(ctx, item.baseKey, maxWidth), tooltipRect.x + TEXT_PAD_X, y);
    y += LINE_H;
  }

  if (item.implicit && y <= maxY) {
    ctx.fillStyle = COLOR_TEXT;
    const text = `Implicit: ${formatAffixFallback(item.implicit)}`;
    ctx.fillText(truncateText(ctx, text, maxWidth), tooltipRect.x + TEXT_PAD_X, y);
    y += LINE_H;
  }

  for (const roll of item.affixes) {
    if (y > maxY) break;
    ctx.fillStyle = COLOR_TEXT;
    const text = `T${roll.tier} ${formatAffixFallback(roll)}`;
    ctx.fillText(truncateText(ctx, text, maxWidth), tooltipRect.x + TEXT_PAD_X, y);
    y += LINE_H;
  }
}

function drawStatsSummary(ctx: CanvasRenderingContext2D, state: GameState, layout: InventoryLayout): void {
  const { statsRect } = layout;
  strokeRectPx(ctx, statsRect, COLOR_BORDER);

  ctx.font = FONT_SMALL;
  ctx.textAlign = "left";
  ctx.fillStyle = COLOR_TEXT;
  const maxWidth = statsRect.w - TEXT_PAD_X * 2;
  const maxY = statsRect.y + statsRect.h - 2;

  const lines = statsSummaryFallback(state.stats);
  let y = statsRect.y + LINE_H;
  if (lines.length === 0) {
    ctx.fillStyle = COLOR_DIM;
    ctx.fillText("stats", statsRect.x + TEXT_PAD_X, y);
    return;
  }
  for (const line of lines) {
    if (y > maxY) break;
    ctx.fillText(truncateText(ctx, line, maxWidth), statsRect.x + TEXT_PAD_X, y);
    y += LINE_H;
  }
}

function drawHint(ctx: CanvasRenderingContext2D, layout: InventoryLayout): void {
  const { hintRect } = layout;
  ctx.font = FONT_SMALL;
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR_DIM;
  const text = "Click: equip/unequip  Shift+Click: salvage  Tab: close";
  ctx.fillText(
    truncateText(ctx, text, hintRect.w - TEXT_PAD_X * 2),
    hintRect.x + hintRect.w / 2,
    hintRect.y + hintRect.h / 2 + 3,
  );
}
