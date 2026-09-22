import type { GameState } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import { formatAffix, isKeystoneKey, keystoneConflicts } from "../loot/affixes";
import { statsSummary } from "../loot/stats";
import { RARITY_COLOR, SLOTS, type Item, type Slot } from "../loot/types";
import { MODIFIERS, SKILL, SKILL_DEFS, castCooldown, formatVariant, resolveCast, stoneLabel } from "../skills/data";
import { findStone } from "../skills/persistence";
import type { SkillStone } from "../skills/types";
import { formatCooldown, slotModifierView } from "../system/skills";
import {
  CONTENT_Y,
  type InventoryLayout,
  type SkillSlotLayout,
  type StoneRowLayout,
  layoutSkills,
  tabRects,
  type InventoryUi,
  type Rect,
  type SlotLayout,
  type StashRowLayout,
  RIGHT_X,
  layoutInventory,
} from "../ui/inventory";
import { fitTooltip } from "./renderMath";

const FONT_SMALL = "bold 8px monospace";
const FONT_TITLE = "bold 10px monospace";

const COLOR_TEXT = "#e0e0e0";
const COLOR_DIM = "#808080";
const COLOR_BORDER = "#505050";
const COLOR_PANEL_BG = "rgba(12,12,18,0.94)";
const COLOR_OVERLAY = "rgba(0,0,0,0.55)";
const COLOR_HOVER_BG = "rgba(255,255,255,0.10)";
const COLOR_EMPTY = "#606060";

const FONT_TINY = "bold 6px monospace";
const FONT_ICON = "bold 10px monospace";
const COLOR_WARN = "#ff6060";

const LINE_H = 8;
const TINY_LINE_H = 6;
const TEXT_PAD_X = 2;
/** ツールチップは内容に合わせて上へ伸ばす。これを超えたら小さい文字にする */
const TOOLTIP_MAX_LINES = 12;
const TOOLTIP_PAD_Y = 3;
const ICON_OFFSET_X = 10;

/** 空きスロットに出すアイコン文字 */
const SLOT_ICON: Record<Slot, string> = {
  weapon: "†",
  gun: "⌐",
  armor: "▣",
  boots: "▙",
  ring: "○",
  amulet: "◊",
};

const TAB_LABEL: Record<InventoryUi["tab"], string> = { equipment: "EQUIPMENT", skills: "SKILLS" };
const COLOR_SKILL = SKILL.drop.stoneColor;
const COLOR_SELECTED = "#ffd75f";
const SKILL_ICON_SIZE = 20;
const SKILL_ICON_BASELINE = 14;
const SKILL_LINE1_Y = 10;
const SKILL_LINE2_Y = 19;
const SKILL_LINE3_Y = 27;
const PERCENT = 100;
const HINT_EQUIPMENT = "Click: equip/unequip  Shift+Click: salvage  Tab: skills";
const HINT_SKILLS = "Click stone: equip  Click slot: clear/select  Shift+Click: salvage  Tab: close";

interface TooltipLine {
  text: string;
  color: string;
}

function keystoneKeysOf(item: Item): string[] {
  const keys = item.affixes.filter((r) => isKeystoneKey(r.key)).map((r) => r.key);
  if (item.implicit && isKeystoneKey(item.implicit.key)) keys.push(item.implicit.key);
  return keys;
}

/**
 * item を装備した場合（装備中ならそのまま）の排他衝突のうち、item のキーストーンが絡むもの。
 * 同じスロットの現装備は置き換わる前提で除外する。
 */
function conflictLinesFor(state: GameState, item: Item): string[] {
  const own = keystoneKeysOf(item);
  if (own.length === 0) return [];
  const keys = [...own];
  for (const slot of SLOTS) {
    const eq = state.profile.equipment[slot];
    if (!eq || slot === item.slot) continue;
    keys.push(...keystoneKeysOf(eq));
  }
  return keystoneConflicts(keys)
    .filter((group) => group.some((d) => own.includes(d.key)))
    .map((group) => `! Conflict: ${group.map((d) => d.name).join(" vs ")}`);
}

/** 装備中の排他衝突（stats 表示の先頭に出す） */
function equippedConflictLines(state: GameState): string[] {
  const keys: string[] = [];
  for (const slot of SLOTS) {
    const eq = state.profile.equipment[slot];
    if (eq) keys.push(...keystoneKeysOf(eq));
  }
  return keystoneConflicts(keys).map((group) => `! Conflict: ${group.map((d) => d.name).join(" vs ")}`);
}

function findItemById(state: GameState, id: string | null): Item | null {
  if (!id) return null;
  for (const slot of SLOTS) {
    const item = state.profile.equipment[slot];
    if (item && item.id === id) return item;
  }
  return state.profile.stash.find((it) => it.id === id) ?? null;
}

/** ctx.measureText で幅を測り、収まらなければ末尾を "…" で切り詰める */
function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = text.slice(0, mid) + ellipsis;
    if (ctx.measureText(candidate).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? ellipsis : text.slice(0, lo) + ellipsis;
}

export function drawInventoryUi(ctx: CanvasRenderingContext2D, state: GameState, ui: InventoryUi): void {
  if (!ui.open) return;
  const layout = layoutInventory(state, ui);

  ctx.fillStyle = COLOR_OVERLAY;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  drawPanelFrame(ctx, layout, ui);
  if (ui.tab === "skills") {
    drawSkillsTab(ctx, state, layout, ui);
    return;
  }
  drawSlots(ctx, layout, ui);
  drawStash(ctx, layout, ui);
  drawTooltip(ctx, state, layout, ui);
  drawStatsSummary(ctx, state, layout);
  drawHint(ctx, layout);
}

function drawPanelFrame(ctx: CanvasRenderingContext2D, layout: InventoryLayout, ui: InventoryUi): void {
  const { panel } = layout;
  ctx.fillStyle = COLOR_PANEL_BG;
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
  ctx.strokeStyle = COLOR_BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(panel.x + 0.5, panel.y + 0.5, panel.w - 1, panel.h - 1);

  drawTabs(ctx, ui);

  if (ui.messageTimer > 0 && ui.message) {
    ctx.font = FONT_SMALL;
    ctx.textAlign = "right";
    ctx.fillStyle = "#ffd75f";
    ctx.fillText(truncateText(ctx, ui.message, panel.w / 2), panel.x + panel.w - TEXT_PAD_X, panel.y + 8);
  }
}

function drawTabs(ctx: CanvasRenderingContext2D, ui: InventoryUi): void {
  ctx.font = FONT_TITLE;
  ctx.textAlign = "center";
  for (const { tab, rect } of tabRects()) {
    const selected = ui.tab === tab;
    if (selected) {
      ctx.fillStyle = COLOR_HOVER_BG;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
    ctx.fillStyle = selected ? COLOR_TEXT : COLOR_DIM;
    ctx.fillText(TAB_LABEL[tab], rect.x + rect.w / 2, rect.y + rect.h - 1);
  }
}

function strokeRectPx(ctx: CanvasRenderingContext2D, r: Rect, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, r.w - 1, r.h - 1);
}

function drawSlots(ctx: CanvasRenderingContext2D, layout: InventoryLayout, ui: InventoryUi): void {
  for (const s of layout.slots) drawSlotRow(ctx, s, ui);
}

function drawSlotRow(ctx: CanvasRenderingContext2D, s: SlotLayout, ui: InventoryUi): void {
  const { rect } = s;
  if (ui.hoverSlot === s.slot) {
    ctx.fillStyle = COLOR_HOVER_BG;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  strokeRectPx(ctx, rect, COLOR_BORDER);

  ctx.font = FONT_SMALL;
  ctx.textAlign = "left";
  ctx.fillStyle = COLOR_DIM;
  const label = s.slot.toUpperCase();
  ctx.fillText(label, rect.x + TEXT_PAD_X, rect.y + rect.h / 2 + 3);

  const labelWidth = ctx.measureText(label).width;
  const nameMaxWidth = rect.w - labelWidth - TEXT_PAD_X * 3;
  ctx.textAlign = "right";
  if (s.item) {
    ctx.fillStyle = RARITY_COLOR[s.item.rarity];
    ctx.fillText(truncateText(ctx, s.item.name, nameMaxWidth), rect.x + rect.w - TEXT_PAD_X, rect.y + rect.h / 2 + 3);
  } else {
    const right = rect.x + rect.w - TEXT_PAD_X;
    ctx.fillStyle = COLOR_EMPTY;
    ctx.fillText("empty", right - ICON_OFFSET_X, rect.y + rect.h / 2 + 3);
    ctx.font = FONT_ICON;
    ctx.textAlign = "center";
    ctx.fillText(SLOT_ICON[s.slot], right - ICON_OFFSET_X / 2 + 1, rect.y + rect.h / 2 + 4);
  }
}

function drawStash(ctx: CanvasRenderingContext2D, layout: InventoryLayout, ui: InventoryUi): void {
  if (layout.stashOrder.length === 0) {
    ctx.font = FONT_SMALL;
    ctx.textAlign = "left";
    ctx.fillStyle = COLOR_DIM;
    ctx.fillText("stash is empty", RIGHT_X + TEXT_PAD_X, layout.tooltipRect.y - 4);
    return;
  }
  for (const row of layout.stashRows) drawStashRow(ctx, row, ui);
}

function drawStashRow(ctx: CanvasRenderingContext2D, row: StashRowLayout, ui: InventoryUi): void {
  const { rect, item } = row;
  if (ui.hoverItemId === item.id) {
    ctx.fillStyle = COLOR_HOVER_BG;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }

  ctx.font = FONT_SMALL;
  const meta = `${item.slot} L${item.itemLevel}`;
  ctx.textAlign = "right";
  ctx.fillStyle = COLOR_DIM;
  ctx.fillText(meta, rect.x + rect.w - TEXT_PAD_X, rect.y + rect.h / 2 + 3);
  const metaWidth = ctx.measureText(meta).width;

  ctx.textAlign = "left";
  ctx.fillStyle = RARITY_COLOR[item.rarity];
  const nameMaxWidth = rect.w - metaWidth - TEXT_PAD_X * 3;
  ctx.fillText(truncateText(ctx, item.name, nameMaxWidth), rect.x + TEXT_PAD_X, rect.y + rect.h / 2 + 3);
}

function tooltipLines(state: GameState, item: Item): TooltipLine[] {
  const lines: TooltipLine[] = [
    { text: item.name, color: RARITY_COLOR[item.rarity] },
    { text: `${item.baseKey}  L${item.itemLevel}`, color: COLOR_DIM },
  ];
  if (item.implicit) lines.push({ text: `Implicit: ${formatAffix(item.implicit)}`, color: COLOR_TEXT });
  for (const roll of item.affixes) lines.push({ text: `T${roll.tier} ${formatAffix(roll)}`, color: COLOR_TEXT });
  for (const text of conflictLinesFor(state, item)) lines.push({ text, color: COLOR_WARN });
  return lines;
}

/** 下端を tooltipRect に揃えたまま、行数に応じて上へ伸ばす */
function drawTooltip(ctx: CanvasRenderingContext2D, state: GameState, layout: InventoryLayout, ui: InventoryUi): void {
  const { tooltipRect } = layout;
  const item = findItemById(state, ui.hoverItemId);
  ctx.textAlign = "left";
  if (!item) {
    strokeRectPx(ctx, tooltipRect, COLOR_BORDER);
    ctx.font = FONT_SMALL;
    ctx.fillStyle = COLOR_DIM;
    ctx.fillText("Hover an item", tooltipRect.x + TEXT_PAD_X, tooltipRect.y + LINE_H);
    return;
  }

  const lines = tooltipLines(state, item);
  const bottom = tooltipRect.y + tooltipRect.h;
  const fit = fitTooltip(lines.length, LINE_H, TINY_LINE_H, TOOLTIP_MAX_LINES, bottom - CONTENT_Y, TOOLTIP_PAD_Y);
  const h = Math.max(tooltipRect.h, fit.height);
  const box = { x: tooltipRect.x, y: bottom - h, w: tooltipRect.w, h };
  ctx.fillStyle = COLOR_PANEL_BG;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  strokeRectPx(ctx, box, COLOR_BORDER);

  ctx.font = fit.small ? FONT_TINY : FONT_SMALL;
  const maxWidth = box.w - TEXT_PAD_X * 2;
  let y = box.y + fit.lineH;
  for (let i = 0; i < fit.shown; i++) {
    const line = lines[i];
    if (!line) break;
    ctx.fillStyle = line.color;
    ctx.fillText(truncateText(ctx, line.text, maxWidth), box.x + TEXT_PAD_X, y);
    y += fit.lineH;
  }
}

function drawStatsSummary(ctx: CanvasRenderingContext2D, state: GameState, layout: InventoryLayout): void {
  const { statsRect } = layout;
  strokeRectPx(ctx, statsRect, COLOR_BORDER);

  ctx.font = FONT_SMALL;
  ctx.textAlign = "left";
  ctx.fillStyle = COLOR_TEXT;
  const maxWidth = statsRect.w - TEXT_PAD_X * 2;
  const maxY = statsRect.y + statsRect.h - 2;

  const conflicts = equippedConflictLines(state);
  const lines = statsSummary(state.stats);
  let y = statsRect.y + LINE_H;
  for (const line of conflicts) {
    if (y > maxY) break;
    ctx.fillStyle = COLOR_WARN;
    ctx.fillText(truncateText(ctx, line, maxWidth), statsRect.x + TEXT_PAD_X, y);
    y += LINE_H;
  }
  ctx.fillStyle = COLOR_TEXT;
  if (lines.length === 0) {
    ctx.fillStyle = COLOR_DIM;
    ctx.fillText("stats", statsRect.x + TEXT_PAD_X, y);
    return;
  }
  for (const line of lines) {
    if (y > maxY) break;
    ctx.fillText(truncateText(ctx, line, maxWidth), statsRect.x + TEXT_PAD_X, y);
    y += LINE_H;
  }
}

function drawHint(ctx: CanvasRenderingContext2D, layout: InventoryLayout, text = HINT_EQUIPMENT): void {
  const { hintRect } = layout;
  ctx.font = FONT_SMALL;
  ctx.textAlign = "center";
  ctx.fillStyle = COLOR_DIM;
  ctx.fillText(
    truncateText(ctx, text, hintRect.w - TEXT_PAD_X * 2),
    hintRect.x + hintRect.w / 2,
    hintRect.y + hintRect.h / 2 + 3,
  );
}

// ---------------------------------------------------------------------------
// スキルタブ
// ---------------------------------------------------------------------------

function drawSkillsTab(ctx: CanvasRenderingContext2D, state: GameState, layout: InventoryLayout, ui: InventoryUi): void {
  const skills = layoutSkills(state, ui);
  for (const slot of skills.slots) drawSkillSlot(ctx, state, slot, ui);
  if (skills.stoneOrder.length === 0) {
    ctx.font = FONT_SMALL;
    ctx.textAlign = "left";
    ctx.fillStyle = COLOR_DIM;
    ctx.fillText("no skill stones", RIGHT_X + TEXT_PAD_X, CONTENT_Y + LINE_H);
  }
  for (const row of skills.rows) drawStoneRow(ctx, row, ui);
  drawSkillTooltip(ctx, state, layout, ui);
  drawSkillNotes(ctx, layout);
  drawHint(ctx, layout, HINT_SKILLS);
}

function drawSkillSlot(ctx: CanvasRenderingContext2D, state: GameState, s: SkillSlotLayout, ui: InventoryUi): void {
  const { rect } = s;
  if (ui.hoverSkillSlot === s.index) {
    ctx.fillStyle = COLOR_HOVER_BG;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  strokeRectPx(ctx, rect, ui.skillSlot === s.index ? COLOR_SELECTED : COLOR_BORDER);

  const iconX = rect.x + TEXT_PAD_X + 1;
  const iconY = rect.y + (rect.h - SKILL_ICON_SIZE) / 2;
  strokeRectPx(ctx, { x: iconX, y: iconY, w: SKILL_ICON_SIZE, h: SKILL_ICON_SIZE }, COLOR_BORDER);
  ctx.font = FONT_ICON;
  ctx.textAlign = "center";
  ctx.fillStyle = s.stone ? COLOR_SKILL : COLOR_EMPTY;
  const icon = s.stone ? SKILL_DEFS[s.stone.skillKey].icon : String(s.index + 1);
  ctx.fillText(icon, iconX + SKILL_ICON_SIZE / 2, iconY + SKILL_ICON_BASELINE);

  const textX = iconX + SKILL_ICON_SIZE + TEXT_PAD_X * 2;
  const maxWidth = rect.x + rect.w - textX - TEXT_PAD_X;
  ctx.textAlign = "left";
  ctx.font = FONT_SMALL;
  ctx.fillStyle = s.stone ? COLOR_SKILL : COLOR_EMPTY;
  const label = s.stone ? stoneLabel(s.stone) : `slot ${s.index + 1}: empty`;
  ctx.fillText(truncateText(ctx, label, maxWidth), textX, rect.y + SKILL_LINE1_Y);

  ctx.font = FONT_TINY;
  ctx.fillStyle = COLOR_DIM;
  ctx.fillText(`key ${s.index + 1}`, textX, rect.y + SKILL_LINE2_Y);
  let x = textX;
  for (const m of slotModifierView(state, s.index)) {
    const name = MODIFIERS[m.key].name;
    ctx.fillStyle = m.active ? MODIFIERS[m.key].color : COLOR_EMPTY;
    ctx.fillText(name, x, rect.y + SKILL_LINE3_Y);
    x += ctx.measureText(name).width + TEXT_PAD_X * 2;
  }
}

function drawStoneRow(ctx: CanvasRenderingContext2D, row: StoneRowLayout, ui: InventoryUi): void {
  const { rect, stone } = row;
  if (ui.hoverStoneId === stone.id) {
    ctx.fillStyle = COLOR_HOVER_BG;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  ctx.font = FONT_SMALL;
  const equipped = row.equippedSlot >= 0;
  const meta = equipped ? `[${row.equippedSlot + 1}]` : `D${stone.foundDepth}`;
  ctx.textAlign = "right";
  ctx.fillStyle = equipped ? COLOR_SELECTED : COLOR_DIM;
  ctx.fillText(meta, rect.x + rect.w - TEXT_PAD_X, rect.y + rect.h / 2 + 3);
  const metaWidth = ctx.measureText(meta).width;
  ctx.textAlign = "left";
  ctx.fillStyle = COLOR_SKILL;
  const maxWidth = rect.w - metaWidth - TEXT_PAD_X * 3;
  ctx.fillText(truncateText(ctx, stoneLabel(stone), maxWidth), rect.x + TEXT_PAD_X, rect.y + rect.h / 2 + 3);
}

/** 石のツールチップ: 動詞・タグ・CD・リンク・変異軸・装着中の刻印符 */
function stoneTooltipLines(state: GameState, stone: SkillStone): TooltipLine[] {
  const def = SKILL_DEFS[stone.skillKey];
  const slot = state.skills.profile.loadout.indexOf(stone.id);
  const modifiers = slot >= 0 ? (state.skills.slots[slot]?.modifiers ?? []) : [];
  const cd = castCooldown(def, resolveCast(def, stone, modifiers));
  const linkPenalty = Math.round(stone.links * SKILL.linkCooldownPenalty * PERCENT);
  const lines: TooltipLine[] = [
    { text: stoneLabel(stone), color: COLOR_SKILL },
    { text: def.verb, color: COLOR_TEXT },
    { text: `${def.tags.join(" / ")}  CD ${formatCooldown(cd)}`, color: COLOR_DIM },
    { text: `Links ${stone.links} (base CD +${linkPenalty}%)`, color: COLOR_TEXT },
  ];
  if (stone.variants.length === 0) lines.push({ text: "No variant", color: COLOR_DIM });
  for (const v of stone.variants) lines.push({ text: formatVariant(v), color: COLOR_TEXT });
  if (slot < 0) return lines;
  for (const m of slotModifierView(state, slot)) {
    const d = MODIFIERS[m.key];
    lines.push({ text: `${m.active ? "+" : "x"} ${d.name}: ${d.verb}`, color: m.active ? d.color : COLOR_EMPTY });
  }
  return lines;
}

function drawSkillTooltip(ctx: CanvasRenderingContext2D, state: GameState, layout: InventoryLayout, ui: InventoryUi): void {
  const { tooltipRect } = layout;
  const stone = findStone(state.skills.profile, ui.hoverStoneId);
  ctx.textAlign = "left";
  if (!stone) {
    strokeRectPx(ctx, tooltipRect, COLOR_BORDER);
    ctx.font = FONT_SMALL;
    ctx.fillStyle = COLOR_DIM;
    ctx.fillText("Hover a skill stone", tooltipRect.x + TEXT_PAD_X, tooltipRect.y + LINE_H);
    return;
  }
  const lines = stoneTooltipLines(state, stone);
  const bottom = tooltipRect.y + tooltipRect.h;
  const fit = fitTooltip(lines.length, LINE_H, TINY_LINE_H, TOOLTIP_MAX_LINES, bottom - CONTENT_Y, TOOLTIP_PAD_Y);
  const h = Math.max(tooltipRect.h, fit.height);
  const box = { x: tooltipRect.x, y: bottom - h, w: tooltipRect.w, h };
  ctx.fillStyle = COLOR_PANEL_BG;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  strokeRectPx(ctx, box, COLOR_BORDER);
  ctx.font = fit.small ? FONT_TINY : FONT_SMALL;
  let y = box.y + fit.lineH;
  for (let i = 0; i < fit.shown; i++) {
    const line = lines[i];
    if (!line) break;
    ctx.fillStyle = line.color;
    ctx.fillText(truncateText(ctx, line.text, box.w - TEXT_PAD_X * 2), box.x + TEXT_PAD_X, y);
    y += fit.lineH;
  }
}

/** 右下: 刻印符とリンクの説明 */
function drawSkillNotes(ctx: CanvasRenderingContext2D, layout: InventoryLayout): void {
  const { statsRect } = layout;
  strokeRectPx(ctx, statsRect, COLOR_BORDER);
  ctx.font = FONT_SMALL;
  ctx.textAlign = "left";
  ctx.fillStyle = COLOR_DIM;
  const maxWidth = statsRect.w - TEXT_PAD_X * 2;
  const lines = [
    "Runes last one run. Touch one to link it",
    "to an equipped skill (oldest is pushed out).",
    "More links = longer base cooldown.",
    "Keys: 1/C/Mouse Back, 2/V/Mouse Forward",
  ];
  let y = statsRect.y + LINE_H;
  for (const line of lines) {
    ctx.fillText(truncateText(ctx, line, maxWidth), statsRect.x + TEXT_PAD_X, y);
    y += LINE_H;
  }
}
