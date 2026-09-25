import type { GameState } from "../core/state";
import { MOVESETS } from "../data/weapons";
import { ultimateChoice } from "../loot/profile";
import type { EffectRow } from "../ui/effectsList";
import type { Rect } from "../ui/inventoryLayout";
import {
  type StatusCardLayout,
  type StatusTabLayout,
  type StatusTabUi,
  ULTIMATE_KIND_LABEL,
  canChooseUltimate,
  derivedStatRows,
  effectsMaxScroll,
  effectsPanelRect,
  effectsRowRect,
  effectsVisibleRows,
  layoutStatusTab,
  statusTabEffectRows,
  ultimateCostOf,
} from "../ui/statusTab";
import { attrColor, drawAttributePanel, drawSummaryHead } from "./attributeUi";
import { COLOR_BORDER, COLOR_DIM, COLOR_HOVER_BG, COLOR_SELECTED, COLOR_TEXT, TEXT_PAD_X, fillRectPx, strokeRectPx } from "./lootUiParts";
import { TEXT, drawText, textLineHeight, textWidth, truncateText, wrapText } from "./pixelText";

/**
 * 装備画面のステータスタブの描画（state と ui を読むだけ）。
 * 左: ジョブ・ステータス（「+」）・体の性能。右: 今の武器種の奥義 3 枚（選んでいる奥義に印）。
 * 単一の強さの指標は出さない。当たり判定は ui/statusTab.ts の layoutStatusTab と共有する
 */

const COLOR_SECTION = "#a0a0a0";
const COLOR_RULE = "#303038";
const COLOR_CARD_CHOSEN_BG = "rgba(255,215,95,0.10)";
const COLOR_LOCKED = "#6a6a70";
const CHOSEN_MARK = "● ";
const ARROW_PREV = "<";
const ARROW_NEXT = ">";
const EQUIPPED_NOTE = "（装備中）";
const COST_LABEL = "奥義ゲージ";
const SECTION_DERIVED = "体の性能";
const HALF = 2;
/** 行の中央に文字を置くベースライン（行の上端から行高の半分 + これ） */
const ROW_BASELINE_OFFSET = 3;
/** カードの 1 行目（名前）のベースライン（カードの上端から） */
const CARD_TITLE_BASELINE = 11;
const CARD_BODY_GAP = 3;
const MIN_LINE_H = 9;
const OVERFLOW_MARK = "…";

export function drawStatusTab(ctx: CanvasRenderingContext2D, state: GameState, ui: StatusTabUi): void {
  const layout = layoutStatusTab(state, ui);
  drawSummaryHead(ctx, state, layout.head);
  if (ui.effectsPage) {
    drawEffectsPage(ctx, state, ui);
    return;
  }
  drawAttributePanel(ctx, state, ui.hoverAlloc, layout.attrPanel);
  drawDerived(ctx, state, layout);
  const sep = layout.right.x - 2;
  fillRectPx(ctx, { x: sep, y: layout.right.y, w: 1, h: layout.right.h }, COLOR_RULE);
  drawUltimateHead(ctx, state, ui, layout);
  const chosen = ultimateChoice(state.profile, layout.moveset).key;
  for (const card of layout.cards) drawCard(ctx, card, { state, ui, chosen: card.def.key === chosen });
}

// ---------------------------------------------------------------------------
// 効果の頁（状態異常・祝福・芯・一時強化）
// ---------------------------------------------------------------------------

const EFFECTS_EMPTY_HUB = "拠点では意味を持たない（探索中に見られる）";
const EFFECTS_EMPTY_RUN = "今は何も掛かっていない";
const EFFECTS_ROW_PAD = 3;
const EFFECTS_NAME_RATIO = 0.6;

function drawEffectsEmpty(ctx: CanvasRenderingContext2D, state: GameState, rect: Rect): void {
  const m = TEXT.SMALL;
  const text = state.sandbox === true ? EFFECTS_EMPTY_HUB : EFFECTS_EMPTY_RUN;
  drawText(ctx, truncateText(text, rect.w - EFFECTS_ROW_PAD * 2, m), rect.x + rect.w / 2, rect.y + EFFECTS_ROW_PAD, m, COLOR_DIM, "center", "top");
}

function drawEffectRow(ctx: CanvasRenderingContext2D, row: EffectRow, r: Rect): void {
  const m = TEXT.SMALL;
  const line = Math.max(9, textLineHeight(m));
  const nameW = Math.floor(r.w * EFFECTS_NAME_RATIO);
  const infoW = r.w - nameW - EFFECTS_ROW_PAD * 2;
  const y0 = r.y + EFFECTS_ROW_PAD;
  drawText(ctx, truncateText(row.name, nameW - EFFECTS_ROW_PAD, m), r.x + EFFECTS_ROW_PAD, y0, m, COLOR_TEXT, "left", "top");
  if (row.info) drawText(ctx, truncateText(row.info, infoW, m), r.x + r.w - EFFECTS_ROW_PAD, y0, m, COLOR_SELECTED, "right", "top");
  if (!row.detail) return;
  const detailW = r.w - EFFECTS_ROW_PAD * 2;
  const lines = wrapText(row.detail, detailW, m);
  const first = lines[0];
  if (!first) return;
  const overflow = lines.length > 1 ? "…" : "";
  drawText(ctx, truncateText(`${first}${overflow}`, detailW, m), r.x + EFFECTS_ROW_PAD, y0 + line, m, COLOR_DIM, "left", "top");
}

/** 効果の頁: かかっている状態異常・持っている祝福（名前/格/効果）・芯・一時強化を一覧する。多ければホイール/↑↓ で送る */
function drawEffectsPage(ctx: CanvasRenderingContext2D, state: GameState, ui: StatusTabUi): void {
  const rect = effectsPanelRect();
  const rows = statusTabEffectRows(state);
  if (rows.length === 0) {
    drawEffectsEmpty(ctx, state, rect);
    return;
  }
  const visible = effectsVisibleRows(rect);
  const maxScroll = effectsMaxScroll(rows.length, rect);
  const scroll = Math.min(ui.effectsScroll, maxScroll);
  for (let i = 0; i < visible; i++) {
    const row = rows[scroll + i];
    if (!row) break;
    drawEffectRow(ctx, row, effectsRowRect(rect, i));
  }
  const m = TEXT.SMALL;
  if (scroll > 0) drawText(ctx, "↑", rect.x + rect.w, rect.y, m, COLOR_DIM, "right", "top");
  if (scroll + visible < rows.length) drawText(ctx, "↓", rect.x + rect.w, rect.y + rect.h, m, COLOR_DIM, "right", "bottom");
}

function rowBaseline(r: Rect): number {
  return r.y + r.h / HALF + ROW_BASELINE_OFFSET;
}

function drawDerived(ctx: CanvasRenderingContext2D, state: GameState, layout: StatusTabLayout): void {
  const m = TEXT.SMALL;
  const head = layout.derivedHead;
  drawText(ctx, SECTION_DERIVED, head.x + TEXT_PAD_X, rowBaseline(head), m, COLOR_SECTION);
  fillRectPx(ctx, { x: head.x, y: head.y + head.h - 1, w: head.w, h: 1 }, COLOR_RULE);
  const rows = derivedStatRows(state.stats);
  layout.derivedRows.forEach((r, i) => {
    const row = rows[i];
    if (!row) return;
    const right = r.x + r.w - TEXT_PAD_X * HALF;
    const baseline = rowBaseline(r);
    drawText(ctx, row.value, right, baseline, m, COLOR_TEXT, "right");
    const room = right - (r.x + TEXT_PAD_X) - textWidth(row.value, m) - TEXT_PAD_X * HALF;
    drawText(ctx, truncateText(row.label, room, m), r.x + TEXT_PAD_X, baseline, m, row.attr === null ? COLOR_DIM : attrColor(row.attr));
  });
}

function drawUltimateHead(ctx: CanvasRenderingContext2D, state: GameState, ui: StatusTabUi, layout: StatusTabLayout): void {
  const m = TEXT.SMALL;
  const head = layout.ultHead;
  const note = layout.moveset === state.stats.moveset ? EQUIPPED_NOTE : "";
  const text = `奥義: ${MOVESETS[layout.moveset].name}${note}`;
  const inset = layout.prev ? layout.prev.w + TEXT_PAD_X : 0;
  drawText(ctx, truncateText(text, head.w - inset * HALF, m), head.x + head.w / HALF, rowBaseline(head), m, COLOR_TEXT, "center");
  fillRectPx(ctx, { x: head.x, y: head.y + head.h - 1, w: head.w, h: 1 }, COLOR_RULE);
  if (layout.prev) drawArrow(ctx, layout.prev, ARROW_PREV, ui.hoverArrow === -1);
  if (layout.next) drawArrow(ctx, layout.next, ARROW_NEXT, ui.hoverArrow === 1);
}

function drawArrow(ctx: CanvasRenderingContext2D, r: Rect, glyph: string, hover: boolean): void {
  if (hover) fillRectPx(ctx, r, COLOR_HOVER_BG);
  strokeRectPx(ctx, r, hover ? COLOR_SELECTED : COLOR_BORDER);
  drawText(ctx, glyph, r.x + r.w / HALF, rowBaseline(r), TEXT.SMALL, hover ? COLOR_SELECTED : COLOR_TEXT, "center");
}

interface CardContext {
  state: GameState;
  ui: StatusTabUi;
  chosen: boolean;
}

/** カードの右上の「一撃  奥義ゲージ 60」。cost が定義に無ければ種類だけ */
export function cardMetaText(card: StatusCardLayout): string {
  const kind = ULTIMATE_KIND_LABEL[card.def.kind];
  const cost = ultimateCostOf(card.def);
  return cost === null ? kind : `${kind}  ${COST_LABEL} ${cost}`;
}

function drawCard(ctx: CanvasRenderingContext2D, card: StatusCardLayout, c: CardContext): void {
  const { rect, def } = card;
  const choosable = canChooseUltimate(c.state);
  const focused = choosable && (c.ui.hoverCard === card.index || (c.ui.hoverCard < 0 && c.ui.cursor === card.index));
  if (c.chosen) fillRectPx(ctx, rect, COLOR_CARD_CHOSEN_BG);
  if (focused) fillRectPx(ctx, rect, COLOR_HOVER_BG);
  strokeRectPx(ctx, rect, c.chosen ? COLOR_SELECTED : focused ? COLOR_TEXT : COLOR_BORDER);

  const m = TEXT.SMALL;
  // ラン中は選べないので、選んでいない奥義は灰色にする
  const textColor = choosable || c.chosen ? COLOR_TEXT : COLOR_LOCKED;
  const x = rect.x + TEXT_PAD_X * HALF;
  const maxWidth = rect.w - TEXT_PAD_X * 4;
  const titleY = rect.y + CARD_TITLE_BASELINE;
  const meta = cardMetaText(card);
  drawText(ctx, meta, x + maxWidth, titleY, m, choosable || c.chosen ? COLOR_DIM : COLOR_LOCKED, "right");
  const title = `${c.chosen ? CHOSEN_MARK : ""}${def.name}`;
  const titleRoom = maxWidth - textWidth(meta, m) - TEXT_PAD_X * HALF;
  drawText(ctx, truncateText(title, titleRoom, m), x, titleY, m, c.chosen ? COLOR_SELECTED : textColor);
  drawCardBody(ctx, def.desc, { x, y: titleY + CARD_BODY_GAP, w: maxWidth, h: rect.y + rect.h - TEXT_PAD_X - (titleY + CARD_BODY_GAP) }, textColor);
}

/** 説明文を折り返して枠に入る行だけ描く。溢れたら最後の行を … にする */
function drawCardBody(ctx: CanvasRenderingContext2D, text: string, r: Rect, color: string): void {
  const m = TEXT.SMALL;
  const lineH = Math.max(MIN_LINE_H, textLineHeight(m));
  const lines = wrapText(text, r.w, m);
  const fit = Math.max(0, Math.floor(r.h / lineH));
  lines.slice(0, fit).forEach((line, i) => {
    const last = i === fit - 1 && lines.length > fit;
    const shown = last ? truncateText(`${line}${OVERFLOW_MARK}`, r.w, m) : line;
    drawText(ctx, shown, r.x, r.y + (i + 1) * lineH, m, color);
  });
}
