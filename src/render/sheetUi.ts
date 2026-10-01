import { KEYWORD_DEFS, type Keyword } from "../core/keywords";
import type { GameState } from "../core/state";
import { RELIC_GLYPHS } from "../data/sprites/attire";
import { ULTIMATES } from "../data/ultimates";
import { MOVESETS } from "../data/weapons";
import { ATTR_COLOR, formatAffix } from "../loot/affixes";
import { ECHO_OPS, ECHO_OP_LABEL } from "../loot/crafting";
import { describeItem, describeTrait } from "../loot/describe";
import { innateAt } from "../loot/innate";
import { ultimateChoice } from "../loot/profile";
import { ATTR_KEYS, TRAIT_COLOR_HEX, type Item } from "../loot/types";
import { MODIFIERS, modifierLinkCost } from "../skills/data";
import type { SkillStone } from "../skills/types";
import { BOONS, BOON_CARD_LABEL, LINEAGE_LABEL, type BoonKey, type LineageKey } from "../system/boonDefs";
import { relicKeywords } from "../system/keywords";
import { itemColor } from "../system/loot";
import { type EffectRow, boonSheetRow, lineageBoonRows, temperCount } from "../ui/effectsList";
import { echoWalletText, forgeCostText, forgeItem, forgeOpBlock, forgePartners, forgePickLabel, forgePickOptions, forgeStep, isEquippedItem } from "../ui/forge";
import { SLOT_LABEL } from "../ui/inventoryLayout";
import { fid, focusedHit } from "../ui/menuFocus";
import type { InventoryUi, MenuHit, Rect, ViewOf } from "../ui/menuState";
import { type FormulaChunk, type FormulaPiece, chunkText, skillFormulas } from "../ui/scalingText";
import {
  ACTION_ROWS_VISIBLE,
  BODY_ATTR_RECT,
  BODY_CARD,
  BODY_DERIVED_RECT,
  BODY_FORMULA_RECT,
  BODY_PAGES,
  BODY_PAGE_ULTIMATE,
  BODY_REACH_MAX,
  BODY_REACH_Y,
  FORGE_COST_Y,
  FORGE_EXEC_RECT,
  ITEM_BODY,
  ITEM_NAME_Y,
  ITEM_RULE_Y,
  ITEM_SUB_Y,
  MOVESET_ARROWS,
  PAIR_PAGES,
  PARTNER_PAGE,
  PICK_ROWS_MAX,
  SHEET_CARD,
  ULT_HEAD_Y,
  actionRect,
  actionRowCount,
  focusedActionIndex,
  forgeOpRect,
  pageTabRect,
  pairItems,
  pairStones,
  partnerRect,
  pickRowRect,
  sheetItemOf,
  sheetStone,
  sheetStoneName,
  ultCardRect,
  visibleActionIndices,
} from "../ui/sheet";
import {
  ULTIMATE_KIND_LABEL,
  attributeSourceText,
  attributeSources,
  bodyActionChunks,
  bodyActions,
  bodyReachRows,
  canChooseUltimate,
  derivedStatRows,
  sheetMoveset,
  ultimateCostOf,
} from "../ui/sheetBody";
import { attrColor, drawAttributePanel } from "./attributeUi";
import { drawRelicGlyph, glyphSize } from "./attireUi";
import { MENU_INK, box, drawFocusBrackets, drawGlyphDisc, menuText, px } from "./crestDraw";
import { type DetailLine, conflictLinesFor, itemDetailLines, stoneDetailLines, stoneFormulaLines, ultimateTipLine } from "./itemTips";
import { COLOR_DIM, COLOR_TEXT, LINE_H, type TipLine, drawTipLine, traitTipLine, wrapTipLines } from "./lootUiParts";
import { TEXT, drawText, textLineHeight, textWidth, truncateText } from "./pixelText";

/**
 * 書付の描画（docs/ideas/inventory-v2/E-merged.md 6 章 W8。情報の予算の外）。state と ui を読むだけ。
 * 1 品: 名前・部位 · 種類 · 深度 · 響き・性質の全文（右端に系統の丸印）・地金の数字・来歴（右の列）、下端に鍛冶の操作 5。
 * 見開き: 左 = 候補、右 = 今（地金は差を（+1）で）。体: [体] ステータスと出どころ・体の性能・到達・行動の行・焦点の行動の計算式 / [奥義] 3 枚。
 * 祝福・系譜・刻印符・スキル石は全文。入りきらなければ行間を詰め、それでも溢れた分は … で切る（旧 detailPane と同じ流儀）
 */

type SheetView = ViewOf<"sheet">;

const PAD = 8;
const COL_GAP = 12;
const OVERFLOW_MARK = "…";
const TIGHT_LINE_H = 7;
/** 計算式の続きの行の字下げ */
const CHUNK_INDENT = 6;
const CHUNK_SPACE = " ";
const COLOR_ACTION_NAME = "#e8d8a8";
const DISC_D = 10;
const DISC_PITCH = 12;
const DISC_MAX = 2;

function lineHeights(): { normal: number; tight: number } {
  const h = textLineHeight(TEXT.SMALL);
  return { normal: Math.max(LINE_H + 1, h), tight: Math.max(TIGHT_LINE_H, h) };
}

// -----------------------------------------------------------------------------
// 計算式の片（旧 render/detailPane.ts の wrapChunks を移した）
// -----------------------------------------------------------------------------

/** 片の行を折り返した 1 行ぶん。dx は行の左端からの位置 */
export interface ChunkRow {
  segments: { text: string; color: string; dx: number }[];
}

function pieceColor(p: Readonly<FormulaPiece>): string {
  if (p.attr !== undefined) return TRAIT_COLOR_HEX[ATTR_COLOR[p.attr]];
  if (p.tone === "name") return COLOR_ACTION_NAME;
  if (p.tone === "dim") return COLOR_DIM;
  return COLOR_TEXT;
}

/**
 * 片の列を幅で折り返す。片の中では折り返さない（「筋力×1.3」を割らない）。
 * 1 片が幅を超えるときだけ、描画で末尾を … にする
 */
export function wrapChunks(chunks: readonly FormulaChunk[], maxWidth: number, m: number): ChunkRow[] {
  const rows: ChunkRow[] = [];
  let row: ChunkRow = { segments: [] };
  let x = 0;
  const space = textWidth(CHUNK_SPACE, m);
  for (const chunk of chunks) {
    const gap = row.segments.length === 0 || chunk.glue === true ? 0 : space;
    const w = textWidth(chunkText(chunk), m);
    if (row.segments.length > 0 && x + gap + w > maxWidth) {
      rows.push(row);
      row = { segments: [] };
      x = CHUNK_INDENT;
    }
    let dx = x + (row.segments.length === 0 ? 0 : gap);
    for (const p of chunk.pieces) {
      row.segments.push({ text: p.text, color: pieceColor(p), dx });
      dx += textWidth(p.text, m);
    }
    x = dx;
  }
  if (row.segments.length > 0) rows.push(row);
  return rows;
}

function drawChunkRow(ctx: CanvasRenderingContext2D, row: ChunkRow, x: number, baseline: number, maxWidth: number, m: number): void {
  for (const seg of row.segments) {
    const room = maxWidth - seg.dx;
    if (room <= 0) return;
    drawText(ctx, truncateText(seg.text, room, m), x + seg.dx, baseline, m, seg.color);
  }
}

/** 計算式の欄（BODY_FORMULA_RECT）の行数 */
export function formulaRowsFit(rect: Rect): number {
  return Math.max(1, Math.floor(rect.h / lineHeights().tight));
}

// -----------------------------------------------------------------------------
// 列の流し込み（折り返し・詰め・溢れの …）
// -----------------------------------------------------------------------------

/** 列の 1 行の素。keywords があれば右端に系統の丸印（性質の行） */
export interface ColumnLine {
  line: DetailLine;
  keywords?: readonly Keyword[];
}

type FlowRow = { kind: "gap" } | { kind: "tip"; tip: TipLine; keywords: readonly Keyword[] } | { kind: "chunks"; row: ChunkRow } | { kind: "bar" };

function isChunks(line: DetailLine): line is { chunks: readonly FormulaChunk[] } {
  return "chunks" in line;
}

function isTip(line: DetailLine): line is TipLine {
  return "text" in line;
}

function flowRows(lines: readonly ColumnLine[], width: number, m: number): FlowRow[] {
  return lines.flatMap((c): FlowRow[] => {
    const l = c.line;
    if (isChunks(l)) return wrapChunks(l.chunks, width, m).map((row): FlowRow => ({ kind: "chunks", row }));
    if (!isTip(l)) return [{ kind: "bar" }];
    if (l.text === "") return [{ kind: "gap" }];
    const discs = (c.keywords ?? []).slice(0, DISC_MAX);
    const room = discs.length === 0 ? width : width - discs.length * DISC_PITCH - 2;
    return wrapTipLines([l], room, m).map((tip, i): FlowRow => ({ kind: "tip", tip, keywords: i === 0 ? discs : [] }));
  });
}

function rowHeight(row: FlowRow, lineH: number): number {
  return row.kind === "gap" || row.kind === "bar" ? Math.ceil(lineH / 2) : lineH;
}

/** 列が rect に収まるか（テスト用。描画と同じ計算） */
export function columnFits(lines: readonly ColumnLine[], rect: Rect): boolean {
  const rows = flowRows(lines, rect.w, TEXT.SMALL);
  return rows.reduce((sum, r) => sum + rowHeight(r, lineHeights().tight), 0) <= rect.h;
}

function drawRowDiscs(ctx: CanvasRenderingContext2D, keywords: readonly Keyword[], right: number, top: number, lineH: number): void {
  keywords.forEach((k, i) => {
    const color = KEYWORD_DEFS[k].color;
    drawGlyphDisc(ctx, k, right - DISC_D / 2 - i * DISC_PITCH, top + lineH / 2, DISC_D, color);
  });
}

/** 列を流し込む。普通の行高で入らなければ詰め、まだ溢れたら最後の行に … を付けて切る */
function drawColumn(ctx: CanvasRenderingContext2D, lines: readonly ColumnLine[], rect: Rect): void {
  const m = TEXT.SMALL;
  const rows = flowRows(lines, rect.w, m);
  const { normal, tight } = lineHeights();
  const fits = rows.reduce((sum, r) => sum + rowHeight(r, normal), 0) <= rect.h;
  const lineH = fits ? normal : tight;
  const limit = rect.y + rect.h;
  let y = rect.y;
  for (const [i, row] of rows.entries()) {
    const h = rowHeight(row, lineH);
    if (row.kind === "gap" || row.kind === "bar") {
      y += h;
      continue;
    }
    const last = y + h + lineH > limit && i < rows.length - 1;
    const baseline = y + h - 1;
    if (row.kind === "chunks") drawChunkRow(ctx, row.row, rect.x, baseline, rect.w, m);
    else {
      const room = rect.w - row.keywords.length * DISC_PITCH;
      drawTipLine(ctx, last ? { ...row.tip, text: `${row.tip.text}${OVERFLOW_MARK}` } : row.tip, rect.x, baseline, room, m);
      drawRowDiscs(ctx, row.keywords, rect.x + rect.w, y, lineH);
    }
    if (last) return;
    y += h;
  }
}

function tip(text: string, color: string): ColumnLine {
  return { line: { text, color } };
}

const GAP_LINE: ColumnLine = { line: { text: "", color: COLOR_DIM } };

// -----------------------------------------------------------------------------
// 1 品・見開き
// -----------------------------------------------------------------------------

const SUB_SEP = " · ";
const INNATE_HEAD = "地金  ";
const INNATE_SEP = "　";
const EQUIPPED_MARK = "（装備中）";

function itemKeywords(item: Readonly<Item>, index: number): Keyword[] {
  const roll = item.affixes[index];
  if (roll === undefined) return [];
  const p = relicKeywords({ ...item, affixes: [roll], namedKey: undefined });
  return [...new Set([...p.produces, ...p.consumes, ...p.amplifies])];
}

/** 地金の数字（other があれば差を（+1）で） */
function innateText(item: Readonly<Item>, other: Readonly<Item> | null, depth: number): string {
  const mine = innateAt(item, depth);
  if (mine.length === 0) return "";
  const theirs = other === null ? [] : innateAt(other, depth);
  const parts = mine.map((roll) => {
    const base = formatAffix(roll);
    if (other === null) return base;
    const d = Math.round(roll.value - theirs.filter((r) => r.key === roll.key).reduce((s, r) => s + r.value, 0));
    return d === 0 ? base : `${base}（${d > 0 ? "+" : ""}${d}）`;
  });
  return `${INNATE_HEAD}${parts.join(INNATE_SEP)}`;
}

/** 左の列: 地金 → 性質の全文（系統の丸印つき）→ 誓約の競合 */
function itemLeftLines(state: Readonly<GameState>, item: Item, other: Readonly<Item> | null): ColumnLine[] {
  const lines: ColumnLine[] = [];
  const innate = innateText(item, other, state.depth);
  if (innate !== "") lines.push(tip(innate, MENU_INK.gold), GAP_LINE);
  item.affixes.forEach((roll, i) => lines.push({ line: traitTipLine(describeTrait(roll)), keywords: itemKeywords(item, i) }));
  for (const text of conflictLinesFor(state, item)) lines.push(tip(text, MENU_INK.down));
  return lines;
}

/** 右の列: 奥義の行・攻撃の素性・一言・ベース・余白・来歴・相性（itemDetailLines の詳しく） */
function itemRightLines(state: Readonly<GameState>, item: Item): ColumnLine[] {
  const ult = ultimateTipLine(state.profile, item);
  const more = itemDetailLines(state, item).more;
  return [...(ult === null ? [] : [{ line: ult }]), ...more.map((line): ColumnLine => ({ line }))];
}

function itemSubText(state: Readonly<GameState>, item: Item): string {
  const d = describeItem(item, state.depth);
  const mark = isEquippedItem(state.profile, item.id) ? EQUIPPED_MARK : "";
  return `${SLOT_LABEL[item.slot]}${SUB_SEP}${d.subtitle}${mark}`;
}

function drawItemHead(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, item: Item, rect: Rect): void {
  const w = rect.w - PAD * 2;
  menuText(ctx, item.name, rect.x + PAD, ITEM_NAME_Y, { size: "BODY", color: itemColor(item), role: "sentence", maxW: w });
  menuText(ctx, itemSubText(state, item), rect.x + PAD, ITEM_SUB_Y, { size: "SMALL", color: MENU_INK.sub, role: "label", maxW: w });
  px(ctx, rect.x + PAD, ITEM_RULE_Y, w, 1, MENU_INK.rule);
}

function drawPaperCard(ctx: CanvasRenderingContext2D, rect: Rect): void {
  px(ctx, rect.x, rect.y, rect.w, rect.h, MENU_INK.card);
  box(ctx, rect.x, rect.y, rect.w, rect.h, MENU_INK.rule);
}

/** 1 品の本文の左右 2 列の行（テストが性質の全文と地金の数字を見る） */
export function itemSheetLines(state: Readonly<GameState>, item: Item): { left: ColumnLine[]; right: ColumnLine[] } {
  return { left: itemLeftLines(state, item, null), right: itemRightLines(state, item) };
}

/** 1 品の本文（左右 2 列） */
function drawItemColumns(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, item: Item): void {
  const half = Math.floor((ITEM_BODY.w - COL_GAP) / 2);
  const lines = itemSheetLines(state, item);
  drawColumn(ctx, lines.left, { x: ITEM_BODY.x, y: ITEM_BODY.y, w: half, h: ITEM_BODY.h });
  drawColumn(ctx, lines.right, { x: ITEM_BODY.x + half + COL_GAP, y: ITEM_BODY.y, w: ITEM_BODY.w - half - COL_GAP, h: ITEM_BODY.h });
}

/** 見開きの 1 頁（名前・副題・地金の差・性質・来歴を 1 列に） */
function drawItemPage(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, item: Item | null, other: Item | null, rect: Rect): void {
  drawPaperCard(ctx, rect);
  if (item === null) {
    menuText(ctx, EMPTY_TEXT, rect.x + PAD, ITEM_NAME_Y, { size: "BODY", color: MENU_INK.dim, role: "label" });
    return;
  }
  drawItemHead(ctx, state, item, rect);
  const body: Rect = { x: rect.x + PAD, y: ITEM_BODY.y, w: rect.w - PAD * 2, h: rect.y + rect.h - PAD / 2 - ITEM_BODY.y };
  const provenance = describeItem(item, state.depth).provenanceLines.map((t) => tip(`・${t}`, COLOR_DIM));
  drawColumn(ctx, [...itemLeftLines(state, item, other), GAP_LINE, ...provenance], body);
}

const EMPTY_TEXT = "空き";

// -----------------------------------------------------------------------------
// 鍛冶（1 品の下端・相手の並び・選ぶ行）
// -----------------------------------------------------------------------------

const EXEC_LABEL = "実行";
const COST_HEAD = "費用 ";
const WALLET_HEAD = "残響  ";
const COST_SEP = "　";

function drawChip(ctx: CanvasRenderingContext2D, r: Rect, label: string, tone: { on: boolean; focus: boolean; dim: boolean; warn?: boolean }): void {
  px(ctx, r.x, r.y, r.w, r.h, tone.focus ? MENU_INK.card2 : tone.on ? MENU_INK.litFill : MENU_INK.card);
  box(ctx, r.x, r.y, r.w, r.h, tone.focus ? MENU_INK.focus : tone.on ? MENU_INK.gold : tone.warn === true ? MENU_INK.shu : MENU_INK.sub);
  const color = tone.dim ? MENU_INK.dim : tone.focus ? MENU_INK.focus : MENU_INK.text;
  menuText(ctx, label, r.x + r.w / 2, r.y + 3, { size: "SMALL", color, role: "label", align: "center", maxW: r.w - 2 });
}

function drawForgeBar(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, ui: Readonly<InventoryUi>, view: Readonly<SheetView>, item: Item): void {
  if (forgeItem(state.profile, item.id) === null) return;
  const session = view.forge;
  ECHO_OPS.forEach((op, i) => {
    const blocked = forgeOpBlock(state.profile, item.id, op) !== null;
    drawChip(ctx, forgeOpRect(i), ECHO_OP_LABEL[op], { on: session?.op === op, focus: view.focus === fid.op(op), dim: blocked, warn: op === "shatter" });
  });
  const op = session?.op ?? null;
  if (op !== null && session !== null) {
    const ready = forgeStep(state.profile, session) === "ready";
    drawChip(ctx, FORGE_EXEC_RECT, EXEC_LABEL, { on: ready, focus: view.focus === fid.exec, dim: !ready, warn: op === "shatter" });
  }
  const cost = op === null ? "" : forgeCostText(op);
  const line = `${cost === "" ? "" : `${COST_HEAD}${cost}${COST_SEP}`}${WALLET_HEAD}${echoWalletText(ui.craft)}`;
  menuText(ctx, line, ITEM_BODY.x, FORGE_COST_Y, { size: "SMALL", color: MENU_INK.sub, role: "label", maxW: ITEM_BODY.w });
}

function drawPartners(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, view: Readonly<SheetView>): void {
  const session = view.forge;
  if (session === null) return;
  const list = forgePartners(state.profile, session);
  if (list.length === 0) {
    menuText(ctx, NO_PARTNER_TEXT, ITEM_BODY.x, ITEM_BODY.y + 2, { size: "SMALL", color: MENU_INK.sub, role: "sentence", maxW: ITEM_BODY.w });
    return;
  }
  list.slice(view.offset, view.offset + PARTNER_PAGE).forEach((it, i) => {
    const r = partnerRect(i);
    const focus = view.focus === fid.partner(it.id);
    px(ctx, r.x, r.y, r.w, r.h, focus ? MENU_INK.card2 : MENU_INK.paper);
    box(ctx, r.x, r.y, r.w, r.h, focus ? MENU_INK.focus : MENU_INK.rule);
    const slot = it.slot;
    if (slot !== "offHand") drawRelicGlyph(ctx, slot, r.x + 4, r.y + Math.floor((r.h - glyphSize(RELIC_GLYPHS[slot], 1).h) / 2), 1, itemColor(it));
    const mark = isEquippedItem(state.profile, it.id) ? EQUIPPED_MARK : "";
    menuText(ctx, `${it.name}${mark}`, r.x + 20, r.y + 6, { size: "SMALL", color: focus ? MENU_INK.focus : MENU_INK.text, role: "label", maxW: r.w - 24 });
  });
  const pages = Math.ceil(list.length / PARTNER_PAGE);
  if (pages > 1) {
    const page = `${Math.floor(view.offset / PARTNER_PAGE) + 1}/${pages}`;
    menuText(ctx, page, ITEM_BODY.x + ITEM_BODY.w, ITEM_BODY.y + PARTNER_PAGE * 24, { size: "SMALL", color: MENU_INK.sub, role: "label", align: "right" });
  }
}

const NO_PARTNER_TEXT = "同じ部位の相手が無い";
const NO_PICK_TEXT = "選べる行が無い";

function drawPicks(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, view: Readonly<SheetView>): void {
  const session = view.forge;
  if (session === null) return;
  const picks = forgePickOptions(state.profile, session).slice(0, PICK_ROWS_MAX);
  if (picks.length === 0) {
    menuText(ctx, NO_PICK_TEXT, ITEM_BODY.x, ITEM_BODY.y + 2, { size: "SMALL", color: MENU_INK.sub, role: "sentence", maxW: ITEM_BODY.w });
    return;
  }
  picks.forEach((pick, i) => {
    const r = pickRowRect(i);
    const focus = view.focus === fid.trait(i);
    if (focus) px(ctx, r.x, r.y, r.w, r.h, MENU_INK.card2);
    menuText(ctx, forgePickLabel(state.profile, session, pick), r.x + 4, r.y + 2, { size: "SMALL", color: focus ? MENU_INK.focus : MENU_INK.text, role: "sentence", maxW: r.w - 8 });
  });
}

function drawItemSheet(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, ui: Readonly<InventoryUi>, view: Readonly<SheetView>): void {
  drawPaperCard(ctx, SHEET_CARD);
  const item = sheetItemOf(state, view);
  if (item === null) return;
  drawItemHead(ctx, state, item, SHEET_CARD);
  const step = view.forge === null ? null : forgeStep(state.profile, view.forge);
  if (step === "partner") drawPartners(ctx, state, view);
  else if (step === "pick") drawPicks(ctx, state, view);
  else drawItemColumns(ctx, state, item);
  drawForgeBar(ctx, state, ui, view, item);
}

// -----------------------------------------------------------------------------
// スキル石・刻印符・祝福・系譜
// -----------------------------------------------------------------------------

function drawStonePage(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, stone: SkillStone | null, rect: Rect, withFormula: boolean): void {
  drawPaperCard(ctx, rect);
  if (stone === null) {
    menuText(ctx, EMPTY_TEXT, rect.x + PAD, ITEM_NAME_Y, { size: "BODY", color: MENU_INK.dim, role: "label" });
    return;
  }
  const w = rect.w - PAD * 2;
  menuText(ctx, sheetStoneName(stone), rect.x + PAD, ITEM_NAME_Y, { size: "BODY", color: MENU_INK.focus, role: "sentence", maxW: w });
  px(ctx, rect.x + PAD, ITEM_RULE_Y, w, 1, MENU_INK.rule);
  const d = stoneDetailLines(state, stone);
  const left = [...d.lines.slice(1), ...d.more].map((line): ColumnLine => ({ line }));
  const top = ITEM_BODY.y - 12;
  const h = rect.y + rect.h - PAD / 2 - top;
  if (!withFormula) {
    drawColumn(ctx, left, { x: rect.x + PAD, y: top, w, h });
    return;
  }
  const half = Math.floor((w - COL_GAP) / 2);
  drawColumn(ctx, left, { x: rect.x + PAD, y: top, w: half, h });
  const formulas = stoneFormulaLines(stone, skillFormulas(state.stats, stone.skillKey)).slice(1);
  drawColumn(ctx, formulas.map((line): ColumnLine => ({ line })), { x: rect.x + PAD + half + COL_GAP, y: top, w: w - half - COL_GAP, h });
}

const RUNE_HEAD = "刻印符";
const LINK_HEAD = "リンク ";

function drawTextSheet(ctx: CanvasRenderingContext2D, title: string, sub: string, lines: readonly ColumnLine[]): void {
  drawPaperCard(ctx, SHEET_CARD);
  const w = SHEET_CARD.w - PAD * 2;
  menuText(ctx, title, SHEET_CARD.x + PAD, ITEM_NAME_Y, { size: "BODY", color: MENU_INK.focus, role: "sentence", maxW: w });
  menuText(ctx, sub, SHEET_CARD.x + PAD, ITEM_SUB_Y, { size: "SMALL", color: MENU_INK.sub, role: "label", maxW: w });
  px(ctx, SHEET_CARD.x + PAD, ITEM_RULE_Y, w, 1, MENU_INK.rule);
  const bottom = SHEET_CARD.y + SHEET_CARD.h - PAD / 2;
  drawColumn(ctx, lines, { x: ITEM_BODY.x, y: ITEM_BODY.y, w: ITEM_BODY.w, h: bottom - ITEM_BODY.y });
}

function drawRuneSheet(ctx: CanvasRenderingContext2D, key: keyof typeof MODIFIERS): void {
  const def = MODIFIERS[key];
  const lines = [tip(def.verb, COLOR_TEXT)];
  if (def.manaVerb !== undefined && def.manaVerb !== def.verb) lines.push(tip(def.manaVerb, COLOR_TEXT));
  drawTextSheet(ctx, def.name, `${RUNE_HEAD}${SUB_SEP}${LINK_HEAD}${modifierLinkCost(key)}`, lines);
}

const TEMPER_HEAD = "研鑽の数え ";

function boonSubText(key: BoonKey): string {
  const def = BOONS[key];
  const parts: string[] = [];
  if (def.card !== undefined) parts.push(BOON_CARD_LABEL[def.card]);
  if (def.lineage !== undefined) parts.push(LINEAGE_LABEL[def.lineage]);
  for (const l of def.fusion ?? []) parts.push(LINEAGE_LABEL[l]);
  return parts.join(SUB_SEP);
}

function drawBoonSheet(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, key: BoonKey): void {
  const def = BOONS[key];
  const row = boonSheetRow(state, def);
  const count = temperCount(state, def);
  const lines = [tip(row.detail, COLOR_TEXT)];
  if (row.info !== "") lines.push(tip(row.info, MENU_INK.gold));
  if (count !== null) lines.push(tip(`${TEMPER_HEAD}${count}`, MENU_INK.gold));
  drawTextSheet(ctx, def.name, boonSubText(key), lines);
}

const LINEAGE_SUB = "持っている札";
const NO_CARD_TEXT = "まだ札が無い";

function effectLines(rows: readonly EffectRow[]): ColumnLine[] {
  return rows.flatMap((r): ColumnLine[] => [tip(r.info === "" ? r.name : `${r.name}  ${r.info}`, MENU_INK.gold), tip(r.detail, COLOR_TEXT)]);
}

function drawLineageSheet(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, lineage: LineageKey): void {
  const rows = lineageBoonRows(state, lineage);
  const lines = rows.length === 0 ? [tip(NO_CARD_TEXT, COLOR_DIM)] : effectLines(rows);
  drawTextSheet(ctx, LINEAGE_LABEL[lineage], LINEAGE_SUB, lines);
}

// -----------------------------------------------------------------------------
// 体
// -----------------------------------------------------------------------------

function drawPageTabs(ctx: CanvasRenderingContext2D, view: Readonly<SheetView>): void {
  BODY_PAGES.forEach((label, n) => {
    const r = pageTabRect(n);
    const on = view.page === n;
    drawChip(ctx, r, label, { on, focus: view.focus === fid.page(n), dim: false });
  });
}

const ATTR_VALUE_W = 108;
const DERIVED_ROW_H = 10;
const REACH_ROW_H = 10;

function drawAttributes(ctx: CanvasRenderingContext2D, state: Readonly<GameState>): void {
  const r = BODY_ATTR_RECT;
  drawAttributePanel(ctx, state, { x: r.x, y: r.y, w: ATTR_VALUE_W, h: r.h });
  const sources = attributeSources(state);
  const rowH = r.h / ATTR_KEYS.length;
  ATTR_KEYS.forEach((key, i) => {
    const text = attributeSourceText(sources[key]);
    menuText(ctx, text, r.x + ATTR_VALUE_W + 4, r.y + i * rowH + 2, { size: "SMALL", color: MENU_INK.sub, role: "label", maxW: r.w - ATTR_VALUE_W - 4 });
  });
}

function drawDerived(ctx: CanvasRenderingContext2D, state: Readonly<GameState>): void {
  const r = BODY_DERIVED_RECT;
  derivedStatRows(state.stats).forEach((row, i) => {
    const y = r.y + i * DERIVED_ROW_H;
    if (y + DERIVED_ROW_H > r.y + r.h) return;
    menuText(ctx, row.value, r.x + r.w, y, { size: "SMALL", color: MENU_INK.focus, role: "label", align: "right" });
    const room = r.w - textWidth(row.value, TEXT.SMALL) - 6;
    menuText(ctx, row.label, r.x, y, { size: "SMALL", color: row.attr === null ? MENU_INK.sub : attrColor(row.attr), role: "label", maxW: room });
  });
}

function drawReach(ctx: CanvasRenderingContext2D, state: Readonly<GameState>): void {
  const r = BODY_ATTR_RECT;
  bodyReachRows(state)
    .slice(0, BODY_REACH_MAX)
    .forEach((row, i) => {
      const y = BODY_REACH_Y + i * REACH_ROW_H;
      menuText(ctx, `${row.name}  ${row.info}`, r.x, y, { size: "SMALL", color: MENU_INK.gold, role: "label", maxW: r.w });
    });
}

function drawActions(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, view: Readonly<SheetView>): void {
  const actions = bodyActions(state);
  const focusIndex = focusedActionIndex(state, view);
  visibleActionIndices(state, view).forEach((index, i) => {
    const action = actions[index];
    if (action === undefined) return;
    const r = actionRect(i);
    const focus = view.focus === fid.row(index);
    const lit = focusIndex === index;
    px(ctx, r.x, r.y, r.w, r.h, focus ? MENU_INK.card2 : lit ? MENU_INK.litFill : MENU_INK.paper);
    menuText(ctx, action.name, r.x + 3, r.y + 2, { size: "SMALL", color: focus ? MENU_INK.focus : MENU_INK.text, role: "label", maxW: r.w - 6 });
  });
  const total = actionRowCount(state);
  if (total > ACTION_ROWS_VISIBLE) {
    const first = actionRect(0);
    const mark = `${view.offset + 1}/${total - ACTION_ROWS_VISIBLE + 1}`;
    menuText(ctx, mark, BODY_CARD.x + BODY_CARD.w - 4, first.y - 10, { size: "SMALL", color: MENU_INK.sub, role: "label", align: "right" });
  }
}

function drawFormula(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, view: Readonly<SheetView>): void {
  const index = focusedActionIndex(state, view);
  const action = index === null ? undefined : bodyActions(state)[index];
  if (action === undefined) return;
  const r = BODY_FORMULA_RECT;
  px(ctx, r.x, r.y - 2, r.w, 1, MENU_INK.rule);
  const m = TEXT.SMALL;
  const lineH = lineHeights().tight;
  const rows = wrapChunks(bodyActionChunks(action), r.w, m);
  const fit = formulaRowsFit(r);
  rows.slice(0, fit).forEach((row, i) => drawChunkRow(ctx, row, r.x, r.y + (i + 1) * lineH - 1, r.w, m));
}

function drawStatusPage(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, view: Readonly<SheetView>): void {
  drawAttributes(ctx, state);
  px(ctx, BODY_DERIVED_RECT.x - 6, BODY_DERIVED_RECT.y, 1, BODY_DERIVED_RECT.h, MENU_INK.rule);
  drawDerived(ctx, state);
  drawReach(ctx, state);
  drawActions(ctx, state, view);
  drawFormula(ctx, state, view);
}

const ULT_HEAD = "奥義  ";
const ULT_EQUIPPED = "（右手）";
const CHOSEN_TEXT = "選んでいる";
const ULT_COST_HEAD = "奥義ゲージ ";
const ARROW_GLYPH: Readonly<Record<-1 | 1, string>> = { [-1]: "<", [1]: ">" };

function drawUltimatePage(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, view: Readonly<SheetView>): void {
  const moveset = sheetMoveset(state, view.offset);
  const note = moveset === state.stats.moveset ? ULT_EQUIPPED : "";
  menuText(ctx, `${ULT_HEAD}${MOVESETS[moveset].name}${note}`, BODY_CARD.x + BODY_CARD.w / 2, ULT_HEAD_Y, { size: "SMALL", color: MENU_INK.text, role: "label", align: "center" });
  if (canChooseUltimate(state)) {
    for (const dir of [-1, 1] as const) drawChip(ctx, MOVESET_ARROWS[dir], ARROW_GLYPH[dir], { on: false, focus: view.focus === fid.moveset(dir), dim: false });
  }
  const chosen = ultimateChoice(state.profile, moveset).key;
  const choosable = canChooseUltimate(state);
  ULTIMATES[moveset].forEach((def, i) => {
    const r = ultCardRect(i);
    const on = def.key === chosen;
    const focus = view.focus === fid.ult(i);
    px(ctx, r.x, r.y, r.w, r.h, on ? MENU_INK.card2 : MENU_INK.card);
    box(ctx, r.x, r.y, r.w, r.h, focus ? MENU_INK.focus : on ? MENU_INK.gold : MENU_INK.rule);
    const tone = choosable || on ? MENU_INK.text : MENU_INK.dim;
    const w = r.w - PAD * 2;
    menuText(ctx, def.name, r.x + PAD, r.y + 6, { size: "BODY", color: on ? MENU_INK.focus : tone, role: "sentence", maxW: w });
    const cost = ultimateCostOf(def);
    const meta = cost === null ? ULTIMATE_KIND_LABEL[def.kind] : `${ULTIMATE_KIND_LABEL[def.kind]}  ${ULT_COST_HEAD}${cost}`;
    menuText(ctx, meta, r.x + PAD, r.y + 20, { size: "SMALL", color: MENU_INK.sub, role: "label", maxW: w });
    drawColumn(ctx, [tip(def.desc, tone)], { x: r.x + PAD, y: r.y + 32, w, h: r.h - 32 - 16 });
    if (on) menuText(ctx, CHOSEN_TEXT, r.x + PAD, r.y + r.h - 13, { size: "SMALL", color: MENU_INK.gold, role: "label" });
  });
}

function drawBodySheet(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, view: Readonly<SheetView>): void {
  drawPageTabs(ctx, view);
  drawPaperCard(ctx, BODY_CARD);
  if (view.page === BODY_PAGE_ULTIMATE) drawUltimatePage(ctx, state, view);
  else drawStatusPage(ctx, state, view);
}

// -----------------------------------------------------------------------------
// 振り分け
// -----------------------------------------------------------------------------

function drawSubject(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, ui: Readonly<InventoryUi>, view: Readonly<SheetView>): void {
  const subject = view.subject;
  switch (subject.kind) {
    case "item":
      drawItemSheet(ctx, state, ui, view);
      return;
    case "pair": {
      const { candidate, current } = pairItems(state, subject);
      drawItemPage(ctx, state, candidate, current, PAIR_PAGES[0]);
      drawItemPage(ctx, state, current, null, PAIR_PAGES[1]);
      return;
    }
    case "stone":
      drawStonePage(ctx, state, sheetStone(state, subject.stoneId), SHEET_CARD, true);
      return;
    case "stonePair": {
      const { candidate, current } = pairStones(state, subject);
      drawStonePage(ctx, state, candidate, PAIR_PAGES[0], false);
      drawStonePage(ctx, state, current, PAIR_PAGES[1], false);
      return;
    }
    case "rune":
      drawRuneSheet(ctx, subject.key);
      return;
    case "body":
      drawBodySheet(ctx, state, view);
      return;
    case "boon":
      drawBoonSheet(ctx, state, subject.key);
      return;
    case "lineage":
      drawLineageSheet(ctx, state, subject.lineage);
      return;
  }
}

/** 書付（1 品・見開き・体・祝福・系譜・刻印符・スキル石） */
export function drawSheet(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, ui: Readonly<InventoryUi>, view: Readonly<SheetView>, hits: readonly MenuHit[]): void {
  drawSubject(ctx, state, ui, view);
  const hit = focusedHit(hits, view.focus);
  if (hit !== null) drawFocusBrackets(ctx, hit.rect);
}
