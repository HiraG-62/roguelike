import { skillKeyLabel } from "../core/input";
import type { GameState } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import { isKeystoneKey, keystoneConflicts } from "../loot/affixes";
import { describeItem, describeResonance, itemColorBar } from "../loot/describe";
import { RARITY_COLOR, RARITY_LABEL, SLOTS, TRAIT_COLOR_HEX, type Item, type Slot } from "../loot/types";
import { statsSummary } from "../loot/stats";
import { MODIFIERS, SKILL, SKILL_DEFS, castBurden, castInterval, formatVariant, modifierVerb, resolveCast, stoneLabel } from "../skills/data";
import { findStone } from "../skills/persistence";
import type { CastParams, SkillDef, SkillStone } from "../skills/types";
import { itemColor } from "../system/loot";
import { effectiveManaCost, formatCooldown, slotModifierView } from "../system/skills";
import {
  CONTENT_BOTTOM,
  CONTENT_Y,
  type InventoryLayout,
  type InventoryUi,
  type Rect,
  RIGHT_W,
  RIGHT_X,
  SLOT_LABEL,
  type SkillSlotLayout,
  type SlotLayout,
  type StoneRowLayout,
  layoutInventory,
  layoutSkills,
  tabRects,
} from "../ui/inventory";
import { drawBudModal } from "./budUi";
import { drawAttributePanel } from "./attributeUi";
import { drawEchoTab } from "./echoTabUi";
import {
  COLOR_BORDER,
  COLOR_DIM,
  COLOR_EMPTY,
  COLOR_GROWN,
  COLOR_HOVER_BG,
  COLOR_INSCRIPTION,
  COLOR_PANEL_BG,
  COLOR_SELECTED,
  COLOR_TEXT,
  COLOR_WARN,
  GROWN_MARK,
  HUE_STRIP_W,
  META_GAP,
  ROW_BASELINE_OFFSET,
  TEXT_PAD_X,
  type TipLine,
  bodyLineH,
  drawColorBar,
  drawHint,
  drawItemRow,
  drawTipLine,
  fillRectPx,
  ratiosToBar,
  strokeRectPx,
  traitTipLine,
  wrapTipLines,
} from "./lootUiParts";
import { fitTooltip } from "./renderMath";
import { TEXT, drawText, textLineHeight, textWidth, truncateText } from "./pixelText";

/**
 * 装備画面（装備 / スキル / 残響の 3 タブ）の描画。state と ui を読むだけ。
 * 装備タブ: 左にスロット 6、右に倉庫、左下にツールチップ（describeItem）、右下に共鳴パネル（describeResonance）。
 * 単一指標（DPS・スコア）は出さない
 */

const COLOR_OVERLAY = "rgba(0,0,0,0.55)";
const COLOR_BANNER_BG = "rgba(157,255,176,0.14)";

const TINY_LINE_H = 6;
/** ツールチップは内容に合わせて上へ伸ばす。これを超えたら小さい文字にする */
const TOOLTIP_MAX_LINES = 22;
const TOOLTIP_PAD_Y = 3;
const ICON_OFFSET_X = 10;
/** 装備スロットの背景にうっすら敷く色の不透明度 */
const SLOT_BG_ALPHA = 0.1;
/** 行・スロットの色の配合バー */
const SLOT_BAR_H = 2;
const SLOT_BAR_INSET = 2;
/** 共鳴パネルの配合バー */
const RESONANCE_BAR_H = 4;
const RESONANCE_BAR_GAP = 2;

/** 空きスロットに出すアイコン文字 */
const SLOT_ICON: Record<Slot, string> = {
  weapon: "†",
  gun: "⌐",
  armor: "▣",
  boots: "▙",
  ring: "○",
  amulet: "◊",
};

const TAB_LABEL: Record<InventoryUi["tab"], string> = { equipment: "装備", skills: "スキル", echo: "残響" };
const COLOR_SKILL = SKILL.drop.stoneColor;
const SKILL_ICON_SIZE = 20;
const SKILL_ICON_BASELINE = 14;
const SKILL_LINE1_Y = 10;
const SKILL_LINE2_Y = 19;
const SKILL_LINE3_Y = 27;
const PERCENT = 100;
const HINT_EQUIPMENT = "クリック: 装備/解除  Shift+クリック: 砕く（残響を得る）  Tab: スキルへ";
/** 未振り点があるときだけ出す（ステータス行の「+」とキー 1〜4・E） */
const HINT_ALLOC = "+ / 1〜4・E: ステータスを振る";
const HINT_SEP = "  ";
/** コストが最大マナを超えて切り詰められたときの注記 */
const COST_CLAMPED_NOTE = "（上限で切り詰め）";
const HINT_SKILLS = "石をクリック: 装着  スロットをクリック: 解除/選択  Shift+クリック: 分解  Tab: 残響へ";

function keystoneKeysOf(item: Item): string[] {
  const keys = item.affixes.filter((r) => isKeystoneKey(r.key)).map((r) => r.key);
  if (item.implicit && isKeystoneKey(item.implicit.key)) keys.push(item.implicit.key);
  return keys;
}

function conflictText(names: readonly string[]): string {
  return `誓約が競合: ${names.join(" と ")}`;
}

/**
 * item を装備した場合（装備中ならそのまま）の誓約の排他衝突のうち、item の誓約が絡むもの。
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
    .map((group) => conflictText(group.map((d) => d.name)));
}

/** 装備中の排他衝突（共鳴パネルの先頭に出す） */
function equippedConflictLines(state: GameState): string[] {
  const keys: string[] = [];
  for (const slot of SLOTS) {
    const eq = state.profile.equipment[slot];
    if (eq) keys.push(...keystoneKeysOf(eq));
  }
  return keystoneConflicts(keys).map((group) => conflictText(group.map((d) => d.name)));
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

  fillRectPx(ctx, { x: 0, y: 0, w: VIEW_W, h: VIEW_H }, COLOR_OVERLAY);
  drawPanelFrame(ctx, layout, ui);
  switch (ui.tab) {
    case "skills":
      drawSkillsTab(ctx, state, layout, ui);
      return;
    case "echo":
      drawEchoTab(ctx, state, ui.echo, layout.hintRect);
      return;
    case "equipment":
      drawEquipmentTab(ctx, state, layout, ui);
      return;
  }
}

function drawEquipmentTab(ctx: CanvasRenderingContext2D, state: GameState, layout: InventoryLayout, ui: InventoryUi): void {
  for (const s of layout.slots) drawSlotRow(ctx, s, ui);
  drawStashHeader(ctx, state, layout);
  drawStash(ctx, layout, ui);
  drawResonancePanel(ctx, state, layout.resonanceRect);
  // スロットの下の空きにステータス（生値と実効値）。ツールチップはこの後に描くので上に重なる
  drawAttributePanel(ctx, state, ui.hoverAlloc);
  drawEquipmentTooltip(ctx, state, layout, ui);
  const hint = state.runAttributes.unspent > 0 ? `${HINT_ALLOC}${HINT_SEP}${HINT_EQUIPMENT}` : HINT_EQUIPMENT;
  drawHint(ctx, layout.hintRect, hint);
  drawBudModal(ctx, state, ui.bud);
}

function drawPanelFrame(ctx: CanvasRenderingContext2D, layout: InventoryLayout, ui: InventoryUi): void {
  const { panel } = layout;
  fillRectPx(ctx, panel, COLOR_PANEL_BG);
  strokeRectPx(ctx, panel, COLOR_BORDER);
  drawTabs(ctx, ui);
  if (ui.messageTimer > 0 && ui.message) {
    const m = TEXT.SMALL;
    drawText(ctx, truncateText(ui.message, panel.w / 2, m), panel.x + panel.w - TEXT_PAD_X, panel.y + 8, m, COLOR_SELECTED, "right");
  }
}

function drawTabs(ctx: CanvasRenderingContext2D, ui: InventoryUi): void {
  for (const { tab, rect } of tabRects()) {
    const selected = ui.tab === tab;
    if (selected) fillRectPx(ctx, rect, COLOR_HOVER_BG);
    drawText(ctx, TAB_LABEL[tab], rect.x + rect.w / 2, rect.y + rect.h - 1, TEXT.BODY, selected ? COLOR_TEXT : COLOR_DIM, "center");
  }
}

// ---------------------------------------------------------------------------
// 装備タブ: スロットと倉庫
// ---------------------------------------------------------------------------

function drawSlotRow(ctx: CanvasRenderingContext2D, s: SlotLayout, ui: InventoryUi): void {
  const { rect } = s;
  if (ui.hoverSlot === s.slot) fillRectPx(ctx, rect, COLOR_HOVER_BG);
  drawSlotFrame(ctx, rect, s.item);

  const m = TEXT.SMALL;
  const baseline = rect.y + rect.h / 2 + 1;
  const label = SLOT_LABEL[s.slot];
  drawText(ctx, label, rect.x + TEXT_PAD_X + (s.item ? HUE_STRIP_W : 0), baseline, m, COLOR_DIM);
  const right = rect.x + rect.w - TEXT_PAD_X;
  if (!s.item) {
    drawText(ctx, "― 空 ―", right - ICON_OFFSET_X, baseline + 2, m, COLOR_EMPTY, "right");
    drawText(ctx, SLOT_ICON[s.slot], right - ICON_OFFSET_X / 2 + 1, rect.y + rect.h / 2 + 4, TEXT.BODY, COLOR_EMPTY, "center");
    return;
  }
  const item = s.item;
  const rarity = RARITY_LABEL[item.rarity];
  drawText(ctx, rarity, right, baseline, m, RARITY_COLOR[item.rarity], "right");
  const nameMaxWidth = rect.w - textWidth(label, m) - textWidth(rarity, m) - TEXT_PAD_X * 2 - META_GAP * 2 - HUE_STRIP_W;
  const nameRight = right - textWidth(rarity, m) - META_GAP;
  const mark = item.budOffer ? `${GROWN_MARK} ` : "";
  drawText(ctx, truncateText(`${mark}${item.name}`, nameMaxWidth, m), nameRight, baseline, m, itemColor(item), "right");
  const barX = rect.x + HUE_STRIP_W + SLOT_BAR_INSET + 1;
  const bar = { x: barX, y: rect.y + rect.h - SLOT_BAR_INSET - SLOT_BAR_H, w: rect.w / 2, h: SLOT_BAR_H };
  drawColorBar(ctx, itemColorBar(item.affixes), bar);
}

/** 装備中は主な色の枠 + 左端の帯 + 薄い背景。空きは灰色の枠だけ */
function drawSlotFrame(ctx: CanvasRenderingContext2D, rect: Rect, item: Item | null): void {
  if (!item) {
    strokeRectPx(ctx, rect, COLOR_BORDER);
    return;
  }
  const color = itemColor(item);
  ctx.globalAlpha = SLOT_BG_ALPHA;
  fillRectPx(ctx, rect, color);
  ctx.globalAlpha = 1;
  strokeRectPx(ctx, rect, color);
  fillRectPx(ctx, { x: Math.round(rect.x) + 1, y: Math.round(rect.y) + 1, w: HUE_STRIP_W, h: rect.h - 2 }, color);
}

/** 倉庫の見出し。芽が出ていればクリックできるバナーにする（ui/bud.ts の budBannerRect と同じ位置） */
function drawStashHeader(ctx: CanvasRenderingContext2D, state: GameState, layout: InventoryLayout): void {
  const r = layout.stashHeader;
  const m = TEXT.SMALL;
  const baseline = r.y + r.h - 2;
  const pending = state.pendingBud;
  if (pending === null) {
    drawText(ctx, `倉庫 ${layout.stashOrder.length}`, r.x + TEXT_PAD_X, baseline, m, COLOR_DIM);
    return;
  }
  fillRectPx(ctx, r, COLOR_BANNER_BG);
  strokeRectPx(ctx, r, COLOR_GROWN);
  const name = state.profile.equipment[pending.slot]?.name ?? "";
  const text = `${GROWN_MARK} 芽が出ています: ${name}（${pending.milestoneLabel}）クリックで選ぶ`;
  drawText(ctx, truncateText(text, r.w - TEXT_PAD_X * 2, m), r.x + TEXT_PAD_X, baseline, m, COLOR_GROWN);
}

function drawStash(ctx: CanvasRenderingContext2D, layout: InventoryLayout, ui: InventoryUi): void {
  if (layout.stashOrder.length === 0) {
    drawText(ctx, "倉庫は空です", RIGHT_X + TEXT_PAD_X, CONTENT_Y + layout.stashHeader.h + bodyLineH(), TEXT.SMALL, COLOR_DIM);
    return;
  }
  for (const row of layout.stashRows) drawItemRow(ctx, row, ui.hoverItemId === row.item.id);
}

// ---------------------------------------------------------------------------
// 装備タブ: ツールチップと共鳴
// ---------------------------------------------------------------------------

/** describeItem を行にする: 名前 → 銘 → 副題 → 一言 → 固有 → 性質 → 余白 → 誓約の競合 → 来歴 */
export function itemTipLines(state: GameState, item: Item): TipLine[] {
  const d = describeItem(item);
  const lines: TipLine[] = [{ text: d.name, color: itemColor(item) }];
  if (d.inscription !== undefined && d.inscription !== d.name) lines.push({ text: `銘「${d.inscription}」`, color: COLOR_INSCRIPTION });
  lines.push({ text: d.subtitle, color: COLOR_DIM });
  lines.push({ text: d.summary, color: COLOR_TEXT });
  if (d.implicit !== undefined) lines.push({ text: `固有: ${d.implicit}`, color: COLOR_DIM });
  for (const line of d.lines) lines.push(traitTipLine(line));
  lines.push({ text: d.marginText, color: COLOR_GROWN });
  for (const text of conflictLinesFor(state, item)) lines.push({ text, color: COLOR_WARN });
  for (const text of d.provenanceLines) lines.push({ text: `・${text}`, color: COLOR_DIM });
  return lines;
}

/** 倉庫の行に乗せたら左列、スロットに乗せたら右列に出す（乗せている物を隠さない） */
function drawEquipmentTooltip(ctx: CanvasRenderingContext2D, state: GameState, layout: InventoryLayout, ui: InventoryUi): void {
  const item = findItemById(state, ui.hoverItemId);
  const base = layout.tooltipRect;
  if (item === null) {
    drawStatsBox(ctx, state, base);
    return;
  }
  const rect = ui.hoverSlot !== null ? { ...layout.resonanceRect } : base;
  drawTooltipBox(ctx, rect, itemTipLines(state, item), CONTENT_Y);
}

/** 何にも乗せていないときは、いまの能力値を箱に収まる分だけ出す */
function drawStatsBox(ctx: CanvasRenderingContext2D, state: GameState, rect: Rect): void {
  strokeRectPx(ctx, rect, COLOR_BORDER);
  const m = TEXT.SMALL;
  const lineH = bodyLineH();
  const maxWidth = rect.w - TEXT_PAD_X * 2;
  const lines = statsSummary(state.stats);
  const shown = lines.length === 0 ? ["遺物にカーソルを合わせる"] : lines;
  let y = rect.y + lineH;
  for (const line of shown) {
    if (y > rect.y + rect.h - 2) break;
    drawText(ctx, truncateText(line, maxWidth, m), rect.x + TEXT_PAD_X, y, m, lines.length === 0 ? COLOR_DIM : COLOR_TEXT);
    y += lineH;
  }
}

/** 行を下端揃えのボックスに描く。行数が多ければ fitTooltip の縮小行高に切り替え、入る分だけ出す */
export function drawTooltipBox(ctx: CanvasRenderingContext2D, rect: Rect, lines: readonly TipLine[], topLimit: number): void {
  const m = TEXT.SMALL;
  const maxWidth = rect.w - TEXT_PAD_X * 2;
  const wrapped = wrapTipLines(lines, maxWidth, m);
  const lineH = bodyLineH();
  const smallLineH = Math.max(TINY_LINE_H, textLineHeight(m));
  const bottom = rect.y + rect.h;
  const fit = fitTooltip(wrapped.length, lineH, smallLineH, TOOLTIP_MAX_LINES, bottom - topLimit, TOOLTIP_PAD_Y);
  const h = Math.max(rect.h, fit.height);
  const box = { x: rect.x, y: bottom - h, w: rect.w, h };
  fillRectPx(ctx, box, COLOR_PANEL_BG);
  strokeRectPx(ctx, box, COLOR_BORDER);
  let y = box.y + fit.lineH;
  for (let i = 0; i < fit.shown; i++) {
    const line = wrapped[i];
    if (!line) break;
    drawTipLine(ctx, line, box.x + TEXT_PAD_X, y, maxWidth, m);
    y += fit.lineH;
  }
}

/** 共鳴パネル: 誓約の競合 → 共鳴の名前 → 5 色の配合比の帯 → 発現効果 */
function drawResonancePanel(ctx: CanvasRenderingContext2D, state: GameState, rect: Rect): void {
  strokeRectPx(ctx, rect, COLOR_BORDER);
  const m = TEXT.SMALL;
  const lineH = bodyLineH();
  const x = rect.x + TEXT_PAD_X;
  const maxWidth = rect.w - TEXT_PAD_X * 2;
  const bottom = rect.y + rect.h - 1;
  let y = rect.y + lineH;
  for (const line of equippedConflictLines(state)) {
    drawText(ctx, truncateText(line, maxWidth, m), x, y, m, COLOR_WARN);
    y += lineH;
  }
  const resonance = state.stats.resonance;
  const [headline, ...effects] = describeResonance(resonance);
  const lead = resonance.colors[0];
  const headColor = resonance.kind === "none" ? COLOR_DIM : lead === undefined ? COLOR_SELECTED : TRAIT_COLOR_HEX[lead];
  drawText(ctx, truncateText(headline ?? "", maxWidth, m), x, y, m, headColor);
  const bar = { x, y: y + RESONANCE_BAR_GAP, w: maxWidth, h: RESONANCE_BAR_H };
  drawColorBar(ctx, ratiosToBar(resonance.ratios), bar);
  y = bar.y + bar.h + lineH;
  for (const line of effects) {
    if (y > bottom) break;
    drawText(ctx, truncateText(line, maxWidth, m), x, y, m, resonance.kind === "none" ? COLOR_DIM : COLOR_TEXT);
    y += lineH;
  }
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
  drawHint(ctx, layout.hintRect, HINT_SKILLS);
}

function drawSkillSlot(ctx: CanvasRenderingContext2D, state: GameState, s: SkillSlotLayout, ui: InventoryUi): void {
  const { rect } = s;
  if (ui.hoverSkillSlot === s.index) fillRectPx(ctx, rect, COLOR_HOVER_BG);
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

  drawText(ctx, `キー ${skillKeyLabel(s.index)}`, textX, rect.y + SKILL_LINE2_Y, m, COLOR_DIM);
  let x = textX;
  for (const mod of slotModifierView(state, s.index)) {
    const name = MODIFIERS[mod.key].name;
    drawText(ctx, name, x, rect.y + SKILL_LINE3_Y, m, mod.active ? MODIFIERS[mod.key].color : COLOR_EMPTY);
    x += textWidth(name, m) + TEXT_PAD_X * 2;
  }
}

function drawStoneRow(ctx: CanvasRenderingContext2D, row: StoneRowLayout, ui: InventoryUi): void {
  const { rect, stone } = row;
  if (ui.hoverStoneId === stone.id) fillRectPx(ctx, rect, COLOR_HOVER_BG);
  const m = TEXT.SMALL;
  const baseline = rect.y + rect.h / 2 + ROW_BASELINE_OFFSET;
  const equipped = row.equippedSlot >= 0;
  const meta = equipped ? `[${row.equippedSlot + 1}]` : `D${stone.foundDepth}`;
  drawText(ctx, meta, rect.x + rect.w - TEXT_PAD_X, baseline, m, equipped ? COLOR_SELECTED : COLOR_DIM, "right");
  const metaWidth = textWidth(meta, m);
  const maxWidth = rect.w - metaWidth - TEXT_PAD_X * 3;
  drawText(ctx, truncateText(stoneLabel(stone), maxWidth, m), rect.x + TEXT_PAD_X, baseline, m, COLOR_SKILL);
}

/**
 * マナ型は「コスト n / 間隔 s」、CD 型は「CD s」（docs/COMBAT_DESIGN.md B-6: 負担の表示を資源で出し分ける）。
 * コストは最大マナで切り詰めた実際の値を出し、切り詰めたときはそう書く
 */
function burdenText(state: GameState, def: SkillDef, params: Readonly<CastParams>): string {
  const interval = formatCooldown(castInterval(def, params));
  const burden = castBurden(def, params);
  if (def.resource !== "mana") return `CD ${formatCooldown(burden.cooldown)}`;
  const capped = effectiveManaCost(state, burden.cost);
  const note = capped.clamped ? COST_CLAMPED_NOTE : "";
  return `コスト ${Math.round(capped.cost)}${note}  間隔 ${interval}`;
}

/** 石のツールチップ: 動詞・タグ・負担（コスト / CD）・リンク・変異軸・装着中の刻印符 */
function stoneTooltipLines(state: GameState, stone: SkillStone): TipLine[] {
  const def = SKILL_DEFS[stone.skillKey];
  const slot = state.skills.profile.loadout.indexOf(stone.id);
  const modifiers = slot >= 0 ? (state.skills.slots[slot]?.modifiers ?? []) : [];
  const params = resolveCast(def, stone, modifiers);
  const linkPenalty = Math.round(stone.links * SKILL.linkBurdenPenalty * PERCENT);
  const burdenName = def.resource === "mana" ? "コスト" : "CD";
  const lines: TipLine[] = [
    { text: stoneLabel(stone), color: COLOR_SKILL },
    { text: def.verb, color: COLOR_TEXT },
    { text: `${def.tags.join(" / ")}  ${burdenText(state, def, params)}`, color: COLOR_DIM },
    { text: `リンク ${stone.links}（基本${burdenName} +${linkPenalty}%）`, color: COLOR_TEXT },
  ];
  if (stone.variants.length === 0) lines.push({ text: "変異なし", color: COLOR_DIM });
  for (const v of stone.variants) lines.push({ text: formatVariant(v, def), color: COLOR_TEXT });
  if (slot < 0) return lines;
  for (const m of slotModifierView(state, slot)) {
    const d = MODIFIERS[m.key];
    lines.push({ text: `${m.active ? "+" : "x"} ${d.name}: ${modifierVerb(m.key, def)}`, color: m.active ? d.color : COLOR_EMPTY });
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
  const rect = layout.resonanceRect;
  strokeRectPx(ctx, rect, COLOR_BORDER);
  const m = TEXT.SMALL;
  const lineH = bodyLineH();
  const maxWidth = RIGHT_W - TEXT_PAD_X * 2;
  const maxY = Math.min(rect.y + rect.h - 2, CONTENT_BOTTOM);
  const lines = [
    "刻印符はこのランのみ有効。触れると装着中の",
    "スキルにリンクする（最も古いものが外れる）。",
    "リンク数が多いほど負担（コスト / CD）が重くなる。",
    "キー: 1〜4 / C V X Z / マウス戻る・進む",
    "パッド: LB を押しながら A X Y B",
  ];
  let y = rect.y + lineH;
  for (const line of lines) {
    if (y > maxY) break;
    drawText(ctx, truncateText(line, maxWidth, m), rect.x + TEXT_PAD_X, y, m, COLOR_DIM);
    y += lineH;
  }
}
