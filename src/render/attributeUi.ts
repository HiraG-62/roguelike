import type { GameState } from "../core/state";
import { ATTR_LABEL, COLOR_ATTR } from "../loot/resonance";
import { TRAIT_COLORS, TRAIT_COLOR_HEX, type AttrKey, type TraitColor } from "../loot/types";
import { ALLOC_BUTTON, ALLOC_ORDER, allocButtonRect } from "../ui/attributeAlloc";
import { type Rect, attributePanelRect } from "../ui/inventory";
import { TEXT, drawText, textWidth, truncateText } from "./pixelText";

/**
 * ステータスの描画。装備画面の「生値と実効値」の一覧と振り分けの「+」、HUD の未振り点の表示。
 * 当たり判定は ui/attributeAlloc.ts の allocButtonRect と共有する
 */

export { attributePanelRect };

/** 何が伸びるかの一言（docs/COMBAT_DESIGN.md A-1 の要約。単一の強さの指標は出さない） */
export const ATTR_HINT: Readonly<Record<AttrKey, string>> = {
  str: "近接・怯み",
  dex: "射撃・移動",
  vit: "最大HP・耐性",
  mnd: "マナ・会心",
  spi: "スキル・状態異常",
};

const COLOR_TEXT = "#e0e0e0";
const COLOR_SUB = "#a0a0a0";
const COLOR_READY = "#ffd75f";
const COLOR_DISABLED = "#505058";
const COLOR_BUTTON_BG = "rgba(255,215,95,0.12)";
const COLOR_BUTTON_HOVER = "rgba(255,215,95,0.3)";

const HALF = 2;
/** 行の下端からベースラインまで */
const ROW_BASELINE_UP = 1;
const BUTTON_GLYPH = "+";
const BUTTON_BASELINE_UP = 1;

/** ステータスの色（共鳴の色の対応を逆引き） */
function attrColor(key: AttrKey): string {
  const color = TRAIT_COLORS.find((c: TraitColor) => COLOR_ATTR[c] === key);
  return color === undefined ? COLOR_TEXT : TRAIT_COLOR_HEX[color];
}

// ---------------------------------------------------------------------------
// 装備画面の一覧（スロットの下）
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

/** 行の並びは ALLOC_BUTTON.rowH 間隔（「+」の当たり判定と揃える）。hover は ui.hoverAlloc */
export function drawAttributePanel(ctx: CanvasRenderingContext2D, state: GameState, hover = -1, rect: Rect = attributePanelRect()): void {
  const m = TEXT.SMALL;
  const x = rect.x + ALLOC_BUTTON.pad;
  const bottom = rect.y + rect.h;
  const canAlloc = state.runAttributes.unspent > 0;
  ALLOC_ORDER.forEach((key, i) => {
    const button = allocButtonRect(rect, i);
    if (button.y + button.h > bottom) return;
    const baseline = rect.y + (i + 1) * ALLOC_BUTTON.rowH - ROW_BASELINE_UP;
    const right = button.x - ALLOC_BUTTON.pad;
    const text = attributeValueText(key, state.stats.attributes[key], state.stats.attributesEff[key]);
    const valueW = Math.min(textWidth(text, m), right - x);
    drawText(ctx, truncateText(text, right - x, m), x, baseline, m, attrColor(key));
    const hintW = right - x - valueW - ALLOC_BUTTON.pad;
    if (hintW > 0) drawText(ctx, truncateText(ATTR_HINT[key], hintW, m), right, baseline, m, COLOR_SUB, "right");
    drawAllocButton(ctx, button, canAlloc, canAlloc && hover === i);
  });
}

/** 未振り点が 0 なら灰色（押しても何も起きない） */
function drawAllocButton(ctx: CanvasRenderingContext2D, r: Rect, enabled: boolean, hover: boolean): void {
  const color = enabled ? COLOR_READY : COLOR_DISABLED;
  if (enabled) {
    ctx.fillStyle = hover ? COLOR_BUTTON_HOVER : COLOR_BUTTON_BG;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
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
  return `未振り点 ${unspent}（Tab）`;
}

/** 未振り点があるときだけ小さく点滅させる。描画のみ（tick を読むだけ） */
export function drawUnspentHud(ctx: CanvasRenderingContext2D, state: GameState, x: number, baseline: number): void {
  const text = unspentHudText(state.runAttributes.unspent);
  if (text === null) return;
  const on = state.tick % HUD_BLINK_TICKS < HUD_BLINK_TICKS / HALF;
  drawText(ctx, text, x, baseline, TEXT.SMALL, on ? COLOR_READY : COLOR_HUD_DIM);
}
