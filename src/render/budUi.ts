import { keyLabel } from "../core/input";
import type { GameState } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import { describeTrait } from "../loot/describe";
import { TRAIT_COLOR_LABEL, type AffixRoll, type PendingBud } from "../loot/types";
import type { Rect } from "../ui/inventoryLayout";
import {
  COLOR_GROWN,
  COLOR_TEXT,
  FLUX_MARK,
  GROWN_MARK,
  bodyLineH,
  fillRectPx,
  strokeRectPx,
  traitColor,
} from "./lootUiParts";
import { TEXT, drawText, textWidth, truncateText, wrapText } from "./pixelText";

/**
 * 芽（2 択の成長）の描画。
 * - 戦闘中: 芽が出た直後だけ画面右下に小さなカード 2 枚（ゲームは止めない）、その後は「✦ 芽」の点滅アイコンだけ
 * 装備画面では候補の頁の先頭の芽吹きの札で選ぶ（ui/candidates.ts）
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
const COLOR_CARD = "rgba(16,16,28,0.95)";
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
  const head = `芽が出た（${pending.milestoneLabel}）　${keyLabel("inventory", { first: true })}: 選ぶ`;
  drawText(ctx, truncateText(head, totalW, m), VIEW_W - HUD_RIGHT, top - MINI_HEAD_GAP, m, COLOR_GROWN, "right");
  pending.options.forEach((roll, i) => {
    const r = { x: left + i * (MINI_CARD_W + MINI_CARD_GAP), y: top, w: MINI_CARD_W, h: MINI_CARD_H };
    drawTraitCard(ctx, r, roll, i);
  });
}

/** 候補 1 つのカード。見出しは番号と色、本文は describeTrait の文言と揺らぎの印 */
function drawTraitCard(ctx: CanvasRenderingContext2D, r: Rect, roll: AffixRoll, index: number): void {
  const line = describeTrait(roll);
  const color = traitColor(line);
  fillRectPx(ctx, r, COLOR_CARD);
  strokeRectPx(ctx, r, color);
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
