import { KEYWORD_DEFS } from "../core/keywords";
import type { GameState } from "../core/state";
import type { SynergyElement, SynergyElementKind } from "../loot/describe";
import { SKILL } from "../skills/data";
import {
  type SynergyPanelUi,
  type SynergyWordState,
  type SynergyWordView,
  synergyBuild,
  synergyCellRect,
  synergyDetailRect,
  synergyWords,
} from "../ui/synergyPanel";
import { COLOR_BORDER, COLOR_DIM, COLOR_HOVER_BG, COLOR_SELECTED, COLOR_TEXT, TEXT_PAD_X, bodyLineH, fillRectPx, strokeRectPx } from "./lootUiParts";
import { TEXT, drawText, textWidth, truncateText } from "./pixelText";

/**
 * 装備画面の「網」タブ（docs/ideas/synergy-web.md 4-a）。state と ui を読むだけ。
 * 各語の字形の明暗で「今のビルドが関わっているか」を、背景の色で余り（暖色）/ 飢え（寒色の点滅）を見せる。
 * 数字は出す / 食う要素の数だけを小さく出す（スコアや順位は出さない）
 */

/** 余り = 暖色、飢え = 寒色（点滅）、つながり = 薄い緑 */
const STATE_BG: Readonly<Record<SynergyWordState, string | null>> = {
  surplus: "rgba(255,150,60,0.22)",
  hunger: "rgba(80,160,255,0.28)",
  linked: "rgba(120,220,140,0.10)",
  none: null,
};
const STATE_TEXT: Readonly<Record<SynergyWordState, string>> = {
  surplus: "余り: 活かす側がない",
  hunger: "不足: 生む側がない",
  linked: "生む側と活かす側がそろっている",
  none: "関連なし",
};
const STATE_COLOR: Readonly<Record<SynergyWordState, string>> = {
  surplus: "#ffa050",
  hunger: "#70b0ff",
  linked: "#90e0a0",
  none: COLOR_DIM,
};
/** 要素の種類ごとの名前の色 */
const KIND_COLOR: Readonly<Record<SynergyElementKind, string>> = {
  item: "#e8c890",
  resonance: "#c0a0ff",
  skill: SKILL.drop.stoneColor,
  boon: "#ffd75f",
};
/** 関わっていない語の字形の不透明度 */
const IDLE_ALPHA = 0.3;
/** 飢えの点滅の周期（秒）と、消えている側の不透明度 */
const HUNGER_BLINK_PERIOD = 0.8;
const HUNGER_BLINK_LOW = 0.35;
const GLYPH_X = 3;
const LABEL_GAP = 3;
const COUNT_PAD = 2;
/** ？ のヘルプに出す凡例と操作（画面には常時出さない） */
export const WEB_HELP: readonly { text: string; color: string }[] = [
  { text: "方向キー / スティック / マウス: キーワードを選ぶ", color: COLOR_TEXT },
  { text: "暖色 = 余り（生む側だけで、活かす側がない）", color: STATE_COLOR.surplus },
  { text: "寒色の点滅 = 不足（活かす側だけで、生む側がない）", color: STATE_COLOR.hunger },
  { text: "右下の数 = 生む側 / 活かす側の数", color: COLOR_DIM },
  { text: "名前の色: 遺物 / 共鳴 / スキル石 / 祝福", color: COLOR_DIM },
];

export function drawSynergyTab(ctx: CanvasRenderingContext2D, state: GameState, ui: SynergyPanelUi): void {
  const words = synergyWords(synergyBuild(state));
  words.forEach((w, i) => drawCell(ctx, w, i, i === ui.cursor, ui.time));
  const selected = words[ui.cursor];
  if (selected) drawDetail(ctx, selected);
}

function hungerAlpha(time: number): number {
  const phase = (time % HUNGER_BLINK_PERIOD) / HUNGER_BLINK_PERIOD;
  return phase < 0.5 ? 1 : HUNGER_BLINK_LOW;
}

function drawCell(ctx: CanvasRenderingContext2D, w: SynergyWordView, index: number, selected: boolean, time: number): void {
  const r = synergyCellRect(index);
  const bg = STATE_BG[w.state];
  if (bg !== null) {
    ctx.globalAlpha = w.state === "hunger" ? hungerAlpha(time) : 1;
    fillRectPx(ctx, r, bg);
    ctx.globalAlpha = 1;
  }
  if (selected) fillRectPx(ctx, r, COLOR_HOVER_BG);
  strokeRectPx(ctx, r, selected ? COLOR_SELECTED : COLOR_BORDER);

  const def = KEYWORD_DEFS[w.key];
  const m = TEXT.SMALL;
  const baseline = r.y + bodyLineH();
  ctx.globalAlpha = w.state === "none" ? IDLE_ALPHA : 1;
  drawText(ctx, def.glyph, r.x + GLYPH_X, baseline, TEXT.BODY, def.color);
  const labelX = r.x + GLYPH_X + textWidth(def.glyph, TEXT.BODY) + LABEL_GAP;
  drawText(ctx, truncateText(def.label, r.x + r.w - labelX - COUNT_PAD, m), labelX, baseline, m, COLOR_TEXT);
  ctx.globalAlpha = 1;
  if (w.state === "none") return;
  const count = `${w.producers.length}/${w.consumers.length}`;
  drawText(ctx, count, r.x + r.w - COUNT_PAD, r.y + r.h - COUNT_PAD, m, STATE_COLOR[w.state], "right");
}

/** 右側: 選んだ語 → 状態 → 出す要素 → 食う要素 */
function drawDetail(ctx: CanvasRenderingContext2D, w: SynergyWordView): void {
  const r = synergyDetailRect();
  strokeRectPx(ctx, r, COLOR_BORDER);
  const def = KEYWORD_DEFS[w.key];
  const m = TEXT.SMALL;
  const lineH = bodyLineH();
  const x = r.x + TEXT_PAD_X;
  const maxWidth = r.w - TEXT_PAD_X * 2;
  const bottom = r.y + r.h - 2;
  let y = r.y + lineH + 1;
  drawText(ctx, `${def.glyph} ${def.label}`, x, y, TEXT.BODY, def.color);
  y += lineH + 1;
  drawText(ctx, truncateText(STATE_TEXT[w.state], maxWidth, m), x, y, m, STATE_COLOR[w.state]);
  y += lineH + 2;
  y = drawElementList(ctx, "生む側", w.producers, x, y, maxWidth, bottom);
  drawElementList(ctx, "活かす側", w.consumers, x, y + 2, maxWidth, bottom);
}

/** 見出し + 要素名の列。入らない分は「ほか n」にまとめる。次の y を返す */
function drawElementList(
  ctx: CanvasRenderingContext2D,
  head: string,
  list: readonly SynergyElement[],
  x: number,
  top: number,
  maxWidth: number,
  bottom: number,
): number {
  const m = TEXT.SMALL;
  const lineH = bodyLineH();
  let y = top;
  if (y > bottom) return y;
  drawText(ctx, list.length === 0 ? `${head}: なし` : `${head}:`, x, y, m, COLOR_DIM);
  y += lineH;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e) break;
    // 最後の行に入りきらなければ残りの数だけを出す
    if (y + lineH > bottom && i < list.length - 1) {
      drawText(ctx, `  ほか ${list.length - i}`, x, y, m, COLOR_DIM);
      return y + lineH;
    }
    drawText(ctx, truncateText(`  ${e.name}`, maxWidth, m), x, y, m, KIND_COLOR[e.kind]);
    y += lineH;
  }
  return y;
}
