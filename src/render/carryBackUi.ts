import type { GameState } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import type { Item } from "../loot/types";
import { itemColor } from "../system/loot";
import {
  CARRY_BACK_DONE,
  CARRY_BACK_EQUIPPED,
  CARRY_BACK_FULL,
  CARRY_BACK_LAYOUT,
  CARRY_BACK_TITLE,
  type CarryBackScreen,
  carryBackCount,
  carryBackDetailW,
  carryBackHint,
  carryBackRowTop,
  carryBackSubtitle,
  cursorItem,
  doneIndex,
  isChosen,
} from "../ui/carryBack";
import { SLOT_LABEL } from "../ui/inventoryLayout";
import { itemDetailLines } from "./itemTips";
import { drawTipLine, wrapTipLines } from "./lootUiParts";
import { TEXT, drawText, textLineHeight, truncateText } from "./pixelText";
import { pulse } from "./renderMath";

/**
 * 持ち帰りの画面の描画（状態は ui/carryBack.ts。読むだけ）。左に遺物の一覧と「決める」、右にカーソルの遺物の要点。
 * 遺物の説明は床のツールチップ・書付と同じ行（itemDetailLines）で、ランの state を読む（地金は力尽きた階の値）
 */

const COLOR_BG = "#08080c";
const COLOR_TITLE = "#ffd75f";
const COLOR_TEXT = "#e0e0e0";
const COLOR_DIM = "#707080";
const COLOR_CURSOR_BG = "#2a2a40";
const COLOR_PICKED = "#80ff80";
const COLOR_WARN = "#ff9090";
const COLOR_DETAIL_BG = "#101018";
const COLOR_DONE = "#ffd75f";
const CURSOR_PULSE_SPEED = 4;
const ROW_INSET = 4;
const DETAIL_PAD = 6;
const MARK_ON = "■";
const MARK_OFF = "□";
/** 行の右端に出す部位名の幅 */
const SLOT_COL_W = 44;

export function drawCarryBack(ctx: CanvasRenderingContext2D, ui: Readonly<CarryBackScreen>, run: GameState, time: number, rowGap: number): void {
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const L = CARRY_BACK_LAYOUT;
  drawText(ctx, CARRY_BACK_TITLE, VIEW_W / 2, L.titleY, TEXT.TITLE, COLOR_TITLE, "center");
  drawText(ctx, carryBackSubtitle(ui), L.listX, L.subtitleY, TEXT.SMALL, COLOR_DIM);
  const flashing = ui.fullFlash > 0;
  drawText(ctx, flashing ? CARRY_BACK_FULL : carryBackCount(ui), VIEW_W - L.listX, L.subtitleY, TEXT.SMALL, flashing ? COLOR_WARN : COLOR_PICKED, "right");
  ui.items.forEach((item, i) => drawRow(ctx, ui, item, i, time, rowGap));
  drawDone(ctx, ui, time);
  drawDetail(ctx, ui, run);
  drawText(ctx, carryBackHint(), VIEW_W / 2, L.hintY, TEXT.SMALL, COLOR_DIM, "center");
}

function drawCursorBg(ctx: CanvasRenderingContext2D, x: number, top: number, w: number, h: number, time: number): void {
  ctx.globalAlpha = pulse(time, CURSOR_PULSE_SPEED, 0.6, 1);
  ctx.fillStyle = COLOR_CURSOR_BG;
  ctx.fillRect(x, top, w, h);
  ctx.globalAlpha = 1;
}

/** 行の文字の基準線（矩形の下端から少し上） */
function baseline(top: number, h: number): number {
  const line = textLineHeight(TEXT.SMALL);
  return top + Math.round((h + line) / 2) - 2;
}

/** 1 行: 「■ 名前（装備中）」と右端に部位名 */
function drawRow(ctx: CanvasRenderingContext2D, ui: Readonly<CarryBackScreen>, item: Item, index: number, time: number, rowGap: number): void {
  const top = carryBackRowTop(ui, index, rowGap);
  if (top === null) return;
  const L = CARRY_BACK_LAYOUT;
  if (ui.cursor === index) drawCursorBg(ctx, L.listX, top, L.listW, rowGap, time);
  const y = baseline(top, rowGap);
  const picked = isChosen(ui, item.id);
  const equipped = ui.equippedIds.includes(item.id) ? `（${CARRY_BACK_EQUIPPED}）` : "";
  const nameW = L.listW - ROW_INSET * 2 - SLOT_COL_W;
  const label = truncateText(`${picked ? MARK_ON : MARK_OFF} ${item.name}${equipped}`, nameW, TEXT.SMALL);
  drawText(ctx, label, L.listX + ROW_INSET, y, TEXT.SMALL, picked ? COLOR_PICKED : itemColor(item));
  drawText(ctx, SLOT_LABEL[item.slot], L.listX + L.listW - ROW_INSET, y, TEXT.SMALL, COLOR_DIM, "right");
}

function drawDone(ctx: CanvasRenderingContext2D, ui: Readonly<CarryBackScreen>, time: number): void {
  const L = CARRY_BACK_LAYOUT;
  const on = ui.cursor === doneIndex(ui);
  if (on) drawCursorBg(ctx, L.listX, L.doneY, L.listW, L.doneH, time);
  ctx.strokeStyle = on ? COLOR_DONE : COLOR_DIM;
  ctx.strokeRect(L.listX + 0.5, L.doneY + 0.5, L.listW - 1, L.doneH - 1);
  drawText(ctx, CARRY_BACK_DONE, L.listX + L.listW / 2, baseline(L.doneY, L.doneH), TEXT.SMALL, on ? COLOR_DONE : COLOR_TEXT, "center");
}

/** 右の欄: カーソルの遺物の要点（名前・種類・地金・性質）。欄の下端で打ち切る */
function drawDetail(ctx: CanvasRenderingContext2D, ui: Readonly<CarryBackScreen>, run: GameState): void {
  const L = CARRY_BACK_LAYOUT;
  const w = carryBackDetailW();
  ctx.fillStyle = COLOR_DETAIL_BG;
  ctx.fillRect(L.detailX, L.detailY, w, L.detailBottom - L.detailY);
  const item = cursorItem(ui);
  if (item === null) return;
  const inner = w - DETAIL_PAD * 2;
  const line = textLineHeight(TEXT.SMALL);
  let y = L.detailY + line + DETAIL_PAD / 2;
  for (const tip of wrapTipLines(itemDetailLines(run, item).lines, inner, TEXT.SMALL)) {
    if (y > L.detailBottom - DETAIL_PAD) return;
    drawTipLine(ctx, tip, L.detailX + DETAIL_PAD, y, inner, TEXT.SMALL);
    y += line;
  }
}
