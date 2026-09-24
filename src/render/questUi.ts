import { VIEW_H, VIEW_W } from "../core/view";
import { QUESTS, type QuestKey, type QuestSave, isQuestCompleted, questRewardLabel } from "../meta/quests";
import { QUEST_CHOICE_LAYOUT, type QuestChoiceScreen, type Rect, questCardRects, questSkipRect, skipIndex } from "../ui/quests";
import { TEXT, drawText, textLineHeight, truncateText, wrapText } from "./pixelText";
import { pulse } from "./renderMath";

/** 依頼の 3 択の描画（状態は ui/quests.ts。読むだけ） */

const COLOR_BG = "#08080c";
const COLOR_TITLE = "#ffd75f";
const COLOR_TEXT = "#e0e0e0";
const COLOR_DIM = "#707080";
const COLOR_CARD_BG = "#101018";
const COLOR_CARD_CURSOR = "#2a2a40";
const COLOR_BORDER = "#505060";
const COLOR_BORDER_CURSOR = "#ffd75f";
const COLOR_GOAL = "#a0d8ff";
const COLOR_REWARD = "#80ff80";
const COLOR_DONE = "#909090";
const CURSOR_PULSE_SPEED = 4;
const CARD_PAD = 6;
const NAME_TOP = 14;
const SECTION_GAP = 4;
const DESC_MAX_LINES = 4;
const REWARD_MAX_LINES = 4;
const MIN_LINE = 10;

export function drawQuestChoice(ctx: CanvasRenderingContext2D, ui: Readonly<QuestChoiceScreen>, save: Readonly<QuestSave>, time: number): void {
  ctx.fillStyle = COLOR_BG;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const L = QUEST_CHOICE_LAYOUT;
  drawText(ctx, "依頼を選ぶ", VIEW_W / 2, L.titleY, TEXT.TITLE, COLOR_TITLE, "center");
  drawText(ctx, "1 つ選んで出発します。達成すると次の探索から選べるものが増えます", VIEW_W / 2, L.subtitleY, TEXT.SMALL, COLOR_DIM, "center");
  const rects = questCardRects(ui.offers.length);
  ui.offers.forEach((key, i) => {
    const rect = rects[i];
    if (rect) drawCard(ctx, key, rect, ui.cursor === i, isQuestCompleted(save, key), time);
  });
  drawSkip(ctx, ui.cursor === skipIndex(ui), time);
  drawText(ctx, "←→ 選ぶ　↓ 受けずに出発　Enter 決定　Esc 起点へ戻る", VIEW_W / 2, L.hintY, TEXT.SMALL, COLOR_DIM, "center");
}

function lineHeight(): number {
  return Math.max(MIN_LINE, textLineHeight(TEXT.SMALL));
}

function drawFrame(ctx: CanvasRenderingContext2D, r: Rect, active: boolean, time: number): void {
  ctx.fillStyle = COLOR_CARD_BG;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  if (active) {
    ctx.globalAlpha = pulse(time, CURSOR_PULSE_SPEED, 0.6, 1);
    ctx.fillStyle = COLOR_CARD_CURSOR;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = active ? COLOR_BORDER_CURSOR : COLOR_BORDER;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
}

/** 折り返した行を上から描き、次の y を返す */
function drawLines(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, maxLines: number, color: string): number {
  const line = lineHeight();
  const lines = wrapText(text, width, TEXT.SMALL).slice(0, maxLines);
  lines.forEach((t, i) => drawText(ctx, t, x, y + i * line, TEXT.SMALL, color));
  return y + lines.length * line;
}

function drawCard(ctx: CanvasRenderingContext2D, key: QuestKey, r: Rect, active: boolean, done: boolean, time: number): void {
  const def = QUESTS[key];
  drawFrame(ctx, r, active, time);
  const x = r.x + CARD_PAD;
  const width = r.w - CARD_PAD * 2;
  const line = lineHeight();
  drawText(ctx, truncateText(def.name, width, TEXT.BODY), x, r.y + NAME_TOP, TEXT.BODY, done ? COLOR_DONE : COLOR_TITLE);
  let y = r.y + NAME_TOP + line + SECTION_GAP;
  y = drawLines(ctx, def.desc, x, y, width, DESC_MAX_LINES, COLOR_TEXT) + SECTION_GAP;
  drawText(ctx, `目標: ${def.goal}`, x, y, TEXT.SMALL, COLOR_GOAL);
  y += line + SECTION_GAP;
  const reward = done ? "達成済み（報酬なし）" : `報酬: ${questRewardLabel(def.reward)}`;
  drawLines(ctx, reward, x, y, width, REWARD_MAX_LINES, done ? COLOR_DONE : COLOR_REWARD);
}

function drawSkip(ctx: CanvasRenderingContext2D, active: boolean, time: number): void {
  const r = questSkipRect();
  drawFrame(ctx, r, active, time);
  drawText(ctx, "受けずに出発", r.x + r.w / 2, r.y + r.h / 2, TEXT.SMALL, active ? COLOR_TITLE : COLOR_TEXT, "center", "middle");
}
