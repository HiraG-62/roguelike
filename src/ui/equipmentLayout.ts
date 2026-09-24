import { SLOTS, type Item, type Slot } from "../loot/types";
import { ALLOC_BUTTON, ALLOC_ORDER } from "./attributeAlloc";
import { CONTENT_BOTTOM, CONTENT_Y, DETAIL_W, DETAIL_X, LIST_W, LIST_X, type Rect, STASH_HEADER_H } from "./inventoryLayout";
import { type SlotFilter, layoutStashToolbar } from "./stashFilter";

/**
 * 装備タブの位置の定義。ui/inventory.ts（入力）・ui/bud.ts（芽のバナー）・render（描画）で共有する。
 * 一覧の上端に「部位の枠」（全部位 + 各部位。装備中の遺物を見せつつ、クリックで一覧をその部位に絞る）、
 * その下に並び・絞り込みの 1 段、芽が出ていればバナー、残りが倉庫の一覧
 */

export const SLOT_TILE_H = 24;
const TILE_GAP = 2;
const ROW_GAP = 2;

export interface SlotTileLayout {
  filter: SlotFilter;
  /** 部位（全部位の枠は null） */
  slot: Slot | null;
  item: Item | null;
  rect: Rect;
}

/** 枠の並び: 全部位 → SLOTS。部位が増えれば枠も増え、幅を等分する */
export const TILE_FILTERS: readonly SlotFilter[] = ["all", ...SLOTS];

export function slotTileRects(): Rect[] {
  const n = TILE_FILTERS.length;
  const w = Math.floor((LIST_W - TILE_GAP * (n - 1)) / n);
  return TILE_FILTERS.map((_, i) => {
    const x = LIST_X + i * (w + TILE_GAP);
    const last = i === n - 1;
    return { x, y: CONTENT_Y, w: last ? LIST_X + LIST_W - x : w, h: SLOT_TILE_H };
  });
}

export const TOOLBAR_Y = CONTENT_Y + SLOT_TILE_H + ROW_GAP;
/** 並び・絞り込みの帯の高さ。部位タブを出さないので倉庫の中身に依らない */
export const TOOLBAR_H = layoutStashToolbar({ x: LIST_X, y: TOOLBAR_Y, w: LIST_W }, [], { slotTabs: false }).h;
const LIST_TOP = TOOLBAR_Y + TOOLBAR_H + ROW_GAP;

/** 芽が出ているときだけ一覧の上に出すバナー */
export function budBannerRect(): Rect {
  return { x: LIST_X, y: LIST_TOP, w: LIST_W, h: STASH_HEADER_H };
}

/** 倉庫の一覧の領域。芽のバナーがあればその下から */
export function stashListArea(hasBud: boolean): Rect {
  const y = hasBud ? LIST_TOP + STASH_HEADER_H + ROW_GAP : LIST_TOP;
  return { x: LIST_X, y, w: LIST_W, h: CONTENT_BOTTOM - y };
}

// ---------------------------------------------------------------------------
// 詳細欄（何も乗せていないときのビルドの要約）
// ---------------------------------------------------------------------------

/** 要約の見出し行（ジョブ・未振り点） */
export const SUMMARY_HEAD_H = 12;
/** 詳細欄のステータスの一覧（行高は振り分けの「+」の当たり判定と同じ ALLOC_BUTTON.rowH。「+」はこの枠の右端） */
export function attributePanelRect(): Rect {
  return { x: DETAIL_X, y: CONTENT_Y + SUMMARY_HEAD_H, w: DETAIL_W, h: ALLOC_ORDER.length * ALLOC_BUTTON.rowH };
}
