import type { GameState } from "../core/state";
import { VIEW_W } from "../core/view";
import { ATTR_GAIN } from "../data/tuning";
import { ATTR_LABEL, COLOR_ATTR } from "../loot/resonance";
import { ATTR_KEYS, SLOTS, TRAIT_COLORS, TRAIT_COLOR_HEX, type AttrKey, type TraitColor } from "../loot/types";
import { ALLOC_CARD, ALLOC_ORDER, allocCardRect, allocPanelVisible } from "../ui/attributeAlloc";
import { SLOT_GAP, SLOT_H } from "../ui/inventory";
import { CONTENT_H, CONTENT_Y, LEFT_W, PANEL_X, type Rect } from "../ui/inventoryLayout";
import { TEXT, drawText, textLineHeight, textWidth, truncateText } from "./pixelText";

/**
 * ステータスの描画。探索中の振り分けパネル（5 枠）と、装備画面の「生値と実効値」の一覧。
 * 当たり判定は ui/attributeAlloc.ts の allocCardRect と共有する
 */

/** 何が伸びるかの一言（docs/COMBAT_DESIGN.md A-1 の要約。単一の強さの指標は出さない） */
export const ATTR_HINT: Readonly<Record<AttrKey, string>> = {
  str: "近接・怯み",
  dex: "射撃・移動",
  vit: "最大HP・耐性",
  mnd: "マナ・会心",
  spi: "スキル・状態異常",
};

/** 枠のキー表示（スキル 1〜4 + 攻撃）。クリックでも選べる */
const KEY_HINTS: readonly string[] = ["1", "2", "3", "4", "E"];

const COLOR_BG = "rgba(8,8,16,0.8)";
const COLOR_CARD = "rgba(16,16,28,0.95)";
const COLOR_CARD_HOVER = "rgba(32,32,52,0.98)";
const COLOR_TEXT = "#e0e0e0";
const COLOR_SUB = "#a0a0a0";
const COLOR_TITLE = "#ffd75f";
const COLOR_WAIT = "#606060";

const PANEL_PAD = 4;
const TITLE_GAP = 3;
const LINE_H = 9;
const CARD_TOP_PAD = 2;
const HALF = 2;

/** ステータスの色（共鳴の色の対応を逆引き） */
function attrColor(key: AttrKey): string {
  const color = TRAIT_COLORS.find((c: TraitColor) => COLOR_ATTR[c] === key);
  return color === undefined ? COLOR_TEXT : TRAIT_COLOR_HEX[color];
}

function lineH(): number {
  return Math.max(LINE_H, textLineHeight(TEXT.SMALL));
}

// ---------------------------------------------------------------------------
// 振り分けパネル（探索中）
// ---------------------------------------------------------------------------

export function drawAttributeAlloc(ctx: CanvasRenderingContext2D, state: GameState): void {
  if (!allocPanelVisible(state)) return;
  const run = state.runAttributes;
  const first = allocCardRect(0);
  const last = allocCardRect(ALLOC_ORDER.length - 1);
  const lh = lineH();
  const titleY = first.y - TITLE_GAP - ALLOC_CARD.hoverLift;
  const top = titleY - lh;
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(first.x - PANEL_PAD, top - PANEL_PAD, last.x + last.w - first.x + PANEL_PAD * HALF, first.y + first.h - top + PANEL_PAD * HALF);

  const ready = run.timer >= ATTR_GAIN.allocInputDelay;
  const title = `ステータスを振る（残り ${run.unspent}）`;
  drawText(ctx, title, VIEW_W / 2, titleY, TEXT.SMALL, ready ? COLOR_TITLE : COLOR_WAIT, "center");
  ALLOC_ORDER.forEach((key, i) => drawAllocCard(ctx, state, key, i, i === run.hover));
}

function drawAllocCard(ctx: CanvasRenderingContext2D, state: GameState, key: AttrKey, index: number, hover: boolean): void {
  const r = allocCardRect(index);
  const y = hover ? r.y - ALLOC_CARD.hoverLift : r.y;
  const color = attrColor(key);
  const cx = r.x + r.w / HALF;
  const lh = lineH();
  ctx.fillStyle = hover ? COLOR_CARD_HOVER : COLOR_CARD;
  ctx.fillRect(r.x, y, r.w, r.h);
  ctx.strokeStyle = color;
  ctx.lineWidth = hover ? HALF : 1;
  ctx.strokeRect(r.x + 0.5, y + 0.5, r.w - 1, r.h - 1);
  ctx.lineWidth = 1;

  const raw = state.stats.attributes[key];
  const maxW = r.w - PANEL_PAD * HALF;
  const m = TEXT.SMALL;
  drawText(ctx, `${KEY_HINTS[index] ?? ""} ${ATTR_LABEL[key]}`, cx, y + CARD_TOP_PAD + lh, m, color, "center");
  drawText(ctx, `${raw} → ${raw + 1}`, cx, y + CARD_TOP_PAD + lh * 2, m, COLOR_TEXT, "center");
  drawText(ctx, truncateText(ATTR_HINT[key], maxW, m), cx, y + CARD_TOP_PAD + lh * 3, m, COLOR_SUB, "center");
}

// ---------------------------------------------------------------------------
// 装備画面の一覧（スロットの下）
// ---------------------------------------------------------------------------

/** 装備タブの左列、スロットの下からツールチップの上までの空き */
export function attributePanelRect(): Rect {
  const y = CONTENT_Y + SLOTS.length * (SLOT_H + SLOT_GAP);
  const bottom = CONTENT_Y + CONTENT_H - SLOT_GAP;
  return { x: PANEL_X, y, w: LEFT_W, h: Math.max(0, bottom - y) };
}

/** 「筋力 26（実効 23）」。逓減が掛かっていなければ生値だけ */
export function attributeValueText(key: AttrKey, raw: number, eff: number): string {
  const label = ATTR_LABEL[key];
  if (Math.abs(raw - eff) < ROUND_EPS) return `${label} ${raw}`;
  return `${label} ${raw}（実効 ${formatEff(eff)}）`;
}

const ROUND_EPS = 1e-6;
const EFF_DIGITS = 2;

function formatEff(eff: number): string {
  // 逓減の傾き 0.5 / 0.25 で端数が出る。不要な 0 は落とす
  return String(Number(eff.toFixed(EFF_DIGITS)));
}

export function drawAttributePanel(ctx: CanvasRenderingContext2D, state: GameState, rect: Rect = attributePanelRect()): void {
  const m = TEXT.SMALL;
  const lh = lineH();
  const x = rect.x + PANEL_PAD;
  const right = rect.x + rect.w - PANEL_PAD;
  const bottom = rect.y + rect.h;
  let y = rect.y + lh;
  for (const key of ATTR_KEYS) {
    if (y > bottom) break;
    const text = attributeValueText(key, state.stats.attributes[key], state.stats.attributesEff[key]);
    const valueW = Math.min(textWidth(text, m), right - x);
    drawText(ctx, truncateText(text, right - x, m), x, y, m, attrColor(key));
    const hintW = right - x - valueW - PANEL_PAD;
    if (hintW > 0) drawText(ctx, truncateText(ATTR_HINT[key], hintW, m), right, y, m, COLOR_SUB, "right");
    y += lh;
  }
}
