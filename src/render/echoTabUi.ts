import type { GameState } from "../core/state";
import { describeItem, describeTrait } from "../loot/describe";
import { formatAffix } from "../loot/affixes";
import {
  DYE_COST,
  ECHO_LABEL,
  ECHO_OP_HINT,
  ECHO_OP_LABEL,
  canAffordEcho,
  canBleachTrait,
  canRecallBud,
  canTension,
  echoCost,
  type EchoOp,
} from "../loot/crafting";
import { milestoneDef } from "../loot/provenance";
import { traitColorOf } from "../loot/colors";
import { TRAIT_COLOR_HEX, type Item, type TraitColor } from "../loot/types";
import { itemColor } from "../system/loot";
import {
  ECHO_STEP_PROMPT,
  type EchoLayout,
  type EchoUi,
  TRANSFER_TRAIT_PROMPT,
  buildEchoRequest,
  echoStep,
  echoTarget,
  isTransferDestination,
  layoutEcho,
  transferWhatOf,
} from "../ui/echoTab";
import type { Rect } from "../ui/inventoryLayout";
import {
  COLOR_BORDER,
  COLOR_DIM,
  COLOR_EMPTY,
  COLOR_GROWN,
  COLOR_HOVER_BG,
  COLOR_INSCRIPTION,
  COLOR_SELECTED,
  COLOR_TEXT,
  COLOR_WARN,
  TEXT_PAD_X,
  bodyLineH,
  drawItemRow,
  drawTipLine,
  fillRectPx,
  strokeRectPx,
  traitTipLine,
} from "./lootUiParts";
import { TEXT, drawText, truncateText, wrapText } from "./pixelText";
import { drawSlotGroupLines, drawStashToolbar, stashEmptyText, stashEmptyY } from "./stashToolbarUi";

/**
 * 残響タブの描画（ui/echoTab.ts の layoutEcho と当たり判定を共有）。state と ui を読むだけ。
 * 左列: 残響の所持数 → 操作ボタン 12 → 実行ボタン（費用。払えなければ灰色）→ 次の手順・操作の説明・結果。
 * 右列: 倉庫（対象 / 移し先・注ぎ先の選択）→ 対象の詳細（性質の行をクリックで選ぶ、染めは色も選ぶ。呼び戻しは過去の芽の行）
 */

/** ？ のヘルプに出す手順（画面には常時出さない） */
export const ECHO_HELP: readonly string[] = [
  "倉庫で対象を選ぶ → 操作 → 性質・芽（→ 色 / 受け取る遺物）→ 実行",
  "装備中の遺物は対象にできない",
  "砕くと性質の色の残響を得る。残響を払って性質を作り替える",
];
const COLOR_BUTTON_BG = "rgba(255,255,255,0.08)";
const COLOR_DISABLED_BG = "rgba(255,255,255,0.03)";
const COLOR_PICK_BG = "rgba(255,215,95,0.14)";
const COLOR_CHIP_ALPHA = 0.25;
const BUTTON_BASELINE = 11;
const EXECUTE_BASELINE = 12;
const ROW_TEXT_BASELINE = 8;
const WALLET_BASELINE_INSET = 2;
/** 操作ボタンの文字の左右の余白（3 列にしたので、長い名前は切り詰める） */
const BUTTON_TEXT_PAD = 4;

export function drawEchoTab(ctx: CanvasRenderingContext2D, state: GameState, ui: EchoUi): void {
  const layout = layoutEcho(state, ui);
  drawWallet(ctx, ui, layout);
  for (const b of layout.buttons) drawOpButton(ctx, ui, b.op, b.rect);
  drawExecute(ctx, state, ui, layout.execute);
  drawStatus(ctx, state, ui, layout.status);
  drawEchoStash(ctx, state, ui, layout);
  drawDetail(ctx, state, ui, layout);
}

function drawWallet(ctx: CanvasRenderingContext2D, ui: EchoUi, layout: EchoLayout): void {
  const m = TEXT.SMALL;
  for (const { color, rect } of layout.wallet) {
    const baseline = rect.y + rect.h - WALLET_BASELINE_INSET;
    drawText(ctx, `${ECHO_LABEL[color]} ${ui.save.echoes[color]}`, rect.x + TEXT_PAD_X, baseline, m, TRAIT_COLOR_HEX[color]);
  }
}

function drawOpButton(ctx: CanvasRenderingContext2D, ui: EchoUi, op: EchoOp, rect: Rect): void {
  const selected = ui.op === op;
  fillRectPx(ctx, rect, COLOR_BUTTON_BG);
  if (ui.hoverOp === op) fillRectPx(ctx, rect, COLOR_HOVER_BG);
  strokeRectPx(ctx, rect, selected ? COLOR_SELECTED : COLOR_BORDER);
  const label = truncateText(ECHO_OP_LABEL[op], rect.w - BUTTON_TEXT_PAD, TEXT.SMALL);
  drawText(ctx, label, rect.x + rect.w / 2, rect.y + BUTTON_BASELINE, TEXT.SMALL, selected ? COLOR_SELECTED : COLOR_TEXT, "center");
}

/** 実行ボタン: 費用は echoCost。選択が足りない・払えないときは灰色 */
function drawExecute(ctx: CanvasRenderingContext2D, state: GameState, ui: EchoUi, rect: Rect): void {
  const req = buildEchoRequest(state, ui);
  const cost = req === null ? null : echoCost(req);
  const affordable = req !== null && canAffordEcho(ui.save.echoes, cost);
  fillRectPx(ctx, rect, affordable ? COLOR_BUTTON_BG : COLOR_DISABLED_BG);
  strokeRectPx(ctx, rect, affordable ? COLOR_SELECTED : COLOR_BORDER);
  const costText = req === null ? "" : cost === null ? "（費用なし）" : `（${ECHO_LABEL[cost.color]} ${cost.amount}）`;
  const color = affordable ? COLOR_TEXT : COLOR_EMPTY;
  drawText(ctx, `実行${costText}`, rect.x + rect.w / 2, rect.y + EXECUTE_BASELINE, TEXT.SMALL, color, "center");
}

function stepPrompt(state: GameState, ui: EchoUi): string {
  const step = echoStep(state, ui);
  return step === "trait" && ui.op === "transfer" ? TRANSFER_TRAIT_PROMPT : ECHO_STEP_PROMPT[step];
}

/** 次の手順 → 操作の説明（ホバー中か選択中）→ 直前の結果 */
function drawStatus(ctx: CanvasRenderingContext2D, state: GameState, ui: EchoUi, rect: Rect): void {
  const m = TEXT.SMALL;
  const lineH = bodyLineH();
  const maxWidth = rect.w - TEXT_PAD_X * 2;
  const bottom = rect.y + rect.h;
  let y = rect.y + lineH;
  const draw = (text: string, color: string): void => {
    for (const line of wrapText(text, maxWidth, m)) {
      if (y > bottom) return;
      drawText(ctx, line, rect.x + TEXT_PAD_X, y, m, color);
      y += lineH;
    }
  };
  draw(stepPrompt(state, ui), COLOR_SELECTED);
  const op = ui.hoverOp ?? ui.op;
  if (op !== null) draw(`${ECHO_OP_LABEL[op]}: ${ECHO_OP_HINT[op]}`, COLOR_DIM);
  if (ui.result) draw(ui.result, ui.resultOk ? COLOR_GROWN : COLOR_WARN);
}

function choosingDestination(state: GameState, ui: EchoUi): boolean {
  const target = echoTarget(state, ui);
  if (target === null) return false;
  return ui.op === "pour" || (ui.op === "transfer" && transferWhatOf(target, ui.pick) !== null);
}

function drawEchoStash(ctx: CanvasRenderingContext2D, state: GameState, ui: EchoUi, layout: EchoLayout): void {
  const m = TEXT.SMALL;
  const header = layout.stashHeader;
  const destination = choosingDestination(state, ui);
  const title = destination ? `倉庫: ${ui.op === "pour" ? "注ぎ先" : "移し先"}を選ぶ（同じ部位）` : "倉庫: 対象を選ぶ";
  drawText(ctx, title, header.x + TEXT_PAD_X, header.y + header.h - 2, m, destination ? COLOR_GROWN : COLOR_DIM);
  drawStashToolbar(ctx, layout.stashToolbar, ui.view, layout.stashCounts);
  if (layout.stashOrder.length === 0) {
    drawText(ctx, stashEmptyText(layout.stashTotal), header.x + TEXT_PAD_X, stashEmptyY(layout.stashToolbar, bodyLineH()), m, COLOR_DIM);
    return;
  }
  drawSlotGroupLines(ctx, layout.stash.rows, layout.stashOrder, ui.view);
  const target = echoTarget(state, ui);
  for (const row of layout.stash.rows) {
    drawItemRow(ctx, row, ui.hoverId === row.item.id);
    if (row.item.id === ui.targetId) strokeRectPx(ctx, row.rect, COLOR_SELECTED);
    else if (row.item.id === ui.destinationId) strokeRectPx(ctx, row.rect, COLOR_GROWN);
    else if (destination && target !== null && isTransferDestination(target, row.item)) strokeRectPx(ctx, row.rect, COLOR_BORDER);
  }
}

// ---------------------------------------------------------------------------
// 対象の詳細
// ---------------------------------------------------------------------------

function drawDetail(ctx: CanvasRenderingContext2D, state: GameState, ui: EchoUi, layout: EchoLayout): void {
  const rect = layout.detail;
  strokeRectPx(ctx, rect, COLOR_BORDER);
  const m = TEXT.SMALL;
  const lineH = bodyLineH();
  const x = rect.x + TEXT_PAD_X;
  const maxWidth = rect.w - TEXT_PAD_X * 2;
  const target = echoTarget(state, ui);
  if (target === null) {
    // 手順は左の状態欄が出すので、ここには何も出さない（同じ文を 2 か所に並べない）
    return;
  }
  const d = describeItem(target);
  drawText(ctx, truncateText(d.name, maxWidth, m), x, rect.y + lineH, m, itemColor(target));
  drawText(ctx, truncateText(`${d.subtitle}・${d.marginText}`, maxWidth, m), x, rect.y + lineH * 2, m, COLOR_DIM);
  if (target.affixes.length === 0) {
    drawText(ctx, "性質なし", x, rect.y + lineH * 3, m, COLOR_DIM);
  }
  if (ui.op === "recall" && (target.buds ?? []).length === 0) {
    drawText(ctx, "芽吹いた記録なし", x, rect.y + lineH * 3, m, COLOR_DIM);
  }
  for (const row of layout.traitRows) drawTraitRow(ctx, ui, target, row.index, row.rect);
  for (const row of layout.budRows) drawBudRow(ctx, ui, target, row.index, row.rect);
  if (layout.inscriptionRow !== null) drawInscriptionRow(ctx, ui, target, layout.inscriptionRow);
  for (const chip of layout.colorChips) drawColorChip(ctx, ui, target, chip.color, chip.rect);
}

/** 操作ごとに選べる性質（移し = 芽吹いた性質、脱色 = 色のあるもの、張り = 代償付き）。他は灰色 */
function traitSelectable(ui: EchoUi, target: Item, index: number): boolean {
  switch (ui.op) {
    case "transfer":
      return transferWhatOf(target, { kind: "trait", index }) !== null;
    case "bleach":
      return canBleachTrait(target.affixes[index]);
    case "tension":
      return canTension(target.affixes[index]);
    default:
      return true;
  }
}

/** 呼び戻しの行: 「節目: 選ばなかった方」。呼び戻せない芽は灰色 */
function drawBudRow(ctx: CanvasRenderingContext2D, ui: EchoUi, target: Item, index: number, rect: Rect): void {
  const bud = target.buds?.[index];
  if (bud === undefined) return;
  const picked = ui.pick?.kind === "bud" && ui.pick.index === index;
  if (picked) {
    fillRectPx(ctx, rect, COLOR_PICK_BG);
    strokeRectPx(ctx, rect, COLOR_SELECTED);
  }
  const other = bud.options[bud.chosen === 0 ? 1 : 0];
  const label = milestoneDef(bud.milestone)?.label ?? bud.milestone;
  const usable = canRecallBud(target, index);
  const text = `${label}: ${formatAffix(other)}`;
  const maxWidth = rect.w - TEXT_PAD_X * 2;
  drawText(ctx, truncateText(text, maxWidth, TEXT.SMALL), rect.x + TEXT_PAD_X, rect.y + ROW_TEXT_BASELINE, TEXT.SMALL, usable ? COLOR_GROWN : COLOR_EMPTY);
}

function drawTraitRow(ctx: CanvasRenderingContext2D, ui: EchoUi, target: Item, index: number, rect: Rect): void {
  const roll = target.affixes[index];
  if (roll === undefined) return;
  const picked = ui.pick?.kind === "trait" && ui.pick.index === index;
  if (picked) {
    fillRectPx(ctx, rect, COLOR_PICK_BG);
    strokeRectPx(ctx, rect, COLOR_SELECTED);
  }
  const tip = traitTipLine(describeTrait(roll));
  const line = traitSelectable(ui, target, index) ? tip : { ...tip, color: COLOR_EMPTY };
  drawTipLine(ctx, line, rect.x + TEXT_PAD_X, rect.y + ROW_TEXT_BASELINE, rect.w - TEXT_PAD_X * 2, TEXT.SMALL);
}

function drawInscriptionRow(ctx: CanvasRenderingContext2D, ui: EchoUi, target: Item, rect: Rect): void {
  if (ui.pick?.kind === "inscription") {
    fillRectPx(ctx, rect, COLOR_PICK_BG);
    strokeRectPx(ctx, rect, COLOR_SELECTED);
  }
  const text = `銘「${target.inscription ?? ""}」を移す`;
  drawText(ctx, text, rect.x + TEXT_PAD_X, rect.y + ROW_TEXT_BASELINE, TEXT.SMALL, COLOR_INSCRIPTION);
}

/** 染めの色: 所持数が足りない色と、すでにその色の性質は灰色 */
function drawColorChip(ctx: CanvasRenderingContext2D, ui: EchoUi, target: Item, color: TraitColor, rect: Rect): void {
  const roll = ui.pick?.kind === "trait" ? target.affixes[ui.pick.index] : undefined;
  const same = roll !== undefined && traitColorOf(roll) === color;
  const usable = !same && ui.save.echoes[color] >= DYE_COST;
  const hex = TRAIT_COLOR_HEX[color];
  ctx.globalAlpha = usable ? COLOR_CHIP_ALPHA : COLOR_CHIP_ALPHA / 2;
  fillRectPx(ctx, rect, hex);
  ctx.globalAlpha = 1;
  strokeRectPx(ctx, rect, ui.color === color ? COLOR_SELECTED : usable ? hex : COLOR_BORDER);
  const label = `${ECHO_LABEL[color]} ${DYE_COST}`;
  drawText(ctx, label, rect.x + rect.w / 2, rect.y + ROW_TEXT_BASELINE + 1, TEXT.SMALL, usable ? COLOR_TEXT : COLOR_EMPTY, "center");
}
