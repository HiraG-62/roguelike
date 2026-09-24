import type { Item } from "../loot/types";
import type { StashRowLayout } from "../ui/inventoryLayout";
import {
  type SlotCounts,
  type StashControl,
  type StashControlLayout,
  type StashView,
  controlValueColor,
  isControlActive,
  isFiltering,
  sameControl,
  stashControlLabel,
  startsSlotGroup,
} from "../ui/stashFilter";
import { COLOR_BORDER, COLOR_DIM, COLOR_HOVER_BG, COLOR_SELECTED, COLOR_TEXT, fillRectPx, strokeRectPx } from "./lootUiParts";
import { TEXT, drawText, truncateText } from "./pixelText";

/**
 * 倉庫の上のボタンの帯（部位タブ・並び・絞り込み。中身は ui/stashFacets.ts の表）と、全部位表示のときの部位の区切り線。
 * 装備タブと残響タブで共有する。state は読むだけ
 */

const COLOR_ACTIVE_BG = "rgba(255,215,95,0.16)";
const COLOR_GROUP_LINE = "rgba(255,255,255,0.22)";
const LABEL_PAD_X = 2;
const LABEL_BASELINE_INSET = 2;

/** 絞り込み中の値に固有の色（色・揺らぎなど）があればその色で文字を塗って、何で絞っているかを見せる */
function labelColor(view: StashView, control: StashControl, active: boolean): string {
  return controlValueColor(view, control) ?? (active ? COLOR_TEXT : COLOR_DIM);
}

export function drawStashToolbar(
  ctx: CanvasRenderingContext2D,
  controls: readonly StashControlLayout[],
  view: StashView,
  counts: Readonly<SlotCounts>,
): void {
  const m = TEXT.SMALL;
  for (const { control, rect } of controls) {
    const active = isControlActive(view, control);
    if (active) fillRectPx(ctx, rect, COLOR_ACTIVE_BG);
    if (sameControl(view.hover, control)) fillRectPx(ctx, rect, COLOR_HOVER_BG);
    strokeRectPx(ctx, rect, active ? COLOR_SELECTED : COLOR_BORDER);
    const label = truncateText(stashControlLabel(view, control, counts), rect.w - LABEL_PAD_X * 2, m);
    const baseline = rect.y + rect.h - LABEL_BASELINE_INSET;
    drawText(ctx, label, rect.x + rect.w / 2, baseline, m, labelColor(view, control, active), "center");
  }
}

/** 倉庫の見出しの件数。絞っていれば「表示 / 総数」 */
export function stashCountText(shown: number, total: number, view: StashView): string {
  const narrowed = view.slot !== "all" || isFiltering(view);
  return narrowed ? `倉庫 ${shown}/${total}` : `倉庫 ${total}`;
}

/** 空のときの文言。倉庫が空なのか条件に合うものが無いのかを分ける */
export function stashEmptyText(total: number): string {
  return total === 0 ? "倉庫は空です" : "条件に合う遺物はありません";
}

/** 空の文言を置く y（ボタン列の下から 1 行） */
export function stashEmptyY(controls: readonly StashControlLayout[], lineH: number): number {
  const bottom = controls.reduce((max, c) => Math.max(max, c.rect.y + c.rect.h), 0);
  return bottom + lineH;
}

/** 全部位表示のとき、部位が変わる行の上に区切り線を引く */
export function drawSlotGroupLines(
  ctx: CanvasRenderingContext2D,
  rows: readonly StashRowLayout[],
  order: readonly Item[],
  view: StashView,
): void {
  if (view.slot !== "all") return;
  for (const row of rows) {
    if (!startsSlotGroup(order, row.index)) continue;
    fillRectPx(ctx, { x: row.rect.x, y: row.rect.y, w: row.rect.w, h: 1 }, COLOR_GROUP_LINE);
  }
}
