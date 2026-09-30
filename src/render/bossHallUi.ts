/**
 * ボスの間の重ね描き（挑戦中の案内と結果のパネル）。state は読まず、ui/bossHall.ts が組んだ文を描くだけ
 */
import { VIEW_H, VIEW_W } from "../core/view";
import { BOSS_HALL } from "../data/tuning";
import { COLOR_BORDER, COLOR_DIM, COLOR_PANEL_BG, COLOR_TEXT, fillRectPx, strokeRectPx } from "./lootUiParts";
import { TEXT, drawText, drawTextShadow, textLineHeight, textWidth } from "./pixelText";

const SHADOW = "#000000";
const PAD = 8;
const LINE_H_MIN = 12;
const PANEL_MIN_W = 160;
/** 挑戦中の案内の上端からの位置 */
const FIGHT_HINT_TOP = 30;
/** 結果と案内の間の空き（行の割合） */
const HINT_GAP = 0.5;

function lineH(m: number): number {
  return Math.max(LINE_H_MIN, textLineHeight(m));
}

/** 挑戦中の案内（画面上の中央に 1 行） */
export function drawHallFightHint(ctx: CanvasRenderingContext2D, text: string): void {
  drawTextShadow(ctx, text, VIEW_W / 2, FIGHT_HINT_TOP, TEXT.SMALL, COLOR_DIM, SHADOW, "center");
}

/** 結果のパネル。lines の 1 行目を見出しの色で、残りを本文の色で、最後に案内を薄く出す */
export function drawHallResult(ctx: CanvasRenderingContext2D, lines: readonly string[], hint: string): void {
  const m = TEXT.BODY;
  const hm = TEXT.SMALL;
  const lh = lineH(m);
  const hlh = lineH(hm);
  const widest = Math.max(PANEL_MIN_W, textWidth(hint, hm), ...lines.map((l) => textWidth(l, m)));
  const w = Math.min(VIEW_W - PAD * 2, widest + PAD * 2);
  const h = PAD * 2 + lh * lines.length + hlh * (1 + HINT_GAP);
  const rect = { x: Math.round((VIEW_W - w) / 2), y: Math.round((VIEW_H - h) / 2), w: Math.round(w), h: Math.round(h) };
  fillRectPx(ctx, rect, COLOR_PANEL_BG);
  strokeRectPx(ctx, rect, COLOR_BORDER);
  const cx = VIEW_W / 2;
  lines.forEach((line, i) => {
    const color = i === 0 ? BOSS_HALL.resultColor : COLOR_TEXT;
    drawText(ctx, line, cx, rect.y + PAD + lh * i, m, color, "center", "top");
  });
  drawText(ctx, hint, cx, rect.y + PAD + lh * lines.length + hlh * HINT_GAP, hm, COLOR_DIM, "center", "top");
}
