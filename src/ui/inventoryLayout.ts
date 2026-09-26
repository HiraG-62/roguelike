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
  head: "頭",
  armor: "体",
  boots: "足",
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

/** 見出し（タブ・メッセージ・？ボタン）の高さ */
export const HEADER_H = 13;
/** 枠の内側の余白 */
export const FRAME_PAD = 3;
/** 本文の上端・下端。画面下の操作説明の行は持たない（操作は詳細欄の下と ？ のヘルプに出す） */
export const CONTENT_Y = PANEL_Y + HEADER_H + 2;
export const CONTENT_BOTTOM = PANEL_Y + PANEL_H - FRAME_PAD;
export const CONTENT_H = CONTENT_BOTTOM - CONTENT_Y;

export const COLUMN_GAP = 4;

/**
 * 装備・スキルタブの骨組み: 左に一覧、右に固定の詳細欄。
 * 詳細欄はマウスを乗せた物の説明を出し、何も乗せていなければ今のビルドの要約を出す（浮くツールチップは使わない）
 */
export const DETAIL_W = 164;
export const DETAIL_X = PANEL_X + PANEL_W - FRAME_PAD - DETAIL_W;
export const LIST_X = PANEL_X + FRAME_PAD;
export const LIST_W = DETAIL_X - COLUMN_GAP - LIST_X;

/** 本文の右端（詳細欄の右端と同じ） */
export const CONTENT_RIGHT = DETAIL_X + DETAIL_W;

/** 詳細欄の頁。要点 → 詳しく → 計算式 の順に、下端の頁送りか拾うキーで回す（render/detailPane.ts） */
export type DetailPage = "brief" | "full" | "formula";
export const DETAIL_PAGES: readonly DetailPage[] = ["brief", "full", "formula"];

export function detailRect(): Rect {
  return { x: DETAIL_X, y: CONTENT_Y, w: DETAIL_W, h: CONTENT_H };
}

/**
 * 詳細欄の下端の頁送り（「< 要点 1/3 >」）。拾うキーだけでは頁があることに気付けないので、見える場所に置いてクリックでも送る
 */
export const DETAIL_PAGER_H = 12;
const PAGER_BUTTON_W = 18;
const PAGER_GAP = 1;

export interface DetailPagerLayout {
  bar: Rect;
  prev: Rect;
  next: Rect;
}

export function detailPagerRects(): DetailPagerLayout {
  const d = detailRect();
  const bar: Rect = { x: d.x, y: d.y + d.h - DETAIL_PAGER_H, w: d.w, h: DETAIL_PAGER_H };
  return {
    bar,
    prev: { x: bar.x, y: bar.y, w: PAGER_BUTTON_W, h: bar.h },
    next: { x: bar.x + bar.w - PAGER_BUTTON_W, y: bar.y, w: PAGER_BUTTON_W, h: bar.h },
  };
}

/** 詳細欄の本文（頁送りの上まで） */
export function detailBodyRect(): Rect {
  const d = detailRect();
  return { ...d, h: d.h - DETAIL_PAGER_H - PAGER_GAP };
}

/** 残響タブの左右の列（左: 残響と操作、右: 倉庫と対象） */
export const LEFT_W = Math.floor(PANEL_W / 3);
export const RIGHT_X = PANEL_X + LEFT_W + COLUMN_GAP;
export const RIGHT_W = PANEL_X + PANEL_W - FRAME_PAD - RIGHT_X;

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
