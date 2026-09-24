import type { ColorBarSegment } from "../loot/describe";
import type { Rect } from "../ui/inventoryLayout";
import {
  COLOR_BORDER,
  COLOR_DIM,
  LINE_H,
  TEXT_PAD_X,
  type TipLine,
  drawColorBar,
  drawTipLine,
  fillRectPx,
  strokeRectPx,
  wrapTipLines,
} from "./lootUiParts";
import { TEXT, textLineHeight } from "./pixelText";

/**
 * 装備画面の右の固定の詳細欄。浮くツールチップの代わりに、乗せた物の説明を常に同じ場所へ出す。
 * - lines: 要点（いつも出す）
 * - more: 詳しく（来歴・語・噛む など。拾うキーで切り替えたときだけ出す）
 * - actions: 下端にいまできる操作だけを小さく出す
 * 入りきらなければ行間を詰め、それでも溢れた分は切る（最後の行に … を出す）
 */

/** 色の配合の帯を 1 行として挟む（共鳴の配合比など） */
export interface DetailBar {
  bar: readonly ColorBarSegment[];
}

export type DetailLine = TipLine | DetailBar;

export interface DetailContent {
  lines: DetailLine[];
  more?: DetailLine[];
  actions?: string[];
}

function isBar(line: DetailLine): line is DetailBar {
  return "bar" in line;
}

/** 要点と詳しくの区切り（空の行）。wrapTipLines を通さず半行ぶん空ける */
export const DETAIL_GAP_LINE: TipLine = { text: "", color: COLOR_DIM };

const COLOR_DETAIL_BG = "rgba(255,255,255,0.03)";
const COLOR_RULE = "#3a3a44";
const PAD_Y = 3;
const TIGHT_LINE_H = 7;
const OVERFLOW_MARK = "…";
const RULE_GAP = 2;
const BAR_H = 3;
const BAR_ROW_H = 6;

function lineHeights(): { normal: number; tight: number } {
  const h = textLineHeight(TEXT.SMALL);
  return { normal: Math.max(LINE_H + 1, h), tight: Math.max(TIGHT_LINE_H, h) };
}

/** 行の高さ: 空の行は半行、帯は帯の行、それ以外は 1 行 */
function rowHeight(line: DetailLine, lineH: number): number {
  if (isBar(line)) return BAR_ROW_H;
  return line.text === "" ? lineH / 2 : lineH;
}

export function drawDetailPane(ctx: CanvasRenderingContext2D, rect: Rect, content: DetailContent, full: boolean): void {
  fillRectPx(ctx, rect, COLOR_DETAIL_BG);
  strokeRectPx(ctx, rect, COLOR_BORDER);
  const m = TEXT.SMALL;
  const maxWidth = rect.w - TEXT_PAD_X * 2;
  const x = rect.x + TEXT_PAD_X;
  const { normal, tight } = lineHeights();

  const actions = content.actions ?? [];
  const actionsH = actions.length * normal;
  const actionsTop = rect.y + rect.h - PAD_Y - actionsH;
  const body = full && content.more && content.more.length > 0 ? [...content.lines, DETAIL_GAP_LINE, ...content.more] : content.lines;
  const wrapped = body.flatMap((l): DetailLine[] => (isBar(l) || l.text === "" ? [l] : wrapTipLines([l], maxWidth, m)));
  const available = actionsTop - RULE_GAP - (rect.y + PAD_Y);
  const fits = wrapped.reduce((sum, l) => sum + rowHeight(l, normal), 0) <= available;
  const lineH = fits ? normal : tight;

  // y は次の行の上端。文字はその行の下端をベースラインにする
  let y = rect.y + PAD_Y;
  const limit = actionsTop - RULE_GAP;
  for (const [i, line] of wrapped.entries()) {
    const h = rowHeight(line, lineH);
    if (isBar(line)) {
      if (y + h <= limit) drawColorBar(ctx, line.bar, { x, y: y + (h - BAR_H) / 2, w: maxWidth, h: BAR_H });
      y += h;
      continue;
    }
    if (line.text === "") {
      y += h;
      continue;
    }
    const nextOver = y + h + lineH > limit && i < wrapped.length - 1;
    const shown = nextOver ? { ...line, text: `${line.text}${OVERFLOW_MARK}` } : line;
    drawTipLine(ctx, shown, x, y + h, maxWidth, m);
    if (nextOver) break;
    y += h;
  }
  if (actions.length === 0) return;
  fillRectPx(ctx, { x: rect.x + 1, y: actionsTop - RULE_GAP, w: rect.w - 2, h: 1 }, COLOR_RULE);
  actions.forEach((text, i) => {
    drawTipLine(ctx, { text, color: COLOR_DIM }, x, actionsTop + (i + 1) * normal - 1, maxWidth, m);
  });
}
