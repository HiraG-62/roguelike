import { actionKeyLabel, skillKeyLabel } from "../core/input";
import type { GameState } from "../core/state";
import { VIEW_H, VIEW_W } from "../core/view";
import { isKeystoneKey, keystoneConflicts } from "../loot/affixes";
import { type SynergyDescription, describeItem, describeResonance, describeSynergy, itemColorBar } from "../loot/describe";
import { SLOTS, TRAIT_COLOR_HEX, type Item } from "../loot/types";
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
import { SUMMARY_HEAD_H, type SlotTileLayout, attributePanelRect } from "../ui/equipmentLayout";
import {
  CONTENT_Y,
  type InventoryLayout,
  type InventoryUi,
  type Rect,
  SLOT_LABEL,
  type SkillSlotLayout,
  type SkillsLayout,
  type StoneRowLayout,
  helpButtonRect,
  layoutInventory,
  layoutSkills,
  tabRects,
} from "../ui/inventory";
import { drawBudModal } from "./budUi";
import { drawAttributePanel, drawSummaryHead } from "./attributeUi";
import { DETAIL_GAP_LINE, type DetailContent, type DetailLine, drawDetailPane } from "./detailPane";
import { itemAttackLine, loadoutAttackLines, skillAttackLine } from "./elementUi";
import { drawEchoTab } from "./echoTabUi";
import { drawInventoryHelp } from "./inventoryHelp";
import { drawSynergyTab } from "./synergyUi";
import { drawRuneColumn, runeTooltipLines } from "./skillRuneUi";
import {
  COLOR_BORDER,
  COLOR_DIM,
  COLOR_EMPTY,
  COLOR_GROWN,
  COLOR_HOVER_BG,
  COLOR_INSCRIPTION,
  COLOR_SELECTED,
  COLOR_TEXT,
  COLOR_WARN,
  GROWN_MARK,
  HUE_STRIP_W,
  ROW_BASELINE_OFFSET,
  TEXT_PAD_X,
  type TipLine,
  bodyLineH,
  drawColorBar,
  drawItemRow,
  fillRectPx,
  ratiosToBar,
  strokeRectPx,
  traitTipLine,
} from "./lootUiParts";
import { drawSlotGroupLines, drawStashToolbar, stashEmptyText } from "./stashToolbarUi";
import { TEXT, drawText, textWidth, truncateText } from "./pixelText";

/**
 * 装備画面（装備 / スキル / 残響 / 網の 4 タブ）の描画。state と ui を読むだけ。
 * 装備・スキルタブは「左: 一覧 / 右: 固定の詳細欄」。詳細欄は乗せた物の要点を出し、拾うキーで来歴・語などの詳しい行を足す。
 * 操作の説明は詳細欄の下端（いまできる操作だけ）と ？ のヘルプに出し、画面に常時の説明文は置かない。
 * 単一指標（DPS・スコア）は出さない
 */

const COLOR_OVERLAY = "rgba(0,0,0,0.6)";
/** 枠の背景は不透明にする（半透明だと背後の HUD の文字が透けて見出しと重なる） */
const COLOR_FRAME_BG = "#0c0c12";
const COLOR_HEADER_RULE = "#303038";
const COLOR_BANNER_BG = "rgba(157,255,176,0.14)";
const COLOR_TILE_ACTIVE_BG = "rgba(255,215,95,0.10)";
const COLOR_SKILL = SKILL.drop.stoneColor;

const TAB_LABEL: Record<InventoryUi["tab"], string> = { equipment: "装備", skills: "スキル", echo: "残響", web: "流れ" };
const TAB_UNDERLINE_H = 1;
const HELP_GLYPH = "？";
/** 部位の枠・スキルのスロットの 1 行目と 2 行目のベースライン（枠の上端から） */
const TILE_LINE1_Y = 9;
const TILE_LINE2_Y = 19;
const TILE_BAR_H = 2;
const SKILL_ICON_SIZE = 14;
const SKILL_ICON_BASELINE = 11;
const PERCENT = 100;
/** コストが最大気力を超えて切り詰められたときの注記 */
const COST_CLAMPED_NOTE = "（上限で切り詰め）";
const SECTION_GAP = 3;

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

/** 装備中の排他衝突（要約の先頭に出す） */
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

function detailToggleAction(full: boolean): string {
  return `${actionKeyLabel("interact")}: ${full ? "要点だけ" : "詳しく"}`;
}

export function drawInventoryUi(ctx: CanvasRenderingContext2D, state: GameState, ui: InventoryUi): void {
  if (!ui.open) return;
  const layout = layoutInventory(state, ui);

  fillRectPx(ctx, { x: 0, y: 0, w: VIEW_W, h: VIEW_H }, COLOR_OVERLAY);
  drawPanelFrame(ctx, layout, ui);
  switch (ui.tab) {
    case "skills":
      drawSkillsTab(ctx, state, ui);
      break;
    case "echo":
      drawEchoTab(ctx, state, ui.echo);
      break;
    case "web":
      drawSynergyTab(ctx, state, ui.web);
      break;
    case "equipment":
      drawEquipmentTab(ctx, state, layout, ui);
      break;
  }
  if (ui.helpOpen) drawInventoryHelp(ctx, ui.tab);
}

// ---------------------------------------------------------------------------
// 枠と見出し
// ---------------------------------------------------------------------------

function drawPanelFrame(ctx: CanvasRenderingContext2D, layout: InventoryLayout, ui: InventoryUi): void {
  const { panel } = layout;
  fillRectPx(ctx, panel, COLOR_FRAME_BG);
  strokeRectPx(ctx, panel, COLOR_BORDER);
  drawTabs(ctx, ui);
  const help = helpButtonRect();
  if (ui.hoverHelp || ui.helpOpen) fillRectPx(ctx, help, COLOR_HOVER_BG);
  strokeRectPx(ctx, help, ui.helpOpen ? COLOR_SELECTED : COLOR_BORDER);
  drawText(ctx, HELP_GLYPH, help.x + help.w / 2, help.y + help.h - 1, TEXT.SMALL, ui.helpOpen ? COLOR_SELECTED : COLOR_DIM, "center");
  fillRectPx(ctx, { x: panel.x + 1, y: CONTENT_Y - 2, w: panel.w - 2, h: 1 }, COLOR_HEADER_RULE);
  if (ui.messageTimer <= 0 || !ui.message) return;
  const m = TEXT.SMALL;
  const right = help.x - TEXT_PAD_X * 2;
  drawText(ctx, truncateText(ui.message, panel.w / 2, m), right, help.y + help.h - 2, m, COLOR_SELECTED, "right");
}

function drawTabs(ctx: CanvasRenderingContext2D, ui: InventoryUi): void {
  for (const { tab, rect } of tabRects()) {
    const selected = ui.tab === tab;
    drawText(ctx, TAB_LABEL[tab], rect.x + rect.w / 2, rect.y + rect.h - 2, TEXT.BODY, selected ? COLOR_TEXT : COLOR_DIM, "center");
    if (selected) fillRectPx(ctx, { x: rect.x, y: rect.y + rect.h, w: rect.w, h: TAB_UNDERLINE_H }, COLOR_SELECTED);
  }
}

// ---------------------------------------------------------------------------
// 装備タブ
// ---------------------------------------------------------------------------

function drawEquipmentTab(ctx: CanvasRenderingContext2D, state: GameState, layout: InventoryLayout, ui: InventoryUi): void {
  for (const tile of layout.tiles) drawSlotTile(ctx, tile, layout, ui);
  drawStashToolbar(ctx, layout.stashToolbar, ui.stashView, layout.stashCounts);
  if (layout.budBanner) drawBudBanner(ctx, state, layout.budBanner);
  drawStash(ctx, layout, ui);
  const item = findItemById(state, ui.hoverItemId);
  if (item) drawDetailPane(ctx, layout.detail, itemDetail(state, item, ui.hoverTile !== null, ui.detailFull), ui.detailFull);
  else drawBuildSummary(ctx, state, layout.detail, ui);
  drawBudModal(ctx, state, ui.bud);
}

/** 部位の枠: 1 行目に部位名と倉庫の件数、2 行目に装備中の名前。選んでいる部位は黄色の枠 */
function drawSlotTile(ctx: CanvasRenderingContext2D, tile: SlotTileLayout, layout: InventoryLayout, ui: InventoryUi): void {
  const { rect, item } = tile;
  const selected = ui.stashView.slot === tile.filter;
  if (selected) fillRectPx(ctx, rect, COLOR_TILE_ACTIVE_BG);
  if (ui.hoverTile === tile.filter) fillRectPx(ctx, rect, COLOR_HOVER_BG);
  strokeRectPx(ctx, rect, selected ? COLOR_SELECTED : COLOR_BORDER);
  const m = TEXT.SMALL;
  const x = rect.x + TEXT_PAD_X + HUE_STRIP_W;
  const maxWidth = rect.w - TEXT_PAD_X * 2 - HUE_STRIP_W;
  const count = `${layout.stashCounts[tile.filter] ?? 0}`;
  const labelColor = selected ? COLOR_TEXT : COLOR_DIM;
  if (tile.slot === null) {
    drawText(ctx, truncateText("全部位", maxWidth, m), x, rect.y + TILE_LINE1_Y, m, labelColor);
    drawText(ctx, `${count} 点`, x, rect.y + TILE_LINE2_Y, m, COLOR_DIM);
    return;
  }
  const label = SLOT_LABEL[tile.slot];
  // 部位名を優先し、件数は並べて入るときだけ出す
  const withCount = textWidth(label, m) + TEXT_PAD_X + textWidth(count, m) <= maxWidth;
  if (withCount) drawText(ctx, count, rect.x + rect.w - TEXT_PAD_X, rect.y + TILE_LINE1_Y, m, COLOR_DIM, "right");
  drawText(ctx, truncateText(label, maxWidth, m), x, rect.y + TILE_LINE1_Y, m, labelColor);
  if (!item) {
    drawText(ctx, "空", x, rect.y + TILE_LINE2_Y, m, COLOR_EMPTY);
    return;
  }
  const color = itemColor(item);
  fillRectPx(ctx, { x: rect.x + 1, y: rect.y + 1, w: HUE_STRIP_W, h: rect.h - 2 }, color);
  const mark = item.budOffer ? GROWN_MARK : "";
  drawText(ctx, truncateText(`${mark}${item.name}`, maxWidth, m), x, rect.y + TILE_LINE2_Y, m, color);
  const bar = { x, y: rect.y + rect.h - TILE_BAR_H - 1, w: maxWidth, h: TILE_BAR_H };
  drawColorBar(ctx, itemColorBar(item.affixes), bar);
}

/** 芽のバナー（ui/bud.ts の budBannerRect と同じ位置）。クリックで 2 択を開く */
function drawBudBanner(ctx: CanvasRenderingContext2D, state: GameState, r: Rect): void {
  const pending = state.pendingBud;
  if (pending === null) return;
  fillRectPx(ctx, r, COLOR_BANNER_BG);
  strokeRectPx(ctx, r, COLOR_GROWN);
  const m = TEXT.SMALL;
  const name = state.profile.equipment[pending.slot]?.name ?? "";
  const text = `${GROWN_MARK} 芽あり: ${name}（${pending.milestoneLabel}）クリックで選ぶ`;
  drawText(ctx, truncateText(text, r.w - TEXT_PAD_X * 2, m), r.x + TEXT_PAD_X, r.y + r.h - 2, m, COLOR_GROWN);
}

function drawStash(ctx: CanvasRenderingContext2D, layout: InventoryLayout, ui: InventoryUi): void {
  const first = layout.stashRows[0];
  if (layout.stashOrder.length === 0 || !first) {
    const top = layout.stashToolbar.reduce((max, c) => Math.max(max, c.rect.y + c.rect.h), 0);
    drawText(ctx, stashEmptyText(layout.stashTotal), layout.panel.x + TEXT_PAD_X * 2, top + bodyLineH() + 2, TEXT.SMALL, COLOR_DIM);
    return;
  }
  for (const row of layout.stashRows) drawItemRow(ctx, row, ui.hoverItemId === row.item.id);
  drawSlotGroupLines(ctx, layout.stashRows, layout.stashOrder, ui.stashView);
}

// ---------------------------------------------------------------------------
// 装備タブ: 詳細欄
// ---------------------------------------------------------------------------

/** 床の遺物のツールチップ（render/dropTooltip.ts）用に、要点と詳しくを全部並べた行 */
export function itemTipLines(state: GameState, item: Item): TipLine[] {
  const d = itemDetailLines(state, item);
  return [...d.lines, ...d.more];
}

/** 要点: 名前・銘・種類・性質・誓約の競合。詳しく: 攻撃の素性・一言・固有・余白・来歴・語 */
function itemDetailLines(state: GameState, item: Item): { lines: TipLine[]; more: TipLine[] } {
  const d = describeItem(item);
  const lines: TipLine[] = [{ text: d.name, color: itemColor(item) }];
  if (d.inscription !== undefined && d.inscription !== d.name) lines.push({ text: `銘「${d.inscription}」`, color: COLOR_INSCRIPTION });
  lines.push({ text: d.subtitle, color: COLOR_DIM });
  lines.push(DETAIL_GAP_LINE);
  for (const line of d.lines) lines.push(traitTipLine(line));
  for (const text of conflictLinesFor(state, item)) lines.push({ text, color: COLOR_WARN });

  const more: TipLine[] = [];
  const attackLine = itemAttackLine(item);
  if (attackLine !== null) more.push({ text: attackLine, color: COLOR_DIM });
  more.push({ text: d.summary, color: COLOR_TEXT });
  if (d.implicit !== undefined) more.push({ text: `固有: ${d.implicit}`, color: COLOR_DIM });
  more.push({ text: d.marginText, color: COLOR_GROWN });
  for (const text of d.provenanceLines) more.push({ text: `・${text}`, color: COLOR_DIM });
  // 同じ部位は入れ替わる前提で外したビルドと比べる（装備中なら「これが抜けたら何が欠けるか」）
  more.push(...synergyTipLines(describeSynergy(item, synergyBuild(state, { slot: item.slot }))));
  return { lines, more };
}

function itemDetail(state: GameState, item: Item, fromTile: boolean, full: boolean): DetailContent {
  const { lines, more } = itemDetailLines(state, item);
  const actions = fromTile ? ["クリック: この部位を一覧", "Shift+クリック: 外す"] : ["クリック: 装備", "Shift+クリック: 砕く"];
  return { lines, more, actions: [...actions, detailToggleAction(full)] };
}

/**
 * 何も乗せていないとき: ジョブと未振り点 → ステータス（振り分けの「+」）→ 近接・射撃の素性 → 共鳴。
 * 詳しくでは装備の効果の一覧（statsSummary）を足す
 */
function drawBuildSummary(ctx: CanvasRenderingContext2D, state: GameState, rect: Rect, ui: InventoryUi): void {
  const attrs = attributePanelRect();
  const lines: DetailLine[] = [];
  for (const text of equippedConflictLines(state)) lines.push({ text, color: COLOR_WARN });
  for (const text of loadoutAttackLines(state.stats)) lines.push({ text, color: COLOR_DIM });
  const resonance = state.stats.resonance;
  const [headline, ...effects] = describeResonance(resonance);
  const lead = resonance.colors[0];
  const headColor = resonance.kind === "none" ? COLOR_DIM : lead === undefined ? COLOR_SELECTED : TRAIT_COLOR_HEX[lead];
  lines.push({ text: headline ?? "", color: headColor });
  lines.push({ bar: ratiosToBar(resonance.ratios) });
  for (const text of effects) lines.push({ text, color: resonance.kind === "none" ? COLOR_DIM : COLOR_TEXT });
  const more = statsSummary(state.stats).map((text): TipLine => ({ text, color: COLOR_TEXT }));

  // ステータスの一覧（「+」の当たり判定と同じ位置）の下から詳細欄の部品で流し込む
  const below: Rect = { x: rect.x, y: attrs.y + attrs.h + SECTION_GAP, w: rect.w, h: rect.y + rect.h - (attrs.y + attrs.h + SECTION_GAP) };
  strokeRectPx(ctx, rect, COLOR_BORDER);
  drawSummaryHead(ctx, state, { x: rect.x, y: rect.y, w: rect.w, h: SUMMARY_HEAD_H });
  drawAttributePanel(ctx, state, ui.hoverAlloc, attrs);
  drawDetailPane(ctx, below, { lines, more, actions: more.length > 0 ? [detailToggleAction(ui.detailFull)] : [] }, ui.detailFull);
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
  if (d.produces.length > 0) head.push(`源 ${glyphs(d.produces)}`);
  if (d.consumes.length > 0) head.push(`糧 ${glyphs(d.consumes)}`);
  const lines: TipLine[] = [{ text: `流れ: ${head.join("  ")}`, color: meshes ? COLOR_SYNERGY : COLOR_DIM }];
  const detail: string[] = [];
  if (d.partners.length > 0) detail.push(`相性: ${d.partners.join(WORD_SEP)}`);
  if (d.fills.length > 0) detail.push(`潤い: ${labels(d.fills)}`);
  if (d.feeds.length > 0) detail.push(`受け皿: ${labels(d.feeds)}`);
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
  if (words.length > 0) lines.push({ text: `${GROWN_MARK} 今のビルドと相性がよい（${labels(words)}）`, color: COLOR_SYNERGY });
  for (const key of def.combos ?? []) {
    const combo = COMBOS[key];
    // 先のスキルが複数ある連携（変身 → 奥義）は、装着済みの最初の 1 つを出す
    const after = comboAfter(combo).find((k) => partnerEquipped(state, k, slot));
    if (after === undefined) continue;
    lines.push({ text: `連携「${combo.name}」: ${SKILL_DEFS[after].name} の直後に使う`, color: COLOR_SYNERGY });
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

// ---------------------------------------------------------------------------
// スキルタブ
// ---------------------------------------------------------------------------

function drawSkillsTab(ctx: CanvasRenderingContext2D, state: GameState, ui: InventoryUi): void {
  const skills = layoutSkills(state, ui);
  for (const slot of skills.slots) drawSkillSlot(ctx, state, slot, ui);
  drawStoneHeader(ctx, skills);
  if (skills.stoneOrder.length === 0) {
    const h = skills.stoneHeader;
    drawText(ctx, "スキル石がありません", h.x + TEXT_PAD_X, h.y + h.h + bodyLineH(), TEXT.SMALL, COLOR_DIM);
  }
  for (const row of skills.rows) drawStoneRow(ctx, row, ui);
  drawRuneColumn(ctx, state, skills.runeList, ui);
  drawDetailPane(ctx, skills.detail, skillDetail(state, ui, skills), ui.detailFull);
}

/** スロット: アイコン・石の名前・キー・付いている刻印符の数。選択中は黄色の枠 */
function drawSkillSlot(ctx: CanvasRenderingContext2D, state: GameState, s: SkillSlotLayout, ui: InventoryUi): void {
  const { rect } = s;
  if (ui.hoverSkillSlot === s.index) fillRectPx(ctx, rect, COLOR_HOVER_BG);
  strokeRectPx(ctx, rect, ui.skillSlot === s.index ? COLOR_SELECTED : COLOR_BORDER);

  const m = TEXT.SMALL;
  const iconX = rect.x + TEXT_PAD_X;
  const iconY = rect.y + TEXT_PAD_X;
  strokeRectPx(ctx, { x: iconX, y: iconY, w: SKILL_ICON_SIZE, h: SKILL_ICON_SIZE }, COLOR_BORDER);
  const color = s.stone ? COLOR_SKILL : COLOR_EMPTY;
  const icon = s.stone ? SKILL_DEFS[s.stone.skillKey].icon : String(s.index + 1);
  drawText(ctx, icon, iconX + SKILL_ICON_SIZE / 2, iconY + SKILL_ICON_BASELINE, m, color, "center");

  const textX = iconX + SKILL_ICON_SIZE + TEXT_PAD_X;
  const maxWidth = rect.x + rect.w - textX - TEXT_PAD_X;
  drawText(ctx, truncateText(skillKeyLabel(s.index), maxWidth, m), textX, rect.y + TILE_LINE1_Y, m, COLOR_DIM);
  const runes = slotModifierView(state, s.index).length;
  if (runes > 0) drawText(ctx, `符${runes}`, rect.x + rect.w - TEXT_PAD_X, rect.y + TILE_LINE1_Y, m, COLOR_DIM, "right");
  const name = s.stone ? SKILL_DEFS[s.stone.skillKey].name : "空";
  drawText(ctx, truncateText(name, rect.w - TEXT_PAD_X * 2, m), rect.x + TEXT_PAD_X, rect.y + rect.h - 3, m, color);
}

function drawStoneHeader(ctx: CanvasRenderingContext2D, skills: SkillsLayout): void {
  const h = skills.stoneHeader;
  const m = TEXT.SMALL;
  drawText(ctx, `スキル石 ${skills.stoneOrder.length}`, h.x + TEXT_PAD_X, h.y + h.h / 2 + ROW_BASELINE_OFFSET, m, COLOR_SKILL);
  fillRectPx(ctx, { x: h.x, y: h.y + h.h - 1, w: h.w, h: 1 }, COLOR_HEADER_RULE);
}

function drawStoneRow(ctx: CanvasRenderingContext2D, row: StoneRowLayout, ui: InventoryUi): void {
  const { rect, stone } = row;
  if (ui.hoverStoneId === stone.id) fillRectPx(ctx, rect, COLOR_HOVER_BG);
  const m = TEXT.SMALL;
  const baseline = rect.y + rect.h / 2 + ROW_BASELINE_OFFSET;
  const meta = row.equippedSlot >= 0 ? `${row.equippedSlot + 1}` : "";
  if (meta) drawText(ctx, meta, rect.x + rect.w - TEXT_PAD_X, baseline, m, COLOR_SELECTED, "right");
  const maxWidth = rect.w - textWidth(meta, m) - TEXT_PAD_X * 3;
  drawText(ctx, truncateText(stoneLabel(stone), maxWidth, m), rect.x + TEXT_PAD_X, baseline, m, COLOR_SKILL);
}

/**
 * 気力型は「コスト n / 間隔 s」、再使用型は「再使用 s」（docs/COMBAT_DESIGN.md B-6: 負担の表示を資源で出し分ける）。
 * コストは最大気力で切り詰めた実際の値を出し、切り詰めたときはそう書く
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

/** 石の要点: 名前・動詞・負担・変異・付いている刻印符。詳しく: 攻撃の素性・リンク・使い込み・噛む */
function stoneDetailLines(state: GameState, stone: SkillStone): { lines: TipLine[]; more: TipLine[] } {
  const def = SKILL_DEFS[stone.skillKey];
  const slot = state.skills.profile.loadout.indexOf(stone.id);
  // 装備画面での付け外しは次のステップまで slot.modifiers に入らないので、石から直接読む
  const modifiers = slot >= 0 ? effectiveSlotModifiers(state.skills, slot) : stoneModifierKeys(stone);
  const params = resolveCast(def, stone, modifiers);
  const lines: TipLine[] = [
    { text: stoneLabel(stone), color: COLOR_SKILL },
    { text: burdenText(state, def, params), color: COLOR_DIM },
    DETAIL_GAP_LINE,
    { text: def.verb, color: COLOR_TEXT },
  ];
  for (const v of stone.variants) lines.push({ text: formatVariant(v, def, params.resource), color: COLOR_TEXT });
  if (slot >= 0) {
    for (const m of slotModifierView(state, slot)) {
      const d = MODIFIERS[m.key];
      lines.push({ text: `${m.active ? "+" : "x"} ${d.name}: ${modifierVerb(m.key, def, params.resource)}`, color: m.active ? d.color : COLOR_EMPTY });
    }
  }
  // 使い込みの枠の芽で増えたリンクは負担に数えない
  const linkPenalty = Math.round(burdenLinks(stone) * SKILL.linkBurdenPenalty * PERCENT);
  const attackLine = skillAttackLine(def.key);
  const more: TipLine[] = [
    ...(attackLine === null ? [] : [{ text: attackLine, color: COLOR_DIM }]),
    { text: `リンク ${stone.links}（基本${BURDEN_LABEL[params.resource]} +${linkPenalty}%）`, color: COLOR_DIM },
    { text: wearSummary(stone), color: WEAR_TUNING.color },
    ...stoneSynergyLines(state, stone, slot, modifiers),
  ];
  return { lines, more };
}

/** 詳細欄の対象: 刻印符 → 乗せた石 → 乗せたスロット → 選択中のスロット */
function skillDetail(state: GameState, ui: InventoryUi, skills: SkillsLayout): DetailContent {
  const toggle = detailToggleAction(ui.detailFull);
  const rune = runeTooltipLines(state, ui, skills.runeList);
  if (rune) return { lines: rune, actions: ["Shift+クリック: 捨てる"] };
  const hoveredStone = findStone(state.skills.profile, ui.hoverStoneId);
  const onSlot = ui.hoverSkillSlot !== null;
  const stone = hoveredStone ?? stoneInSlot(state.skills.profile, ui.skillSlot);
  if (!stone) {
    return {
      lines: [{ text: `スキル ${ui.skillSlot + 1}: 空き`, color: COLOR_DIM }],
      actions: ["スキル石をクリックで装着"],
    };
  }
  const { lines, more } = stoneDetailLines(state, stone);
  const fromList = hoveredStone !== null && !onSlot;
  const actions = fromList ? ["クリック: 装着", "Shift+クリック: 分解"] : ["クリック: 選ぶ", "Shift+クリック: 外す"];
  return { lines, more, actions: [...actions, toggle] };
}

