import { KEYWORD_DEFS } from "../core/keywords";
import type { GameState } from "../core/state";
import { RELIC_GLYPHS } from "../data/sprites/attire";
import { BOON_ACTIONS, BOONS, type BoonKey } from "../system/boonDefs";
import { gracesOf } from "../system/boons";
import { itemColor } from "../system/loot";
import {
  ACTION_GLYPH,
  CARD_H,
  CARD_W,
  EMBLEM,
  actionChipRect,
  emptyGraceId,
  feedsOfAction,
  graceRect,
  graceRows,
  relicRect,
  relicsOnAction,
} from "../ui/actPage";
import { crestShape } from "../ui/crestShape";
import { fid, focusedHit } from "../ui/menuFocus";
import type { InventoryUi, LootSlot, MenuHit, Rect, ViewOf } from "../ui/menuState";
import { glyphSize, drawRelicGlyph } from "./attireUi";
import { boonCardColor } from "./boonUi";
import { MENU_INK, box, dashBox, drawFocusBrackets, drawGlyphDisc, line, menuText, noteMarks, px } from "./crestDraw";

/**
 * 加護の頁の描画（docs/ideas/inventory-v2/E-merged.md 6 章 W6、E-impl.md 4-3 E5）。state と ui を読むだけ。
 * 上に行動の札、左に加護の枠、右に乗る遺物、中央に行動の角枠、下に注ぐ系統。糸は角枠へ集める
 */

type ActView = ViewOf<"act">;

const SECTION_Y = 40;
const GRACE_LABEL = "加護";
const RELIC_LABEL = "乗る遺物";
const FEED_LABEL = "注ぐ系統";
const EMPTY_GRACE = "加護の空き";
const TEXT_INSET = 8;
const FEED_Y = 148;
const FEED_PITCH = 22;
const FEED_DISC = 16;
const FEED_LINE_Y = 140;
const CARD_STRIP_W = 3;
const RELIC_GLYPH_SCALE = 1;
const RELIC_GLYPH_X = 5;
const RELIC_NAME_X = 22;
const CHIP_TEXT_DY = 2;
const FEED_LABEL_Y = 144;

function drawChips(ctx: CanvasRenderingContext2D, view: Readonly<ActView>, focus: string | null): void {
  BOON_ACTIONS.forEach((action, i) => {
    const r = actionChipRect(i);
    const current = action === view.action;
    const focused = focus === fid.action(action);
    px(ctx, r.x, r.y, r.w, r.h, current ? MENU_INK.card2 : MENU_INK.card);
    box(ctx, r.x, r.y, r.w, r.h, focused ? MENU_INK.focus : current ? MENU_INK.gold : MENU_INK.sub);
    menuText(ctx, ACTION_GLYPH[action], r.x + r.w / 2, r.y + CHIP_TEXT_DY, { size: "SMALL", color: current ? MENU_INK.focus : MENU_INK.text, role: "ornament", align: "center" });
    noteMarks();
  });
}

/** 札の枠と地（焦点なら白い縁） */
function drawCardFrame(ctx: CanvasRenderingContext2D, r: Readonly<Rect>, ring: string, focused: boolean): void {
  px(ctx, r.x, r.y, r.w, r.h, focused ? MENU_INK.card2 : MENU_INK.card);
  box(ctx, r.x, r.y, r.w, r.h, focused ? MENU_INK.focus : ring);
}

function drawGraceCard(ctx: CanvasRenderingContext2D, key: BoonKey, r: Readonly<Rect>, focused: boolean): void {
  const def = BOONS[key];
  const color = boonCardColor(def);
  drawCardFrame(ctx, r, MENU_INK.rule, focused);
  px(ctx, r.x + 1, r.y + 1, CARD_STRIP_W, r.h - 2, color);
  menuText(ctx, def.name, r.x + TEXT_INSET + CARD_STRIP_W, r.y + r.h / 2, {
    size: "SMALL",
    color: focused ? MENU_INK.focus : MENU_INK.text,
    role: "ornament",
    baseline: "middle",
    maxW: CARD_W - TEXT_INSET * 2 - CARD_STRIP_W,
  });
  noteMarks();
}

function drawEmptyGrace(ctx: CanvasRenderingContext2D, r: Readonly<Rect>, focused: boolean): void {
  px(ctx, r.x, r.y, r.w, r.h, MENU_INK.paper);
  dashBox(ctx, r.x, r.y, r.w, r.h, focused ? MENU_INK.focus : MENU_INK.dim);
  menuText(ctx, EMPTY_GRACE, r.x + TEXT_INSET + CARD_STRIP_W, r.y + r.h / 2, { size: "SMALL", color: focused ? MENU_INK.focus : MENU_INK.sub, role: "ornament", baseline: "middle" });
  noteMarks();
}

function drawRelicCard(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, slot: LootSlot, r: Readonly<Rect>, focused: boolean): void {
  const item = state.profile.equipment[slot];
  if (!item) return;
  drawCardFrame(ctx, r, MENU_INK.sub, focused);
  const size = glyphSize(RELIC_GLYPHS[slot], RELIC_GLYPH_SCALE);
  drawRelicGlyph(ctx, slot, r.x + RELIC_GLYPH_X, r.y + Math.floor((r.h - size.h) / 2), RELIC_GLYPH_SCALE, itemColor(item));
  menuText(ctx, item.name, r.x + RELIC_NAME_X, r.y + r.h / 2, {
    size: "SMALL",
    color: focused ? MENU_INK.focus : MENU_INK.text,
    role: "ornament",
    baseline: "middle",
    maxW: CARD_W - RELIC_NAME_X - 4,
  });
  noteMarks();
}

/** 中央の行動の角枠（二重の縁に行動の 1 字） */
function drawEmblem(ctx: CanvasRenderingContext2D, view: Readonly<ActView>): void {
  const x = EMBLEM.cx - EMBLEM.size / 2;
  const y = EMBLEM.cy - EMBLEM.size / 2;
  px(ctx, x, y, EMBLEM.size, EMBLEM.size, MENU_INK.card2);
  box(ctx, x, y, EMBLEM.size, EMBLEM.size, MENU_INK.focus);
  box(ctx, x + 2, y + 2, EMBLEM.size - 4, EMBLEM.size - 4, MENU_INK.sub);
  menuText(ctx, ACTION_GLYPH[view.action], EMBLEM.cx, EMBLEM.cy, { size: "TITLE", color: MENU_INK.focus, role: "ornament", align: "center", baseline: "middle" });
  noteMarks();
}

export function drawActPage(
  ctx: CanvasRenderingContext2D,
  state: Readonly<GameState>,
  _ui: Readonly<InventoryUi>,
  view: Readonly<ActView>,
  hits: readonly MenuHit[],
): void {
  const { cx, cy, size } = EMBLEM;
  const graces = gracesOf(state, view.action);
  const relics = relicsOnAction(state, view.action);
  const rows = graceRows(state, view.action);

  // 糸（札の後ろ）
  for (let i = 0; i < rows; i++) {
    const key = graces[i];
    const r = graceRect(i);
    line(ctx, r.x + r.w, r.y + CARD_H / 2, cx - size / 2, cy, key === undefined ? MENU_INK.dim : boonCardColor(BOONS[key]), key === undefined);
  }
  relics.forEach((_, i) => {
    const r = relicRect(i);
    line(ctx, cx + size / 2, cy, r.x, r.y + CARD_H / 2, MENU_INK.sub);
  });
  const feeds = feedsOfAction(state, view.action);
  const shape = crestShape(state);
  const feedX = (i: number): number => cx - ((feeds.length - 1) * FEED_PITCH) / 2 + i * FEED_PITCH;
  feeds.forEach((k, i) => {
    const under = shape.rows.find((row) => row.keyword === k)?.undercurrent ?? true;
    line(ctx, cx, cy + size / 2, feedX(i), FEED_LINE_Y, under ? MENU_INK.dim : KEYWORD_DEFS[k].color, under);
  });

  drawChips(ctx, view, view.focus);
  menuText(ctx, GRACE_LABEL, TEXT_INSET, SECTION_Y, { size: "SMALL", color: MENU_INK.sub, role: "ornament" });
  menuText(ctx, RELIC_LABEL, relicRect(0).x + CARD_W, SECTION_Y, { size: "SMALL", color: MENU_INK.sub, role: "ornament", align: "right" });
  for (let i = 0; i < rows; i++) {
    const key = graces[i];
    if (key === undefined) drawEmptyGrace(ctx, graceRect(i), view.focus === emptyGraceId(i));
    else drawGraceCard(ctx, key, graceRect(i), view.focus === fid.grace(key));
  }
  relics.forEach(({ slot }, i) => drawRelicCard(ctx, state, slot, relicRect(i), view.focus === fid.relic(slot)));
  drawEmblem(ctx, view);
  if (feeds.length > 0) menuText(ctx, FEED_LABEL, TEXT_INSET, FEED_LABEL_Y, { size: "SMALL", color: MENU_INK.sub, role: "ornament" });
  feeds.forEach((k, i) => {
    const under = shape.rows.find((row) => row.keyword === k)?.undercurrent ?? true;
    drawGlyphDisc(ctx, k, feedX(i), FEED_Y, FEED_DISC, KEYWORD_DEFS[k].color, { under });
  });

  const hit = focusedHit(hits, view.focus);
  if (hit !== null) drawFocusBrackets(ctx, hit.rect);
}
