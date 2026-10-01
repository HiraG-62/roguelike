import type { FluxLevel, TraitLine } from "../loot/describe";
import type { Rect } from "../ui/inventoryLayout";
import { TEXT, drawText, textLineHeight, textWidth, truncateText, wrapText } from "./pixelText";

/**
 * 装備画面・芽の知らせで共有する描画部品（色・性質の行・枠）。
 * どれも state を読むだけで、単一の強さの指標は出さない
 */

export const COLOR_TEXT = "#e0e0e0";
export const COLOR_DIM = "#808080";
export const COLOR_BORDER = "#505050";
export const COLOR_PANEL_BG = "rgba(12,12,18,0.94)";
export const COLOR_EMPTY = "#606060";
export const COLOR_WARN = "#ff6060";
export const COLOR_SELECTED = "#ffd75f";
/** 反転した性質（暗い紫） */
export const COLOR_INVERTED = "#8a5cc0";
/** 芽吹いた性質の印 */
export const COLOR_GROWN = "#9dffb0";
export const COLOR_INSCRIPTION = "#f0d8a0";
export const COLOR_BAR_EMPTY = "#303038";

export const GROWN_MARK = "✦";
/** 揺らぎの段階の印（0 = 静は何も出さない、3 = 反転） */
export const FLUX_MARK: Readonly<Record<FluxLevel, string>> = { 0: "", 1: "･", 2: "･･", 3: "･･･" };

export const TEXT_PAD_X = 2;
/** 行高の下限（ドット文字の行高がこれより大きければそちらを使う） */
export const LINE_H = 8;
const MARK_GAP = 2;

export function bodyLineH(): number {
  return Math.max(LINE_H, textLineHeight(TEXT.SMALL));
}

export function strokeRectPx(ctx: CanvasRenderingContext2D, r: Rect, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, r.w - 1, r.h - 1);
}

export function fillRectPx(ctx: CanvasRenderingContext2D, r: Rect, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(r.x, r.y, r.w, r.h);
}

/** 性質の行の文字色。反転は暗い紫 */
export function traitColor(line: TraitLine): string {
  return line.inverted === true ? COLOR_INVERTED : line.color;
}

/** ツールチップの 1 行。mark は左の印（芽）、flux は右端の揺らぎの印 */
export interface TipLine {
  text: string;
  color: string;
  mark?: string;
  markColor?: string;
  flux?: string;
  /** 折り返しの続き（印ぶん字下げする） */
  continued?: boolean;
}

export function traitTipLine(line: TraitLine): TipLine {
  const tip: TipLine = { text: line.text, color: traitColor(line), flux: FLUX_MARK[line.fluxLevel] };
  if (line.grown === true) {
    tip.mark = GROWN_MARK;
    tip.markColor = COLOR_GROWN;
  }
  return tip;
}

function markIndent(m: number): number {
  return textWidth(GROWN_MARK, m) + MARK_GAP;
}

/** 幅に合わせて折り返す。印と揺らぎの印は 1 行目にだけ付ける */
export function wrapTipLines(lines: readonly TipLine[], maxWidth: number, m: number): TipLine[] {
  const out: TipLine[] = [];
  const indent = markIndent(m);
  for (const line of lines) {
    const fluxW = line.flux ? textWidth(line.flux, m) + MARK_GAP : 0;
    const markW = line.mark ? indent : 0;
    const parts = wrapText(line.text, Math.max(1, maxWidth - fluxW - markW), m);
    parts.forEach((text, i) => {
      if (i === 0) out.push({ ...line, text });
      else out.push({ text, color: line.color, continued: line.mark !== undefined });
    });
  }
  return out;
}

/** 1 行を描く（印 → 本文 → 右端に揺らぎの印） */
export function drawTipLine(ctx: CanvasRenderingContext2D, line: TipLine, x: number, y: number, maxWidth: number, m: number): void {
  const indent = markIndent(m);
  let left = x;
  if (line.mark) {
    drawText(ctx, line.mark, x, y, m, line.markColor ?? line.color);
    left += indent;
  } else if (line.continued === true) {
    left += indent;
  }
  let right = x + maxWidth;
  if (line.flux) {
    drawText(ctx, line.flux, right, y, m, line.color, "right");
    right -= textWidth(line.flux, m) + MARK_GAP;
  }
  drawText(ctx, truncateText(line.text, right - left, m), left, y, m, line.color);
}
