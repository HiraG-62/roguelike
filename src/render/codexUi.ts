import { VIEW_H, VIEW_W } from "../core/view";
import { LIST_LAYOUT, type ListScreen, type ListTab, listRowRect, listTabRects, listVisibleRows } from "../meta/listScreen";
import { TEXT, drawText, textLineHeight, truncateText, wrapText } from "./pixelText";

/**
 * タブ付きの一覧画面（図鑑・依頼の一覧・実績・Tips ノート）の描画。状態と当たり判定は src/meta/listScreen.ts。読むだけ
 */

const COLOR_BG = "#08080c";
const COLOR_TITLE = "#ffd75f";
const COLOR_TEXT = "#e0e0e0";
const COLOR_UNKNOWN = "#606070";
const COLOR_INFO = "#a0a0b0";
const COLOR_DIM = "#707080";
const COLOR_TAB_BG = "#141420";
const COLOR_TAB_ACTIVE = "#2a2a40";
const COLOR_TAB_BORDER = "#ffd75f";
const COLOR_CURSOR_BG = "rgba(106,140,255,0.22)";
const COLOR_DETAIL_BG = "#101018";
const COLOR_MARK = "#80ff80";
const MARK = "▶";
const OVERFLOW_MARK = "…";
const ROW_PAD = 6;
/** 一覧の名前の列に使う幅の割合（残りが右寄せの情報） */
const NAME_RATIO = 0.62;
const DETAIL_PAD = 5;
const SCROLL_MARK_INSET = 4;
/** 説明を右に出す形（Tips ノート）: 名前の列の幅の割合と、説明欄との間 */
const SIDE_NAME_RATIO = 0.34;
const SIDE_GAP = 6;

export interface ListScreenView {
  title: string;
  tabs: readonly ListTab[];
  ui: Readonly<ListScreen>;
  rowGap: number;
  hint: string;
  /** 説明を一覧の右に大きく出す（本文が長い Tips ノート）。既定は一覧の下に 2 行 */
  detailSide?: boolean;
}

/** 一覧の名前の列の幅（説明を右に出すときは狭める） */
function rowsWidth(view: ListScreenView): number {
  return view.detailSide === true ? Math.floor(LIST_LAYOUT.listW * SIDE_NAME_RATIO) : LIST_LAYOUT.listW;
}

export function drawListScreen(ctx: CanvasRenderingContext2D, view: ListScreenView): void {
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  drawText(ctx, view.title, VIEW_W / 2, LIST_LAYOUT.titleY, TEXT.TITLE, COLOR_TITLE, "center", "middle");
  drawTabs(ctx, view);
  const tab = view.tabs[view.ui.tab];
  if (tab) {
    drawRows(ctx, view, tab);
    if (view.detailSide === true) drawSideDetail(ctx, view, tab);
    else drawDetail(ctx, tab, view.ui);
  }
  drawText(ctx, truncateText(view.hint, LIST_LAYOUT.listW, TEXT.SMALL), VIEW_W / 2, LIST_LAYOUT.hintY, TEXT.SMALL, COLOR_DIM, "center");
}

function drawTabs(ctx: CanvasRenderingContext2D, view: ListScreenView): void {
  const rects = listTabRects(view.tabs.length);
  view.tabs.forEach((tab, i) => {
    const r = rects[i];
    if (!r) return;
    const active = i === view.ui.tab;
    ctx.fillStyle = active ? COLOR_TAB_ACTIVE : COLOR_TAB_BG;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    if (active) {
      ctx.strokeStyle = COLOR_TAB_BORDER;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    }
    const label = truncateText(tab.label, r.w - 4, TEXT.SMALL);
    drawText(ctx, label, r.x + r.w / 2, r.y + r.h / 2, TEXT.SMALL, active ? COLOR_TITLE : COLOR_INFO, "center", "middle");
  });
}

function drawRows(ctx: CanvasRenderingContext2D, view: ListScreenView, tab: ListTab): void {
  const m = TEXT.SMALL;
  if (tab.entries.length === 0) {
    const lines = wrapText(tab.empty ?? "", LIST_LAYOUT.listW - ROW_PAD * 2, m);
    const line = Math.max(LIST_LAYOUT.minRowGap, textLineHeight(m));
    lines.forEach((t, i) => drawText(ctx, t, VIEW_W / 2, LIST_LAYOUT.listTop + line * (i + 1), m, COLOR_DIM, "center"));
    return;
  }
  const visible = listVisibleRows(view.rowGap);
  const width = rowsWidth(view);
  const nameW = view.detailSide === true ? width : LIST_LAYOUT.listW * NAME_RATIO;
  const infoW = width - nameW - ROW_PAD * 2;
  for (let i = 0; i < visible; i++) {
    const index = view.ui.scroll + i;
    const entry = tab.entries[index];
    if (!entry) break;
    const r = listRowRect(i, view.rowGap);
    const y = r.y + r.h / 2;
    if (index === view.ui.cursor) {
      ctx.fillStyle = COLOR_CURSOR_BG;
      ctx.fillRect(r.x, r.y, width, r.h);
    }
    const prefix = entry.marked ? `${MARK} ` : "";
    const nameColor = entry.marked ? COLOR_MARK : entry.known ? COLOR_TEXT : COLOR_UNKNOWN;
    drawText(ctx, truncateText(`${prefix}${entry.name}`, nameW - ROW_PAD, m), r.x + ROW_PAD, y, m, nameColor, "left", "middle");
    if (entry.info !== "" && infoW > 0) drawText(ctx, truncateText(entry.info, infoW, m), r.x + width - ROW_PAD, y, m, COLOR_INFO, "right", "middle");
  }
  drawScrollMarks(ctx, view, tab.entries.length, visible);
}

/** 上下に隠れた行があることを示す */
function drawScrollMarks(ctx: CanvasRenderingContext2D, view: ListScreenView, count: number, visible: number): void {
  const x = LIST_LAYOUT.listX + rowsWidth(view) + SCROLL_MARK_INSET;
  if (view.ui.scroll > 0) drawText(ctx, "↑", x, LIST_LAYOUT.listTop, TEXT.SMALL, COLOR_DIM, "right", "top");
  if (view.ui.scroll + visible < count) drawText(ctx, "↓", x, LIST_LAYOUT.listBottom, TEXT.SMALL, COLOR_DIM, "right", "bottom");
}

function drawDetail(ctx: CanvasRenderingContext2D, tab: ListTab, ui: Readonly<ListScreen>): void {
  const entry = tab.entries[ui.cursor];
  if (!entry) return;
  const m = TEXT.SMALL;
  const line = Math.max(LIST_LAYOUT.minRowGap - 1, textLineHeight(m));
  const top = LIST_LAYOUT.detailTop;
  const h = line * (LIST_LAYOUT.detailLines + 1) + DETAIL_PAD;
  ctx.fillStyle = COLOR_DETAIL_BG;
  ctx.fillRect(LIST_LAYOUT.listX, top, LIST_LAYOUT.listW, h);
  const x = LIST_LAYOUT.listX + DETAIL_PAD;
  const width = LIST_LAYOUT.listW - DETAIL_PAD * 2;
  drawText(ctx, truncateText(entry.name, width, m), x, top + DETAIL_PAD, m, entry.known ? COLOR_TITLE : COLOR_UNKNOWN, "left", "top");
  wrapText(entry.detail, width, m)
    .slice(0, LIST_LAYOUT.detailLines)
    .forEach((t, i) => drawText(ctx, t, x, top + DETAIL_PAD + line * (i + 1), m, COLOR_TEXT, "left", "top"));
}

/** 一覧の右の説明欄（Tips ノート）。見出しの下に本文を入るだけ折り返す */
function drawSideDetail(ctx: CanvasRenderingContext2D, view: ListScreenView, tab: ListTab): void {
  const entry = tab.entries[view.ui.cursor];
  if (!entry) return;
  const m = TEXT.SMALL;
  const line = Math.max(LIST_LAYOUT.minRowGap - 1, textLineHeight(m));
  const x0 = LIST_LAYOUT.listX + rowsWidth(view) + SIDE_GAP;
  const top = LIST_LAYOUT.listTop;
  const w = LIST_LAYOUT.listX + LIST_LAYOUT.listW - x0;
  const h = LIST_LAYOUT.listBottom - top;
  ctx.fillStyle = COLOR_DETAIL_BG;
  ctx.fillRect(x0, top, w, h);
  const x = x0 + DETAIL_PAD;
  const width = w - DETAIL_PAD * 2;
  drawText(ctx, truncateText(entry.name, width, m), x, top + DETAIL_PAD, m, COLOR_TITLE, "left", "top");
  const capacity = Math.max(1, Math.floor((h - DETAIL_PAD * 2) / line) - 1);
  const lines = wrapText(entry.detail, width, m);
  lines.slice(0, capacity).forEach((t, i) => {
    // 本文が枠に収まりきらないときは最後の行を … で切り、黙って消さない
    const overflow = i === capacity - 1 && lines.length > capacity;
    const shown = overflow ? truncateText(`${t}${OVERFLOW_MARK}`, width, m) : t;
    drawText(ctx, shown, x, top + DETAIL_PAD + line * (i + 1), m, COLOR_TEXT, "left", "top");
  });
}
