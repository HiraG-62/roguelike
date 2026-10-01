import type { GameState } from "../core/state";
import { ANVIL_GLYPH, RELIC_GLYPHS } from "../data/sprites/attire";
import { ECHO_OPS, ECHO_OP_LABEL } from "../loot/crafting";
import { TRAIT_COLORS, TRAIT_COLOR_HEX, type Item } from "../loot/types";
import { itemColor } from "../system/loot";
import {
  ANVIL_EXEC_RECT,
  ANVIL_FOCUS,
  ANVIL_HEAD_POS,
  ANVIL_NEXT_RECT,
  ANVIL_POT_Y,
  ANVIL_PREV_RECT,
  ANVIL_ROW_PAGE,
  type AnvilRow,
  anvilChosenSlot,
  anvilForgeStep,
  anvilOpRect,
  anvilPageStart,
  anvilPotX,
  anvilRowFocus,
  anvilRowRect,
  anvilRows,
  anvilSubjects,
  potLevel,
} from "../ui/anvil";
import { ATTIRE_PART_RECTS, ATTIRE_SLOTS, focusedPart, partMarks } from "../ui/attire";
import { forgeOpBlock, forgePickLabel, isEquippedItem } from "../ui/forge";
import { SLOT_LABEL } from "../ui/inventoryLayout";
import { fid, focusedHit } from "../ui/menuFocus";
import type { InventoryUi, LootSlot, MenuHit, Rect, ViewOf } from "../ui/menuState";
import { drawGlyph, drawRelicGlyph, glyphSize } from "./attireUi";
import { MENU_INK, box, drawFocusBrackets, line, menuText, noteMarks, px } from "./crestDraw";
import { tileHash } from "./renderMath";

/**
 * 金床の構え（装束の頁が anvil を持つ間）の描画（docs/ideas/inventory-v2/E-impl.md 4-3 E7、E-merged.md 6 章 W7）。state と ui を読むだけ。
 * 人影の代わりに金床と炉の火、部位は装束と同じ位置、腰の代わりに残響の壺 5（水位 = 量 ÷ ANVIL_POT_FULL。数は荷札だけ）。
 * 右は 札の一覧（装備中の物が先頭で金の印）と操作 5・実行。札の名前・操作名は ornament（情報の予算は荷札・見出し・案内の 4 行）。
 * 炉の火のゆらぎは座標のハッシュと ui.time（rng を使わない）
 */

type AttireView = ViewOf<"attire">;

const ANVIL_POS = { x: 100, y: 78, scale: 6 } as const;
const ANVIL_COLORS = { h: "#8a8690", "#": "#6a666e", d: "#4a464e" } as const;
/** 金床の天板の中央（部位から糸を引く先） */
const ANVIL_ANCHOR = { x: 130, y: 92 } as const;

/** 炉の火（金床の上に 6 本。ゆらぎは座標のハッシュ） */
const FLAME_COUNT = 6;
const FLAME_X0 = 107;
const FLAME_PITCH = 8;
const FLAME_BASE_Y = 83;
const FLAME_MIN_H = 6;
const FLAME_VAR_H = 4;
const FLAME_W = 5;
const FLAME_SEED = 41;
const FLAME_SWAY_SPEED = 9;
const FLAME_SWAY_PHASE = 1.7;
const FLAME_SWAY_H = 2;
const FLAME_COLORS = { outer: "#c8501c", mid: "#f08a30", core: "#ffd070" } as const;

function drawFlames(ctx: CanvasRenderingContext2D, time: number): void {
  for (let i = 0; i < FLAME_COUNT; i++) {
    const h = FLAME_MIN_H + (tileHash(i, FLAME_SEED) % FLAME_VAR_H) + Math.round(FLAME_SWAY_H * Math.sin(time * FLAME_SWAY_SPEED + i * FLAME_SWAY_PHASE));
    const cx = FLAME_X0 + i * FLAME_PITCH;
    for (let r = 0; r < h; r++) {
      const w = Math.max(1, Math.round(FLAME_W * (1 - r / h)));
      const color = r < h / 3 ? FLAME_COLORS.core : r < (h * 2) / 3 ? FLAME_COLORS.mid : FLAME_COLORS.outer;
      px(ctx, cx - Math.floor(w / 2), FLAME_BASE_Y - 1 - r, w, 1, color);
    }
  }
}

/** 部位の枠 1 つ（絵・名のある遺物の金の角・芽の緑・新着の白い点。選んだ部位は金の枠） */
function drawPartTile(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, slot: LootSlot, chosen: boolean, focused: boolean): void {
  const r = ATTIRE_PART_RECTS[slot];
  const item = state.profile.equipment[slot] ?? null;
  px(ctx, r.x, r.y, r.w, r.h, focused ? MENU_INK.card2 : MENU_INK.card);
  box(ctx, r.x, r.y, r.w, r.h, focused ? MENU_INK.focus : chosen ? MENU_INK.gold : MENU_INK.rule);
  noteMarks();
  if (item !== null) {
    const size = glyphSize(RELIC_GLYPHS[slot], 2);
    drawRelicGlyph(ctx, slot, r.x + Math.floor((r.w - size.w) / 2), r.y + Math.floor((r.h - size.h) / 2), 2, itemColor(item));
  }
  const marks = partMarks(state, slot);
  if (marks.named) {
    px(ctx, r.x + 1, r.y + 1, 4, 1, MENU_INK.gold);
    px(ctx, r.x + 1, r.y + 1, 1, 4, MENU_INK.gold);
  }
  if (marks.bud) {
    px(ctx, r.x + r.w - 5, r.y + 2, 3, 3, MENU_INK.bud);
    px(ctx, r.x + r.w - 4, r.y + 5, 1, 2, MENU_INK.budStem);
  }
  if (marks.unseen) px(ctx, r.x + 2, r.y + r.h - 4, 2, 2, MENU_INK.focus);
}

// -----------------------------------------------------------------------------
// 残響の壺
// -----------------------------------------------------------------------------

const POT_BODY = { dx: 0, dy: 2, w: 18, h: 22 } as const;
const POT_NECK = { dx: 4, dy: 0, w: 10, h: 3 } as const;
const POT_WATER_INSET = 2;
const POT_WATER_H = POT_BODY.h - 4;

function drawPots(ctx: CanvasRenderingContext2D, ui: Readonly<InventoryUi>, focus: string | null): void {
  px(ctx, 40, ANVIL_POT_Y - 6, 168, 1, MENU_INK.rule);
  TRAIT_COLORS.forEach((color, i) => {
    const x = anvilPotX(i);
    const y = ANVIL_POT_Y;
    const focused = focus === ANVIL_FOCUS.pot(color);
    px(ctx, x + POT_BODY.dx, y + POT_BODY.dy, POT_BODY.w, POT_BODY.h, MENU_INK.card);
    box(ctx, x + POT_BODY.dx, y + POT_BODY.dy, POT_BODY.w, POT_BODY.h, focused ? MENU_INK.focus : MENU_INK.sub);
    px(ctx, x + POT_NECK.dx, y + POT_NECK.dy, POT_NECK.w, POT_NECK.h, MENU_INK.sub);
    const level = Math.round(potLevel(ui.craft.echoes[color]) * POT_WATER_H);
    px(ctx, x + POT_WATER_INSET, y + POT_BODY.dy + POT_BODY.h - 2 - level, POT_BODY.w - POT_WATER_INSET * 2, level, TRAIT_COLOR_HEX[color]);
    noteMarks();
  });
}

// -----------------------------------------------------------------------------
// 右の一覧・操作
// -----------------------------------------------------------------------------

const ROW_GLYPH_X = 4;
const ROW_NAME_X = 20;
const ROW_NAME_PAD = 26;
const ROW_TEXT_DY = 6;
const WORN_MARK = 4;
const EMPTY_LIST_TEXT = "遺物なし";
const EXEC_LABEL = "実行";
const PREV_MARK = "▲";
const NEXT_MARK = "▼";

function rowLabel(state: Readonly<GameState>, view: Readonly<AttireView>, row: Readonly<AnvilRow>): string {
  const session = view.anvil?.forge ?? null;
  if (row.kind !== "pick") return row.item.name;
  return session === null ? "" : forgePickLabel(state.profile, session, row.pick);
}

function drawItemRow(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, item: Readonly<Item>, r: Rect, label: string, tone: { focus: boolean; chosen: boolean; dim: boolean }): void {
  px(ctx, r.x, r.y, r.w, r.h, tone.chosen ? MENU_INK.litFill : tone.focus ? MENU_INK.card2 : MENU_INK.card);
  box(ctx, r.x, r.y, r.w, r.h, tone.focus ? MENU_INK.focus : tone.chosen ? MENU_INK.gold : tone.dim ? MENU_INK.rule : MENU_INK.sub);
  const slot = item.slot;
  if (slot !== "offHand") {
    drawRelicGlyph(ctx, slot, r.x + ROW_GLYPH_X, r.y + Math.floor((r.h - glyphSize(RELIC_GLYPHS[slot], 1).h) / 2), 1, itemColor(item), tone.dim);
  }
  menuText(ctx, label, r.x + ROW_NAME_X, r.y + ROW_TEXT_DY, { size: "SMALL", color: tone.dim ? MENU_INK.dim : tone.focus ? MENU_INK.focus : MENU_INK.text, role: "ornament", maxW: r.w - ROW_NAME_PAD });
  if (isEquippedItem(state.profile, item.id)) px(ctx, r.x + r.w - WORN_MARK - 3, r.y + 3, WORN_MARK, WORN_MARK, MENU_INK.gold);
}

function drawPickRow(ctx: CanvasRenderingContext2D, r: Rect, label: string, focus: boolean): void {
  px(ctx, r.x, r.y, r.w, r.h, focus ? MENU_INK.card2 : MENU_INK.card);
  box(ctx, r.x, r.y, r.w, r.h, focus ? MENU_INK.focus : MENU_INK.sub);
  menuText(ctx, label, r.x + 4, r.y + ROW_TEXT_DY, { size: "SMALL", color: focus ? MENU_INK.focus : MENU_INK.text, role: "ornament", maxW: r.w - 8 });
}

function drawChip(ctx: CanvasRenderingContext2D, r: Rect, label: string, tone: { on: boolean; focus: boolean; dim: boolean; warn?: boolean }): void {
  px(ctx, r.x, r.y, r.w, r.h, tone.focus ? MENU_INK.card2 : tone.on ? MENU_INK.litFill : MENU_INK.card);
  box(ctx, r.x, r.y, r.w, r.h, tone.focus ? MENU_INK.focus : tone.on ? MENU_INK.gold : tone.warn === true ? MENU_INK.shu : MENU_INK.sub);
  const color = tone.dim ? MENU_INK.dim : tone.focus ? MENU_INK.focus : MENU_INK.text;
  menuText(ctx, label, r.x + r.w / 2, r.y + 3, { size: "SMALL", color, role: "ornament", align: "center", maxW: r.w - 2 });
}

/** 一覧の見出し（札の段は部位、相手・行の段は操作名） */
function listHeading(state: Readonly<GameState>, view: Readonly<AttireView>, slot: LootSlot): string {
  const anvil = view.anvil;
  const session = anvil?.forge ?? null;
  const step = anvil === null ? null : anvilForgeStep(state, anvil);
  const op = session?.op ?? null;
  if (op !== null && step === "partner") return `${ECHO_OP_LABEL[op]}の相手`;
  if (op !== null && step === "pick") return `${ECHO_OP_LABEL[op]}の行`;
  return `倉庫の${SLOT_LABEL[slot]}`;
}

/** 部位を選ぶ前は、焦点の部位の札を薄く見せる（当たりは無い） */
function drawPreviewList(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, slot: LootSlot): void {
  menuText(ctx, `倉庫の${SLOT_LABEL[slot]}`, ANVIL_HEAD_POS.x, ANVIL_HEAD_POS.y, { size: "SMALL", color: MENU_INK.sub, role: "ornament", maxW: 120 });
  const items = anvilSubjects(state.profile, slot).slice(0, ANVIL_ROW_PAGE);
  if (items.length === 0) menuText(ctx, EMPTY_LIST_TEXT, anvilRowRect(0).x, anvilRowRect(0).y + 4, { size: "SMALL", color: MENU_INK.sub, role: "ornament", maxW: 200 });
  items.forEach((item, i) => drawItemRow(ctx, state, item, anvilRowRect(i), item.name, { focus: false, chosen: false, dim: true }));
}

function drawActiveList(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, view: Readonly<AttireView>, slot: LootSlot): void {
  const anvil = view.anvil;
  if (anvil === null) return;
  menuText(ctx, listHeading(state, view, slot), ANVIL_HEAD_POS.x, ANVIL_HEAD_POS.y, { size: "SMALL", color: MENU_INK.sub, role: "ornament", maxW: 120 });
  const rows = anvilRows(state.profile, anvil);
  if (rows.length === 0) menuText(ctx, EMPTY_LIST_TEXT, anvilRowRect(0).x, anvilRowRect(0).y + 4, { size: "SMALL", color: MENU_INK.sub, role: "ornament", maxW: 200 });
  const start = anvilPageStart(rows.length, anvil.offset);
  const subjectId = anvil.forge?.subjectId ?? null;
  rows.slice(start, start + ANVIL_ROW_PAGE).forEach((row, i) => {
    const r = anvilRowRect(i);
    const focus = view.focus === anvilRowFocus(row);
    if (row.kind === "pick") {
      drawPickRow(ctx, r, rowLabel(state, view, row), focus);
      return;
    }
    drawItemRow(ctx, state, row.item, r, rowLabel(state, view, row), { focus, chosen: row.kind === "subject" && row.item.id === subjectId, dim: false });
  });
  if (start > 0) menuText(ctx, PREV_MARK, ANVIL_PREV_RECT.x + ANVIL_PREV_RECT.w - 6, ANVIL_PREV_RECT.y, { size: "SMALL", color: view.focus === ANVIL_FOCUS.prev ? MENU_INK.focus : MENU_INK.sub, role: "ornament", align: "right" });
  if (start + ANVIL_ROW_PAGE < rows.length) menuText(ctx, NEXT_MARK, ANVIL_NEXT_RECT.x + ANVIL_NEXT_RECT.w - 6, ANVIL_NEXT_RECT.y - 2, { size: "SMALL", color: view.focus === ANVIL_FOCUS.next ? MENU_INK.focus : MENU_INK.sub, role: "ornament", align: "right" });
}

function drawForgeBar(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, view: Readonly<AttireView>): void {
  const session = view.anvil?.forge ?? null;
  if (session === null) return;
  ECHO_OPS.forEach((op, i) => {
    const blocked = forgeOpBlock(state.profile, session.subjectId, op) !== null;
    drawChip(ctx, anvilOpRect(i), ECHO_OP_LABEL[op], { on: session.op === op, focus: view.focus === fid.op(op), dim: blocked, warn: op === "shatter" });
  });
  const op = session.op;
  if (op === null || view.anvil === null) return;
  const ready = anvilForgeStep(state, view.anvil) === "ready";
  drawChip(ctx, ANVIL_EXEC_RECT, EXEC_LABEL, { on: ready, focus: view.focus === fid.exec, dim: !ready, warn: op === "shatter" });
}

// -----------------------------------------------------------------------------
// 全体
// -----------------------------------------------------------------------------

/** 金床の構え。人影の代わりに金床と炉の火、腰の代わりに残響の壺、右に札の一覧と操作 */
export function drawAnvil(
  ctx: CanvasRenderingContext2D,
  state: Readonly<GameState>,
  ui: Readonly<InventoryUi>,
  view: Readonly<AttireView>,
  hits: readonly MenuHit[],
): void {
  const anvil = view.anvil;
  if (anvil === null) return;
  const chosen = anvilChosenSlot(anvil);
  const focusSlot = focusedPart(view.focus);
  for (const slot of ATTIRE_SLOTS) {
    const r = ATTIRE_PART_RECTS[slot];
    line(ctx, r.x + r.w / 2, r.y + r.h / 2, ANVIL_ANCHOR.x, ANVIL_ANCHOR.y, slot === chosen ? MENU_INK.gold : MENU_INK.rule, slot !== chosen);
  }
  drawGlyph(ctx, ANVIL_GLYPH, ANVIL_POS.x, ANVIL_POS.y, ANVIL_POS.scale, ANVIL_COLORS);
  drawFlames(ctx, ui.time);
  for (const slot of ATTIRE_SLOTS) drawPartTile(ctx, state, slot, slot === chosen, focusSlot === slot);
  drawPots(ctx, ui, view.focus);
  px(ctx, ANVIL_PREV_RECT.x - 10, 22, 1, 188, MENU_INK.rule);
  if (chosen !== null) {
    drawActiveList(ctx, state, view, chosen);
    drawForgeBar(ctx, state, view);
  } else if (focusSlot !== null) {
    drawPreviewList(ctx, state, focusSlot);
  }
  const hit = focusedHit(hits, view.focus);
  if (hit !== null) drawFocusBrackets(ctx, hit.rect);
}
