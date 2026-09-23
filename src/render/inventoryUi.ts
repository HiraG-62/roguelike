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
  CURRENCY_LABEL,
  type CraftButtonLayout,
  type CurrencyRowLayout,
  layoutCraft,
  selectedCraftItem,
  type InventoryLayout,
  SLOT_LABEL,
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
import { TEXT, drawText, textLineHeight, textWidth, truncateText } from "./pixelText";

const COLOR_TEXT = "#e0e0e0";
const COLOR_DIM = "#808080";
const COLOR_BORDER = "#505050";
const COLOR_PANEL_BG = "rgba(12,12,18,0.94)";
const COLOR_OVERLAY = "rgba(0,0,0,0.55)";
const COLOR_HOVER_BG = "rgba(255,255,255,0.10)";
const COLOR_EMPTY = "#606060";

const COLOR_WARN = "#ff6060";

/** 行高の下限（ドット文字の行高がこれより大きければそちらを使う） */
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

const TAB_LABEL: Record<InventoryUi["tab"], string> = { equipment: "装備", skills: "スキル", craft: "鍛冶" };
const COLOR_SKILL = SKILL.drop.stoneColor;
const COLOR_SELECTED = "#ffd75f";
const SKILL_ICON_SIZE = 20;
const SKILL_ICON_BASELINE = 14;
const SKILL_LINE1_Y = 10;
const SKILL_LINE2_Y = 19;
const SKILL_LINE3_Y = 27;
const PERCENT = 100;
const HINT_EQUIPMENT = "クリック: 装備/解除  Shift+クリック: 分解（通貨化）  Tab: スキルへ";
const HINT_SKILLS = "石をクリック: 装着  スロットをクリック: 解除/選択  Shift+クリック: 分解  Tab: 鍛冶へ";
const HINT_CRAFT = "アイテムをクリック: 選択  ボタンをクリック: 実行  融合: 続けて 2 つ目をクリック  Tab: 閉じる";
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
  dust: "通常の分解で入手",
  shard: "魔法の分解で入手",
  essence: "希少の分解で入手",
  relic: "固有の分解で入手",
};

const CRAFT_LABEL: Readonly<Record<CraftOp, string>> = {
  reforge: "再鍛造",
  augment: "付与",
  annul: "消去",
  corrupt: "侵蝕",
  fuse: "融合",
};
/** 動詞で語る（何が起きて何を失うか） */
const CRAFT_VERB: Readonly<Record<CraftOp, string>> = {
  reforge: "全ての modifier を振り直す。tier の上限はアイテムレベルまで。",
  augment: "空いた枠に modifier を 1 つ追加する（トリガーの場合もある）。",
  annul: "modifier を 1 つランダムに削除する。",
  corrupt: "キーストーン・変換・tier 上昇（1 つは反転）・変化なし、のいずれか。取り消し不可。",
  fuse: "同じ部位の 2 つを、modifier が 1 つ少ない状態で 1 つに統合する。",
};
const FUSE_PENDING_TEXT = "融合: 同じ部位の 2 つ目のアイテムをクリック";

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
    .map((group) => `排他グループが競合: ${group.map((d) => d.name).join(" と ")}`);
}

/** 装備中の排他衝突（stats 表示の先頭に出す） */
function equippedConflictLines(state: GameState): string[] {
  const keys: string[] = [];
  for (const slot of SLOTS) {
    const eq = state.profile.equipment[slot];
    if (eq) keys.push(...keystoneKeysOf(eq));
  }
  return keystoneConflicts(keys).map((group) => `排他グループが競合: ${group.map((d) => d.name).join(" と ")}`);
}

function findItemById(state: GameState, id: string | null): Item | null {
  if (!id) return null;
  for (const slot of SLOTS) {
    const item = state.profile.equipment[slot];
    if (item && item.id === id) return item;
  }
  return state.profile.stash.find((it) => it.id === id) ?? null;
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
    const m = TEXT.SMALL;
    drawText(ctx, truncateText(ui.message, panel.w / 2, m), panel.x + panel.w - TEXT_PAD_X, panel.y + 8, m, COLOR_SELECTED, "right");
  }
}

function drawTabs(ctx: CanvasRenderingContext2D, ui: InventoryUi): void {
  for (const { tab, rect } of tabRects()) {
    const selected = ui.tab === tab;
    if (selected) {
      ctx.fillStyle = COLOR_HOVER_BG;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
    drawText(ctx, TAB_LABEL[tab], rect.x + rect.w / 2, rect.y + rect.h - 1, TEXT.BODY, selected ? COLOR_TEXT : COLOR_DIM, "center");
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

  const m = TEXT.SMALL;
  const baseline = rect.y + rect.h / 2 + 3;
  const label = SLOT_LABEL[s.slot];
  drawText(ctx, label, rect.x + TEXT_PAD_X + (s.item ? RARITY_STRIP_W : 0), baseline, m, COLOR_DIM);

  const labelWidth = textWidth(label, m);
  const nameMaxWidth = rect.w - labelWidth - TEXT_PAD_X * 3;
  if (s.item) {
    drawText(ctx, truncateText(s.item.name, nameMaxWidth, m), rect.x + rect.w - TEXT_PAD_X, baseline, m, RARITY_COLOR[s.item.rarity], "right");
  } else {
    const right = rect.x + rect.w - TEXT_PAD_X;
    drawText(ctx, "― 空 ―", right - ICON_OFFSET_X, baseline, m, COLOR_EMPTY, "right");
    drawText(ctx, SLOT_ICON[s.slot], right - ICON_OFFSET_X / 2 + 1, rect.y + rect.h / 2 + 4, TEXT.BODY, COLOR_EMPTY, "center");
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
    drawText(ctx, "倉庫は空です", RIGHT_X + TEXT_PAD_X, layout.tooltipRect.y - 4, TEXT.SMALL, COLOR_DIM);
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

  const m = TEXT.SMALL;
  const baseline = rect.y + rect.h / 2 + 3;
  const meta = `${SLOT_LABEL[item.slot]} L${item.itemLevel}`;
  drawText(ctx, meta, rect.x + rect.w - TEXT_PAD_X, baseline, m, COLOR_DIM, "right");
  const metaWidth = textWidth(meta, m);

  const rarityColor = RARITY_COLOR[item.rarity];
  ctx.fillStyle = rarityColor;
  ctx.fillRect(Math.round(rect.x), Math.round(rect.y) + 1, RARITY_STRIP_W, rect.h - 2);
  const nameX = rect.x + TEXT_PAD_X + RARITY_STRIP_W;
  const nameMaxWidth = rect.w - metaWidth - TEXT_PAD_X * 3 - RARITY_STRIP_W;
  drawText(ctx, truncateText(item.name, nameMaxWidth, m), nameX, baseline, m, rarityColor);
}

function tooltipLines(state: GameState, item: Item): TooltipLine[] {
  const lines: TooltipLine[] = [
    { text: item.name, color: RARITY_COLOR[item.rarity] },
    { text: `${item.baseKey}  L${item.itemLevel}`, color: COLOR_DIM },
  ];
  if (item.implicit) lines.push({ text: `固有: ${formatAffix(item.implicit)}`, color: COLOR_TEXT });
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

/** 本文の行高（論理 px）。ドット文字の行高と定数の大きい方 */
function bodyLineH(): number {
  return Math.max(LINE_H, textLineHeight(TEXT.SMALL));
}

/** 下端を tooltipRect に揃えたまま、行数に応じて上へ伸ばす */
function drawTooltip(ctx: CanvasRenderingContext2D, state: GameState, layout: InventoryLayout, ui: InventoryUi): void {
  drawItemTooltip(ctx, state, layout.tooltipRect, findItemById(state, ui.hoverItemId), CONTENT_Y, "アイテムにカーソルを合わせる");
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
  if (!item) {
    strokeRectPx(ctx, tooltipRect, COLOR_BORDER);
    drawText(ctx, emptyText, tooltipRect.x + TEXT_PAD_X, tooltipRect.y + bodyLineH(), TEXT.SMALL, COLOR_DIM);
    return;
  }
  drawTooltipBox(ctx, tooltipRect, tooltipLines(state, item), topLimit);
}

/** 行を下端揃えのボックスに描く。行数が多ければ fitTooltip の縮小行高に切り替え、入る分だけ出す */
function drawTooltipBox(ctx: CanvasRenderingContext2D, tooltipRect: Rect, lines: readonly TooltipLine[], topLimit: number): void {
  const m = TEXT.SMALL;
  const lineH = bodyLineH();
  const smallLineH = Math.max(TINY_LINE_H, textLineHeight(m));
  const bottom = tooltipRect.y + tooltipRect.h;
  const fit = fitTooltip(lines.length, lineH, smallLineH, TOOLTIP_MAX_LINES, bottom - topLimit, TOOLTIP_PAD_Y);
  const h = Math.max(tooltipRect.h, fit.height);
  const box = { x: tooltipRect.x, y: bottom - h, w: tooltipRect.w, h };
  ctx.fillStyle = COLOR_PANEL_BG;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  strokeRectPx(ctx, box, COLOR_BORDER);

  const maxWidth = box.w - TEXT_PAD_X * 2;
  let y = box.y + fit.lineH;
  for (let i = 0; i < fit.shown; i++) {
    const line = lines[i];
    if (!line) break;
    drawText(ctx, truncateText(line.text, maxWidth, m), box.x + TEXT_PAD_X, y, m, line.color);
    y += fit.lineH;
  }
}

function drawStatsSummary(ctx: CanvasRenderingContext2D, state: GameState, layout: InventoryLayout): void {
  const { statsRect } = layout;
  strokeRectPx(ctx, statsRect, COLOR_BORDER);

  const m = TEXT.SMALL;
  const lineH = bodyLineH();
  const x = statsRect.x + TEXT_PAD_X;
  const maxWidth = statsRect.w - TEXT_PAD_X * 2;
  const maxY = statsRect.y + statsRect.h - 2;

  const conflicts = equippedConflictLines(state);
  const lines = statsSummary(state.stats);
  let y = statsRect.y + lineH;
  for (const line of conflicts) {
    if (y > maxY) break;
    drawText(ctx, truncateText(line, maxWidth, m), x, y, m, COLOR_WARN);
    y += lineH;
  }
  if (lines.length === 0) {
    drawText(ctx, "ステータス", x, y, m, COLOR_DIM);
    return;
  }
  for (const line of lines) {
    if (y > maxY) break;
    drawText(ctx, truncateText(line, maxWidth, m), x, y, m, COLOR_TEXT);
    y += lineH;
  }
}

function drawHint(ctx: CanvasRenderingContext2D, layout: InventoryLayout, text = HINT_EQUIPMENT): void {
  const { hintRect } = layout;
  const m = TEXT.SMALL;
  drawText(
    ctx,
    truncateText(text, hintRect.w - TEXT_PAD_X * 2, m),
    hintRect.x + hintRect.w / 2,
    hintRect.y + hintRect.h / 2 + 3,
    m,
    COLOR_DIM,
    "center",
  );
}

// ---------------------------------------------------------------------------
// スキルタブ
// ---------------------------------------------------------------------------

function drawSkillsTab(ctx: CanvasRenderingContext2D, state: GameState, layout: InventoryLayout, ui: InventoryUi): void {
  const skills = layoutSkills(state, ui);
  for (const slot of skills.slots) drawSkillSlot(ctx, state, slot, ui);
  if (skills.stoneOrder.length === 0) {
    drawText(ctx, "スキル石がありません", RIGHT_X + TEXT_PAD_X, CONTENT_Y + bodyLineH(), TEXT.SMALL, COLOR_DIM);
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
  const color = s.stone ? COLOR_SKILL : COLOR_EMPTY;
  const icon = s.stone ? SKILL_DEFS[s.stone.skillKey].icon : String(s.index + 1);
  drawText(ctx, icon, iconX + SKILL_ICON_SIZE / 2, iconY + SKILL_ICON_BASELINE, TEXT.BODY, color, "center");

  const m = TEXT.SMALL;
  const textX = iconX + SKILL_ICON_SIZE + TEXT_PAD_X * 2;
  const maxWidth = rect.x + rect.w - textX - TEXT_PAD_X;
  const label = s.stone ? stoneLabel(s.stone) : `スロット ${s.index + 1}: 空`;
  drawText(ctx, truncateText(label, maxWidth, m), textX, rect.y + SKILL_LINE1_Y, m, color);

  drawText(ctx, `キー ${s.index + 1}`, textX, rect.y + SKILL_LINE2_Y, m, COLOR_DIM);
  let x = textX;
  for (const mod of slotModifierView(state, s.index)) {
    const name = MODIFIERS[mod.key].name;
    drawText(ctx, name, x, rect.y + SKILL_LINE3_Y, m, mod.active ? MODIFIERS[mod.key].color : COLOR_EMPTY);
    x += textWidth(name, m) + TEXT_PAD_X * 2;
  }
}

function drawStoneRow(ctx: CanvasRenderingContext2D, row: StoneRowLayout, ui: InventoryUi): void {
  const { rect, stone } = row;
  if (ui.hoverStoneId === stone.id) {
    ctx.fillStyle = COLOR_HOVER_BG;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  const m = TEXT.SMALL;
  const baseline = rect.y + rect.h / 2 + 3;
  const equipped = row.equippedSlot >= 0;
  const meta = equipped ? `[${row.equippedSlot + 1}]` : `D${stone.foundDepth}`;
  drawText(ctx, meta, rect.x + rect.w - TEXT_PAD_X, baseline, m, equipped ? COLOR_SELECTED : COLOR_DIM, "right");
  const metaWidth = textWidth(meta, m);
  const maxWidth = rect.w - metaWidth - TEXT_PAD_X * 3;
  drawText(ctx, truncateText(stoneLabel(stone), maxWidth, m), rect.x + TEXT_PAD_X, baseline, m, COLOR_SKILL);
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
    { text: `リンク ${stone.links}（基本 CD +${linkPenalty}%）`, color: COLOR_TEXT },
  ];
  if (stone.variants.length === 0) lines.push({ text: "変異なし", color: COLOR_DIM });
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
  if (!stone) {
    strokeRectPx(ctx, tooltipRect, COLOR_BORDER);
    drawText(ctx, "スキル石にカーソルを合わせる", tooltipRect.x + TEXT_PAD_X, tooltipRect.y + bodyLineH(), TEXT.SMALL, COLOR_DIM);
    return;
  }
  drawTooltipBox(ctx, tooltipRect, stoneTooltipLines(state, stone), CONTENT_Y);
}

/** 右下: 刻印符とリンクの説明 */
function drawSkillNotes(ctx: CanvasRenderingContext2D, layout: InventoryLayout): void {
  const { statsRect } = layout;
  strokeRectPx(ctx, statsRect, COLOR_BORDER);
  const m = TEXT.SMALL;
  const lineH = bodyLineH();
  const maxWidth = statsRect.w - TEXT_PAD_X * 2;
  const maxY = statsRect.y + statsRect.h - 2;
  const lines = [
    "刻印符はこのランのみ有効。触れると装着中の",
    "スキルにリンクする（最も古いものが外れる）。",
    "リンク数が多いほど基本クールダウンが伸びる。",
    "キー: 1/C/マウス戻る, 2/V/マウス進む",
  ];
  let y = statsRect.y + lineH;
  for (const line of lines) {
    if (y > maxY) break;
    drawText(ctx, truncateText(line, maxWidth, m), statsRect.x + TEXT_PAD_X, y, m, COLOR_DIM);
    y += lineH;
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
  drawItemTooltip(ctx, state, layout.tooltipRect, shown, CONTENT_Y + CURRENCY_BLOCK_H, "アイテムを選択");
  for (const button of craftLayout.buttons) drawCraftButton(ctx, ui, button, selected);
  drawCraftStatus(ctx, layout, ui, craftLayout.statusY, craftLayout.resultY);
  drawHint(ctx, layout, HINT_CRAFT);
}

function drawCurrencies(ctx: CanvasRenderingContext2D, ui: InventoryUi, rows: readonly CurrencyRowLayout[]): void {
  const m = TEXT.SMALL;
  for (const { currency, rect } of rows) {
    const baseline = rect.y + rect.h - CURRENCY_BASELINE_INSET;
    drawText(ctx, `${CURRENCY_LABEL[currency]} ${ui.craft.save.wallet[currency]}`, rect.x + TEXT_PAD_X, baseline, m, CURRENCY_COLOR[currency]);
    drawText(ctx, CURRENCY_SOURCE[currency], rect.x + rect.w - TEXT_PAD_X, baseline, m, COLOR_DIM, "right");
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
  const m = TEXT.SMALL;
  drawText(ctx, CRAFT_LABEL[op], centerX, rect.y + CRAFT_LABEL_BASELINE, m, enabled ? COLOR_TEXT : COLOR_EMPTY, "center");
  const canPay = ui.craft.save.wallet[cost.currency] >= cost.amount;
  const costColor = canPay ? CURRENCY_COLOR[cost.currency] : COLOR_EMPTY;
  drawText(ctx, `${cost.amount} ${CURRENCY_LABEL[cost.currency]}`, centerX, rect.y + CRAFT_COST_BASELINE, m, costColor, "center");
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
  const m = TEXT.SMALL;
  drawText(ctx, truncateText(status, maxWidth, m), statsRect.x + TEXT_PAD_X, statusY, m, COLOR_DIM);
  if (!ui.craft.result) return;
  drawText(ctx, truncateText(ui.craft.result, maxWidth, m), statsRect.x + TEXT_PAD_X, resultY, m, COLOR_SELECTED);
}
