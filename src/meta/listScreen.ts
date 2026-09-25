import type { Vec } from "../core/vec";
import { VIEW_W } from "../core/view";

/**
 * タブ付きの一覧画面（図鑑・依頼の一覧・実績）の状態・入力・レイアウト。DOM 非依存。
 * 描画は src/render/codexUi.ts の drawListScreen。当たり判定と描画は同じ行間（textLineHeight 由来）を渡して同じ矩形を見る
 */

export interface ListEntry {
  key: string;
  /** 未発見・未解除は薄く描く */
  known: boolean;
  name: string;
  /** 右寄せの短い情報 */
  info: string;
  /** 下の説明欄 */
  detail: string;
  /** 印を付ける行（名乗っている称号など） */
  marked?: boolean;
}

export interface ListTab {
  label: string;
  entries: readonly ListEntry[];
  /** 項目が無いときの一文 */
  empty?: string;
}

export interface ListScreen {
  tab: number;
  cursor: number;
  scroll: number;
}

export function createListScreen(tab = 0): ListScreen {
  return { tab, cursor: 0, scroll: 0 };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MARGIN_X = 8;
export const LIST_LAYOUT = {
  titleY: 12,
  tabTop: 22,
  tabH: 14,
  tabGap: 2,
  listTop: 40,
  listBottom: 206,
  listX: MARGIN_X,
  listW: VIEW_W - MARGIN_X * 2,
  detailTop: 210,
  detailLines: 2,
  hintY: 264,
  minRowGap: 12,
} as const;

function pointInRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

export function listRowGap(lineHeight: number): number {
  return Math.max(LIST_LAYOUT.minRowGap, lineHeight);
}

export function listVisibleRows(rowGap: number): number {
  return Math.max(1, Math.floor((LIST_LAYOUT.listBottom - LIST_LAYOUT.listTop) / rowGap));
}

/** タブの矩形（横に等分） */
export function listTabRects(count: number): Rect[] {
  const n = Math.max(1, count);
  const w = (LIST_LAYOUT.listW - LIST_LAYOUT.tabGap * (n - 1)) / n;
  return Array.from({ length: count }, (_, i) => ({
    x: LIST_LAYOUT.listX + i * (w + LIST_LAYOUT.tabGap),
    y: LIST_LAYOUT.tabTop,
    w,
    h: LIST_LAYOUT.tabH,
  }));
}

/** 見えている i 行目（0 始まり）の矩形 */
export function listRowRect(visibleIndex: number, rowGap: number): Rect {
  return { x: LIST_LAYOUT.listX, y: LIST_LAYOUT.listTop + visibleIndex * rowGap, w: LIST_LAYOUT.listW, h: rowGap };
}

export type ListHit = { kind: "tab"; index: number } | { kind: "row"; index: number };

/** 座標が指すタブか行（行は一覧全体の index）。何も無ければ null */
export function listHitAt(x: number, y: number, tabCount: number, entryCount: number, rowGap: number, scroll: number): ListHit | null {
  const tab = listTabRects(tabCount).findIndex((r) => pointInRect(x, y, r));
  if (tab !== -1) return { kind: "tab", index: tab };
  const visible = listVisibleRows(rowGap);
  for (let i = 0; i < visible; i++) {
    const index = scroll + i;
    if (index >= entryCount) break;
    if (pointInRect(x, y, listRowRect(i, rowGap))) return { kind: "row", index };
  }
  return null;
}

/** カーソルが見える位置へスクロールを合わせる */
export function clampListScroll(ui: ListScreen, entryCount: number, rowGap: number): void {
  const visible = listVisibleRows(rowGap);
  const maxScroll = Math.max(0, entryCount - visible);
  if (ui.cursor < ui.scroll) ui.scroll = ui.cursor;
  if (ui.cursor >= ui.scroll + visible) ui.scroll = ui.cursor - visible + 1;
  ui.scroll = Math.max(0, Math.min(maxScroll, ui.scroll));
}

function setTab(ui: ListScreen, tab: number): void {
  ui.tab = tab;
  ui.cursor = 0;
  ui.scroll = 0;
}

export interface ListInput {
  /** ←→（タブ）。-1 / 0 / 1 */
  navX: number;
  /** ↑↓（行）。-1 / 0 / 1 */
  navY: number;
  /** ホイールの符号（行を送る） */
  wheel: number;
  aim: Vec | null;
  /** マウスが動いた（動いたときだけホバーでカーソルを奪う） */
  aimMoved: boolean;
  click: boolean;
  confirm: boolean;
}

/** 1 フレームの結果。activate は決定（Enter / 行のクリック） */
export type ListAction = "none" | "moved" | "tab" | "activate";

function wrap(index: number, delta: number, length: number): number {
  return (((index + delta) % length) + length) % length;
}

/** 一覧のスクロールだけを動かす（カーソルは動かさない）。端で止める */
function scrollListByWheel(ui: ListScreen, entryCount: number, rowGap: number, wheel: number): void {
  if (wheel === 0) return;
  const visible = listVisibleRows(rowGap);
  const maxScroll = Math.max(0, entryCount - visible);
  ui.scroll = Math.max(0, Math.min(maxScroll, ui.scroll + Math.sign(wheel)));
}

/** 入力 1 フレームぶん。タブは端で巡回、行は端で止める。ホイールは表示だけを送り、カーソルは矢印キー/クリック/ホバーでのみ動く */
export function stepListScreen(ui: ListScreen, tabs: readonly ListTab[], input: ListInput, rowGap: number): ListAction {
  if (tabs.length === 0) return "none";
  if (input.navX !== 0) {
    setTab(ui, wrap(ui.tab, input.navX, tabs.length));
    return "tab";
  }
  const count = tabs[ui.tab]?.entries.length ?? 0;
  scrollListByWheel(ui, count, rowGap, input.wheel);
  const hit = input.aim ? listHitAt(input.aim.x, input.aim.y, tabs.length, count, rowGap, ui.scroll) : null;
  if (input.click && hit?.kind === "tab") {
    if (hit.index === ui.tab) return "none";
    setTab(ui, hit.index);
    return "tab";
  }
  if (input.click && hit?.kind === "row") {
    ui.cursor = hit.index;
    return "activate";
  }
  if (input.confirm && count > 0) return "activate";
  if (input.navY !== 0 && count > 0) {
    const next = Math.max(0, Math.min(count - 1, ui.cursor + input.navY));
    const moved = next !== ui.cursor;
    ui.cursor = next;
    clampListScroll(ui, count, rowGap);
    return moved ? "moved" : "none";
  }
  if (input.aimMoved && hit?.kind === "row" && hit.index !== ui.cursor) {
    ui.cursor = hit.index;
    return "moved";
  }
  return "none";
}

/** 選択中の項目 */
export function listCursorEntry(ui: Readonly<ListScreen>, tabs: readonly ListTab[]): ListEntry | undefined {
  return tabs[ui.tab]?.entries[ui.cursor];
}
