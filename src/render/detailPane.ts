import type { ColorBarSegment } from "../loot/describe";
import { ATTR_COLOR } from "../loot/affixes";
import { baseDef } from "../loot/bases";
import { ultimateChoice } from "../loot/profile";
import { type Item, type Profile, TRAIT_COLOR_HEX } from "../loot/types";
import type { DetailPage, Rect } from "../ui/inventoryLayout";
import { type FormulaChunk, type FormulaPiece, chunkText } from "../ui/scalingText";
import {
  COLOR_BORDER,
  COLOR_DIM,
  LINE_H,
  TEXT_PAD_X,
  type TipLine,
  COLOR_TEXT,
  drawColorBar,
  drawTipLine,
  fillRectPx,
  strokeRectPx,
  wrapTipLines,
} from "./lootUiParts";
import { TEXT, drawText, textLineHeight, textWidth, truncateText } from "./pixelText";

/**
 * 装備画面の右の固定の詳細欄。浮くツールチップの代わりに、乗せた物の説明を常に同じ場所へ出す。
 * 頁は欄の下端の頁送り（render/inventoryUi.ts の drawDetailPager）か拾うキーで回す。
 * - lines: 要点（いつも出す）
 * - more: 詳しく（来歴・語・噛む など。2 頁目）
 * - formulas: 計算式（行動ごとの係数。3 頁目。無ければ詳しくと同じ）
 * - actions: 下端にいまできる操作だけを小さく出す
 * 入りきらなければ行間を詰め、それでも溢れた分は切る（最後の行に … を出す）
 */

/** 色の配合の帯を 1 行として挟む（共鳴の配合比など） */
export interface DetailBar {
  bar: readonly ColorBarSegment[];
}

/** 色分けした片の行（計算式）。片の境目でだけ折り返し、続きの行は字下げする */
export interface DetailChunks {
  chunks: readonly FormulaChunk[];
}

export type DetailLine = TipLine | DetailBar | DetailChunks;


export interface DetailContent {
  lines: DetailLine[];
  more?: DetailLine[];
  formulas?: DetailLine[];
  actions?: string[];
}

function isBar(line: DetailLine | WrappedLine): line is DetailBar {
  return "bar" in line;
}

function isChunks(line: DetailLine): line is DetailChunks {
  return "chunks" in line;
}

/** 片の行を折り返した 1 行ぶん。dx は行の左端からの位置 */
interface ChunkRow {
  segments: { text: string; color: string; dx: number }[];
}

type WrappedLine = TipLine | DetailBar | ChunkRow;

function isChunkRow(line: WrappedLine): line is ChunkRow {
  return "segments" in line;
}

/** 右手の武器の要点に出す、その武器種で選んでいる奥義（選ぶのは装備画面のステータスタブ） */
const ULTIMATE_LINE_HEAD = "奥義: ";

/** 武器種を持つ武器なら「奥義: 円月」の行。武器でなければ null */
export function ultimateTipLine(profile: Readonly<Pick<Profile, "ultimates">>, item: Readonly<Item>): TipLine | null {
  const moveset = baseDef(item.baseKey)?.moveset;
  if (moveset === undefined) return null;
  return { text: `${ULTIMATE_LINE_HEAD}${ultimateChoice(profile, moveset).name}`, color: COLOR_DIM };
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
/** 計算式の続きの行の字下げ */
const CHUNK_INDENT = 6;
const CHUNK_SPACE = " ";
const COLOR_ACTION_NAME = "#e8d8a8";

function pieceColor(p: Readonly<FormulaPiece>): string {
  if (p.attr !== undefined) return TRAIT_COLOR_HEX[ATTR_COLOR[p.attr]];
  if (p.tone === "name") return COLOR_ACTION_NAME;
  if (p.tone === "dim") return COLOR_DIM;
  return COLOR_TEXT;
}

/**
 * 片の列を幅で折り返す。片の中では折り返さない（「筋力×1.3」を割らない）。
 * 1 片が幅を超えるときだけ、描画で末尾を … にする
 */
export function wrapChunks(chunks: readonly FormulaChunk[], maxWidth: number, m: number): ChunkRow[] {
  const rows: ChunkRow[] = [];
  let row: ChunkRow = { segments: [] };
  let x = 0;
  const space = textWidth(CHUNK_SPACE, m);
  for (const chunk of chunks) {
    const gap = row.segments.length === 0 || chunk.glue === true ? 0 : space;
    const w = textWidth(chunkText(chunk), m);
    if (row.segments.length > 0 && x + gap + w > maxWidth) {
      rows.push(row);
      row = { segments: [] };
      x = CHUNK_INDENT;
    }
    let dx = x + (row.segments.length === 0 ? 0 : gap);
    for (const p of chunk.pieces) {
      row.segments.push({ text: p.text, color: pieceColor(p), dx });
      dx += textWidth(p.text, m);
    }
    x = dx;
  }
  if (row.segments.length > 0) rows.push(row);
  return rows;
}

function drawChunkRow(ctx: CanvasRenderingContext2D, row: ChunkRow, x: number, y: number, maxWidth: number, m: number): void {
  for (const seg of row.segments) {
    const room = maxWidth - seg.dx;
    if (room <= 0) return;
    drawText(ctx, truncateText(seg.text, room, m), x + seg.dx, y, m, seg.color);
  }
}

function lineHeights(): { normal: number; tight: number } {
  const h = textLineHeight(TEXT.SMALL);
  return { normal: Math.max(LINE_H + 1, h), tight: Math.max(TIGHT_LINE_H, h) };
}

/** 行の高さ: 空の行は半行、帯は帯の行、それ以外は 1 行 */
function rowHeight(line: WrappedLine, lineH: number): number {
  if (isBar(line)) return BAR_ROW_H;
  if (isChunkRow(line)) return lineH;
  return line.text === "" ? lineH / 2 : lineH;
}

/** 頁ごとの本文。計算式の頁は計算式が無ければ詳しくと同じにする */
function pageBody(content: DetailContent, page: DetailPage): DetailLine[] {
  const formulas = content.formulas ?? [];
  if (page === "formula" && formulas.length > 0) return formulas;
  const more = content.more ?? [];
  if (page !== "brief" && more.length > 0) return [...content.lines, DETAIL_GAP_LINE, ...more];
  return content.lines;
}

function wrapLines(body: readonly DetailLine[], maxWidth: number, m: number): WrappedLine[] {
  return body.flatMap((l): WrappedLine[] => {
    if (isBar(l)) return [l];
    if (isChunks(l)) return wrapChunks(l.chunks, maxWidth, m);
    return l.text === "" ? [l] : wrapTipLines([l], maxWidth, m);
  });
}

/** 本文の行数と、詰めた行高で欄に収まるか（テスト用。描画と同じ計算） */
export function detailPaneFits(rect: Rect, content: DetailContent, page: DetailPage): { rows: number; fits: boolean } {
  const m = TEXT.SMALL;
  const { normal, tight } = lineHeights();
  const wrapped = wrapLines(pageBody(content, page), rect.w - TEXT_PAD_X * 2, m);
  const actionsTop = rect.y + rect.h - PAD_Y - (content.actions ?? []).length * normal;
  const available = actionsTop - RULE_GAP - (rect.y + PAD_Y);
  const used = wrapped.reduce((sum, l) => sum + rowHeight(l, tight), 0);
  return { rows: wrapped.length, fits: used <= available };
}

export function drawDetailPane(ctx: CanvasRenderingContext2D, rect: Rect, content: DetailContent, page: DetailPage): void {
  fillRectPx(ctx, rect, COLOR_DETAIL_BG);
  strokeRectPx(ctx, rect, COLOR_BORDER);
  const m = TEXT.SMALL;
  const maxWidth = rect.w - TEXT_PAD_X * 2;
  const x = rect.x + TEXT_PAD_X;
  const { normal, tight } = lineHeights();

  const actions = content.actions ?? [];
  const actionsH = actions.length * normal;
  const actionsTop = rect.y + rect.h - PAD_Y - actionsH;
  const wrapped = wrapLines(pageBody(content, page), maxWidth, m);
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
    const nextOver = y + h + lineH > limit && i < wrapped.length - 1;
    if (isChunkRow(line)) {
      drawChunkRow(ctx, line, x, y + h, maxWidth, m);
      if (nextOver) {
        drawText(ctx, OVERFLOW_MARK, x + maxWidth, y + h, m, COLOR_DIM, "right");
        break;
      }
      y += h;
      continue;
    }
    if (line.text === "") {
      y += h;
      continue;
    }
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
