import { VIEW_H, VIEW_W } from "../core/view";
import type { Item, Slot } from "../loot/types";

/**
 * 装備画面のタブ間で共有するレイアウト定数と小道具。
 * ui/inventory.ts（タブの切替・装備・スキル）と ui/echoTab.ts（残響）の循環 import を避けるためにここへ切り出す。
 * render 側もこの定数で当たり判定と描画を揃える
 */

/** 部位の表示名。loot/types.ts の Slot は英語のキーのまま */
export const SLOT_LABEL: Readonly<Record<Slot, string>> = {
  mainHand: "右手",
  offHand: "左手",
  armor: "鎧",
  boots: "靴",
  ring: "指輪",
  amulet: "首飾り",
};

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export const PANEL_MARGIN = 8;
export const PANEL_X = PANEL_MARGIN;
export const PANEL_Y = PANEL_MARGIN;
export const PANEL_W = VIEW_W - PANEL_MARGIN * 2;
export const PANEL_H = VIEW_H - PANEL_MARGIN * 2;

export const HEADER_H = 10;
export const HINT_H = 10;
/** 下段（ツールチップの基準位置と共鳴パネル）の高さ */
export const TOOLTIP_H = 50;
export const CONTENT_Y = PANEL_Y + HEADER_H;
export const CONTENT_H = PANEL_H - HEADER_H - TOOLTIP_H - HINT_H;
/** 下段の下端（= ヒント行の上端） */
export const CONTENT_BOTTOM = PANEL_Y + PANEL_H - HINT_H;

export const COLUMN_GAP = 4;
export const LEFT_W = Math.floor(PANEL_W / 3);
export const RIGHT_X = PANEL_X + LEFT_W + COLUMN_GAP;
export const RIGHT_W = PANEL_W - LEFT_W - COLUMN_GAP;

export const STASH_ROW_H = 12;
/** 倉庫一覧の見出し行（装備タブでは芽のバナーを兼ねる） */
export const STASH_HEADER_H = 11;

export interface StashRowLayout {
  item: Item;
  rect: Rect;
  /** 並べ替え後の一覧上のインデックス */
  index: number;
}

export interface StashListLayout {
  rows: StashRowLayout[];
  visibleRowCount: number;
  maxScroll: number;
}

export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** area に収まる行だけを、scroll 位置から並べる */
export function layoutStashList(order: readonly Item[], scroll: number, area: Rect): StashListLayout {
  const visibleRowCount = Math.max(0, Math.floor(area.h / STASH_ROW_H));
  const maxScroll = Math.max(0, order.length - visibleRowCount);
  const start = clamp(scroll, 0, maxScroll);
  const rows: StashRowLayout[] = [];
  for (let row = 0; row < visibleRowCount; row++) {
    const index = row + start;
    const item = order[index];
    if (!item) break;
    rows.push({ item, index, rect: { x: area.x, y: area.y + row * STASH_ROW_H, w: area.w, h: STASH_ROW_H } });
  }
  return { rows, visibleRowCount, maxScroll };
}

export function findRowAt(rows: readonly StashRowLayout[], p: Point | null): StashRowLayout | null {
  if (p === null) return null;
  return rows.find((r) => pointInRect(p, r.rect)) ?? null;
}
