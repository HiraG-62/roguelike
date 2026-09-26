import { keyLabel } from "../core/input";
import type { GameState } from "../core/state";
import { JOBS } from "../data/jobs";
import { ATTR_COLOR } from "../loot/affixes";
import { ATTR_LABEL } from "../loot/resonance";
import { TRAIT_COLOR_HEX, type AttrKey } from "../loot/types";
import { ALLOC_BUTTON, ALLOC_ORDER, allocButtonRect } from "../ui/attributeAlloc";
import type { Rect } from "../ui/inventoryLayout";
import { statusAttrPanelRect } from "../ui/statusTab";
import { TEXT, drawText, textWidth, truncateText } from "./pixelText";

/**
 * ステータスの描画。装備画面（ステータスタブ）の「生値と実効値」の一覧と振り分けの「+」、HUD の未振り点の表示。
 * 当たり判定は ui/attributeAlloc.ts の allocButtonRect と共有する
 */

const COLOR_SUB = "#a0a0a0";
const COLOR_READY = "#ffd75f";
const COLOR_BUTTON_BG = "rgba(255,215,95,0.12)";
const COLOR_BUTTON_HOVER = "rgba(255,215,95,0.3)";

const HALF = 2;
/** 行の下端からベースラインまで */
const ROW_BASELINE_UP = 1;
const BUTTON_GLYPH = "+";
const BUTTON_BASELINE_UP = 1;

/** ステータスの色（loot/affixes.ts の ATTR_COLOR。防御は色を持つ 5 種の外なので順引きで決め打つ） */
export function attrColor(key: AttrKey): string {
  return TRAIT_COLOR_HEX[ATTR_COLOR[key]];
}

// ---------------------------------------------------------------------------
// ステータスタブの一覧
// ---------------------------------------------------------------------------

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

/** このランで振った点（「振り +2」）。振っていなければ空 */
export function allocatedText(points: number): string {
  return points > 0 ? `振り +${points}` : "";
}

/** 行の中央に文字を置くベースライン（行の上端から）。行高が文字より広いので中央に寄せる */
const ROW_TEXT_BASELINE = 3;

/**
 * 行の並びは ALLOC_BUTTON.rowH 間隔（「+」の当たり判定と揃える）。hover は ui.status.hoverAlloc。
 * 「+」は振れる点があるときだけ出す（無いときに灰色のボタンを並べると文字が増えるだけなので）
 */
export function drawAttributePanel(ctx: CanvasRenderingContext2D, state: GameState, hover = -1, rect: Rect = statusAttrPanelRect()): void {
  const m = TEXT.SMALL;
  const x = rect.x + ALLOC_BUTTON.pad;
  const bottom = rect.y + rect.h;
  const canAlloc = state.runAttributes.unspent > 0;
  ALLOC_ORDER.forEach((key, i) => {
    const button = allocButtonRect(rect, i);
    if (button.y + button.h > bottom) return;
    const baseline = rect.y + i * ALLOC_BUTTON.rowH + ALLOC_BUTTON.rowH / HALF + ROW_TEXT_BASELINE;
    const right = button.x - ALLOC_BUTTON.pad;
    const spent = allocatedText(state.runAttributes.alloc[key]);
    if (spent) drawText(ctx, spent, right, baseline, m, COLOR_SUB, "right");
    const room = right - x - (spent ? textWidth(spent, m) + ALLOC_BUTTON.pad : 0);
    const text = attributeValueText(key, state.stats.attributes[key], state.stats.attributesEff[key]);
    drawText(ctx, truncateText(text, room, m), x, baseline, m, attrColor(key));
    if (canAlloc) drawAllocButton(ctx, button, hover === i);
  });
}

/** ジョブ名と未振り点の行（装備タブの要約の見出し・ステータスタブの先頭） */
export function drawSummaryHead(ctx: CanvasRenderingContext2D, state: GameState, rect: Rect): void {
  const m = TEXT.SMALL;
  const baseline = rect.y + rect.h - ROW_BASELINE_UP - 1;
  const unspent = state.runAttributes.unspent;
  const right = rect.x + rect.w - ALLOC_BUTTON.pad;
  const unspentText = unspent > 0 ? `未振り ${unspent}` : "";
  if (unspentText) drawText(ctx, unspentText, right, baseline, m, COLOR_READY, "right");
  const width = right - (rect.x + ALLOC_BUTTON.pad) - textWidth(unspentText, m) - ALLOC_BUTTON.pad;
  drawText(ctx, truncateText(JOBS[state.job].name, width, m), rect.x + ALLOC_BUTTON.pad, baseline, m, COLOR_SUB);
}

function drawAllocButton(ctx: CanvasRenderingContext2D, r: Rect, hover: boolean): void {
  const color = COLOR_READY;
  ctx.fillStyle = hover ? COLOR_BUTTON_HOVER : COLOR_BUTTON_BG;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  drawText(ctx, BUTTON_GLYPH, r.x + r.w / HALF, r.y + r.h - BUTTON_BASELINE_UP, TEXT.SMALL, color, "center");
}

// ---------------------------------------------------------------------------
// HUD（マナバーの横）
// ---------------------------------------------------------------------------

/** 点滅の周期（tick）。装備画面を開くと paused で tick が止まるので点灯のまま止まることがある */
const HUD_BLINK_TICKS = 40;
const COLOR_HUD_DIM = "#a08a40";

/** HUD の一言。未振り点が無ければ null */
export function unspentHudText(unspent: number): string | null {
  if (unspent <= 0) return null;
  return `未振り点 ${unspent}（${keyLabel("inventory", { first: true })}）`;
}

/** 未振り点があるときだけ小さく点滅させる。描画のみ（tick を読むだけ） */
export function drawUnspentHud(ctx: CanvasRenderingContext2D, state: GameState, x: number, baseline: number): void {
  const text = unspentHudText(state.runAttributes.unspent);
  if (text === null) return;
  const on = state.tick % HUD_BLINK_TICKS < HUD_BLINK_TICKS / HALF;
  drawText(ctx, text, x, baseline, TEXT.SMALL, on ? COLOR_READY : COLOR_HUD_DIM);
}
