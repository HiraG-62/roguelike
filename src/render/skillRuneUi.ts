import type { GameState } from "../core/state";
import { MODIFIERS, SKILL, SKILL_DEFS, modifierLinkCost, modifierVerb, slotLinks } from "../skills/data";
import { stoneInSlot } from "../skills/persistence";
import type { ModifierKey } from "../skills/types";
import { usedLinks } from "../system/skills";
import type { InventoryUi } from "../ui/inventory";
import { type RuneListLayout, type RuneRowLayout, RUNE_BLOCK_TEXT, moveTarget } from "../ui/skillRunes";
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
 * 選択中スロットのラン内の刻印符を並べる。効かない符（相性・リンク不足）は暗く出す。
 * 刻印符は探索ごとに拾い直す物なので、拠点では空
 */

const COLOR_RUNE = SKILL.drop.runeColor;
const MARK_GRANTED = "祝福";
const COLOR_HEADER_LINE = "#404040";

export function drawRuneColumn(ctx: CanvasRenderingContext2D, state: GameState, list: RuneListLayout, ui: InventoryUi): void {
  drawRuneHeader(ctx, state, list, ui);
  if (list.entries.length === 0) {
    const m = TEXT.SMALL;
    drawText(ctx, "刻印符なし", list.header.x + TEXT_PAD_X, list.header.y + list.header.h + bodyLineH(), m, COLOR_DIM);
    return;
  }
  for (const row of list.rows) drawRuneRow(ctx, row, ui);
}

function drawRuneHeader(ctx: CanvasRenderingContext2D, state: GameState, list: RuneListLayout, ui: InventoryUi): void {
  const { header } = list;
  const m = TEXT.SMALL;
  const baseline = header.y + header.h / 2 + ROW_BASELINE_OFFSET;
  const count = `リンク ${usedLinks(state.skills, ui.skillSlot)}/${slotLinks(ui.skillSlot)}`;
  drawText(ctx, count, header.x + header.w - TEXT_PAD_X, baseline, m, COLOR_DIM, "right");
  // 対象は黄色の枠のスロットで分かるので見出しには出さない
  const label = "刻印符";
  const maxWidth = header.w - textWidth(count, m) - TEXT_PAD_X * 3;
  drawText(ctx, truncateText(label, maxWidth, m), header.x + TEXT_PAD_X, baseline, m, COLOR_RUNE);
  fillRectPx(ctx, { x: header.x, y: header.y + header.h - 1, w: header.w, h: 1 }, COLOR_HEADER_LINE);
}

function drawRuneRow(ctx: CanvasRenderingContext2D, row: RuneRowLayout, ui: InventoryUi): void {
  const { rect } = row;
  const focused = ui.runes.focusKey === row.key || (ui.runes.focusKey === null && ui.runes.cursor === row.index);
  if (focused) fillRectPx(ctx, rect, COLOR_HOVER_BG);
  const m = TEXT.SMALL;
  const baseline = rect.y + rect.h / 2 + ROW_BASELINE_OFFSET;
  const def = MODIFIERS[row.key];
  const meta = row.run ? linkMark(row.key) : MARK_GRANTED;
  drawText(ctx, meta, rect.x + rect.w - TEXT_PAD_X, baseline, m, COLOR_DIM, "right");
  const maxWidth = rect.w - textWidth(meta, m) - TEXT_PAD_X * 3;
  drawText(ctx, truncateText(def.name, maxWidth, m), rect.x + TEXT_PAD_X, baseline, m, row.active ? def.color : COLOR_EMPTY);
}

/** 型替え符（リンク 2 本）だけ本数を出す */
function linkMark(key: ModifierKey): string {
  const cost = modifierLinkCost(key);
  return cost > 1 ? `◆${cost}` : "";
}

/** 刻印符のツールチップ: 名前・選択中の石での効果・リンク本数・移す先 / 効かない理由 */
export function runeTooltipLines(state: GameState, ui: InventoryUi, list: RuneListLayout): TipLine[] | null {
  const entry = list.entries.find((e) => e.key === ui.runes.focusKey);
  if (!entry) return null;
  const def = MODIFIERS[entry.key];
  const stone = stoneInSlot(state.skills.profile, ui.skillSlot);
  const lines: TipLine[] = [{ text: `刻印符「${def.name}」`, color: def.color }];
  if (stone) lines.push({ text: modifierVerb(entry.key, SKILL_DEFS[stone.skillKey]), color: COLOR_TEXT });
  else lines.push({ text: def.verb, color: COLOR_TEXT });
  lines.push({ text: `必要なリンク ${modifierLinkCost(entry.key)} 本`, color: COLOR_DIM });
  if (!entry.active) lines.push({ text: "今は効いていません（相性かリンクの不足）", color: COLOR_WARN });
  lines.push(moveLine(state, ui.skillSlot, entry.key, entry.run));
  return lines;
}

/** 決定で何が起きるか。祝福の符は動かせず、移せるスロットが無ければそう書く */
function moveLine(state: GameState, slot: number, key: ModifierKey, run: boolean): TipLine {
  if (!run) return { text: RUNE_BLOCK_TEXT.granted, color: COLOR_DIM };
  const to = moveTarget(state, slot, key);
  if (to === null) return { text: RUNE_BLOCK_TEXT.noTarget, color: COLOR_WARN };
  return { text: `決定でスキル ${to + 1} へ移す`, color: COLOR_SELECTED };
}
