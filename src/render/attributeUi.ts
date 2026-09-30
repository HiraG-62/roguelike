import type { GameState } from "../core/state";
import { JOBS } from "../data/jobs";
import { ATTR_COLOR } from "../loot/affixes";
import { ATTR_KEYS, ATTR_LABEL, TRAIT_COLOR_HEX, type AttrKey } from "../loot/types";
import type { Rect } from "../ui/inventoryLayout";
import { STATUS_ATTR_ROW_H, statusAttrPanelRect } from "../ui/statusTab";
import { TEXT, drawText, truncateText } from "./pixelText";

/**
 * ステータスの描画。装備画面（ステータスタブ）の「生値と実効値」の一覧と、ジョブ名の見出し
 */

const COLOR_SUB = "#a0a0a0";

const HALF = 2;
/** 行の下端からベースラインまで */
const ROW_BASELINE_UP = 1;

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

/** パネルの左右の余白 */
const PANEL_PAD = 4;
/** 行の中央に文字を置くベースライン（行の上端から）。行高が文字より広いので中央に寄せる */
const ROW_TEXT_BASELINE = 3;

/** ステータス一覧。生値と実効値を ATTR_KEYS の順に並べる */
export function drawAttributePanel(ctx: CanvasRenderingContext2D, state: GameState, rect: Rect = statusAttrPanelRect()): void {
  const m = TEXT.SMALL;
  const x = rect.x + PANEL_PAD;
  const bottom = rect.y + rect.h;
  const room = rect.w - PANEL_PAD * HALF;
  ATTR_KEYS.forEach((key, i) => {
    const top = rect.y + i * STATUS_ATTR_ROW_H;
    if (top + STATUS_ATTR_ROW_H > bottom) return;
    const baseline = top + STATUS_ATTR_ROW_H / HALF + ROW_TEXT_BASELINE;
    const text = attributeValueText(key, state.stats.attributes[key], state.stats.attributesEff[key]);
    drawText(ctx, truncateText(text, room, m), x, baseline, m, attrColor(key));
  });
}

/** ジョブ名の行（装備タブの要約の見出し・ステータスタブの先頭） */
export function drawSummaryHead(ctx: CanvasRenderingContext2D, state: GameState, rect: Rect): void {
  const m = TEXT.SMALL;
  const baseline = rect.y + rect.h - ROW_BASELINE_UP - 1;
  const width = rect.w - PANEL_PAD * HALF;
  drawText(ctx, truncateText(JOBS[state.job].name, width, m), rect.x + PANEL_PAD, baseline, m, COLOR_SUB);
}
