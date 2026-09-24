import { skillKeyLabel } from "../core/input";
import type { GameState } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import { isKeystoneKey, keystoneConflicts } from "../loot/affixes";
import { type SynergyDescription, describeItem, describeResonance, describeSynergy, itemColorBar } from "../loot/describe";
import { RARITY_COLOR, RARITY_LABEL, SLOTS, TRAIT_COLOR_HEX, type Item, type Slot } from "../loot/types";
import { statsSummary } from "../loot/stats";
import {
  BURDEN_LABEL,
  MODIFIERS,
  SKILL,
  SKILL_DEFS,
  burdenLinks,
  castBurden,
  castInterval,
  formatVariant,
  modifierVerb,
  resolveCast,
  stoneLabel,
} from "../skills/data";
import { WEAR_TUNING } from "../skills/tuning2";
import { wearSummary } from "../skills/wear";
import { COMBOS, comboAfter } from "../skills/combos";
import { findStone, stoneInSlot, stoneModifierKeys } from "../skills/persistence";
import type { CastParams, ModifierKey, SkillDef, SkillKey, SkillStone } from "../skills/types";
import { itemColor } from "../system/loot";
import { affinity, skillKeywords } from "../system/keywords";
import { effectiveManaCost, effectiveSlotModifiers, formatCooldown, manaRuleCost, slotModifierView } from "../system/skills";
import { KEYWORD_DEFS, type Keyword } from "../core/keywords";
import { synergyBuild } from "../ui/synergyPanel";
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
  type SkillsLayout,
  type SlotLayout,
  type StoneRowLayout,
  layoutInventory,
  layoutSkills,
  tabRects,
} from "../ui/inventory";
import { drawBudModal } from "./budUi";
import { drawAttributePanel } from "./attributeUi";
import { itemAttackLine, loadoutAttackLines, skillAttackLine } from "./elementUi";
import { drawEchoTab } from "./echoTabUi";
import { drawSynergyTab } from "./synergyUi";
import { drawRuneColumn, runeTooltipLines } from "./skillRuneUi";
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
import { drawSlotGroupLines, drawStashToolbar, stashCountText, stashEmptyText, stashEmptyY } from "./stashToolbarUi";
import { TEXT, drawText, textLineHeight, textWidth, truncateText } from "./pixelText";

/**
 * 装備画面（装備 / スキル / 残響 / 網の 4 タブ）の描画。state と ui を読むだけ。
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
  mainHand: "†",
  offHand: "⌐",
  armor: "▣",
  boots: "▙",
  ring: "○",
  amulet: "◊",
};

/** 左手（offHand）は今はベースが無く常に空。「― 空 ―」の代わりにその旨を出す */
const OFF_HAND_TEXT = "―（両手の仕組みは後日）";

const TAB_LABEL: Record<InventoryUi["tab"], string> = { equipment: "装備", skills: "スキル", echo: "残響", web: "網" };
const COLOR_SKILL = SKILL.drop.stoneColor;
const SKILL_ICON_SIZE = 20;
const SKILL_ICON_BASELINE = 14;
const SKILL_LINE1_Y = 10;
const SKILL_LINE2_Y = 19;
const SKILL_LINE3_Y = 27;
const PERCENT = 100;
const HINT_EQUIPMENT = "クリック: 装備/解除  Shift+クリック: 砕く / 並びの向き・絞り込みを戻す  Tab: スキルへ";
/** 未振り点があるときだけ出す（ステータス行の「+」とキー 1〜4・E） */
const HINT_ALLOC = "+ / 1〜4・E: ステータスを振る";
const HINT_SEP = "  ";
/** コストが最大マナを超えて切り詰められたときの注記 */
const COST_CLAMPED_NOTE = "（上限で切り詰め）";
const HINT_SKILLS = "スロット選択: クリック/1〜4/←→  刻印符: クリック/↑↓+決定で付け外し  Shift+クリック: 解除・分解・捨てる  Tab: 残響へ";

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
    case "web":
      drawSynergyTab(ctx, state, ui.web, layout.hintRect);
      return;
    case "equipment":
      drawEquipmentTab(ctx, state, layout, ui);
      return;
  }
}

function drawEquipmentTab(ctx: CanvasRenderingContext2D, state: GameState, layout: InventoryLayout, ui: InventoryUi): void {
  for (const s of layout.slots) drawSlotRow(ctx, s, ui);
  drawStashHeader(ctx, state, layout, ui);
  drawStashToolbar(ctx, layout.stashToolbar, ui.stashView, layout.stashCounts);
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
    const emptyText = s.slot === "offHand" ? OFF_HAND_TEXT : "― 空 ―";
    drawText(ctx, emptyText, right - ICON_OFFSET_X, baseline + 2, m, COLOR_EMPTY, "right");
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
function drawStashHeader(ctx: CanvasRenderingContext2D, state: GameState, layout: InventoryLayout, ui: InventoryUi): void {
  const r = layout.stashHeader;
  const m = TEXT.SMALL;
  const baseline = r.y + r.h - 2;
  const pending = state.pendingBud;
  if (pending === null) {
    drawText(ctx, stashCountText(layout.stashOrder.length, layout.stashTotal, ui.stashView), r.x + TEXT_PAD_X, baseline, m, COLOR_DIM);
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
    const y = stashEmptyY(layout.stashToolbar, bodyLineH());
    drawText(ctx, stashEmptyText(layout.stashTotal), RIGHT_X + TEXT_PAD_X, y, TEXT.SMALL, COLOR_DIM);
    return;
  }
  for (const row of layout.stashRows) drawItemRow(ctx, row, ui.hoverItemId === row.item.id);
  drawSlotGroupLines(ctx, layout.stashRows, layout.stashOrder, ui.stashView);
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
  const attackLine = itemAttackLine(item);
  if (attackLine !== null) lines.push({ text: attackLine, color: COLOR_DIM });
  lines.push({ text: d.summary, color: COLOR_TEXT });
  if (d.implicit !== undefined) lines.push({ text: `固有: ${d.implicit}`, color: COLOR_DIM });
  for (const line of d.lines) lines.push(traitTipLine(line));
  lines.push({ text: d.marginText, color: COLOR_GROWN });
  for (const text of conflictLinesFor(state, item)) lines.push({ text, color: COLOR_WARN });
  for (const text of d.provenanceLines) lines.push({ text: `・${text}`, color: COLOR_DIM });
  // 同じ部位は入れ替わる前提で外したビルドと比べる（装備中なら「これが抜けたら何が欠けるか」）
  lines.push(...synergyTipLines(describeSynergy(item, synergyBuild(state, { slot: item.slot }))));
  return lines;
}

// ---------------------------------------------------------------------------
// 「ここに噛む」（docs/ideas/synergy-web.md 4-b / 4-d）。語と相手の名前だけで、優劣は出さない
// ---------------------------------------------------------------------------

/** 噛み合う語があるときの色 / 無いときは COLOR_DIM */
const COLOR_SYNERGY = "#a8e0ff";
const WORD_SEP = "・";

function glyphs(words: readonly Keyword[]): string {
  return words.map((k) => KEYWORD_DEFS[k].glyph).join("");
}

function labels(words: readonly Keyword[]): string {
  return words.map((k) => KEYWORD_DEFS[k].label).join(WORD_SEP);
}

/** 1 行目: 出す / 食う語の字形。2 行目: 噛む相手と、埋める穴 / 食う余り */
export function synergyTipLines(d: SynergyDescription): TipLine[] {
  if (d.produces.length + d.consumes.length === 0) return [];
  const meshes = d.fills.length + d.feeds.length + d.partners.length > 0;
  const head: string[] = [];
  if (d.produces.length > 0) head.push(`出す ${glyphs(d.produces)}`);
  if (d.consumes.length > 0) head.push(`食う ${glyphs(d.consumes)}`);
  const lines: TipLine[] = [{ text: `語: ${head.join("  ")}`, color: meshes ? COLOR_SYNERGY : COLOR_DIM }];
  const detail: string[] = [];
  if (d.partners.length > 0) detail.push(`噛む: ${d.partners.join(WORD_SEP)}`);
  if (d.fills.length > 0) detail.push(`穴を埋める: ${labels(d.fills)}`);
  if (d.feeds.length > 0) detail.push(`余りを食う: ${labels(d.feeds)}`);
  if (detail.length > 0) lines.push({ text: detail.join("  "), color: COLOR_SYNERGY });
  return lines;
}

/** スキル石: ビルドの穴を埋める / 余りを食うなら 1 行、連携の相手が装着済みなら 1 行ずつ */
function stoneSynergyLines(state: GameState, stone: SkillStone, slot: number, modifiers: readonly ModifierKey[]): TipLine[] {
  const def = SKILL_DEFS[stone.skillKey];
  const build = synergyBuild(state, slot >= 0 ? { skillSlot: slot } : {});
  const aff = affinity(skillKeywords(def, modifiers), build.profile);
  const words = [...aff.fills, ...aff.feeds];
  const lines: TipLine[] = [];
  if (words.length > 0) lines.push({ text: `${GROWN_MARK} 今のビルドと噛む（${labels(words)}）`, color: COLOR_SYNERGY });
  for (const key of def.combos ?? []) {
    const combo = COMBOS[key];
    // 先のスキルが複数ある連携（変身 → 奥義）は、装着済みの最初の 1 つを出す
    const after = comboAfter(combo).find((k) => partnerEquipped(state, k, slot));
    if (after === undefined) continue;
    lines.push({ text: `連携「${combo.name}」: ${SKILL_DEFS[after].name} → これ`, color: COLOR_SYNERGY });
  }
  return lines;
}

/** 連携の「先」のスキル石が、この石以外のスロットに装着されているか */
function partnerEquipped(state: GameState, after: SkillKey, ownSlot: number): boolean {
  for (let i = 0; i < SKILL.slots; i++) {
    if (i === ownSlot) continue;
    if (stoneInSlot(state.skills.profile, i)?.skillKey === after) return true;
  }
  return false;
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
  // 先頭にいまの近接・射撃の素性（ジャンルと属性。docs/COMBAT_DESIGN.md A-8）
  const shown = [...loadoutAttackLines(state.stats), ...(lines.length === 0 ? ["遺物にカーソルを合わせる"] : lines)];
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
  drawRuneColumn(ctx, state, skills.runeList, ui);
  drawSkillTooltip(ctx, state, layout, ui, skills.runeList);
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
  // 定刻・燃料化で資源が差し替わるので def.resource ではなく params.resource で出し分ける
  if (params.resource !== "mana") return `再使用 ${formatCooldown(burden.cooldown)}`;
  const capped = effectiveManaCost(state, burden.cost);
  const note = capped.clamped && !def.manaRule ? COST_CLAMPED_NOTE : "";
  return `コスト ${Math.round(manaRuleCost(state, def, capped.cost))}${note}  間隔 ${interval}`;
}

/** 石のツールチップ: 動詞・タグ・負担（コスト / CD）・リンク・変異軸・装着中の刻印符 */
function stoneTooltipLines(state: GameState, stone: SkillStone): TipLine[] {
  const def = SKILL_DEFS[stone.skillKey];
  const slot = state.skills.profile.loadout.indexOf(stone.id);
  // 装備画面での付け外しは次のステップまで slot.modifiers に入らないので、石から直接読む
  const modifiers = slot >= 0 ? effectiveSlotModifiers(state.skills, slot) : stoneModifierKeys(stone);
  const params = resolveCast(def, stone, modifiers);
  // 使い込みの枠の芽で増えたリンクは負担に数えない
  const linkPenalty = Math.round(burdenLinks(stone) * SKILL.linkBurdenPenalty * PERCENT);
  const burdenName = BURDEN_LABEL[params.resource];
  const attackLine = skillAttackLine(def.key);
  const lines: TipLine[] = [
    { text: stoneLabel(stone), color: COLOR_SKILL },
    { text: def.verb, color: COLOR_TEXT },
    ...(attackLine === null ? [] : [{ text: attackLine, color: COLOR_DIM }]),
    { text: `${def.tags.join(" / ")}  ${burdenText(state, def, params)}`, color: COLOR_DIM },
    { text: `リンク ${stone.links}（基本${burdenName} +${linkPenalty}%）`, color: COLOR_TEXT },
    { text: wearSummary(stone), color: WEAR_TUNING.color },
  ];
  if (stone.variants.length === 0) lines.push({ text: "変異なし", color: COLOR_DIM });
  for (const v of stone.variants) lines.push({ text: formatVariant(v, def, params.resource), color: COLOR_TEXT });
  lines.push(...stoneSynergyLines(state, stone, slot, modifiers));
  if (slot < 0) return lines;
  for (const m of slotModifierView(state, slot)) {
    const d = MODIFIERS[m.key];
    lines.push({ text: `${m.active ? "+" : "x"} ${d.name}: ${modifierVerb(m.key, def, params.resource)}`, color: m.active ? d.color : COLOR_EMPTY });
  }
  return lines;
}

function drawSkillTooltip(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  layout: InventoryLayout,
  ui: InventoryUi,
  runeList: SkillsLayout["runeList"],
): void {
  const { tooltipRect } = layout;
  const rune = runeTooltipLines(state, ui, runeList);
  if (rune) {
    drawTooltipBox(ctx, tooltipRect, rune, CONTENT_Y);
    return;
  }
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
    "刻印符は拾うと所持品に入る。選んだスロットの石に",
    "付け外しでき、石と一緒に持ち越す。",
    "リンク数が多いほど負担（コスト / 再使用時間）が重くなる。",
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
