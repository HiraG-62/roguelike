import type { GameState } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import { describeTrait } from "../loot/describe";
import { TRAIT_COLOR_LABEL, type AffixRoll, type PendingBud } from "../loot/types";
import { type BudUi, layoutBudModal } from "../ui/bud";
import type { Rect } from "../ui/inventoryLayout";
import {
  COLOR_DIM,
  COLOR_GROWN,
  COLOR_PANEL_BG,
  COLOR_TEXT,
  FLUX_MARK,
  GROWN_MARK,
  TEXT_PAD_X,
  bodyLineH,
  fillRectPx,
  strokeRectPx,
  traitColor,
} from "./lootUiParts";
import { TEXT, drawText, textWidth, truncateText, wrapText } from "./pixelText";

/**
 * 芽（2 択の成長）の描画。
 * - 戦闘中: 芽が出た直後だけ画面右下に小さなカード 2 枚（ゲームは止めない）、その後は「✦ 芽」の点滅アイコンだけ
 * - 装備画面: 2 択のモーダル（当たり判定は ui/bud.ts の layoutBudModal と共有）
 */

/** 芽が出てからカードを出しておく秒数（以降はアイコンだけ） */
const BUD_PREVIEW_SECONDS = 5;
const BLINK_TICKS = 40;

const HUD_RIGHT = 4;
/** 祝福アイコン列（render/boonUi.ts）の高さ + 下余白。その上に並べる */
const BOON_ROW_H = 14;
const ICON_H = 11;
const ICON_PAD = 3;
const ICON_GAP = 3;
const ICON_BASELINE = 8;
const MINI_CARD_W = 100;
const MINI_CARD_H = 28;
const MINI_CARD_GAP = 4;
const MINI_HEAD_GAP = 2;
const CARD_PAD = 4;
const MODAL_TITLE_Y = 11;
const MODAL_SUB_Y = 21;
const MODAL_HINT_FROM_BOTTOM = 6;
const COLOR_OVERLAY = "rgba(0,0,0,0.6)";
const COLOR_CARD = "rgba(16,16,28,0.95)";
const COLOR_CARD_HOVER = "rgba(32,40,32,0.98)";
const COLOR_ICON_BG = "rgba(12,12,18,0.85)";
const COLOR_ICON_OFF = "#3f7050";

/** 同じ芽を見始めた時刻（見た目だけの記憶。state には書かない） */
let seenKey: string | null = null;
let seenAt = 0;

function previewVisible(state: GameState, pending: PendingBud): boolean {
  const key = `${pending.itemId}:${pending.milestone}`;
  // 新しいラン（time が巻き戻る）では出し直す
  if (key !== seenKey || state.time < seenAt) {
    seenKey = key;
    seenAt = state.time;
  }
  return state.time - seenAt < BUD_PREVIEW_SECONDS;
}

/** 戦闘中の芽の知らせ。main.ts が描画の最後に呼ぶ */
export function drawBudUi(ctx: CanvasRenderingContext2D, state: GameState): void {
  const pending = state.pendingBud;
  if (pending === null || state.paused || state.status !== "playing" || state.boonChoice !== null) return;
  const icon = drawBudIcon(ctx, state);
  if (!previewVisible(state, pending)) return;
  drawMiniCards(ctx, pending, icon.y - ICON_GAP);
}

function drawBudIcon(ctx: CanvasRenderingContext2D, state: GameState): Rect {
  const m = TEXT.SMALL;
  const label = `${GROWN_MARK} 芽`;
  const w = Math.ceil(textWidth(label, m)) + ICON_PAD * 2;
  const r = { x: VIEW_W - HUD_RIGHT - w, y: VIEW_H - BOON_ROW_H - ICON_GAP - ICON_H, w, h: ICON_H };
  const on = state.tick % BLINK_TICKS < BLINK_TICKS / 2;
  const color = on ? COLOR_GROWN : COLOR_ICON_OFF;
  fillRectPx(ctx, r, COLOR_ICON_BG);
  strokeRectPx(ctx, r, color);
  drawText(ctx, label, r.x + r.w / 2, r.y + ICON_BASELINE, m, color, "center");
  return r;
}

function drawMiniCards(ctx: CanvasRenderingContext2D, pending: PendingBud, bottom: number): void {
  const top = bottom - MINI_CARD_H;
  const totalW = MINI_CARD_W * pending.options.length + MINI_CARD_GAP * (pending.options.length - 1);
  const left = VIEW_W - HUD_RIGHT - totalW;
  const m = TEXT.SMALL;
  const head = `芽が出た（${pending.milestoneLabel}）Tab で選ぶ`;
  drawText(ctx, truncateText(head, totalW, m), VIEW_W - HUD_RIGHT, top - MINI_HEAD_GAP, m, COLOR_GROWN, "right");
  pending.options.forEach((roll, i) => {
    const r = { x: left + i * (MINI_CARD_W + MINI_CARD_GAP), y: top, w: MINI_CARD_W, h: MINI_CARD_H };
    drawTraitCard(ctx, r, roll, i, false);
  });
}

/** 候補 1 つのカード。見出しは番号と色、本文は describeTrait の文言と揺らぎの印 */
function drawTraitCard(ctx: CanvasRenderingContext2D, r: Rect, roll: AffixRoll, index: number, hover: boolean): void {
  const line = describeTrait(roll);
  const color = traitColor(line);
  fillRectPx(ctx, r, hover ? COLOR_CARD_HOVER : COLOR_CARD);
  strokeRectPx(ctx, r, color);
  if (hover) strokeRectPx(ctx, { x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 }, color);
  const m = TEXT.SMALL;
  const lineH = bodyLineH();
  const x = r.x + CARD_PAD;
  const maxWidth = r.w - CARD_PAD * 2;
  const hue = line.hue === undefined ? "" : `${TRAIT_COLOR_LABEL[line.hue]}の芽`;
  drawText(ctx, `${index + 1}. ${hue}`, x, r.y + lineH, m, color);
  const flux = FLUX_MARK[line.fluxLevel];
  if (flux) drawText(ctx, flux, r.x + r.w - CARD_PAD, r.y + lineH, m, color, "right");
  const capacity = Math.max(1, Math.floor((r.h - CARD_PAD) / lineH) - 1);
  const rows = wrapText(line.text, maxWidth, m).slice(0, capacity);
  rows.forEach((text, i) => drawText(ctx, truncateText(text, maxWidth, m), x, r.y + lineH * (i + 2), m, COLOR_TEXT));
}

/** 装備画面の 2 択モーダル */
export function drawBudModal(ctx: CanvasRenderingContext2D, state: GameState, bud: BudUi): void {
  const pending = state.pendingBud;
  if (!bud.open || pending === null) return;
  const { frame, cards } = layoutBudModal();
  fillRectPx(ctx, { x: 0, y: 0, w: VIEW_W, h: VIEW_H }, COLOR_OVERLAY);
  fillRectPx(ctx, frame, COLOR_PANEL_BG);
  strokeRectPx(ctx, frame, COLOR_GROWN);
  const m = TEXT.SMALL;
  const cx = frame.x + frame.w / 2;
  const maxWidth = frame.w - TEXT_PAD_X * 2;
  const itemName = state.profile.equipment[pending.slot]?.name ?? "";
  drawText(ctx, truncateText(`${GROWN_MARK} 芽吹き: ${itemName}`, maxWidth, m), cx, frame.y + MODAL_TITLE_Y, TEXT.BODY, COLOR_GROWN, "center");
  const sub = `${pending.milestoneLabel}で芽が出た。選ばなかった方は二度と出ない`;
  drawText(ctx, truncateText(sub, maxWidth, m), cx, frame.y + MODAL_SUB_Y, m, COLOR_DIM, "center");
  pending.options.forEach((roll, i) => {
    const r = cards[i];
    if (r) drawTraitCard(ctx, r, roll, i, bud.hover === i);
  });
  const hint = "クリック or 1 / 2 で選ぶ　枠の外をクリックで閉じる";
  drawText(ctx, truncateText(hint, maxWidth, m), cx, frame.y + frame.h - MODAL_HINT_FROM_BOTTOM, m, COLOR_DIM, "center");
}
