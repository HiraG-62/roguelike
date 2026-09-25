/**
 * 武器掛けの画面の描画（カードの格子・選んだ武器種の説明・資源の調整欄）。状態と当たり判定は src/ui/rackScreen.ts。読むだけ。
 * 訓練場は単一指標を出さない方針なので、資源は割合のゲージだけを出す（docs/DESIGN_PRINCIPLES.md）
 */
import { VIEW_H, VIEW_W } from "../core/view";
import { WEAPON_FRAME, weaponSpriteKey } from "../data/sprites/weapons";
import type { MovesetKey } from "../data/weapons";
import type { HubResource } from "../system/hub";
import {
  RACK_ADJUST_ROWS,
  RACK_LAYOUT,
  type RackAdjustRow,
  type RackCard,
  type RackUi,
  type Rect,
  rackAdjustButtonRect,
  rackAdjustGaugeRect,
  rackAdjustRowRect,
  rackCardDetail,
  rackCardRect,
  rackCursorAdjust,
  rackCursorCard,
  rackVisibleRows,
} from "../ui/rackScreen";
import { COLOR_BAR_EMPTY, COLOR_BORDER, COLOR_DIM, COLOR_SELECTED, COLOR_TEXT, fillRectPx, strokeRectPx } from "./lootUiParts";
import { TEXT, drawText, textLineHeight, truncateText, wrapText } from "./pixelText";
import type { Sprite } from "./sprites";

export type RackSpriteLookup = (key: string) => Sprite | undefined;

export interface RackScreenView {
  title: string;
  hint: string;
  ui: Readonly<RackUi>;
  cards: readonly RackCard[];
  /** 資源の今の割合（0..1） */
  resources: Readonly<Record<HubResource, number>>;
  /** 「装備のまま」のカードに出す、装備中の右手の武器種。無ければ絵を出さない */
  equipped: MovesetKey | null;
  /** 借りる長押しの進み（0..1）。カーソルのカードに出す */
  borrowHold: number;
  lookup: RackSpriteLookup;
}

const COLOR_BG = "#08080c";
const COLOR_CARD_BG = "#141420";
const COLOR_CURSOR_BG = "rgba(106,140,255,0.22)";
const COLOR_MARK = "#80ff80";
const COLOR_DETAIL_BG = "#101018";
const COLOR_HOLD = "#ffd75f";
const COLOR_SCROLL = "#a0a0b0";
const COLOR_SHADOW = "#000000";
const RESOURCE_COLOR: Readonly<Record<HubResource, string>> = { hp: "#e04848", mana: "#4a8cff", energy: "#ffd75f" };
const ADJUST_LABEL: Readonly<Record<RackAdjustRow, string>> = { hp: "生命", mana: "気力", energy: "奥義ゲージ", fill: "全快" };
const ADJUST_TITLE = "試し打ちの資源";
const MARKED_TEXT = "試用中";
const MINUS = "−";
const PLUS = "＋";
const SCROLL_UP = "▲";
const SCROLL_DOWN = "▼";
const ICON_SCALE = 2;
const ICON_TOP = 4;
const CARD_TEXT_PAD = 2;
const MARK_SIZE = 4;
const HOLD_H = 2;
const PAD = 4;
const LINE_MIN = 10;
const PERCENT = 100;

function lineH(m: number): number {
  return Math.max(LINE_MIN, textLineHeight(m));
}

export function drawRackScreen(ctx: CanvasRenderingContext2D, view: RackScreenView): void {
  fillRectPx(ctx, { x: 0, y: 0, w: VIEW_W, h: VIEW_H }, COLOR_BG);
  drawText(ctx, view.title, VIEW_W / 2, RACK_LAYOUT.titleY, TEXT.TITLE, COLOR_SELECTED, "center", "middle");
  drawCards(ctx, view);
  drawScrollMarks(ctx, view);
  drawDetail(ctx, view);
  drawAdjust(ctx, view);
  drawText(ctx, truncateText(view.hint, VIEW_W - PAD * 2, TEXT.SMALL), VIEW_W / 2, RACK_LAYOUT.hintY, TEXT.SMALL, COLOR_DIM, "center");
}

function drawCards(ctx: CanvasRenderingContext2D, view: RackScreenView): void {
  view.cards.forEach((card, i) => {
    const r = rackCardRect(i, view.ui.scroll);
    if (r === null) return;
    drawCard(ctx, view, card, r, i === view.ui.cursor);
  });
}

function drawCard(ctx: CanvasRenderingContext2D, view: RackScreenView, card: RackCard, r: Rect, cursor: boolean): void {
  fillRectPx(ctx, r, COLOR_CARD_BG);
  if (cursor) fillRectPx(ctx, r, COLOR_CURSOR_BG);
  strokeRectPx(ctx, r, cursor ? COLOR_SELECTED : card.marked ? COLOR_MARK : COLOR_BORDER);
  // 試用中の印は左上の小さな四角（名前の幅を削らない）
  if (card.marked) fillRectPx(ctx, { x: r.x + 2, y: r.y + 2, w: MARK_SIZE, h: MARK_SIZE }, COLOR_MARK);
  drawCardIcon(ctx, view, card, r);
  const m = TEXT.SMALL;
  const name = truncateText(card.name, r.w - CARD_TEXT_PAD * 2, m);
  drawText(ctx, name, r.x + r.w / 2, r.y + r.h - CARD_TEXT_PAD - HOLD_H, m, card.marked ? COLOR_MARK : COLOR_TEXT, "center", "bottom");
  if (cursor && view.borrowHold > 0 && card.moveset !== null) {
    const w = Math.round((r.w - 2) * Math.min(1, view.borrowHold));
    fillRectPx(ctx, { x: r.x + 1, y: r.y + r.h - 1 - HOLD_H, w, h: HOLD_H }, COLOR_HOLD);
  }
}

/** 武器種の手持ちの絵を 2 倍で出す（斜めの向きが一番形が読める） */
function drawCardIcon(ctx: CanvasRenderingContext2D, view: RackScreenView, card: RackCard, r: Rect): void {
  const moveset = card.moveset ?? view.equipped;
  if (moveset === null) return;
  const sprite = view.lookup(weaponSpriteKey(moveset));
  const img = sprite?.frames[WEAPON_FRAME.diagonal] ?? sprite?.frames[0];
  if (!img) return;
  const w = img.width * ICON_SCALE;
  const h = img.height * ICON_SCALE;
  const prevAlpha = ctx.globalAlpha;
  // 「装備のまま」は装備中の武器の絵を薄く出して、武器種のカードと見分ける
  if (card.moveset === null) ctx.globalAlpha = 0.5;
  ctx.drawImage(img, Math.round(r.x + (r.w - w) / 2), r.y + ICON_TOP, w, h);
  ctx.globalAlpha = prevAlpha;
}

/** 隠れている段があるときだけ、格子の右上・右下に ▲▼ を出す */
function drawScrollMarks(ctx: CanvasRenderingContext2D, view: RackScreenView): void {
  const rows = Math.ceil(view.cards.length / RACK_LAYOUT.cols);
  const x = RACK_LAYOUT.panelX - RACK_LAYOUT.cardGap;
  const m = TEXT.SMALL;
  if (view.ui.scroll > 0) drawText(ctx, SCROLL_UP, x, RACK_LAYOUT.gridTop, m, COLOR_SCROLL, "right", "top");
  if (view.ui.scroll + rackVisibleRows() < rows) drawText(ctx, SCROLL_DOWN, x, RACK_LAYOUT.gridBottom, m, COLOR_SCROLL, "right", "bottom");
}

/** 右の欄の上半分: カーソルのカードの名前と説明。調整欄にいるときは最後に選んだカード */
function drawDetail(ctx: CanvasRenderingContext2D, view: RackScreenView): void {
  const top = RACK_LAYOUT.panelTop;
  const bottom = RACK_LAYOUT.adjustTop - PAD;
  const rect = { x: RACK_LAYOUT.panelX, y: top, w: RACK_LAYOUT.panelW, h: bottom - top };
  fillRectPx(ctx, rect, COLOR_DETAIL_BG);
  strokeRectPx(ctx, rect, COLOR_BORDER);
  const card = rackCursorCard(view.ui, view.cards) ?? view.cards[view.ui.lastCard];
  if (!card) return;
  const x = rect.x + PAD;
  const w = rect.w - PAD * 2;
  const mb = TEXT.BODY;
  let y = rect.y + PAD;
  drawText(ctx, truncateText(card.name, w, mb), x, y, mb, COLOR_SELECTED, "left", "top");
  if (card.marked) drawText(ctx, MARKED_TEXT, rect.x + rect.w - PAD, y, TEXT.SMALL, COLOR_MARK, "right", "top");
  y += lineH(mb) + 2;
  const m = TEXT.SMALL;
  const step = lineH(m);
  for (const line of wrapText(rackCardDetail(card), w, m)) {
    if (y + step > bottom - PAD) break;
    drawText(ctx, line, x, y, m, COLOR_TEXT, "left", "top");
    y += step;
  }
}

/** 右の欄の下: 生命・気力・奥義ゲージの −/＋ とゲージ、全快 */
function drawAdjust(ctx: CanvasRenderingContext2D, view: RackScreenView): void {
  const m = TEXT.SMALL;
  const cursorRow = rackCursorAdjust(view.ui, view.cards.length);
  drawText(ctx, ADJUST_TITLE, RACK_LAYOUT.panelX, RACK_LAYOUT.adjustTop - 1, m, COLOR_DIM, "left", "bottom");
  RACK_ADJUST_ROWS.forEach((row, i) => {
    const r = rackAdjustRowRect(i);
    const cursor = row === cursorRow;
    if (cursor) fillRectPx(ctx, r, COLOR_CURSOR_BG);
    if (row === "fill") {
      strokeRectPx(ctx, r, cursor ? COLOR_SELECTED : COLOR_BORDER);
      drawText(ctx, ADJUST_LABEL.fill, r.x + r.w / 2, r.y + r.h / 2, m, cursor ? COLOR_SELECTED : COLOR_TEXT, "center", "middle");
      return;
    }
    drawResourceRow(ctx, row, i, view.resources[row], cursor);
  });
}

function drawResourceRow(ctx: CanvasRenderingContext2D, kind: HubResource, row: number, ratio: number, cursor: boolean): void {
  const m = TEXT.SMALL;
  const r = rackAdjustRowRect(row);
  const labelW = RACK_LAYOUT.adjustLabelW - 2;
  drawText(ctx, truncateText(ADJUST_LABEL[kind], labelW, m), r.x + 2, r.y + r.h / 2, m, cursor ? COLOR_SELECTED : COLOR_TEXT, "left", "middle");
  drawButton(ctx, rackAdjustButtonRect(row, -1), MINUS, cursor);
  drawButton(ctx, rackAdjustButtonRect(row, 1), PLUS, cursor);
  const g = rackAdjustGaugeRect(row);
  fillRectPx(ctx, g, COLOR_BAR_EMPTY);
  fillRectPx(ctx, { ...g, w: Math.round(g.w * Math.min(1, Math.max(0, ratio))) }, RESOURCE_COLOR[kind]);
  const pct = `${Math.round(ratio * PERCENT)}%`;
  // ゲージの色の上でも読めるよう影を付ける
  const cy = g.y + g.h / 2;
  drawText(ctx, pct, g.x + g.w / 2 + 1, cy + 1, m, COLOR_SHADOW, "center", "middle");
  drawText(ctx, pct, g.x + g.w / 2, cy, m, COLOR_TEXT, "center", "middle");
}

function drawButton(ctx: CanvasRenderingContext2D, r: Rect, label: string, cursor: boolean): void {
  strokeRectPx(ctx, r, cursor ? COLOR_SELECTED : COLOR_BORDER);
  drawText(ctx, label, r.x + r.w / 2, r.y + r.h / 2, TEXT.SMALL, COLOR_TEXT, "center", "middle");
}
