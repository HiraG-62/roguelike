import { VIEW_H, VIEW_W } from "../core/view";
import { JOBS } from "../data/jobs";
import { ORIGINS, RUN_MODS, RUN_MOD_KEYS } from "../system/runSetup";
import {
  JOB_ROWS,
  LOCKED_ORIGIN_NAME,
  ORIGIN_LAYOUT,
  ORIGIN_ROWS,
  type OriginScreen,
  START_LABEL,
  cursorDescription,
  jobCursorDetail,
  originRowTop,
  originTier,
} from "../ui/origin";
import { TEXT, drawText, textLineHeight, wrapText } from "./pixelText";
import { pulse } from "./renderMath";

/** 起点画面の描画（状態は ui/origin.ts。読むだけ）。ジョブの段 → 起点の段 */

const COLOR_BG = "#08080c";
const COLOR_TITLE = "#ffd75f";
const COLOR_HEADER = "#a0a0b0";
const COLOR_TEXT = "#e0e0e0";
const COLOR_DIM = "#707080";
const COLOR_CURSOR_BG = "#2a2a40";
const COLOR_SELECTED = "#80ff80";
const COLOR_MOD_ON = "#ff9060";
const COLOR_START = "#ffd75f";
const COLOR_DESC_BG = "#101018";
const COLOR_WEAK = "#ff9090";
const CURSOR_PULSE_SPEED = 4;
const ROW_TEXT_INSET = 6;
const DESC_PAD = 6;
const DESC_LINES = 2;
const MARK_ON = "■";
const MARK_OFF = "□";
const MARK_PICK = "▶";
const WEAK_PREFIX = "弱点";

export function drawOriginScreen(ctx: CanvasRenderingContext2D, ui: Readonly<OriginScreen>, time: number, rowGap: number): void {
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  if (ui.stage === "job") {
    drawJobStage(ctx, ui, time, rowGap);
    return;
  }
  drawText(ctx, "起点を選ぶ", VIEW_W / 2, ORIGIN_LAYOUT.titleY, TEXT.TITLE, COLOR_TITLE, "center");
  drawText(ctx, `ジョブ: ${JOBS[ui.job].name}`, VIEW_W - ORIGIN_LAYOUT.leftX, ORIGIN_LAYOUT.titleY, TEXT.SMALL, COLOR_SELECTED, "right");
  drawText(ctx, "起点", ORIGIN_LAYOUT.leftX, ORIGIN_LAYOUT.headerY, TEXT.SMALL, COLOR_HEADER);
  drawText(ctx, `縛り（位階 ${originTier(ui)}）`, ORIGIN_LAYOUT.rightX, ORIGIN_LAYOUT.headerY, TEXT.SMALL, COLOR_HEADER);
  drawOriginColumn(ctx, ui, time, rowGap);
  drawModifierColumn(ctx, ui, time, rowGap);
  drawDescription(ctx, ui);
  drawText(ctx, "↑↓ 選ぶ　←→ 列　Enter 決定　Esc ジョブへ戻る", VIEW_W / 2, ORIGIN_LAYOUT.hintY, TEXT.SMALL, COLOR_DIM, "center");
}

function drawCursorBg(ctx: CanvasRenderingContext2D, x: number, top: number, width: number, rowGap: number, time: number): void {
  ctx.globalAlpha = pulse(time, CURSOR_PULSE_SPEED, 0.6, 1);
  ctx.fillStyle = COLOR_CURSOR_BG;
  ctx.fillRect(x, top, width, rowGap);
  ctx.globalAlpha = 1;
}

/** 行の文字の基準線（矩形の下端から少し上） */
function baseline(top: number, rowGap: number): number {
  const line = textLineHeight(TEXT.SMALL);
  return top + Math.round((rowGap + line) / 2) - 2;
}

// ---------------------------------------------------------------------------
// ジョブの段
// ---------------------------------------------------------------------------

function drawJobStage(ctx: CanvasRenderingContext2D, ui: Readonly<OriginScreen>, time: number, rowGap: number): void {
  drawText(ctx, "ジョブを選ぶ", VIEW_W / 2, ORIGIN_LAYOUT.titleY, TEXT.TITLE, COLOR_TITLE, "center");
  drawText(ctx, "ジョブ", ORIGIN_LAYOUT.leftX, ORIGIN_LAYOUT.headerY, TEXT.SMALL, COLOR_HEADER);
  drawJobColumn(ctx, ui, time, rowGap);
  drawJobDetail(ctx, ui);
  drawText(ctx, "↑↓ 選ぶ　Enter 決定して起点へ　Esc 戻る", VIEW_W / 2, ORIGIN_LAYOUT.hintY, TEXT.SMALL, COLOR_DIM, "center");
}

function drawJobColumn(ctx: CanvasRenderingContext2D, ui: Readonly<OriginScreen>, time: number, rowGap: number): void {
  JOB_ROWS.forEach((job, i) => {
    const top = originRowTop(i, rowGap);
    if (ui.jobCursor === i) drawCursorBg(ctx, ORIGIN_LAYOUT.leftX, top, ORIGIN_LAYOUT.jobColW, rowGap, time);
    const y = baseline(top, rowGap);
    const x = ORIGIN_LAYOUT.leftX + ROW_TEXT_INSET;
    if (ui.lockedJobs.has(job)) {
      drawText(ctx, `　 ${LOCKED_ORIGIN_NAME}`, x, y, TEXT.SMALL, COLOR_DIM);
      return;
    }
    const picked = ui.job === job;
    drawText(ctx, `${picked ? MARK_PICK : "　"} ${JOBS[job].name}`, x, y, TEXT.SMALL, picked ? COLOR_SELECTED : COLOR_TEXT);
  });
}

/** 右の詳細欄: 名前・概要・ステータス・得意な武器・ルール 2 つ・初期スキル石・弱点。欄の下端で打ち切る */
function drawJobDetail(ctx: CanvasRenderingContext2D, ui: Readonly<OriginScreen>): void {
  const { name, desc } = cursorDescription(ui);
  const line = textLineHeight(TEXT.SMALL);
  const x = ORIGIN_LAYOUT.jobDetailX;
  const width = VIEW_W - ORIGIN_LAYOUT.leftX - x;
  const top = ORIGIN_LAYOUT.listY;
  ctx.fillStyle = COLOR_DESC_BG;
  ctx.fillRect(x, top, width, ORIGIN_LAYOUT.jobDetailBottom - top);
  const inner = width - DESC_PAD * 2;
  let y = top + line;
  drawText(ctx, name, x + DESC_PAD, y, TEXT.SMALL, COLOR_TITLE);
  const rows: { text: string; color: string }[] = [];
  for (const t of wrapText(desc, inner, TEXT.SMALL)) rows.push({ text: t, color: COLOR_TEXT });
  for (const detail of jobCursorDetail(ui)) {
    const color = detail.startsWith(WEAK_PREFIX) ? COLOR_WEAK : COLOR_HEADER;
    for (const t of wrapText(detail, inner, TEXT.SMALL)) rows.push({ text: t, color });
  }
  for (const r of rows) {
    y += line;
    if (y > ORIGIN_LAYOUT.jobDetailBottom - DESC_PAD) return;
    drawText(ctx, r.text, x + DESC_PAD, y, TEXT.SMALL, r.color);
  }
}

// ---------------------------------------------------------------------------
// 起点の段
// ---------------------------------------------------------------------------

function drawOriginColumn(ctx: CanvasRenderingContext2D, ui: Readonly<OriginScreen>, time: number, rowGap: number): void {
  ORIGIN_ROWS.forEach((row, i) => {
    const top = originRowTop(i, rowGap);
    if (ui.column === "origin" && ui.originCursor === i) drawCursorBg(ctx, ORIGIN_LAYOUT.leftX, top, ORIGIN_LAYOUT.colW, rowGap, time);
    const y = baseline(top, rowGap);
    const x = ORIGIN_LAYOUT.leftX + ROW_TEXT_INSET;
    if (row === "start") {
      drawText(ctx, START_LABEL, x, y, TEXT.SMALL, COLOR_START);
      return;
    }
    if (ui.locked.has(row)) {
      drawText(ctx, `　 ${LOCKED_ORIGIN_NAME}`, x, y, TEXT.SMALL, COLOR_DIM);
      return;
    }
    const picked = ui.origin === row;
    drawText(ctx, `${picked ? MARK_PICK : "　"} ${ORIGINS[row].name}`, x, y, TEXT.SMALL, picked ? COLOR_SELECTED : COLOR_TEXT);
  });
}

function drawModifierColumn(ctx: CanvasRenderingContext2D, ui: Readonly<OriginScreen>, time: number, rowGap: number): void {
  RUN_MOD_KEYS.forEach((key, i) => {
    const top = originRowTop(i, rowGap);
    if (ui.column === "modifier" && ui.modCursor === i) drawCursorBg(ctx, ORIGIN_LAYOUT.rightX, top, ORIGIN_LAYOUT.colW, rowGap, time);
    const on = ui.modifiers.includes(key);
    const def = RUN_MODS[key];
    const y = baseline(top, rowGap);
    drawText(ctx, `${on ? MARK_ON : MARK_OFF} ${def.name}`, ORIGIN_LAYOUT.rightX + ROW_TEXT_INSET, y, TEXT.SMALL, on ? COLOR_MOD_ON : COLOR_TEXT);
    drawText(ctx, `${def.points}`, ORIGIN_LAYOUT.rightX + ORIGIN_LAYOUT.colW - ROW_TEXT_INSET, y, TEXT.SMALL, COLOR_DIM, "right");
  });
}

function drawDescription(ctx: CanvasRenderingContext2D, ui: Readonly<OriginScreen>): void {
  const { name, desc } = cursorDescription(ui);
  const line = textLineHeight(TEXT.SMALL);
  const width = VIEW_W - ORIGIN_LAYOUT.leftX * 2;
  ctx.fillStyle = COLOR_DESC_BG;
  ctx.fillRect(ORIGIN_LAYOUT.leftX, ORIGIN_LAYOUT.descY - line, width, line * (DESC_LINES + 1) + DESC_PAD);
  drawText(ctx, name, ORIGIN_LAYOUT.leftX + DESC_PAD, ORIGIN_LAYOUT.descY, TEXT.SMALL, COLOR_TITLE);
  wrapText(desc, width - DESC_PAD * 2, TEXT.SMALL)
    .slice(0, DESC_LINES)
    .forEach((text, i) => drawText(ctx, text, ORIGIN_LAYOUT.leftX + DESC_PAD, ORIGIN_LAYOUT.descY + line * (i + 1), TEXT.SMALL, COLOR_TEXT));
}
