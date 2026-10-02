import { KEYWORD_DEFS, profileKeywords } from "../core/keywords";
import type { GameState } from "../core/state";
import { ATTIRE_FIGURE, RELIC_GLYPHS } from "../data/sprites/attire";
import type { Frame } from "../data/sprites/frameKit";
import type { Item } from "../loot/types";
import { MODIFIERS, SKILL, slotLinks } from "../skills/data";
import { stoneInSlot } from "../skills/persistence";
import type { SkillStone } from "../skills/types";
import { itemColor } from "../system/loot";
import { relicKeywords } from "../system/keywords";
import { slotModifierView } from "../system/skills";
import { ATTIRE_PART_RECTS, ATTIRE_SLOTS, FIGURE_POS, MINI_CREST_RECT, STONE_GEM_Y, focusedPart, focusedStone, partMarks, stoneGemX } from "../ui/attire";
import { type CrestShape, crestShape, sourceKey, stoneFaceColor } from "../ui/crestShape";
import { focusedSource } from "../ui/menuActions";
import { focusedHit } from "../ui/menuFocus";
import type { InventoryUi, LootSlot, MenuHit, ViewOf } from "../ui/menuState";
import { type BandDelta, thinnedKeywords, tryOn, tryOnBase } from "../ui/tryOn";
import { drawAnvil } from "./anvilUi";
import { FIGURE_ANCHOR_DOTS, FIGURE_ZOOM, drawAttireFigure, drawPedestal, figurePoint } from "./attireFigure";
import { MENU_INK, box, dashBox, diamond, drawFocusBrackets, drawMiniCrest, line, mixHex, noteMarks, px } from "./crestDraw";

/**
 * 装束の描画（docs/ideas/inventory-v2/E-merged.md 6 章 W1）。state と ui を読むだけ。
 * 人影・6 部位（遺物の絵は響きの色）・腰のスキル石と符の鉤・右の紋の写し。
 * 部位を指すと写しでその遺物の珠が白く光り、外すと細る帯が ▼ / 消 で点滅する（段 1 の試着 tryOn で数え直す）
 */

/** 色の表で 1 文字ずつ塗る（. と表に無い文字は透明）。同じ色の横並びは 1 つの矩形にまとめる */
export function drawGlyph(ctx: CanvasRenderingContext2D, frame: Frame, x: number, y: number, scale: number, colors: Readonly<Record<string, string>>): void {
  frame.forEach((row, j) => {
    let i = 0;
    while (i < row.length) {
      const color = colors[row[i] ?? "."];
      let n = 1;
      while (i + n < row.length && row[i + n] === row[i]) n++;
      if (color !== undefined) px(ctx, x + i * scale, y + j * scale, n * scale, scale, color);
      i += n;
    }
  });
}

/** 絵の論理寸法（倍率込み） */
export function glyphSize(frame: Frame, scale: number): { w: number; h: number } {
  return { w: (frame[0]?.length ?? 0) * scale, h: frame.length * scale };
}

/** 色を紙に寄せる（ghost = 候補の小さな体で今の物の影を見せる） */
const GHOST_MIX = 0.65;

/** 部位の絵。# = 響きの色、+ = 光、o = 影 */
export function drawRelicGlyph(ctx: CanvasRenderingContext2D, slot: LootSlot, x: number, y: number, scale: number, color: string, ghost = false): void {
  const colors = {
    "#": ghost ? mixHex(color, MENU_INK.paper, GHOST_MIX) : color,
    "+": ghost ? mixHex(MENU_INK.focus, MENU_INK.paper, GHOST_MIX) : MENU_INK.focus,
    o: ghost ? MENU_INK.rule : MENU_INK.dim,
  };
  drawGlyph(ctx, RELIC_GLYPHS[slot], x, y, scale, colors);
}

const FIGURE_COLORS = { "#": "#c8a050", o: "#e8d0b0", r: "#b0342c" } as const;
const FIGURE_DIM = 0.6;
/** 足元の影（人影の幅 10 のうち中央 8） */
const SHADOW_INSET = 1;
const SHADOW_W = 8;

/** 人影（10 × 14）。dim = 候補の小さな体で薄く */
export function drawFigure(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, dim = false): void {
  const { h } = glyphSize(ATTIRE_FIGURE, scale);
  px(ctx, x + SHADOW_INSET * scale, y + h + 1, SHADOW_W * scale, 2, MENU_INK.fiberB);
  const colors = dim
    ? Object.fromEntries(Object.entries(FIGURE_COLORS).map(([k, c]) => [k, mixHex(c, MENU_INK.paper, FIGURE_DIM)]))
    : FIGURE_COLORS;
  drawGlyph(ctx, ATTIRE_FIGURE, x, y, scale, colors);
}

/** 腰の石の菱形と符の鉤の寸法 */
const GEM_D = 16;
const HOOK_W = 3;
const HOOK_H = 6;
const HOOK_GAP = 5;
const HOOK_DY = 19;

/**
 * 腰の石 1 つ（菱形 16px）と符の鉤（枠のリンクの数）。顔の色 = 石の最初の系統。
 * hookColors = 付いている符の色（リンクを使う分だけ鉤を塗る）
 */
export function drawStoneGem(
  ctx: CanvasRenderingContext2D,
  i: number,
  x: number,
  y: number,
  stone: Readonly<SkillStone> | null,
  focus: boolean,
  lit: boolean,
  hookColors: readonly string[] = [],
): void {
  diamond(ctx, x, y, GEM_D, focus ? MENU_INK.focus : lit ? MENU_INK.gold : MENU_INK.sub, stone ? MENU_INK.gem : MENU_INK.paper);
  if (stone) {
    px(ctx, x + 6, y + 6, 4, 4, stoneFaceColor(stone.skillKey));
    px(ctx, x + 7, y + 7, 1, 1, MENU_INK.focus);
  }
  const n = slotLinks(i);
  const hx = x + GEM_D / 2 - (n * HOOK_GAP - 2) / 2;
  for (let j = 0; j < n; j++) {
    const c = hookColors[j];
    if (c !== undefined) px(ctx, hx + j * HOOK_GAP, y + HOOK_DY, HOOK_W, HOOK_H, c);
    else box(ctx, hx + j * HOOK_GAP, y + HOOK_DY, HOOK_W, HOOK_H, MENU_INK.dim);
  }
  noteMarks();
}

/** 石の枠に付いている符の鉤の色（リンクの費用ぶん同じ色を並べる） */
function hookColorsOf(state: Readonly<GameState>, i: number): string[] {
  const out: string[] = [];
  for (const m of slotModifierView(state as GameState, i)) {
    if (!m.active) continue;
    const def = MODIFIERS[m.key];
    for (let c = 0; c < (def.linkCost ?? 1); c++) out.push(def.color);
  }
  return out;
}

/** 人影の足元（FIGURE_POS の枠 50 × 70 の下の中央）。体は ×3 で枠に収まる */
export const FIGURE_FEET = { x: FIGURE_POS.x + 25, y: FIGURE_POS.y + 69 } as const;

/** 部位から人影へ伸ばす糸の先（人影の体の上の点） */
export const PART_ANCHORS: Readonly<Record<LootSlot, { x: number; y: number }>> = {
  head: figurePoint(FIGURE_FEET, FIGURE_ZOOM, FIGURE_ANCHOR_DOTS.head),
  amulet: figurePoint(FIGURE_FEET, FIGURE_ZOOM, FIGURE_ANCHOR_DOTS.amulet),
  mainHand: figurePoint(FIGURE_FEET, FIGURE_ZOOM, FIGURE_ANCHOR_DOTS.mainHand),
  ring: figurePoint(FIGURE_FEET, FIGURE_ZOOM, FIGURE_ANCHOR_DOTS.ring),
  armor: figurePoint(FIGURE_FEET, FIGURE_ZOOM, FIGURE_ANCHOR_DOTS.armor),
  boots: figurePoint(FIGURE_FEET, FIGURE_ZOOM, FIGURE_ANCHOR_DOTS.boots),
};

/** 部位の下の系統の点（その遺物の系統。段の立った系統だけ色）。印の予算（部位 6 × 2 = 12）に収める */
const PART_DOTS_MAX = 2;
const DOT = 4;
const DOT_GAP = 6;
const RELIC_SCALE = 2;

function drawPartDots(ctx: CanvasRenderingContext2D, item: Readonly<Item>, r: { x: number; y: number; w: number; h: number }, shape: Readonly<CrestShape>): void {
  const keywords = profileKeywords(relicKeywords(item)).slice(0, PART_DOTS_MAX);
  const x0 = r.x + Math.floor((r.w - (keywords.length * DOT_GAP - 2)) / 2);
  keywords.forEach((k, i) => {
    const stepped = shape.rows.some((row) => row.keyword === k && !row.undercurrent);
    px(ctx, x0 + i * DOT_GAP, r.y + r.h + 2, DOT, DOT, stepped ? KEYWORD_DEFS[k].color : MENU_INK.dim);
    noteMarks();
  });
}

/** 部位の枠 1 つ（絵・名のある遺物の金の角・芽の緑・新着の白い点・系統の点） */
function drawPart(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, slot: LootSlot, focused: boolean, shape: Readonly<CrestShape>): void {
  const r = ATTIRE_PART_RECTS[slot];
  const item = state.profile.equipment[slot] ?? null;
  px(ctx, r.x, r.y, r.w, r.h, focused ? MENU_INK.card2 : MENU_INK.card);
  box(ctx, r.x, r.y, r.w, r.h, focused ? MENU_INK.focus : MENU_INK.rule);
  noteMarks();
  if (item === null) {
    dashBox(ctx, r.x + 4, r.y + 4, r.w - 8, r.h - 8, MENU_INK.dim);
  } else {
    const size = glyphSize(RELIC_GLYPHS[slot], RELIC_SCALE);
    drawRelicGlyph(ctx, slot, r.x + Math.floor((r.w - size.w) / 2), r.y + Math.floor((r.h - size.h) / 2), RELIC_SCALE, itemColor(item));
    drawPartDots(ctx, item, r, shape);
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

/** 焦点の物を外したら細る帯（部位か腰の石を指しているときだけ） */
function thinningOf(state: Readonly<GameState>, view: Readonly<ViewOf<"attire">>): BandDelta[] {
  const slot = focusedPart(view.focus);
  if (slot !== null && state.profile.equipment[slot]) return thinnedKeywords(tryOn(tryOnBase(state), { kind: "relic", slot, item: null }));
  const i = focusedStone(view.focus);
  if (i !== null && stoneInSlot(state.skills.profile, i)) return thinnedKeywords(tryOn(tryOnBase(state), { kind: "stone", index: i, skillKey: null }));
  return [];
}

/** 腰の帯の線 */
const WAIST_LINE = { x: 40, y: 174, w: 168 } as const;

/** 装束（金床の構えなら drawAnvil に任せる） */
export function drawAttire(ctx: CanvasRenderingContext2D, state: Readonly<GameState>, ui: Readonly<InventoryUi>, view: Readonly<ViewOf<"attire">>, hits: readonly MenuHit[]): void {
  if (view.anvil !== null) {
    drawAnvil(ctx, state, ui, view, hits);
    return;
  }
  const shape = crestShape(state);
  for (const slot of ATTIRE_SLOTS) {
    const r = ATTIRE_PART_RECTS[slot];
    const focused = focusedPart(view.focus) === slot;
    const anchor = PART_ANCHORS[slot];
    line(ctx, r.x + r.w / 2, r.y + r.h / 2, anchor.x, anchor.y, focused ? MENU_INK.gold : MENU_INK.rule, !focused);
  }
  drawPedestal(ctx, FIGURE_FEET, FIGURE_ZOOM);
  // 体の絵が読めるまでは今までのドット絵の人形で代わりに描く
  if (!drawAttireFigure(ctx, state, FIGURE_FEET, FIGURE_ZOOM, ui.time)) drawFigure(ctx, FIGURE_POS.x, FIGURE_POS.y, FIGURE_POS.scale);
  for (const slot of ATTIRE_SLOTS) drawPart(ctx, state, slot, focusedPart(view.focus) === slot, shape);
  px(ctx, WAIST_LINE.x, WAIST_LINE.y, WAIST_LINE.w, 1, MENU_INK.rule);
  const focusStone = focusedStone(view.focus);
  for (let i = 0; i < SKILL.slots; i++) {
    drawStoneGem(ctx, i, stoneGemX(i), STONE_GEM_Y, stoneInSlot(state.skills.profile, i), focusStone === i, false, hookColorsOf(state, i));
  }
  const source = focusedSource(state, ui);
  drawMiniCrest(ctx, shape, MINI_CREST_RECT, { litKey: source === null ? null : sourceKey(source), changes: thinningOf(state, view), time: ui.time });
  const hit = focusedHit(hits, view.focus);
  if (hit !== null) drawFocusBrackets(ctx, hit.rect);
}
