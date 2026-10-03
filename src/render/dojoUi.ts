/**
 * 稽古の間の描画（稽古帳の画面・計測の欄と台の案内の重ね描き・台の絵）。state は読むだけ。rng は使わない。
 * 計測は検証の道具なので数値を出す（装備・ビルドの UI は単一指標を出さない決まり。docs/ideas/dojo.md）。
 * 状態と当たり判定は src/ui/dojoBoard.ts
 */
import { actionKeyLabel } from "../core/input";
import type { GameState } from "../core/state";
import { formatAmount } from "../core/units";
import type { Vec } from "../core/vec";
import { VIEW_H, VIEW_W } from "../core/view";
import { DOJO } from "../data/tuning";
import { type DojoLayout, type DojoOpenSpotKey, type DojoSpotKey, DOJO_SPOT_KEYS } from "../map/dojoMap";
import { TILE_SIZE } from "../map/grid";
import {
  DOJO_BOARD_HINT,
  DOJO_BOARD_LAYOUT,
  DOJO_BOARD_TITLE,
  DOJO_ROW_DESC,
  type DojoBoardUi,
  dojoArrowRect,
  dojoBoardVisibleRows,
  dojoCursorRow,
  dojoRowRect,
  dojoValueRect,
} from "../ui/dojoBoard";
import {
  DOJO_DAMAGE_KINDS,
  DOJO_DAMAGE_KIND_LABEL,
  DOJO_ROWS,
  DOJO_ROW_LABEL,
  type DojoConfig,
  type DojoMeterView,
  dojoRowValueLabel,
  isDojoActionRow,
} from "../system/dojoConfig";
import { COLOR_BORDER, COLOR_DIM, COLOR_PANEL_BG, COLOR_SELECTED, COLOR_TEXT, fillRectPx, strokeRectPx } from "./lootUiParts";
import { TEXT, drawText, drawTextShadow, textLineHeight, truncateText, wrapText } from "./pixelText";
import type { Sprite } from "./sprites";

export type DojoSpriteLookup = (key: string) => Sprite | undefined;

export interface DojoBoardView {
  ui: Readonly<DojoBoardUi>;
  config: DojoConfig;
  /** 行の間隔（main.ts が dojoBoardRowGap(textLineHeight(TEXT.SMALL)) で渡す） */
  rowGap: number;
}

export interface DojoOverlayView {
  meter: DojoMeterView;
  config: DojoConfig;
  /** インタラクトで開ける近い台。無ければ null */
  near: DojoOpenSpotKey | null;
  layout: DojoLayout;
}

// -----------------------------------------------------------------------------
// 純粋な部分（文字列・行の組み立て。テストする）
// -----------------------------------------------------------------------------

/** 台の名前 */
export const DOJO_SPOT_NAME: Readonly<Record<DojoSpotKey, string>> = {
  spring: "手水鉢",
  rack: "武器掛け",
  board: "稽古帳",
  exit: "戻り口",
};

/** 台ごとの操作の言葉（「E: 〜」の〜）。手水鉢は触れるだけなので無い */
const SPOT_ACTION: Readonly<Record<DojoOpenSpotKey, string>> = {
  rack: "武器を試す",
  board: "稽古帳を開く",
  exit: "拠点へ戻る",
};

export const DOJO_EXIT_HINT = "Esc: 拠点へ";
export const DOJO_METER_TITLE = "計測";

export function dojoSpotPrompt(spot: DojoOpenSpotKey): string {
  return `${actionKeyLabel("interact")}: ${SPOT_ACTION[spot]}`;
}

const SUMMARY_SEPARATOR = "　";

/** 今の設定の要約 1 行（相手・数・深さ・動き。既定から外れた補助の設定は短く添える） */
export function dojoSummaryLine(config: DojoConfig): string {
  const parts = [
    dojoRowValueLabel(config, "enemy"),
    dojoRowValueLabel(config, "count"),
    dojoRowValueLabel(config, "depth"),
    dojoRowValueLabel(config, "behavior"),
  ];
  if (config.elite !== null) parts.splice(1, 0, dojoRowValueLabel(config, "elite"));
  if (config.tempo !== 1) parts.push(`${DOJO_ROW_LABEL.tempo} ${dojoRowValueLabel(config, "tempo")}`);
  if (config.timeScale !== 1) parts.push(`${DOJO_ROW_LABEL.timeScale} ${dojoRowValueLabel(config, "timeScale")}`);
  return parts.join(SUMMARY_SEPARATOR);
}

export interface DojoMeterRow {
  label: string;
  value: string;
}

const SECONDS_DIGITS = 1;

/** 計測の欄の行。出どころの内訳は 0 のものを出さない */
export function dojoMeterRows(m: DojoMeterView): DojoMeterRow[] {
  const rows: DojoMeterRow[] = [
    { label: "経過", value: `${m.elapsed.toFixed(SECONDS_DIGITS)} 秒` },
    { label: "合計", value: formatAmount(m.total) },
    { label: "毎秒", value: formatAmount(m.dps) },
    { label: "直近", value: formatAmount(m.recentDps) },
    { label: "命中", value: `${m.hits} 回` },
    { label: "会心", value: `${m.crits} 回` },
    { label: "最大", value: formatAmount(m.maxHit) },
  ];
  for (const kind of DOJO_DAMAGE_KINDS) {
    const v = m.byKind[kind];
    if (v > 0) rows.push({ label: DOJO_DAMAGE_KIND_LABEL[kind], value: formatAmount(v) });
  }
  rows.push({ label: "被弾", value: `${formatAmount(m.taken)}（${m.takenHits} 回）` });
  rows.push({ label: "撃破", value: `${m.kills} 体` });
  return rows;
}

// -----------------------------------------------------------------------------
// 稽古帳の画面
// -----------------------------------------------------------------------------

const COLOR_BG = "#08080c";
const COLOR_ROW_CURSOR = "rgba(106,140,255,0.22)";
const COLOR_ACTION = "#a0d0ff";
const COLOR_ARROW = "#a0a0b0";
const COLOR_SHADOW = "#000000";
const LINE_MIN = 10;
const PAD = 4;
const ARROW_LEFT = "←";
const ARROW_RIGHT = "→";
const SCROLL_UP = "▲";
const SCROLL_DOWN = "▼";

function lineH(m: number): number {
  return Math.max(LINE_MIN, textLineHeight(m));
}

export function drawDojoBoard(ctx: CanvasRenderingContext2D, view: DojoBoardView): void {
  const L = DOJO_BOARD_LAYOUT;
  fillRectPx(ctx, { x: 0, y: 0, w: VIEW_W, h: VIEW_H }, COLOR_BG);
  drawText(ctx, DOJO_BOARD_TITLE, VIEW_W / 2, L.titleY, TEXT.TITLE, COLOR_SELECTED, "center", "middle");
  DOJO_ROWS.forEach((_, i) => drawBoardRow(ctx, view, i));
  drawBoardScrollMarks(ctx, view);
  drawBoardDesc(ctx, view);
  drawText(ctx, truncateText(DOJO_BOARD_HINT, VIEW_W - PAD * 2, TEXT.SMALL), VIEW_W / 2, L.hintY, TEXT.SMALL, COLOR_DIM, "center");
}

function drawBoardRow(ctx: CanvasRenderingContext2D, view: DojoBoardView, index: number): void {
  const key = DOJO_ROWS[index];
  const r = dojoRowRect(index, view.ui.scroll, view.rowGap);
  if (key === undefined || r === null) return;
  const m = TEXT.SMALL;
  const cursor = index === view.ui.cursor;
  if (cursor) fillRectPx(ctx, r, COLOR_ROW_CURSOR);
  const action = isDojoActionRow(key);
  const labelColor = action ? COLOR_ACTION : cursor ? COLOR_SELECTED : COLOR_TEXT;
  const mid = r.y + r.h / 2;
  drawText(ctx, DOJO_ROW_LABEL[key], r.x + DOJO_BOARD_LAYOUT.labelPad, mid, m, labelColor, "left", "middle");
  if (action) return;
  const minus = dojoArrowRect(index, view.ui.scroll, -1, view.rowGap);
  const plus = dojoArrowRect(index, view.ui.scroll, 1, view.rowGap);
  const value = dojoValueRect(index, view.ui.scroll, view.rowGap);
  if (minus === null || plus === null || value === null) return;
  drawText(ctx, ARROW_LEFT, minus.x + minus.w / 2, mid, TEXT.SMALL, cursor ? COLOR_SELECTED : COLOR_ARROW, "center", "middle");
  drawText(ctx, ARROW_RIGHT, plus.x + plus.w / 2, mid, TEXT.SMALL, cursor ? COLOR_SELECTED : COLOR_ARROW, "center", "middle");
  const text = truncateText(dojoRowValueLabel(view.config, key), value.w - PAD, m);
  drawText(ctx, text, value.x + value.w / 2, mid, m, cursor ? COLOR_SELECTED : COLOR_TEXT, "center", "middle");
}

function drawBoardScrollMarks(ctx: CanvasRenderingContext2D, view: DojoBoardView): void {
  const L = DOJO_BOARD_LAYOUT;
  const x = L.listX + L.listW + PAD;
  if (view.ui.scroll > 0) drawText(ctx, SCROLL_UP, x, L.listTop, TEXT.SMALL, COLOR_DIM, "left", "top");
  if (view.ui.scroll + dojoBoardVisibleRows(view.rowGap) < DOJO_ROWS.length) drawText(ctx, SCROLL_DOWN, x, L.listBottom, TEXT.SMALL, COLOR_DIM, "left", "bottom");
}

/** 今の行の説明を 1 行（長ければ折り返して 2 行まで） */
function drawBoardDesc(ctx: CanvasRenderingContext2D, view: DojoBoardView): void {
  const key = dojoCursorRow(view.ui);
  if (key === null) return;
  const m = TEXT.SMALL;
  const lines = wrapText(DOJO_ROW_DESC[key], VIEW_W - DOJO_BOARD_LAYOUT.listX * 2, m).slice(0, 2);
  lines.forEach((line, i) => drawText(ctx, line, DOJO_BOARD_LAYOUT.listX, DOJO_BOARD_LAYOUT.descY + i * lineH(m), m, COLOR_TEXT, "left", "top"));
}

// -----------------------------------------------------------------------------
// 稽古の間の重ね描き
// -----------------------------------------------------------------------------

const METER_W = 112;
const METER_MARGIN = 6;
const METER_PAD = 4;
const SUMMARY_BOTTOM = 6;
const PROMPT_BOTTOM = 34;

function drawMeter(ctx: CanvasRenderingContext2D, meter: DojoMeterView): void {
  const m = TEXT.SMALL;
  const lh = lineH(m);
  const rows = dojoMeterRows(meter);
  const h = METER_PAD * 2 + lh * (rows.length + 1);
  const rect = { x: VIEW_W - METER_MARGIN - METER_W, y: METER_MARGIN, w: METER_W, h };
  fillRectPx(ctx, rect, COLOR_PANEL_BG);
  strokeRectPx(ctx, rect, COLOR_BORDER);
  drawText(ctx, DOJO_METER_TITLE, rect.x + METER_PAD, rect.y + METER_PAD, m, DOJO.panelColor, "left", "top");
  rows.forEach((row, i) => {
    const y = rect.y + METER_PAD + lh * (i + 1);
    drawText(ctx, row.label, rect.x + METER_PAD, y, m, COLOR_DIM, "left", "top");
    drawText(ctx, row.value, rect.x + rect.w - METER_PAD, y, m, COLOR_TEXT, "right", "top");
  });
}

/** 稽古の間を描いた後に重ねる（画面座標）。ポーズ中は上の画面の邪魔をしないよう出さない */
export function drawDojoOverlay(ctx: CanvasRenderingContext2D, state: GameState, view: DojoOverlayView): void {
  if (state.paused) return;
  drawMeter(ctx, view.meter);
  drawTextShadow(ctx, DOJO_EXIT_HINT, METER_MARGIN, VIEW_H - SUMMARY_BOTTOM - lineH(TEXT.SMALL), TEXT.SMALL, COLOR_DIM, COLOR_SHADOW, "left");
  if (view.near !== null) {
    drawTextShadow(ctx, dojoSpotPrompt(view.near), VIEW_W / 2, VIEW_H - PROMPT_BOTTOM, TEXT.BODY, COLOR_SELECTED, COLOR_SHADOW, "center");
  }
  const summary = truncateText(dojoSummaryLine(view.config), VIEW_W - METER_MARGIN * 2, TEXT.SMALL);
  drawTextShadow(ctx, summary, METER_MARGIN, VIEW_H - SUMMARY_BOTTOM, TEXT.SMALL, COLOR_DIM, COLOR_SHADOW, "left");
}

// -----------------------------------------------------------------------------
// 台の絵（ワールド座標。renderer の camera の translate の後に呼ぶ）
// -----------------------------------------------------------------------------

/** 台の絵に流用する部屋の台座の素材（data/tiles.ts の prop.*）。無ければ菱形で描く */
const PROP_SPRITE: Readonly<Record<DojoOpenSpotKey, string>> = {
  rack: "prop.exchange",
  board: "prop.rune",
  exit: "prop.ascend",
};
const PROP_COLOR: Readonly<Record<DojoSpotKey, string>> = {
  spring: "#6ab0ff",
  rack: "#c0a070",
  board: "#f0d8a0",
  exit: "#a0a0b0",
};
const DIAMOND_R = 6;
const LABEL_GAP = 4;

function drawDiamond(ctx: CanvasRenderingContext2D, at: Vec, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(at.x, at.y - DIAMOND_R);
  ctx.lineTo(at.x + DIAMOND_R, at.y);
  ctx.lineTo(at.x, at.y + DIAMOND_R);
  ctx.lineTo(at.x - DIAMOND_R, at.y);
  ctx.closePath();
  ctx.fill();
}

/** 素材があれば足元をタイルの下端に揃えて描く（部屋の台座と同じ置き方）。無ければ false */
function drawSpotSprite(ctx: CanvasRenderingContext2D, at: Vec, key: string, lookup: DojoSpriteLookup): boolean {
  const sprite = lookup(key);
  const img = sprite?.frames[0];
  if (!sprite || !img) return false;
  ctx.drawImage(img, Math.round(at.x - sprite.w / 2), Math.round(at.y + TILE_SIZE / 2 - sprite.h), sprite.w, sprite.h);
  return true;
}

export function drawDojoProps(ctx: CanvasRenderingContext2D, state: GameState, layout: DojoLayout, lookup: DojoSpriteLookup): void {
  const m = TEXT.SMALL;
  for (const key of DOJO_SPOT_KEYS) {
    const at = layout.spots[key];
    // 手水鉢は地図の泉のタイルが描かれるので名札だけ。他は素材 → 菱形
    if (key !== "spring" && !drawSpotSprite(ctx, at, PROP_SPRITE[key], lookup)) drawDiamond(ctx, at, PROP_COLOR[key]);
    const y = at.y - TILE_SIZE / 2 - LABEL_GAP;
    drawTextShadow(ctx, DOJO_SPOT_NAME[key], at.x, y - lineH(m), m, COLOR_TEXT, COLOR_SHADOW, "center");
  }
  void state;
}
