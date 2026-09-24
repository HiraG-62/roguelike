import type { GameState } from "../core/state";
import { MODIFIERS, SKILL, SKILL_DEFS, modifierLinkCost, modifierVerb } from "../skills/data";
import { ownedRunes, stoneInSlot } from "../skills/persistence";
import type { InventoryUi } from "../ui/inventory";
import { type RuneListLayout, type RuneRowLayout, RUNE_BLOCK_TEXT, entryBlock } from "../ui/skillRunes";
import {
  COLOR_DIM,
  COLOR_EMPTY,
  COLOR_HOVER_BG,
  COLOR_SELECTED,
  COLOR_TEXT,
  COLOR_WARN,
  ROW_BASELINE_OFFSET,
  TEXT_PAD_X,
  type TipLine,
  bodyLineH,
  fillRectPx,
} from "./lootUiParts";
import { TEXT, drawText, textWidth, truncateText } from "./pixelText";

/**
 * 装備画面スキルタブの「刻印符」列の描画（state と ui を読むだけ）。
 * 選択中スロットの石に付いた符を上に、所持品を下に並べる。付けられない符は暗く出す
 */

const COLOR_RUNE = SKILL.drop.runeColor;
const MARK_ATTACHED = "付";
const COLOR_HEADER_LINE = "#404040";

export function drawRuneColumn(ctx: CanvasRenderingContext2D, state: GameState, list: RuneListLayout, ui: InventoryUi): void {
  drawRuneHeader(ctx, state, list);
  if (list.entries.length === 0) {
    const m = TEXT.SMALL;
    drawText(ctx, "刻印符がありません", list.header.x + TEXT_PAD_X, list.header.y + list.header.h + bodyLineH(), m, COLOR_DIM);
    return;
  }
  for (const row of list.rows) drawRuneRow(ctx, state, row, ui);
}

function drawRuneHeader(ctx: CanvasRenderingContext2D, state: GameState, list: RuneListLayout): void {
  const { header } = list;
  const m = TEXT.SMALL;
  const baseline = header.y + header.h / 2 + ROW_BASELINE_OFFSET;
  const count = `${ownedRunes(state.skills.profile).length}/${SKILL.runeCapacity}`;
  drawText(ctx, count, header.x + header.w - TEXT_PAD_X, baseline, m, COLOR_DIM, "right");
  // 付け先は黄色の枠のスロットで分かるので見出しには出さない
  const label = "刻印符";
  const maxWidth = header.w - textWidth(count, m) - TEXT_PAD_X * 3;
  drawText(ctx, truncateText(label, maxWidth, m), header.x + TEXT_PAD_X, baseline, m, COLOR_RUNE);
  fillRectPx(ctx, { x: header.x, y: header.y + header.h - 1, w: header.w, h: 1 }, COLOR_HEADER_LINE);
}

function drawRuneRow(ctx: CanvasRenderingContext2D, state: GameState, row: RuneRowLayout, ui: InventoryUi): void {
  const { rect } = row;
  const focused = ui.runes.focusId === row.rune.id || (ui.runes.focusId === null && ui.runes.cursor === row.index);
  if (focused) fillRectPx(ctx, rect, COLOR_HOVER_BG);
  const m = TEXT.SMALL;
  const baseline = rect.y + rect.h / 2 + ROW_BASELINE_OFFSET;
  const stone = stoneInSlot(state.skills.profile, ui.skillSlot);
  const blocked = entryBlock(stone, row) !== null;
  const def = MODIFIERS[row.rune.modifier];
  const meta = row.attached ? MARK_ATTACHED : linkMark(row.rune.modifier);
  drawText(ctx, meta, rect.x + rect.w - TEXT_PAD_X, baseline, m, row.attached ? COLOR_SELECTED : COLOR_DIM, "right");
  const maxWidth = rect.w - textWidth(meta, m) - TEXT_PAD_X * 3;
  drawText(ctx, truncateText(def.name, maxWidth, m), rect.x + TEXT_PAD_X, baseline, m, blocked ? COLOR_EMPTY : def.color);
}

/** 型替え符（リンク 2 本）だけ本数を出す */
function linkMark(key: keyof typeof MODIFIERS): string {
  const cost = modifierLinkCost(key);
  return cost > 1 ? `◆${cost}` : "";
}

/** 刻印符のツールチップ: 名前・選択中の石での効果・リンク本数・付けられない理由 */
export function runeTooltipLines(state: GameState, ui: InventoryUi, list: RuneListLayout): TipLine[] | null {
  const entry = list.entries.find((e) => e.rune.id === ui.runes.focusId);
  if (!entry) return null;
  const def = MODIFIERS[entry.rune.modifier];
  const stone = stoneInSlot(state.skills.profile, ui.skillSlot);
  const lines: TipLine[] = [{ text: `刻印符「${def.name}」`, color: def.color }];
  if (stone) lines.push({ text: modifierVerb(entry.rune.modifier, SKILL_DEFS[stone.skillKey]), color: COLOR_TEXT });
  else lines.push({ text: def.verb, color: COLOR_TEXT });
  lines.push({ text: `リンク ${modifierLinkCost(entry.rune.modifier)} 本を使う`, color: COLOR_DIM });
  const block = entryBlock(stone, entry);
  if (entry.attached) lines.push({ text: `スキル ${ui.skillSlot + 1} に付いている（決定で外す）`, color: COLOR_SELECTED });
  else if (block) lines.push({ text: RUNE_BLOCK_TEXT[block], color: COLOR_WARN });
  else lines.push({ text: `決定でスキル ${ui.skillSlot + 1} に付ける`, color: COLOR_SELECTED });
  return lines;
}
