import type { GameState } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import { formatAffix, isConversionKey, isKeystoneKey, isMarkerKey, keystoneConflicts } from "../loot/affixes";
import { CRAFT_COSTS, craftBlockReason, type CraftOp, type Currency } from "../loot/crafting";
import { statsSummary } from "../loot/stats";
import { RARITY_COLOR, SLOTS, type AffixRoll, type Item, type Slot } from "../loot/types";
import { MODIFIERS, SKILL, SKILL_DEFS, castCooldown, formatVariant, resolveCast, stoneLabel } from "../skills/data";
import { findStone } from "../skills/persistence";
import type { SkillStone } from "../skills/types";
import { formatCooldown, slotModifierView } from "../system/skills";
import {
  CONTENT_Y,
  CURRENCY_BLOCK_H,
  type CraftButtonLayout,
  type CurrencyRowLayout,
  layoutCraft,
  selectedCraftItem,
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
import { uiFont } from "./font";

const FONT_SMALL = uiFont(8);
const FONT_TITLE = uiFont(10);

const COLOR_TEXT = "#e0e0e0";
const COLOR_DIM = "#808080";
const COLOR_BORDER = "#505050";
const COLOR_PANEL_BG = "rgba(12,12,18,0.94)";
const COLOR_OVERLAY = "rgba(0,0,0,0.55)";
const COLOR_HOVER_BG = "rgba(255,255,255,0.10)";
const COLOR_EMPTY = "#606060";

const FONT_TINY = uiFont(6);
const FONT_ICON = uiFont(10);
const COLOR_WARN = "#ff6060";

const LINE_H = 8;
const TINY_LINE_H = 6;
const TEXT_PAD_X = 2;
/** ツールチップは内容に合わせて上へ伸ばす。これを超えたら小さい文字にする */
const TOOLTIP_MAX_LINES = 12;
const TOOLTIP_PAD_Y = 3;
const ICON_OFFSET_X = 10;
/** 装備スロット・stash 行の左端に出すレアリティ色の帯の幅 */
const RARITY_STRIP_W = 2;
/** 装備スロットの背景にうっすら敷くレアリティ色の不透明度 */
const RARITY_BG_ALPHA = 0.1;
/** 二重枠の内側の不透明度 */
const RARITY_INNER_ALPHA = 0.45;

/** 空きスロットに出すアイコン文字 */
const SLOT_ICON: Record<Slot, string> = {
  weapon: "†",
  gun: "⌐",
  armor: "▣",
  boots: "▙",
  ring: "○",
  amulet: "◊",
};

const TAB_LABEL: Record<InventoryUi["tab"], string> = { equipment: "EQUIPMENT", skills: "SKILLS", craft: "CRAFT" };
const COLOR_SKILL = SKILL.drop.stoneColor;
const COLOR_SELECTED = "#ffd75f";
const SKILL_ICON_SIZE = 20;
const SKILL_ICON_BASELINE = 14;
const SKILL_LINE1_Y = 10;
const SKILL_LINE2_Y = 19;
const SKILL_LINE3_Y = 27;
const PERCENT = 100;
const HINT_EQUIPMENT = "Click: equip/unequip  Shift+Click: salvage (currency)  Tab: skills";
const HINT_SKILLS = "Click stone: equip  Click slot: clear/select  Shift+Click: salvage  Tab: craft";
const HINT_CRAFT = "Click item: select  Click button: craft  Fuse: then click a 2nd item  Tab: close";
const COLOR_CONVERSION = "#7fe0ff";
const COLOR_DISABLED_BG = "rgba(255,255,255,0.03)";
const COLOR_BUTTON_BG = "rgba(255,255,255,0.08)";
const CRAFT_LABEL_BASELINE = 8;
const CRAFT_COST_BASELINE = 14;
const CURRENCY_BASELINE_INSET = 2;

const CURRENCY_COLOR: Readonly<Record<Currency, string>> = {
  dust: "#c8c8c8",
  shard: "#6a8cff",
  essence: "#ffd75f",
  relic: "#ff9040",
};
const CURRENCY_SOURCE: Readonly<Record<Currency, string>> = {
  dust: "salvage normal",
  shard: "salvage magic",
  essence: "salvage rare",
  relic: "salvage unique",
};

const CRAFT_LABEL: Readonly<Record<CraftOp, string>> = {
  reforge: "Reforge",
  augment: "Augment",
  annul: "Annul",
  corrupt: "Corrupt",
  fuse: "Fuse",
};
/** 動詞で語る（何が起きて何を失うか） */
const CRAFT_VERB: Readonly<Record<CraftOp, string>> = {
  reforge: "Rerolls every modifier. Tiers are capped by item level.",
  augment: "Adds one modifier to an open slot (may be a trigger).",
  annul: "Removes one modifier at random.",
  corrupt: "Keystone, conversion, tiers up with one inverted, or nothing. Final.",
  fuse: "Merges two same-slot items into one with one fewer modifier.",
};
const FUSE_PENDING_TEXT = "Fuse: click a second item of the same slot";

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
  if (ui.tab === "craft") {
    drawCraftTab(ctx, state, layout, ui);
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
  drawSlotFrame(ctx, rect, s.item);

  ctx.font = FONT_SMALL;
  ctx.textAlign = "left";
  ctx.fillStyle = COLOR_DIM;
  const label = s.slot.toUpperCase();
  ctx.fillText(label, rect.x + TEXT_PAD_X + (s.item ? RARITY_STRIP_W : 0), rect.y + rect.h / 2 + 3);

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

/** 装備中はレアリティ色の二重枠 + 左端の帯 + 薄い背景。空きは灰色の枠だけ */
function drawSlotFrame(ctx: CanvasRenderingContext2D, rect: Rect, item: Item | null | undefined): void {
  if (!item) {
    strokeRectPx(ctx, rect, COLOR_BORDER);
    return;
  }
  const color = RARITY_COLOR[item.rarity];
  ctx.globalAlpha = RARITY_BG_ALPHA;
  ctx.fillStyle = color;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.globalAlpha = RARITY_INNER_ALPHA;
  strokeRectPx(ctx, { x: rect.x + 1, y: rect.y + 1, w: rect.w - 2, h: rect.h - 2 }, color);
  ctx.globalAlpha = 1;
  strokeRectPx(ctx, rect, color);
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(rect.x) + 1, Math.round(rect.y) + 1, RARITY_STRIP_W, rect.h - 2);
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
  ctx.fillRect(Math.round(rect.x), Math.round(rect.y) + 1, RARITY_STRIP_W, rect.h - 2);
  const nameX = rect.x + TEXT_PAD_X + RARITY_STRIP_W;
  const nameMaxWidth = rect.w - metaWidth - TEXT_PAD_X * 3 - RARITY_STRIP_W;
  ctx.fillText(truncateText(ctx, item.name, nameMaxWidth), nameX, rect.y + rect.h / 2 + 3);
}

function tooltipLines(state: GameState, item: Item): TooltipLine[] {
  const lines: TooltipLine[] = [
    { text: item.name, color: RARITY_COLOR[item.rarity] },
    { text: `${item.baseKey}  L${item.itemLevel}`, color: COLOR_DIM },
  ];
  if (item.implicit) lines.push({ text: `Implicit: ${formatAffix(item.implicit)}`, color: COLOR_TEXT });
  for (const roll of item.affixes) lines.push(affixLine(roll));
  for (const text of conflictLinesFor(state, item)) lines.push({ text, color: COLOR_WARN });
  return lines;
}

/** マーカー（Corrupted）は警告色・tier なし、変換は専用色 */
function affixLine(roll: AffixRoll): TooltipLine {
  if (isMarkerKey(roll.key)) return { text: formatAffix(roll), color: COLOR_WARN };
  const color = isConversionKey(roll.key) ? COLOR_CONVERSION : COLOR_TEXT;
  return { text: `T${roll.tier} ${formatAffix(roll)}`, color };
}

/** 下端を tooltipRect に揃えたまま、行数に応じて上へ伸ばす */
function drawTooltip(ctx: CanvasRenderingContext2D, state: GameState, layout: InventoryLayout, ui: InventoryUi): void {
  drawItemTooltip(ctx, state, layout.tooltipRect, findItemById(state, ui.hoverItemId), CONTENT_Y, "Hover an item");
}

/** item のツールチップ。上端は topLimit まで伸ばせる */
function drawItemTooltip(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  tooltipRect: Rect,
  item: Item | null,
  topLimit: number,
  emptyText: string,
): void {
  ctx.textAlign = "left";
  if (!item) {
    strokeRectPx(ctx, tooltipRect, COLOR_BORDER);
    ctx.font = FONT_SMALL;
    ctx.fillStyle = COLOR_DIM;
    ctx.fillText(emptyText, tooltipRect.x + TEXT_PAD_X, tooltipRect.y + LINE_H);
    return;
  }

  const lines = tooltipLines(state, item);
  const bottom = tooltipRect.y + tooltipRect.h;
  const fit = fitTooltip(lines.length, LINE_H, TINY_LINE_H, TOOLTIP_MAX_LINES, bottom - topLimit, TOOLTIP_PAD_Y);
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

// ---------------------------------------------------------------------------
// クラフトタブ
// ---------------------------------------------------------------------------

function drawCraftTab(ctx: CanvasRenderingContext2D, state: GameState, layout: InventoryLayout, ui: InventoryUi): void {
  const craftLayout = layoutCraft();
  const selected = selectedCraftItem(state, ui);
  drawCurrencies(ctx, ui, craftLayout.currencies);
  drawStash(ctx, layout, ui);
  if (selected) drawSelectedMarker(ctx, layout, selected);
  const shown = findItemById(state, ui.hoverItemId) ?? selected;
  drawItemTooltip(ctx, state, layout.tooltipRect, shown, CONTENT_Y + CURRENCY_BLOCK_H, "Select an item");
  for (const button of craftLayout.buttons) drawCraftButton(ctx, ui, button, selected);
  drawCraftStatus(ctx, layout, ui, craftLayout.statusY, craftLayout.resultY);
  drawHint(ctx, layout, HINT_CRAFT);
}

function drawCurrencies(ctx: CanvasRenderingContext2D, ui: InventoryUi, rows: readonly CurrencyRowLayout[]): void {
  ctx.font = FONT_SMALL;
  for (const { currency, rect } of rows) {
    const baseline = rect.y + rect.h - CURRENCY_BASELINE_INSET;
    ctx.textAlign = "left";
    ctx.fillStyle = CURRENCY_COLOR[currency];
    ctx.fillText(`${currency.toUpperCase()} ${ui.craft.save.wallet[currency]}`, rect.x + TEXT_PAD_X, baseline);
    ctx.textAlign = "right";
    ctx.fillStyle = COLOR_DIM;
    ctx.fillText(CURRENCY_SOURCE[currency], rect.x + rect.w - TEXT_PAD_X, baseline);
  }
}

function drawSelectedMarker(ctx: CanvasRenderingContext2D, layout: InventoryLayout, selected: Item): void {
  const row = layout.stashRows.find((r) => r.item.id === selected.id);
  if (row) strokeRectPx(ctx, row.rect, COLOR_SELECTED);
}

/** 通貨が足りない / 対象が無い / corrupted の操作は灰色 */
function drawCraftButton(
  ctx: CanvasRenderingContext2D,
  ui: InventoryUi,
  button: CraftButtonLayout,
  selected: Item | null,
): void {
  const { op, rect } = button;
  const enabled = craftBlockReason(ui.craft.save.wallet, op, selected) === null;
  const active = op === "fuse" && ui.craft.fusePending;
  ctx.fillStyle = enabled ? COLOR_BUTTON_BG : COLOR_DISABLED_BG;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  if (enabled && ui.craft.hoverOp === op) {
    ctx.fillStyle = COLOR_HOVER_BG;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  strokeRectPx(ctx, rect, active ? COLOR_SELECTED : COLOR_BORDER);

  const cost = CRAFT_COSTS[op];
  const centerX = rect.x + rect.w / 2;
  ctx.textAlign = "center";
  ctx.font = FONT_SMALL;
  ctx.fillStyle = enabled ? COLOR_TEXT : COLOR_EMPTY;
  ctx.fillText(CRAFT_LABEL[op], centerX, rect.y + CRAFT_LABEL_BASELINE);
  ctx.font = FONT_TINY;
  const canPay = ui.craft.save.wallet[cost.currency] >= cost.amount;
  ctx.fillStyle = canPay ? CURRENCY_COLOR[cost.currency] : COLOR_EMPTY;
  ctx.fillText(`${cost.amount} ${cost.currency}`, centerX, rect.y + CRAFT_COST_BASELINE);
}

/** 状態行（ホバー中の操作の説明 / Fuse の選択待ち）と直前の結果 */
function drawCraftStatus(
  ctx: CanvasRenderingContext2D,
  layout: InventoryLayout,
  ui: InventoryUi,
  statusY: number,
  resultY: number,
): void {
  const { statsRect } = layout;
  const maxWidth = statsRect.w - TEXT_PAD_X * 2;
  const hover = ui.craft.hoverOp;
  const status = hover !== null ? CRAFT_VERB[hover] : ui.craft.fusePending ? FUSE_PENDING_TEXT : "";
  ctx.textAlign = "left";
  ctx.font = FONT_TINY;
  ctx.fillStyle = COLOR_DIM;
  ctx.fillText(truncateText(ctx, status, maxWidth), statsRect.x + TEXT_PAD_X, statusY);
  if (!ui.craft.result) return;
  ctx.font = FONT_SMALL;
  ctx.fillStyle = COLOR_SELECTED;
  ctx.fillText(truncateText(ctx, ui.craft.result, maxWidth), statsRect.x + TEXT_PAD_X, resultY);
}
